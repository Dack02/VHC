# Technician Job Clocking — Feature Specification

**Author:** Claude (AI) + Leo
**Date:** 2026-06-14 (v1 — decisions resolved, not yet implemented)
**Status:** Ready to build
**Apps:** `apps/api` (clocking, auto-close, settings) · `apps/web` (board, settings) · `apps/mobile` (technician clock on/off)

---

## 1. Overview

Today a technician "clocks on" to a **health check**. A single
`technician_time_entries` row is opened (`work_type` defaults to `inspection`)
and the Workshop board's timeline compares *actual clocked time* against the
job's *estimate* to show overrun.

Two problems with the current model:

1. **It only conceptually covers the inspection.** A job's real labour spans
   the VHC **and** the authorised repair work that happens later, after pricing
   and customer authorisation. There is no first-class way to clock that later
   work, nor to measure the health-check element on its own.
2. **A forgotten clock-on runs forever.** The live timer adds
   `now − clock_in_at` for any open entry. There is a stale-entry auto-close,
   but it only fires when the **same** technician clocks in again
   (`apps/api/src/routes/health-checks/status.ts` ~L874). A technician who
   never returns leaves the entry open indefinitely.

   > **Motivating incident (KK68WWA, dev):** Harrison Bigg clocked onto a
   > 1.5h job on 2026-05-27 08:22 and never clocked off. ~17 days later the
   > board showed **+407.92h over** on a card sitting in *Wayne Barnett's*
   > column. Not a calc bug — a stale open segment with no time-based close,
   > plus cross-technician attribution.

This feature expands clocking into a **job-level model** while keeping the
health check as the job. One job timer, with the **health-check element carved
out** as its own measure, optional **indirect (non-productive) time** in
configurable categories, and a **corrected, leak-proof board overrun**.

### 1.1 Decisions locked (June 2026)

| Decision | Choice |
|---|---|
| Job container | **Reuse the `health_checks` record as the job** — no new parent table. It already carries `job_number`, the 28-state lifecycle, `booked_repairs` and `repair_items`. |
| Time granularity | **One job timer + a carved-out health-check time.** *Not* per-repair-line clocking. |
| HC boundary | **Split-by-milestone** — productive time before "Health check done" is *inspection*; after is *repair*. Technician does not hand-pick productive categories. |
| Indirect time | **In scope, feature-flagged per org** with a configurable category list + settings area. Indirect **pauses** the job clock and never counts toward job time. Can be **job-linked or shop-level** (no job attached — e.g. cleaning, training). |
| Board output | **Live overrun only** (actual vs estimate), corrected and made leak-proof. Health-check time is **tracked and displayed, but not flagged** over/under in this version. |
| Multi-tech | Job time = sum of **all** technicians' productive segments on the job. Card stays in the assigned tech's column; the live indicator names the tech(s) actually clocked on. |

### 1.2 Explicitly out of scope (this version)

Per "live overrun only": **no** sold-vs-actual efficiency reporting, **no**
utilisation/attendance (productivity %), **no** flat-rate payroll. The data
model below is a deliberate foundation for those later (segments + categories
are exactly what they need) but none are built now.

Also deferred (data captured, UI/flag added later): a **health-check
expected-time / over-under flag** (HC time is shown, not judged), an
**auto-close review queue** (auto-closed time is capped and trusted, §5.3), and
a **per-technician breakdown** on the card (job time sums all techs for now).

---

## 2. Concepts & model

- **Job** — the `health_checks` record. Spans inspection → pricing → customer →
  authorised work → complete.
- **Segment** — one `technician_time_entries` row: a single clock-on/clock-off
  by one technician, in one category. A job accumulates many segments across its
  life and across technicians. Productive segments **always** belong to a job;
  **indirect** segments may be job-linked **or** shop-level (no job).
- **Category** — what a segment *is*. Two kinds:
  - **Productive** (counts toward job time): `Inspection`, `Repair`, plus any
    custom productive categories (e.g. `Diagnostic`, `Road test`).
  - **Indirect** (does *not* count toward job time): `Waiting for parts`,
    `Waiting for authorisation`, `Break`, `Internal`, … — fully configurable,
    only active when the org enables indirect tracking.

### 2.1 The three numbers

| Number | Definition |
|---|---|
| **Job time** | Σ duration of all **productive** segments on the job (all technicians). |
| **Health-check time** | Σ duration of segments whose category has `is_health_check = true` (i.e. `Inspection`). A subset of job time. |
| **Indirect time** | Σ duration of **indirect** segments. Tracked, reported separately, excluded from job time and overrun. |

