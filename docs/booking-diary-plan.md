# Booking Diary — Implementation Plan

> Advisor-facing daily/weekly booking diary. Shows, per day: total jobs, booked hours
> vs hours available with a "booked %" bar, and counts of MOTs / While-You-Waits / Loan
> cars. Click a day to drill into every booking. Unifies GMS-native jobsheets **and**
> Gemini-DMS-imported bookings into one feed.

Status: **P1 built, typechecked, validated against dev data — pending deploy** (2026-06-25).

## Build status (P1)
- Migration `supabase/migrations/20260625120000_booking_diary.sql` — new columns, `vw_diary_bookings` view, `diary_available_hours` / `diary_day_summary` / `diary_day_bookings` RPCs. **Written; NOT yet applied to dev** (must go via the deploy pipeline, not MCP, to avoid version drift).
- Importer: `gemini-osi.ts` now captures top-level `Duration` (hours) + a `durationHours` field; `dms-import.ts` persists `estimated_hours`, `booked_service_type`, `is_mot_booking` (inferred from `\bmot\b` in booked work / notes).
- API: `apps/api/src/routes/booking-diary.ts` (`/summary`, `/day`), mounted at `/api/v1/booking-diary`; gated `requireModule('booking_diary')` + `authorize(advisor+)`.
- Web: `apps/web/src/pages/BookingDiary/` (page + `useDiaryData` hooks + types), route `/diary`, nav entry, new `booking_diary` module (defaultOn) in both `lib/modules.ts` registries.
- Verified: API + web `tsc --noEmit` clean; all 36 existing columns the view depends on confirmed present on dev; jobsheet/shift migrations confirmed live on dev; JSONB + capacity SQL smoke-tested against 1,177 real DMS rows.
- Remaining to go live: commit + push to `dev` → pipeline runs `supabase db push` (applies migration) + Railway redeploys API/web → browser-verify on dev.

---

## 1. Background — what exists today

There is no diary, no per-day aggregation, and no unified "booking" entity. Bookings
live in two unreconciled places:

| | Gemini DMS import | GMS-native jobsheet |
|---|---|---|
| Row | `health_checks` (`external_source='gemini_osi'`, `jobsheet_id IS NULL`) | `jobsheets` (`is_draft=false`) |
| Appointment | `health_checks.due_date` (TIMESTAMPTZ) | `jobsheets.due_in_date` + `due_in_time` |
| Loan | `loan_car_required` BOOL | `courtesy_vehicle_required` BOOL |
| While-you-wait | `customer_waiting` BOOL | `'waiting'` `booking_codes` tag (join) |
| MOT | **none** (see §3) | `service_types.code='mot'` via `service_type_id` |
| Hours | Gemini `Duration` (dropped on import) | priced `repair_labour.hours` work lines |

Capacity already exists but only client-side: `dayCapacityMinutes()` in
`apps/web/src/pages/WorkshopBoard/types.ts:196` (shift hours − lunch − absences). Tables
`workshop_tech_shifts` / `workshop_tech_absences` (migration `20260624130000`). No API
returns available-hours-per-day. All GMS/shift migrations are committed on `dev`.

---

## 2. Evidence from the real Gemini payload (`docs/gemini-full-response-sample.json`, 43 bookings)

- `Jobsheet.MOT` / `Jobsheet.MOTVAT` are **money amounts, `0` on all 43** — not an MOT flag.
- `Workshop` = `"FORD"`/`"Ford"` (dealer brand), not a service type. No `ServiceType` field.
- **MOT is detectable in line items:** `Repairs[].Description = "MOT Labour"` ×15; `Notes`
  contain "MOT"/"CARRY OUT MOT £54.85" in ~25 bookings.
- **Every booking has a top-level `Duration` in hours** (1.3, 2.3, 3.8, 4, 11.9 …), but
  **5/43 (~12%) are `Duration: 0`** → fallback required. Importer currently hardcodes 60 min.

---

## 3. Core decisions (locked with user, 2026-06-25)

1. **Build full unified diary** (both sources) — GMS migrations are committed on dev.
2. **Booked-hours ladder (never zero):**
   - DMS: `health_checks.estimated_hours` (= captured Gemini `Duration`) → Σ `booked_repairs[].labourItems.units` → service-type default → org default.
   - GMS: `jobsheets.estimated_hours` (new, optional) → Σ priced `repair_labour.hours` → service-type default → org default.
3. **Capacity = configurable per-tech target.** New setting `bookable_hours_per_tech`
   (per site). `available_hours_day = (techs on shift that day, minus absences) × setting`.
   Shift/absence headcount from `workshop_tech_shifts` / `workshop_tech_absences`.
4. **MOT robustness:** read-time normalise + capture on import. `is_mot_booking` set at
   import from `booked_repairs[].description ILIKE '%mot%'` OR `notes ILIKE '%mot%'`;
   GMS uses `service_types.is_mot` (new flag on the seeded MOT row, robust to renames).
5. **Booked % RAG bands** (reuse existing convention): green <85%, amber 85–100%, red >100%.

Defaults chosen where not explicitly specified (revisit if wrong):
- **Module/roles:** new `ModuleKey 'booking_diary'`, defaults on where workshop board or
  jobsheets is enabled; visible to `service_advisor` and above.
- **Per-service-type default hours** seed: MOT 0.75, Interim service 1.0, Full service 1.5,
  Diagnostic 1.0, Repair 1.5, Tyres 0.5, Air conditioning 1.0, Warranty 1.0; org fallback 1.0.
