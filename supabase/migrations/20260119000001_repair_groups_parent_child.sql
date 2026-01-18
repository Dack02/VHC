-- Migration: Repair Groups Parent-Child Relationship
-- Add parent_repair_item_id to support hierarchical repair groups
-- Individual items become children of the group rather than being deleted

-- Add parent reference column (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'repair_items' AND column_name = 'parent_repair_item_id'
  ) THEN
    ALTER TABLE repair_items
      ADD COLUMN parent_repair_item_id UUID REFERENCES repair_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add index for efficient queries (if not exists)
CREATE INDEX IF NOT EXISTS idx_repair_items_parent ON repair_items(parent_repair_item_id);

-- Prevent groups from having parents (only individual items can be children)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_groups_no_parent' AND table_name = 'repair_items'
  ) THEN
    ALTER TABLE repair_items
      ADD CONSTRAINT chk_groups_no_parent
      CHECK (NOT (is_group = true AND parent_repair_item_id IS NOT NULL));
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN repair_items.parent_repair_item_id IS 'Parent repair item ID for grouped items. When set, this item is a child of a group. Groups cannot have parents.';
