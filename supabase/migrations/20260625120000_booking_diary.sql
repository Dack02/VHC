-- =============================================================================
-- Booking Diary
--
-- Advisor-facing daily/weekly diary. Per day: total jobs, booked hours vs hours
-- available (a "booked %"), and counts of MOT / While-You-Wait / Loan-car jobs.
-- Click a day to see every booking.
--
-- Unifies the two booking representations WITHOUT a third table:
--   - GMS-native jobsheets (jobsheets, is_draft = false)
--   - Gemini-DMS imports (health_checks with external_source = 'gemini_osi' and
--     jobsheet_id IS NULL — so a GMS jobsheet's linked VHC never double-counts)
-- via the read-only view vw_diary_bookings, plus two RPCs that the API calls.
--
-- Capacity ("hours available") = a configurable per-tech booking target
-- (workshop_board_config.bookable_hours_per_tech, falling back to
-- default_tech_hours) summed over the technicians actually on shift that day
-- (workshop_tech_shifts minus workshop_tech_absences). Mirrors the client-side
-- dayCapacityMinutes() helper so the figure can't drift.
--
-- Fully additive + idempotent. No destructive statements. The API uses the
-- service role; functions/view are granted to service_role only.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Capture booking metadata the DMS import currently drops, and give a
--    GMS booking an optional booking-time duration.
-- ----------------------------------------------------------------------------
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS estimated_hours     NUMERIC(5,2),   -- from Gemini top-level Duration (hours)
  ADD COLUMN IF NOT EXISTS is_mot_booking      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booked_service_type TEXT;           -- raw Gemini Workshop / service descriptor

COMMENT ON COLUMN health_checks.estimated_hours IS 'Estimated job hours captured at booking (DMS: Gemini Duration). NULL when unknown.';
COMMENT ON COLUMN health_checks.is_mot_booking IS 'Booking includes an MOT (DMS: inferred from booked work / notes at import).';

ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5,2);       -- optional booking-time duration

-- ----------------------------------------------------------------------------
-- 2. Robust MOT marker + per-type default duration on the service_types lookup.
--    is_mot survives an org renaming the "MOT" label; default_hours is the last
--    rung of the booked-hours ladder.
-- ----------------------------------------------------------------------------
ALTER TABLE service_types
  ADD COLUMN IF NOT EXISTS is_mot        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_hours NUMERIC(4,2);

UPDATE service_types SET is_mot = true
  WHERE is_mot = false AND (code ILIKE 'mot' OR label ILIKE 'mot');

-- Seed sensible UK default durations where not already set (easy to edit).
UPDATE service_types SET default_hours = v.h
FROM (VALUES
  ('mot', 0.75), ('full service', 1.50), ('interim service', 1.00),
  ('repair', 1.50), ('diagnostic', 1.00), ('tyres', 0.50),
  ('air conditioning', 1.00), ('warranty', 1.00)
) AS v(code, h)
WHERE service_types.default_hours IS NULL
  AND lower(service_types.code) = v.code;

-- ----------------------------------------------------------------------------
-- 3. Capacity settings on the existing per-site board config.
--    bookable_hours_per_tech = "how many hours we want to book per tech".
--    default_booking_hours   = fallback when a booking has no estimate at all.
-- ----------------------------------------------------------------------------
ALTER TABLE workshop_board_config
  ADD COLUMN IF NOT EXISTS bookable_hours_per_tech NUMERIC(4,1),   -- NULL => fall back to default_tech_hours
  ADD COLUMN IF NOT EXISTS default_booking_hours   NUMERIC(4,2);   -- NULL => 1.0 in the RPCs

COMMENT ON COLUMN workshop_board_config.bookable_hours_per_tech IS 'Target bookable hours per technician per working day (Booking Diary capacity). NULL falls back to default_tech_hours.';
COMMENT ON COLUMN workshop_board_config.default_booking_hours IS 'Assumed hours for a booking with no estimate or priced labour. NULL falls back to 1.0.';

-- ----------------------------------------------------------------------------
-- 4. Unified read-only booking feed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_diary_bookings AS
-- GMS-native jobsheets (committed only)
SELECT
  j.id                                           AS booking_id,
  'gms'::text                                    AS source,
  j.organization_id,
  j.site_id,
  j.due_in_date                                  AS appt_date,
  j.due_in_time                                  AS appt_time,
  j.customer_id,
  j.vehicle_id,
  v.registration                                 AS registration,
  NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), '') AS customer_name,
  st.label                                       AS service_type_label,
  COALESCE(
    NULLIF(TRIM(j.booking_notes), ''),
    (SELECT COALESCE(NULLIF(TRIM(ri.description), ''), ri.name)
       FROM repair_items ri
      WHERE ri.jobsheet_id = j.id AND ri.source = 'booking'
      ORDER BY ri.created_at LIMIT 1),
    st.label
  )                                              AS description,
  COALESCE(st.is_mot, false)                     AS is_mot,
  EXISTS (
    SELECT 1 FROM jobsheet_booking_codes jbc
    JOIN booking_codes bc ON bc.id = jbc.booking_code_id
    WHERE jbc.jobsheet_id = j.id AND bc.code ILIKE 'waiting'
  )                                              AS is_waiting,
  COALESCE(j.courtesy_vehicle_required, false)   AS is_loan,
  COALESCE(
    j.estimated_hours,
    (SELECT SUM(rl.hours)
       FROM repair_items ri
       JOIN repair_labour rl ON rl.repair_item_id = ri.id
      WHERE ri.jobsheet_id = j.id AND ri.source = 'booking'),
    st.default_hours
  )                                              AS estimated_hours,
  hc.status::text                                AS status,
  COALESCE(hc.job_state, j.job_state)            AS job_state,
  j.id                                           AS jobsheet_id,
  hc.id                                          AS health_check_id
