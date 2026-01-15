-- =============================================================================
-- Migration: Inspection Thresholds
-- Organization-wide inspection threshold settings
-- =============================================================================

-- =============================================================================
-- INSPECTION THRESHOLDS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS inspection_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Tyre depth thresholds (in mm)
  -- UK legal minimum is 1.6mm
  tyre_red_below_mm DECIMAL(4,2) NOT NULL DEFAULT 1.6,
  tyre_amber_below_mm DECIMAL(4,2) NOT NULL DEFAULT 3.0,

  -- Brake pad thickness thresholds (in mm)
  -- Generally 3mm is minimum safe, 5mm is warning
  brake_pad_red_below_mm DECIMAL(4,2) NOT NULL DEFAULT 3.0,
  brake_pad_amber_below_mm DECIMAL(4,2) NOT NULL DEFAULT 5.0,

  -- Brake disc thickness thresholds (in mm)
  -- Varies by vehicle, but typical minimums
  brake_disc_red_below_mm DECIMAL(4,2) NOT NULL DEFAULT 22.0,
  brake_disc_amber_below_mm DECIMAL(4,2) NOT NULL DEFAULT 24.0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One threshold config per organization
  CONSTRAINT unique_org_thresholds UNIQUE (organization_id)
);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE inspection_thresholds ENABLE ROW LEVEL SECURITY;

-- Users can read their organization's thresholds
CREATE POLICY "Users can read own org thresholds"
ON inspection_thresholds FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()
  )
);

-- Only admins can update thresholds
CREATE POLICY "Admins can update own org thresholds"
ON inspection_thresholds FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM users
    WHERE id = auth.uid()
    AND role IN ('super_admin', 'org_admin', 'site_admin')
  )
);

-- Only admins can insert thresholds
CREATE POLICY "Admins can insert own org thresholds"
ON inspection_thresholds FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM users
    WHERE id = auth.uid()
    AND role IN ('super_admin', 'org_admin', 'site_admin')
  )
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_inspection_thresholds_org
ON inspection_thresholds(organization_id);

-- =============================================================================
-- TRIGGER FOR UPDATED_AT
-- =============================================================================

CREATE OR REPLACE FUNCTION update_inspection_thresholds_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_inspection_thresholds_timestamp ON inspection_thresholds;
CREATE TRIGGER update_inspection_thresholds_timestamp
  BEFORE UPDATE ON inspection_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION update_inspection_thresholds_updated_at();

-- =============================================================================
-- INSERT DEFAULT THRESHOLDS FOR EXISTING ORGANIZATIONS
-- =============================================================================

INSERT INTO inspection_thresholds (organization_id)
SELECT id FROM organizations
WHERE id NOT IN (SELECT organization_id FROM inspection_thresholds)
ON CONFLICT (organization_id) DO NOTHING;
