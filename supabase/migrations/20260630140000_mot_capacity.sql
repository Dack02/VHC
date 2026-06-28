-- MOT capacity model
-- =================================================================
-- Consolidates the two ad-hoc "MOT bay" mechanisms (the unenforced
-- resource_assets.mot_bay row + the per-category hard_cap_jobs on a string-
-- matched MOT type) onto the MOT *repair type*:
--
--   1. repair_types.is_mot  — explicit, tenant-set flag that identifies which
--      repair type(s) are MOTs (replaces fragile `code ILIKE 'mot'` matching).
--   2. resource_site_config.mot_daily_cap      — count cap (MOT bay slots/day),
--      enforced by the capacity engine when category quotas are enabled.
--   3. resource_site_config.mot_capacity_hours — realistic workshop-time an MOT
--      consumes for diary loading %, decoupled from the (tiny) priced labour.
--
-- The "MOT bays" Physical Resource field is retired in the UI; the asset table
-- is left intact for loan cars / waiter seats.

-- 1. Identify the MOT repair type(s) explicitly ----------------------------
ALTER TABLE repair_types
  ADD COLUMN IF NOT EXISTS is_mot BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN repair_types.is_mot IS
  'Tenant-set: this repair type is an MOT. Drives MOT bay count cap + diary loading hours.';

-- Backfill existing rows that look like an MOT so behaviour carries over.
UPDATE repair_types
   SET is_mot = true
 WHERE is_mot = false
   AND (code ILIKE 'mot' OR label ILIKE 'mot');

-- 2/3. Per-site MOT capacity settings -------------------------------------
ALTER TABLE resource_site_config
  ADD COLUMN IF NOT EXISTS mot_daily_cap      INTEGER,        -- null = no cap
  ADD COLUMN IF NOT EXISTS mot_capacity_hours NUMERIC(4,2);   -- null = use the booking's own hours

COMMENT ON COLUMN resource_site_config.mot_daily_cap IS
  'Max MOTs accepted per day (bay slots). Enforced by the capacity engine when category quotas are on.';
COMMENT ON COLUMN resource_site_config.mot_capacity_hours IS
  'Workshop-time each MOT booking contributes to the diary loading %, standing in for the small priced labour line.';

-- 4. diary_day_summary — MOT bookings load at mot_capacity_hours -----------
-- Signature unchanged, so CREATE OR REPLACE is safe. A booking is an MOT when it
-- carries an Is-MOT repair type (repair_types.is_mot) — the Main Booking
-- Requirement no longer factors in — or, for DMS imports (which have no repair
-- lines), the importer's own MOT flag. Such a booking loads as (its non-MOT work)
-- + the site's mot_capacity_hours, so a Service+MOT combo isn't wiped down to the
-- MOT figure and a bare MOT counts the real bay time, not its tiny labour line.
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
  total_loans     int,
  total_outreach  int
)
LANGUAGE sql
STABLE
AS $$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT default_booking_hours FROM workshop_board_config
                 WHERE organization_id = p_org_id AND site_id = p_site_id LIMIT 1), 1.0) AS dbh,
      (SELECT mot_capacity_hours FROM resource_site_config
                 WHERE organization_id = p_org_id AND site_id = p_site_id LIMIT 1)        AS mch
  ),
  days AS (
    SELECT generate_series(p_from, p_to, interval '1 day')::date AS d
  ),
  -- Per booking: is it an MOT (Is-MOT repair type on the job, or a DMS import
  -- flagged at import time), and how many of its hours are the MOT line itself —
  -- so a Service+MOT job loads as (its other work) + mot_capacity_hours, not double.
  bk AS (
    SELECT
      v.appt_date,
      v.is_waiting,
      v.is_loan,
      v.origin_source,
      COALESCE(v.estimated_hours, (SELECT dbh FROM cfg), 1.0) AS est_hours,
      (
        EXISTS (
          SELECT 1 FROM repair_items ri
            JOIN repair_types rt ON rt.id = ri.repair_type_id
          WHERE rt.is_mot AND ri.deleted_at IS NULL
            AND (ri.jobsheet_id = v.jobsheet_id OR ri.health_check_id = v.health_check_id)
        )
        OR (v.source = 'dms' AND v.is_mot)
      ) AS is_mot_final,
      COALESCE((
        SELECT SUM(rl.hours) FROM repair_items ri
          JOIN repair_types rt ON rt.id = ri.repair_type_id
          JOIN repair_labour rl ON rl.repair_item_id = ri.id
        WHERE rt.is_mot AND ri.deleted_at IS NULL
          AND (ri.jobsheet_id = v.jobsheet_id OR ri.health_check_id = v.health_check_id)
      ), 0) AS mot_labour_hours
    FROM vw_diary_bookings v
    WHERE v.organization_id = p_org_id AND v.site_id = p_site_id
      AND v.appt_date BETWEEN p_from AND p_to
  ),
  b AS (
    SELECT
      appt_date,
      COUNT(*)                                                          AS jobs,
      SUM(
        CASE
          WHEN is_mot_final AND (SELECT mch FROM cfg) IS NOT NULL
            THEN GREATEST(0, est_hours - mot_labour_hours) + (SELECT mch FROM cfg)
          ELSE est_hours
        END
      )                                                                 AS booked,
      COUNT(*) FILTER (WHERE is_mot_final)                              AS mots,
      COUNT(*) FILTER (WHERE is_waiting)                                AS waiting,
      COUNT(*) FILTER (WHERE is_loan)                                   AS loans,
      COUNT(*) FILTER (WHERE origin_source = 'follow_up')               AS outreach
    FROM bk
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