---

## 3. Data model changes

All migrations **additive**, `IF NOT EXISTS`, new migration files only — per
`.claude/rules/database-safety.md`. **No** `db reset`, no destructive changes,
no backfill that drops data.

### 3.1 New table: `time_entry_categories` (org-scoped, configurable)

```sql
CREATE TABLE IF NOT EXISTS time_entry_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL,                 -- stable slug, e.g. 'inspection'
  label VARCHAR(100) NOT NULL,              -- display, e.g. 'Inspection'
  kind VARCHAR(20) NOT NULL,                -- 'productive' | 'indirect'
  is_health_check BOOLEAN DEFAULT false,    -- carves out HC time; ~1 per org
  counts_toward_job BOOLEAN DEFAULT true,   -- productive ⇒ true; indirect ⇒ false
  colour VARCHAR(7),                        -- board/segment tint
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,          -- seeded Inspection/Repair: not deletable
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, key)
);
```

Seed per organisation on migration: `Inspection` (productive,
`is_health_check`, system), `Repair` (productive, system), and disabled-by-
default indirect rows (`Waiting for parts`, `Waiting for authorisation`,
`Break`, `Internal`) the org can enable.

### 3.2 `technician_time_entries` — new columns + relax `health_check_id`

```sql
-- allow shop-level indirect time (no job attached)
ALTER TABLE technician_time_entries ALTER COLUMN health_check_id DROP NOT NULL;

ALTER TABLE technician_time_entries
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES time_entry_categories(id),
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id), -- scope when health_check_id is null
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id),
  ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN DEFAULT false,  -- closed by the EOD worker (capped, trusted)
  ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(30);          -- 'manual' | 'auto_eod' | 'reclock'
```

`health_check_id` becomes nullable so a **shop-level** indirect segment can
exist with no job; `organization_id`/`site_id` carry the tenancy scope those
rows would otherwise inherit from the job. **Productive segments still require a
job** — enforce in the API (optionally a CHECK: a `productive` segment must have
`health_check_id NOT NULL`). The existing `work_type VARCHAR(50)` column stays
for backward compatibility; `category_id` becomes the source of truth. Existing
rows have `category_id = NULL` → treated as the org's `Inspection` category by
the read layer until backfilled (§9).

### 3.3 Settings — master toggle + auto-close

Reuse the existing settings-table pattern (`organization_settings`,
`organization_checkin_settings`). Add columns on `organization_settings`:

```sql
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS indirect_time_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_segment_stale_minutes INTEGER DEFAULT 600, -- ignore/close open segments older than this
  ADD COLUMN IF NOT EXISTS auto_close_at_eod BOOLEAN DEFAULT true;
```

(`organization_settings.timezone`, default `Europe/London`, drives "end of day"
for auto-close and avoids the BST/UTC drift seen in the incident.)

Deferred (not added now): a health-check expected-time / over-under target — see
§5.2.

---

## 4. Clocking flow & lifecycle

The "single job timer + health-check time" the technician experiences, with
segments underneath:

1. **Clock on (inspection).** Tech opens the job and taps *Start*. A segment
   opens with the org's `Inspection` category. HC status → `in_progress`,
   `tech_started_at` set (unchanged from today).
2. **Health check done.** Tech completes the VHC (existing clock-out with
   `complete: true`, `apps/api/src/routes/health-checks/status.ts` ~L973). The
   inspection segment closes; `tech_completed_at` set. **Everything clocked up
   to here is health-check time.**
3. **Gap (pricing → authorisation).** No productive clock runs. If indirect
   tracking is on, the job may carry a `Waiting for authorisation` indirect
   segment, but that does not advance job time or overrun.
4. **Re-clock (repair).** Once work is authorised, the tech clocks back onto the
   **same job**; the new productive segment defaults to `Repair` (because the
   job is past its HC-done milestone). Multiple on/off cycles allowed.
5. **Work complete.** Tech marks the job complete (`work_complete`). **Job time
   = Σ all productive segments**; HC time = the inspection subset.

