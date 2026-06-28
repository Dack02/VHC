# GMS — Repair Types + Main Booking Requirement (Plan)

> Branch: work on `dev` · Status: **COMPLETE — P1–P4 ALL DONE & VERIFIED (uncommitted, 2026-06-28)** — P1
> foundation; P2 labour-lock (server + `WorkDetailsPanel` + VHC `LabourTab`); P2.5 packages; P3 VHC
> defaults + auto-create stamping; **P4 reporting** (Repair Types report — revenue/conversion/work-mix per
> type + vehicle brand/fuel slice, reusing `calcItemTotal` so it agrees with the other reports). API `tsc`
> + web `vite build` both green (0 errors). Migrations `20260628130000` + `20260628155000` (DEPLOYED) +
> `20260628160000_starter_template_repair_type.sql` (pending deploy). Only the deferred **Parts-module
> margin** work remains (out of this initiative — §4.4/§12). Audit gaps closed in §14. · Author: Leo + Claude
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
3. ✅ **Repair Type lives on the top-level priced row** (`repair_items.repair_type_id` — a group header or a
   standalone item). **Children and `repair_options` carry NO type of their own**; their rate is resolved by
   climbing to the parent's type (**resolve-upward** — see §4.2 / §5.1-A, replaces the original "cascade to
   children" idea which rested on a mechanism that doesn't exist — §14 gap 1). One shared column covers VHC,
   Jobsheet, and Estimate.
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

Nullable (legacy rows + parts-only / override-only groups). **The type lives only on the top-level row**
(`is_group=true` header, or a standalone `is_group=false` item with no parent). **Children and
`repair_options` do NOT store a type** — rate resolution climbs to the parent (§5.1-A). Reporting already
reads top-level rows (children roll up), so this one column is also the reporting grain; NULL = "Unassigned".

> ⚠️ **Correction (audit 2026-06-25, §14 gap 1):** an earlier draft said children "inherit via
> `cascadeOutcomeToChildren()`". That helper updates **outcome** columns only and runs **only** on
> authorise/decline/defer — it never propagates a type and never fires at create/group/PATCH. Do **not**
> rely on it. Resolve-upward removes the need for any type cascade. `verifyRepairItemAccess`
> (`helpers.ts` ≈L18) also does not currently select `repair_type_id`/parent, so the rate helper needs its
> own climb query.

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
- **Gate (UI + SERVER — §14 gap 5):** labour cannot be added to a group with no `repair_type_id`. The web
  disables "Add labour" with a nudge ("Pick a Repair Type first"); **the API also returns 400** on
  `POST /repair-items/:id/labour` and `POST /repair-options/:id/labour` when the resolved parent has no
  type — a UI-only gate is bypassable by the mobile PWA, the MRI/package path, and direct API callers.
  Also **relax the `labour_code_id` NOT-NULL request validation** (`labour.ts` ≈L67-69): the client no
  longer sends a code under the lock.
- **Snapshot preserved:** the rate is still copied onto `repair_labour` at entry; changing a Repair
  Type's labour code later does **not** reprice existing lines (quote integrity). Reports read stored
  values, not the current code.
