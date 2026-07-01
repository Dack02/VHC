# VHC — Groups, Sites & Per-Site Separation

> Status: **Phase 1 BUILT (steps 1–6), typecheck + production-build clean, UNCOMMITTED, migration NOT deployed.** Author: Principal Eng + Product. Date: 2026-06-30.
> Owner decisions captured 2026-06-30 (see §2). Built: migration `20260702110000_groups_sites_phase1.sql`; create-path stamping; provisioning default; `lib/site-scope.ts` + read sweep; settings toggle + readiness endpoints + Site Management UI; site-aware `getOrganizationBranding` + site branding columns/UI + estimate-path threading; super-admin Groups in-app help (`AdminGroups.tsx`). **Remaining:** VHC SMS/email branding thread (zero-regression follow-up), inbound-SMS/messages site tiebreaker (deferred-delicate), 🟡 parent-inherit audit, §6 reporting (owner-deferred), §7 group layer (Phase 2). **Functional e2e is gated on deploying the migration (commit + push to dev).**
> Builds on: the existing `sites` table (`supabase/migrations/20240114000000_initial_schema.sql:47`), multi-org auth (`supabase/migrations/20260130200000_multi_org_support.sql`, `apps/api/src/middleware/auth.ts`), super-admin cross-org reporting, and the org-branding source-of-truth fix (`organization_settings`, see memory `org-branding-source-of-truth`).

---

## 1. Problem & Vision

A tenant may run **multiple sites** that must feel like **separate businesses** — own branding, address, phone, email, technicians, **and own customer/vehicle book** — yet the owner wants **group-level reporting** to compare Site 1 vs Site 2 vs Site 3. Those sites may be the **same legal entity** (one Ltd, multiple branches) or **separate legal entities** (a group of Ltds).

Today the platform has exactly two tiers that matter:

- **`organization`** — the hard wall. Enforced by org-level RLS (`initial_schema.sql:455`) and filtered on virtually every query (~736 `.eq('organization_id', …)` vs ~66 `.eq('site_id', …)`). Owns the **shared services & accounting boundary**: subscription/billing (`organization_subscriptions`), Xero/VAT/invoice sequences, parts catalogue (`parts_catalog`), pricing matrix, suppliers, labour codes, **and the customer/vehicle pool**.
- **`site`** — a soft, app-enforced partition over the **operational/workshop layer** (`health_checks`, workshop board, technician shifts, staff notifications all carry a NOT-NULL `site_id`). There is **no site-level RLS** — site separation is whatever query code remembers to filter.

Two gaps block the vision:

1. **Customers & vehicles are org-wide, not site-separable.** `customers.site_id` exists but is nullable and only optionally filtered; **`vehicles` has no `site_id` at all** (`initial_schema.sql:101`). So two sites can't keep separate customer books today.
2. **No group layer.** Comparing *separate legal entities* (= separate orgs) has no first-class home; only super-admins can see cross-org, and there's no "owner of these 3 orgs" concept.

---

## 2. Resolved decisions (owner, 2026-06-30)

