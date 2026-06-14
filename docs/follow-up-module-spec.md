# Follow-Up Module — Specification

**Status:** Draft for review
**Author:** Engineering (with Leo)
**Date:** 2026-06-14

## 1. Purpose

A module to recover **deferred work** — repair items a customer didn't authorise at the
time of their health check — by running each customer through a configurable, **due-date-aware
timeline** of automated SMS/email touches followed by a manual call stage, recording an
**outcome** on close, and reporting the **future revenue pipeline** of deferred work plus
conversion performance.

This is the single biggest organic revenue lever in an aftersales department: work has already
been identified and quoted; the only thing missing is the follow-through.

## 2. Decisions locked in

| Area | Decision |
|------|----------|
| **Unit of follow-up** | One **case per vehicle visit** (per health check). All deferred items from that visit are grouped into one case with one cadence and one conversation thread. |
| **Cadence anchoring** | **Due-date aware.** Timeline steps are offset relative to each case's *due date* (when the work becomes due). Cases with no due date fall back to a fixed cadence from the deferral date. |
| **Auto-pause on engagement** | **Yes.** An inbound SMS reply pauses the cadence and routes the case to the manual stage. **Additionally, the daily sweep checks the Gemini DMS for an existing/future booking and pauses the case if one is found.** |
| **Close capture** | **Outcome label only** (configurable list). No separate "recovered value" field — recovered revenue is *derived* from the £ value of the deferred items on cases closed as "Booked". |

## 3. What already exists (reuse, don't rebuild)

The foundation is ~70% present. The module is mostly **orchestration + UI** over existing data and services.

| Capability | Where it lives | How we use it |
|------------|----------------|---------------|
| Deferred items | `repair_items.outcome_status = 'deferred'`, `deferred_until`, `deferred_notes`, `follow_up_date`, full pricing (`total_inc_vat`, labour/parts, `repair_options`) | The source records that seed follow-up cases. |
| Advisory due dates | `repair_items.follow_up_date`, MRI `mri_scan_results.next_due_date` | Secondary anchors for the cadence. |
| Configurable reason lists | `declined_reasons` table + [DeclinedReasons.tsx](../apps/web/src/pages/Settings/DeclinedReasons.tsx) + [declined-reasons.ts](../apps/api/src/routes/declined-reasons.ts) | The exact pattern we clone for **outcomes** and **call dispositions**. |
| SMS (Twilio, multi-tenant) | [sms.ts](../apps/api/src/services/sms.ts) — `sendSms()` | Sends cadence SMS. |
| Two-way SMS auto-linking | [inbound-sms.ts](../apps/api/src/services/inbound-sms.ts), `sms_messages` table | Hook for **auto-pause on reply**. |
| Email (Resend, branded) | [email.ts](../apps/api/src/services/email.ts), [template-renderer.ts](../apps/api/src/services/template-renderer.ts) | Sends the detailed deferred-work email (already renders RAG tables, repair items, tiered pricing, CTA). |
| Configurable templates | `organization_message_templates` + `{{placeholder}}` renderer | New template types for follow-up. |
| Org branding | `organization_settings` (logo, colours, address) | Email styling. |
| Comms audit | `communication_logs` table | Every send logged. |
| Background jobs | BullMQ + Redis ([queue.ts](../apps/api/src/services/queue.ts), [scheduler.ts](../apps/api/src/services/scheduler.ts)) | Schedules the daily sweep. |
| DMS bookings | `health_checks` (`status='awaiting_arrival'`, `external_source='gemini_osi'`, `due_date`, `booked_repairs`) imported 4×/day by [dms-import.ts](../apps/api/src/jobs/dms-import.ts) | The **booking check**. |
| Reporting stack | Recharts + `useReportData` / `useReportFilters` / `DataTable` / `StatCard` / `ReportFiltersBar`; existing [DeferredWork.tsx](../apps/web/src/pages/Reports/DeferredWork.tsx) + `/reports/deferred` | Extend into the forward "by future month" pipeline + conversion reports. |

### The one infrastructure gap

The **BullMQ worker is not started in production** — Railway runs only the API process
([railway.toml](../apps/api/railway.toml) `startCommand` runs `index.js`, never `worker.js`).
Queued jobs would never execute. The timeline engine depends on a reliable runner.
See §10.

## 4. Concepts & terminology

