# Workshop Management Board — Feature Specification (v2)

**Author:** Claude (AI) + Leo
**Date:** 2026-03-25 (v1 draft) · 2026-06-12 (v2 — decisions locked, implemented)
**Status:** Implemented (v1 release)
**Apps:** `apps/web` (board, settings) · `apps/mobile` (technician view) · `apps/api`

---

## 1. Overview

A kanban-style digital T-Card workshop board giving service advisors and
workshop controllers a real-time visual overview of every job in the workshop,
with technician capacity, configurable operational statuses, promise-time
countdowns, and a TV wallboard mode.

Informed by research into UK systems (TechMan, Garage Hive, Autowork Online,
Gemini, Pinewood, Keyloop). Key differentiator vs incumbents: **cards move
themselves** — the board is driven live by the existing 28-state VHC pipeline
and technician clocking, with manual drag-and-drop as an override.

### 1.1 Decisions locked (June 2026)

| Decision | Choice |
|---|---|
| Column model | Fixed Due In → Checked In → **technician columns** → **custom queue columns** (Garage Hive style: Valeting, Awaiting Parts, Ready for Collection…) → Work Complete |
| Movement | **Auto from VHC pipeline with manual override** (drag always wins; clock-in snaps a card back to its tech column) |
| Technician access | View + update **own jobs** from mobile PWA (set status, move to queue, mark work complete, add notes). No cross-tech dragging |
| V1 extras | Promise-time countdown with waiter escalation · capacity hours per tech · TV wallboard mode · status-triggered SMS — **always behind a confirmation popup, never auto-sent** |

---

## 2. Position model ("auto with manual override")

The core design idea: a card's column is **derived** from the health check
wherever possible, so the board stays truthful without anyone dragging cards.

Resolution order (server-side, `GET /api/v1/workshop-board`):

1. `workshop_cards.placement = 'work_complete'` **or** `status = 'completed'` → **Work Complete**
2. `placement = 'queue'` with a valid `queue_column_id` → **that queue column**
3. `status = 'awaiting_arrival'` → **Due In**
4. `technician_id` set and that tech has a column → **technician column**
5. otherwise → **Checked In**

Consequences:

- Dragging a card to a tech column **assigns the technician** through the same
  rules as the existing assign endpoint (`created → assigned`, history written,
  tech notified) — the board and the pipeline can never disagree.
- A tech claiming a job on mobile makes the card appear in their column with
  no extra code (derivation rule 4).
- A Postgres trigger (`workshop_card_auto_sync`) clears manual queue /
  work-complete placements when a job moves to `in_progress` — clock on, and
  the card jumps out of "Awaiting Parts" back into your column, live.
- Cancelled / no-show jobs simply leave the board (not in any fetch bucket).
- Work Complete shows manual completions plus jobs whose health check reached
  `completed` on the selected date.

Board population (per site, per selected date):
- **Due In:** `awaiting_arrival` with `due_date` ≤ end of selected day (overdue arrivals linger rather than vanish)
- **Active:** all WIP statuses (`awaiting_checkin` … `authorized`, `declined`, `expired`)
- **Work Complete:** manual placements + `completed` with `completed_at` on the selected day

---

## 3. Database (migration `20260612090000_workshop_board.sql`)

| Table | Purpose |
|---|---|
| `workshop_statuses` | Org-scoped operational status flags: name, colour, icon, optional `sms_message` template, sort order, active flag. Seeded with UK defaults (Awaiting Authorisation, Awaiting Parts, Parts Arrived, On Road Test, Quality Check, Ready for Wash, Sublet Out, Ready for Collection ✉…). Lazy-seeded for new orgs on first fetch |
| `workshop_columns` | Per-site columns. `column_type` = `'technician'` (FK to users, `available_hours` capacity) or `'queue'` (name + colour). Unique tech per site |
| `workshop_cards` | One row per health check (lazily upserted): `placement` (`auto`/`queue`/`work_complete`), `queue_column_id`, `sort_position`, `workshop_status_id`, `priority`, `estimated_hours`, work-completed audit fields |
| `workshop_notes` | Append-only operational notes (max 500 chars), attributed + timestamped |
| `workshop_board_config` | Per-site defaults (`default_tech_hours`) |

Plus trigger `workshop_card_auto_sync` on `health_checks` (see §2) and RLS
read policies matching existing conventions.

**Estimated hours:** `workshop_cards.estimated_hours` manual override; falls
back to summing `booked_repairs[].labourItems[].units` from the DMS import.

---

