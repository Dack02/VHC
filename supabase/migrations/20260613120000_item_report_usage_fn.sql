-- Item Performance report: server-side usage aggregation.
--
-- The per-item usage counts (inspected / red / amber / green) must be computed in
-- Postgres rather than by fetching raw check_results, because PostgREST caps
-- responses at ~1000 rows and an organisation can have tens of thousands of
-- check_results in a reporting period (≈70 per health check). Counting client-side
-- silently truncated the counts. This function returns one aggregated row per
-- inspection-item name for the given set of health checks.

CREATE OR REPLACE FUNCTION item_report_usage(p_hc_ids uuid[])
RETURNS TABLE (
  item_name text,
  red bigint,
  amber bigint,
  green bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ti.name::text AS item_name,
    count(*) FILTER (WHERE cr.rag_status = 'red')::bigint   AS red,
    count(*) FILTER (WHERE cr.rag_status = 'amber')::bigint AS amber,
    count(*) FILTER (WHERE cr.rag_status = 'green')::bigint AS green
  FROM check_results cr
  JOIN template_items ti ON ti.id = cr.template_item_id
  WHERE cr.health_check_id = ANY(p_hc_ids)
    AND cr.rag_status IN ('red', 'amber', 'green')
  GROUP BY ti.name;
$$;

-- Only the API (service role) calls this; keep it off the public/anon surface.
REVOKE ALL ON FUNCTION item_report_usage(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION item_report_usage(uuid[]) TO service_role;
