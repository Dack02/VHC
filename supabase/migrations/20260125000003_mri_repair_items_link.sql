-- Phase 6: Link MRI results to repair items
-- This migration adds the mri_result_id column for tracking MRI-sourced repair items

-- Add mri_result_id column to repair_items for tracking MRI source
ALTER TABLE repair_items
    ADD COLUMN IF NOT EXISTS mri_result_id UUID REFERENCES mri_scan_results(id) ON DELETE SET NULL;

COMMENT ON COLUMN repair_items.mri_result_id IS 'Reference to MRI scan result that created this repair item';

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_repair_items_mri_result_id ON repair_items(mri_result_id) WHERE mri_result_id IS NOT NULL;