- **Case** — one follow-up per vehicle visit, grouping all deferred items from a health check.
- **Timeline** — an ordered, named set of **steps** an org configures (e.g. "Standard recovery").
- **Step** — one action at a scheduled offset: send SMS, send email, send both, or drop to manual call.
- **Disposition** — *interim* result of a manual call attempt (No answer, Left voicemail, Callback requested…). Keeps the case open, optionally snoozes it.
- **Outcome** — *final* result that closes the case (Booked, Unable to contact, Declined…). Configurable.
- **Anchor date** — the date the cadence is measured against (the case's due date, or deferral date as fallback).

## 5. Case lifecycle (state machine)

```
                 ┌─────────────► booking_found ──────┐
                 │  (DMS check)                       │ (advisor confirms)
  active ────────┤                                    ▼
   │             ├─────────────► engaged ──────►  manual  ──────► closed
   │ (auto steps)│  (customer replied)         (call stage)   (outcome set)
   │             │                                    ▲
   └─────────────┴──────── steps exhausted ───────────┘
```

- **active** — automated steps are firing on schedule.
- **booking_found** — DMS shows a future booking for this customer+vehicle; cadence paused, advisor asked to confirm the deferred work is on the jobsheet.
- **engaged** — customer replied (inbound SMS); cadence paused, routed to a human.
- **manual** — automated steps exhausted *or* manually escalated; lives in the call worklist awaiting dispositions/outcome.
- **closed** — an outcome has been recorded.
- **snoozed** (sub-state of manual) — a disposition set a `next_action_at` in the future (e.g. callback requested for Friday).

## 6. Data model (new tables)

All new tables follow the house rules: `organization_id` on every row, RLS isolation, `IF NOT EXISTS`,
timestamped migration. £ values are **snapshotted** at case creation so reports stay stable when
prices/options later change.

### 6.1 `follow_up_cases`
```sql
CREATE TABLE IF NOT EXISTS follow_up_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,

  timeline_id UUID REFERENCES follow_up_timelines(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active',   -- active|booking_found|engaged|manual|closed
  current_step_order INTEGER DEFAULT 0,           -- last executed step
  anchor_date DATE,                               -- nearest unresolved item due date (or NULL)
  next_action_at TIMESTAMPTZ,                      -- when the sweep should next look at this case
  deferred_value_snapshot DECIMAL(10,2) DEFAULT 0,-- sum of item totals at creation (for reports)
  item_count INTEGER DEFAULT 0,

  assigned_to UUID REFERENCES users(id),          -- defaults to original advisor
  linked_booking_id UUID REFERENCES health_checks(id), -- the DMS booking if found

  outcome_id UUID REFERENCES follow_up_outcomes(id),
  outcome_notes TEXT,
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(health_check_id)                          -- one case per visit
);
```

### 6.2 `follow_up_case_items`
Snapshot of which deferred items the case covers (and their value at deferral). Per-item outcome is
Phase 2; Phase 1 resolves at case level.
```sql
CREATE TABLE IF NOT EXISTS follow_up_case_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES follow_up_cases(id) ON DELETE CASCADE,
  repair_item_id UUID NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name_snapshot VARCHAR(255),
  value_snapshot DECIMAL(10,2) DEFAULT 0,
  due_date_snapshot DATE,
  rag_snapshot VARCHAR(10),
  item_outcome_id UUID REFERENCES follow_up_outcomes(id),  -- Phase 2 (per-item)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(case_id, repair_item_id)
);
```

### 6.3 `follow_up_timelines` + `follow_up_timeline_steps`
```sql
CREATE TABLE IF NOT EXISTS follow_up_timelines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  anchor VARCHAR(20) NOT NULL DEFAULT 'due_date', -- due_date|deferral_date
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follow_up_timeline_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timeline_id UUID NOT NULL REFERENCES follow_up_timelines(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  action VARCHAR(20) NOT NULL,        -- send_sms|send_email|send_both|manual_call|auto_close
  offset_days INTEGER NOT NULL,       -- relative to anchor; negative = before due date
  sms_template_id UUID,               -- -> organization_message_templates
  email_template_id UUID,
  default_outcome_id UUID,            -- for auto_close steps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(timeline_id, step_order)
);
```
Example "Standard recovery" (anchor = due_date): `-14d send_both`, `-3d send_sms`,
`0d manual_call`, `+14d send_sms`, `+30d auto_close (Unable to contact)`.
For a case **with no due date**, the engine anchors to the deferral date and clamps negative
offsets to fire no earlier than creation.

### 6.4 `follow_up_events` (activity log)
Every send, booking-check, disposition, status change, and outcome — powers the case timeline UI and audit.
```sql
CREATE TABLE IF NOT EXISTS follow_up_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES follow_up_cases(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,    -- step_sent|sms_in|email_in|booking_found|call_logged|
                                      -- disposition_set|status_change|outcome_set|snoozed|note
  channel VARCHAR(10),                -- sms|email|phone|system
  disposition_id UUID REFERENCES follow_up_dispositions(id),
  body TEXT,
  metadata JSONB DEFAULT '{}',        -- e.g. {communication_log_id, booking_due_date}
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.5 Configurable lists — `follow_up_outcomes` & `follow_up_dispositions`
Both clone the `declined_reasons` shape (`is_system`, `is_active`, `sort_order`, per-org seed function).
```sql
CREATE TABLE IF NOT EXISTS follow_up_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_won BOOLEAN DEFAULT false,       -- counts as recovered (e.g. Booked) for conversion reports
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, name)
);
-- Seed: Booked (is_won), Unable to Contact, Declined, Not Interested, Done Elsewhere, Already Booked (is_won)

