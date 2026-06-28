# VHC — Capacity-Aware Booking Flow (Design)

> Status: **Design for build.** Author: Principal Eng + Product Design. Date: 2026-06-29.
> Builds directly on the Resource Manager engine ([[resource-manager-initiative]], `GMS/RESOURCE_MANAGER.md`,
> P0–P4 built) and the Jobsheet + Estimate booking docs (`GMS/JOBSHEET.md`, `GMS/ESTIMATES.md`).

---

## 1. Goal

Turn "creating a booking" into a **capacity-aware** experience on every surface, reusing the
already-built Resource Manager engine. Two surfaces:

1. **Advisor — New Booking (Jobsheet).** A new booking *starts* with a jobsheet. The advisor must
   see workshop availability *as they book* — a recommended day, the week's load at a glance, and a
   guard rail (WARN + override) when they push a tight day. This is the **primary gap**.
2. **Customer — book from an estimate.** The customer reviews a priced estimate, approves, and books a
   slot themselves — already wired end-to-end; needs polish to feel slick and to adapt to the
   booking mode.

> **The engine already exists and is live.** This is almost entirely a **front-end + thin-glue**
> initiative. `canBook`, `recommendDay`, `getDayCapacity`, the public `/availability` + `/book`
> endpoints, drop-off vs timed modes, lead-time floors, category quotas, and courtesy-car caps are
> all built (`apps/api/src/services/resource-capacity.ts`, `routes/resource-manager.ts`,
> `routes/public-estimate.ts`). We are *consuming* it, not building it.

---

## 2. Current state — what exists vs the gap

| Surface | File | State | Gap |
|---|---|---|---|
| Capacity engine | `services/resource-capacity.ts` | ✅ Built, live | — |
| Advisor capacity API | `routes/resource-manager.ts` (`/availability`, `/can-book`, `/capacity/day`) | ✅ Built | — |
| Public booking API | `routes/public-estimate.ts` (`/availability`, `/book`) | ✅ Built, live, capacity-gated | — |
| Customer slot picker | `pages/EstimatePortal/BookingFlow.tsx` | ✅ Wired to live API | Doesn't adapt to drop-off vs `timed_slot` mode; generic copy; no waitlist on full |
| **Advisor New Jobsheet** | `pages/Jobsheets/NewJobsheet.tsx` | ❌ Plain `<input type="date">` | **No capacity awareness at all** |
| **New Health Check** | `pages/HealthChecks/NewHealthCheck.tsx` | ❌ Plain date input | Same |
| **Estimate → Jobsheet convert** | `pages/Estimates/EstimateDetail.tsx` (Make-Jobsheet modal) | ❌ Plain date input | Same |
| Jobsheet `commit` | `routes/jobsheets.ts` `POST /:id/commit` | ❌ Saves date blind | No `canBook`; no `capacity_override` stamp |

**Key enabler already in place:** New Jobsheet creates a **draft jobsheet** the moment a vehicle +
customer are chosen, and the `WorkDetailsPanel` attaches priced work lines (with `repair_type_id` +
`repair_labour.hours`) to that draft *before commit*. So the picker can resolve **category + hours +
booking mode** from the draft server-side — exactly as `resolveBookingJob()` already does for
estimates in `public-estimate.ts`. No new data plumbing needed.

---

## 3. Research distillation (what leading GMS/DMS do)

Full competitive matrix from the research workflow (Garage Hive, Tekmetric, Xtime, ServiceTitan,
myKaarma, MAM, TechMan, Calendly, OpenTable, BookMyGarage). The highest-value patterns:

- **Lead with the recommendation, not a blank calendar** (myKaarma "Jump to first available",
  Doctolib "soonest available", Xtime wizard). The whole flow should answer *"can the shop deliver,
  and when?"* — VHC's `recommendDay` already returns `{recommended, alternatives, softHints}`.
- **Per-day fuel-gauge cells** (ServiceTitan %-full, myKaarma yellow-dot, MAM day-heat). Every day
  cell shows load vs `target_loading_pct` using the band the engine already returns.
