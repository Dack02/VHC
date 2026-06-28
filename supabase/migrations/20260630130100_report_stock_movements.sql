-- =============================================================================
-- Parts module P0 — Stock Movement history report RPC (GMS/PARTS.md §8)
-- =============================================================================
-- The audit trail across all stock items for a date window: every receipt/issue/
-- adjustment with its item + category + signed qty + cost. Aggregated/filtered in
-- SQL (PostgREST 1000-row-cap safe — caller passes a bounded date range). Additive.
-- =============================================================================

CREATE OR REPLACE FUNCTION report_stock_movements(
  p_org_id uuid,
  p_from   date,
  p_to     date
)
RETURNS TABLE (
  id uuid,
  movement_at timestamptz,
  document_date date,
  movement_type text,
  part_number text,
  description text,
  category_name text,
  qty_delta numeric,
  unit_cost numeric,
  total_cost numeric,
  reference_type text,
  reason_code text,
  is_negative_flagged boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    sm.id,
    sm.movement_at,
    sm.document_date,
    sm.movement_type::text,
    pc.part_number::text,
    pc.description::text,
    COALESCE(cat.name, 'Uncategorised')::text AS category_name,
    sm.qty_delta,
    sm.unit_cost,
    sm.total_cost,
    sm.reference_type::text,
    sm.reason_code::text,
    sm.is_negative_flagged
  FROM stock_movements sm
  JOIN parts_catalog pc ON pc.id = sm.stock_item_id
  LEFT JOIN part_categories cat ON cat.id = pc.category_id
  WHERE sm.organization_id = p_org_id
    AND sm.document_date >= p_from
    AND sm.document_date <= p_to
  ORDER BY sm.movement_at DESC
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION report_stock_movements(uuid, date, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_stock_movements(uuid, date, date) TO service_role;
