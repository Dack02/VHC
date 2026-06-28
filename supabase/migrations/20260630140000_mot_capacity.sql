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
-- Signature unchanged, so CREATE OR REPLACE is safe. Booked hours now charge a
-- booking-level MOT (Main Booking Requirement = MOT / DMS is_mot_booking) at the
-- site's mot_capacity_hours when set, instead of its own (tiny) estimate.
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
  b AS (
    SELECT
      appt_date,
      COUNT(*)                                                          AS jobs,
      SUM(
        CASE
          WHEN is_mot AND (SELECT mch FROM cfg) IS NOT NULL THEN (SELECT mch FROM cfg)
          ELSE COALESCE(estimated_hours, (SELECT dbh FROM cfg), 1.0)
        END
      )                                                                 AS booked,
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
