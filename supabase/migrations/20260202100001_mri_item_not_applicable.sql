-- Add "Not Applicable" support to MRI scan results
-- Allows marking items as N/A (e.g. Timing Belt on a chain engine)

ALTER TABLE mri_scan_results
  ADD COLUMN IF NOT EXISTS not_applicable BOOLEAN DEFAULT FALSE;

ALTER TABLE mri_scan_results
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

-- Partial index for future "who clicks N/A most" reporting
CREATE INDEX IF NOT EXISTS idx_mri_results_not_applicable
  ON mri_scan_results(organization_id, updated_by, not_applicable)
  WHERE not_applicable = TRUE;
