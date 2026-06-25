-- =============================================================================
-- Technician labour efficiency / utilisation — report aggregate.
--
-- Adds report_technician_efficiency: per-technician sold (estimated) hours vs
-- actual clocked productive hours over a date range, plus days clocked and the
-- tech's daily available hours, so the Technician Performance report can show
-- efficiency % (sold ÷ clocked) and utilisation % (clocked ÷ capacity).
--
-- Aggregated in the DB so it never hits the PostgREST ~1000-row cap over a
-- multi-week range. Locked to the service role (the API passes a server-trusted
-- org id). SECURITY INVOKER + CREATE OR REPLACE = idempotent. Fully additive.
-- =============================================================================

CREATE OR REPLACE FUNCTION report_technician_efficiency(
  p_org_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_technician_id uuid DEFAULT NULL
)
RETURNS TABLE (
  technician_id uuid,
  sold_hours numeric,
  clocked_hours numeric,
  days_clocked int,
  available_hours_per_day numeric
)
LANGUAGE sql
STABLE
AS $$
  -- Actual productive time: closed segments in categories that count toward the
  -- job, attributed by the technician who held the segment (cross-tech accurate).
  WITH clocked AS (
    SELECT te.technician_id,
           SUM(COALESCE(te.duration_minutes, 0))::numeric / 60.0 AS clocked_hours,
           COUNT(DISTINCT te.clock_in_at::date)                   AS days_clocked
    FROM technician_time_entries te
    JOIN time_entry_categories tec ON tec.id = te.category_id
    WHERE te.organization_id = p_org_id
      AND tec.counts_toward_job = true
      AND te.clock_out_at IS NOT NULL
      AND (p_site_id IS NULL OR te.site_id = p_site_id)
      AND (p_from IS NULL OR te.clock_in_at >= p_from)
      AND (p_to   IS NULL OR te.clock_in_at <= p_to)
      AND (p_technician_id IS NULL OR te.technician_id = p_technician_id)
    GROUP BY te.technician_id
  ),
  -- Sold time: estimated hours on the tech's COMPLETED jobs in the window
  -- (cards with no estimate contribute 0). Completion date falls back through
  -- the best available timestamp.
  sold AS (
    SELECT hc.technician_id,
           SUM(COALESCE(wc.estimated_hours, 0))::numeric AS sold_hours
    FROM health_checks hc
    JOIN workshop_cards wc ON wc.health_check_id = hc.id
    WHERE hc.organization_id = p_org_id
      AND hc.technician_id IS NOT NULL
      AND hc.deleted_at IS NULL
      AND (hc.status = 'completed' OR hc.job_state IN ('work_complete', 'collected'))
      AND (p_site_id IS NULL OR hc.site_id = p_site_id)
      AND (p_technician_id IS NULL OR hc.technician_id = p_technician_id)
      AND (p_from IS NULL OR COALESCE(hc.tech_completed_at, hc.completed_at, hc.due_date, hc.created_at) >= p_from)
      AND (p_to   IS NULL OR COALESCE(hc.tech_completed_at, hc.completed_at, hc.due_date, hc.created_at) <= p_to)
    GROUP BY hc.technician_id
  ),
  -- Daily capacity: the tech's workshop column available_hours (default 8).
  cap AS (
    SELECT wcol.technician_id, MAX(wcol.available_hours)::numeric AS available_hours_per_day
    FROM workshop_columns wcol
    WHERE wcol.organization_id = p_org_id
      AND wcol.column_type = 'technician'
      AND wcol.technician_id IS NOT NULL
      AND (p_site_id IS NULL OR wcol.site_id = p_site_id)
    GROUP BY wcol.technician_id
  )
  SELECT
    COALESCE(c.technician_id, s.technician_id)        AS technician_id,
    COALESCE(s.sold_hours, 0)                         AS sold_hours,
    COALESCE(c.clocked_hours, 0)                      AS clocked_hours,
    COALESCE(c.days_clocked, 0)                       AS days_clocked,
    COALESCE(cap.available_hours_per_day, 8)          AS available_hours_per_day
  FROM clocked c
  FULL OUTER JOIN sold s ON s.technician_id = c.technician_id
  LEFT JOIN cap ON cap.technician_id = COALESCE(c.technician_id, s.technician_id)
  WHERE COALESCE(c.technician_id, s.technician_id) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION report_technician_efficiency(uuid, uuid, timestamptz, timestamptz, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_technician_efficiency(uuid, uuid, timestamptz, timestamptz, uuid) TO service_role;
