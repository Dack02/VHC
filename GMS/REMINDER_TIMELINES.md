# VHC — Reminder Timelines: Vehicle-Date Anchors + Service/MOT Bundling (Design)

> Status: **Design for build.** Author: Principal Eng + Product. Date: 2026-06-29.
> Builds on the Follow-Up module ([[follow-up-module-initiative]], `docs/follow-up-module-spec.md`,
> P1 live) and the Vehicles module ([[vehicles-module-initiative]], `docs/vehicles-module-plan.md`,
> built/uncommitted). Touches `apps/api/src/services/follow-up-engine.ts`,
> `services/expiry-reminders.ts`, `pages/Settings/FollowUpTimelines.tsx`,
> `pages/Settings/VehicleReminderCampaigns.tsx`, and the `2026...vehicles_module` / `follow_up_module`
> migrations.

---

## 1. Goal

Make a **Follow-Up Timeline** able to anchor its cadence to a **vehicle date** (MOT expiry, Service
due, Road Tax, or any custom expiry type) — chosen at the template level *and* re-selectable per
vehicle as new dates are added — and, when **multiple dates fall in a similar window**, send **one
combined reminder** instead of two messages days apart.

Two concrete asks, restated:

1. **Selectable vehicle-date anchor.** A timeline's offsets ("-30d", "-7d", "due day", "+14d") should
   be measurable from a vehicle expiry date, not only from a deferred-work due date. On a specific
   vehicle, the advisor can pick *which* date anchors the cadence, and **newly added dates appear as
   selectable anchors** without rebuilding anything.
2. **Bundle near-coincident dates.** If MOT is due 15 Jul and Service is due 18 Jul, the customer gets
   **one** message covering both — not an MOT text on day 30 and a Service text on day 28.

---

## 2. The reframe — two reminder systems today, one engine tomorrow

Research (5-agent codebase sweep) found **two independent reminder pathways that never talk**:

| | Follow-Up Timelines | Vehicle Expiry Reminders |
|---|---|---|
| Purpose | Chase **deferred/advisory work** | MOT / Service / Tax expiry nudges |
| Cadence | **Multi-step** (SMS → email → call → auto-close) | **Single message**, one-shot |
| Anchor | `due_date` (earliest deferred item) or `deferral_date` | the expiry `due_date` |
| Config UI | `Settings → FollowUpTimelines.tsx` (rich designer) | `Settings → VehicleReminderCampaigns.tsx` (one template + lead days) |
| Engine | `follow-up-engine.ts` — sweep, send-window, staleness, supersession, booking pre-check, pause-on-reply | `expiry-reminders.ts` `processExpiryRemindersForOrg` — flat loop, **no** send-window, **no** bundling |
| Case table | `follow_up_cases` (HC-bound, 1/visit) | `expiry_reminder_cases` (vehicle-bound, 1/type/window) |

**The codebase already anticipates convergence.** `expiry_campaigns.timeline_id` and
`expiry_reminder_cases.timeline_id` are live FK columns pointing at `follow_up_timelines`, today left
NULL with the comment *"reserved: future multi-step cadence"*
(`20260628140000_vehicles_module.sql:222,250`). `expiry_reminder_cases` already carries
`current_step` and `next_action_at`. The migration author built the seams; this initiative wires them.

> **What "unify" means here (and does *not*).** We unify at the **engine** level: one cadence model,
> one sweep, one send/suppress/log path. We **keep the two case tables separate** — `follow_up_cases`
> stays `health_check_id NOT NULL UNIQUE` (a real visit), `expiry_reminder_cases` stays vehicle-bound
> with no HC. That separation is deliberate in the Vehicles spec
> (`vehicles-module-plan.md:475-491`) and we respect it. Deferred-work follow-up behaviour is
> **unchanged** for the user; it simply shares the generalized engine.

---

## 3. Decisions locked (from product)

