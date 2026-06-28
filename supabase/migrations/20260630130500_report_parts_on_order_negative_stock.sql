-- =============================================================================
-- Parts module P1 — Parts-on-Order + Negative-Stock report RPCs (GMS/PARTS.md §8)
-- =============================================================================
-- Aggregated/bounded in SQL (PostgREST 1000-row-cap safe). Additive only.
-- =============================================================================

-- Parts-on-Order — open PO lines (not fully received) on non-terminal POs, with the
-- outstanding qty, supplier, and how long they've been open. Drives chase-up.
CREATE OR REPLACE FUNCTION report_parts_on_order(p_org_id uuid)
RETURNS TABLE (
  po_id uuid,
  po_number text,
  supplier_id uuid,
  supplier_name text,
  ordered_at timestamptz,
  po_status text,
  line_id uuid,
  part_number text,
  description text,
  qty_ordered numeric,
  qty_received numeric,
  qty_outstanding numeric,
  unit_cost numeric,
  outstanding_value numeric,
  days_open integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    po.id,
    po.po_number::text,
    po.supplier_id,
    COALESCE(s.name, 'Unknown supplier')::text AS supplier_name,
    po.ordered_at,
    po.status::text,
    pol.id,
    pol.part_number::text,
    pol.description::text,
    pol.qty_ordered,
    pol.qty_received,
    GREATEST(pol.qty_ordered - pol.qty_received, 0) AS qty_outstanding,
    pol.unit_cost,
    ROUND(GREATEST(pol.qty_ordered - pol.qty_received, 0) * pol.unit_cost, 2) AS outstanding_value,
    CASE WHEN po.ordered_at IS NOT NULL
         THEN GREATEST(EXTRACT(DAY FROM (NOW() - po.ordered_at))::int, 0)
         ELSE NULL END AS days_open
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id = pol.purchase_order_id
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  WHERE pol.organization_id = p_org_id
    AND po.status IN ('draft', 'ordered', 'part_received')
    AND pol.line_status NOT IN ('cancelled', 'declined')
    AND pol.qty_received < pol.qty_ordered
  ORDER BY po.ordered_at NULLS LAST, po.po_number
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION report_parts_on_order(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_parts_on_order(uuid) TO service_role;

-- Negative-Stock Exceptions — stocked items whose SOH has gone below zero (issued into
-- negative). These need a valuation true-up at the catch-up receipt (§5.4) and reconciling.
CREATE OR REPLACE FUNCTION report_negative_stock(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  part_number text,
  description text,
  category_name text,
  qty_on_hand numeric,
  average_cost numeric,
  bin_location text,
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
    pc.average_cost,
    pc.bin_location::text,
    pc.preferred_supplier_id
  FROM parts_catalog pc
  LEFT JOIN part_categories cat ON cat.id = pc.category_id
  WHERE pc.organization_id = p_org_id
    AND pc.is_stocked = true
    AND pc.qty_on_hand < 0
  ORDER BY pc.qty_on_hand ASC
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION report_negative_stock(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_negative_stock(uuid) TO service_role;
