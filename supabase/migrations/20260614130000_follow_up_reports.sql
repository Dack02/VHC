-- =============================================================================
-- Follow-Up reporting RPCs — server-side aggregation (respects the PostgREST
-- ~1000-row cap). Locked to service_role only (called server-side with explicit
-- org filtering); NOT exposed to authenticated/anon to prevent cross-tenant reads.
-- =============================================================================

-- Future pipeline: all still-deferred repair items, bucketed by due month.
CREATE OR REPLACE FUNCTION follow_up_pipeline(p_org uuid, p_site uuid DEFAULT NULL)
RETURNS TABLE(bucket text, item_count bigint, total_value numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE WHEN COALESCE(ri.deferred_until, ri.follow_up_date) IS NULL
         THEN 'undated'
         ELSE to_char(COALESCE(ri.deferred_until, ri.follow_up_date), 'YYYY-MM') END AS bucket,
    count(*)::bigint AS item_count,
    COALESCE(sum(COALESCE(ri.price_override, ri.total_inc_vat, 0)), 0) AS total_value
  FROM repair_items ri
  JOIN health_checks hc ON hc.id = ri.health_check_id
  WHERE hc.organization_id = p_org
    AND ri.outcome_status = 'deferred'
    AND ri.deleted_at IS NULL
    AND ri.parent_repair_item_id IS NULL
    AND (p_site IS NULL OR hc.site_id = p_site)
  GROUP BY 1
  ORDER BY 1;
$$;

-- Recovery / conversion: follow-up cases closed in a period, grouped by outcome.
CREATE OR REPLACE FUNCTION follow_up_conversion(p_org uuid, p_from timestamptz, p_to timestamptz, p_site uuid DEFAULT NULL)
RETURNS TABLE(outcome_id uuid, outcome_name text, is_won boolean, case_count bigint, total_value numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    c.outcome_id,
    COALESCE(o.name, 'Auto-resolved') AS outcome_name,
    COALESCE(o.is_won, false) AS is_won,
    count(*)::bigint AS case_count,
    COALESCE(sum(c.deferred_value_snapshot), 0) AS total_value
  FROM follow_up_cases c
  LEFT JOIN follow_up_outcomes o ON o.id = c.outcome_id
  WHERE c.organization_id = p_org
    AND c.status = 'closed'
    AND c.closed_at >= p_from
    AND c.closed_at <= p_to
    AND (p_site IS NULL OR c.site_id = p_site)
  GROUP BY c.outcome_id, o.name, o.is_won
  ORDER BY case_count DESC;
$$;

-- Lock down: server-side (service_role) only.
REVOKE ALL ON FUNCTION follow_up_pipeline(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION follow_up_conversion(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION follow_up_pipeline(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION follow_up_conversion(uuid, timestamptz, timestamptz, uuid) TO service_role;
