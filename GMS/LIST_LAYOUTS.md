# Job Sheets & Estimates list redesign — dense, columnar, triage-first

**Status:** Plan (not started) · **Authored:** 2026-06-29
**Touches:** `apps/web/src/pages/Jobsheets/JobsheetList.tsx`, `apps/web/src/pages/Estimates/EstimatesList.tsx`, `apps/api/src/routes/jobsheets.ts`, `apps/api/src/routes/estimates.ts` (+ one new shared web component)

---

## 1. Problem

Both list pages are **single-column flex rows wearing a table's job**. Each row crams
~8 structured attributes (reference, customer, reg, status, dates, advisor, badges) into
one free-flowing strip with **no column alignment**, inside a constrained `max-w-6xl`
container. The advisor's real task — *"which is overdue, who hasn't responded, what's the
biggest job?"* — is **cross-record comparison of one attribute down many rows**, which an
unaligned list structurally cannot serve.

Concrete defects shared by both pages:

- **Wasted width** — a ~1100px row carries ~6 short fields with large empty gaps; few
  records visible per screen.
- **No column alignment** — you can't scan straight down "Customer" or "Status".
- **No money anywhere** — neither list shows job/quote value (the single most-wanted
  triage field). It isn't even in the list payload (see §6).
- **Search is reference-only** — `ilike('reference', …)`. You can't find a job by reg,
  customer, or vehicle, which is how staff actually look things up.
- **No sort, no status tabs, no filters** — locked to `created_at DESC`; active and
  completed/declined records interleave in one undifferentiated stream.
- **Hard 50-row ceiling** — frontend never sends `offset`; `total` is ignored; older
  records are unreachable.
- **~60% of returned data is thrown away** — the APIs already return RAG counts, MOT
  status, check-in/arrival state, response timeline, expiry, conversion links, advisor —
  none surfaced.
- **Badges vanish on mobile** (`hidden sm:flex`), leaving rows ambiguous.

## 2. Verdict (opinionated)

Replace both flex lists with **one dense, column-aligned table per page**, fronted by a
**count-tile strip** and **status tabs with live counts**, money **right-aligned** with
tabular figures, a sticky **totals footer**, and an **"N-days" urgency pill**. Degrade
responsively (full table → priority columns + frozen identity + h-scroll → stacked
2–3-field rows). **Not** a card grid (no decision-carrying image; breaks comparison).
**Not** a Kanban board as the primary surface (kills density + cross-record comparison),
though a board may be an optional secondary toggle later.

This was validated by competitive research (Garage Hive's dense BC grid + per-status
count tiles; MAM's saved WIP views; Tekmetric/Shopmonkey boards' progress/comms glyphs
lifted *into* table cells) and is unanimous with general dense-list UX guidance.

### Why a table, not cards
Cards win only when a **decision-carrying image** drives recognition (vehicle photo,
avatar). Job sheets and estimates have no thumbnail; cards waste horizontal space,
scatter the same field to different on-card positions (killing vertical scanning), and
fit fewer records per screen.

## 3. Surface anatomy (top → bottom)

```
┌ Count-tile strip ─ clickable saved-filter counts: "On site 6", "Awaiting auth 3" (red),
│                    "Awaiting parts 2" (amber), "Ready to invoice 4", "Overdue 1" (red)
├ Status tabs ───── segmented, single-axis pipeline filter, live count badge per tab,
│                    + one universal search box (reg + customer + ref + make/model)
├ Active-filter ─── removable chips (advisor, date range, £ threshold, tag) when applied
├ Dense table ───── sticky header, sortable headers, fixed-height single-line rows,
│                    1px dividers, hover highlight, whole-row click → detail
└ Totals footer ── sticky: "18 active jobs · £12,480.65" (recomputed under active filter)
```

The count tiles are just **saved-filter counts promoted to navigation** — cheap to build
on the existing `status` / `job_state` enums; they answer "what needs action now" without
scanning.

## 4. Columns — Job Sheets

Order = the advisor's decision sequence (*who → what state → how urgent → how valuable*).
Default visible set ≈ 6; everything else behind show/hide or a right-hand detail pane.

