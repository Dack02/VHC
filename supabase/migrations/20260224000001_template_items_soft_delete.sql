-- Add soft-delete support to template_items
-- This allows template items to be "deleted" without breaking
-- the foreign key constraint from check_results.template_item_id
ALTER TABLE template_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Index for filtering active items efficiently
CREATE INDEX IF NOT EXISTS idx_template_items_is_active ON template_items(is_active);
