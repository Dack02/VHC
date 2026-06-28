-- =============================================================================
-- Parts module P0 — stock_movements ledger + apply_stock_movement() (GMS/PARTS.md §5.4)
-- =============================================================================
-- The append-only spine: qty_on_hand + valuation are DERIVED from this table;
-- nothing else may move stock. An AFTER INSERT trigger maintains
-- parts_catalog.qty_on_hand and re-rolls average_cost (provisional WAVCO) inside
-- the same transaction. The UI must NEVER write qty_on_hand directly.
-- Additive only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  location_id UUID REFERENCES stock_locations(id) ON DELETE SET NULL,

  movement_type VARCHAR(20) NOT NULL
    CHECK (movement_type IN ('receipt', 'issue', 'adjustment', 'return_in', 'return_out', 'transfer')),
  qty_delta DECIMAL(12,3) NOT NULL,          -- signed
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  total_cost DECIMAL(12,2) NOT NULL DEFAULT 0, -- ROUND(qty_delta × unit_cost, 2)

  reference_type VARCHAR(24),                -- goods_receipt | repair_part | stocktake | supplier_return | transfer
  reference_id UUID,
  repair_part_id UUID REFERENCES repair_parts(id) ON DELETE SET NULL,
  reason_code VARCHAR(40),                   -- mandatory for adjustment
  is_negative_flagged BOOLEAN NOT NULL DEFAULT false,  -- issue that drove SOH < 0 (valuation needs PPV true-up, §5.4)

  document_date DATE NOT NULL DEFAULT CURRENT_DATE,
  movement_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),

  CONSTRAINT stock_movement_adjustment_needs_reason
    CHECK (movement_type <> 'adjustment' OR reason_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_org      ON stock_movements(organization_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item     ON stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref      ON stock_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_part     ON stock_movements(repair_part_id) WHERE repair_part_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_date     ON stock_movements(organization_id, document_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_flagged  ON stock_movements(organization_id) WHERE is_negative_flagged = true;

-- RLS
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view stock movements" ON stock_movements;
CREATE POLICY "Org members can view stock movements" ON stock_movements
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Org members can write stock movements" ON stock_movements;
CREATE POLICY "Org members can write stock movements" ON stock_movements
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

-- The load-bearing invariant: maintain qty_on_hand + provisional WAVCO atomically.
CREATE OR REPLACE FUNCTION apply_stock_movement()
RETURNS TRIGGER AS $$
DECLARE
  v_qoh   numeric;
  v_avg   numeric;
  v_base  numeric;
  v_newavg numeric;
BEGIN
  SELECT COALESCE(qty_on_hand, 0), COALESCE(average_cost, 0)
    INTO v_qoh, v_avg
    FROM parts_catalog
    WHERE id = NEW.stock_item_id
    FOR UPDATE;

  v_newavg := v_avg;

  -- Re-roll WAVCO on inbound movements using a non-negative base (negative SOH
  -- has no meaningful average; the catch-up receipt is valued at receipt cost).
  IF NEW.movement_type IN ('receipt', 'return_in') AND NEW.qty_delta > 0 THEN
    v_base := GREATEST(v_qoh, 0);
    IF (v_base + NEW.qty_delta) > 0 THEN
      v_newavg := ROUND(((v_base * v_avg) + (NEW.qty_delta * NEW.unit_cost)) / (v_base + NEW.qty_delta), 4);
    ELSE
      v_newavg := NEW.unit_cost;
    END IF;
  END IF;

  UPDATE parts_catalog
    SET qty_on_hand = COALESCE(qty_on_hand, 0) + NEW.qty_delta,
        average_cost = v_newavg,
        updated_at = NOW()
    WHERE id = NEW.stock_item_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON stock_movements;
CREATE TRIGGER trg_apply_stock_movement
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();