CREATE TABLE IF NOT EXISTS follow_up_dispositions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  snooze_days INTEGER,                -- optional default snooze when chosen
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, name)
);
-- Seed: No Answer, Left Voicemail, Callback Requested, Wrong Number, Considering (snooze 7)
```

## 7. Timeline engine

Implemented as a **once-daily sweep** (not per-record delayed jobs) — simpler, idempotent,
auditable, and naturally co-locates the booking pre-check. Runs early each morning per org timezone.

For each org, the sweep:

1. **Creates new cases** — find health checks with `outcome_status='deferred'` items that have no
   case yet; create a case, snapshot items + £ value, compute `anchor_date` = earliest unresolved item
   due date (`deferred_until` → `follow_up_date` → MRI `next_due_date` → NULL), assign default timeline +
   original advisor, set `next_action_at`.
2. **Loads due cases** — `status IN (active)` AND `next_action_at <= now`.
3. **Booking pre-check (per case)** — query DMS bookings (§8). If a future booking exists → set
   `status='booking_found'`, link it, log `booking_found`, notify owner, **skip sends**.
4. **Executes the due step** — compute the latest step whose `anchor_date + offset_days <= today`
   and not yet executed:
   - `send_sms` / `send_email` / `send_both` → render template, call `sendSms`/`sendEmail`, log to
     `communication_logs` + `follow_up_events`, advance `current_step_order`, set `next_action_at` to the next step's date.
   - `manual_call` → set `status='manual'`, create the worklist entry, notify owner.
   - `auto_close` → close with the step's `default_outcome_id`.
5. **Resolution check** — if all the case's items are no longer `deferred` (resolved elsewhere), auto-close as "Resolved".

**Auto-pause on reply:** extend [inbound-sms.ts](../apps/api/src/services/inbound-sms.ts) — when an
inbound SMS links to a customer/health-check with an `active`/`booking_found` case, set
`status='engaged'`, log `sms_in`, notify the owner. `STOP`/opt-out keywords set a contact-suppressed flag (§9).

## 8. Gemini DMS booking check

**Primary (Phase 1) — query imported data**, refreshed 4×/day, zero new integration:
```sql
SELECT id, due_date, promise_time, booked_repairs
FROM health_checks
WHERE organization_id = $org
  AND customer_id = $customer AND vehicle_id = $vehicle
  AND status = 'awaiting_arrival' AND external_source = 'gemini_osi'
  AND due_date >= CURRENT_DATE AND deleted_at IS NULL