| # | Decision | Choice |
|---|---|---|
| D1 | Engine architecture | **Unify onto the timeline engine.** Vehicle-date reminders become first-class multi-step timelines on the same sweep/engine. |
| D2 | Bundle scope | **Vehicle dates together.** MOT + Service + Tax + Insurance + Warranty (any `vehicle_expiry_dates`) merge. Deferred advisory work keeps its own follow-up. |
| D3 | Bundle window | **~30 days, configurable per org.** Two dates within 30 days of each other bundle. Send timing **anchors to the earliest** date so nothing is missed. |

Out of scope (noted as future): folding deferred advisory work into the same message (D2 alt); a
multi-vehicle digest for one customer who owns several cars.

---

## 4. How leading UK GMS handle this (domain check)

Combined **MOT + Service** reminders and *recurring* date anchors are table-stakes in UK garage
systems (Garage Hive, MAM Autowork, TechMan, BookMyGarage marketing). The patterns worth copying:

- **One message, multiple due items.** "Your MOT and service are both due soon" outperforms two
  separate texts — higher booking conversion, lower opt-out, fewer "why two texts?" calls.
- **Anchor to the soonest, list the rest.** The send schedule tracks the earliest date; the body
  itemises every due item with its own date.
- **Recurrence is the engine's job.** A reminder system is only as good as the dates behind it —
  when a date passes or the car is booked in, the next cycle's date must reappear (see §10, the one
  real dependency).
- **Reminder is a cadence, not a blast.** Soft nudge → firmer nudge → call task, with quiet-hours and
  "stop on reply". The follow-up engine already does all of this; expiry reminders get it for free.

---

## 5. Data model

### 5.1 Timelines gain a *purpose* and a vehicle-date anchor

`follow_up_timelines` today: `anchor VARCHAR(20) CHECK (anchor IN ('due_date','deferral_date'))`
(`20260614120000_follow_up_module_phase1.sql:66,73`).

```sql
-- additive, IF NOT EXISTS
ALTER TABLE follow_up_timelines
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'deferred_work';  -- 'deferred_work' | 'vehicle_date'
ALTER TABLE follow_up_timelines
  ADD COLUMN IF NOT EXISTS anchor_expiry_type_code VARCHAR(40);  -- NULL = 'earliest in bundle'; else 'mot'|'service'|...

-- widen the anchor CHECK to add the vehicle-date kind
ALTER TABLE follow_up_timelines DROP CONSTRAINT IF EXISTS follow_up_timelines_anchor_chk;
ALTER TABLE follow_up_timelines ADD CONSTRAINT follow_up_timelines_anchor_chk
  CHECK (anchor IN ('due_date','deferral_date','vehicle_date'));
```

- `purpose = 'deferred_work'` → today's behaviour, untouched.
- `purpose = 'vehicle_date'`, `anchor = 'vehicle_date'` → offsets measure from a vehicle expiry date.
  `anchor_expiry_type_code` is the **default** anchor type for the template (e.g. a "Service reminder"
  timeline defaults its anchor to `service`); `NULL` means "anchor to the earliest due item in the
  bundle". This is overridable per case (§7).

### 5.2 Bundled cases — a parent + line items

A bundled reminder is **one case** covering **N due items** for one vehicle. Mirror the existing
`follow_up_cases` + `follow_up_case_items` shape so the engine and UI patterns transfer.

Extend `expiry_reminder_cases` (already has `timeline_id`, `current_step`, `next_action_at`,
status `active|engaged|booking_found|closed`):

```sql
ALTER TABLE expiry_reminder_cases
  ADD COLUMN IF NOT EXISTS anchor_expiry_date_id UUID REFERENCES vehicle_expiry_dates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anchor_type_code VARCHAR(40),   -- which type currently anchors the schedule
  ADD COLUMN IF NOT EXISTS anchor_date DATE,               -- the resolved anchor (earliest by default)
  ADD COLUMN IF NOT EXISTS item_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT false;
```

New child table (the per-due-item snapshot + the open-window dedup home):

