# Workshop Schedule — Enhancement Specification

> Status of the Workshop Board / day-planner ("the schedule") and the full set of
> planned enhancements. Consolidates the research pass and the detailed design
> work into one executable reference.
>
> **Legend:** ✅ Done (built, uncommitted) · 🔜 Planned · 🧱 Needs migration
>
> Scope: `apps/web/src/pages/WorkshopBoard/*`, `apps/api/src/routes/workshop-board.ts`,
> `apps/mobile` (technician views), `apps/web/src/pages/Reports/*`, `supabase/migrations`.

---

## 1. Current architecture (reference)

The Workshop Board is a real-time kanban **and** day-planner, per-site, module-gated by
`requireModule('workshop_board')`.

### Two independent state axes (do not conflate)
- **`health_checks.job_state`** — the workshop lifecycle that drives board columns:
  `due_in → arrived → in_workshop → work_complete → collected`. Early transitions are
  automatic (arrival, assignment, clock-on); `work_complete`/`collected` are deliberate.
  Maintained by the job-state trigger (`migration 20260613130000_workshop_job_state.sql`).
- **`health_checks.status`** — the VHC inspection/quote pipeline (21 states), shown only as a
  badge. A job stays on the board after the VHC is done.
- **`workshop_cards`** — per-card board metadata: `workshop_status_id`, `priority`,
  `estimated_hours`, `planned_start_at`, `sort_position`, `placement` ('auto'|'queue'|'work_complete'),
  `queue_column_id`, `work_completed_at`, `workshop_status_changed_at`.

### Views
- **Job Status** (kanban): Due In → Checked In → In Workshop → queue columns → Work Complete.
- **Technicians** (kanban): Checked In → per-tech columns → Work Complete.
- **Timeline** (Technicians sub-mode): per-tech swim lanes on an hourly grid (`PX_PER_MIN = 88/60`,
  15-min snap), drag-to-schedule, bottom-edge resize-to-estimate, live "now" line, lunch band,
  actual-vs-estimate progress fill + overrun tail, stale-clock guard.
- **TV mode**: fullscreen wallboard. **Add column**: technician or custom queue columns.

### Key data on each `BoardCard` (already available — most enhancements need no new fetch)
`estimatedHours`, `totalTechTimeMinutes`, `plannedStartAt`, `promiseTime`, `dueDate`, `arrivedAt`,
`jobState`, `status`, `priority`, `customerWaiting`, `loanCarRequired`, `isInternal`, `technician`,
`advisor`, `workshopStatusId`, `keyLocation`, `mileageIn`, `bookedRepairs`, `ragCounts`,
`isClockedOn`, `clockedOnSince`, `clockedOnBy`, `vehicle`, `customer`.

### Capacity model (today, deliberately simple)
- `workshop_columns.available_hours` (default 8) per technician.
- `workshop_board_config`: global `day_start_time`/`day_end_time`/`lunch_*` for **all** lanes.
- No per-tech shifts, part-time, holiday or absence anywhere.

### Realtime & data flow
- `useBoardData(date)` → `GET /workshop-board?date=YYYY-MM-DD&siteId=`. Live via socket
  `WORKSHOP_BOARD_UPDATED` (+ sibling events), debounced refetch, 60s poll fallback.
- Writes: `POST /cards/:id/move {target,columnId,sortPosition}`, `PATCH /cards/:id {plannedStartAt,
  estimatedHours,priority,workshopStatusId,jobState}`, `POST /cards/reorder`. All emit board updates.
- Time: `actualWorkedMinutes(card, now, staleMin)` is the **only** correct actual-time source — it
  excludes `isClockStale` open segments (forgotten clock-offs that would otherwise read +400h).

### Cross-cutting constraints (apply to every enhancement)
- Multi-tenant: filter `organization_id` (+ usually `site_id`) on every query/RPC.
- Migrations: timestamped `YYYYMMDDHHMMSS_*.sql`, `IF NOT EXISTS`/`IF EXISTS`, never modify applied
  ones, **never `db reset`**.
- PostgREST silently truncates raw multi-row fetches at ~1000 rows → aggregate in DB / RPC for any
  date-range report.
- Local-time handling: build timestamps as `new Date(\`${date}T${HH:MM}:00\`).toISOString()` and read
  back with `getHours()`; noon anchor (`T12:00:00`) for date-only math (DST/midnight safe).
- Styling: `rounded-xl` cards, `rounded-lg` controls, `rounded-full` badges, indigo `primary`,
  `bg-rag-red/amber/green`; toast for errors; optimistic-then-refresh.

---

## 2. ✅ Shipped — Drag-and-drop & "moving jobs" overhaul