| # | Column | Source (already in payload unless noted) | Render |
|---|--------|------------------------------------------|--------|
| 1 | **Job** (frozen) | `reference` + `dueInDate`/`dueInTime` | bold ref; 2nd line = **due/age pill** (accent when soon, **red "Overdue Nd"** past due) |
| 2 | **Vehicle** | `vehicle.registration` + make/model | **yellow number-plate chip** + muted make/model subline; MOT-due flag (`motExpiryDate`) as a small warn dot |
| 3 | **Customer** | `customer.{firstName,lastName}` + `advisor` | surname-first; advisor as muted subline or initials chip |
| 4 | **Status** | `vehicleStatus`/`healthCheck.status` | labelled colour-coded pill, fixed column position (see §7) |
| 5 | **R / A / G** | `healthCheck.{redCount,amberCount,greenCount}` | three compact count chips (red/amber/green); muted 0s |
| 6 | **Total** (right) | **new — see §6** | right-aligned, tabular, bold £ |
| — | *secondary (toggle/detail):* | `checkIn.*`, `courtesyVehicleRequired`, `collectionAndDelivery`, `invoiceNumber`, booking codes, labour-hours progress bar | — |

Optional high-value extra (nearly free given the tech-clocking model): a thin **labour
burndown bar** ("3 of 4 hrs") in the status or a dedicated column.

## 5. Columns — Estimates

Tuned for the **quote lifecycle**: the value is the sell number (anchor it right), and
"who hasn't responded / what's about to expire" is the core triage.

| # | Column | Source (already in payload unless noted) | Render |
|---|--------|------------------------------------------|--------|
| 1 | **Estimate** (frozen) | `reference` + `createdAt` / lifecycle date | bold ref; 2nd line = **expiry pill** from `validUntil` (green "Valid 12d" → **red "Expires 2d"**) or "Accepted/Declined Nd ago" |
| 2 | **Vehicle** | `vehicle.registration` + make/model | plate chip + make/model subline |
| 3 | **Customer** | `customer` + `advisor` | surname-first + advisor subline |
| 4 | **Status** | `status` (9-state) | labelled colour pill |
| 5 | **Comms** | `sentAt`, `firstOpenedAt`, `respondedAt` | **icon pair**: `ti-send` (sent) + `ti-eye`/`ti-eye-off` (opened); `ti-checks` accepted, `ti-x` declined |
| 6 | **Value** (right) | **new — see §6** | right-aligned, tabular, bold £ — the visual anchor |
| — | *secondary (toggle/detail):* | `convertedToJobsheetReference` (link to resulting job), `authorisedTotal`, `mileage`, notes | — |

## 6. Backend changes required

Everything in §4/§5 is already returned **except money**. Add a per-row total to both
list endpoints:

- **Estimates** (`apps/api/src/routes/estimates.ts` `GET /`): the list has **no total at
  all** today (totals only via `GET /:id/work-lines`). Add a `total` (and optionally
  `authorisedTotal`, already shaped) by aggregating `repair_items` for each estimate in
  the list. Prefer a single grouped query / RPC over N per-row calls. Watch the PostgREST
  1000-row cap — aggregate in the DB, don't fetch all items to the API.
- **Jobsheets** (`apps/api/src/routes/jobsheets.ts` `GET /`): totals are computed in
  `loadJobsheetExtras` for the **detail** view only. Promote a lightweight `total`
  (sum of `repair_items.price_override ?? total_inc_vat`) into the list query.

