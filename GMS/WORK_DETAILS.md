# GMS — Jobsheet Work Details (Plan)

> Branch: `GMS` (work on `dev`) · Status: **Phase 2 + Phase 3 BUILT (uncommitted, migration not yet deployed)** · Author: Leo + Claude · Date: 2026-06-23
> Companion to [`JOBSHEET.md`](./JOBSHEET.md).

## ✅ Build status (2026-06-23) — Phase 2 + Phase 3 implemented, uncommitted

**Migration** `supabase/migrations/20260623180000_jobsheet_work_details.sql`: `repair_items.jobsheet_id`
(nullable FK) + `health_check_id` made nullable + `repair_items_parent_chk` CHECK + `source`; `jobsheets`
gets `vhc_required` / `job_state` / `booking_notes`; backfills `jobsheets.job_state` from the linked VHC.

**API** — `apps/api/src/routes/jobsheets.ts`: create honours `vhcRequired` (skips VHC when off) + saves
`bookingNotes` + pre-loads `servicePackageIds`; PATCH accepts `bookingNotes` / `vhcRequired` / `jobState`
(syncs `jobState` to the linked VHC); new `GET/POST /:id/work-lines` + `POST /:id/work-lines/from-package`
(booked lines are `source='booking'`, pre-authorised). `formatRepairItem` now surfaces `source` + `jobsheetId`.
Labour/parts/outcome editing reuses the existing `/repair-items/*` routes unchanged.

**API (Phase 3)** — `apps/api/src/routes/workshop-board.ts`: `/tiles` Future Bookings count and the
`status=future` drill-in now include **VHC-less jobsheets** (no health_check) via `loadVhcLessFutureJobsheets`;
drill-in rows carry `jobsheetId` so the UI opens the jobsheet, not a VHC.

**Web** — `pages/Jobsheets/WorkDetailsPanel.tsx` (new; booked vs inspection groups, labour+parts add/delete,
Packages picker, booking-notes box, document totals); `JobsheetDetail.tsx` renders it + shows Vehicle Status
from the jobsheet (works with no VHC, "No VHC" chip); `NewJobsheet.tsx` gains the **Requires VHC** toggle +
Booking Notes + package pre-load; `TileStatus/{types,TileStatusPage}` open jobsheet rows from Future Bookings.

