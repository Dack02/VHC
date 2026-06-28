-- =============================================================================
-- Parts module — repair_parts Simple-mode purchase tracking (GMS/PARTS.md §5.3)
-- =============================================================================
-- Simple mode expenses a part's cost to the P&L AT PURCHASE (an explicit
-- "Mark purchased" action), dated so it reconciles the supplier's monthly
-- statement. These columns drive that purchase journal + its idempotency guard.
-- (Full-mode stock/PO/COGS-snapshot columns land in P1.)
-- Additive only.
-- =============================================================================

ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS purchased_at DATE;
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS purchase_recognised_at TIMESTAMPTZ;
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS purchased_by UUID REFERENCES users(id);
ALTER TABLE repair_parts ADD COLUMN IF NOT EXISTS purchase_journal_id UUID REFERENCES inventory_journal(id) ON DELETE SET NULL;

COMMENT ON COLUMN repair_parts.purchased_at IS
  'Simple mode: factor-invoice/purchase date — the document_date of the Simple-purchase journal, so the cost lands in the correct supplier-statement + VAT month (GMS/PARTS.md §6 Simple-purchase). Defaults to today, editable.';
COMMENT ON COLUMN repair_parts.purchase_recognised_at IS
  'Simple mode: when the purchase (cost->P&L) journal fired — idempotency guard for the Mark-purchased action.';

CREATE INDEX IF NOT EXISTS idx_repair_parts_purchase_pending
  ON repair_parts(purchased_at) WHERE purchase_recognised_at IS NULL;
