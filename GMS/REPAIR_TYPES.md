# GMS — Repair Types + Main Booking Requirement (Plan)

> Branch: work on `dev` · Status: **PLANNED (build not started)** · Author: Leo + Claude · Date: 2026-06-25
> Companion to [`JOBSHEET.md`](./JOBSHEET.md), [`WORK_DETAILS.md`](./WORK_DETAILS.md), [`ESTIMATES.md`](./ESTIMATES.md).

## 0. TL;DR

Introduce a **Repair Type** — an org-configurable classification chosen **per work group** when pricing
(Clutch, Suspension, Service, MOT, Diagnostic…). It **drives the labour rate** (each Repair Type points
at a labour code), becomes the backbone of new **revenue/mix reporting** (by repair type, sliced by
vehicle brand/fuel), and later will anchor **parts pricing** (and, with it, true-margin reporting).
Separately, the existing jobsheet
**"Service Type" is relabelled "Main Booking Requirement"** (the single main reason the car is in).

Because a work group is already a polymorphic `repair_items` row shared by VHC / Jobsheet / Estimate,
**one new column `repair_items.repair_type_id` gives Repair Type to all three documents at once.** This is
mostly additive + UI; the one behavioural change is making the labour rate derive from the Repair Type.

## 1. Locked decisions (Leo, 2026-06-25)

1. ✅ **Main Booking Requirement = UI rename only.** Keep the `service_types` table + `jobsheets.service_type_id`
   column; change visible labels only. No risky DB rename.
2. ✅ **Repair Type = a NEW separate lookup** (`repair_types`), not a reuse of `service_types`,
   `labour_codes`, or `reason_types`. Distinct concept, distinct list (see §2).
3. ✅ **Repair Type lives on the work group** (`repair_items.repair_type_id`), settable on the group header
   and inheritable by children; available to VHC, Jobsheet, and Estimate via the one shared column.
4. ✅ **Labour is LOCKED to the Repair Type.** The group's labour rate comes from
   `repair_type → default_labour_code`; the per-line labour-code selector is hidden. A group must have a
   Repair Type **before labour can be added** (parts-only / empty groups may stay untyped). Mixed work
   (e.g. MOT + repair) splits into separate groups — which also keeps MOT VAT-exemption correct.
5. ✅ **VHC default derivation: template-driven, advisor-overridable.** A check item carries a default
   Repair Type (`template_items.repair_type_id`); when an advisor builds a work group from findings, the
   type is pre-filled from the linked items (heuristic) and can be overridden at pricing.