| # | Fork | Decision | Implication |
|---|---|---|---|
| **A** | Customer/vehicle separation | **Separated per site by default; per-tenant share toggle** | `site_id` becomes the scope unit for customers + vehicles; an org setting flips between site-scoped and org-wide. |
| **B** | Vehicle scope | **Vehicles follow the customer toggle** | A vehicle belongs to a customer, so they scope together under one setting — never split. |
| **C** | Branding | **Site-level (override on org default)** | Logo/colour/from-name/phone/email resolved per site; org provides the fallback. |
| **D** | Reporting unit | **Site is the comparison unit; org & group are rollup levels** | One report compares sites; rolls up to org, orgs roll up to group. |
| **E** | Legal entity mapping | **One org per legal/accounting entity; group spans orgs** | Same-Ltd-branches = 1 org / N sites. Separate Ltds = N orgs / 1 group. Org stays the Xero/VAT/billing wall. |
| **F** | Separation strength for separate Ltds | **Separate orgs (hard RLS wall) — never soft sites** | Separate legal entities = separate data controllers → never share a customer book across a soft site boundary. The DB-enforced org wall is the GDPR boundary. Resolves R2. |
| **G** | Tenant mix | **Both kinds exist → build the full three-tier model, configured per tenant** | Phase 1 (per-site toggle) and Phase 2 (group layer) are both required; neither is optional. |
| **H** | Group billing | **Per-org subscription (today's model); group is reporting-only** | No group-billing concept. Each entity invoiced separately. Resolves R5. |
| **I** | Group setup | **Super-admin-only; auto-create owner membership in each member org** | Groups live in the platform admin app (not tenant settings); naming the group owner auto-provisions an `org_admin` `users` row per member org. Consent/audit step deferred (not now). See §7.4. |

---

## 3. Target hierarchy

```
group                      ← NEW: ownership / reporting umbrella (spans legal entities)
  └─ organization          ← unchanged hard wall: Xero, VAT, billing, catalogue, pricing, suppliers
       └─ site             ← the operating business: branding, contact, technicians, customers, jobs
            ├─ customers    (NEW site_id scoping + share toggle)
            ├─ vehicles     (NEW site_id — column added)
            ├─ health_checks / jobsheets / workshop board / shifts   (already site-scoped)
            └─ branding      (NEW site-level override)
```

**Mapping rule (setup-time choice):**

| Sites are… | Model | Why |
|---|---|---|
| One Ltd / one set of accounts (branches share catalogue, pricing, Xero, VAT, billing) | **1 org, N sites** + customer-share toggle | Site comparison is free; shared services live at org |
| Separate Ltds (separate Xero, VAT, invoice sequences, billing) | **N orgs (1+ site each), joined by 1 group** | Keeps the accounting wall where the platform enforces it |

The three-tier model **subsumes** two-tier: a separate-entity tenant is just `group_id` over N single-site orgs.

---

## 4. Workstream 1 — Per-site customer/vehicle separation (Phase 1)

### 4.1 Schema — migration `YYYYMMDDHHMMSS_groups_sites_phase1.sql`

> Timestamp must sort **after** the latest applied migration (currently the `2026070114*`/`16*` batch — confirm before naming, per the parts-module gotcha). Use `IF NOT EXISTS` throughout (rules.md).

```sql
-- 1. vehicles gains a site dimension (customers already have nullable site_id from initial_schema)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_site ON vehicles(site_id);

-- 2. per-tenant toggle.
--    DEFAULT true = SHARED is the SAFE default: any lazily-created settings row, and every
--    existing org, stays org-wide (today's behaviour) and never silently hides customers.
--    NEW orgs are flipped to separated in the provisioning path (§4.3), not by the column default.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS share_customers_across_sites BOOLEAN NOT NULL DEFAULT true;
```

**Why `vehicles.site_id` and not derive-via-customer?** A vehicle can change owner (`vehicle_customer_links`, ownership history) and DMS already *tries* to write `vehicles.site_id` (`dms.ts:211,244` — latent today). A real column is simpler than deriving site through the current-owner link on every read, and makes the scope helper uniform across both tables. Vehicles scope **with** customers (decision B) — one toggle governs both.

### 4.2 The scope helper — `apps/api/src/lib/site-scope.ts` (NEW)

There is **no shared org-settings loader** today (every route reads `organization_settings` inline via `.select(col).eq('organization_id', orgId).maybeSingle()` — e.g. `jobsheets.ts:1614`). Model this helper on `services/follow-up-settings.ts:25` (`getFollowUpSettings`).

```typescript
export type ScopeMode = 'shared' | 'separated'

// 'separated' ONLY when the flag is explicitly false. true / null / missing-row → 'shared' (safe).
export async function getCustomerScopeMode(orgId: string): Promise<ScopeMode> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('share_customers_across_sites')
    .eq('organization_id', orgId)
    .maybeSingle()
  return data?.share_customers_across_sites === false ? 'separated' : 'shared'
}

// Apply to any customers/vehicles query builder. Org filter ALWAYS; site filter only when
// separated AND the caller is a site-bound user.
export function applyCustomerScope<Q extends { eq(col: string, val: unknown): Q }>(
  q: Q, auth: AuthContext, mode: ScopeMode,
): Q {
  q = q.eq('organization_id', auth.orgId)
  if (mode === 'separated' && auth.user.siteId) q = q.eq('site_id', auth.user.siteId)
  return q
}
```

**Two rules baked in (both load-bearing):**
1. **`auth.user.siteId` is nullable** (`middleware/auth.ts:13` — org/site admins often have no site). A separated org's org-admin (no site) therefore reads **org-wide** — correct: oversight roles see all sites; only site-bound users (`technician`/`service_advisor`/`site_admin` with a `site_id`) are confined. State this explicitly in the settings UI so it isn't read as a leak.
2. **Separated requires an explicit `false`.** Never treat a missing settings row as separated, or lazy-row orgs would hide their own customers.

For hot endpoints (customer search-as-you-type), call `getCustomerScopeMode(orgId)` **once** per request and pass the `mode` into each query; optionally add a small TTL cache keyed by orgId (mirror `services/ai-reasons.ts:53` 5-min cache) to avoid a settings read per keystroke. Invalidate on settings PATCH.

### 4.3 ⚠️ Rollout safety (no destructive backfill)
- The toggle changes **query behaviour only**. No data is moved or deleted (honours rules.md).
- **`organization_settings` rows are created lazily** — a column DEFAULT does **not** reach row-less orgs (same gotcha as `TECH_JOB_MODEL.md` §C3). Handled by the **`=== false`** read semantics (§4.2): anything that isn't an explicit `false` is treated as shared.
- **Existing orgs stay SHARED.** `DEFAULT true` + the `=== false` read means **no existing org changes behaviour** — single-site or multi-site — until someone deliberately turns separation on. This is the whole point of inverting the column default vs decision A's "separated by default."
- **New orgs default to separated** via the provisioning path (`services/provisioning.ts`, which seeds the org's `organization_settings` row): set `share_customers_across_sites: false` there. New tenants get decision-A behaviour; nobody live gets surprised.
- **`vehicles.site_id` is populated forward-only.** Stamp on create (§4.5); for existing rows, backfill **lazily** (on next touch) from the current-owner link's `customers.site_id` or the latest `health_checks.site_id`. **No bulk `UPDATE`** that could thrash the table; never reset. Until a vehicle is stamped, a *separated* read won't see it — acceptable because separation is opt-in and the org chooses when to flip it (after backfill has warmed, or accepting lazy warm-up).

### 4.4b Pre-flip readiness (operational gate)
Before a tenant flips to separated, surface a one-shot **readiness check** (admin action, read-only): count customers/vehicles with `site_id IS NULL` for that org. If non-zero, warn that those records won't appear under separation until stamped, and offer (a) assign-to-site bulk action, or (b) proceed accepting lazy warm-up. This turns the silent-empty-read failure mode into an explicit, owner-controlled step.

---

### 4.4 R1 read-surface checklist (the `customerScope` sweep)

Enumerated against the live tree (2026-06-30). Tenant isolation is enforced **only** by explicit `.eq('organization_id', …)` — RLS is defence-in-depth, so **every** site filter must be added in app code. Three tiers:

- **🔴 MUST-FIX (direct org-only read → leaks across sites when separation ON).** These query `customers`/`vehicles` directly, filtering org only. Route through `customerScope()`.
- **🟡 INHERITS PARENT** — a PostgREST embed (`customer:customers(...)` / `vehicle:vehicles(...)`) hanging off an already org/site-filtered `health_checks`/`jobsheets`/`estimates`. Safe **iff** the parent is correctly site-scoped — audit the parent, not the embed. Bulk of reports/dashboards fall here.
- **🟢 NO ACTION** — token-scoped public routes (one record by `public_token`) and pure id-scoped reads from a parent row that already carries the site.

**🔴 MUST-FIX — direct org-only customer/vehicle reads:**
- [ ] `lib/list-search.ts:24-35` — `buildDocumentSearchOr` resolves customer **and** vehicle ids for jobsheet (`jobsheets.ts:334`) + estimate (`estimates.ts:140`) list search. Highest-traffic surface.
- [ ] `routes/customers.ts:98` list (+ `:113` reg sub-search), `:207` quick search, `:386` stats vehicle-count (id-only, no org!), `:510` `GET /:id`.
- [ ] `routes/vehicles.ts` — **entire module is org-only** (vehicles has no `site_id` yet): `:127` list, `:208` `GET /lookup/:registration`, plus every other by-id/by-customer read.
- [ ] `jobs/dms-import.ts:104-295` — customer dedup by external_id/email/mobile + vehicle dedup by external_id/reg/VIN. **Primary dedup leak**: HC create already carries `siteId` but the dedup above ignores site, so a site-B import can attach a site-A customer/vehicle.
- [ ] `routes/dms.ts:73-357` — external DMS push API (`/customers`, `/vehicles`, `/batch`) same dedup-by-external_id/reg, org-only.
- [ ] `services/expiry-reminders.ts:67` → RPC `expiry_campaign_audience` (`20260628140000_vehicles_module.sql:308`) — joins vehicles/customers filtered **org only**. Needs a `p_site` param + `site_id` filter. Reminder audiences are currently org-wide.
- [ ] `routes/follow-ups.ts:261-273` — case-search customer/vehicle id-resolve (org only; the case list itself honours site but this id-resolve doesn't).
- [ ] `services/inbound-sms.ts:126-131` `findCustomerMatches` + `routes/messages.ts:362` & `:463` customer-by-phone — org-only phone match; needs site disambiguation when ON. (Inbound SMS is intentionally cross-org for shared-number routing — see [[inbound-sms-tenant-routing-initiative]]; add site as a tiebreaker, don't break that.)

**🟡 INHERITS PARENT — verify the parent is site-scoped (no change to the embed):**
- [ ] Reports/dashboards: `reports.ts` (`:295, 630, 822, 1935, 2466, 2726, 4069, 4356`), `services/*-report-service.ts`, `dashboard*.ts`, `arrivals.ts`, `workshop-board.ts`, `worker.ts`, `scheduler.ts`, `estimate-send.ts`, `dms-booking-detail.ts`, `pdf-generator/*`.
- [ ] HC/jobsheet/estimate detail embeds: `health-checks/crud.ts`, `status.ts`, `pdf.ts`, `send-customer.ts`, `reopen.ts`, `jobsheets.ts:29`, `estimates.ts:33`, `sms-conversations.ts:87`.
- [ ] `services/customer-insights.ts:46-81` — org + customer/vehicle-id scoped (inherits site from the caller's customer).

**🟢 NO ACTION (confirmed safe):**
- [ ] `routes/public.ts`, `routes/public-estimate.ts` — token-scoped; no public customer/vehicle **search** exists.
- [ ] Pure id-scoped reads off a site-carrying parent: `messages.ts:134/285`, `inbound-sms.ts:494`, `follow-up-engine.ts:493-496`.

### 4.5 Create-path stamping checklist (every write must set the site)

A separated read returns nothing for a row whose `site_id` is NULL, so **every** customer/vehicle insert must stamp the active site. Current state (verified 2026-06-30):

**Customers — `customers.site_id` exists:**
- [x] `routes/customers.ts:252` — `site_id: siteId || auth.user.siteId` **already set**. (CustomerFormModal sends `siteId` on create — `CustomerFormModal.tsx:273`.) ✅
- [x] `routes/dms.ts:108` (single upsert) — sets `site_id: siteId` from `sites.settings->external_id`. ✅
- [ ] **`jobs/dms-import.ts:179-197`** (`findOrCreateCustomer` insert) — **omits `site_id`**. Add: the import already resolves a site for `createHealthCheck`; thread that `siteId` into the customer insert.
- [ ] **`routes/dms.ts:318-328`** (bulk-import branch) — **omits `site_id`**. Add `site_id: siteId`.

**Vehicles — `site_id` column added by this migration (§4.1):**
- [ ] **`routes/vehicles.ts:414-427`** (`vehicles.post('/')`) — add `site_id: auth.user.siteId` (or derive from the linked customer's site when `customerId` given, so vehicle and owner agree).
- [ ] **`jobs/dms-import.ts:326-340`** (`findOrCreateVehicle`) — add `site_id: siteId`.
- [x] **`routes/dms.ts:244`** (single upsert) — already writes `site_id: siteId` (latent today; **becomes live** once the column exists — verify it's the *intended* site, not stale). `:211` update branch too.
- [ ] **`routes/dms.ts:381-394`** (bulk branch) — **omits `site_id`**. Add `site_id: siteId`.

> Decision B (vehicle follows customer): when a vehicle is created against a known `customer_id`, prefer **the customer's `site_id`** over the actor's `auth.user.siteId`, so an owner and their car never split across sites.

### 4.6 The `expiry_campaign_audience` RPC (site-aware)
The audience function (`20260628140000_vehicles_module.sql:308`) filters `e.organization_id = p_org` only. It **joins `customers c`**, and `customers` has `site_id`, so the site filter rides on the customer:
```sql
-- new nullable param, backward-compatible: NULL p_site behaves exactly as today
CREATE OR REPLACE FUNCTION expiry_campaign_audience(p_org UUID, p_type_code TEXT, p_lead_days INT, p_site UUID DEFAULT NULL)
... WHERE e.organization_id = p_org
    AND (p_site IS NULL OR c.site_id = p_site)
    ...
```
Adding a defaulted param keeps the old 3-arg signature callable (Postgres treats the 4-arg as the same callable when the 4th is defaulted — but if a stale 3-arg overload lingers, `DROP FUNCTION expiry_campaign_audience(UUID, TEXT, INT)` first to avoid ambiguity). Caller `services/expiry-reminders.ts:67` passes `p_site` resolved from the campaign's site (campaigns are site-scoped) — only when the org is separated; pass `NULL` when shared.

---

## 5. Workstream 2 — Site-level branding (Phase 1)

Branding resolves org-wide today via **`getOrganizationBranding(organizationId)`** (`apps/api/src/services/email.ts:440`) — it reads `organizations.name` + `organization_settings(logo_url, primary_color, phone, email, website)` and has **9 functional call sites, no cache**. The `sites` table has `name`, `address`, `phone`, `email`, `settings` JSONB, `is_active` — **contact fields but no branding columns**. Move to **site override on org default**.

### 5.1 Schema
```sql
ALTER TABLE sites ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS primary_color VARCHAR(9);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS website VARCHAR(255);
-- display name = sites.name (exists); from-phone/email = sites.phone/email (exist)
```

### 5.2 Signature & resolution
`getOrganizationBranding(organizationId, siteId?: string | null)` — resolve **field-by-field**: site value → org value → platform default. Keep the existing return shape (`{ logoUrl, primaryColor, organizationName, phone, email, website }`) so callers don't change shape:
- `organizationName` → `site.name ?? organizations.name`
- `logoUrl` → `site.logo_url ?? org_settings.logo_url`
- `primaryColor` → `site.primary_color ?? org_settings.primary_color ?? '#3B82F6'`
- `phone`/`email`/`website` → site value ?? org value
- When `siteId` is null/absent, behaviour is **identical to today** (org-only) — zero-regression for single-site orgs.

### 5.3 Call-site checklist (thread the job's site into branding)
Each caller must pass the `site_id` of the record the comm is about (health_check / estimate / follow-up case all carry `site_id`):
- [ ] `services/sms.ts:196, 238, 279` — 3 SMS builders. Source site from the HC/estimate being messaged.
- [ ] `services/email.ts:241, 311, 378, 508, 647` — VHC/response-notification emails.
- [ ] `services/expiry-reminders.ts:163` — pass the campaign's site.
- [ ] `services/follow-up-engine.ts:499, 1128` — pass the case's site.
- [ ] `services/estimate-send.ts:100` — pass the estimate's site.
- [ ] `routes/public-estimate.ts:130` — pass the estimate's site (public, token-resolved record already has it).
- [ ] `services/library-gap-report.ts:463` — org-level internal report; **pass `null`** (no site → org branding). Confirm it's not customer-facing.

> Migration note: `getOrganizationBranding` is the `org-branding-source-of-truth` fix ([[org-branding-source-of-truth]]) — it already reads the *correct* `organization_settings` table (not the dead `organizations.settings` JSON). Site-level is a strict superset; don't reintroduce the old dead-column read.

---

## 6. Workstream 3 — Site-comparison reporting (Phase 1) — ⏸ DEFERRED (owner, 2026-06-30)

> Build the separation + branding core first (§4–§5); return to reporting after. Sketch retained below.

Reports today resolve to **one** site via `resolveSiteId()` (`apps/api/src/routes/workshop-board.ts:83`) — single-site or org-wide. Add a **group-by-site** dimension:

- New report scope: `all sites` within the org, returning **per-site rows** for side-by-side comparison (efficiency, conversion, £ authorised, throughput).
- Respect PostgREST's 1000-row cap (memory `postgrest-row-cap`) — **aggregate in the DB / RPC**, don't fetch-and-group in JS.
- This alone delivers "compare Site 1 vs 2 vs 3" for any single-org multi-site tenant — **no group layer required.**

---

## 7. Workstream 4 — The Group layer (Phase 2, multi-entity only)

Only tenants whose sites are **separate legal entities** (= separate orgs) need this. Inert for everyone else.

### 7.1 Schema
```sql
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_group ON organizations(group_id);
```

### 7.2 Group admin & access
- **Reuse the existing multi-org membership.** `UNIQUE(auth_id, organization_id)` already lets one login hold a `users` row per org (`20260130200000_multi_org_support.sql`); `/auth/switch-org` already switches active org. The group owner simply has membership in each org of the group.
- Add a **group-admin** marker (a `group_members(auth_id, group_id, role)` table, or a flag) granting **cross-org read for reporting** within the group — *not* a new cross-org data wall bypass for operational writes.

### 7.3 Group reporting
- **Generalise the existing super-admin cross-org aggregation** to "orgs where `group_id = X`."
- Because the comparison unit is the **site** (§D), the group report is just the §6 per-site report widened across all orgs in the group → **every site under the group, side by side, rolling up to org and to group totals.**

### 7.4 Setting up a group (super-admin flow)

Group creation is a **super-admin-only** operation (decision I) — it grants cross-org visibility, so it lives in the platform admin app, not in any single tenant's settings.

**7.4.1 Schema addition (group membership marker)**
```sql
CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  auth_id UUID NOT NULL,                      -- the owner's Supabase auth id (matches users.auth_id)
  role VARCHAR(30) NOT NULL DEFAULT 'group_admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, auth_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_auth ON group_members(auth_id);
```
- An org belongs to **at most one** group (`organizations.group_id` is a single nullable FK — §7.1).
- `group_members` grants the **cross-org reporting rollup**; the owner's actual per-org access is the `users` row auto-created in each member org (7.4.3).

**7.4.2 Super-admin runbook (the 5 steps)**
1. **Each legal entity exists as its own org** — normal onboarding per Ltd (own subscription, Xero, branding). Pre-requisite, not a group step.
2. **Create the group** — Admin app → *Groups* → *Create group* → name (e.g. "Smith Motor Group"). Inserts a `groups` row.
3. **Add member organizations** — in the group detail screen, add each entity. Sets `organizations.group_id`. The org picker only offers orgs **not already in a group**.
4. **Assign the group admin** — enter the owner's email. The system **auto-creates an `org_admin` `users` row in every member org** for that `auth_id` (reusing the multi-org model — they may already have one in some) **and** a `group_members` row (decision: auto, Q2-A). One action → access to all entities.
5. **Hand over** — the owner logs in, uses the existing org switcher (`/auth/switch-org`) to move between entities, and opens **Group Reporting** for the cross-entity rollup.

**7.4.3 Auto-provisioning detail (step 4)**
- For each member org, upsert a `users` row keyed on `(auth_id, organization_id)` with `role = 'org_admin'`, `is_active = true`, `site_id = NULL` (group owners are org-level, so they read **org-wide** under separation per §4.2 rule 1 — they see every site, which is exactly what a group owner wants).
- Idempotent: if the owner already has a membership in an org, leave it (don't downgrade an existing role).
- **Removing an org from a group**: clear `group_id` only. Leave the owner's `users` row in place (removing it is destructive and reversible only by re-invite) — just drop it from the rollup. Flag for later: optional "also revoke my access to this entity" toggle.

**7.4.4 Admin-app screens (super-admin panel)**
Adds a *Groups* area alongside the existing *Organizations* section of the super-admin panel (the `admin-panel-enhancement` build):
- **Groups list** — name · # entities · # sites · group admin · *Create group*.
- **Group detail** —
  - *Member organizations*: add/remove (the org picker excludes orgs already grouped); each row links to that org's existing admin detail.
  - *Group admin*: email field → auto-provision (7.4.3); shows which orgs the owner now has access to.
  - *Open group reporting* (Phase-2 §7.3).
- **Org detail (existing screen)** — show a **"Group: ‹name›"** badge with a link, and a *Detach from group* action.

> Build note: this is Phase 2 — none of it exists yet (no `groups`/`group_members` tables, no Groups screen). It is specced here so the admin-app work is ready when Phase 1 lands.

---

## 8. Build order

**Phase 1 — Site separation (most tenants benefit, stays inside the org wall).** Order matters — the writes and the safe default must land before any read is allowed to filter by site:

1. ✅ **Migration** (§4.1): `vehicles.site_id` + index; `organization_settings.share_customers_across_sites BOOLEAN NOT NULL DEFAULT true`; site branding columns (§5.1); `expiry_campaign_audience` `p_site` param (§4.6). → `20260702110000_groups_sites_phase1.sql`. **Not yet deployed.**
2. ✅ **Create-path stamping** (§4.5): `site_id` wired into `dms-import.ts` (customer + vehicle, incl. site-scoped dedup when separated), `vehicles.ts` create (follows owner site), `dms.ts` batch vehicle (follows customer site). Manual customers.ts already stamped. *(dms.ts batch customer has no site source — stays NULL, caught by §4.4b.)*
3. ✅ **Provisioning default** (§4.3): `provisioning.ts` sets `share_customers_across_sites: false` for new orgs; existing untouched.
4. ✅ **Scope helper + read sweep** (§4.2 + §4.4): `lib/site-scope.ts` (`getCustomerScopeMode` / `scopedSiteId` / `resolveCustomerScope`); inline scope applied to list-search (jobsheets+estimates), customers list/quick-search/detail (+ org-fix on stats vehicle-count), follow-ups case-search, expiry RPC `p_site` plumbing. No-op until an org is flipped to separated. *(🟡 parent-inherit audit + inbound-SMS/messages tiebreaker still TODO.)*
5. ✅ **Settings UI + pre-flip readiness** (§4.4b): `GET/PATCH /organizations/:id/customer-separation` (toggle + readiness counts of null-`site_id` customers/vehicles); toggle card on **Site Management** (shows when >1 active site) with the readiness warning + the org-admin-sees-all-sites note.
6. ◑ **Site-level branding** (§5): resolver `getOrganizationBranding(orgId, siteId?)` (site→org→default), site branding columns + GET/PATCH on `sites` + branding sub-row on Site Management edit. **Threaded** at the customer-facing estimate paths (`public-estimate.ts`, `estimate-send.ts`). **NOT yet threaded** (org-branding fallback, zero-regression): the VHC SMS/email sender chains (`sms.ts` ×3, `email.ts` ×5 — take `organizationId`, need a `siteId` param threaded from `worker.ts`/`status.ts` callers) and `follow-up-engine.ts`/`expiry-reminders.ts`/`library-gap-report.ts`. Tracked as the branding follow-up.
7. *(Reporting — §6 — deferred per owner.)*

**All of steps 1–6 (minus the VHC-comms branding thread) + the in-app Groups help are built; both apps typecheck-clean AND production-build clean; uncommitted; migration NOT deployed.**

**Phase 2 — Group layer (additive, inert for single-entity tenants):**
4. `groups` + `organizations.group_id` + `group_members` (§7.1, §7.4.1).
5. Super-admin *Groups* admin-app screens + the auto-provisioning flow (§7.4) — create group, add orgs, assign group admin.
6. Group-admin access via existing multi-org membership + `/auth/switch-org` (§7.2).
7. Cross-org → per-site group rollup reporting (§7.3).

Phase 1 is the bulk of the value and carries the only real migration risk (§4.3). Phase 2 is purely additive.

---

## 9. Open items / risks

- **R1 — RESOLVED (enumerated, §4.4).** Full read-surface audit done 2026-06-30. ~8 🔴 must-fix direct org-only reads (list-search, customers, vehicles module, DMS dedup ×2, expiry-reminder RPC, follow-up search, inbound-SMS/messages phone match); the rest are 🟡 embeds that inherit a site-scoped parent (verify parent) or 🟢 token/id-scoped. The DMS dedup paths and the `expiry_campaign_audience` RPC are the subtle ones — they silently cross sites today.
- **R2 — RESOLVED (decision F).** Site separation is intentionally soft (app-enforced) and is used **only between branches of one legal entity**. Separate legal entities are modelled as **separate orgs** under a group, where org-level RLS gives the hard, GDPR-grade wall. The soft toggle never crosses a legal boundary.
- **R3 — DMS import** writes customers/vehicles; its config is already site-scoped (`20260115000001_dms_integration.sql:59`). Imported rows must stamp `site_id` and dedup within the active scope.
- **R4 — RESOLVED (design, §4.2/§4.3).** Lazy-row hazard handled by inverting the column default: `DEFAULT true` (shared) + read semantics "separated **only** when explicitly `false`." Existing orgs never change behaviour; new orgs are flipped to separated in provisioning. No code path can silently hide a row.
- **R6 — `auth.user.siteId` is nullable.** Org/site-admin users with no `site_id` read **org-wide** even when separated (oversight). This is intended (§4.2 rule 1) but must be stated in the settings UI so it's not mistaken for a leak. A site-bound user is the only one confined to a site.
- **R7 — Branding call-site coverage (§5.3).** 9 callers must each source the *job's* site; a missed caller silently falls back to org branding (degraded, not broken). Lower severity than R1 but enumerate-and-tick.
- **R5 — RESOLVED (decision H).** Billing stays **per-org** — each legal entity keeps its own subscription. The group is **reporting-only** and holds no billing concept. No subscription-model changes required.