Built this session (uncommitted). Files: `WorkshopBoard.tsx`, `TimelineView.tsx`, `useBoardData.ts`,
`BoardColumn.tsx`, new `boardActions.ts`.

| Item | What shipped |
|---|---|
| Refetch-during-drag guard | `useBoardData.setPaused` pauses socket/poll refetches during a drag, flushes one on drop (fixes a card-yank bug). |
| Live cross-column preview | Kanban `onDragOver` + `MeasuringStrategy.Always` move the card into the hovered legal column in local state; snapshot rollback + idempotence guard. |
| Timeline live snap ghost | `onDragMove` projects a dashed ghost at the snapped 15-min slot; overlay shows the live `HH:MM–HH:MM`. |
| Sensors | `PointerSensor` + `TouchSensor` (200ms press-hold) + `KeyboardSensor` (kanban); 150ms click-suppression; auto-scroll tuning. |
| Drop affordances | Red "Can't drop here" on illegal targets; overlay lift. |
| Due In pre-allocation | Drag a Due In booking onto a technician (tech view + timeline); backend keeps it `due_in`; shown in the tech's column. |
| Resilient moves | Shared `boardActions` (`moveCard`/`reorderCards`/`patchCard`/`setPlannedStart`); a failed neighbour-renumber keeps the committed move and re-pulls. |
| Lock semantics | Clocked-on/in-progress jobs can be reordered but not moved to Checked In / Work Complete. |
| Date picker | Native date input + ‹/› day steppers beside Today/Tomorrow/+2 — jump to any day (no backend change; complements Due In forward-planning). |

---

## 3. ✅ Theme 1 — Smart timeline helpers (built, uncommitted)

Shipped in new `scheduling.ts` + `TimelineView.tsx`: deadline "by HH:MM" pill + red "won't be ready"
ring/ribbon on blocks finishing after the promise; "Free now" tech-header pill + "Free now:" tray chips;
collision-aware drag (ghost shows the real free slot, red "Day full" when none, drop snaps/aborts); and
"✨ Auto-arrange day" (first-fit across least-loaded techs, deadline/priority-aware, avoids lunch) + a
per-card ⌖ "suggest slot". `tsc` + `vite build` pass. Original design retained below.

**Goal:** make the existing day timeline *plan for you*. Client-only; new module
`apps/web/src/pages/WorkshopBoard/scheduling.ts` (pure interval logic) consumed by `TimelineView`.
No backend, no schema. Decision: keep placement logic **client-side** — the board already holds the
full dataset; a `suggest` endpoint would duplicate the lane layout and add per-drag latency.

Shared primitives in `scheduling.ts`: `durationMinFor(card)` (single source of block length,
`(estimatedHours ?? 1)*60`, min `SNAP_MIN`), `promiseDeadlineMin(card,date,dayEndMin)`,
`busyIntervals(blocks)`, `lunchInterval(config)`, `firstFreeSlot(...)`, `techAvailability(...)`.