**Split-by-milestone rule:** the *default productive category* for a new
segment is `Inspection` before `tech_completed_at`, else `Repair`. The
technician never has to choose between productive categories; they only pick an
**indirect** category when starting non-job time (and only if it's enabled).

**Indirect pauses the job clock:** starting an indirect segment closes any open
productive segment first (a job has at most one open *productive* segment per
technician at a time). Indirect time can **also** be logged shop-level with no
job (e.g. cleaning, training) via a job-less clock path (§8) — there's simply no
job clock to pause.

---

## 5. Overrun calculation (the board)

### 5.1 Corrected `actualWorkedMinutes`

`apps/web/src/pages/WorkshopBoard/types.ts` `actualWorkedMinutes()` (~L106) and
its consumers in `TimelineView.tsx` (overrun ~L524-526; header `anyOverrun`
~L307) change to:

- Sum **closed productive** segment durations (`category.counts_toward_job`),
  **excluding indirect**.
- Add live elapsed for the **open productive** segment(s) **only if** the
  segment is younger than `open_segment_stale_minutes`. An older open segment is
  ignored in the live figure and surfaced as a **"check clock"** flag, never as
  hundreds of hours.
- `Job overrun = max(0, productive job time − job estimate)`. Job estimate is
  unchanged (`estimated_hours`, else Σ booked-repair units;
  `apps/api/src/routes/workshop-board.ts`).

### 5.2 Health-check time (no over/under flag this version)

HC time is computed (Σ `is_health_check` segments) and **displayed** on the job
modal and HC detail, but is **not** compared against a target or flagged
over/under in this version — there is no `hc_expected_minutes`. Adding a
health-check expected-time and overrun flag later is purely additive, since the
HC time itself is already captured.

### 5.3 Stale-clock guard & auto clock-off (the actual fix)

- **Read-time guard (immediate):** §5.1 ignores over-threshold open segments —
  no card can ever show a 400h overrun again, even before any cron runs.
- **Scheduled auto-close (BullMQ, per CLAUDE.md queue):** at each org's
  end-of-business-day (`timezone`), close still-open segments. Set
  `clock_out_at` = site close time (not `now`), `auto_closed = true`,
  `closed_reason = 'auto_eod'`, compute the capped `duration_minutes`. The capped
  value is **trusted, not queued for review** — the `auto_closed` flag remains
  for audit (a subtle marker on the segment history).
- The existing same-tech re-clock auto-close (status.ts ~L874) stays as a
  belt-and-braces path; it is **no longer the only** close mechanism.

### 5.4 Cross-technician attribution

- Job time/overrun reflects **all** technicians' productive segments on the job
  (the incident showed Harrison's clock against a Wayne card).
- The card stays in the **assigned** technician's column (board derivation
  unchanged), but the live "clocked on" indicator names whoever actually holds
  an open productive segment.
- `apps/api/src/routes/workshop-board.ts` continues to surface open segments,
  now with category + technician so the front-end can label correctly and
  exclude indirect.

---

## 6. Display surfaces

Clocking data already shows on several screens; today each renders a single
flat figure (or a live inspection timer) and none distinguish **job** vs
**health-check** vs **indirect** time. This is what each surface shows now and
what changes. **Internal only — clocking / labour time never appears on the
customer-facing report or portal** (customers see repair *prices*, not hours).

The two the brief calls out — the **job detail modal** and the **health
check** — are rows 2–3.

| Surface | File(s) | Shows today | Add |
|---|---|---|---|
| Board cards (timeline + kanban) | `WorkshopBoard/TimelineView.tsx`, `JobCard.tsx`, `BoardColumn.tsx` | Clocked-on dot, live overrun hatch, column capacity | Corrected job overrun (productive only); name the tech actually clocked (§5.4) |
| **Job detail modal** | `WorkshopBoard/JobDetailModal.tsx` (~L64, L277–280) | One flat "{worked} worked" / "● clocked on" in the Technician field | A dedicated **Time** block — Job time, Health-check time, Indirect time (by category, if enabled), vs estimate / overrun — plus a **segment history**: tech · category · start–end · duration · auto-closed flag |
| **Health check detail** | `HealthChecks/HealthCheckDetail.tsx` (`InspectionTimer` ~L1120; entries fetch ~L228) | Live `InspectionTimer`, only while `in_progress` | A **persistent time summary** that survives completion: HC time (displayed, no over/under flag), Job time once repair work is clocked, and the segment breakdown |
| Health check list | `HealthChecks/HealthCheckList.tsx` (~L326) | Per-row live timer | HC time (no over/under flag); stale guard so a row never shows "days" |
| Dashboard — Technician workload | `Dashboard/TeamPanel.tsx`; `/dashboard/technicians` | Per-tech status; `formatElapsed` already caps stale entries at "Xd+" — a cosmetic workaround for the very bug this fixes | Real numbers once auto-close lands (the cap becomes redundant); show what each tech is on + productive/indirect (incl. shop-level) |
| Reusable timer | `components/InspectionTimer.tsx` | Live tick from `activeClockInAt` + closed minutes | Generalise to a **JobTimer** (label: Health check / Repair / Job); apply the §5.3 stale guard centrally so every consumer inherits it |
| Mobile technician PWA | `mobile` `PreCheck.tsx` (clock-in), `Inspection.tsx` (pause), `Summary.tsx` (complete), `JobList.tsx` | Inspection-only flow: clock in → inspect → pause / complete | A visible running timer; a **"Start repair"** re-clock path after authorisation (productive `Repair`); an **indirect category** picker when enabled; the tech's own time on the job |

**Single source of truth.** Every surface reads the same derived numbers (job
time / HC time / indirect, and the §5 overrun), computed once server-side
(`GET /api/v1/workshop-board` and the HC-detail payload) — so the modal, the
health check and the board can never disagree, and the stale guard is applied
in one place.

---

## 7. Settings area (web)

New **Time Tracking** settings page (alongside existing workshop/check-in
settings):

- **Master toggle** — `indirect_time_enabled` on/off.
- **Category manager** — CRUD over `time_entry_categories`: label, kind
  (productive/indirect), colour, active, order. `is_system` rows (Inspection,
  Repair) are renamable but not deletable; exactly one `is_health_check`.
- **Auto-close** — `auto_close_at_eod`, `open_segment_stale_minutes`.

Org-admin+ only (`authorizeMinRole('org_admin')`).

---

## 8. API changes

- `POST /:id/clock-in` — accept optional `categoryKey`; default per
  split-by-milestone rule. Reject a second open **productive** segment for the
  same tech/job.
- `POST /:id/clock-out` — unchanged contract; closes the open segment, sets
  `closed_reason = 'manual'`.
- `POST /:id/clock-indirect` (new, gated by `indirect_time_enabled`) — close any
  open productive segment, open a **job-linked** indirect one.
- `POST /api/v1/time-entries/indirect` (new, gated) — open a **shop-level**
  indirect segment with no job (`health_check_id` null), scoped by
  `organization_id`/`site_id`.
- `GET /api/v1/workshop-board` — include `categoryId`/`kind` and the open-segment
  technician so the board can apply §5.
- Settings CRUD endpoints for `time_entry_categories` + the new flags.
- **Scheduled worker** — end-of-day auto-close (§5.3).

---

## 9. Migration & rollout plan

1. **Migration** — create `time_entry_categories`; relax
   `technician_time_entries.health_check_id` to nullable; add `category_id`,
   `organization_id`, `site_id`, `auto_closed`, `closed_reason`; add the
   `organization_settings` flags; seed categories per org. All additive /
   `IF NOT EXISTS`.
2. **Backfill (safe)** — set `category_id` to each org's `Inspection` category
   and populate `organization_id`/`site_id` from the linked health check, for
   existing rows (`UPDATE … WHERE … IS NULL`). No deletes.
3. **Read layer** — treat `category_id IS NULL` as Inspection so nothing breaks
   mid-migration.
4. **Board fix first** — §5.1 read-time guard + §5.3 scheduled close can ship
   ahead of the rest to kill the 410h class of bug immediately.
5. **Flow + settings** — clock-in category default, indirect endpoints, settings
   page. Indirect stays **off** by default, so existing orgs see no behaviour
   change until they opt in.
6. **Dev hygiene** — close the orphaned KK68WWA segment
   (`208c6648-7544-41f5-b363-3544eb67fffb`) as part of step 4 verification.

---

## 10. Resolved decisions (2026-06-14)

The first-draft open questions, now settled:

1. **Indirect scope** — **shop-level allowed**. Indirect time can be job-linked
   or logged with no job (cleaning, training); `health_check_id` relaxed to
   nullable, `organization_id`/`site_id` added (§3.2, §8).
2. **HC expected time** — **none this version**. HC time is tracked and
   displayed but not flagged over/under (§5.2); a target can be added later.
3. **Auto-closed segments** — **capped silently at site close**, no review
   queue; `auto_closed` kept for audit (§5.3).
4. **Segment-history visibility** — **totals + expandable history** on the modal
   and HC detail, internal roles only (§6).
5. **Per-tech breakdown** *(defaulted)* — deferred to the out-of-scope
   efficiency view; job time sums all techs.
6. **Timer component** *(defaulted)* — **wrap/generalise** `InspectionTimer`
   into a `JobTimer` (label prop), not a hard rename, to avoid churn across the
   HC list, HC detail and mobile.

Status: spec complete — ready to build (board-fix-first, §9).
