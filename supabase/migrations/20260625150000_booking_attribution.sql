-- =============================================================================
-- Booking ↔ outreach attribution
--
-- Lets a booking carry a durable "this came from outreach" stamp so the Booking
-- Diary can flag it and reporting can measure recovered revenue. A booking is
-- physically EITHER a Gemini-DMS import (health_checks) OR a GMS-native jobsheet
-- (jobsheets), so the stamp lives on both tables.
--
--   origin_source              — acquisition/marketing channel that drove the
--                                booking. NULL = organic/unknown. 'follow_up' =
--                                the deferred-work Follow-Up module. Deliberately
--                                extensible: a future marketing module adds values
--                                (e.g. 'mot_reminder', 'service_due', 'campaign')
--                                and can add a campaign_id alongside.
--   follow_up_case_id          — the case that drove it (denormalised reverse of
--                                follow_up_cases.linked_booking_id, which stays the
--                                canonical case→booking pointer). ON DELETE SET NULL
--                                so the stamp survives the booking, and the column
--                                survives the case being deleted.
--   follow_up_attributed_at    — when attribution was stamped (detection time).
--   follow_up_attributed_value — £ snapshot (deferred_value_snapshot) at that time,
--                                so reports are stable against later price edits.
--
-- Attribution is stamped AUTO ON DETECTION by the follow-up engine's booking_found
-- path (see apps/api/src/services/follow-up-engine.ts). Fully additive + idempotent.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Attribution columns
-- ----------------------------------------------------------------------------
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS origin_source              TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_case_id          UUID REFERENCES follow_up_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_attributed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_attributed_value NUMERIC(10,2);

ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS origin_source              TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_case_id          UUID REFERENCES follow_up_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_attributed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_attributed_value NUMERIC(10,2);

COMMENT ON COLUMN health_checks.origin_source IS 'Acquisition channel that drove the booking. NULL=organic/unknown, ''follow_up''=Follow-Up module. Extensible for a future marketing module.';
COMMENT ON COLUMN jobsheets.origin_source IS 'Acquisition channel that drove the booking. NULL=organic/unknown, ''follow_up''=Follow-Up module. Extensible for a future marketing module.';

CREATE INDEX IF NOT EXISTS idx_health_checks_origin_source ON health_checks(organization_id, origin_source) WHERE origin_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_health_checks_follow_up_case ON health_checks(follow_up_case_id) WHERE follow_up_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobsheets_origin_source     ON jobsheets(organization_id, origin_source) WHERE origin_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobsheets_follow_up_case    ON jobsheets(follow_up_case_id) WHERE follow_up_case_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Backfill: existing follow-up detections (cases with a linked booking) stamp
--    their booking. NULL-guarded so it never overwrites an existing attribution.
-- ----------------------------------------------------------------------------
UPDATE health_checks hc
SET origin_source              = 'follow_up',
    follow_up_case_id          = c.id,
    follow_up_attributed_at    = COALESCE(c.updated_at, c.created_at),
    follow_up_attributed_value = COALESCE(c.deferred_value_snapshot, 0)
FROM follow_up_cases c
WHERE c.linked_booking_id = hc.id
  AND hc.follow_up_case_id IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Surface attribution in the unified diary feed. CREATE OR REPLACE appends the
