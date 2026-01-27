-- ============================================================================
-- MRI Scan - Track explicit "Not due yet" selection
-- When user selects "Not due yet" without entering date/mileage data,
-- we need to persist this selection
-- ============================================================================

ALTER TABLE mri_scan_results
    ADD COLUMN IF NOT EXISTS not_due_yet BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN mri_scan_results.not_due_yet IS 'True when user explicitly selected "Not due yet" status';
