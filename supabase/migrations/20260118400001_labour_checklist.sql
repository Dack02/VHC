-- =============================================================================
-- Labour Checklist Workflow Enhancement
-- =============================================================================
-- Adds fields to support the labour checklist workflow where users must either
-- add labour OR explicitly mark items as "no labour required"
-- =============================================================================

-- Add no_labour_required tracking to repair_items
ALTER TABLE repair_items
  ADD COLUMN IF NOT EXISTS no_labour_required BOOLEAN DEFAULT false;

ALTER TABLE repair_items
  ADD COLUMN IF NOT EXISTS no_labour_required_by UUID REFERENCES users(id);

ALTER TABLE repair_items
  ADD COLUMN IF NOT EXISTS no_labour_required_at TIMESTAMPTZ;

-- Create index for querying items needing labour action
CREATE INDEX IF NOT EXISTS idx_repair_items_labour_action
  ON repair_items(health_check_id, no_labour_required, labour_status);

-- =============================================================================
-- RLS Policies (already inherited from repair_items table)
-- No additional RLS needed as existing repair_items policies apply
-- =============================================================================

COMMENT ON COLUMN repair_items.no_labour_required IS 'When true, indicates no labour is needed for this item';
COMMENT ON COLUMN repair_items.no_labour_required_by IS 'User who marked this item as no labour required';
COMMENT ON COLUMN repair_items.no_labour_required_at IS 'When the item was marked as no labour required';