**Booked work on the VHC (read-only)** — booked work stays owned by the jobsheet, but the VHC now shows it as
read-only context: new `GET /api/v1/health-checks/:id/booked-work` (in `health-checks/crud.ts`; returns the
linked jobsheet's `source='booking'` lines + reference, empty when there's no jobsheet) + a
`pages/HealthChecks/components/BookedWorkPanel.tsx` at the top of the VHC **Summary** tab (links to the
jobsheet; hidden when there's no booked work). Reuses migration `20260623180000`'s `source`/`jobsheet_id` —
**no new migration**.

**Verified** — `tsc --noEmit` passes for API + web; web production build succeeds. Live verification pending
deploy (dev DB lacks the new columns until the migration is pushed) + the `jobsheets` module being enabled.

**Deferred (noted):** `source='inspection'` is NOT set on the MRI auto-create path — grouping uses the parent
column (jobsheet_id vs health_check_id), so it isn't needed; inspection lines simply have `source=NULL`.
Injecting VHC-less jobs into the **drag-drop kanban** (cards are health_check-keyed: moves/clocking/notes) is a
follow-on — Phase 3 surfaces them on the **Tile page** (Future Bookings), which is the forward-bookings view.

## 0. TL;DR

Add a **Work Details** section to the jobsheet: **labour lines + parts lines**, a **Booking Notes**
overview box, and the ability to drop in a **Package** (menu pricing) in one click.

**Two headline decisions (locked with Leo 2026-06-23):**

1. **Reuse the pricing engine, don't rebuild it.** The app already has a battle-tested repair engine
   (`repair_items → repair_labour + repair_parts`, server-side VAT/total triggers, `labour_codes`,
   `suppliers`, parts catalogue, margin calculator, **Service Packages**). A jobsheet work line **is** a
   `repair_item` — reused, not reinvented.
2. **Booked work belongs to the *jobsheet*, and the VHC is optional.** Booked work is _agreed at
   reception_ and is conceptually different from VHC _inspection findings_; and **some vehicles won't
   need an inspection at all**. So booked work lines attach to the **jobsheet** (not a health check),
   and the **VHC is created by default but can be cancelled at booking** ("Requires VHC" toggle,
   default ON). The **jobsheet is the visit/workshop entity** (Option 2) — it owns its own Vehicle
   Status and due-in date; the VHC is an optional child that adds inspection findings.

Net new schema is small (5 additive columns, no destructive changes). Everything else is API glue + UI.

---

## 1. What "Work Details" is

On the Garage Hive jobsheet, below the booking header sits the **work**: a list of lines, each either
**Labour** or an **Item** (a part, a consumable, or an external/sublet service), priced with VAT and
margin, optionally pre-filled from a **Service Package** (e.g. "Full Service" = labour + oil + filters
at a fixed price). Plus a free-text **notes** box describing the job / customer concern.

We want the same things on the Ollo jobsheet:

1. **Labour lines** — what work, how long, at what rate.
2. **Parts lines** — what parts, quantity, cost/sell, supplier, margin.
3. **A Booking Notes box** — a single overview of the job ("Customer reports knocking front-left on
   full lock + due a full service & MOT").
4. **Packages** — pick a pre-built menu bundle and have its labour + parts dropped in.

---

## 2. How real GMS systems handle this (research)

**Garage Hive** (the model we're following) structures jobsheet work as **lines**, each with a
**Type**:

| GH line Type | Sub-types | What it is |
|---|---|---|
| **Labour** | Service labour · Standard labour · Other labour | Time × rate. Labour "categories"/cards with standard times. |
| **Item** | Inventory items (oil, filters) · Non-inventory (consumables) · **External services (sublet)** | Parts and bought-in/outsourced work. |

Pricing per line: a **"Unit Price (Calc) Incl. VAT"** popup shows **Unit Price, Margin %, Unit Price
Incl. VAT, Total Incl. VAT** — i.e. price by margin, see VAT live. **Service Packages** "automatically
populate jobsheets with labour lines, items and external services… for fixed-price servicing."
The progression is **Estimate → Jobsheet → Invoice**, with the invoice built from the approved lines.

**The important finding: every one of those concepts already exists in this codebase.**

| Garage Hive concept | Already in Ollo as |
|---|---|
| Labour line (category + standard time) | `repair_labour` + `labour_codes` (code, hourly_rate, vat-exempt, default) |
| Item line (part / consumable) | `repair_parts` (part_no, qty, cost, sell, supplier, margin/markup) |
| External service / **sublet** | _(gap)_ — represent as a part line for now; dedicated type later |
| Unit Price (Calc) w/ Margin% + VAT | `POST /api/v1/pricing/calculate` + `/calculate-from-sell`; `org_settings.default_margin_percent` |
| VAT on net → gross | server-side `calculate_repair_item_totals()` triggers; `org_settings.vat_rate` |
| **Service Packages** (auto-populate) | `service_packages` (+ `_labour`, `_parts`) + `apply-service-package` |
| A line grouping labour+parts | `repair_items` (name, description, totals; `is_group` + `parent_repair_item_id`) |
| Estimate → Jobsheet → Invoice | `repair_items` quote/outcome lifecycle (`quote_status`, `customer_approved`, `outcome_status`) |

So this phase is **mostly reuse + UI**, not new infrastructure.

_Sources:_ [Garage Hive — Using the Jobsheet](https://docs.garagehive.co.uk/docs/garagehive-create-a-jobsheet.html),
[Labour Cards & Standard Times](https://docs.garagehive.co.uk/docs/garagehive-create-a-labour-card.html),
[Item Price/Discount Groups](https://docs.garagehive.co.uk/docs/item-price-discount-groups.html),
[Processing a Jobsheet to Invoice](https://docs.garagehive.co.uk/docs/garagehive-trial-processing-a-jobsheet-to-invoice.html),
[Workshop management](https://garagehive.co.uk/features/workshop-management-with-garage-hive/).

---

## 3. Architecture — reuse the engine; booked work belongs to the jobsheet

### 3.1 Two kinds of work, two parents
A visit has **two conceptually distinct** kinds of work, and we keep them physically distinct:

| | **Booked work** | **Inspection-found work** |
|---|---|---|
| Origin | Agreed at reception | Discovered during the VHC (red/amber) |
| Exists when | Jobsheet is created | An inspection is performed |
| Approval | **Pre-authorised** (customer booked it) | Needs the normal sign-off |
| Parent | **the jobsheet** (`repair_items.jobsheet_id`) | the VHC (`repair_items.health_check_id`) |
| `source` | `'booking'` | `'inspection'` |

Both are `repair_items` (so the **same pricing engine** prices both), but they hang off **different
parents**. That's what makes "booked items are different to VHC items" true structurally, not just by a
flag — and it's what lets booked work exist **with no VHC at all**.

### 3.2 Polymorphic work-line parent
Today `repair_items.health_check_id` is `NOT NULL`. We relax that:

- Add `repair_items.jobsheet_id` (nullable FK → jobsheets).
- Make `repair_items.health_check_id` **nullable**.
- `CHECK` that **at least one** of (`health_check_id`, `jobsheet_id`) is set.

The pricing triggers are safe with this: `calculate_repair_item_totals()` reads the repair_item's **own**
`organization_id` (and `org_settings.vat_rate`) — it never needs the health check. Existing health-check
flows are untouched (their items keep `health_check_id`; `jobsheet_id` stays NULL). Build task: audit the
few code paths that assume `health_check_id` is non-null.

The jobsheet's full Work Details = **its own booked lines** (`jobsheet_id = :id`) **∪** **its VHC's
findings** (`health_check_id` where `health_checks.jobsheet_id = :id`), grouped by `source`, rolling up
to one document total for invoicing.

### 3.3 The VHC is optional (default-on, opt-out at booking)
The jobsheet **no longer hard-requires** a VHC. At booking there's a **"Requires VHC"** toggle,
**default ON**. We add `jobsheets.vhc_required BOOLEAN DEFAULT true`:

- `vhc_required = true` (default) → create the linked VHC as today (revises `JOBSHEET.md` §7 from
  "always" to "unless cancelled").
- `vhc_required = false` → **no** health_check is created. The jobsheet stands alone with its booked
  work. The advisor can still start a VHC later from the jobsheet if plans change.

### 3.4 The jobsheet is the visit/workshop entity (Option 2) — staged
Leo chose **Option 2**: the jobsheet — not a hidden health check — is the top-level visit. So Vehicle
Status (the workshop position: `due_in → arrived → in_workshop → work_complete → collected`) belongs to
the **jobsheet**. We add `jobsheets.job_state` (default `'due_in'`) as its source of truth, plus its
existing `due_in_date`/`due_in_time`.

Completing Option 2 means the **Tile page + workshop board + Future Bookings** must read *jobsheets*
(so a VHC-cancelled booking still appears on the floor) — that's a real rewrite of the board/tile RPCs I
built in Phase 1.2. To de-risk, **we stage it**:

- **Phase 2 (this plan):** the jobsheet *carries* `job_state`; the detail page shows it; booked work +
  opt-out ship. The board/tiles are **not yet** rewritten.
- **Phase 3 (separate):** migrate the Tile page + workshop board + Future Bookings to be
  **jobsheet-driven** for GMS orgs (union jobsheets; exclude jobsheet-linked health checks to avoid
  double-counting; non-GMS orgs keep running on health checks unchanged).

> **Interim caveat (until Phase 3):** a jobsheet with the VHC **cancelled** has no health check, so it
> won't show on the workshop board / tiles yet — it's managed from the **Jobsheets list**. Jobsheets
> that keep their VHC (the default) appear on the board exactly as today (via the VHC). Phase 3 closes
> the gap so opted-out jobs appear on the board too.

### 3.5 Rejected alternative
A separate `jobsheet_labour` / `jobsheet_parts` engine would duplicate the triggers/VAT/margin logic
(high effort, divergence risk), fork the Packages apply path, and force a painful merge of jobsheet
lines + VHC items at invoice time. Reusing `repair_items` with a polymorphic parent gives clean
separation **and** one pricing engine **and** one invoice rollup.

---

## 4. Data model — additive only

| Change | Type | Why |
|---|---|---|
| `repair_items.jobsheet_id` | UUID FK → jobsheets, nullable | Booked work lines hang off the jobsheet (no VHC needed). |
| `repair_items.health_check_id` | → **nullable** (+ `CHECK` at least one parent) | Allow a work line with a jobsheet parent only. |
| `repair_items.source` | `VARCHAR(20)` nullable | `'booking'` · `'inspection'` · `'manual'` · `NULL` (legacy). Secondary discriminator + reporting. |
| `jobsheets.vhc_required` | `BOOLEAN DEFAULT true` | The "Requires VHC" booking toggle (opt-out). |
| `jobsheets.job_state` | `VARCHAR(20) DEFAULT 'due_in'` | The jobsheet's own Vehicle Status (Option 2). Same value set as `health_checks.job_state`. |
| `jobsheets.booking_notes` | `TEXT` | The Work Details **overview box**, distinct from `customer_contact_notes`. |

```sql
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS jobsheet_id UUID REFERENCES jobsheets(id) ON DELETE CASCADE;
ALTER TABLE repair_items ALTER COLUMN health_check_id DROP NOT NULL;
-- at least one parent (named CHECK, guarded so re-runs don't error)
DO $$ BEGIN
  ALTER TABLE repair_items ADD CONSTRAINT repair_items_parent_chk
    CHECK (health_check_id IS NOT NULL OR jobsheet_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS source VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_repair_items_jobsheet ON repair_items(jobsheet_id) WHERE jobsheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repair_items_source   ON repair_items(source)      WHERE source IS NOT NULL;

ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS vhc_required  BOOLEAN     DEFAULT true;
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS job_state     VARCHAR(20) DEFAULT 'due_in';
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS booking_notes TEXT;
```

**Reused as-is (no change):** `repair_labour`, `repair_parts`, `repair_options`, `labour_codes`,
`suppliers`, parts catalogue, `service_packages` (+`_labour`/`_parts`), `organization_settings.vat_rate`
/ `default_margin_percent`, and the `calculate_repair_item_totals()` / `…_option_totals()` triggers.

**Also:** set `source='inspection'` in the MRI auto-create path
(`health-checks/helpers.ts → autoCreateMriRepairItems`) so the three origins are clean (one line).

---

## 5. API design — reuse first, one thin router

A jobsheet work line **is** a `repair_item`, so editing labour/parts reuses the **existing** repair
endpoints. We add a small jobsheet-scoped router so the UI doesn't juggle parents, so `source='booking'`
+ pre-authorisation are set server-side, and so it's gated by `requireModule('jobsheets')`.

**New (thin) — `apps/api/src/routes/jobsheets/work-lines.ts`** (under `/api/v1/jobsheets/:id`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/jobsheets/:id/work-lines` | List booked lines (`jobsheet_id`) **∪** the VHC's findings, with labour/parts/totals/source. |
| POST | `/jobsheets/:id/work-lines` | Create an empty **booked** line (`jobsheet_id` set, `source='booking'`, pre-authorised). |
| POST | `/jobsheets/:id/work-lines/from-package` | `{ servicePackageId }` → create a booked line named after the package **and** apply it (reuses `applyServicePackageToRepairItem`). One-click menu pricing. |

**Pre-authorisation:** booked lines are created with `outcome_status='authorised'`, `customer_approved=true`
(advisor can still change). Inspection lines keep the normal flow.

**Extend — `PATCH /api/v1/jobsheets/:id`**: accept `bookingNotes`, `vhcRequired`, and (Option 2)
`jobState`. **Create — `POST /api/v1/jobsheets`**: honour `vhcRequired` (skip VHC creation when false);
set `jobsheets.job_state='due_in'`.

**Reused as-is (no new code):** add/edit/delete **labour** → existing `…/repair-items/:id/labour`;
**parts** → `…/repair-items/:id/parts`; apply a **Package** to an existing line →
`…/repair-items/:id/apply-service-package`; **price/margin** → `…/pricing/calculate`; labour-code /
supplier / parts-catalogue lookups → existing endpoints.

All new routes filter by `organization_id` and resolve the linked `health_check_id` server-side (never
trust it from the client).

---

## 6. Web UI

### 6.1 JobsheetDetail — a "Work Details" panel (the core)
A new section on `JobsheetDetail.tsx`, below the booking header:

- **Booking Notes** — textarea (`booking_notes`), saved via the jobsheet PATCH on blur.
- **Work lines** — grouped **Booked** vs **Inspection**, each line showing name, labour/parts subtotals,
  line total inc-VAT, and an authorised/needs-sign-off chip. Expand to edit labour + parts rows.
  - **Add work line** → `POST …/work-lines` (booked, pre-authorised), then add labour/parts.
  - **Add from Package** → package picker (feed the existing `ServicePackageApplyModal` pattern) →
    `POST …/work-lines/from-package`. One click = menu pricing.
  - **Add labour** → labour-code dropdown + hours (rate auto-fills) → existing labour endpoint.
  - **Add part** → catalogue autocomplete + qty + cost/sell with the **margin calculator** popup →
    existing parts endpoint.
- **Document totals** — Labour / Parts / Net / VAT / **Total inc VAT** for the whole jobsheet.
- **Vehicle Status** — shows `jobsheets.job_state` (Option 2). When a VHC exists it currently mirrors
  the VHC's state; Phase 3 makes the jobsheet the single source.

> **Reuse over rebuild:** the HealthChecks pricing screen already has these widgets (`RepairItemRow`,
> labour/parts forms, `ServicePackageApplyModal`, margin popup). End-state: extract a shared
> `<WorkDetailsPanel parent={{type:'jobsheet'|'healthCheck', id}} />`. Pragmatic Phase-2 path: build the
> jobsheet panel against the existing APIs, lifting the self-contained bits first; extract the shared
> component as a follow-up so the two screens don't drift.

### 6.2 NewJobsheet — booked work + the VHC toggle
- **"Requires VHC"** toggle (default ON) — un-tick to skip VHC creation.
- **Booking Notes** textarea.
- **Add Package(s)** — pick menu packages to pre-load; on submit they become booked, pre-authorised
  lines. Manual labour/parts editing stays on the detail page (keeps the form lean).

### 6.3 Shared types
`packages/shared/src/types`: add `JobsheetWorkLine` (work-line shape with labour/parts arrays + `source`),
and surface `bookingNotes` / `vhcRequired` / `jobState` on the `Jobsheet` type. (The existing `RepairItem`
shared type is stale vs the live schema — define the work-line type fresh from the actual columns.)

---

## 7. Packages integration

Packages already populate a `repair_item` with labour + parts, so "add Packages to jobsheets" =
**expose the existing apply flow at the jobsheet level** via the `from-package` endpoint + a picker in
both the detail panel and the New form. No package schema/pricing changes. A package on a jobsheet
becomes a booked, pre-authorised `repair_item` (name = package name) with its labour/parts — exactly GH
"service packages auto-populate the jobsheet." Future polish: one package → several distinct lines; a
quick-pick of common packages on the New form.

---

## 8. Pricing & totals

Untouched and reused: per-line `labour_total / parts_total / subtotal / vat_amount / total_inc_vat` are
maintained by existing DB triggers on every labour/parts change; VAT only on VAT-liable lines (MOT
labour stays exempt). The jobsheet **document total** is the sum of its lines' `total_inc_vat` (booked +
inspection). Margin/markup per part via the existing calculator. Nothing to rebuild.

---

## 9. Migration

One additive, `IF NOT EXISTS` / guarded migration (e.g. `20260623180000_jobsheet_work_details.sql`):
the §4 columns + the parent `CHECK` + indexes. No data migration, no destructive changes. Deploy via the
pipeline (`supabase db push` on push to `dev`) — **not** raw MCP SQL — per the migration-drift rule.

---

## 10. Scope & phasing

**Phase 2 (this plan — Work Details + VHC optionality):**
- Migration: §4 columns (polymorphic `repair_items` parent, `vhc_required`, `job_state`, `booking_notes`, `source`).
- `work-lines` router (list / create / from-package) + jobsheet PATCH/POST for notes, `vhcRequired`, `jobState`.
- JobsheetDetail **Work Details** panel (booked vs inspection, labour + parts, Packages, totals).
- NewJobsheet: **Requires VHC** toggle (default on) + Booking Notes + package pre-load.
- Booked lines **pre-authorised**. Reuses all existing repair/labour/parts/pricing/package APIs.

**Phase 3 (next — completes Option 2):**
- Make the **Tile page + workshop board + Future Bookings** jobsheet-driven for GMS orgs (so
  VHC-cancelled bookings appear on the floor); exclude jobsheet-linked health checks to avoid
  double-counting; non-GMS orgs unchanged. Unify Vehicle Status onto `jobsheets.job_state`.

**Out of scope (future):**
- **Sublet / external-services** as a first-class line type (represent as a part line for now).
- Stock control / live inventory; invoice posting / PDF + accounting export; standard-times library;
  discount/item-price groups; the fully-shared `<WorkDetailsPanel>` extraction (recommended follow-up).

---

## 11. Decisions

**Locked (Leo, 2026-06-23):**
1. ✅ **Reuse the VHC repair engine** — a jobsheet work line is a `repair_item`. No parallel pricing tables.
2. ✅ **Booked work belongs to the jobsheet** (`repair_items.jobsheet_id`; `health_check_id` nullable) —
   structurally separate from VHC inspection findings.
3. ✅ **VHC is optional, default-ON, opt-out at booking** (`vhc_required` + "Requires VHC" toggle).
4. ✅ **Jobsheet is the visit/workshop entity** (Option 2; `jobsheets.job_state`) — board/tile migration
   **staged to Phase 3**.
5. ✅ **Booked work is pre-authorised**; inspection extras use the normal sign-off.
6. ✅ **Sublet** represented as a part line for now; dedicated type later.

**Open / my call unless you object:**
- Extract the shared `<WorkDetailsPanel>` now vs build a focused jobsheet panel first and extract later
  _(lean: ship focused, extract in a follow-up)_.
- Whether a "Requires VHC = false" booking should still let the advisor **start a VHC later** from the
  jobsheet _(lean: yes — keep it available)_.