## 4. API (`apps/api/src/routes/workshop-board.ts`, mounted at `/api/v1/workshop-board`)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | technician+ | Full board: config, statuses, columns, resolved cards (with vehicle/customer/advisor/tech, latest note, live clocked-on flag) |
| POST | `/cards/:id/move` | technician+ (own jobs, self-assign only) / advisor+ | targets: `checked_in`, `technician`, `queue`, `work_complete`. Tech-column moves assign the technician; Checked-In moves unassign (unstarted jobs only) |
| PATCH | `/cards/:id` | technician+ (own jobs) / advisor+ | `workshopStatusId`, `priority`, `estimatedHours`, `sortPosition` |
| POST | `/cards/reorder` | advisor+ | batch sort positions |
| GET/POST | `/cards/:id/notes` | technician+ | append-only |
| GET | `/statuses` | technician+ | lazy-seeds defaults |
| POST/PATCH/DELETE | `/statuses(/:id)` | site_admin+ | delete = soft (`is_active = false`), clears the status from cards |
| POST/PATCH/DELETE | `/columns(/:id)` | advisor+ | queue-column delete resets its cards to `auto` |
| POST | `/columns/reorder` | advisor+ | |
| PATCH | `/config` | site_admin+ | `defaultTechHours` |

**Real-time:** every mutation emits `workshop:board_updated` to the site room.
The web board also listens to `health_check:status_changed` and
`technician:clocked_in/out`, debounce-refetches (600 ms), and polls every 60 s
as a fallback.

**Status-triggered SMS:** a workshop status may carry an `sms_message`
template (`{customer_name} {registration} {site_name} {org_name}`). Applying
it opens a **confirmation popup** on the web with the rendered, editable
message; on confirm the existing `/health-checks/:id/sms-reply` endpoint sends
it (so it lands in the Messages thread). Nothing is ever sent automatically.

---

## 5. Web UI (`apps/web/src/pages/WorkshopBoard/`)

- **WorkshopBoard.tsx** — toolbar (date Today/Tomorrow/+2, search, advisor
  filter, status filter, waiting-only), stats strip (on site, workshop loading
  hrs, customers waiting, past promise time), dnd-kit drag-and-drop with
  optimistic moves, TV mode (fullscreen, dark, large type, live clock,
  double-click to exit), Add Column modal
- **JobCard.tsx** — reg + live promise countdown (amber ≤ 60 min, red overdue
  with "Xm late"), vehicle/customer, **SA: name**, estimated hours, days-on-site
  escalation, WAITING/LOAN/INT badges, VHC pipeline stage chip (auto), workshop
  status chip (coloured, left border), RAG counts, latest-note preview,
  pulsing dot when the tech is clocked on
- **BoardColumn.tsx** — tech columns show allocated/available hours bar
  (green < 80 %, amber 80–100 %, red > 100 %) and a clocked-on dot; queue
  columns show their colour accent
- **CardDetailPanel.tsx** — slide-out: quick facts (promised, arrived,
  jobsheet, SA, tech, key location), VHC pipeline banner with RAG, workshop
  status selector (✉ marks SMS statuses), priority, estimated hours, booked
  work from the DMS, booking notes, append-only workshop notes, link to the
  full health check
- **SmsConfirmModal.tsx** — the always-on confirm popup for status SMS
- **Settings:** `/settings/workshop-statuses` (statuses + SMS templates) and
  `/settings/workshop-board` (default hours, column management/reorder),
  registered in the Settings hub (site_admin+)
- **Nav:** "Workshop" item between Health Checks and Upcoming (advisor+)
- Cards within a column sort automatically: **waiters first**, then priority,
  then promise time, then age

## 6. Mobile (`apps/mobile/src/pages/MyBoard.tsx`, route `/board`)

Technician view of their own jobs ("Board" link from My Jobs): status chips,
tap to expand → set/clear workshop status, move to a queue column or back to
own column, add a note for the advisor, **✓ Work Complete**. 30 s refresh.
Completed-today section shown greyed at the bottom.

---

## 7. Permissions summary

| Action | Minimum role |
|---|---|
| View board (web/mobile) | technician |
| Tech: update own job (status, queue, complete, notes) | technician |
| Drag/assign/unassign any card | service_advisor |
| Add/remove/reorder columns | service_advisor |
| Manage statuses, board config | site_admin |

## 8. Future ideas (not in v1)

- Manual within-column ordering via drag (API already supports `sortPosition`)
- Clocked time vs estimated hours on cards (efficiency at a glance)
- Skill tags on technicians with booking-time matching (Gemini-style)
- Wallboard auto-rotation across sites; dedicated read-only TV token
- Deferred/amber-work follow-up queue fed by VHC outcomes
- Customer-facing "your car's progress" tracker driven by the same positions