```sql
CREATE TABLE IF NOT EXISTS expiry_reminder_case_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES expiry_reminder_cases(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  expiry_date_id UUID REFERENCES vehicle_expiry_dates(id) ON DELETE SET NULL,
  type_code VARCHAR(40) NOT NULL,
  due_date DATE NOT NULL,
  status_open BOOLEAN NOT NULL DEFAULT true,   -- mirrors parent: false when case closed/item resolved
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- A given (vehicle, type, window) can be in at most ONE open case (bundled or solo).
-- This replaces the old uq_erc_open guard, which assumed one type per case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_erci_open
  ON expiry_reminder_case_items(organization_id, vehicle_id, type_code, due_date)
  WHERE status_open;
```

> **Dedup nuance (the one fiddly bit).** Today the re-fire guard is `uq_erc_open` on
> `(org, vehicle, type_code, due_date) WHERE status<>'closed'` on the parent
> (`20260628140000_vehicles_module.sql:261`). With bundling the parent no longer maps to a single
> type, so the guard **moves to the items table** via `status_open` (kept in lock-step with the
> parent's status by the same close/engage update, or a trigger). Keep the old `uq_erc_open` for any
> legacy single-type rows during transition, then drop it once all in-flight cases are item-backed.

### 5.3 Org settings

Reuse the follow-up send-window settings (so expiry sends finally honour quiet hours). Add bundling
knobs on `organization_settings`:

```sql
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS expiry_bundle_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS expiry_bundle_window_days INTEGER NOT NULL DEFAULT 30;
```

### 5.4 Campaigns point at a timeline (not a single template)

`expiry_campaigns` already has `timeline_id` and `message_template`/`lead_days`. The campaign becomes
**"this expiry type uses this cadence"**: `timeline_id` is populated; `message_template`/`lead_days`
remain as a single-send fallback for orgs that haven't adopted timelines, so nothing breaks on deploy.

---

## 6. Engine — agenda → bundle → cadence

Replace the flat `processExpiryRemindersForOrg` single-send loop
(`expiry-reminders.ts:157-233`) with a **case-driven** pipeline that reuses the follow-up engine's
`processCase` / `executeStep` machinery. Two stages per sweep:

### 6.1 Build the agenda & form bundles (case creation)

`buildExpiryAgenda(orgId)`:

1. **Find due items.** Union of all enabled expiry types' audiences within `max(lead_days)` of today,
   reusing the suppression already proven in `expiry_campaign_audience`
   (`20260628140000_vehicles_module.sql:308-354`): active lifecycle, not opted-out, not snoozed,
   activity within 2 years, no active HC in the last 60 days, recipient = the
   `is_reminder_recipient` link. Generalise the RPC to accept **all** type codes at once and return
   `(vehicle_id, recipient_customer_id, type_code, due_date, ...)`.
2. **Group** rows by `(vehicle_id, recipient_customer_id)`.
3. **Bundle** within each group: order items by `due_date`; greedily merge any item whose `due_date`
   is within `expiry_bundle_window_days` of the group's earliest still-unbundled date. (With D3 = 30d
   and bundling enabled, MOT 15 Jul + Service 18 Jul → one bundle; a Tax date in November → its own
   case later.)
4. **Skip already-covered windows** via `uq_erci_open` (an item already in an open case is not
   re-added).
