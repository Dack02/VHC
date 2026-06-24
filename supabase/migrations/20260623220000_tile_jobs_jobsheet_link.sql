-- =============================================================================
-- Tile Status drill-in: ensure the RPC exposes jobsheet_id (job-card routing).
--
-- WHY THIS EXISTS (drift remediation):
-- 20260623210000 was first applied to dev as a job_number-ONLY definition, so its
-- version is already recorded in dev's schema_migrations. A later edit to that same
-- file added jobsheet_id, but `supabase db push` never re-runs an applied version —
-- so dev's live workshop_status_tile_jobs has job_number but NOT jobsheet_id, and
-- the drill-in can't route job-card rows to their job card.
--
-- This NEW migration re-defines the function with jobsheet_id (idempotent DROP +
-- CREATE). It applies cleanly everywhere: on dev it adds the missing column; on a
-- fresh env (prod) it simply re-asserts the same shape 210000 already created.
-- Per project rules, 210000 is left untouched.
--
-- Returns:
--   * jobsheet_id — parent job card (NULL for plain health checks) for UI routing.
--   * job_number  — jobsheet reference ?: hc.jobsheet_number ?: hc.job_number.
-- =============================================================================

DROP FUNCTION IF EXISTS workshop_status_tile_jobs(uuid, uuid, uuid, boolean, uuid, int);

CREATE FUNCTION workshop_status_tile_jobs(
  p_org_id uuid,
  p_site_id uuid,
  p_status_id uuid DEFAULT NULL,
  p_no_status boolean DEFAULT false,
  p_advisor_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  health_check_id uuid,
  jobsheet_id uuid,
  job_number text,
  registration text,
  make text,
  model text,
  customer_name text,
  advisor_name text,
  technician_name text,
  job_state text,
  vhc_status text,
  days_in_status int,
  promise_time timestamptz,
  due_date timestamptz,
  since timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    hc.id,
    hc.jobsheet_id,
    COALESCE(NULLIF(js.reference, ''), NULLIF(hc.jobsheet_number, ''), NULLIF(hc.job_number, '')),
    v.registration,
    v.make,
    v.model,
    NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
    NULLIF(TRIM(COALESCE(ua.first_name, '') || ' ' || COALESCE(ua.last_name, '')), ''),
    NULLIF(TRIM(COALESCE(ut.first_name, '') || ' ' || COALESCE(ut.last_name, '')), ''),
    hc.job_state,
    hc.status,
    (CURRENT_DATE - COALESCE(wc.workshop_status_changed_at, wc.created_at, hc.created_at)::date)::int,
    hc.promise_time,
    hc.due_date,
    COALESCE(wc.workshop_status_changed_at, wc.created_at, hc.created_at)
  FROM health_checks hc
  LEFT JOIN workshop_cards wc ON wc.health_check_id = hc.id AND wc.organization_id = p_org_id
  LEFT JOIN jobsheets js ON js.id = hc.jobsheet_id
  LEFT JOIN vehicles v ON v.id = hc.vehicle_id
  LEFT JOIN customers c ON c.id = hc.customer_id
  LEFT JOIN users ua ON ua.id = hc.advisor_id
  LEFT JOIN users ut ON ut.id = hc.technician_id
  WHERE hc.organization_id = p_org_id
    AND hc.site_id = p_site_id
    AND hc.job_state <> 'collected'
    AND hc.job_state <> 'due_in'   -- future bookings drill in via the Future Bookings tile
    AND hc.status NOT IN ('completed', 'cancelled', 'no_show')
    AND (p_advisor_id IS NULL OR hc.advisor_id = p_advisor_id)
    AND (
      (p_no_status AND wc.workshop_status_id IS NULL)
      OR (NOT p_no_status AND wc.workshop_status_id = p_status_id)
    )
  ORDER BY COALESCE(wc.workshop_status_changed_at, wc.created_at, hc.created_at) ASC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION workshop_status_tile_jobs(uuid, uuid, uuid, boolean, uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION workshop_status_tile_jobs(uuid, uuid, uuid, boolean, uuid, int) TO service_role;
