-- Migration: Add no_parts_required columns to repair_items table
-- This mirrors the no_labour_required functionality for parts

ALTER TABLE repair_items
  ADD COLUMN IF NOT EXISTS no_parts_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_parts_required_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS no_parts_required_at TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN repair_items.no_parts_required IS 'Flag indicating no parts are required for this repair item';
COMMENT ON COLUMN repair_items.no_parts_required_by IS 'User who marked this item as no parts required';
COMMENT ON COLUMN repair_items.no_parts_required_at IS 'Timestamp when item was marked as no parts required';
