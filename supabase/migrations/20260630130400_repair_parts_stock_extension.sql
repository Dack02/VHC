-- =============================================================================
-- Parts module P1 — repair_parts EXTENDED for stock/order-in + lifecycle (GMS/PARTS.md §5.3, §5.6)
-- =============================================================================
-- The priced job line stays the consumption point. These additive columns link it
-- to a stock item + PO line, give it the part-line state machine, and let a single
-- ordered line partially fit and partially return (qty_fitted / qty_to_return) without
-- a second row. cogs_snapshot/cogs_recognised_at are the immutable COGS lock (P2 fills
-- them at the jobsheet invoice). purchased_at/purchase_recognised_at already shipped in
-- P-Simple. Additive only.
-- =============================================================================

ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES parts_catalog(id) ON DELETE SET NULL;
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS purchase_order_line_id UUID REFERENCES purchase_order_lines(id) ON DELETE SET NULL;
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS qty_fitted DECIMAL(10,2);
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS qty_to_return DECIMAL(10,2);
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS line_status VARCHAR(24) NOT NULL DEFAULT 'requested';
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS stock_ownership VARCHAR(16) NOT NULL DEFAULT 'owned';
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS has_core BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS core_charge_amount DECIMAL(10,2);
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS core_status VARCHAR(24);
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS cogs_snapshot DECIMAL(12,4);
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS cogs_recognised_at TIMESTAMPTZ;

-- The part-line state machine (§5.6). Guarded so the app can only set known states.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'repair_parts_line_status_check'
  ) THEN
    ALTER TABLE repair_parts ADD CONSTRAINT repair_parts_line_status_check
      CHECK (line_status IN ('requested', 'ordered', 'back_order', 'received', 'fitted',
        'invoiced', 'declined', 'to_return', 'returned', 'credited',
        'return_rejected', 'cancelled'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'repair_parts_stock_ownership_check'
  ) THEN
    ALTER TABLE repair_parts ADD CONSTRAINT repair_parts_stock_ownership_check
      CHECK (stock_ownership IN ('owned', 'consignment'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_repair_parts_stock_item   ON repair_parts(stock_item_id) WHERE stock_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repair_parts_po_line       ON repair_parts(purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repair_parts_line_status   ON repair_parts(line_status);
CREATE INDEX IF NOT EXISTS idx_repair_parts_cogs_pending  ON repair_parts(cogs_recognised_at) WHERE cogs_recognised_at IS NULL;

COMMENT ON COLUMN repair_parts.qty_fitted IS
  'Quantity actually fitted/billed; defaults to quantity at the jobsheet invoice if unset. Extended COGS = qty_fitted × cogs_snapshot (GMS/PARTS.md §5.3).';
COMMENT ON COLUMN repair_parts.cogs_snapshot IS
  'Immutable UNIT cost locked at COGS recognition (multiply by qty_fitted; cleared + reversed on jobsheet reopen, §7.7).';