ORDER BY due_date ASC;
```
If a row exists → pause the case as `booking_found`, store `linked_booking_id`, surface the booking
date and (optionally) cross-reference `booked_repairs` to tell the advisor whether the deferred work
appears to be on the jobsheet. The advisor confirms → close as **Booked**, or resumes the cadence if
the booking is unrelated.

**Enhancement (later) — live check** via `fetchDiaryBookings()` for a forward window, to catch
bookings made since the last import. Adds real-time accuracy at the cost of API calls/rate limits.

## 9. Communications

- **New template types** in `organization_message_templates`: `follow_up_touch` (generic, used by any
  send step via `template_id` on the step), plus seeded defaults for SMS and email. Steps reference a
  specific template so "Step 1" and "Step 2" can read differently.
- **The email** reuses [template-renderer.ts](../apps/api/src/services/template-renderer.ts): branded
  header (org logo/colour), a clear "work your vehicle still needs" section listing each deferred item
  with description, RAG severity, photos from the original check, and pricing (incl. tiered options),
  a total, and a primary CTA. Because the original 7-day portal token will have expired, the case
  **mints a fresh secure token** pointing at a read-only deferred-work view with a "Reply to book /
  Request a callback" CTA (no self-serve booking system exists, consistent with outcome-label-only).
- **New placeholders**: `{{deferredItemsTable}}`, `{{deferredTotal}}`, `{{dueDate}}`, `{{followUpUrl}}`.
- **Consent / STOP (recommended):** add `contact_opt_out BOOLEAN` (+ `opt_out_at`) to `customers`;
  the sweep skips opted-out customers; inbound `STOP` sets it. UK PECR/GDPR hygiene.

## 10. Infrastructure — close the worker gap

The daily sweep needs a runner in production. Options:

- **(A, recommended) Single daily sweep job** triggered by a scheduled mechanism, executed in-process
  or by a small worker. Cheapest, idempotent, easy to reason about; the whole engine is one function.
- **(B) Start the existing BullMQ worker** as a second Railway service (`worker.js`) and use a
  repeatable job. Reuses existing infra but adds a service + Redis dependency for one daily task.

Either way we must ensure the scheduled run actually fires in prod (today nothing does reliably).
Recommend (A): a dedicated `runFollowUpSweep(orgId)` invoked by one scheduled trigger per day,
with a manual "run now" admin endpoint for testing.

## 11. UI surfaces (apps/web)

- **Follow-Up worklist** `/follow-ups` — the daily call list. Filters: status, site, assignee, due
  window, outcome. Columns: customer, vehicle, deferred £, anchor/due date, stage, last touch, next
  action. Row → case drawer. Reuses `DataTable` + `ReportFiltersBar`.
- **Case detail drawer/modal** — customer & vehicle, the deferred items (with photos/pricing), the
  **event timeline** (every SMS/email/call/booking-check), quick actions: **Log call** (pick
  disposition + optional callback date + notes), **Send message now**, **Pause/Resume**,
  **Close** (pick outcome + notes). Surfaces a **"Booking found"** banner when relevant.
- **Settings** (under `SettingsHub`): **Timelines** (drag-order step builder: action + offset +
  template), **Outcomes**, **Call dispositions**, **Templates** — all cloning the
  `DeclinedReasons.tsx` CRUD pattern.
- **Dashboard Action Center card**: "Follow-ups due today / overdue / bookings to confirm."

## 12. Reporting

- **Future pipeline — "Deferred work by future month"** (the headline ask): group **open** deferred
  items by their anchor month, showing count + £ value per upcoming month as a bar/area chart with a
  drill-down table. Aggregated **server-side** (respecting the PostgREST ~1000-row cap) by month bucket.
- **Recovery & conversion**: cases closed by outcome over a period; **conversion rate** = won
  (`is_won`) ÷ closed; **estimated £ recovered** = sum of `deferred_value_snapshot` on won cases (derived,
  no extra capture needed); breakdowns by advisor and site; average touches-to-close.
- Extends the existing Reports area and `/reports/deferred`; reuses Recharts + report hooks.

## 13. Multi-tenancy & permissions

- `organization_id` on every table; RLS isolation policies mirroring `declined_reasons`.
- Every query filters by org (and site where relevant).
- Roles: `service_advisor`+ can view/work assigned cases and the worklist; `site_admin`+ manage
  settings (timelines/outcomes/dispositions/templates) and see all sites; `org_admin`+ full config.

## 14. Phased delivery plan

- **Phase 0 — Infra:** production sweep runner (§10) + manual "run now" endpoint.
- **Phase 1 — Core loop (MVP):** `follow_up_cases`/`_items`/`_events` + outcomes/dispositions tables &
  seeds; case auto-creation from deferred items; due-date-aware sweep; SMS/email send steps; **DMS
  booking pre-check**; auto-pause on inbound SMS; worklist + case drawer + log-call + close-with-outcome;
  one default timeline. **This alone delivers the core "amazing" loop.**
- **Phase 2 — Configuration & polish:** Settings UIs (timeline step builder, outcomes, dispositions,
  templates); the branded detailed email with fresh secure link + photos/pricing; consent/STOP; multiple
  named timelines.
- **Phase 3 — Reporting:** future-month pipeline report + conversion/recovery dashboards; Action Center card.
- **Phase 4 — Enhancements:** live DMS booking check; per-item outcomes; no-show re-engagement;
  best-time-of-day send; A/B template testing.

## 15. Open items / defaults to confirm

1. **Queue source** — default: `deferred` items **plus** amber/advisory items with a future
   `follow_up_date`; **exclude** hard-`declined`. (Confirm whether declined should be re-engaged.)
2. **Sweep runner** — recommend option (A), a single daily sweep job (§10).
3. **Email CTA** — "Reply to book / Request a callback" (no self-serve booking), consistent with
   outcome-label-only. (Confirm you don't want an online booking flow now.)
4. **Assignment** — default owner = original advisor; shared worklist filterable by site. (Confirm vs a
   dedicated follow-up team.)
5. **Booking match strictness** — pause on *any* future booking for the customer+vehicle (advisor
   confirms), vs only when `booked_repairs` appears to include the deferred work. Recommend the former
   (simpler, safer) with the jobsheet cross-reference shown as a hint.
