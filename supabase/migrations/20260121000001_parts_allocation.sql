-- Migration: Add allocation_type to repair_parts
-- Purpose: Support shared (group-level) vs direct (concern-specific) part allocation

-- Add allocation_type column to repair_parts
ALTER TABLE repair_parts
  ADD COLUMN IF NOT EXISTS allocation_type VARCHAR(20) DEFAULT 'direct'
  CHECK (allocation_type IN ('shared', 'direct'));

-- Comment explaining the column
COMMENT ON COLUMN repair_parts.allocation_type IS
  'Part allocation type: shared = applies to all concerns in parent group, direct = applies only to the specific repair_item_id';

-- Default existing parts to 'direct' (current behavior - parts belong to specific item)
-- New parts added to groups can be set to 'shared' to apply to all children