FROM jobsheets j
LEFT JOIN vehicles  v  ON v.id  = j.vehicle_id
LEFT JOIN customers c  ON c.id  = j.customer_id
LEFT JOIN service_types st ON st.id = j.service_type_id
LEFT JOIN LATERAL (
  SELECT h.id, h.status, h.job_state
  FROM health_checks h
  WHERE h.jobsheet_id = j.id
  ORDER BY h.created_at
  LIMIT 1
) hc ON true
WHERE COALESCE(j.is_draft, false) = false
  AND j.deleted_at IS NULL
  AND j.due_in_date IS NOT NULL

UNION ALL

-- Gemini-DMS imports that are NOT linked to a jobsheet
SELECT
  hc.id                                          AS booking_id,
  'dms'::text                                    AS source,
  hc.organization_id,
  hc.site_id,
  (hc.due_date)::date                            AS appt_date,
  (hc.due_date)::time                            AS appt_time,
  hc.customer_id,
  hc.vehicle_id,
  v.registration                                 AS registration,
  NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), '') AS customer_name,
  hc.booked_service_type                         AS service_type_label,
  COALESCE(
    NULLIF(TRIM(split_part(COALESCE(hc.notes,''), E'\n', 1)), ''),
    (SELECT NULLIF(TRIM(br->>'description'), '')
       FROM jsonb_array_elements(COALESCE(hc.booked_repairs, '[]'::jsonb)) br
      WHERE NULLIF(TRIM(br->>'description'), '') IS NOT NULL
      LIMIT 1),
    hc.booked_service_type
  )                                              AS description,
  COALESCE(hc.is_mot_booking, false)             AS is_mot,
  COALESCE(hc.customer_waiting, false)           AS is_waiting,
  COALESCE(hc.loan_car_required, false)          AS is_loan,
  COALESCE(
    hc.estimated_hours,
    (SELECT SUM((li->>'units')::numeric)
       FROM jsonb_array_elements(COALESCE(hc.booked_repairs, '[]'::jsonb)) br,
            jsonb_array_elements(COALESCE(br->'labourItems', '[]'::jsonb)) li
      WHERE NULLIF(li->>'units','') IS NOT NULL)
  )                                              AS estimated_hours,
  hc.status::text                                AS status,
  hc.job_state                                   AS job_state,
  NULL::uuid                                     AS jobsheet_id,
  hc.id                                          AS health_check_id
FROM health_checks hc
LEFT JOIN vehicles  v ON v.id = hc.vehicle_id
LEFT JOIN customers c ON c.id = hc.customer_id
WHERE hc.jobsheet_id IS NULL
  AND hc.external_source = 'gemini_osi'
  AND hc.due_date IS NOT NULL
  AND hc.status NOT IN ('cancelled', 'no_show');