- **Scope:** per-site (uses the user's site); multi-site switcher is P2.

---

## 4. Schema — one migration `2026MMDDHHMMSS_booking_diary.sql` (all `IF NOT EXISTS`)

```sql
-- capture what the importer currently drops
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS estimated_hours   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS is_mot_booking    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booked_service_type TEXT;

-- let a GMS booking carry a duration before priced work lines exist
ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5,2);

-- robust MOT marker + per-type default duration
ALTER TABLE service_types
  ADD COLUMN IF NOT EXISTS is_mot        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_hours NUMERIC(4,2);
UPDATE service_types SET is_mot = true WHERE code = 'mot';
-- + seed default_hours per code

-- the capacity setting
ALTER TABLE workshop_board_config
  ADD COLUMN IF NOT EXISTS bookable_hours_per_tech NUMERIC(4,1);  -- NULL ⇒ fall back to default_tech_hours

-- indexes to key the diary on appointment day
CREATE INDEX IF NOT EXISTS idx_hc_org_due_date   ON health_checks (organization_id, due_date);
-- idx_jobsheets_org_due_in already exists
```

Plus `vw_diary_bookings` (UNION of the two branches → common shape) and RPCs
`diary_day_summary(p_org, p_site, p_from, p_to)` and `diary_day_bookings(p_org, p_site, p_date)`.
Capacity formula ported into SQL once so client/server never drift.

`vw_diary_bookings` common columns: `booking_id, source('gms'|'dms'), organization_id,
site_id, appt_date, appt_time, customer_id, vehicle_id, registration, customer_name,
service_type_label, description, is_mot, is_waiting, is_loan, estimated_hours, status,
job_state, jobsheet_id, health_check_id`.
DMS branch filters `jobsheet_id IS NULL` so a GMS jobsheet's linked VHC never double-counts.

**`description` (brief per-row job summary).** A short snippet of the work requested, shown
on each booking row beneath the customer/service-type. Derived per branch, trimmed to the
first non-empty line and capped (~80 chars; full text available on the booking itself):
- GMS: `jobsheets.booking_notes` → else the first `repair_items` (source='booking') description → else `service_type_label`.
- DMS: first line of `health_checks.notes` (e.g. "CARRY OUT MOT £54.85") → else `booked_repairs[0].description` → else `booked_service_type`.
Computed in the view/RPC so the API returns it ready to render (`split_part(trim(notes), E'\n', 1)` + `left(...)`).

---

## 5. Importer changes
- `apps/api/src/services/gemini-osi.ts`: map real top-level `Duration` (hours) → `estimatedDuration`; keep `Workshop` as `serviceType`.
- `apps/api/src/jobs/dms-import.ts` `createHealthCheck`: persist `estimated_hours` (Duration, NULL when 0), `booked_service_type`, and `is_mot_booking` (description/notes ILIKE '%mot%'). Best-effort backfill of recent rows.

---

## 6. API — `apps/api/src/routes/booking-diary.ts` (`/api/v1/booking-diary`, `authorizeMinRole('service_advisor')`, org-scoped)
- `GET /summary?from&to&siteId` → `diary_day_summary` → one row/day: `{date, totalJobs, bookedHours, availableHours, bookedPct, freeHours, totalMots, totalWaiting, totalLoans}`. Range-capped (≤31 days).
- `GET /day?date&siteId` → `diary_day_bookings` → capacity header + bookings array (each with `source`, time, reg, customer, `serviceType`, `description` (brief job summary), estimatedHours, isMot/isWaiting/isLoan, status, and a `routeTarget` for `jobPath()`).
- Live refresh via existing socket events (`WORKSHOP_BOARD_UPDATED` / `HEALTH_CHECK_STATUS_CHANGED`).

---

## 7. Frontend — `apps/web/src/pages/BookingDiary/`
- Route `/diary` in `App.tsx` (lazy), nav entry in `DashboardLayout.tsx`, optional `RequireModule`.
- `useDiaryData(from,to)` mirroring `useBoardData`/`useTileData` (debounced socket refetch, poll fallback, `inFlightRef`).
- Week strip of day-summary cards: weekday/date, total jobs, booked-% bar (RAG), `38.5 / 48h · 80%`, pills `MOT n · Wait n · Loan n`. Whole card → drill-in.
- Day drill-in: capacity header + booking rows. Each row: time · reg · customer name + service-type, a **brief job description** line beneath (truncated, `title` tooltip for full text), then MOT/Wait/Loan badges, estimated hours, source tag. Whole row deep-links via `jobPath()` (GMS→jobsheet, DMS→health-check).
- Reuse the WorkshopBoard day-nav toolbar; styling per TileStatus reference (rounded-xl cards, indigo primary, rag-green/amber/red).

---

## 8. Phasing
- **P1 (MVP):** migration + view/RPCs + importer capture + `/summary` & `/day` routes + week-strip page with drill-in + nav. Settings field for `bookable_hours_per_tech`.
- **P2:** multi-site switcher; per-tech sub-bars; day→technician-lane timeline (reuse `TimelineView`); wire shift-based capacity into `report_technician_efficiency`; backfill DMS MOT/hours; add types to `packages/shared`.
- **P3:** first-class MOT lane with per-day slot cap; courtesy/loan fleet allocation; drag-to-create/move on the lane grid with overbooking warnings; month heat-map; no-show flagging.
