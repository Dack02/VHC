-- =============================================================================
-- Tile Status drill-in: surface the job / jobsheet number in the job list.
--
-- The drill-in table (and the Workshop Board) identify a job by its jobsheet
-- number, falling back to the DMS job number. The Tile Status drill-in RPC didn't
-- return either, so the list had no "Job no." column. Add a single coalesced
-- `job_number` column = jobsheet_number ?: job_number.
--
-- Adding a column to a RETURNS TABLE changes the function's output type, which
-- CREATE OR REPLACE cannot do — so DROP then CREATE. Dropping a function is not
-- destructive (no data), and it's recreated immediately below.
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
    COALESCE(NULLIF(hc.jobsheet_number, ''), NULLIF(hc.job_number, '')),
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