5. **Create the case**: `is_bundle = item_count > 1`; `anchor_date` = earliest item due (unless the
   anchor type's campaign pins `anchor_expiry_type_code`); `timeline_id` = the anchor type's campaign
   timeline (fallback: the org's default `purpose='vehicle_date'` timeline); `next_action_at` =
   `computeStepDate(anchor='vehicle_date', firstStep, anchorDate, now, minOffset)` — the **existing**
   helper (`follow-up-engine.ts:214-233`) already does UTC calendar math from an anchor date, so it
   works unchanged. Insert parent + N `expiry_reminder_case_items`.

   *Entry timing:* a case is created once its earliest due date is `≤ today + maxLeadDays`, so the
   first (negative-offset) step can fire on schedule. A "-30d" step on an MOT 11 months out does
   **not** create a case yet — it enters the agenda 30 days before.

### 6.2 Advance the cadence (case processing)

Generalise `processCase` so it accepts either a `follow_up_case` or an `expiry_reminder_case`. For
expiry cases each due step:

- **Booking pre-check** (reuse `findFutureBooking`, `follow-up-engine.ts:178-208`): if the vehicle has
  a future DMS/jobsheet booking, move the case to `booking_found` and stop chasing. (Today expiry
  reminders never do this — `expiry_reminder_cases.status` even has an unused `booking_found` value.)
- **Send-window + quiet hours** via `withinSendWindow` (`follow-up-settings.ts:67-75`) — expiry sends
  finally respect org timezone/quiet hours.
- **Staleness guard + supersession-skip** (`follow-up-engine.ts:838-890`) — no back-dated blasts if
  automation was off.
- **Render bundle-aware body** (§9) and send SMS/email via the same path; log to `communication_logs`
  with `metadata.source = 'vehicle_reminder'` (as today, `expiry-reminders.ts:134-146`).
- **Advance** `current_step`/`next_action_at`; **auto-close** when steps exhausted, all dates passed,
  the car is booked in, or the customer replies STOP (reuse `handleInboundSmsForFollowUps`).

Both stages run inside the existing 30-min sweep (`scheduler.ts` `startFollowUpSweepSchedule`), which
already calls into expiry processing — we swap the callee, not the schedule.

---

## 7. Anchor selection & the "new dates are selectable" requirement

This is ask #1 made concrete. Three layers:

1. **Template default** — the timeline's `anchor_expiry_type_code` (e.g. a "Service reminder"
   timeline defaults to `service`; a generic "Vehicle reminder" timeline leaves it NULL = earliest).
2. **Per-case anchor** — `expiry_reminder_cases.anchor_expiry_date_id` points at the exact
   `vehicle_expiry_dates` row driving *this* vehicle's schedule. Default = earliest due in the bundle.
3. **Re-selection that reflects live dates** — the case-detail UI reads `vehicle_expiry_dates` for the
   vehicle **at render time**, so any date added since (DVSA MOT sync, a manual Service date, a new
   custom type) **automatically appears** in the anchor picker. Choosing a different date:
   - repoints `anchor_expiry_date_id` / `anchor_type_code` / `anchor_date`,
   - **recomputes** `next_action_at` from the new anchor via `computeStepDate`, **without** replaying
     already-sent steps (clamp: never re-fire a step whose order ≤ `current_step`),
   - optionally **pulls a newly-added date into the bundle** as a rider item if it now falls in the
     window.

So "as new vehicle dates get added, these are selectable from within the timeline" = the picker is a
**live read** of `vehicle_expiry_dates`, plus an inline "add date" that writes there and immediately
re-offers it as an anchor/rider.

---

## 8. UI

### 8.1 Cadence designer (`Settings → FollowUpTimelines.tsx`)

- **Purpose toggle** on each timeline card: *Deferred work* / *Vehicle reminder*. Vehicle-reminder
  timelines are the new breed.
- **Anchor `<select>`** (today two options at `FollowUpTimelines.tsx:749-757`) becomes grouped:
  - *Deferred work:* "Anchor: due date", "Anchor: deferral date" (unchanged).
  - *Vehicle date:* "Anchor: MOT due", "Anchor: Service due", "Anchor: Road Tax due", … (live from
    `expiry_types`), plus **"Anchor: earliest due (bundle)"** (= `anchor_expiry_type_code` NULL).
- **`CadenceTrack`** anchor label (`:173-243`) becomes dynamic: "MOT DUE" / "SERVICE DUE" / "EARLIEST
  DUE" instead of the hardcoded "DUE"/"DEFERRED".
- **Message editor** for vehicle timelines exposes expiry tokens + the **bundle items block** (§9),
  with a preview that renders a sample 2-item bundle ("MOT — due 15 Jul; Service — due 18 Jul").

### 8.2 Campaign config (`Settings → VehicleReminderCampaigns.tsx`)

- Each expiry type's campaign **picks a timeline** (cadence) instead of editing one flat message.
- Org-level **"Bundle reminders due within [30] days into one message"** toggle + window field
  (writes `expiry_bundle_enabled` / `expiry_bundle_window_days`).
- Keep the single-message fallback visible for orgs that haven't moved to timelines.

### 8.3 Case detail (extend the Follow-Up detail modal pattern)

A vehicle-reminder case view (sibling to `FollowUps/FollowUpDetailModal.tsx`) showing:

- the **bundle line items** ("MOT — 15 Jul", "Service — 18 Jul"),
- the **live anchor picker** (§7) listing the vehicle's current `vehicle_expiry_dates` with the active
  anchor highlighted, an **"add date"** inline control, and re-anchor,
- the **cadence stepper** (`buildCadence` in `FollowUps/types.ts:211-282`, generalised to take the
  resolved anchor), done/due/skipped/future,
- snooze / close-with-reason, and the booking-found state.

---

## 9. Templates & tokens

Vehicle-reminder steps need to render gracefully for **1 or N** items. Add a bundle-aware token set,
mirroring the deferred-work items marker (`ITEMS_MARKER` in `follow-up-email.ts`):

| Token | Meaning |
|---|---|
| `{{expiryItems}}` | Repeating block: one line per due item — "MOT — due 15 Jul" (SMS = compact list; email = table) |
| `{{anchorType}}` | Label of the anchor item, e.g. "MOT" |
| `{{anchorDueDate}}` / `{{earliestDueDate}}` | The soonest due date in the bundle |
| `{{itemCount}}` | Number of due items (drives "is/are" + singular/plural copy) |
| `{{type}}`, `{{dueDate}}` | Back-compat single-item tokens (resolve to the anchor item when bundled) |
| `{{registration}}`, `{{vehicle}}`, `{{firstName}}`, `{{garageName}}`, `{{garagePhone}}` | As today (`expiry-reminders.ts:173-183`) |

A shared `renderExpiryBody(case, items, step, branding)` helper expands `{{expiryItems}}` to SMS text
vs email HTML, so one template string serves both channels — exactly the split `buildEmail` already
does for follow-ups.

---

## 10. The one real dependency — recurrence

`vehicle_expiry_dates` is **single-shot** per `(vehicle, type)` (UNIQUE at
`20260628140000_vehicles_module.sql:186`). When a Service date passes, the next one is **not**
auto-created (`vehicles-module-plan.md` defers auto-predict to P4). Reminders are only as good as the
dates behind them, so this initiative needs a minimum:

- **Roll-forward on resolution.** When an expiry item closes (booked in / date passed), advance its
  `due_date` by the type's `default_interval_months` (MOT +12m, Service +12m/12k mi, Tax +12m —
  already seeded, `:279-281`). Keeps the cycle alive without manual entry.
