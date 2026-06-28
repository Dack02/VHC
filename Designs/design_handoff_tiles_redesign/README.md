# Handoff: Tiles page redesign (Option A — Refined status cards)

## Overview
A visual + interaction refresh of the existing **Tiles Status** page
(`apps/web/src/pages/TileStatus/`). Same data, same drill-in model — but a clearer
card anatomy (status-icon chip, large tabular count, ageing pill, a vehicle-status
distribution bar, breakdown chips, VHC footer), an optional KPI summary ribbon, and
**threshold-based ageing colours** (the "threshold colours" item your tile-status spec
deferred). No API or data-model changes are required.

## About the design files
The files in this bundle are **design references created in HTML** — a prototype showing
the intended look and behaviour, **not** production code to copy. The task is to
**recreate this design in the existing web app** (`apps/web`, React + TypeScript +
Tailwind + Vite) using its established patterns. The page already exists; this is an
**edit of existing files**, not a new feature:

- `apps/web/src/pages/TileStatus/TileStatusPage.tsx` — the grid + `TileCard` + drill-in `JobList`
- `apps/web/src/pages/TileStatus/types.ts` — labels + `daysLabel`/age helpers (mostly reused)
- `apps/web/src/pages/TileStatus/useTileData.ts` — **unchanged** (same `TilesResponse`)

