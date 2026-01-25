-- Work Authority Sheets Table
-- Tracks generated work authority sheet documents for audit and document number sequencing

CREATE TABLE IF NOT EXISTS work_authority_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  document_number TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('technician', 'service_advisor')),
  generated_by UUID NOT NULL REFERENCES users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Snapshot of what was included
  pre_booked_count INTEGER NOT NULL DEFAULT 0,
  vhc_work_count INTEGER NOT NULL DEFAULT 0,
  total_labour_hours NUMERIC(10,2),
  total_value NUMERIC(10,2),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_document_number_per_org UNIQUE (organization_id, document_number)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_work_authority_sheets_org_id ON work_authority_sheets(organization_id);
CREATE INDEX IF NOT EXISTS idx_work_authority_sheets_health_check_id ON work_authority_sheets(health_check_id);
CREATE INDEX IF NOT EXISTS idx_work_authority_sheets_document_number ON work_authority_sheets(document_number);
CREATE INDEX IF NOT EXISTS idx_work_authority_sheets_generated_at ON work_authority_sheets(generated_at);

-- RLS Policies
ALTER TABLE work_authority_sheets ENABLE ROW LEVEL SECURITY;

-- Users can only see work authority sheets from their organization
DROP POLICY IF EXISTS work_authority_sheets_org_isolation ON work_authority_sheets;
CREATE POLICY work_authority_sheets_org_isolation ON work_authority_sheets
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMENT ON TABLE work_authority_sheets IS 'Audit log and tracking for generated Work Authority Sheet PDFs';
COMMENT ON COLUMN work_authority_sheets.document_number IS 'Unique document reference in format WA-YYYYMMDD-SEQ';
COMMENT ON COLUMN work_authority_sheets.variant IS 'technician (no pricing) or service_advisor (with pricing)';
