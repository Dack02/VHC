-- =============================================================================
-- Booking Diary — grouping dimensions (technician / advisor / bay)
--
-- The Booking Diary list views (Grouped + Table) need to group/segment bookings
-- by service advisor, assigned technician, and (for the Table) bay. All of these
-- already exist on the base tables; they were simply never surfaced in the diary
-- feed. This migration is a VIEW + RPC change only — NO base-table/schema change.
--
--   technician_id  GMS: earliest linked health_check's technician_id (NULL until a
--                       VHC is created/assigned — i.e. "Unassigned" for a future
--                       booking, which is correct).
--                  DMS: health_checks.technician_id.
--   advisor_id     GMS: jobsheets.advisor_id (usually set at booking time).
--                  DMS: health_checks.advisor_id.
--   bay_number     GMS: earliest linked health_check's bay_number (jobsheets has
--                       no bay). DMS: health_checks.bay_number.
--
-- Also adds diary_range_bookings() so a list view can fetch every booking across
-- a date window in ONE call (server-side aggregation, 1000-row-cap safe) and
-- group client-side, and extends diary_day_bookings() with the same new columns
-- (+ resolved technician/advisor display names).
--
-- Fully additive + idempotent. No destructive statements. service_role only.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Append technician_id / advisor_id / bay_number to the unified feed.
--    CREATE OR REPLACE appends the three columns to the END of both UNION arms
--    (allowed by Postgres; existing 22 columns keep their order). The GMS arm's
--    LATERAL health_check subselect is widened to carry technician_id + bay_number.
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
  hc.id                                          AS health_check_id,
  j.origin_source                                AS origin_source,
  j.follow_up_case_id                            AS follow_up_case_id,
  hc.technician_id                               AS technician_id,
  j.advisor_id                                   AS advisor_id,
  hc.bay_number::text                            AS bay_number
FROM jobsheets j
LEFT JOIN vehicles  v  ON v.id  = j.vehicle_id
LEFT JOIN customers c  ON c.id  = j.customer_id
LEFT JOIN service_types st ON st.id = j.service_type_id
LEFT JOIN LATERAL (
  SELECT h.id, h.status, h.job_state, h.technician_id, h.bay_number
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
  hc.id                                          AS health_check_id,
  hc.origin_source                               AS origin_source,
  hc.follow_up_case_id                           AS follow_up_case_id,
  hc.technician_id                               AS technician_id,
  hc.advisor_id                                  AS advisor_id,
  hc.bay_number::text                            AS bay_number
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
-- 2. diary_day_bookings gains technician/advisor/bay (+ resolved display names).
--    RETURNS TABLE signature changes, so DROP then CREATE.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS diary_day_bookings(uuid, uuid, date);
CREATE FUNCTION diary_day_bookings(
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
  health_check_id    uuid,
  origin_source      text,
  follow_up_case_id  uuid,
  technician_id      uuid,
  technician_name    text,
  advisor_id         uuid,
  advisor_name       text,
  bay_number         text
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
    db.health_check_id,
    db.origin_source,
    db.follow_up_case_id,
    db.technician_id,
    NULLIF(TRIM(COALESCE(ut.first_name,'') || ' ' || COALESCE(ut.last_name,'')), '') AS technician_name,
    db.advisor_id,
    NULLIF(TRIM(COALESCE(ua.first_name,'') || ' ' || COALESCE(ua.last_name,'')), '') AS advisor_name,
    db.bay_number
  FROM vw_diary_bookings db
  LEFT JOIN users ut ON ut.id = db.technician_id
  LEFT JOIN users ua ON ua.id = db.advisor_id
  WHERE db.organization_id = p_org_id
    AND db.site_id = p_site_id
    AND db.appt_date = p_date
  ORDER BY db.appt_time NULLS LAST, db.registration;
$$;
REVOKE ALL ON FUNCTION diary_day_bookings(uuid, uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION diary_day_bookings(uuid, uuid, date) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. diary_range_bookings — every booking across a date window in one call, so a
--    list view can render multiple days (Agenda) or a flat range table (Table)
--    and group/segment client-side. Same columns as diary_day_bookings + appt_date.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION diary_range_bookings(
  p_org_id  uuid,
  p_site_id uuid,
  p_from    date,
  p_to      date
)
RETURNS TABLE (
  appt_date          date,
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
  health_check_id    uuid,
  origin_source      text,
  follow_up_case_id  uuid,
  technician_id      uuid,
  technician_name    text,
  advisor_id         uuid,
  advisor_name       text,
  bay_number         text
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
    db.appt_date,
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
    db.health_check_id,
    db.origin_source,
    db.follow_up_case_id,
    db.technician_id,
    NULLIF(TRIM(COALESCE(ut.first_name,'') || ' ' || COALESCE(ut.last_name,'')), '') AS technician_name,
    db.advisor_id,
    NULLIF(TRIM(COALESCE(ua.first_name,'') || ' ' || COALESCE(ua.last_name,'')), '') AS advisor_name,
    db.bay_number
  FROM vw_diary_bookings db
  LEFT JOIN users ut ON ut.id = db.technician_id
  LEFT JOIN users ua ON ua.id = db.advisor_id
  WHERE db.organization_id = p_org_id
    AND db.site_id = p_site_id
    AND db.appt_date BETWEEN p_from AND p_to
  ORDER BY db.appt_date, db.appt_time NULLS LAST, db.registration;
$$;
REVOKE ALL ON FUNCTION diary_range_bookings(uuid, uuid, date, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION diary_range_bookings(uuid, uuid, date, date) TO service_role;
