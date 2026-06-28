-- =============================================================================
-- Parts module P1 — goods_receipts + goods_receipt_lines (receiving / GRN) (GMS/PARTS.md §5.8, §7.1)
-- =============================================================================
-- Records what physically arrived against a PO. Receiving a STOCKED line writes a
-- `receipt` stock_movement (SOH↑, provisional WAVCO) — quantity only, NO GL journal
-- at receipt (the inventory asset is recognised at the supplier invoice, Event 2, P2).
-- A non-stock line writes no movement but still advances its line to `received`.
-- The receipt movement is written by the API (parts-stock issue/receive path), not a
-- trigger here. Additive only.
-- =============================================================================

ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS next_grn_number INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS goods_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  grn_number TEXT,
  notes TEXT,
  received_by UUID REFERENCES users(id),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goods_receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_line_id UUID REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
  stock_item_id UUID REFERENCES parts_catalog(id) ON DELETE SET NULL,

  qty_received DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,       -- editable on receipt if different from ordered
  condition VARCHAR(12) NOT NULL DEFAULT 'ok' CHECK (condition IN ('ok', 'damaged')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_org   ON goods_receipts(organization_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po    ON goods_receipts(purchase_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_grn_number_per_org
  ON goods_receipts(organization_id, grn_number) WHERE grn_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grn_lines_grn        ON goods_receipt_lines(goods_receipt_id);
CREATE INDEX IF NOT EXISTS idx_grn_lines_po_line    ON goods_receipt_lines(purchase_order_line_id);
CREATE INDEX IF NOT EXISTS idx_grn_lines_org        ON goods_receipt_lines(organization_id);

ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members manage goods receipts" ON goods_receipts;
CREATE POLICY "Org members manage goods receipts" ON goods_receipts
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Org members manage goods receipt lines" ON goods_receipt_lines;
CREATE POLICY "Org members manage goods receipt lines" ON goods_receipt_lines
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Per-org GRN-number generator (atomic; mirrors next_purchase_order_number).
CREATE OR REPLACE FUNCTION next_goods_receipt_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE organization_settings
  SET next_grn_number = COALESCE(next_grn_number, 1) + 1, updated_at = NOW()
  WHERE organization_id = p_org_id
  RETURNING next_grn_number - 1 INTO v_next;

  IF v_next IS NULL THEN
    INSERT INTO organization_settings (organization_id, next_grn_number, created_at, updated_at)
    VALUES (p_org_id, 2, NOW(), NOW())
    ON CONFLICT (organization_id) DO UPDATE
    SET next_grn_number = COALESCE(organization_settings.next_grn_number, 1) + 1, updated_at = NOW()
    RETURNING next_grn_number - 1 INTO v_next;
  END IF;

  RETURN 'GRN' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;
