# Tile Status Page + Status Terminology Rename — Spec

Status: **Planned** (not yet built). Authored 2026-06-21.

## 1. Goal

Add a **Tile Status page** to the web dashboard, modelled on Garage Hive's role‑centre
tiles. Each tile represents a **Job Status** (the org's configurable operational status)
and shows, at a glance:

- a **live count** of active jobs currently in that status,
- a breakdown of those jobs by **Vehicle Status** and by **VHC pipeline state**,
- an **ageing pill** = the number of calendar days the *longest‑waiting* job has sat in
  that status (e.g. `6 days`).

Clicking a tile drills into a filtered list of the jobs behind it.

Alongside this, a **UI terminology rename** (labels only — no DB/code identifier changes):

| Concept today (UI label) | New UI label | Underlying field (unchanged) |
|---|---|---|
| "Workshop status" / "Workshop Statuses" | **Job Status** | `workshop_statuses` table, `workshop_cards.workshop_status_id` |
| "Job state" / "Workshop job state" | **Vehicle Status** | `health_checks.job_state` |
| (unchanged) VHC pipeline status | (unchanged) | `health_checks.status` |

Rationale: `job_state` (`due_in → arrived → in_workshop → work_complete → collected`)
describes where the *vehicle* is; the workshop‑status flags (Awaiting Parts, On Road
Test, Quality Check, Ready for Collection…) describe what's happening with the *job*.

> The existing TCard/kanban board (`docs/workshop-tcard-board-spec.md`) is unchanged —
> it remains the board. This feature is the *tiles*, a separate at‑a‑glance overview.

---

## 2. Terminology rename (UI labels only)

DB columns/tables (`job_state`, `workshop_statuses`, `workshop_status_id`) and all code
identifiers (~115 references across api/web/mobile/shared) **stay as they are**. Only
user‑facing strings change, with code comments documenting the label↔field mapping. No
migration, no functional change.

### "Workshop status" → "Job Status"
- `apps/web/src/pages/Settings/WorkshopStatuses.tsx:144` — `<h1>` "Workshop Statuses" → "Job Statuses"
- `apps/web/src/pages/Settings/SettingsHub.tsx:154` — card title (+ its description)
- `apps/web/src/pages/Settings/WorkshopBoardSettings.tsx:163` — link text
- `apps/web/src/pages/WorkshopBoard/JobDetailModal.tsx:347` — field label "Workshop status"
- `apps/mobile/src/pages/MyBoard.tsx:223` — picker label "Workshop status"
- The settings route path `/settings/workshop-statuses` is **kept** (avoids breaking
  links); only labels change.

### "Job state" → "Vehicle Status"
- `apps/web/src/pages/WorkshopBoard/JobDetailModal.tsx:316` — field label "Job state"
- `apps/web/src/pages/HealthChecks/HealthCheckDetail.tsx` — the workshop job‑state field
  label (~:1396) and toast copy (`:433`, `:435`)
- The per‑value labels (Due In, Arrived, In Workshop, Work Complete, Collected) are
  unchanged — only the *field name* becomes "Vehicle Status".

This rename is independently shippable as Phase 1.

---

## 3. Data model change (the feature's only schema change)

To compute the ageing pill we need to know **when each card entered its current Job
Status**. `workshop_cards.updated_at` bumps on any edit, so it can't be used.

Add one additive column:

```sql
-- supabase/migrations/<ts>_workshop_status_changed_at.sql
ALTER TABLE workshop_cards
  ADD COLUMN IF NOT EXISTS workshop_status_changed_at TIMESTAMPTZ;

UPDATE workshop_cards
  SET workshop_status_changed_at = COALESCE(updated_at, created_at, NOW())
  WHERE workshop_status_changed_at IS NULL;

ALTER TABLE workshop_cards ALTER COLUMN workshop_status_changed_at SET DEFAULT NOW();
ALTER TABLE workshop_cards ALTER COLUMN workshop_status_changed_at SET NOT NULL;
```

Backfill uses `updated_at`/`created_at` as the best available proxy for existing rows.
Because the default is `NOW()` and we stamp on creation, a brand‑new no‑status card's
`workshop_status_changed_at` equals its creation time — which is exactly what the
"No job status" tile measures from.

### Stamping
- `apps/api/src/routes/workshop-board.ts:685` — in the PATCH handler, when
  `workshop_status_id` is changing to a new value, also set
  `workshop_status_changed_at = NOW()`. Stamp only when the value actually differs from
  the card's current `workshop_status_id` (the handler already loads the card).
- `apps/api/src/routes/workshop-board.ts:1430` — when a status is deleted and its cards
  are cascade‑nulled, also set `workshop_status_changed_at = NOW()` so their "no status"
  age starts from that moment.

---

## 4. Tiles aggregate API

New read‑only endpoint, aggregated **in the database** (avoids the PostgREST ~1000‑row
cap and keeps it cheap):

```
GET /api/v1/workshop-board/tiles?siteId=<uuid>&advisorId=<uuid|all>&scope=open|today
```

- Always filtered by `organization_id` (multi‑tenancy) and `siteId`.
- `advisorId` optional (per‑advisor filtering, like Garage Hive).
- "Active" job filter: `job_state <> 'collected'` AND
  `status NOT IN ('completed','cancelled','no_show')`.
- Grouped by `workshop_status_id` (NULL bucket = the "No job status" tile).

Response shape (one entry per status + the null bucket):

```jsonc
{
  "siteId": "...",
  "tiles": [
    {
      "statusId": "uuid|null",
      "name": "Ready for collection",      // null bucket → "No job status"
      "colour": "#1d9e75",
      "icon": "ti-key",
      "sortOrder": 60,
      "count": 5,
      "oldestDays": 6,                      // calendar days; see §5
      "vehicleStatus": { "due_in":0,"arrived":0,"in_workshop":0,"work_complete":5,"collected":0 },
      "vhcState": { "authorized": 4, "completed": 1 }
    }
  ]
}
```

`oldestDays` = `MAX(current_date − workshop_status_changed_at::date)` over the jobs in the
bucket (calendar days, in the site/org timezone).

---

## 5. The Tile page (web)

- New component `apps/web/src/pages/TileStatus/TileStatusPage.tsx` (+ `types.ts`).
- **Route + landing:** register at `/tiles` in `apps/web/src/App.tsx` (RequireModule
  pattern), add a nav item in `apps/web/src/layouts/DashboardLayout.tsx` (~:114), **and**
  make it the default landing route for web roles (advisor/manager/admin). The existing
  Dashboard stays reachable from the nav. Technicians use the mobile app and are
  unaffected.
- **Layout:** responsive grid of tiles (`repeat(auto-fit, minmax(~205px, 1fr))`), ordered
  by `sortOrder`. Tile contents per the approved mock:
  - status icon + name, live count,
  - **ageing pill**: plain text `N days` (no prefix). `0 → "Today"`, `1 → "1 day"`,
    `n → "n days"`. Flat/neutral styling for now.
  - breakdown: Vehicle Status chips + VHC state chips.
- **Filters:** site selector (defaults to user's site) + advisor selector (All default).
- **Live updates:** subscribe to the existing workshop‑board socket room for the site and
  refetch the aggregate (debounced) on board events; fall back to a ~60s poll.

### Drill‑in
Clicking a tile opens a **filtered list** of its jobs (registration, customer, advisor,
technician, vehicle status, VHC state, days‑in‑status), each row linking to the board
card / job detail. Implemented as a filtered list view on the tiles page (not a modal).

### Settings / configuration
No new settings screen needed — the existing `/settings/workshop-statuses` page (relabelled
"Job Statuses") already configures each status's name, colour, icon, sort order and active
flag, which *are* the tile definitions.

---

## 6. Explicitly out of scope (planned for later)

- **Threshold colours** for the ageing pill, and **tile colour** presentation controls —
  to be added later as configurable settings.
- **Status automation** (e.g. auto‑set "Awaiting authorisation" when a quote is sent).
  Job Status remains a manually‑set flag for v1.
- DB‑level rename of `job_state` / `workshop_status` identifiers.
- A "working days" option for ageing (v1 is calendar days).
- A dedicated `workshop_tiles` module toggle (v1 gates under the existing
  `workshop_board` module).

---

## 7. Build order

1. **Rename** (UI labels) — §2. Standalone, shippable on its own.
2. **Schema + stamping** — `workshop_status_changed_at` column, PATCH stamping, backfill. §3.
3. **Tiles aggregate API** — §4.
4. **Tile page** — page, nav, landing, drill‑in list. §5.

## 8. Risks / notes

- **Adoption:** tile accuracy depends on Job Status being kept current (it's a manual
  flag today). The "No job status" tile makes unmanaged jobs visible rather than hidden.
- **Multi‑tenancy:** the aggregate must always filter `organization_id` (+ site).
- **Aggregation in DB**, not by fetching rows, to avoid the PostgREST row cap.
- **Landing change** affects all web roles — verify role/module gating so the right users
  land on tiles.

---

## 9. As built (2026-06-21)

All four phases implemented. Notes where the build refined the plan:

- **Landing** is a `/` redirect (`HomeLanding` in `App.tsx`): advisors/managers with the
  `workshop_board` module → `/tiles`; technicians and module-off orgs → `/dashboard`
  (the classic Dashboard, now at its own route). Nav gained a "Tiles" item (first) and
  the "Dashboard" item was repointed to `/dashboard`.
- **Drill-in** uses a second RPC `workshop_status_tile_jobs` (oldest-in-status first,
  capped at 200), exposed as `GET /workshop-board/tiles/jobs?status=<id|none>`. Rows link
  to the health-check detail page.
- **Advisor filter** is supported by both RPCs/endpoints (`advisorId`) but the UI selector
  is deferred — v1 uses the user's site. A site picker is also deferred (mirrors the board,
  which uses the user's site).
- **Ageing pill** is a flat neutral "N days" (calendar days, "Today" at 0). Threshold
  colours + tile-colour controls remain deferred to a later settings pass.
- **DB objects** (`workshop_status_changed_at` column + both RPCs) are in migration
  `20260621120000_workshop_status_changed_at.sql`, applied to dev out-of-band via raw
  idempotent SQL (so the committed file re-applies cleanly on deploy, no orphan version).

### Verification performed
- Type-check (`tsc --noEmit`) green for web + api + mobile after each phase.
- Web production build (`vite build`) succeeds — the new page bundles.
- Both RPCs validated against real dev data (org "Central Garage", 373 active jobs):
  buckets sum correctly, breakdowns + `oldest_days` (6 / 139) compute, null bucket sorts last.
- API boots cleanly with the new routes; `/tiles` and `/tiles/jobs` return 401 unauthenticated.
- **Not yet checked:** the authenticated in-browser render / full HTTP round-trip — blocked
  by lack of a dev login in this environment (auth validates tokens via Supabase). To be
  confirmed in-browser by a logged-in user or on the next dev deploy.
