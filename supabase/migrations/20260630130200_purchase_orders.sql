-- =============================================================================
-- Parts module P1 — purchase_orders + purchase_order_lines (order-in) (GMS/PARTS.md §5.7)
-- =============================================================================
-- The order-in spine. A PO groups lines ordered from one supplier; lines link to a
-- stock item (NULL = ad-hoc) and/or the job line that needs them (repair_part_id).
-- `reconciled` drives the Orphan-Parts report (P2). No GL journal here — receipt
-- writes a quantity-only movement; the asset is booked at the supplier invoice (P2).
-- Additive only.
-- =============================================================================

-- Per-org PO-number counter (mirrors next_jobsheet_invoice_number).
ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS next_po_number INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  location_id UUID REFERENCES stock_locations(id) ON DELETE SET NULL,

  po_number TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ordered', 'part_received', 'received', 'invoiced', 'closed', 'cancelled')),
  supplier_invoice_ref TEXT,
  notes TEXT,

  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  stock_item_id UUID REFERENCES parts_catalog(id) ON DELETE SET NULL,
  repair_part_id UUID REFERENCES repair_parts(id) ON DELETE SET NULL,

  part_number TEXT,
  description TEXT NOT NULL,
  qty_ordered DECIMAL(12,3) NOT NULL DEFAULT 1,
  qty_received DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,

  line_status VARCHAR(24) NOT NULL DEFAULT 'ordered'
    CHECK (line_status IN ('requested', 'ordered', 'back_order', 'received',
      'fitted', 'invoiced', 'declined', 'to_return', 'returned', 'credited',
      'return_rejected', 'cancelled')),
  is_stocked_at_receipt BOOLEAN NOT NULL DEFAULT false,  -- snapshots the stock/non-stock fork
  reconciled BOOLEAN NOT NULL DEFAULT false,             -- consumed onto a job or returned (Orphan-Parts, §8)

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_org       ON purchase_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier  ON purchase_orders(organization_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status    ON purchase_orders(organization_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_purchase_order_number_per_org
  ON purchase_orders(organization_id, po_number) WHERE po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_lines_po               ON purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_org              ON purchase_order_lines(organization_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_repair_part      ON purchase_order_lines(repair_part_id) WHERE repair_part_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_lines_item             ON purchase_order_lines(stock_item_id) WHERE stock_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_lines_unreconciled     ON purchase_order_lines(organization_id) WHERE reconciled = false;

-- RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members manage purchase orders" ON purchase_orders;
CREATE POLICY "Org members manage purchase orders" ON purchase_orders
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Org members manage purchase order lines" ON purchase_order_lines;
CREATE POLICY "Org members manage purchase order lines" ON purchase_order_lines
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Per-org PO-number generator (atomic; mirrors next_jobsheet_invoice_number).
CREATE OR REPLACE FUNCTION next_purchase_order_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE organization_settings
  SET next_po_number = COALESCE(next_po_number, 1) + 1, updated_at = NOW()
  WHERE organization_id = p_org_id
  RETURNING next_po_number - 1 INTO v_next;

  IF v_next IS NULL THEN
    INSERT INTO organization_settings (organization_id, next_po_number, created_at, updated_at)
    VALUES (p_org_id, 2, NOW(), NOW())
    ON CONFLICT (organization_id) DO UPDATE
    SET next_po_number = COALESCE(organization_settings.next_po_number, 1) + 1, updated_at = NOW()
    RETURNING next_po_number - 1 INTO v_next;
  END IF;

  RETURN 'PO' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;