--    two columns to the END of both UNION arms (allowed by Postgres).
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
  j.follow_up_case_id                            AS follow_up_case_id
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
  hc.id                                          AS health_check_id,
  hc.origin_source                               AS origin_source,
  hc.follow_up_case_id                           AS follow_up_case_id
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
-- 4. Diary RPCs gain the new columns. RETURNS TABLE signatures change, so DROP
--    then CREATE (CREATE OR REPLACE can't alter a function's result columns).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS diary_day_summary(uuid, uuid, date, date);
CREATE FUNCTION diary_day_summary(
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
  total_loans     int,
  total_outreach  int
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
      COUNT(*) FILTER (WHERE is_loan)                                   AS loans,
      COUNT(*) FILTER (WHERE origin_source = 'follow_up')               AS outreach
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
    COALESCE(b.loans, 0)::int,
    COALESCE(b.outreach, 0)::int
  FROM days d
  LEFT JOIN b ON b.appt_date = d.d
  ORDER BY d.d;
$$;
REVOKE ALL ON FUNCTION diary_day_summary(uuid, uuid, date, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION diary_day_summary(uuid, uuid, date, date) TO service_role;

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
  follow_up_case_id  uuid
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
    db.follow_up_case_id
  FROM vw_diary_bookings db
  WHERE db.organization_id = p_org_id
    AND db.site_id = p_site_id
    AND db.appt_date = p_date
  ORDER BY db.appt_time NULLS LAST, db.registration;
$$;
REVOKE ALL ON FUNCTION diary_day_bookings(uuid, uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION diary_day_bookings(uuid, uuid, date) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Outreach reporting RPC — bookings attributed to the Follow-Up module in a
--    period, grouped by a chosen dimension. Server-side aggregation (1000-row-cap
--    safe). Unifies the two booking tables. service_role only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION follow_up_outreach(
  p_org      uuid,
  p_from     timestamptz,
  p_to       timestamptz,
  p_site     uuid DEFAULT NULL,
  p_group_by text DEFAULT 'timeline'   -- 'timeline' | 'advisor' | 'site' | 'month'
)
RETURNS TABLE (
  group_key           text,
  group_label         text,
  bookings_attributed bigint,
  est_recovered       numeric,
  avg_touches         numeric
)
LANGUAGE sql STABLE AS $$
  WITH attributed AS (
    SELECT
      b.follow_up_case_id,
      b.follow_up_attributed_value,
      b.follow_up_attributed_at,
      b.site_id,
      c.timeline_id,
      c.assigned_to,
      (SELECT count(*) FROM follow_up_events e
        WHERE e.case_id = b.follow_up_case_id
          AND e.event_type IN ('step_sent', 'call_logged')) AS touches
    FROM (
      SELECT follow_up_case_id, follow_up_attributed_value, follow_up_attributed_at, organization_id, site_id
      FROM health_checks
      WHERE origin_source = 'follow_up' AND follow_up_case_id IS NOT NULL AND follow_up_attributed_at IS NOT NULL
      UNION ALL
      SELECT follow_up_case_id, follow_up_attributed_value, follow_up_attributed_at, organization_id, site_id
      FROM jobsheets
      WHERE origin_source = 'follow_up' AND follow_up_case_id IS NOT NULL AND follow_up_attributed_at IS NOT NULL
    ) b
    LEFT JOIN follow_up_cases c ON c.id = b.follow_up_case_id
    WHERE b.organization_id = p_org
      AND b.follow_up_attributed_at >= p_from
      AND b.follow_up_attributed_at <= p_to
      AND (p_site IS NULL OR b.site_id = p_site)
  ),
  keyed AS (
    SELECT
      a.*,
      CASE p_group_by
        WHEN 'advisor' THEN COALESCE(a.assigned_to::text, 'unassigned')
        WHEN 'site'    THEN COALESCE(a.site_id::text, 'none')
        WHEN 'month'   THEN to_char(a.follow_up_attributed_at, 'YYYY-MM')
        ELSE COALESCE(a.timeline_id::text, 'none')
      END AS group_key
    FROM attributed a
  )
  SELECT
    k.group_key,
    CASE p_group_by
      WHEN 'advisor' THEN COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), 'Unassigned')
      WHEN 'site'    THEN COALESCE(s.name, 'No site')
      WHEN 'month'   THEN k.group_key
      ELSE COALESCE(tl.name, 'No timeline')
    END AS group_label,
    count(DISTINCT k.follow_up_case_id)::bigint        AS bookings_attributed,
    COALESCE(sum(k.follow_up_attributed_value), 0)     AS est_recovered,
    COALESCE(ROUND(avg(k.touches), 1), 0)              AS avg_touches
  FROM keyed k
  LEFT JOIN users u             ON p_group_by = 'advisor'  AND u.id::text  = k.group_key
  LEFT JOIN sites s             ON p_group_by = 'site'     AND s.id::text  = k.group_key
  LEFT JOIN follow_up_timelines tl ON p_group_by = 'timeline' AND tl.id::text = k.group_key
  GROUP BY k.group_key, u.first_name, u.last_name, s.name, tl.name
  ORDER BY bookings_attributed DESC;
$$;
REVOKE ALL ON FUNCTION follow_up_outreach(uuid, timestamptz, timestamptz, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION follow_up_outreach(uuid, timestamptz, timestamptz, uuid, text) TO service_role;