- **One verdict colour legend everywhere** (Xtime's 5-state grid). Map VHC's verdicts:
  `recommended`=green hero · `OK`=available · `WARN`/`DENY_SOFT`=amber "override" · `DENY_HARD`=grey
  "Full/Closed". The amber state is the hook for `capacity_override` + reason capture.
- **Two-tier capacity: conservative online, looser internal with override** (Tekmetric "Block",
  Resy/OpenTable soft pacing). Customer self-serve never sees WARN/DENY days; advisors can override.
- **Cross-channel reconciliation is table-stakes — VHC already has it natively** via
  `vw_diary_bookings` unioning jobsheets + DMS health_checks. Lean into it as a selling point.
- **Service/repair-type chosen early → drives duration → drives availability** (universal). VHC keeps
  this order: the booking knows the job before it shows slots, so the time UI adapts (drop-off window
  vs timed grid) and the day strip is pre-filtered.
- **Hours, never appointment-count.** A 5-min bulb and a 6-hr clutch are not "2 of 10 slots". VHC's
  hours+category engine *is* the differentiator — never regress to a count cap.
- **Land web bookings in a review queue, never blind auto-commit** (Garage Hive "Bookings to
  review"). Timed-slot availability is currently day-level, so two customers could pick the same
  time; an advisor confirms them into firm jobsheets.

**Anti-patterns to avoid:** form-first booking that hides availability; hiding *all* unavailable days
on the **advisor** surface (advisors need the busy/quiet texture — disabled-but-visible); hard
dead-ends with no path forward; manual duration entry by a human; stale availability between load and
confirm (always re-validate); auto-confirming every online booking into a precise slot.

---

## 4. The advisor `BookingDatePicker` (the core build)

A single **reusable, embedded** panel (not a wizard) dropped into the three creation surfaces. On
job (category/hours) change it calls `POST /resource-manager/availability` reactively — no separate
"check availability" button.

### 4.1 Anatomy (top → bottom)
1. **Job summary row** — category colour pill (reuse `Settings/RepairTypes.tsx` colours) + estimated
   hours + site. Tells the advisor exactly what's being scheduled and which quota it consumes.
2. **Week strip of fuel-gauge day cells** — 7 (configurable) cells, each with a thin load bar tinted
   by the engine `band` (`low`/`healthy`/`high`/`over`/`closed`) + % label. `recommended` day gets a
   green ring + check. Full/closed days disabled-but-visible. Reuses `BookingDiary/shared.tsx`
   `LoadBar` + band tokens. Optional category counter chips (`MOT 4/16 · Diag 9/15`) under each cell
   (the diary drill-in already renders these from `/capacity/day`).
3. **Recommended hero** (green tint, `--bg-success`) — the date, a "Next available" badge, a
   plain-English **why-line** assembled from the day's counters
   (`"62% loaded · 9 of 15 Diag slots free · loan car free"`), a neutral-dark `#16191f` **"Use this
   date"** primary (per `docs/form-design-guidelines.md` — *not* `bg-primary`), and the
   **mode-adaptive time control** (§4.3).
4. **"Other good days"** — `alternatives[]` as load-% chips; click to select.
5. **Manual date row** ("or pick any date") + **"Jump to first available"** (snaps to `recommended`).
   Choosing a date re-runs `POST /can-book` and shows the verdict inline (§4.2).

### 4.2 Verdict handling (one path, never a dead-end)
- `OK` → quiet confirm.
- `WARN` / `DENY_SOFT` → amber row "tighter than recommended — {reason}" + **Override** button that
  reveals a **required reason field** and stamps `capacity_override` + `capacity_override_reason`.
- `DENY_HARD` (skill-infeasible / MOT-bay full / physically full incl. overbook buffer) → blocks save
  **with the reason** and offers the recommended day as the escape. Never a blank error.

### 4.3 Time control follows `booking_mode` (after the day is chosen)
- `drop_off` (default) → small **"Drop-off time"** dropdown defaulting into the site drop-off window
  (`dropoffWindowStart..End`), but freely editable by staff. Arrival marker only.
- `timed_slot` (MOT, AC) → appointment-time picker sized to `slot_minutes`.

The advisor flow is **day-first, time-secondary** — the engine already consumed the hours; never ask
a human to guess duration.

### 4.4 Backend glue
- **Resolve the job for a draft.** Add `POST /resource-manager/availability` support for a
  `jobsheetId` / `healthCheckId` / `estimateId` so the server resolves category + hours + mode from
  the draft's priced lines (lift `resolveBookingJob` out of `public-estimate.ts` into the shared
  service). Falls back to an explicit `repairTypeId` + `hours` for surfaces with no draft yet.
- **Wire `canBook` into `jobsheets.ts POST /:id/commit`** — call it for `due_in_date`; if the advisor
  proceeded past a WARN, set `capacity_override` + reason on the jobsheet (and mirror onto the linked
  HC). Hard DENY is already prevented client-side; the server is the backstop. Same for
  `health-checks` creation and the Make-Jobsheet convert.
- Emit `WS_EVENTS.WORKSHOP_BOARD_UPDATED` on commit so the diary/board refresh live (existing
  pattern).

### 4.5 Reuse map
- `LoadBar`, `CapacityFigures`, band tokens, category-counter chips → `BookingDiary/shared.tsx`.
- Category colours → `repair_types.colour` (already on `/availability` callers' data).
- Form styling (dark primary, 10px radius) → `docs/form-design-guidelines.md` /
  `CustomerFormModal.tsx`.
- `suggest-technician` stays **dispatch-only** (board `JobDetailModal`) — never part of the booking
  gate.

---

## 5. The customer flow (polish `BookingFlow.tsx`)

The flow is already wired to the live `GET /estimate/:token/availability` + `POST /book`. Polish:

1. **Adapt the time step to the returned `mode`** (the API already returns `mode`, `slotMinutes`):
   - `drop_off` → single **"What time will you drop off?"** picker limited to the morning drop-off
     window, copy "Leave it with us for the day — just tell us when you'll arrive." No full-day grid.
   - `timed_slot` → AM/PM-banded grid of concrete times sized to `slotMinutes` (OpenTable-style
     section headers with free-slot counts).
2. **Day strip** — chips shaded by load, **soonest day emphasised** as a bookable CTA, full days
   disabled-but-visible with a "Full" pill (never hidden-with-no-reason). State the lead-time floor as
   a footnote ("Earliest is tomorrow — we need 24h notice online").
3. **Courtesy car** — explicit toggle with live remaining count; disable on days where the `loan_car`
   asset is exhausted ("No courtesy car on this date — pick another day"), mirroring the `/book`
   409 the backend already returns via `loanCarAvailableOn`. Add a drop-off-vs-wait toggle where the
   repair type allows a waiter.
4. **Re-validate on confirm & handle the race** — `POST /book` returns 409 if capacity changed; catch
   it explicitly, re-fetch availability, re-render the strip. Never a generic error toast.
5. **Confirmation** — echo everything (vehicle, work + hours, day, drop-off time/slot, courtesy car),
   "a confirmation is on its way", Add-to-Calendar, celebratory check. Mirror into the SMS/email.
6. **Drop the `PREVIEW_AVAILABILITY` debug path** once live.

### 5.1 Advisor "Bookings to review" queue (handles the day-level limitation)
Customer `/book` persists `requested_date/time` on the estimate. Surface these as an advisor worklist
tile to confirm into a firm jobsheet (reuse the Make-Jobsheet path), since timed-slot availability is
day-level today. This is the Garage Hive "Bookings to review" pattern and the honest interim until a
per-time-slot ledger exists.

---

## 6. Phased delivery

- **P1 — Advisor `BookingDatePicker` (read-only availability).** The component + week strip + hero +
  alternatives + manual date with inline `can-book`, wired into New Jobsheet first (draft-based job
  resolution), then New Health Check + Make-Jobsheet. *No commit changes yet* — picker just sets the
  date field. Highest value, lowest risk.
- **P2 — Override capture + commit guard.** `canBook` in `jobsheets.ts`/`health-checks` commit;
  `capacity_override` + reason stamping; WARN/override UI. Backstop the client.
- **P3 — Customer flow polish.** Mode-adaptive time step, courtesy-car live caps, soonest-emphasis,
  confirmation echo + Add-to-Calendar, 409 race handling; drop the preview path.
- **P4 — Bookings-to-review queue** for online bookings (advisor confirms into firm jobsheets).
- **P5 (opportunities, deferred):** online reserve buffer (separate `online_target_loading_pct`);
  deferred-work recapture at booking time (surface Follow-Up items, recompute slot); Notify-me /
  waitlist on full → Follow-Up recovery loop; override analytics → quota self-tuning; show-rate
  overbook tuning; per-time-slot ledger (true instant-confirm).

Each phase is independently shippable. P1+P3 deliver the visible "slick booking flow"; P2 adds the
guard rail; P4+ are differentiators.

---

## 7. Decisions (owner, 2026-06-29)

1. **Online reserve buffer** — ❌ **No separate online target.** Online self-serve and staff bookings
   share the same `target_loading_pct`. No `online_target_loading_pct` knob to build.
2. **Bookings-to-review vs instant-confirm** — refined 2026-06-29: online estimate acceptance now
   **auto-creates a real jobsheet** (so it counts toward capacity immediately, see §9), rather than
   sitting as an uncounted slot on the estimate. The "review" is then only confirming the exact
   **time** for timed-slot types (MOT/AC), where day-level availability can't prevent two customers
   picking the same time — a later advisor surface. No per-time-slot ledger for now.

   > **Why estimate bookings must convert:** `vw_diary_bookings` unions jobsheets + health_checks
   > only. A slot merely stamped on the estimate is invisible to capacity, so stacked online bookings
   > could jointly exceed the target loading. Converting makes each online acceptance a counted new
   > booking, bounded by the same target as every channel.
3. **Build order** — ✅ **Start P1: the advisor `BookingDatePicker` (read-only availability), wired
   into New Jobsheet first.** Then extend to New Health Check + Make-Jobsheet. Commit guard (P2) and
   customer polish (P3) follow.

Still defaulted (not yet owner-confirmed, sensible defaults assumed): enforcement = soft except
physical caps; advisor-only why-line; deferred-work recapture + waitlist deferred to P5.

## 8. P1 build notes — ✅ BUILT 2026-06-29 (uncommitted; tsc + web build green)

**Backend** (`apps/api`):
- `services/resource-capacity.ts` — `getDayCapacity` now takes an optional `deps` (preloaded
  config/quotas/assets) so range callers don't re-read them per day. New: `BookingJob`/`ParentRef`
  types, `resolveBookingJobByType`, `resolveBookingJobForParent` (category ladder
  `primary_repair_type_id` → first priced top-level item → any typed item; hours = Σ
  `repair_labour.hours` → type default), and `getAvailabilityStrip` (one `diary_day_summary` range
  call; quotas-off path computes the verdict without heavy per-day calls; returns
  `days[] + recommended + alternatives + softHints`).
- `routes/resource-manager.ts` — `POST /availability` extended: accepts a parent id
  (`jobsheetId`/`estimateId`/`healthCheckId`) **or** an explicit `repairTypeId` (+ `hours`); returns
  `{ resolved, job, dropoffWindow, leadTimeDays, days, recommended, alternatives, softHints }`. No
  existing caller of this endpoint, so the extension is back-compat-safe. `public-estimate.ts`'s own
  `resolveBookingJob` left untouched (live path) — shared resolver is additive; consolidation later.

**Frontend** (`apps/web`):
- `components/booking/BookingDatePicker.tsx` (new, reusable) — fuel-gauge week strip (band-tinted load
  bars), recommended-day hero + why-line + neutral-dark "Use this date", alternative-day chips, manual
  date + "Jump to first available", mode-adaptive time control (drop-off window select vs appointment
  `time` input), inline verdict banner (amber WARN / red DENY). Read-only: sets the form date/time
  only. Always allows a manual date so it never blocks the required due-in.
- `pages/Jobsheets/NewJobsheet.tsx` — replaced the plain Due-In date/time inputs with
  `<BookingDatePicker>` (driven by the draft `jobsheetId`); `WorkDetailsPanel onChange` bumps a
  `workVersion` so availability re-checks as priced work is added.

**Not yet done (next):** New Health Check **deliberately excluded** (it's the upsell vehicle, not a
new booking — owner steer 2026-06-29); P2 commit guard + override capture; P3 customer-flow UI polish.
**Live browser verify** needs the dev stack + `jobsheets` module enabled for the org + a draft with a
priced repair-type line (standard GMS dev-deploy path; resource-manager P0–P3 tables already on cloud
dev).

## 9. Estimate online acceptance → counted new booking — ✅ BUILT 2026-06-29 (uncommitted; API tsc green; no migration)

The customer online-estimate booking already gates to `canBook` OK days (≤ `target_loading_pct`) — it
only *offers* days within the target. The gap was that an accepted+booked estimate didn't **count**
toward capacity until an advisor manually converted it, so stacked online bookings could jointly
exceed the target. Closed by auto-converting on acceptance:

- New `services/estimate-convert.ts` — `convertEstimateToJobsheet(opts)` (shared logic lifted from the
  make-jobsheet route, incl. `copyLineToJobsheet`): copies approved (or all) lines onto a new VHC-less
  jobsheet as pre-authorised work, stamps `primary_repair_type_id`, links + marks the estimate
  `converted`. Returns a discriminated result.
- `routes/estimates.ts` `POST /:id/make-jobsheet` refactored to call the service (behaviour unchanged).
- `routes/public-estimate.ts` `POST /estimate/:token/book` — after stamping the slot + re-validating
  `canBook`, **auto-converts** to a jobsheet (best-effort; only when the `jobsheets` module is enabled,
  else the slot stays on the estimate for manual conversion), dated to the chosen slot. The jobsheet
  enters `vw_diary_bookings` so the next booking (any channel) sees the consumed capacity. Response now
  returns `jobsheetId`.

**Known limitation:** two simultaneous online bookings can each pass `canBook` before the other's
jobsheet exists (classic check-then-act race) — at the day level, low-concurrency for a garage; the
diary surfaces any over-target day. True prevention needs a lock / per-slot ledger (deferred).

### 9.1 "Online estimate" marker + settings explainer — ✅ BUILT 2026-06-29 (uncommitted; tsc + web build green)

- Migration `20260630120000_jobsheet_booking_source.sql` — `jobsheets.booking_source VARCHAR(20)`
  (NULL = manual/advisor; `'online_estimate'` = customer self-booked). `convertEstimateToJobsheet`
  takes a `bookingSource` opt; the public `/book` path passes `'online_estimate'`; advisor
  make-jobsheet leaves it NULL. Shape exposes `bookingSource` (SELECT is already `*`).
- Web: an **"Online estimate"** badge (emerald) on `JobsheetList` rows + the `JobsheetDetail` header —
  so advisors can spot customer self-booked jobs and confirm exact times on timed-slot work (the
  review surface, lightweight).
- `Settings/EstimateSettings.tsx` — a **"How online bookings work"** info modal (5-step explainer +
  Jobsheets-module-required note) beside the online-booking toggle.

## 10. P2 — commit-time guard + override capture — ✅ BUILT 2026-06-29 (uncommitted; tsc green; no migration)

The picker was advisory only; P2 makes the server enforce the loading target at commit.

- `routes/jobsheets.ts` `POST /:id/commit` — before committing, resolves the draft's job
  (`resolveBookingJobForParent`) and runs `canBook` for the due-in date:
  `OK` → proceed; `WARN`/`DENY_SOFT` → require `capacityOverride` + a non-empty
  `capacityOverrideReason` (else `409 CAPACITY_OVERRIDE_REQUIRED`); `DENY_HARD` → `409 CAPACITY_BLOCKED`
  (pick another day). On override it stamps `jobsheets.capacity_override` + reason and mirrors them onto
  the linked VHC. Skipped when no category resolves (nothing to gate). Uses the existing
  `capacity_override` columns (Resource Manager P2 migration) — no new migration.
- `components/booking/BookingDatePicker.tsx` — surfaces the selected day's verdict
  (`onVerdictChange`) and captures the override reason inline in the amber WARN banner
  (`overrideReason`/`onOverrideReasonChange`); `DENY_HARD` shows a red "pick another day" block with a
  jump to the recommended day.
- `pages/Jobsheets/NewJobsheet.tsx` — tracks the verdict + reason, disables submit when a tight day has
  no reason (or a hard-blocked day is selected) with an inline hint, and passes
  `capacityOverride`/`capacityOverrideReason` to commit. The server `409`s are a race backstop (their
  user-facing `error` messages surface via the existing toast/error path).

## 11. P3 — customer flow polish — ✅ BUILT 2026-06-29 (uncommitted; tsc + build green; no migration)

`pages/EstimatePortal/BookingFlow.tsx`:
- **Mode-adaptive** to the API's `mode`: drop-off shows "When will you drop off?" + "leave it with us
  for the day" copy and a single drop-off-time grid; timed-slot groups times into **Morning / Afternoon**
  with free-slot counts.
- **Soonest day** is tagged on the day strip; full days stay disabled-but-visible.
- **Confirmation** gains an **Add to calendar** (.ics) action.
- 409 race handling already re-fetches availability; preview/debug path left intact (inert in prod).

*Deferred (noted):* per-day live courtesy-car caps in the availability payload (the `/book` 409 already
guards it); waitlist/notify-me on full.

## 12. Make-Jobsheet convert modal — capacity-aware — ✅ BUILT 2026-06-29 (uncommitted; tsc + build green; no migration)

The advisor's manual "Make jobsheet" conversion (`EstimateDetail`) is a new booking too, so it now
uses the picker + the same guard.

- `BookingDatePicker` gained a `bare` prop (drops the card chrome) for embedding in the modal.
- `pages/Estimates/EstimateDetail.tsx` — the Make-Jobsheet modal's plain date/time inputs replaced by
  `<BookingDatePicker bare estimateId={est.id} …>` (resolves the estimate's category + hours + site
  server-side); override reason captured inline; the "Create jobsheet" button is gated (blocked day /
  missing reason) and sends `capacityOverride`/`capacityOverrideReason`.
- `routes/estimates.ts` `POST /:id/make-jobsheet` — adds the same capacity guard as the jobsheet commit
  (resolve estimate job → `canBook` → OK / 409 `CAPACITY_OVERRIDE_REQUIRED` / 409 `CAPACITY_BLOCKED`),
  passes the override + `primaryRepairTypeId` into `convertEstimateToJobsheet`, which now persists
  `capacity_override` + reason on the jobsheet.
- `routes/resource-manager.ts` `POST /availability` — site precedence fixed: a parent id
  (estimate/HC) now keeps its **own** site unless an explicit `?siteId` is given (New Jobsheet still
  passes the form's site), so the estimate convert books against the estimate's site.

## 13. "+ New Jobsheet" on the Booking Diary — ✅ BUILT 2026-06-29 (uncommitted; tsc + build green; web-only)

`pages/BookingDiary/BookingDiaryPage.tsx` — a `+ New Jobsheet` button in the header (gated by the
`jobsheets` module) linking to `/jobsheets/new?date=<selectedDate>` (the diary's drill-in day).
`pages/Jobsheets/NewJobsheet.tsx` reads `?date=` and pre-fills the due-in date, so booking from a day
the advisor is viewing carries that day into the capacity-aware picker.

- Backend: generic `resolveBookingJobForParent(orgId, {jobsheetId|estimateId|healthCheckId})` in
  `resource-capacity.ts` (lift from `public-estimate.ts`); `getAvailabilityStrip(...)` returns the
  contiguous day strip + recommended/alternatives/softHints in one call (loads config/quotas/assets
  once; quotas-off path skips the heavy per-day calls). `POST /resource-manager/availability` extended
  to accept a parent id and return `{ job, days, recommended, alternatives, softHints, dropoffWindow }`.
- Frontend: `components/booking/BookingDatePicker.tsx` (reusable) — job summary, fuel-gauge week
  strip, recommended hero + why-line, alternatives chips, manual date + jump-to-first-available,
  mode-adaptive time control. Wired into `NewJobsheet.tsx` (replaces the dumb date/time inputs),
  re-fetching on `WorkDetailsPanel`'s `onChange`. Read-only — sets the date field only; no commit
  change yet (P2).

---

*Key files:* engine `apps/api/src/services/resource-capacity.ts`; APIs `routes/resource-manager.ts`,
`routes/public-estimate.ts`, `routes/jobsheets.ts`; advisor surfaces
`pages/Jobsheets/NewJobsheet.tsx`, `pages/HealthChecks/NewHealthCheck.tsx`,
`pages/Estimates/EstimateDetail.tsx`; customer surface `pages/EstimatePortal/BookingFlow.tsx`; reuse
`pages/BookingDiary/shared.tsx`; config `services/resource-config.ts`.