6. ✅ **Reporting scope:** revenue/conversion per Repair Type **+** vehicle brand/fuel slicing.
   **TRUE MARGIN is DEFERRED** (Leo, 2026-06-25) until the **Parts module** exists — cost capture belongs
   with parts pricing, so margin is revisited then, not here. **Efficiency (actual vs sold time per type)
   is also DEFERRED** (needs a clocking→repair-item link the model doesn't have). See §12.
7. ✅ **`repair_types` is NOT gated behind the `jobsheets` module** — VHC repair items need it, and they
   exist without GMS. It is a core pricing primitive (like `labour_codes`).
8. ✅ **Soft delete** `repair_types` (`is_active`), so historical reports keep a resolvable type.

## 2. The mental model — FOUR "type" axes (do not conflate)

There are already three org-configurable "type" lists; this adds a fourth. They overlap in vocabulary
("Diagnostic"/"Service"/"MOT"/"Suspension" appear across several), so each must have a crisp distinct job
or users/devs will confuse them.

| Axis | Table | Cardinality | Question it answers | Drives |
|---|---|---|---|---|
| **Main Booking Requirement** (was Service Type) | `service_types` | **1 per visit** | "Why is the car here?" | Booking Diary label, capacity (`is_mot`, `default_hours`) |
| **Repair Type** (NEW) | `repair_types` | **N per visit** (one per work group) | "What kind of work is this group?" | **Labour rate** + **reporting** + (future) parts pricing |
| **Labour Code** | `labour_codes` | per labour line | the £/hour primitive | the actual rate number (sell + new cost) |
| **Reason Type** | `reason_types` | per VHC check item | component taxonomy (`brake_pad`, `tyre`) | which Reason-Library reasons appear |

Relationship: **Repair Type → points at a default Labour Code** (keeps `labour_codes` as the rate
primitive). **Reason Type stays as-is** (component grain, reason-sharing) and is unaffected.

## 3. Current state (verified) — why this fits

- A **work group is `repair_items` with `is_group=true`**; children via `parent_repair_item_id`
  (`20260119000001_repair_groups_parent_child.sql`). There is also a `repair_options` layer
  (Standard/Premium) under an item. `repair_items` has **no type column today**.
- `repair_items` is **polymorphic**: `health_check_id` | `jobsheet_id` | `estimate_id`, enforced by
  `repair_items_parent_chk` (`20260623180000_jobsheet_work_details.sql`, `20260626140000_estimates.sql`).
  → one `repair_type_id` column covers all three documents.
- **Labour today:** `repair_labour.labour_code_id → labour_codes.hourly_rate`, copied onto
  `repair_labour.rate` at entry (snapshot) in `apps/api/src/routes/repair-items/labour.ts` (≈L77-101).
  Defaults seeded `LAB £85 / DIAG £95 / MOT £45 (VAT-exempt)` in
  `20260118300001_repair_groups_pricing_phase1.sql` (seed at ≈L849). So "Diagnostic costs more" already
  exists — just picked manually, not classified.
- **Totals** are maintained by DB triggers `calculate_repair_item_totals()` /
  `calculate_repair_option_totals()` (same migration, ≈L288-395), which split VAT-exempt vs liable labour.
- **VHC concern → priced line:** `check_templates → template_sections → template_items` (instantiated as
  `check_results`); `template_items` already carries `reason_type` (FK-by-slug to `reason_types`,
  assignable in `TemplateBuilder.tsx`, cloned in `templates.ts` ≈L322). Advisor manually bundles
  `check_results` into a `repair_item` via `CreateRepairGroupModal.tsx` (name string-matched, free text),
  linked through `repair_item_check_results`. **No type survives the handoff today.**
- **Vehicles** already have `make`, `model`, `fuel_type`, `engine_size`
  (`20240114000000_initial_schema.sql` ≈L101) — free-text (normalisation needed for grouping).
- **Shared types are dead:** `@vhc/shared` is imported by zero app files; each app declares local types.
  No shared-type blast radius — but additions land in N local files, not one.

## 4. Data model — additive only

### 4.1 New lookup: `repair_types`

Mirror the `service_types` shape (`20260623120000_gms_jobsheets.sql` L26-40) + the labour link.

```sql
CREATE TABLE IF NOT EXISTS repair_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  label TEXT,
  colour VARCHAR(7) DEFAULT '#6366F1',
  default_labour_code_id UUID REFERENCES labour_codes(id) ON DELETE SET NULL,  -- LABOUR FEED
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,        -- SOFT delete (preserve report history)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_repair_types_org ON repair_types(organization_id, is_active, sort_order);
-- gms_set_updated_at trigger + org-scoped RLS SELECT policy (clone from service_types)
```

### 4.2 Attach point on the work group

```sql
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS repair_type_id UUID
  REFERENCES repair_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_repair_items_repair_type ON repair_items(repair_type_id)
  WHERE repair_type_id IS NOT NULL;
```

Nullable (legacy rows + parts-only groups). Set on the group header; children inherit via the existing
`cascadeOutcomeToChildren()` pattern (`repair-items/helpers.ts` ≈L26-73). Reporting tolerates NULL
("Unassigned" bucket).

### 4.3 VHC template default

```sql
ALTER TABLE template_items ADD COLUMN IF NOT EXISTS repair_type_id UUID
  REFERENCES repair_types(id) ON DELETE SET NULL;
```

Assignable per item in `TemplateBuilder.tsx`; **must also be copied in the template clone path**
(`templates.ts` ≈L322, next to `reason_type`) and in starter-template seeding, or new orgs lose it.

### 4.4 Cost capture — DEFERRED (with the Parts module)

> **Deferred (Leo, 2026-06-25).** True-margin reporting needs cost (a labour `cost_rate` + a parts-cost
> rollup), and cost belongs with **parts pricing**. We do NOT build cost capture in this initiative — it
> is revisited once the **Parts module** exists. No `cost_rate` / `cost_total` / `*_cost_total` columns
> here. Repair Type still cleanly anchors it later (a repair type → labour code already carries a rate; a
> cost rate slots alongside without reshaping anything). See §12.

## 5. Behaviour — labour LOCKED to Repair Type

- The group header gains a **Repair Type selector**. Setting it resolves
  `repair_types.default_labour_code_id` and **that** labour code's `hourly_rate` and `is_vat_exempt` are
  what new `repair_labour` lines use. **The per-line labour-code dropdown is hidden.** (When cost capture
  lands with the Parts module, the same labour code's future `cost_rate` rides along — §4.4/§12.)
- **Gate:** "Add labour" is disabled until a Repair Type is set (no type → no rate). UI nudge: "Pick a
  Repair Type first."
- **Snapshot preserved:** the rate is still copied onto `repair_labour` at entry; changing a Repair
  Type's labour code later does **not** reprice existing lines (quote integrity). Reports read stored
  values, not the current code.
- **VAT:** `is_vat_exempt` flows from the resolved labour code into `repair_labour.is_vat_exempt`, so
  `calculate_repair_item_totals()` keeps splitting MOT correctly. Mixed VAT in one group is avoided by the
  "split mixed work into separate groups" rule.
- **Code seam:** `repair-items/labour.ts` POST (≈L77-101) and the **option variant** (≈L235-247) plus
  PATCH (≈L342-355) change to resolve the rate from the item's (or the option's parent item's)
  `repair_type_id → default_labour_code` instead of a client-supplied `labour_code_id`. Both paths must
  change or the `repair_options` layer diverges.
- **Service Packages:** when a package is applied, set the created group's `repair_type_id` (optionally
  add `service_packages.default_repair_type_id`) so packaged work is typed; reconcile the package's stored
  labour rate vs the repair-type rate (`apply-service-package.ts` ≈L49-87) — prefer the repair-type rate
  under the lock model for consistency.

### 5.1 Two moments — copy-time vs entry-time (build checklist)

Repair Type touches pricing at **two distinct moments**. They have different fixes and different rules —
keep them separate or you get the silent bugs below.

**(A) Entry-time — when a labour line is ADDED (live pricing).** Applies while building an Estimate, a
Jobsheet, OR a VHC. Because all three share the same labour endpoints, **this is ONE fix that covers all
three documents.** The rate is resolved from the group's `repair_type → default_labour_code` and
**snapshotted** onto `repair_labour`. Every site that resolves a rate must honour the lock, or pricing
diverges between groups/options/edits/packages:
  - `POST /repair-items/:id/labour` — the group path (`labour.ts` ≈L60-172)
  - `POST /repair-options/:id/labour` — the **option** (Standard/Premium) path, a SEPARATE endpoint that's
    easy to miss (`labour.ts` ≈L218-293) → resolve via the option's parent group's `repair_type_id`
  - `PATCH /repair-labour/:id` — the re-resolve-on-edit path (`labour.ts` ≈L341-355)
  - `apply-service-package.ts` — the package-apply rate fallback (≈L49-87)
  - **Recommended:** extract one `resolveLockedRate(repairItemId)` helper used by all four, so the lock
    cannot drift.

**(B) Copy-time — when an estimate CONVERTS to a jobsheet.** This is a **pure deep-copy, NOT a
re-resolution.** `copyLineToJobsheet` (`estimates.ts` ≈L438) must copy `repair_type_id` **alongside** the
already-snapshotted labour + parts rows. The rate is **not** re-derived from the repair type — the
customer-approved price is preserved verbatim; the copied `repair_type_id` is carried for
**reporting/display only**. (So later changing a repair type's rate never alters a won job.) Concrete fix:
add `repair_type_id` to the `.select()` (≈L441) and the `.insert()` (≈L450). (When cost capture lands
later, the labour `cost_total` snapshot joins this copy too — §4.4/§12.)

**Why they coexist cleanly:** copy-time writes `repair_labour` rows directly (it never calls the
entry-time endpoints), so the snapshot is preserved and the two paths never collide. Fresh work typed
straight onto a jobsheet still uses path (A).

**Rule of thumb:** *(A) = derive + snapshot; (B) = copy the snapshot.* Miss (A)'s option/PATCH/package
siblings → divergent rates. Miss (B)'s `repair_type_id` → won work falls into "Unassigned" in reports.

### 5.2 Service packages — one package, one Repair Type (decision: Leo 2026-06-25)

A package pours labour + parts into **one** group via `applyServicePackageToRepairItem` (called from
VHC/MRI, jobsheet, estimate, and manual apply — all through that one service). The lock changes packages:

- **`service_packages.default_repair_type_id`** (NEW, FK → `repair_types`, ON DELETE SET NULL) — now
  **required** for any package with labour (no type → no rate). The group-creating wrappers stamp the new
  group's `repair_type_id` from it: `createBookedLineFromPackage` (`jobsheets.ts` ≈L978-1008), the estimate
  equivalent (`estimates.ts` ≈L647-671), the manual apply-package route, and the MRI path
  (`health-checks/helpers.ts` ≈L270).
- **Rate comes from the type, not the package.** `apply-service-package.ts` (≈L49-86) stops using
  `service_package_labour.labour_code_id` / stored `rate`; it resolves the rate (and `is_vat_exempt`) from
  the group's repair type's default labour code — the same `resolveLockedRate` helper as the live editor
  (§5.1-A). Package labour lines then contribute **hours** (+ discount/notes) only.
- **Combined menus = two packages.** "Service & MOT" is built by applying the Service package AND the MOT
  package → two groups (correct VAT + correct repair-type reporting). The existing multi-select apply
  (`servicePackageIds`, `jobsheets.ts` ≈L510) makes that one action.
- **Package builder UI** (Settings → Service Packages): add a Repair Type selector per package; **retire
  the per-line labour-code column** (rate now derives from the type). Labour rows become hours + notes.

**Migration wrinkle — legacy packages.** `service_package_labour.labour_code_id` is NOT NULL today and some
packages mix codes (e.g. a Service+MOT package with a VAT-exempt MOT line) — those can't stay one group
under the lock. Plan: **keep** the column (don't drop), backfill `service_packages.default_repair_type_id`
from each package's dominant labour code (code→type map), and **flag mixed-VAT packages for manual split**
rather than silently forcing them onto one rate. Never auto-destroy package data.

## 6. VHC default derivation

1. `template_items.repair_type_id` (§4.3) holds the per-check-item default.
2. In `CreateRepairGroupModal.tsx`, when findings are bundled, pre-fill the group's Repair Type from the
   linked `check_results → template_items.repair_type_id`. Heuristic when items disagree: **most frequent;
   tie → first by section sort order**. Advisor can override before saving.
3. The chosen value writes to `repair_items.repair_type_id` (authoritative). Template value is only a
   default — it never overrides an advisor choice.

> A group often spans concerns of different types; that's why the template value is a *default*, and the
> authoritative type is the advisor's per-group choice. `reason_types` (component grain) is left untouched.

## 7. Main Booking Requirement (rename) — label only

- Change visible strings only; keep `service_types` / `jobsheets.service_type_id`. Touch:
  `NewJobsheet.tsx` (≈L504), `JobsheetDetail.tsx` (≈L522 + edit label), `JobsheetList.tsx` pill,
  `EstimateDetail.tsx` convert modal (≈L431), `Settings/ServiceTypes.tsx` page title, and the Booking
  Diary header (`TableListView.tsx` ≈L41 / `BookingDiary` subtitle).
- `is_mot` + `default_hours` **stay** on `service_types` (booking/capacity concern, not repair work).
- **DMS note:** imported bookings use free-text `health_checks.booked_service_type` (no FK), so they don't
  get a structured Main Booking Requirement. Out of scope here; mapping DMS→structured is separate.
- **Conversion note:** Estimate→Jobsheet already collects `service_type_id` in the modal — only the label
  changes. **But** `copyLineToJobsheet` (`estimates.ts` ≈L437-485) is an explicit column allow-list and
  **will silently drop `repair_type_id`** on conversion unless updated — must add it (and the cost columns).

## 8. Reporting

New **Repair Types** report (catalogue tile in `ReportsHub.tsx`; page modelled on `ItemPerformance.tsx`).

- **Aggregation via a Postgres RPC** (mirror `item_report_usage`, `20260613120000_item_report_usage_fn.sql`)
  to dodge the ~1000-row PostgREST cap. Returns one row per `repair_type` (× optional `make`/`fuel_type`)
  with: identified £, authorised/sold £, declined £, deferred £, conversion %, work-mix %. (Revenue-side
  only — **no margin** this initiative; cost is deferred with the Parts module, §4.4/§12.)
- **Plumbing:** add `repair_type_id` to the repair-item SELECT lists in
  `hc-period-service.ts` (`ITEM_LINK_SELECT` ≈L226, `itemSelect` ≈L142) and `RepairItemLike`
  (`lib/metrics.ts` ≈L14); extend `aggregateRepairItemsByHc` (≈L208) with a repair-type bucket OR do it
  all in the RPC (preferred for the brand/fuel cross-tab).
- **Brand/fuel slicing:** join `repair_items → health_checks → vehicles(make, fuel_type)`. **Normalise**
  free-text make/fuel in SQL (`lower(trim())`) — same fragmentation `item-report-service.ts` solved with
  `normalizeName`. (Could later promote to a make-reference table, reusing the tyre-make-reference pattern.)
- **Group rollup:** respect the parent/child de-dup already in `aggregateRepairItemsByHc` so per-type
  totals don't double-count group + children.
- **Deferred:** margin/profitability (needs cost capture — Parts module, §12) and efficiency (actual vs
  sold hours per type — `technician_time_entries` are job-level with no repair-item link). Not in scope.

## 9. Settings, module, seeding

- **API route** `apps/api/src/routes/repair-types.ts` — clone `service-types.ts` CRUD (GET w/ lazy-seed,
  POST next sort_order = max+10, PATCH, **soft** DELETE via `is_active`). Add `defaultLabourCodeId` to the
  shape. Mount in `index.ts` at `/api/v1/repair-types` (org-from-auth style). **Do NOT** wrap in
  `requireModule('jobsheets')` (decision #7) — VHC-only orgs need it.
- **Web** `apps/web/src/pages/Settings/RepairTypes.tsx` — clone `ServiceTypes.tsx`, plus a
  **default labour code** dropdown per row (the rate link). Register route in `App.tsx`; add a card in
  `SettingsHub.tsx` under "Pricing & Parts".
- **Seeding** (3 layers, keep one source of truth): migration CROSS JOIN over existing orgs + API
  lazy-seed inline DEFAULTS + (optional) `seed_repair_types_for_org` RPC wired into
  `provisioning.ts seedDefaultLibraries()` (≈L335-372). Default set, each mapped to a labour code:
  `Service→LAB`, `MOT→MOT`, `Diagnostic→DIAG`, `Tyres→LAB`, `Brakes→LAB`, `Suspension→LAB`,
  `Clutch→LAB`, `Air Conditioning→LAB`. Lazy-seed alone is sufficient to avoid empty lists.

## 10. Migrations

One additive, `IF NOT EXISTS` / guarded migration (e.g. `YYYYMMDDHHMMSS_repair_types.sql`), **ordered
AFTER** the GMS stack (jobsheets `20260623*`, estimates `20260626*`, which are uncommitted + not yet on
dev). Contents: §4.1 table + trigger + RLS + index; §4.2 `repair_items.repair_type_id`; §4.3
`template_items.repair_type_id`; §5.2 `service_packages.default_repair_type_id` + dominant-code backfill
(+ flag mixed-VAT packages, don't drop `service_package_labour.labour_code_id`); default-seed CROSS JOIN;
(optional) `seed_repair_types_for_org`. (No cost columns / trigger changes — cost capture is deferred to
the Parts module, §4.4/§12.) Deploy via the pipeline (`supabase db push`), **never** out-of-band MCP SQL
(migration-drift rule).

## 11. Phasing

- **P1 — Foundation:** `repair_types` table + CRUD + Settings page + `repair_items.repair_type_id`;
  label-rename Service Type → Main Booking Requirement. No behaviour change yet.
- **P2 — Labour lock:** Repair Type selector on the group header in `LabourTab.tsx` (≈L660-697) +
  `WorkDetailsPanel.tsx` (≈L343-354); one `resolveLockedRate` helper used by the item + option + PATCH +
  package-apply paths (§5.1-A); hide per-line code selector; gate "add labour". Carry `repair_type_id`
  through `formatRepairItem` (≈L235-289), create/PATCH, and `copyLineToJobsheet`.
- **P2.5 — Packages:** `service_packages.default_repair_type_id` + apply-path rate-from-type + builder UI
  (type selector, retire per-line labour-code column) + legacy backfill/flagging (§5.2).
- **P3 — VHC defaults:** `template_items.repair_type_id` in TemplateBuilder + clone/seed; derive default in
  `CreateRepairGroupModal.tsx`.
- **P4 — Reporting:** repair-type RPC + report page + brand/fuel slicing (revenue/conversion only).
- **(Later, with Parts module) — Margin:** cost capture + margin reporting (§4.4/§12). Not in this initiative.

## 12. Open / future

- **Parts module + true-margin (deferred, Leo 2026-06-25):** the Parts module is the home for cost. When
  it lands, add the §4.4 cost layer (labour `cost_rate` + parts-cost rollup) and margin reporting. Repair
  Type already anchors this (type → labour code carries a rate; a cost rate slots alongside). `repair_types`
  can also carry a default parts markup / price matrix then — the table is shaped to grow.
- **Multi-type packages** (Option 2 — `service_package_labour.repair_type_id` per line, one package →
  several groups) — a future enhancement if combined "Service & MOT"-in-one-package proves worth it; for
  now combined menus = apply two packages (§5.2).
- **Efficiency reporting** needs a clocking→repair-item link (deferred).
- **DMS Main Booking Requirement** (map free-text `booked_service_type` to structured) — separate effort.
- **Reviving `@vhc/shared`** as the real source of truth — out of scope; add types locally per current
  convention.

## 13. Gotchas (carry into the build)

- `copyLineToJobsheet` (estimates) silently drops new columns — add `repair_type_id` (see §5.1-B). When cost capture lands later, add its snapshot here too.
- The `repair_options` labour path (+ PATCH + package apply) must honour the repair-type rate too, or pricing diverges (see §5.1-A).
- Service packages must carry a Repair Type (`default_repair_type_id`) and resolve rate from it; legacy mixed-VAT packages need split, not silent re-rating (see §5.2).
- The labour rate is snapshotted — Repair Type rate changes don't reprice existing lines (intended).
- `repair_types` ungated (not behind `jobsheets`) so VHC-only orgs get it.
- Soft-delete repair types (history); reports need an "Unassigned" bucket for NULLs.
- Normalise free-text `make`/`fuel_type` before grouping.
- Update the template **clone** + **starter-seed** paths for `template_items.repair_type_id`.
- Migration must order after the uncommitted GMS migrations; deploy via pipeline only.
