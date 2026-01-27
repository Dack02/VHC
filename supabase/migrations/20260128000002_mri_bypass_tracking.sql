-- ============================================================================
-- MRI Bypass Tracking
-- Track when advisors complete check-in without fully completing MRI scan
-- ============================================================================

-- Add MRI completion tracking columns to health_checks
ALTER TABLE health_checks
    ADD COLUMN IF NOT EXISTS mri_items_total INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mri_items_completed INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mri_bypassed BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN health_checks.mri_items_total IS 'Total MRI items available at check-in completion time';
COMMENT ON COLUMN health_checks.mri_items_completed IS 'Number of MRI items completed at check-in completion time';
COMMENT ON COLUMN health_checks.mri_bypassed IS 'True if check-in was completed with incomplete MRI scan (completed < total)';

-- Index for reporting queries
CREATE INDEX IF NOT EXISTS idx_health_checks_mri_bypassed
    ON health_checks(organization_id, mri_bypassed, checked_in_at)
    WHERE mri_bypassed = TRUE;
