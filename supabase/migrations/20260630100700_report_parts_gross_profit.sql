-- =============================================================================
-- Parts module — Parts Gross Profit / Margin-by-Repair-Type report (GMS/PARTS.md §8)
-- =============================================================================
-- Closes the deferred Repair Types margin piece (REPAIR_TYPES.md §4.4/§8).
-- Aggregates in-DB (PostgREST 1000-row-cap safe). Parts on authorised top-level
-- items in [p_from, p_to), with selected-option substitution, grouped by repair
-- type. margin = sell (line_total) − cost (cost_price × quantity).
-- =============================================================================

CREATE OR REPLACE FUNCTION report_parts_gross_profit(p_org_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  repair_type_id uuid,
  repair_type_name text,
  part_count bigint,
  total_sell numeric,
  total_cost numeric,
  total_margin numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH billable_items AS (
    SELECT ri.id, ri.repair_type_id, ri.selected_option_id
    FROM repair_items ri
    LEFT JOIN health_checks hc ON hc.id = ri.health_check_id
    LEFT JOIN jobsheets j ON j.id = COALESCE(ri.jobsheet_id, hc.jobsheet_id)
    WHERE ri.parent_repair_item_id IS NULL
      AND ri.deleted_at IS NULL
      AND COALESCE(ri.outcome_status, '') <> 'deleted'
      AND (ri.customer_approved IS TRUE OR ri.outcome_status = 'authorised')
      AND ri.created_at >= p_from
      AND ri.created_at < p_to
      AND (j.organization_id = p_org_id OR hc.organization_id = p_org_id)
  ),
  parts AS (
    SELECT bi.repair_type_id,
           COALESCE(rp.line_total, 0) AS sell,
           COALESCE(rp.cost_price, 0) * COALESCE(rp.quantity, 0) AS cost
    FROM billable_items bi
    JOIN repair_parts rp
      ON (bi.selected_option_id IS NULL AND rp.repair_item_id = bi.id)
      OR (bi.selected_option_id IS NOT NULL AND rp.repair_option_id = bi.selected_option_id)
  )
  SELECT
    p.repair_type_id,
    COALESCE(rt.name, 'Unassigned')::text AS repair_type_name,
    count(*)::bigint AS part_count,
    COALESCE(sum(p.sell), 0) AS total_sell,
    COALESCE(sum(p.cost), 0) AS total_cost,
    COALESCE(sum(p.sell - p.cost), 0) AS total_margin
  FROM parts p
  LEFT JOIN repair_types rt ON rt.id = p.repair_type_id
  GROUP BY p.repair_type_id, rt.name
  ORDER BY total_margin DESC;
$$;

REVOKE ALL ON FUNCTION report_parts_gross_profit(uuid, timestamptz, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_parts_gross_profit(uuid, timestamptz, timestamptz) TO service_role;
