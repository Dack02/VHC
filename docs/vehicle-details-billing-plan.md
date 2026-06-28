# Vehicle Details — Usage Metering & Tenant Billing Plan

**Status:** BUILT 2026-06-28 (uncommitted; migrations 20260628130000 + 20260628150000 pending deploy)
**Depends on:** the VehicleDetails integration ([vehicle-details-integration-plan.md](vehicle-details-integration-plan.md))

**Decisions taken:** flat platform-wide sell price, default **£0.08**, editable in Admin →
Platform Settings → Billing. Detail log browser deferred. Credit-low alert **built**
(super-admin SMS via the existing alert recipients, threshold default £10 editable in the
Vehicle Data settings block; balance surfaced read-only). Both apps type-check clean.

---

## 1. Current state (the gap)

The VehicleDetails integration **logs nothing per call**. `lookupVehicleDetailsByRegistration`
hits the API and `persistVehicleDetails` stores vehicle data, but there is **no per-tenant
usage record, no cost capture, and no sell price**. So today a super-admin cannot see how
much each tenant is using it, what it costs us, or what to bill them. The free DVSA MOT
lookup is likewise unmetered (it's free, so that's fine).

This matters more now that the module is **on by default** and **merged into the front-door
reg lookup** — every tenant with a key will generate billable lookups automatically, with
zero visibility until this is built.

---

## 2. Key advantage: VDGL gives us the real cost per call

The API response includes `billingInformation`:

| Field | Use |
|---|---|
| `transactionCost` | **Our actual cost for this lookup** (GBP) — record verbatim |
| `accountBalance` | Remaining VDGL credit — surface as a platform "credit remaining" gauge |
| `billingTransactionId` | Null when no billing occurred (cached/free) — use to know if a call was *actually* billed |
| `billingResult` / `billingResultMessage` | Audit / debugging |

So unlike AI (cost derived from tokens), we store the **exact** cost VDGL charged us. Sell
price is then a simple per-lookup markup we control.

---

## 3. Design — mirror the `ai_usage_logs` pattern

The AI-usage feature is the exact template (a paid per-call external API, logged per-org,
aggregated for super-admins, with a margin markup). Files to mirror:
`ai_usage_logs` table, write site in `routes/reasons/ai.ts`, read in `routes/admin/ai-usage.ts`,
margin in `routes/admin/usage.ts` (`getAiMarginPercent`, `chargeoutFactor`).

### 3.1 New per-call log table — `vehicle_data_lookups`

Migration `supabase/migrations/<ts>_vehicle_data_lookups.sql`:

```sql
CREATE TABLE IF NOT EXISTS vehicle_data_lookups (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid REFERENCES organizations(id) ON DELETE SET NULL, -- null = platform/admin test
  user_id                uuid REFERENCES users(id) ON DELETE SET NULL,
  registration           varchar(20),
  context                varchar(20) NOT NULL,   -- 'lookup' | 'create' | 'refresh' | 'admin_test'
  success                boolean NOT NULL DEFAULT false,
  found                  boolean NOT NULL DEFAULT false,
  billed                 boolean NOT NULL DEFAULT false, -- billingTransactionId present
  cost                   numeric(10,4),          -- our cost (transactionCost), GBP
  currency               varchar(3) DEFAULT 'GBP',
  billing_transaction_id varchar(64),
  response_id            varchar(64),            -- responseInformation.responseId (support)
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vdl_org_created ON vehicle_data_lookups(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vdl_created ON vehicle_data_lookups(created_at);
ALTER TABLE vehicle_data_lookups ENABLE ROW LEVEL SECURITY; -- service_role only, like ai_usage_logs
```

### 3.2 Capture billing from the API + write the log

- In `services/vehicle-details.ts`, extend `VehicleDetailsResult` (and the raw shape) to
  carry `billing: { transactionCost, accountBalance, billingTransactionId, billingResult }`
  and `responseId` — currently the mapper drops `billingInformation` entirely.
- Add `logVehicleDetailsUsage(orgId, userId, registration, context, result)` that inserts a
  `vehicle_data_lookups` row. Best-effort (log-and-continue), like `persistMotHistory`.