REVOKE ALL ON vw_diary_bookings FROM public, anon, authenticated;
GRANT SELECT ON vw_diary_bookings TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Available booking hours for a site on a date (capacity).
--    Per technician (workshop_columns), a working day contributes the configured
--    bookable target; an all-day absence or a non-working weekday contributes 0;
--    partial absences are subtracted. Mirrors dayCapacityMinutes().
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION diary_available_hours(
  p_org_id  uuid,
  p_site_id uuid,
  p_date    date
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH cfg AS (
    SELECT bookable_hours_per_tech, default_tech_hours
    FROM workshop_board_config
    WHERE organization_id = p_org_id AND site_id = p_site_id
    LIMIT 1
  ),
  techs AS (
    SELECT wc.technician_id, wc.available_hours
    FROM workshop_columns wc
    WHERE wc.site_id = p_site_id
      AND wc.column_type = 'technician'
      AND wc.technician_id IS NOT NULL
      AND wc.is_visible
  ),
  per AS (
    SELECT GREATEST(0,
      CASE
        -- all-day absence
        WHEN EXISTS (
          SELECT 1 FROM workshop_tech_absences a
          WHERE a.technician_id = t.technician_id AND a.site_id = p_site_id
            AND p_date BETWEEN a.start_date AND a.end_date AND a.all_day
        ) THEN 0
        -- has a weekly pattern but not working this weekday
        WHEN EXISTS (SELECT 1 FROM workshop_tech_shifts s WHERE s.technician_id = t.technician_id)
         AND NOT EXISTS (
           SELECT 1 FROM workshop_tech_shifts s
           WHERE s.technician_id = t.technician_id
             AND s.weekday = (EXTRACT(isodow FROM p_date)::int - 1)
         ) THEN 0
        ELSE COALESCE(
          (SELECT bookable_hours_per_tech FROM cfg),
          (SELECT default_tech_hours      FROM cfg),
          t.available_hours, 8
        )
      END
      -- subtract any partial-day absences
      - COALESCE((
          SELECT SUM(EXTRACT(epoch FROM (a.end_time - a.start_time)) / 3600.0)
          FROM workshop_tech_absences a
          WHERE a.technician_id = t.technician_id AND a.site_id = p_site_id
            AND p_date BETWEEN a.start_date AND a.end_date
            AND NOT a.all_day AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
        ), 0)
    ) AS hours
    FROM techs t
  )
  SELECT COALESCE(SUM(hours), 0)::numeric FROM per;
$$;

REVOKE ALL ON FUNCTION diary_available_hours(uuid, uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION diary_available_hours(uuid, uuid, date) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Per-day summary across a date range (the week strip).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION diary_day_summary(
  p_org_id  uuid,
  p_site_id uuid,
  p_from    date,
  p_to      date
)
RETURNS TABLE (
  day             date,
  total_jobs      int,
  booked_hours    numeric,
  available_hours numeric,
  total_mots      int,
  total_waiting   int,
  total_loans     int
)
LANGUAGE sql
STABLE
AS $$
  WITH cfg AS (
    SELECT COALESCE(default_booking_hours, 1.0) AS dbh
    FROM workshop_board_config
    WHERE organization_id = p_org_id AND site_id = p_site_id
    LIMIT 1
  ),
  days AS (
    SELECT generate_series(p_from, p_to, interval '1 day')::date AS d
  ),
  b AS (
    SELECT
      appt_date,
      COUNT(*)                                                          AS jobs,
      SUM(COALESCE(estimated_hours, (SELECT dbh FROM cfg), 1.0))        AS booked,
      COUNT(*) FILTER (WHERE is_mot)                                    AS mots,
      COUNT(*) FILTER (WHERE is_waiting)                                AS waiting,
      COUNT(*) FILTER (WHERE is_loan)                                   AS loans
    FROM vw_diary_bookings
    WHERE organization_id = p_org_id AND site_id = p_site_id
      AND appt_date BETWEEN p_from AND p_to
    GROUP BY appt_date
  )
  SELECT
    d.d,
    COALESCE(b.jobs, 0)::int,
    ROUND(COALESCE(b.booked, 0), 2)::numeric,
    ROUND(diary_available_hours(p_org_id, p_site_id, d.d), 2)::numeric,
    COALESCE(b.mots, 0)::int,
    COALESCE(b.waiting, 0)::int,
    COALESCE(b.loans, 0)::int
  FROM days d
  LEFT JOIN b ON b.appt_date = d.d
  ORDER BY d.d;
$$;

REVOKE ALL ON FUNCTION diary_day_summary(uuid, uuid, date, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION diary_day_summary(uuid, uuid, date, date) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Every booking on a given day (the drill-in).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION diary_day_bookings(
  p_org_id  uuid,
  p_site_id uuid,
  p_date    date
)
RETURNS TABLE (
  booking_id         uuid,
  source             text,
  appt_time          time,
  registration       text,
  customer_name      text,
  service_type_label text,
  description        text,
  is_mot             boolean,
  is_waiting         boolean,
  is_loan            boolean,
  estimated_hours    numeric,
  status             text,
  job_state          text,
  jobsheet_id        uuid,
  health_check_id    uuid
)
LANGUAGE sql
STABLE
AS $$
  WITH cfg AS (
    SELECT COALESCE(default_booking_hours, 1.0) AS dbh
    FROM workshop_board_config
    WHERE organization_id = p_org_id AND site_id = p_site_id
    LIMIT 1
  )
  SELECT
    db.booking_id,
    db.source,
    db.appt_time,
    db.registration,
    db.customer_name,
    db.service_type_label,
    db.description,
    db.is_mot,
    db.is_waiting,
    db.is_loan,
    ROUND(COALESCE(db.estimated_hours, (SELECT dbh FROM cfg), 1.0), 2)::numeric AS estimated_hours,
    db.status,
    db.job_state,
    db.jobsheet_id,
    db.health_check_id
  FROM vw_diary_bookings db
  WHERE db.organization_id = p_org_id
    AND db.site_id = p_site_id
    AND db.appt_date = p_date
  ORDER BY db.appt_time NULLS LAST, db.registration;
$$;

REVOKE ALL ON FUNCTION diary_day_bookings(uuid, uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION diary_day_bookings(uuid, uuid, date) TO service_role;
