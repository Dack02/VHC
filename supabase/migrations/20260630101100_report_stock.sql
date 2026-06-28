-- =============================================================================
-- Parts module P0 — Stock Valuation + Low-Stock report RPCs (GMS/PARTS.md §8)
-- =============================================================================
-- Aggregate in-DB (PostgREST 1000-row-cap safe). Valuation = qty_on_hand ×
-- average_cost per stocked item (the balance-sheet inventory asset).
-- =============================================================================

-- Stock Valuation — current inventory asset, grouped by category.
CREATE OR REPLACE FUNCTION report_stock_valuation(p_org_id uuid)
RETURNS TABLE (
  category_id uuid,
  category_name text,
  item_count bigint,
  total_qty numeric,
  total_value numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    pc.category_id,
    COALESCE(cat.name, 'Uncategorised')::text AS category_name,
    count(*)::bigint AS item_count,
    COALESCE(sum(pc.qty_on_hand), 0) AS total_qty,
    COALESCE(sum(ROUND(pc.qty_on_hand * pc.average_cost, 2)), 0) AS total_value
  FROM parts_catalog pc
  LEFT JOIN part_categories cat ON cat.id = pc.category_id
  WHERE pc.organization_id = p_org_id
    AND pc.is_stocked = true
    AND COALESCE(pc.is_active, true) = true
  GROUP BY pc.category_id, cat.name
  ORDER BY total_value DESC;
$$;

REVOKE ALL ON FUNCTION report_stock_valuation(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_stock_valuation(uuid) TO service_role;

-- Low-Stock — stocked items at/under their reorder point, with a suggested order qty.
CREATE OR REPLACE FUNCTION report_low_stock(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  part_number text,
  description text,
  category_name text,
  qty_on_hand numeric,
  min_qty numeric,
  max_qty numeric,
  suggested_order numeric,
  average_cost numeric,
  preferred_supplier_id uuid
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    pc.id,
    pc.part_number::text,
    pc.description::text,
    COALESCE(cat.name, 'Uncategorised')::text AS category_name,
    pc.qty_on_hand,
    pc.min_qty,
    pc.max_qty,
    GREATEST(COALESCE(pc.max_qty, pc.min_qty) - pc.qty_on_hand, 0) AS suggested_order,
    pc.average_cost,
    pc.preferred_supplier_id
  FROM parts_catalog pc
  LEFT JOIN part_categories cat ON cat.id = pc.category_id
  WHERE pc.organization_id = p_org_id
    AND pc.is_stocked = true
    AND COALESCE(pc.is_active, true) = true
    AND pc.min_qty IS NOT NULL
    AND pc.qty_on_hand <= pc.min_qty
  ORDER BY (pc.qty_on_hand - pc.min_qty) ASC;
$$;

REVOKE ALL ON FUNCTION report_low_stock(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_low_stock(uuid) TO service_role;