Both list endpoints **already support** `status`/`complete`, `site_id`, `date_from/to`,
`limit`/`offset` and return `total` — the frontend simply never uses them. Wire those up
for the tabs, filters, and pagination. **Extend `q`** to also match registration and
customer name (today it's `ilike('reference', …)` only).

> Cheapest sequencing: ship the **frontend table using only already-returned fields**
> first (RAG, status, dates, comms, advisor, plate), then add the money column once the
> aggregation lands. The list is a big improvement even before £ arrives.

## 7. Visual devices (reuse the existing vocabulary)

- **Status = labelled colour pill, never colour alone** (WCAG 1.4.1). Same x-position
  every row so preattentive colour scanning works. Reuse the app's RAG palette so the
  **same colour means the same urgency in tile, row, and diary**. Reserve saturated red
  for the urgent states (overdue, awaiting-auth, declined); keep the rest neutral — no
  rainbow tables.
- **Money:** right-aligned, `tabular-nums`/`font-mono`, fixed 2dp, weight 500.
- **Age:** "N days" pill, accent when upcoming → **red** + optional row stripe when
  overdue/expiring.
- **Comms (Estimates):** `ti-send` + `ti-eye` glyph pair, fixed position.
- **RAG (Jobsheets):** three compact red/amber/green count chips.
- **Row mechanics:** 1px light dividers (not heavy gridlines), always-on hover highlight,
  whole-row click, hover-revealed row actions / single `…` overflow menu, left colour
  stripe by urgency (matches `BookingRow`).

## 8. Sort / filter / saved views

- **Primary axis = status, as segmented tabs** with a **live count badge** per tab
  (Active / Due in / In workshop / Completed / All for jobs; Open / Sent / Accepted /
  Declined / All for estimates).
- **Default sort = most-actionable-first** (overdue / promised-soon / oldest-in-status),
  not `created_at DESC`. Default scope = active work; park terminal/cancelled behind the
  "All" tab.
- **Sortable headers** (asc/desc); numeric columns sort by magnitude.
- **One universal search box** (reg + customer + ref + make/model).
- **Secondary filters as removable chips** in a sticky active-filter bar (advisor, date,
  £ threshold, tag).
- **Saved / role-based views** (later): "My open jobs", "Awaiting parts", "Sent not
  authorised"; persist per user with a **reset-to-default**.

## 9. Responsive strategy (degrade, never pinch-zoom)

1. **Desktop:** full table, ~6 columns, sticky header.
2. **Tablet:** priority columns only; **horizontal scroll with frozen identity column
   (ref + plate) + sticky header**; scroll-shadow affordance; drop columns from the right
   by explicit priority.
3. **Phone:** collapse each row into a **stacked card of 2–3 fields** — line 1: plate +
   ref; line 2: customer + vehicle; status pill + £ + age pill aligned. Reinstate ARIA
   roles when stacking (a naked `display:block` table strips table semantics for screen
   readers).

**Density is a user toggle** (Compact ~40px / Regular ~48px / Comfortable ~56px), default
compact-but-readable (~44–48px). Below ~40px causes mis-row reads — don't make condensed
the silent default. Fixed-height, single-line, truncate + tooltip on overflow.

## 10. Reuse map (don't hand-roll)

The codebase already has every primitive; consolidate rather than invent:

- **`apps/web/src/pages/Reports/components/DataTable.tsx`** — the only generic typed
  `DataTable<T>` (sort + paginate + empty + `onRowClick`). **Promote to
  `apps/web/src/components/`** and adopt for both lists (and ideally retrofit
  Customers/HealthChecks/Parts over time).
- **`apps/web/src/pages/BookingDiary/shared.tsx`** — `Badge`, `BadgeStrip`, `CountPill`,
  `LoadBar` (capacity/progress bar), `BookingRow` (status stripe + density prop), the
  segmented-toggle + density patterns. Lift the plate-chip and status-stripe styling.
- **`apps/web/src/components/WorkflowBadges.tsx`** — T/L/P/S/A workflow + RAG chips.
- **`HealthCheckList.tsx`** — existing table + filter-card + kanban precedent (the
  optional board toggle, if pursued, should mirror its `@dnd-kit` setup).
- **Segmented view-toggle + `localStorage`** persistence (BookingDiary `VIEWS`,
  HealthChecks `ViewToggle`, Parts tabs) is the established home for a Table/Board and
  density switch.

**Visual direction:** target the newest house style (Tiles / "Direction 1" handoff +
`docs/form-design-guidelines.md`: dark `#16191f` neutral actions, `rounded-[10px]/[14px]`,
plate chip, tabular money) rather than the legacy square or mid-era indigo-card styles, so
the two lists become the reference implementation for the dense-list pattern.

## 11. Phased delivery

- **P1 — Table shell (frontend only, no API change):** replace both flex lists with a
  columnar table using only already-returned fields (ref, plate, customer, advisor,
  status pill, RAG/comms, dates). Sortable headers, hover, whole-row click, sticky header.
  Promote `DataTable` to shared. *Immediate, high-value, low-risk.*
- **P2 — Triage chrome:** status tabs with counts, universal search (extend `q` to
  reg+customer), `offset` pagination using the returned `total`, default actionable sort,
  active-work scoping, "N-days"/expiry pills, count-tile strip.
- **P3 — Money:** add list-level `total` to both endpoints (§6); right-aligned £ column +
  sticky totals footer; £-threshold filter.
- **P4 — Power features (optional):** saved/role-based views, show/hide/reorder columns,
  density toggle, right-hand FactBox detail pane, labour-hours progress bar (Jobsheets),
  optional secondary Board toggle.

## 12. Do / Don't

**Do:** column-align every field; freeze identity (ref + plate) left; right-align money
with tabular figures; status as a labelled colour pill in a fixed column; per-status count
tabs + sticky totals footer + age/expiry pills + comms icons; default-sort to
most-actionable; make density a toggle; degrade table → priority+frozen+h-scroll →
stacked rows.

**Don't:** use a card grid for these text/number records; keep the single flex row
carrying 8 attributes; centre-align (anything but icons) or left-align money; convey
status by colour alone or move the pill per row; h-scroll the whole table without a frozen
identity column; ship every attribute as a column; use heavy gridlines or rainbow fills;
make condensed the silent default; let users customise views then fail to persist them;
let terminal/cancelled records clutter the working list.
