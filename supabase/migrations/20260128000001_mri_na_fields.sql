-- ============================================================================
-- MRI Scan Form UX Improvements - N/A Fields
-- Adds date_na and mileage_na columns for tracking when date or mileage
-- is not applicable for a given MRI item (e.g., MOT = date only,
-- Timing Belt = mileage only)
-- ============================================================================

-- Add N/A tracking columns to mri_scan_results
ALTER TABLE mri_scan_results
    ADD COLUMN IF NOT EXISTS date_na BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mileage_na BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN mri_scan_results.date_na IS 'When true, date tracking is not applicable for this item';
COMMENT ON COLUMN mri_scan_results.mileage_na IS 'When true, mileage tracking is not applicable for this item';
