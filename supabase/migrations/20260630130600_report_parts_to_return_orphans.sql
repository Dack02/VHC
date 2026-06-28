-- =============================================================================
-- Parts module P2 — Parts-to-Return + Orphan-Parts report RPCs (GMS/PARTS.md §8)
-- =============================================================================
-- The two money-leak reports from Leo's original brief: parts ordered-in but
-- unused/declined ("items to return"), and parts ordered/received but never put on
-- a job card ("orphans"). Aggregated in SQL (1000-row-cap safe). Additive only.
-- =============================================================================

-- Parts-to-Return — ordered-in, unused or declined, NOT an official stock item.
-- repair_parts has no organization_id, so scope via its owning item (direct FK or via
-- the selected option) → jobsheet/health_check org. Includes declined lines (§5.6).
CREATE OR REPLACE FUNCTION report_parts_to_return(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  part_number text,
  description text,
  supplier_id uuid,
  supplier_name text,
  quantity numeric,
  qty_to_return numeric,
  unit_cost numeric,
  return_value numeric,
  line_status text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    rp.id,
    rp.part_number::text,
    rp.description::text,
    rp.supplier_id,
    COALESCE(rp.supplier_name, s.name, 'Unknown supplier')::text AS supplier_name,
    rp.quantity,
    COALESCE(rp.qty_to_return, rp.quantity) AS qty_to_return,
    rp.cost_price AS unit_cost,
    ROUND(COALESCE(rp.qty_to_return, rp.quantity) * COALESCE(rp.cost_price, 0), 2) AS return_value,
    rp.line_status::text
  FROM repair_parts rp
  JOIN repair_items ri ON ri.id = COALESCE(
    rp.repair_item_id,
    (SELECT ro.repair_item_id FROM repair_options ro WHERE ro.id = rp.repair_option_id)
  )
  LEFT JOIN health_checks hc ON hc.id = ri.health_check_id
  LEFT JOIN jobsheets j ON j.id = COALESCE(ri.jobsheet_id, hc.jobsheet_id)
  LEFT JOIN suppliers s ON s.id = rp.supplier_id
  LEFT JOIN parts_catalog pc ON pc.id = rp.stock_item_id
  WHERE rp.line_status IN ('to_return', 'declined')
    AND (rp.stock_item_id IS NULL OR COALESCE(pc.is_stocked, false) = false)
    AND (j.organization_id = p_org_id OR hc.organization_id = p_org_id)
  ORDER BY supplier_name, rp.part_number
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION report_parts_to_return(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_parts_to_return(uuid) TO service_role;

-- Orphan-Parts — PO/GRN lines NOT on any job card (repair_part_id IS NULL), PLUS
-- received non-stock PO lines never fitted or returned (reconciled=false). The literal
-- money-leak: paid for, never billed to a customer, never sent back.
CREATE OR REPLACE FUNCTION report_orphan_parts(p_org_id uuid)
RETURNS TABLE (
  line_id uuid,
  po_id uuid,
  po_number text,
  supplier_name text,
  part_number text,
  description text,
  qty_ordered numeric,
  qty_received numeric,
  unit_cost numeric,
  line_value numeric,
  line_status text,
  reason text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    pol.id,
    po.id,
    po.po_number::text,
    COALESCE(s.name, 'Unknown supplier')::text AS supplier_name,
    pol.part_number::text,
    pol.description::text,
    pol.qty_ordered,
    pol.qty_received,
    pol.unit_cost,
    ROUND(pol.qty_ordered * pol.unit_cost, 2) AS line_value,
    pol.line_status::text,
    CASE WHEN pol.repair_part_id IS NULL THEN 'Not on a job card'
         ELSE 'Received, not fitted or returned' END AS reason
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id = pol.purchase_order_id
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  WHERE pol.organization_id = p_org_id
    AND pol.line_status <> 'cancelled'
    AND po.status <> 'cancelled'
    AND (
      pol.repair_part_id IS NULL
      OR (pol.is_stocked_at_receipt = false AND pol.reconciled = false AND pol.qty_received > 0)
    )
  ORDER BY po.po_number, pol.part_number
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION report_orphan_parts(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_orphan_parts(uuid) TO service_role;
