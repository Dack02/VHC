-- =============================================================================
-- Parts module P2 — supplier_returns + supplier_return_lines (the credit loop) (GMS/PARTS.md §5.9, §7.5)
-- =============================================================================
-- First-class "parts to return" + credit reconciliation (the #1 UK leak). Returns
-- are for UNUSED/UNSOLD parts (line_status reached to_return/declined before invoiced).
-- Stocked-unused writes a return_out movement (SOH↓) + Event 5 journal; non-stock-unused
-- reverses the parked WIP cost. Additive only.
-- =============================================================================

ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS next_rma_number INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS supplier_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  rma_ref TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'to_return'
    CHECK (status IN ('to_return', 'shipped', 'credited', 'rejected')),
  credit_note_ref TEXT,
  credit_amount DECIMAL(12,2),
  reconciled_po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  notes TEXT,
  returned_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_return_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_return_id UUID NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  repair_part_id UUID REFERENCES repair_parts(id) ON DELETE SET NULL,
  stock_item_id UUID REFERENCES parts_catalog(id) ON DELETE SET NULL,
  purchase_order_line_id UUID REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
  part_number TEXT,
  description TEXT,
  qty DECIMAL(12,3) NOT NULL DEFAULT 1,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  reason VARCHAR(16) NOT NULL DEFAULT 'unused'
    CHECK (reason IN ('unused', 'declined', 'core', 'warranty', 'damaged')),
  is_stocked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_returns_org      ON supplier_returns(organization_id);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_supplier ON supplier_returns(organization_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_status   ON supplier_returns(organization_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rma_number_per_org
  ON supplier_returns(organization_id, rma_ref) WHERE rma_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_return_lines_ret ON supplier_return_lines(supplier_return_id);
CREATE INDEX IF NOT EXISTS idx_supplier_return_lines_org ON supplier_return_lines(organization_id);

ALTER TABLE supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_return_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members manage supplier returns" ON supplier_returns;
CREATE POLICY "Org members manage supplier returns" ON supplier_returns
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Org members manage supplier return lines" ON supplier_return_lines;
CREATE POLICY "Org members manage supplier return lines" ON supplier_return_lines
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Per-org RMA-number generator (atomic; mirrors next_purchase_order_number).
CREATE OR REPLACE FUNCTION next_supplier_return_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE organization_settings
  SET next_rma_number = COALESCE(next_rma_number, 1) + 1, updated_at = NOW()
  WHERE organization_id = p_org_id
  RETURNING next_rma_number - 1 INTO v_next;

  IF v_next IS NULL THEN
    INSERT INTO organization_settings (organization_id, next_rma_number, created_at, updated_at)
    VALUES (p_org_id, 2, NOW(), NOW())
    ON CONFLICT (organization_id) DO UPDATE
    SET next_rma_number = COALESCE(organization_settings.next_rma_number, 1) + 1, updated_at = NOW()
    RETURNING next_rma_number - 1 INTO v_next;
  END IF;

  RETURN 'RMA' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Refine Parts-to-Return (from 130600) to drop parts already on an open/credited return
-- (only a rejected return puts them back on the report). supplier_return_lines now exists.
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
    AND NOT EXISTS (
      SELECT 1 FROM supplier_return_lines srl
      JOIN supplier_returns sr ON sr.id = srl.supplier_return_id
      WHERE srl.repair_part_id = rp.id AND sr.status <> 'rejected'
    )
  ORDER BY supplier_name, rp.part_number
  LIMIT 2000;
$$;