- **VAT (labour only — §14 gap 13):** `is_vat_exempt` flows from the resolved (parent type's) labour code
  onto each `repair_labour` row, so `calculate_repair_item_totals()` keeps zero-rating MOT **labour**.
  ⚠️ **Parts are always VAT-charged** — the trigger has no parts-level exemption. "Split mixed work into
  separate groups" zero-rates the MOT *labour*; a VAT-exempt-typed group that also holds parts still VATs
  the parts. **Accepted** (MOT groups are labour-only); revisit with the Parts module if a fully-exempt
  group is ever required.
- **Code seam (resolve-upward):** all rate resolution goes through one `resolveLockedRate(input)` helper
  (§5.1-A) that climbs to the **top-level** `repair_items.repair_type_id` (child → `parent_repair_item_id`;
  option → `repair_options.repair_item_id`), reads `default_labour_code` → `rate` + `is_vat_exempt`, then
  the caller applies `discount_percent` into `repair_labour.total`.
- **Service Packages:** see §5.2 — the package carries `default_repair_type_id`; the group is stamped with
  it **before** apply runs, and the package rate resolves from the type.

### 5.1 Two moments — copy-time vs entry-time (build checklist)

Repair Type touches pricing at **two distinct moments**. They have different fixes and different rules —
keep them separate or you get the silent bugs below.

**(A) Entry-time — when a labour line is ADDED (live pricing).** Applies while building an Estimate, a
Jobsheet, OR a VHC. Because all three share the same labour endpoints, **this is ONE fix that covers all
three documents.** The rate is resolved from the group's `repair_type → default_labour_code` and
**snapshotted** onto `repair_labour`. Every site that resolves a rate must honour the lock, or pricing
diverges between groups/options/edits/packages:
  - `POST /repair-items/:id/labour` — group/standalone path (`labour.ts` ≈L60-172)
  - `POST /repair-options/:id/labour` — the **option** path, a SEPARATE endpoint (`labour.ts` ≈L218-293)
  - `PATCH /repair-labour/:id` — re-resolve-on-edit; **shared by item AND option rows** (`labour.ts` ≈L296-440)
  - `apply-service-package.ts` — package apply (≈L49-87)
  - `repair-items.ts` group-creation **labour migration** (≈L393-414) — a **6th** `repair_labour`-write site
    (§14 gap 6) that copies child labour onto a "Standard" option. Keep it a **verbatim snapshot copy** (it's
    part of copy-time, NOT entry-time — do **not** re-derive from the new group's type).
  - **Helper contract (§14 gap 4):** `resolveLockedRate({ itemId?, optionId? })` — accepts EITHER, climbs to
    the top-level `repair_items.repair_type_id` (option → `repair_options.repair_item_id`; child →
    `parent_repair_item_id`), returns `{ rate, isVatExempt, labourCodeId }`; the caller applies
    `discount_percent`. A literal `resolveLockedRate(repairItemId)` is **wrong** for the option POST (no
    item id) and resolves to null for option-labour PATCH (option rows carry no `repair_item_id`). Options
    inherit the parent's type **live** — there is no cascade.

**(B) Copy-time — when an estimate CONVERTS to a jobsheet.** `copyLineToJobsheet` (`estimates.ts` ≈L438)
copies the already-snapshotted labour + parts and **must also carry `repair_type_id`** — do **not** re-derive
(the customer-approved price stays verbatim; the copied type is for reporting/display).
⚠️ **It is NOT a deep copy (§14 gap 7):** today it selects only `name,description`, omits `discount_percent`,
`price_override`/`price_override_reason`, the `no_*_required` flags, and copies **no children, no
`repair_options`, no `selected_option_id`**. **Decision:** estimate work lines are **flat / single-type**
(the estimate UI has no grouping or options), so the shallow copy is correct **as long as that holds** — add
`repair_type_id` (+ `discount_percent`, and `price_override` if used) to the `.select()` (≈L441) and
`.insert()` (≈L450). If estimate grouping/options are ever added, this MUST first become a true deep copy or
option-priced estimate lines convert to £0. (Cost-capture snapshot joins this copy later — §4.4/§12.)

**Why they coexist cleanly:** copy-time writes `repair_labour` rows directly (it never calls the
entry-time endpoints), so the snapshot is preserved and the two paths never collide. Fresh work typed
straight onto a jobsheet still uses path (A).

**Rule of thumb:** *(A) = derive + snapshot; (B) = copy the snapshot.* Miss (A)'s option/PATCH/package
siblings → divergent rates. Miss (B)'s `repair_type_id` → won work falls into "Unassigned" in reports.

### 5.2 Service packages — one package, one Repair Type (decision: Leo 2026-06-25)

A package pours labour + parts into **one** group via `applyServicePackageToRepairItem` (called from
VHC/MRI, jobsheet, estimate, and manual apply — all through that one service). The lock changes packages:

- **`service_packages.default_repair_type_id`** (NEW, FK → `repair_types`, ON DELETE SET NULL) — now
  **required** for any package with labour (no type → no rate). **Stamp the group's `repair_type_id` BEFORE
  `applyServicePackageToRepairItem` runs** — strict ordering, the resolver reads the type *during* apply
  (§14 gap 3, gap 11). All group-creating wrappers must do this: `createBookedLineFromPackage`
  (`jobsheets.ts` ≈L978-1008), `createEstimateLineFromPackage` (`estimates.ts` ≈L643-673), the manual
  `apply-package.ts` route, and the **MRI insert** (`health-checks/helpers.ts` ≈L233-252 — set the type on
  the insert from the package's `default_repair_type_id`, *then* apply at ≈L270).
- **Manual apply to an existing item:** if the target item is untyped, stamp it from the package's
  `default_repair_type_id`; if it's already typed, keep the item's type (the package rate follows the item).
- **CRUD:** the `service-packages` route + builder must accept `default_repair_type_id` and **keep**
  `service_package_labour.labour_code_id` (legacy + dominant-code backfill).
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

## 6. VHC default derivation — ALL creation paths (audit-expanded, §14 gap 2)

`template_items.repair_type_id` (§4.3) holds the per-check-item default. **The catch the audit found: most
VHC repair items are created server-side, NOT via the modal** — and under the lock an untyped item is
un-priceable. So **every** creation path must stamp a type:

1. **Modal** (`CreateRepairGroupModal.tsx`): pre-fill from the linked `check_results →
   template_items.repair_type_id`; heuristic when items disagree = **most frequent; tie → first by section
   sort order**; advisor can override. Writes the authoritative `repair_items.repair_type_id`.
2. **`autoGenerateRepairItems`** (`health-checks/helpers.ts` ≈L121-137) **and the generate route**
   (`repair-items-hc.ts` ≈L503): stamp each generated item from its source check item's
   `template_items.repair_type_id` — the join must **add that column** (it currently pulls name/description only).
3. **MRI auto-create** (`helpers.ts` ≈L233-252): stamp from the linked package's `default_repair_type_id`
   **before** applying the package (§5.2). `mri_items` has no type source today — use the package's.
4. **MOT-failure auto-create** (`results.ts` ≈L231): stamp the **template item's** repair type — an MOT
   *failure* is rectified by normal VATable repair work, **not** MOT labour, so it must NOT get the
   VAT-exempt "MOT" rate. (Revised from the original "stamp MOT type", which would mis-rate the repair.)

Where no source exists (e.g. an untemplated finding), the item is left **Unassigned** and the advisor must
set a type before adding labour (the server gate, §5). `repair_items.repair_type_id` is always authoritative;
template/package values are only defaults. `reason_types` (component grain) is left untouched.

> Resolve-upward (§4.2) means children/options never need a type — only the top-level row does.

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

- **Aggregation via a Postgres RPC** (mirror `item_report_usage`) to dodge the ~1000-row cap. One row per
  `repair_type` (× optional `make`/`fuel_type`) with identified £, sold £, declined £, deferred £,
  conversion %, work-mix %. (Revenue only — **no margin**; §4.4/§12.) ⚠️ The RPC MUST replicate
  `lib/metrics.ts calcItemTotal` (≈L48-68): **substitute the selected option's totals** when
  `selected_option_id` is set (an option-priced group's *parent* total is ≈£0 — §14 gap 8), and use a single
  **effective-price** convention **`COALESCE(price_override, total_inc_vat)`** (§14 gap 12 — `price_override`
  is honoured by follow-up reports but ignored by the dashboard path; pick one or per-type totals disagree).
- **Plumbing:** add `repair_type_id` to the repair-item SELECT lists in `hc-period-service.ts`
  (`ITEM_LINK_SELECT` ≈L226, `itemSelect` ≈L142) and `RepairItemLike` (`lib/metrics.ts` ≈L14); extend
  `aggregateRepairItemsByHc` (≈L208) with a repair-type bucket OR do it all in the RPC (preferred for the
  brand/fuel cross-tab — but then it must hand-roll the option substitution above, which the TS path gets
  for free via `calcItemTotal`).
- **DTO surfaces (§14 gap 9):** `formatRepairItem` alone is not enough — also add `repair_type_id` (+ a
  joined `repair_type {id,code,label,colour}`) to **both** `WORK_LINE_SELECT` + `shapeWorkLine` (jobsheets
  ≈L906-948, estimates ≈L584-626) and to the web `api.ts` repair-item interfaces, or the type/colour chip
  never reaches the panel/selector.
- **Brand/fuel slicing:** join `repair_items → health_checks → vehicles(make, fuel_type)`. **Normalise**
  free-text make/fuel in SQL (`lower(trim())`) — same fragmentation `item-report-service.ts` solved with
  `normalizeName`. (Could later promote to a make-reference table, reusing the tyre-make-reference pattern.)
- **Group rollup:** respect the parent/child de-dup already in `aggregateRepairItemsByHc` so per-type
  totals don't double-count group + children.
- **Scope-out / positive decisions (§14 gap 15):** the ~14 by-HC `repair_items` SELECTs in `reports.ts` are
  **deliberately untouched** (Repair Types is a standalone RPC, not a column bolted onto every report).
  **Repair Type is internal-only** — never rendered on the customer VHC/estimate portal, PDF, or SMS/email
  (`public.ts`, `public-estimate.ts`, `estimate-send.ts`, `health-checks/pdf.ts`). PDFs keep resolving the
  labour-code label because `repair_labour.labour_code_id` is still snapshotted — hiding the per-line
  *selector* does not break documents.
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

- **P1 — Foundation:** ✅ CODE-COMPLETE (2026-06-26, uncommitted). Migration
  `20260628130000_repair_types.sql` (repair_types table + RLS/trigger/index + seed; `repair_items.repair_type_id`;
  + inert `template_items.repair_type_id` & `service_packages.default_repair_type_id` for later phases).
  API `routes/repair-types.ts` (ungated CRUD, soft-delete, labour-code-mapped lazy-seed) mounted at
  `/api/v1/repair-types`. Web `Settings/RepairTypes.tsx` (+ default-labour-code dropdown) + route + Settings
  card under "Pricing & Parts". Service Type → **Main Booking Requirement** label rename (Settings page +
  card, NewJobsheet, JobsheetDetail, EstimateDetail convert modal). No behaviour change yet. **Verified:**
  API `tsc` + web `tsc && vite build` green. **Pending:** pipeline deploy of the migration.
- **P2 — Labour lock:** ✅ DONE & VERIFIED (2026-06-26 — API `tsc` + web `vite build` green).
  - ✅ **Server lock (DONE + verified — API `tsc` green):** `resolveLockedRate({itemId|optionId})` helper
    (resolve-upward) + `reRateLabourForRepairItem` in `repair-items/helpers.ts`; labour `item POST` +
    `option POST` resolve the rate from the type with a **server-side 400 gate** (`REPAIR_TYPE_REQUIRED`) +
    relaxed `labour_code_id` validation; labour `PATCH` keeps the snapshot (no re-resolve); `repairTypeId`
    on `formatRepairItem`; `repair-items` create sets the type (top-level only) + PATCH accepts
    `repairTypeId` and re-rates existing labour; `copyLineToJobsheet` carries `repair_type_id` +
    `discount_percent`. (`shapeWorkLine`/`WORK_LINE_SELECT` use `*` + `formatRepairItem`, so they surface it.)
  - ✅ **Shared jobsheet/estimate UI (DONE + verified — web build green):** `WorkDetailsPanel.tsx` — Repair
    Type selector per WorkLineCard, hides the per-line labour-code dropdown, shows the locked rate, gates
    "Add labour", `addLabour` drops `labour_code_id`, new `setLineRepairType` PATCH. One shared component →
    covers Jobsheet AND Estimate.
  - ✅ **VHC `LabourTab.tsx` (DONE + verified — web build green):** group-header + single-item Repair Type
    selectors; child + group-labour rows show the **read-only locked code** and resolve the rate
    upward (children climb to the parent group's type); the per-line labour-code `<select>` is gone;
    `saveRowLabour` drops `labour_code_id` (server resolves); `setItemRepairType` PATCH; the **AddOtherLabour
    modal** now picks a Repair Type (not a code). `api.ts` `NewRepairItem`/`RepairItemChild` carry
    `repairTypeId`. (CreateRepairGroupModal default-type pre-fill is P3.)
- **P2.5 — Packages:** ✅ DONE & VERIFIED (2026-06-26 — API `tsc` + web build green). Migration
  `20260628155000_repair_types_packages.sql` (labour_code_id → nullable + dominant-code backfill of
  `default_repair_type_id`, single-VAT only). `applyServicePackageToRepairItem` **stamps the package's type
  onto the group (if untyped) then bills all package labour at the resolved locked rate** — so all four
  callers (jobsheet/estimate wrappers, manual apply, MRI) get it via the one service. `service-packages`
  CRUD accepts/returns `defaultRepairTypeId`, labour code now optional. Builder (`ServicePackages.tsx`) gains
  a package-level **Repair Type** selector, retires the per-line labour-code + rate inputs (rate shown
  read-only from the type), validates a type when labour exists. Combined "Service & MOT" = two packages.
- **P3 — VHC defaults + auto-create:** ✅ DONE & VERIFIED (2026-06-28 — API `tsc` + web build green).
  `template_items.repair_type_id` wired: `items.ts` CRUD accepts/returns it, `templates.ts` GET shaper +
  same-org clone carry it, TemplateBuilder has a per-item **Repair Type** selector (edit row + inline-add,
  threaded through the SortableSection→SortableItem/InlineNewItemRow chain). **All server-side auto-create
  paths now stamp `repair_type_id` from the template item**: `autoGenerateRepairItems`, the
  `repair-items-hc.ts` generate route, and the `results.ts` MOT-failure path. **Correction to §6 #4:** the
  MOT-failure item is stamped with the **template item's** repair type (the rectification is normal VATable
  work), **not** a VAT-exempt "MOT" type — that would mis-rate the repair. MRI is already typed via its
  package (P2.5). `CreateRepairGroupModal` pre-fills the type from the selected findings' template defaults
  (most-frequent; tie → first) + a selector + sends `repairTypeId`. Cross-org starter-template copy maps
  `repair_type_id` **by code** (migration `20260628160000`). `crud.ts` results fetch + `api.ts`
  `CheckResult.template_item` now surface `repair_type_id`.
- **P4 — Reporting:** ✅ DONE & VERIFIED (2026-06-28 — API `tsc` + web build green). Built as a **Node
  aggregation** (`services/repair-type-report-service.ts`), NOT a SQL RPC — it reuses `fetchPeriodHcSet` +
  `calcItemTotal` (selected-option substitution + labour/parts fallback) so the numbers **agree with the
  dashboard / Item Performance** and the existing chunked fetch dodges the 1000-row cap. Top-level,
  non-deleted items only (children roll up via the group total); NULL type → "Unassigned" bucket. Per-type
  identified/sold/declined/deferred + conversion % + work-mix %, plus `byMake`/`byFuel` slices (free-text
  make/fuel collapsed case-insensitively). Endpoint `GET /api/v1/reports/repair-types`; web
  `pages/Reports/RepairTypes.tsx` + ReportsHub card + route. (Chose Node over the RPC for cross-report
  consistency; the §8 note allowed either.) Revenue-side only — margin deferred (§4.4/§12).
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

- **Resolve-upward, NOT cascade:** type lives on the top-level row only; children/options climb to it. The old "cascadeOutcomeToChildren" inheritance claim was wrong — that helper is outcome-only and never runs at create (§4.2, §14 gap 1).
- **Server-side gate, not just UI:** 400 on add-labour to an untyped group — mobile/MRI/API bypass the UI (§14 gap 5).
- **ALL server-side auto-create paths must stamp a type** (autoGenerate, generate route, MRI, MOT-failure) or auto-findings are un-priceable under the lock (§6, §14 gap 2).
- **Stamp the type BEFORE applying a package** — strict ordering across all 4 wrappers incl. `createEstimateLineFromPackage` + the MRI insert (§5.2, §14 gaps 3/11).
- `resolveLockedRate` takes `{itemId|optionId}` and climbs to the parent's type; the group-creation labour migration is a 6th write site kept as a verbatim snapshot (§5.1-A, §14 gaps 4/6).
- `copyLineToJobsheet` is **shallow** today (drops discount/override/children/options) — OK only while estimate lines stay flat; add `repair_type_id` + `discount_percent` (§5.1-B, §14 gap 7).
- Reporting RPC must substitute selected-option totals + use `COALESCE(price_override, total_inc_vat)` (§8, §14 gaps 8/12).
- DTO surfaces beyond `formatRepairItem`: both `shapeWorkLine`/`WORK_LINE_SELECT` + web `api.ts` (§8, §14 gap 9).
- VAT-exemption is **labour only**; parts always VATed (§5, §14 gap 13).
- The labour rate is snapshotted — Repair Type rate changes don't reprice existing lines (intended).
- `repair_types` ungated (not behind `jobsheets`) so VHC-only orgs get it. Soft-delete (history); reports need an "Unassigned" bucket for NULLs.
- Normalise free-text `make`/`fuel_type` before grouping. Update the template **clone** + **starter-seed** paths for `template_items.repair_type_id`.
- Migration must order after the uncommitted GMS migrations; deploy via pipeline only.

## 14. Pricing-engine audit (2026-06-25) — gaps closed

A full audit (8 parallel mappers over the live VHC/Jobsheet/Estimate pricing engine + a verifying critic)
cross-checked §§1-13 against the actual code. **Verdict:** architecture sound — the polymorphic single
column, two-moments model, soft-delete, deferred margin/efficiency, and label-only rename all verified
correct — but **not buildable as first written**: 5 HIGH, 7 medium, 3 low gaps. All are now folded into the
sections above. Log:

| # | Sev | Gap | Resolution |
|---|---|---|---|
| 1 | HIGH | `cascadeOutcomeToChildren` is outcome-only and never runs at create — the named inheritance mechanism doesn't exist | **Resolve-upward**: type on the top-level row only; children/options climb to parent (§1.3, §4.2, §5.1-A) |
| 2 | HIGH | 4+ server-side auto-create paths make untyped → un-priceable items | Stamp a type in every creation path (§6) |
| 3 | HIGH | MRI applies a package to an untyped item → rate can't resolve | Stamp from package `default_repair_type_id` before apply (§5.2, §6) |
| 4 | HIGH | `resolveLockedRate(repairItemId)` signature wrong for option/PATCH | Discriminated `{itemId|optionId}` + climb contract (§5.1-A) |
| 5 | HIGH | Gate is UI-only → bypassable by mobile/MRI/API | Server-side 400 + relax `labour_code_id` validation (§5) |
| 6 | MED | Group-creation labour migration is an unlisted 6th `repair_labour` write site | Listed as a verbatim snapshot copy — don't re-derive (§5.1-A) |
| 7 | MED | `copyLineToJobsheet` is shallow, not a deep copy | Estimate lines are flat = OK now; omissions documented; add `repair_type_id`+`discount_percent` (§5.1-B) |
| 8 | MED | RPC must substitute selected-option totals or option-priced groups read £0 | Mirror `calcItemTotal` (COALESCE option over parent) in the RPC (§8) |
| 9 | MED | DTO surfaces (`shapeWorkLine`/`WORK_LINE_SELECT`/web `api.ts`) missing | Added to §8 + P2 |
| 10 | MED | Shared `WorkDetailsPanel` + no set-type path for flat estimate/jobsheet lines | Parent-agnostic "set repair type on line" PATCH + selector on WorkLineCard (§8, P2) |
| 11 | MED | Package apply ordering + `createEstimateLineFromPackage` + CRUD unaddressed | Stamp-before-apply for all 4 wrappers + CRUD accepts the type (§5.2) |
| 12 | MED | `price_override` reporting convention divergent (follow-up vs dashboard) | Single `COALESCE(price_override, total_inc_vat)` convention (§8) |
| 13 | LOW | VAT-exemption is labour-only; parts always VATed | Stated as accepted behaviour (§5) |
| 14 | LOW | Discount preservation + re-parent / ungroup type rules unspecified | Helper applies `discount_percent`; re-parent/ungroup rules below |
| 15 | LOW | Scope-out `reports.ts` selects + confirm customer portal never exposes type | Positive decisions recorded (§8) |

**Re-parent / ungroup semantics (gap 14).** Under resolve-upward only the top-level row holds a type, so:
when a standalone (possibly typed) item is **re-parented** into a group (`repair-items.ts` ≈L359-362), the
**group's type wins** and the child's own `repair_type_id` is cleared (children hold no type). Its already-
snapshotted labour **keeps its rate** (we never re-derive on move — so a group can legitimately contain
labour snapshotted at a different type's rate; snapshot wins for money, group type wins for classification).
On **ungroup** (`repair-items.ts` ≈L730-818): freed children become standalone and **Unassigned** until typed
(their labour keeps its snapshot); the demoted-but-kept group retains its type.
