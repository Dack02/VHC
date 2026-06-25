-- Tile Status page: track when a card entered its current Job Status.
--
-- workshop_cards.updated_at bumps on ANY card edit (priority, hours, planned
-- start, etc.), so it can't tell us time-in-status. This column is stamped by
-- the API whenever workshop_status_id changes, letting the Tile Status page show
-- how many calendar days the longest-waiting job has sat in each Job Status.
--
-- Additive and idempotent (safe to re-run): add nullable, backfill, then make
-- it NOT NULL with a default.

ALTER TABLE workshop_cards
  ADD COLUMN IF NOT EXISTS workshop_status_changed_at TIMESTAMPTZ;

-- Backfill existing rows to the best available proxy for "entered status".
UPDATE workshop_cards
  SET workshop_status_changed_at = COALESCE(updated_at, created_at, NOW())
  WHERE workshop_status_changed_at IS NULL;

ALTER TABLE workshop_cards ALTER COLUMN workshop_status_changed_at SET DEFAULT NOW();
ALTER TABLE workshop_cards ALTER COLUMN workshop_status_changed_at SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Tile Status page aggregate.
--
-- Returns one row per Job Status bucket (plus a NULL bucket = "No job status")
-- for the ACTIVE jobs at a site: count, the oldest job's calendar-days in that
-- status, and breakdowns by Vehicle Status (job_state) and VHC pipeline state.
--
-- Aggregated in the DB so it never hits the PostREST row cap. Locked to the
-- service role (the API passes a server-trusted org id) so it can't be called
-- cross-tenant from the client. SECURITY INVOKER + CREATE OR REPLACE = idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workshop_status_tiles(
  p_org_id uuid,
  p_site_id uuid,
  p_advisor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  status_id uuid,
  name text,
  colour text,
  icon text,
  sort_order int,
  is_active boolean,
  count bigint,
  oldest_days int,
  vehicle_status jsonb,
  vhc_state jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH active AS (
    SELECT
      hc.id,
      wc.workshop_status_id AS status_id,
      hc.job_state,
      hc.status AS vhc_status,
      COALESCE(wc.workshop_status_changed_at, wc.created_at, hc.created_at) AS since
    FROM health_checks hc
    LEFT JOIN workshop_cards wc
      ON wc.health_check_id = hc.id AND wc.organization_id = p_org_id
    WHERE hc.organization_id = p_org_id
      AND hc.site_id = p_site_id
      AND hc.job_state <> 'collected'
      AND hc.status NOT IN ('completed', 'cancelled', 'no_show')
      AND (p_advisor_id IS NULL OR hc.advisor_id = p_advisor_id)
  ),
  vhc AS (
    SELECT status_id, jsonb_object_agg(vhc_status, c) AS vhc_state
    FROM (
      SELECT status_id, vhc_status, COUNT(*) AS c
      FROM active GROUP BY status_id, vhc_status
    ) t
    GROUP BY status_id
  )
  SELECT
    a.status_id,
    COALESCE(ws.name, 'No job status') AS name,
    ws.colour,
    ws.icon,
    COALESCE(ws.sort_order, 2147483647) AS sort_order,
    COALESCE(ws.is_active, true) AS is_active,
    COUNT(*) AS count,
    MAX(CURRENT_DATE - a.since::date)::int AS oldest_days,
    jsonb_build_object(
      'due_in',        COUNT(*) FILTER (WHERE a.job_state = 'due_in'),
      'arrived',       COUNT(*) FILTER (WHERE a.job_state = 'arrived'),
      'in_workshop',   COUNT(*) FILTER (WHERE a.job_state = 'in_workshop'),
      'work_complete', COUNT(*) FILTER (WHERE a.job_state = 'work_complete')
    ) AS vehicle_status,
    vhc.vhc_state
  FROM active a
  LEFT JOIN workshop_statuses ws ON ws.id = a.status_id
  LEFT JOIN vhc ON vhc.status_id IS NOT DISTINCT FROM a.status_id
  GROUP BY a.status_id, ws.name, ws.colour, ws.icon, ws.sort_order, ws.is_active, vhc.vhc_state;
$$;

REVOKE ALL ON FUNCTION workshop_status_tiles(uuid, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION workshop_status_tiles(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Tile drill-in: the active jobs behind one tile (a Job Status, or the NULL
-- "No job status" bucket when p_no_status = true). Oldest-in-status first, capped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workshop_status_tile_jobs(
  p_org_id uuid,
  p_site_id uuid,
  p_status_id uuid DEFAULT NULL,
  p_no_status boolean DEFAULT false,
  p_advisor_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  health_check_id uuid,
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
