# VHC — Groups, Sites & Per-Site Separation

> Status: **Draft v1 (decision brief).** Author: Principal Eng + Product. Date: 2026-06-30.
> Owner decisions captured 2026-06-30 (see §2). Build NOT started — this is the plan for reaction.
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

### 4.1 Schema
```sql
-- vehicles gains a site dimension (customers already have nullable site_id)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_site ON vehicles(site_id);

-- per-tenant toggle (default OFF = separated, per decision A)
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS share_customers_across_sites BOOLEAN DEFAULT false;
```

### 4.2 The scope helper (the core of the change)
A single helper decides the filter; every customer/vehicle read goes through it:
```typescript
// resolves to {organization_id} when sharing ON, {organization_id, site_id} when OFF
function customerScope(auth: AuthContext, settings: OrgSettings) {
  return settings.share_customers_across_sites
    ? { organization_id: auth.orgId }
    : { organization_id: auth.orgId, site_id: auth.user.siteId }
}
```
Apply at every customer/vehicle **read** surface: customer book/search, vehicle lookup, reminders, follow-up case matching, booking pre-check, DMS import dedup. On **create**, stamp `site_id = current site`.

### 4.3 ⚠️ Migration safety (no destructive backfill)
- The toggle changes **query behaviour only**. No data is moved or deleted.
- **`organization_settings` rows are created lazily** (a `DEFAULT false` column does **not** reach row-less orgs — same gotcha as `TECH_JOB_MODEL.md` §C3). So the *effective* default must be resolved in code, not relied on from the column.
- **Existing multi-site orgs currently see customers org-wide.** Flipping them to "separated" would hide records. Resolution: **effective default = `true` (shared) for orgs that predate this migration; `false` (separated) for new orgs.** Implement via a one-row-per-existing-org seed of `share_customers_across_sites = true`, OR a `created_at` cutoff check. New orgs get the column default (`false`).
- Single-site orgs are unaffected either way.
- Populate `vehicles.site_id` **lazily/forward** (on next touch, or from the linked customer's / latest health-check's site) — **no bulk UPDATE** that could thrash the table. Never reset.

---

## 5. Workstream 2 — Site-level branding (Phase 1)

Branding currently resolves org-wide from `organization_settings` (the `getOrganizationBranding` source-of-truth, memory `org-branding-source-of-truth`). Move to **site override on org default**:

- `sites` already has `phone`, `email`, and a `settings` JSONB — add structured branding to the site (logo URL, primary colour, from-name, reply-to) either as columns or in `settings`.
- `getOrganizationBranding(orgId, siteId?)` → **resolve site value, fall back to org value, fall back to platform default.** Single resolver, used by: customer-facing VHC report, quotes/estimates, outbound SMS/email from-name & signature, PDF headers.
- Every outbound comm and customer-facing doc must pass the **site** of the job, not just the org.

---

## 6. Workstream 3 — Site-comparison reporting (Phase 1)

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

---

## 8. Build order

**Phase 1 — Site separation (most tenants benefit, stays inside the org wall):**
1. `vehicles.site_id` + `share_customers_across_sites` setting + `customerScope` helper wired through all customer/vehicle reads & creates (§4).
2. Site-level branding resolver (§5).
3. Per-site comparison reporting (§6).

**Phase 2 — Group layer (additive, inert for single-entity tenants):**
4. `groups` + `organizations.group_id` (§7.1).
5. Group-admin access via existing multi-org membership (§7.2).
6. Cross-org → per-site group rollup reporting (§7.3).

Phase 1 is the bulk of the value and carries the only real migration risk (§4.3). Phase 2 is purely additive.

---

## 9. Open items / risks

- **R1 — Read-surface sweep is wide.** `customerScope` must reach *every* place customers/vehicles are read (search, reminders, follow-ups, DMS dedup, booking pre-check). A missed surface leaks across sites within an org. Enumerate before building.
- **R2 — No site-level RLS.** Separation stays app-enforced. If a tenant needs hard customer isolation between sites (e.g. separate GDPR controllers), the only DB-enforced wall is the **org** — which is the argument for modelling those as separate orgs under a group (§E).
- **R3 — DMS import** writes customers/vehicles; its config is already site-scoped (`20260115000001_dms_integration.sql:59`). Imported rows must stamp `site_id` and dedup within the active scope.
- **R4 — Effective-default resolution** for `share_customers_across_sites` must be code-resolved (lazy `organization_settings` rows), with existing multi-site orgs defaulting to shared to avoid hiding data (§4.3).
- **R5 — Subscription/billing for groups.** Out of scope here: do you bill a group as one account or per-org? Org stays the subscription holder for now; group billing is a later question.