The HTML reference uses inline styles and the `lucide` CDN for convenience. In the app,
use **Tailwind classes** (matching the current file's conventions) and the app's existing
inline-SVG icons — do **not** add the lucide dependency.

## Fidelity
**High-fidelity.** Colours, typography, spacing and interactions are final. Recreate the
UI to match, using Tailwind utilities and the existing component structure.

## What stays the same (do not rebuild)
- Data fetching: `useTileData()` and the `GET /api/v1/workshop-board/tiles` response.
- Drill-in fetch: `GET /api/v1/workshop-board/tiles/jobs?status=<id|none>` via `openTile`.
- Routing/landing, the `Tile` / `TileJob` types, `jobPath()` linking, socket refresh.
- The terminology ("Job Status", "Vehicle Status", VHC) and all label maps in `types.ts`.

---

## Screens / Views

### 1. Tile grid (default view)

**Purpose:** at-a-glance live job counts per Job Status; click a tile to drill in.

**Layout (top → bottom):**
1. **Header row** — `flex items-end justify-between`, `mb-[22px]`, wraps on narrow.
   - Left: `<h1>` "Tiles" (28px / 800 / -0.025em tracking, `#16181d`) + a "Live" pill
     (green dot `#2c9367` + "Live" 12px/600). Subtitle below: "Job counts by status ·
     {site.name}" (13.5px, `#7b7f88`).
   - Right: a segmented **scope toggle** (Open | Today — Open selected, dark `#16181d`
     pill on white track), an **All advisors** dropdown button, and an icon-only
     **Refresh** button (38×38). All: white bg, `border #e6e6e3`, radius 9px, 12.5px/600
     text `#5f636c`, hover `#f7f7f5`. *(Scope + advisor are presentational here — see
     "Deferred" below.)*
2. **KPI ribbon** (optional, behind a flag) — `grid grid-cols-4 gap-3 mb-[22px]`. Four
   white cards (`border #ededeb`, radius 13px, padding 14×17): uppercase 11px/700 label
   `#a4a8b0` + 24px/800 value. See "KPI ribbon" for values/colours.
3. **Tile grid** — `grid gap-[14px]`, columns `repeat(auto-fill, minmax(258px, 1fr))`
   (replaces the current fixed `sm:2 / lg:3 / xl:4` breakpoints).

**TileCard anatomy** (replaces the current `TileCard`):
A white `<button>`, full width, `text-left`, `border #ededeb`, radius 14px, padding 16px,
`flex flex-col`. Hover: `border #d6d6d2`, `box-shadow 0 4px 14px rgba(0,0,0,.06)`,
`translateY(-1px)`, transition 120ms.

- **Row 1 — identity** (`flex items-center gap-[10px] mb-[14px]`):
  - Icon chip: 34×34, radius 9px, centered. `background: {colour}1F` (status colour at
    ~12% alpha), icon stroke in `{colour}`. Map each status to an icon (the API returns an
    `icon` field, e.g. `ti-key`; map those to your icon set, or pick per status — see
    "Icon mapping").
  - Status name: 13.5px / 700 / `#16181d`, line-height 1.18.
- **Row 2 — count + age** (`flex items-end justify-between mb-[13px]`):
  - Count: 31px / 800 / -0.025em / `#16181d`, `font-variant-numeric: tabular-nums`, with
    a 12px `#a4a8b0` "jobs" baseline label beside it.
  - **Ageing pill** (right): pill, radius 20px, padding 3×9, 11.5px/600, clock icon
    (13px) + `daysLabel(oldestDays)`. Colour by threshold — see "Ageing thresholds".
- **Distribution bar** (`flex gap-[2px] mb-[11px]`): one segment per non-zero Vehicle
  Status, `height 7px`, radius 3px, `flex-grow` = that status's count, background = the
  Vehicle Status colour (see tokens). Gives an instant proportion read.
- **Breakdown chips** (`flex flex-wrap gap-x-[11px] gap-y-[5px] mb-[12px]`): top 2 Vehicle
  Statuses by count as `● Label N` (7×7 rounded-2px dot in the status colour, label
  11.5px/500 `#5f636c`, count 700 `#16181d`). If more than 2, a `+N` in `#a4a8b0`.
- **VHC footer** (`border-top #f1f1ef`, `pt-[10px] mt-auto`, `flex items-center gap-2`):
  a mono "VHC" micro-label (10px, IBM Plex Mono, `#a4a8b0`) + a truncated summary string
  like "19 parts pricing · 4 pricing" (11.5px `#7b7f88`). Build from `tile.vhcState` the
  same way the current `summarizeCounts` does.

### 2. Drill-in (job list)

**Purpose:** the jobs behind a tile, oldest-in-status first. Same fetch + row→`jobPath`
navigation as today; restyled.

**Layout:**
- **Back link**: "← Back to tiles" (arrow icon 15px + 12.5px `#7b7f88`, hover `#16181d`),
  `mb-[16px]`. Sets `selected = null`.
- **Header** (`flex items-center justify-between flex-wrap gap-4 mb-[18px]`): the tile's
  36×36 icon chip + `<h1>` name (24px/800) + "{count} jobs" (14px `#a4a8b0`) + an ageing
  pill reading "oldest {daysLabel}". Right: a muted note "Showing oldest 10 of {count}"
  (or "Showing oldest first" when count ≤ rows returned).
- **Table** in a white card (`border #ededeb`, radius 14px, `overflow:hidden`;
  inner `overflow-x:auto`, `min-width: 880px`). Columns: **Job · Vehicle · Customer ·
  Advisor · Tech · Vehicle status · VHC state · Due · Waiting**.
  - Header row: `bg #fafaf8`, 10.5px uppercase `#a4a8b0`, `tracking-wide`, padding 11×16.
  - Body rows: `border-top #f1f1ef`, hover `bg #fafaf8`, cursor pointer → `jobPath(job)`.
    - Job no.: 700 `#16181d`, tabular-nums.
    - Vehicle cell: a **registration plate** chip (IBM Plex Mono 10.5px, `bg #fdf6dd`,
      `border #efe2a8`, text `#796a1f`, radius 4px, padding 2×6) + make/model (12px
      `#7b7f88`).
    - Vehicle status: 7×7 round dot in the Vehicle Status colour + `labelForVehicle`.
    - VHC state: `labelForVhc(vhcStatus)`.
    - Due: `formatDue(dueDate)` (existing helper).
    - Waiting: ageing pill (clock + `daysLabel(daysInStatus)`; for the Future tile use
      `dueCountdownLabel` as today).

---

## Interactions & Behavior
- **Tile click** → `openTile(tile)` (existing): set `selected`, fetch jobs, show drill-in.
- **Back** → `setSelected(null)`.
- **Row click** → `navigate(jobPath(job))` (existing).
- **Refresh** → `refresh()` (existing).
- **Hover**: tile lift + shadow (above); rows tint `#fafaf8`; buttons tint `#f7f7f5`.
- **Loading / error / empty**: keep the current Spinner, red error panel, and empty
  states; restyle only to match (cards `border #ededeb`, radius 14px).
- **Responsive**: grid reflows via `auto-fill minmax(258px,1fr)`; KPI ribbon may drop to
  2 cols under ~640px; table scrolls horizontally.

## State Management
Unchanged from the current page: `selected: Tile | null`, `jobs`, `jobsLoading`,
`jobsError`, plus `tiles/loading/error` from `useTileData()`. **New (optional):**
- KPI ribbon visibility — a simple boolean (default on). Can be hardcoded `true` or a
  small UI/setting; not required for v1.
- Ageing thresholds `warnDays` / `critDays` — see below. Default constants are fine for
  v1; wiring them to the deferred per-org settings is the natural follow-up.

## Ageing thresholds (the deferred "threshold colours")
The ageing pill colour is derived from the day count:

```
warnDays = 3   // ≥ this → amber
critDays = 8   // ≥ this → red
level = days >= critDays ? 'crit' : days >= warnDays ? 'warn' : 'ok'
```

| level | text colour | background |
|-------|-------------|------------|
| ok    | `#7b7f88`   | `#f0f0ee`  |
| warn  | `#a9760f`   | `#f6ead0`  |
| crit  | `#c0403b`   | `#f7e4e2`  |

`daysLabel` (0 → "Today", 1 → "1 day", n → "n days") is unchanged. The same pill +
thresholds are used on tiles, the drill-in header, and the "Waiting" column.
This implements §6's deferred "threshold colours for the ageing pill" — start with the
constants above; later read them from per-org settings.

## Design Tokens

**Greys / ink**
- Ink `#16181d` · body `#5f636c` · muted `#7b7f88` · faint `#a4a8b0`
- Surface white `#ffffff` · page `#f4f4f2` · hairline `#f1f1ef` · border `#ededeb` /
  `#e6e6e3` · hover surface `#fafaf8` / `#f7f7f5`

**Status accent (Job Status)** — comes from `tile.colour` (API). Icon chip bg = colour at
`1F` hex alpha. Sample colours used in the mock: check-in `#8a8f98`, in-workshop
`#2f6bdf`, parts `#c2841c`, authorisation `#7c5cd6`, road-test `#0d9488`, QC `#4b56e6`,
ready `#2c9367`, no-status `#9ca3af`.

**Vehicle Status colours** (for the bar + dots)
- due_in `#c4c8cf` · arrived `#8390f0` · in_workshop `#2f6bdf` ·
  work_complete `#2c9367` · collected `#d3d6db`

**Registration plate**: bg `#fdf6dd`, border `#efe2a8`, text `#796a1f`, IBM Plex Mono.

**Live green** `#2c9367` · **KPI accent examples**: oldest-wait `#c0403b`,
needs-attention `#a9760f`, ready `#2c9367`.

**Typography**: Hanken Grotesk (already the app `sans`); IBM Plex Mono (already the app
`mono`) for reg plates + the VHC micro-label.
- h1 28px/800/-0.025em · drill h1 24px/800 · card count 31px/800/-0.025em tabular ·
  card name 13.5px/700 · body 13px · chips/labels 11–12.5px · micro 10–10.5px.

**Radii**: cards 14px · icon chip / KPI 9–13px · pills 20px · bars/plates 3–4px.
**Shadows**: tile hover `0 4px 14px rgba(0,0,0,.06)`.

## KPI ribbon (optional)
Four cards. In the mock they read: **Active jobs** 170 (`#16181d`) · **Oldest wait**
9 days (`#c0403b`) · **Needs attention** 4 tiles (`#a9760f`) · **Ready to collect** 31
(`#2c9367`). Derive these from the `tiles` array client-side:
- Active jobs = Σ `tile.count`.
- Oldest wait = max `tile.oldestDays` (+ apply threshold colour).
- Needs attention = count of tiles whose `oldestDays >= warnDays`.
- Ready to collect = count of the "Ready for collection" tile (or sum of work_complete).
No new endpoint needed.

## Icon mapping
The API returns a per-status `icon` (e.g. `ti-key`, Tabler-style). Map these to the app's
existing icon component. If a status has no icon, fall back by name. The mock used:
check-in→clipboard-check, in-workshop→wrench, parts→package, authorisation→help-circle,
road-test→route, QC→badge-check, ready→key, no-status→dashed-circle.

## Assets
No raster assets. Icons come from the app's existing icon set (do not add lucide).
Fonts (Hanken Grotesk, IBM Plex Mono) are already configured in `tailwind.config.js`.

## Files in this bundle
- `Tiles A.dc.html` — the high-fidelity Option A reference (open in a browser; click a
  tile to see the drill-in; the design's tweak panel toggles the KPI ribbon and the
  warn/crit day thresholds).
- `Tiles Redesign (3 directions).dc.html` — the original exploration (A refined cards,
  B pipeline lanes, C attention-first control room) for context on rejected directions.
- `support.js` — runtime needed only to open the `.dc.html` files locally; not for the app.

## Files to change in the app
- `apps/web/src/pages/TileStatus/TileStatusPage.tsx` — rewrite `TileCard`, add the header
  scope/advisor/refresh controls + optional KPI ribbon, switch the grid to
  `auto-fill minmax(258px,1fr)`, restyle `JobList` (plate chip, status dots, waiting pill,
  drill header). Add a small `agePill(days, {warnDays, critDays})` helper for the pill
  colour logic.
- `apps/web/src/pages/TileStatus/types.ts` — reuse as-is; optionally add the
  `warnDays`/`critDays` constants + `agePill` helper here if you prefer co-locating them.
