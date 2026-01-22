-- =============================================================================
-- Add follow_up_date column to repair_items
-- This column was missing from the repair_groups_pricing migration
-- =============================================================================

ALTER TABLE repair_items
ADD COLUMN IF NOT EXISTS follow_up_date DATE;

CREATE INDEX IF NOT EXISTS idx_repair_items_follow_up
ON repair_items(follow_up_date)
WHERE follow_up_date IS NOT NULL;

COMMENT ON COLUMN repair_items.follow_up_date IS 'Date to follow up on this repair item (for amber/advisory items)';
