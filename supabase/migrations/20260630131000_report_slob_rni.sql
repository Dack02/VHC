-- =============================================================================
-- Parts module P3 — Slow-moving/Obsolete (SLOB) + Received-Not-Invoiced (RNI) reports (GMS/PARTS.md §8)
-- =============================================================================
-- SLOB: stocked items with on-hand value but no movement in N days — capital tied up
-- in dead stock. RNI: stocked parts physically received (GRN booked) with no supplier
-- invoice entered yet — the received-qty exposure awaiting Event 2 (period-end control,
-- since the asset isn't booked until the supplier invoice). Both aggregated in SQL
-- (1000-row-cap safe); SLOB value foots to the valuation ledger (Σ total_cost). Additive only.
-- =============================================================================

-- Slow-moving / Obsolete: on-hand stocked items whose last movement is older than
-- p_days (or which have never moved). Value = the item's ledger contribution
-- (Σ stock_movements.total_cost) so it foots to report_stock_valuation; falls back to
-- qty_on_hand × average_cost when an item somehow has on-hand but no movement rows.
CREATE OR REPLACE FUNCTION report_slob(p_org_id uuid, p_days integer DEFAULT 90)
RETURNS TABLE (
  stock_item_id uuid,
  part_number text,
  description text,
  category_name text,
  qty_on_hand numeric,
  average_cost numeric,
  stock_value numeric,
  last_movement_at timestamptz,
  days_idle integer
)
LANGUAGE sql
STABLE
AS $$
  WITH last_mv AS (
    SELECT sm.stock_item_id,
           MAX(sm.movement_at) AS last_at,
           SUM(sm.total_cost)  AS ledger_value
    FROM stock_movements sm
    WHERE sm.organization_id = p_org_id
    GROUP BY sm.stock_item_id
  )
  SELECT
    pc.id,
    pc.part_number::text,
    pc.description::text,
    COALESCE(cat.name, 'Uncategorised')::text AS category_name,
    pc.qty_on_hand,
    pc.average_cost,
    ROUND(COALESCE(lm.ledger_value, pc.qty_on_hand * pc.average_cost), 2) AS stock_value,
    lm.last_at AS last_movement_at,
    (CURRENT_DATE - COALESCE(lm.last_at::date, pc.created_at::date))::int AS days_idle
  FROM parts_catalog pc
  LEFT JOIN last_mv lm ON lm.stock_item_id = pc.id
  LEFT JOIN part_categories cat ON cat.id = pc.category_id
  WHERE pc.organization_id = p_org_id
    AND pc.is_stocked = true
    AND pc.qty_on_hand > 0
    AND (lm.last_at IS NULL OR lm.last_at < (NOW() - make_interval(days => GREATEST(p_days, 0))))
  ORDER BY stock_value DESC
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION report_slob(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_slob(uuid, integer) TO service_role;

-- Received-Not-Invoiced: stocked PO lines physically received (qty_received > 0) whose
-- parent PO has no supplier invoice entered yet (status not invoiced/closed/cancelled).
-- The asset isn't booked until Event 2, so this lists the received-qty exposure to chase
-- factor invoices / accrue at period-end.
CREATE OR REPLACE FUNCTION report_received_not_invoiced(p_org_id uuid)
RETURNS TABLE (
  line_id uuid,
  po_id uuid,
  po_number text,
  supplier_id uuid,
  supplier_name text,
  part_number text,
  description text,
  qty_received numeric,
  unit_cost numeric,
  uninvoiced_value numeric,
  received_at timestamptz,
  days_waiting integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    pol.id,
    po.id,
    po.po_number::text,
    po.supplier_id,
    COALESCE(s.name, 'Unknown supplier')::text AS supplier_name,
    pol.part_number::text,
    pol.description::text,
    pol.qty_received,
    pol.unit_cost,
    ROUND(pol.qty_received * pol.unit_cost, 2) AS uninvoiced_value,
    po.received_at,
    (CURRENT_DATE - COALESCE(po.received_at::date, po.created_at::date))::int AS days_waiting
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id = pol.purchase_order_id
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  WHERE pol.organization_id = p_org_id
    AND pol.is_stocked_at_receipt = true
    AND pol.qty_received > 0
    AND po.status NOT IN ('invoiced', 'closed', 'cancelled')
  ORDER BY days_waiting DESC, po.po_number
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION report_received_not_invoiced(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_received_not_invoiced(uuid) TO service_role;
