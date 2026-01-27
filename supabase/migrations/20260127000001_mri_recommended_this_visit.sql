-- ============================================================================
-- Add recommended_this_visit field to MRI Scan Results
-- For date_mileage items, allows flagging items recommended for this service visit
-- ============================================================================

ALTER TABLE mri_scan_results
    ADD COLUMN IF NOT EXISTS recommended_this_visit BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN mri_scan_results.recommended_this_visit IS 'For date_mileage items: checked when item is recommended to be done this service visit';
