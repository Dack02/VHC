-- Add sales description fields to mri_items table
-- Used for AI-generated customer-facing descriptions

ALTER TABLE mri_items ADD COLUMN IF NOT EXISTS sales_description TEXT;
ALTER TABLE mri_items ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT FALSE;
ALTER TABLE mri_items ADD COLUMN IF NOT EXISTS ai_reviewed BOOLEAN DEFAULT FALSE;
