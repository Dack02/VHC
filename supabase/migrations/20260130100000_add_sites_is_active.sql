-- Add missing is_active column to sites table
-- This column is referenced by the API but was never added to the schema
ALTER TABLE sites ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
