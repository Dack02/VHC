# GMS — Check-in ↔ Jobsheet integration (Plan + build status)

> Branch: `dev` · Status: **Built (uncommitted), 2026-06-23** · Author: Leo + Claude
> Builds on [`JOBSHEET.md`](./JOBSHEET.md) and [`WORK_DETAILS.md`](./WORK_DETAILS.md).

## 1. Problem

A jobsheet already creates a linked VHC (`health_checks` row) in `status=awaiting_arrival` /
`job_state=due_in`, with the due date derived from the jobsheet's Due-In date/time. The check-in
machinery (Mark Arrived → check-in form → Complete) already operates on that same row — but nothing
tied it back to the jobsheet, and the jobsheet was not an entry point:

1. **No jobsheet-aware arrivals surface.** The dashboard "Awaiting arrival" widget reads
   `/dms-settings/unactioned`, which filters `external_id IS NOT NULL` → **DMS-only**. Jobsheet
   bookings (no DMS id) appeared in no arrivals list, so a jobsheet due today had no "arrive/check-in"
   entry point except the buried "Open VHC → Mark Arrived" path.
2. **Arrival/check-in didn't reflect on the jobsheet.** `mark-arrived` / `complete-checkin` only
   touched `health_checks`; `jobsheets.vehicle_on_site` / `job_state` stayed put.
3. **Check-in details weren't surfaced on the jobsheet** (mileage in, keys, customer waiting, notes…).

> Note: the `health_check_job_state_sync` trigger (migration `20260613130000`) already advances the
> *VHC's* `job_state` `due_in → arrived` when `status` leaves `awaiting_arrival`. Since the jobsheet
> reads its Vehicle Status *through* the VHC, the pill already moved on arrival — the residual gaps
> were the jobsheet's own columns + surfacing + entry points.

## 2. Decisions (Leo, 2026-06-23)

- **Primary check-in UX = a shared Arrivals hub** unifying DMS + jobsheet bookings in one queue.
- **"Due today" visible in both** a Jobsheets-list section *and* the dashboard arrivals widget.
- **Reuse the existing check-in form** (the VHC Check-In tab) via deep-link — do **not** rebuild MRI /
  auto-save / completion. The hub/jobsheet/list are launch points + queues.
- **No-VHC jobsheets** ("Requires VHC" off) are included in arrivals with a simpler **"Mark on site"**
  action (no check-in form).
- **Window** defaults to overdue + today + tomorrow (`window=soon`), with an "All" toggle in the hub.
- **No new migration** — reuses existing columns only (`jobsheets.job_state` + `vehicle_on_site`
  from `20260623180000`/`20260623120000`; the `health_checks` check-in columns from `20260125000001`).

## 3. Architecture — one unified source, three surfaces

DMS bookings and jobsheet bookings are the *same kind of row* (`health_checks` in
`awaiting_arrival` / `awaiting_checkin`). A single endpoint joins the parent jobsheet for its
reference and origin, and feeds every surface.

## 4. What was built

### API
- **`apps/api/src/routes/arrivals.ts`** (new) — `GET /api/v1/arrivals` unified queue. Params:
  `status` (default `awaiting_arrival,awaiting_checkin`), `window` (`soon`|`all`), `site_id`, `q`.
  Returns normalized items with `origin` (dms|jobsheet|manual), `jobsheetReference`, `hasVhc`,
  check-in-relevant fields, plus `counts`. Folds in no-VHC jobsheets as synthetic `awaiting_arrival`
  items (`hasVhc:false`). **Not module-gated** (serves DMS-only orgs too). Resilient: jobsheet
  reference lookup + no-VHC branch are error-guarded, so a missing jobsheets table degrades to
  DMS/manual rows rather than failing (keeps the dashboard safe).
- **Mounted** in `apps/api/src/index.ts` at `/api/v1/arrivals`.
- **`apps/api/src/routes/health-checks/status.ts`** — `syncJobsheetOnArrival()` helper, called from
  `mark-arrived` and `complete-checkin`: when the VHC has a `jobsheet_id`, set the parent jobsheet
  `vehicle_on_site=true` and advance `job_state` `due_in → arrived` (forward-only). Best-effort /
  idempotent — never fails the arrival/check-in.
- **`apps/api/src/routes/jobsheets.ts`** — `GET /jobsheets/:id` now read-throughs the linked VHC's
  check-in fields as a `checkIn` object (arrivedAt, checkedInAt, checkedInBy, mileageIn, keyLocation,
  timeRequired, customerWaiting, checkinNotes).

### Web
- **`apps/web/src/pages/Arrivals/ArrivalsHub.tsx`** (new, route `/arrivals`) — the primary surface.
  "Check-in required" + "Awaiting arrival" sections; per-row actions: **Arrived** (mark-arrived →
  deep-link to check-in if required), **No show**, **Check in** (deep-link), and **Mark on site** for
  no-VHC jobsheets. Search + Due-soon/All toggle. Route gated by `module="jobsheets"`.
- **`apps/web/src/layouts/DashboardLayout.tsx`** — "Arrivals" nav item (after Jobsheets, `jobsheets` module).
- **`apps/web/src/pages/Jobsheets/JobsheetDetail.tsx`** — **Check-in card** (read-through summary +
  state-aware action: "Check in vehicle" / "Continue check-in" / read-only once checked in).
- **`apps/web/src/pages/Jobsheets/JobsheetList.tsx`** — **"Due in"** section at the top (jobsheet
  arrivals due soon) with inline check-in action + "Open arrivals" link.
- **`apps/web/src/pages/Dashboard.tsx`** — "Awaiting arrival" widget repointed to `/api/v1/arrivals`
  (VHC-backed rows only, so existing Arrived/No-show/Delete actions are unchanged); jobsheet bookings
  now appear alongside DMS.

## 5. Verification
- `tsc --noEmit` passes for API + web. Web production build: _pending re-run (sandbox classifier blip)_.
- **Browser testing depends on the GMS migrations (`20260623*`) being live** in the target env (the
  arrivals/jobsheet queries need the `jobsheets` table + `health_checks.jobsheet_id`). No *new*
  migration is introduced by this work.

## 6. Out of scope / follow-ups
- Real-time (WebSocket) refresh of the Arrivals hub (currently manual refresh + on-action reload).
- Embedding the check-in form in a hub drawer (today it deep-links to the VHC Check-In tab).
- Unifying DMS imports to *create jobsheets* (still separate origins; see JOBSHEET.md §10).
- Surfacing the Arrivals hub to DMS-only (non-jobsheet) orgs — endpoint already supports it; only the
  web nav/route is currently `jobsheets`-gated.