- **Where to log — exactly once per real API hit, never on the reuse path:**
  - `routes/vehicle-lookup.ts` (the merged front-door lookup) → `context='lookup'` after the
    VehicleDetails call. **This is the billed call.**
  - `routes/vehicles.ts` create → only logs when it actually *fetches* (the `passedDetails`
    reuse path does NOT bill and must NOT log). With the current merge, create reuses the
    lookup's result, so create normally logs nothing.
  - `routes/vehicles.ts` `vehicle-details-refresh` → `context='refresh'`.
  - `routes/admin/platform.ts` `vehicle-details/test` → `context='admin_test'`, `organization_id=null`.
- Guard against double-billing in reporting: a lookup that returns `billingTransactionId=null`
  (VDGL served it free/cached) is logged with `billed=false, cost=0` so counts stay honest.

### 3.3 Pricing config — the sell price

Add to `platform_settings.billing` (read in `routes/admin/usage.ts`, written in
`routes/admin/platform.ts`, mirroring `sms_unit_cost`):

| Key | Meaning |
|---|---|
| `vehicle_lookup_sell_price` | **What we charge a tenant per lookup** (GBP). The billable rate. |
| `vehicle_lookup_unit_cost` | Fallback our-cost when `transactionCost` is missing (optional; we prefer the real value). |

Billing maths (GBP-native — no USD→GBP needed, unlike AI):
- **Our cost** = `SUM(cost)` from the log (real VDGL charges).
- **Billable / sell** = `billed_count × vehicle_lookup_sell_price`.
- **Margin** = sell − cost.

> Decision needed: flat platform-wide sell price (simplest, recommended for v1) vs per-org
> sell price override (a `vehicle_lookup_sell_price` in `organization_settings`, like module
> overrides) vs plan-based inclusion (N free/month then £x). v1 = flat platform price; leave
> hooks for per-org/plan later.

### 3.4 Surface it in the admin Usage dashboard

- **Extend the `admin_usage_by_org` RPC** (new migration; `CREATE OR REPLACE`, keep
  service_role grant) with a `vdl` CTE → add `vehicle_lookups bigint`,
  `vehicle_lookups_billed bigint`, `vehicle_lookup_cost numeric` to the return table.
- **`routes/admin/usage.ts` `fetchUsageByOrg`**: read `vehicle_lookup_sell_price`; per org add
  `vehicleLookups`, `vehicleLookupCost` (our cost), `vehicleLookupSell` (billed × sell_price),
  `vehicleLookupMargin`. Add to `/usage/export` CSV columns + `sortOrgs`.
- **`apps/web/src/pages/Admin/AdminUsageDashboard.tsx`**: new columns "Vehicle lookups",
  "Cost", "Billable" (+ platform totals card). Mirror the existing AI cost columns.
- **Optional detail browser** — a `vehicle_data_lookups` log browser + CSV export mirroring
  `routes/admin/ai-usage.ts` (`/logs` paginated, `/export`) for line-by-line audit.

### 3.5 Billing-settings UI

Add a "Vehicle data lookup sell price (per lookup, GBP)" field to the **Billing** section of
`apps/web/src/pages/Admin/AdminSettings.tsx`, next to the SMS/email unit costs.

---

## 4. Optional follow-ons (not v1)

- **Credit-low alert**: surface VDGL `accountBalance`; mirror `ai_cost_alerts` to warn when
  platform credit runs low (a hard stop — if VDGL credit is exhausted, lookups fail).
- **Per-org monthly cap** mirroring `organization_ai_settings.monthly_generation_limit`.
- **Per-org / per-plan sell pricing** (see §3.3 decision).
- **Tenant-facing usage view** so an org admin sees their own lookup spend.

---

## 5. Build order

1. Migration: `vehicle_data_lookups` table.
2. Service: capture `billingInformation`/`responseId` + `logVehicleDetailsUsage` helper.
3. Wire logging into the 4 call sites (lookup / refresh / admin_test / create-fetch only).
4. Pricing config: `vehicle_lookup_sell_price` in platform_settings.billing (GET/PATCH + UI).
5. Extend `admin_usage_by_org` RPC (new migration) + `fetchUsageByOrg` + dashboard columns + CSV.
6. (Optional) detail log browser + credit-low alert.

---

## 6. Open decisions for sign-off

1. **Sell-price model:** flat platform price (v1) / per-org override / plan-based inclusion?
2. **What's the sell price?** (VDGL cost is £0.04–0.15/lookup by credit tier — e.g. sell at £0.20–0.50?)
3. **Detail log browser** — build now or defer?
4. **Credit-low alert** — build now or defer?
