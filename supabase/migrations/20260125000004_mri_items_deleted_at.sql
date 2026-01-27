-- Add deleted_at column to mri_items for soft delete support
-- This allows tracking of deleted MRI items while preserving historical scan results

ALTER TABLE mri_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for querying non-deleted items
CREATE INDEX IF NOT EXISTS idx_mri_items_deleted_at ON mri_items(deleted_at) WHERE deleted_at IS NULL;

COMMENT ON COLUMN mri_items.deleted_at IS 'Soft delete timestamp - when set, item is considered deleted but results are preserved';