### 1a. Promise / deadline markers + "won't be ready" flag
- `promiseDeadlineMin` uses `promiseTime ?? dueDate`; returns `null` for another day or for a
  date-only/midnight value (mirror `promiseCountdown`'s `isDateOnly` rule in `JobCard.tsx`).
- Render a dashed amber line on the lane at the deadline (sibling of the lunch band, `pointer-events-none`)
  with a small "promise HH:MM" pill. Flag any block where `startMin + durationMin > deadline` with
  `ring-1 ring-red-400` + a red "won't be ready" ribbon (distinct from the existing amber `pastClose`).
- Thread `date` into `TimelineBlock` (currently not a prop).

### 1b. Idle / free-now technician indicator
- `techAvailability(blocks, nowMin, dayEndMin) → {isFreeNow, nextFreeMin, freeMinutesRemaining, isClockedOn}`.
  Busy-now = a block covers `now` OR a (non-stale) clock is open; a stale clock counts as **not** busy.
- Tech header: green "Free now" pill (or "Free HH:MM"); guard with the existing `isToday`. Tray: a
  "Free: Sam, Alex" chip line so the advisor picks a target before dragging.

### 1c. Collision-aware drag
- `firstFreeSlot(durationMin, busy, {fromMin, dayStartMin, dayEndMin, lunch, snapMin})` — O(n), snap
  up past each overlapping/lunch/locked blocker; return `null` if it won't fit before `dayEndMin`.
- In `handleDragEnd`, after the snapped desired start: if it overlaps the target lane's busy set
  (exclude the dragged card; locked blocks are obstacles), **snap to next free slot** + neutral toast;
  if nothing fits, **warn and abort the write**. Keep optimistic write + `refresh(true)`.

### 1d. Auto-arrange day + per-job suggest-slot
- `autoArrangePlan(jobs, techs, lanesBusy, config, now, date) → {plan, unplaced}` (pure): order the
  tray via existing `sortCards` (waiters → priority → promise → age); for each job, candidate =
  `firstFreeSlot` per tech from `max(dayStartMin, nowMin if today)`; prefer deadline-meeting candidates;
  pick earliest finish, tie-break least-loaded tech then column order; skip locked jobs (they stay
  obstacles). Apply via `moveCard` + `patchCard` sequentially, then one `refresh`; toast
  "Scheduled N (M didn't fit)".
- UI: an "Auto-arrange day" button in the timeline header (`canDrag && isTimeline`) with a light
  confirm; a target-icon "suggest slot" on each `TrayCard` (one-element plan).

**Build order:** markers (1a) → idle (1b) → collision-aware (1c) → auto-arrange (1d).
**Edge cases:** no estimate → 1h default; locked jobs never move; lunch is a blocker; day-end overflow →
`unplaced`; impossible promise → place earliest + red-flag; `now` only floors placement when `isToday`.

---

## 4. 🧱 Theme 2 — Week / multi-day planner + per-technician shifts (2a built; 2b pending)

**Built (uncommitted) — 2a week view (no schema):** lean `GET /workshop-board/week` endpoint;
`weekStart`/`addDays` helpers + `WeekData`/`WeekCard` types; `useWeekData(from,to,enabled)` hook;
`WeekView.tsx` (technician rows × 7 day columns, unscheduled tray, drag across days/techs via
`move`+`PATCH plannedStartAt`, per-cell + per-day capacity bars). Wired into `WorkshopBoard` as a
third **▥ Week** toggle with a Prev/This/Next-week navigator; day headers + chips **drill into that
day's timeline**. The per-day **"Day load" footer is Theme 3c** (forward loading forecast), now done.
`tsc` (web + api) + `vite build` pass. **2b shifts/absence schema** below is still pending.

**Built (uncommitted) — 2b shifts/absence:** migration `20260624130000_workshop_tech_shifts.sql`
(`workshop_tech_shifts` + `workshop_tech_absences`, RLS); `dayCapacityMinutes` seam in `types.ts`
(shift − lunch − absence, flat fallback); `/week` returns `shiftsByTech`/`absencesByTech` + lunch;
CRUD `GET /shifts`, `PUT /shifts/:techId`, `POST/DELETE /absences`; `ShiftsModal.tsx` (weekday grid +
absence list) opened from a **🕑 Shifts** button; the week grid now greys off-days and reds
over-capacity per real availability. **Deferred:** day-timeline lane shading/absence bands (`GET /`
not extended — the week view is the primary capacity surface). `tsc` (web+api) + `vite build` pass.

**Goal:** plan ahead across days and model real technician availability.

### 2a. Week view (ships first on flat capacity — no schema)
- **Layout:** new `WeekView.tsx` = **technician rows × 7 day columns** (Garage-Hive idiom), Monday-anchored.
  Each tech×day cell = a compact sorted block stack + a per-day capacity bar; column-header day totals.
  Reuses `TimelineView`'s `lanes` bucketing (keyed by `(techId, dayStr)`), capacity styling, and the
  drag→time→ISO commit. Add `weekStart(date)`/`addDays(date,n)` string helpers to `types.ts`.
- **Mode:** widen `techMode` to `'cards' | 'timeline' | 'week'` (third toggle); replace the day picker
  with a Prev/This/Next-week navigator in week mode; clicking a day-column header drills into that day's
  Timeline. Persist via the existing `localStorage` key.
- **Backend:** new `GET /workshop-board/week?from&to&siteId` — a **lean projection** (id, reg, tech,
  plannedStartAt, estimatedHours, status, jobState, promiseTime, dueDate, customerWaiting, isClockedOn),
  **no notes/time-entries** (avoid the 1000-row cap). Widen the due-in query to `.gte(from).lte(toEnd)`;
  planned cards drive the grid; bound range ≤14 days; reuse `resolveSiteId`, `bookedRepairsHours`,
  `chunkIds`. New `useWeekData(from,to)` mirrors `useBoardData`'s socket/poll.
- **Drag across days/techs:** each tech×day cell is a droppable id `\`${techId}|${dayStr}\``; default the
  dropped time to the tech's shift start (or `dayStartTime`), snapped; reuse `move` (cross-tech) then
  `PATCH {plannedStartAt}`. No new write endpoint.

### 2b. Per-technician shifts & absence (migration)
New migration `YYYYMMDDHHMMSS_workshop_tech_shifts.sql` (RLS/indexes copied from
`20260612090000_workshop_board.sql`):

```sql
-- Recurring weekly pattern: one row per (technician, weekday) they work.
-- weekday 0=Mon … 6=Sun (matches the Monday-anchored weekStart helper).
CREATE TABLE IF NOT EXISTS workshop_tech_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL DEFAULT '08:00',
  end_time   TIME NOT NULL DEFAULT '17:30',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(technician_id, weekday),
  CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_tech_shifts_lookup
  ON workshop_tech_shifts(organization_id, site_id, technician_id, weekday);

-- One-off absences: holiday / sick / training. Inclusive date range; NULL times = all day.
CREATE TABLE IF NOT EXISTS workshop_tech_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  start_time TIME, end_time TIME,
  reason VARCHAR(40),
  all_day BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_tech_absences_range
  ON workshop_tech_absences(organization_id, site_id, technician_id, start_date, end_date);
```

- **Capacity seam:** `dayCapacityMinutes({shift, absences, lunch, flatHours, dayStart/End})` in `types.ts`
  with a **backward-compatible fallback chain**: shift row → else column `available_hours` anchored at
  `dayStartTime` (identical to today) → minus lunch/absence overlap, floored at 0. This is the single
  swap point; existing call sites keep working until switched.
- **Serve/edit:** extend `GET /week` and `GET /` with per-tech shift/absence + computed capacity. Add
  `GET/PUT /shifts`, `POST/DELETE /absences` (advisor+; emit board update). New `ShiftsModal.tsx`
  (modeled on `AddColumnModal`): a 7-row weekday grid + an absence list/add form.
- **Timeline integration:** grey each lane outside its shift; render hatched non-droppable absence bands;
  swap tech-header + week capacity bars to `dayCapacityMinutes`. Out-of-shift drops soft-warn but allow.

**Edge cases:** no shift defined → flat fallback (no regression); absence does **not** auto-unschedule
jobs (shows a conflict via red capacity + hatched band); multi-day jobs out of scope v1 (`pastClose`
marker); week/month rollover handled by string date math; per-site scoping throughout.

---

## 5. 🧱 Theme 3 — Efficiency & loading insight (3a + 3b built; 3c pending)

**Built (uncommitted):** 3a board efficiency tile + per-tech column "Eff %" badge; 3b migration
`20260624120000_tech_efficiency_report.sql` (RPC `report_technician_efficiency`) wired into
`/reports/technicians` with Sold Hrs / Clocked Hrs / Efficiency / Utilisation columns on
`TechnicianPerformance.tsx`. `tsc` (web + api) + `vite build` pass. **3c forecast** folds onto the
Theme 2 `/week` payload (pending). Original design below.

**Goal:** surface the #1 workshop KPI (sold vs actual labour) and forward load.

### 3a. Live board efficiency stat (client-only)
- Metric: **efficiency % = sold ÷ actual × 100 over COMPLETED jobs only** (`position==='work_complete'`
  or `status==='completed'`, with `estimatedHours>0` and actual minutes > 0). Exclude `isClockStale`
  cards. Render `–` when no completed jobs (guard divide-by-zero). >100% beats booked time (green),
  85–100 amber, <85 red.
- Extend the `stats` useMemo in `WorkshopBoard.tsx` to accumulate `soldDone`/`actualDone` (via
  `actualWorkedMinutes`); add a 5th stat tile (`sm:grid-cols-5`) + a per-tech header badge in
  `BoardColumn.tsx`. No backend.

### 3b. Technician report efficiency / utilisation (migration + RPC)
- New migration + RPC `report_technician_efficiency(p_org_id, p_site_id, p_from, p_to, p_technician_id)`
  → `(technician_id, sold_hours, clocked_hours, days_clocked, available_hours_per_day)`. Aggregate
  `technician_time_entries ⋈ time_entry_categories` (where `counts_toward_job`, `clock_out_at` not null)
  and `workshop_cards ⋈ health_checks` for sold hours — **in the DB** (avoids the row cap). Match the
  `workshop_status_tiles` RPC pattern; explicit `organization_id` filter.
- Merge onto the leaderboard in `reports.ts` `/reports/technicians`; add columns Sold Hrs / Clocked Hrs /
  Efficiency % / Utilisation % (= clocked ÷ available) + an optional "Efficiency by Technician" chart in
  `TechnicianPerformance.tsx`, reusing the existing filters/threshold-colour patterns.

### 3c. Forward loading forecast
- "Next 7 days: booked vs capacity" mini-bars, **derived from the Theme 2 `/week` payload** (a compact
  reduction — no separate endpoint). Collapsible panel under the board stats. Green/amber/red at ~85/100%.

---

## 6. ✅ Theme 4 — Ops polish (built, uncommitted)

Shipped: board **filters** for technician / internal-vs-retail / loan car ([WorkshopBoard.tsx](apps/web/src/pages/WorkshopBoard/WorkshopBoard.tsx)); **richer TV mode** (auto-rotates Job Status ↔ Technicians every 20s without persisting, big waiter/overdue pills, "🔑 Ready for collection" spotlight banner); **mobile "My Day"** read-only timed schedule ([apps/mobile/src/pages/MyDay.tsx](apps/mobile/src/pages/MyDay.tsx) + route + JobList link); **printable per-tech day sheet** ([PrintDaySheet.tsx](apps/web/src/pages/WorkshopBoard/PrintDaySheet.tsx) at `/workshop-board/print?date=&tech=`, `@media print`, auto-print). No migrations. `tsc` (web + mobile) + both builds pass. Original design table below.



| Item | Design | Files | Backend? |
|---|---|---|---|
| More filters | technician / internal-vs-retail (`isInternal`) / loan car (`loanCarRequired`); compact "Filters" popover with active-count badge; extend `filteredCards` + add a `technicians` list like `advisors`. | `WorkshopBoard.tsx` | none |
| Richer TV mode | ~20s interval auto-cycles Job Status ↔ Technicians (without persisting to localStorage); enlarge waiter/overdue into big `bg-rag-*` pills; "Ready for Collection" spotlight banner (find the seeded status by name/`key` icon). | `WorkshopBoard.tsx` (opt. `TvWallboard.tsx`) | none |
| Mobile "My Day" | Read-only timed schedule: reuse `GET /workshop-board` (already called by `MyBoard.tsx`), filter to `technician.id===user.id`, sort by `plannedStartAt`; vertical list (time, est duration, reg, customer, waiting pill, status pill, key location). Techs don't plan (PATCH already 403s them). | new `apps/mobile/src/pages/MyDay.tsx` + route + header link | none |
| Print day sheet | Web route `/workshop-board/print?date=&tech=` outside `DashboardLayout`, reuse board endpoint + `@media print`; per-tech table (time, reg, customer, est hrs, key location, booked work, notes). | new `PrintDaySheet.tsx` + route in `App.tsx` | none |

**Gotchas:** always exclude stale clocks from actual-hours sums; `health_checks.total_tech_time_minutes`
is not maintained — use the board endpoint's computed value; new endpoints/RPCs filter org+site.

---

## 7. Suggested sequencing

1. **Commit** the shipped DnD + date-picker work (clean checkpoint). *(deferred per current decision)*
2. **Theme 1** — smart timeline helpers (client-only, fast, builds on the shipped timeline drag).
3. **Theme 3a** board efficiency stat (client) → **3b** report RPC (data exists; high-value KPI).
4. **Theme 2** week planner (flat capacity first) → shifts/absence (schema) → fold **3c** forecast into `/week`.
5. **Theme 4** ops polish (independent; pick off anytime).

Each theme ships independently and leaves the board fully working. What ships with **no migration**:
Theme 1, 3a, 4, and Theme 2's week view. **Needs migration:** Theme 2 shifts/absence, Theme 3b report RPC.

---

## 8. Verification

Per increment: `npm run build` (typecheck) in `apps/web`. Then with dev web (:5181) + api (:5180),
cloud-dev Supabase, an org with `workshop_board` on, signed in as advisor/admin, on a day with several
jobs (touch device or browser touch-emulation for sensor checks):
- **Theme 1:** promise lines + late-flagged blocks; "Free now" on idle techs; drop onto an occupied lane
  snaps to next free slot / warns when full; auto-arrange fills the tray respecting waiters/priority/
  promise; locked jobs never move.
- **Theme 2:** week toggle renders the tech×day grid; prev/next navigates; drag to another day/tech
  persists `plannedStartAt` (verify in DB); a tech with no shift behaves as today; setting a shift +
  absence greys/hatches the lane and recomputes the day's capacity bar.
- **Theme 3:** board efficiency tile shows a sane % (or `–`); report Sold/Clocked/Efficiency/Utilisation
  match a hand-checked tech over a known range; a stale clock does not inflate efficiency.
- **Theme 4:** filters narrow correctly; TV mode auto-cycles + spotlights collections; mobile My Day lists
  a tech's jobs in planned-time order (read-only); print route hides app chrome.

Apply migrations via `psql -f` (never reset); deploy through the normal dev push.
