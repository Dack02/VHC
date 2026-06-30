-- TECH_JOB_MODEL.md P3 / §7 — re-anchor the SOLD side of technician efficiency to the
-- jobsheet so VHC-less jobs (estimate conversions, "Requires VHC" unticked) are counted.
--
-- Strategy that preserves every existing number AND is robust to the deferred shell
-- backfill: the original VHC-anchored sold computation (health_checks JOIN workshop_cards)
-- is kept VERBATIM (sold_hc) — it already covers every VHC, standalone or jobsheet-backed,
-- backfilled or not — and a NEW jobsheet-anchored source (sold_js) is ADDED only for
-- jobsheets that have NO child VHC. The two sources are disjoint, so nothing double-counts
-- and no existing tech's sold hours shift. Clocked + capacity CTEs are unchanged; the
-- signature and 5 output columns are identical, so reports.ts needs no change.
--
-- Idempotent CREATE OR REPLACE. Fully additive. service_role only.

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
  -- Actual productive time: closed, job-counting segments, attributed by the tech who
  -- held the segment. Already cross-tech and jobsheet-agnostic — VHC-less productive
  -- time surfaces automatically once techs clock onto jobsheets (jobsheet_id ledger col).
  WITH clocked AS (
    SELECT te.technician_id,
           SUM(COALESCE(te.duration_minutes, 0))::numeric / 60.0 AS clocked_hours,
           COUNT(DISTINCT te.clock_in_at::date)                   AS days_clocked
    FROM technician_time_entries te
    LEFT JOIN time_entry_categories tec ON tec.id = te.category_id
    WHERE te.organization_id = p_org_id
      -- Null-category segments are productive (matches computeTimeBreakdown), so they must
      -- count here too — otherwise an org with no seeded categories reports 0 clocked hours.
      AND (te.category_id IS NULL OR tec.counts_toward_job = true)
      AND te.clock_out_at IS NOT NULL
      AND (p_site_id IS NULL OR te.site_id = p_site_id)
      AND (p_from IS NULL OR te.clock_in_at >= p_from)
      AND (p_to   IS NULL OR te.clock_in_at <= p_to)
      AND (p_technician_id IS NULL OR te.technician_id = p_technician_id)
    GROUP BY te.technician_id
  ),
  -- Sold (VHC path) — UNCHANGED. Every VHC's estimated card hours, attributed to the
  -- VHC's technician. Covers standalone (incl. shell-wrapped) and jobsheet-backed VHCs.
  sold_hc AS (
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
  -- Sold (VHC-less jobsheet path) — NEW. Jobsheets with no child VHC (estimate conversions,
  -- "Requires VHC" unticked) compute sold hours from the jobsheet estimate, else the quoted
  -- labour hours, attributed to the jobsheet's primary tech. Restricted to VHC-less jobsheets
  -- so it never overlaps sold_hc. Shells always have a child VHC, so they fall to sold_hc.
  sold_js AS (
    SELECT j.assigned_technician_id AS technician_id,
           SUM(COALESCE(
             j.estimated_hours,
             (SELECT SUM(rl.hours)
                FROM repair_items ri
                JOIN repair_labour rl ON rl.repair_item_id = ri.id
               WHERE ri.jobsheet_id = j.id AND ri.deleted_at IS NULL),
             0))::numeric AS sold_hours
    FROM jobsheets j
    WHERE j.organization_id = p_org_id
      AND j.deleted_at IS NULL
      AND j.is_shell = false
      AND j.assigned_technician_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM health_checks h
        WHERE h.jobsheet_id = j.id AND h.deleted_at IS NULL
      )
      AND (j.jobsheet_complete = true OR j.job_state IN ('work_complete', 'collected'))
      AND (p_site_id IS NULL OR j.site_id = p_site_id)
      AND (p_technician_id IS NULL OR j.assigned_technician_id = p_technician_id)
      -- Prefer the invoice (close) date as the completion anchor; updated_at is re-stamped by
      -- post-completion edits so it would mis-window the job. (Uninvoiced-but-complete jobs
      -- still fall back to updated_at until a dedicated jobsheets.completed_at exists.)
      AND (p_from IS NULL OR COALESCE(j.closed_at, j.updated_at, j.created_at) >= p_from)
      AND (p_to   IS NULL OR COALESCE(j.closed_at, j.updated_at, j.created_at) <= p_to)
    GROUP BY j.assigned_technician_id
  ),
  sold AS (
    SELECT technician_id, SUM(sold_hours)::numeric AS sold_hours
    FROM (
      SELECT technician_id, sold_hours FROM sold_hc
      UNION ALL
      SELECT technician_id, sold_hours FROM sold_js
    ) u
    GROUP BY technician_id
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
