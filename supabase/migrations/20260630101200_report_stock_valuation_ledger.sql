-- =============================================================================
-- Parts module P0 — Stock Valuation: value from the LEDGER, not qty × avg
-- (GMS/PARTS.md §5.4, §8 lines 334-337/369/418/919-920)
-- =============================================================================
-- The canonical inventory-asset value is SUM(stock_movements.total_cost) — the
-- same 2dp figure that drives the journal lines — NOT qty_on_hand × average_cost,
-- which would foot differently against the GL (average_cost keeps 4dp and is never
-- summed into ledger money). This CREATE OR REPLACE corrects the earlier 101100
-- definition to the ledger sum so the report cross-foots to the journal to the penny.
-- Items with no movements still appear (count + SOH qty, value 0). Additive only.
-- =============================================================================

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
  WITH item_value AS (
    SELECT
      pc.id,
      pc.category_id,
      COALESCE(pc.qty_on_hand, 0) AS qty_on_hand,
      COALESCE(mv.val, 0)         AS item_value
    FROM parts_catalog pc
    LEFT JOIN (
      SELECT stock_item_id, SUM(total_cost) AS val
      FROM stock_movements
      WHERE organization_id = p_org_id
      GROUP BY stock_item_id
    ) mv ON mv.stock_item_id = pc.id
    WHERE pc.organization_id = p_org_id
      AND pc.is_stocked = true
      AND COALESCE(pc.is_active, true) = true
  )
  SELECT
    iv.category_id,
    COALESCE(cat.name, 'Uncategorised')::text AS category_name,
    count(*)::bigint                          AS item_count,
    COALESCE(sum(iv.qty_on_hand), 0)          AS total_qty,
    COALESCE(sum(iv.item_value), 0)           AS total_value
  FROM item_value iv
  LEFT JOIN part_categories cat ON cat.id = iv.category_id
  GROUP BY iv.category_id, cat.name
  ORDER BY total_value DESC;
$$;

REVOKE ALL ON FUNCTION report_stock_valuation(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_stock_valuation(uuid) TO service_role;