- **"Date passed — set next" nudge** in the vehicle UI for types without an interval.

Treat this as **P4 (enabler)** — the timeline work ships and demos on existing dates, but recurrence
is what makes it self-sustaining. Mileage-based Service prediction (the `vehicle_mileage_readings`
table at `:201` is already there) is a later refinement.

---

## 11. Phasing

| Phase | Scope | Migration? |
|---|---|---|
| **P0 — Schema & seams** | §5: timeline `purpose`/`anchor_expiry_type_code` + widened CHECK; `expiry_reminder_case_items` + `uq_erci_open`; case anchor/bundle columns; org bundle settings; seed a default "Vehicle reminder" timeline per org. | ✅ one additive migration (ts ≥ latest on remote — see [[parts-module-next-actions]] ordering gotcha) |
| **P1 — Unified engine** | §6: `buildExpiryAgenda` (multi-type audience + bundling), case+items creation, generalise `processCase`/`executeStep` for expiry cases (send-window, staleness, booking pre-check, pause-on-reply), retire the flat single-send loop with a compat path for in-flight rows. | — |
| **P2 — Anchor selection UX** | §7 + §8.3: live anchor picker, inline add-date, re-anchor + safe recompute, pull-rider-into-bundle; supporting API (PATCH anchor / add-rider). | — |
| **P3 — Designer & campaign UI** | §8.1/8.2: purpose toggle, vehicle-date anchor options, dynamic `CadenceTrack`, bundle-items token + preview; campaign→timeline picker; org bundle toggle/window. | — |
| **P4 — Recurrence (enabler)** | §10: roll-forward on resolution + "set next" nudge; (later) mileage prediction. | small additive |

**Off by default / opt-in:** like `follow_up_enabled` and the expiry campaigns today — bundling and
vehicle-date timelines ship behind the existing per-org enablement so no tenant is surprised.

---

## 12. Risks & open decisions

- **Bundle dedup correctness** — `status_open` on items must stay in lock-step with the parent
  (trigger vs app-managed). Get this wrong and a window either double-sends or never fires. Covered by
  the `uq_erci_open` design (§5.2); needs a test for the close→reopen→re-bundle path.
- **Re-anchor mid-cadence** — recompute `next_action_at` from the new anchor but never replay steps
  ≤ `current_step` (§7). Edge case: re-anchoring to an *earlier* date could make several steps
  "already due" — rely on the existing supersession-skip so it collapses to one send, not a burst.
- **In-flight migration** — legacy single-type `expiry_reminder_cases` (no items) must keep working
  while new cases are item-backed; keep both unique guards until drained.
- **Send-window now applies to expiry** — a behaviour change (today expiry ignores quiet hours). Desired,
  but call it out in release notes.
- **Bundle vs separate-channel** — if a type wants SMS and another wants email, a bundle must pick one
  policy. Default: the **anchor type's** channel drives the bundle; document it.
- **Deferred-work + vehicle overlap** — D2 keeps them separate, so a customer *could* get a
  vehicle-reminder and a deferred-work follow-up close together. Acceptable for v1; a cross-engine
  cooldown (skip expiry send if a follow-up touched this customer within N days) is noted in
  `vehicles-module-plan.md §6` and is the natural next lever if it becomes noisy.

---

## 13. File-by-file change map

| File | Change |
|---|---|
| `supabase/migrations/<new>_reminder_timelines.sql` | P0 schema (§5), seed default vehicle timeline |
| `apps/api/src/services/follow-up-engine.ts` | Generalise `computeStepDate` caller for `anchor='vehicle_date'`; make `processCase`/`executeStep` accept expiry cases; reuse `findFutureBooking`, send-window, staleness |
| `apps/api/src/services/expiry-reminders.ts` | Replace `processExpiryRemindersForOrg` flat loop with `buildExpiryAgenda` + case creation; add `renderExpiryBody` bundle helper |
| `supabase/migrations` (RPC) | Generalise `expiry_campaign_audience` to all type codes at once |
| `apps/api/src/routes/expiry-campaigns.ts` / `vehicles.ts` | Endpoints: campaign→timeline link; case anchor PATCH / add-rider; inline add-date already exists via `PUT /:id/expiries` |
| `apps/web/src/pages/Settings/FollowUpTimelines.tsx` | Purpose toggle, grouped anchor select, dynamic `CadenceTrack`, bundle-items token + preview |
| `apps/web/src/pages/Settings/VehicleReminderCampaigns.tsx` | Timeline picker per type; org bundle toggle + window |
| `apps/web/src/pages/FollowUps/FollowUpDetailModal.tsx` (or new `VehicleReminderDetail`) | Bundle items, live anchor picker, re-anchor, generalised stepper |
| `apps/web/src/pages/FollowUps/types.ts` | `buildCadence` takes a resolved anchor (works for both case kinds) |

---

## 14. One-paragraph summary

Today VHC has a rich multi-step **Follow-Up Timeline** engine that only chases deferred work, and a
separate flat **Vehicle Expiry Reminder** that fires one MOT/Service text at a time with no quiet
hours and no awareness that two dates are days apart. The schema was built expecting these to merge
(reserved `timeline_id` columns). This initiative wires that merge: timelines gain a **vehicle-date
anchor** (template default + a **live per-vehicle picker** that surfaces new dates as they're added),
the sweep **bundles** any expiry dates due within ~30 days into **one** reminder anchored to the
earliest date and itemising the rest, and expiry reminders inherit the engine's send-window,
staleness, booking pre-check and stop-on-reply for free. Five phases, one additive migration to start,
opt-in per org, with date **recurrence** flagged as the enabler that keeps the whole thing
self-sustaining.
