-- Phase 11: DMS Integration Migration
-- Multi-tenant support for Gemini OSI and other DMS providers

-- ============================================
-- 1. Organization DMS Settings Table
-- ============================================
-- Stores DMS credentials and settings per organization

CREATE TABLE IF NOT EXISTS organization_dms_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Integration Enable/Disable
  enabled BOOLEAN DEFAULT false,
  provider VARCHAR(50) DEFAULT 'gemini_osi',  -- 'gemini_osi', 'cdk', 'reynolds', etc.

  -- Gemini OSI Credentials (encrypted)
  api_url TEXT,                          -- Base URL for Gemini API
  api_key_encrypted TEXT,                -- Encrypted API key
  dealer_id VARCHAR(100),                -- Dealer identifier in DMS

  -- Import Settings
  default_template_id UUID REFERENCES check_templates(id),
  auto_import_enabled BOOLEAN DEFAULT false,
  import_schedule_hour INTEGER DEFAULT 20,   -- Hour of day (0-23) for auto import
  import_schedule_days JSONB DEFAULT '[1,2,3,4,5,6]',  -- Days of week (0=Sun, 1=Mon...)

  -- Booking Filters
  import_service_types JSONB DEFAULT '["service", "mot", "repair"]',
  min_booking_duration_minutes INTEGER DEFAULT 30,

  -- Field Mapping (for different DMS providers)
  field_mapping JSONB DEFAULT '{}',

  -- Status
  last_import_at TIMESTAMPTZ,
  last_import_status VARCHAR(50),
  last_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id)
);

-- Index for looking up by organization
CREATE INDEX IF NOT EXISTS idx_org_dms_settings_org
  ON organization_dms_settings(organization_id);


-- ============================================
-- 2. DMS Import History Table
-- ============================================
-- Tracks each import run with results and errors

CREATE TABLE IF NOT EXISTS dms_import_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,

  -- Import Details
  import_type VARCHAR(20) NOT NULL DEFAULT 'manual',  -- 'manual', 'scheduled', 'test'
  import_date DATE NOT NULL,                           -- Date being imported
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Results
  status VARCHAR(50) NOT NULL DEFAULT 'running',  -- 'running', 'completed', 'failed', 'partial'
  bookings_found INTEGER DEFAULT 0,
  bookings_imported INTEGER DEFAULT 0,
  bookings_skipped INTEGER DEFAULT 0,        -- Already exist (duplicate)
  bookings_failed INTEGER DEFAULT 0,

  -- New records created
  customers_created INTEGER DEFAULT 0,
  vehicles_created INTEGER DEFAULT 0,
  health_checks_created INTEGER DEFAULT 0,

  -- Error Details
  errors JSONB DEFAULT '[]',

  -- Triggered by
  triggered_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dms_import_history_org
  ON dms_import_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_dms_import_history_date
  ON dms_import_history(organization_id, import_date);
CREATE INDEX IF NOT EXISTS idx_dms_import_history_status
  ON dms_import_history(organization_id, status);


-- ============================================
-- 3. Health Checks - Deletion Fields
-- ============================================
-- Add soft delete with reason tracking

ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason VARCHAR(50),
  ADD COLUMN IF NOT EXISTS deletion_notes TEXT;

-- Index for finding non-deleted records
CREATE INDEX IF NOT EXISTS idx_health_checks_deleted
  ON health_checks(deleted_at)
  WHERE deleted_at IS NULL;

-- External ID for DMS sync
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);

-- Unique constraint for external_id per org/source
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_checks_external
  ON health_checks(organization_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

-- Import batch tracking
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES dms_import_history(id);


-- ============================================
-- 4. Customers - External ID
-- ============================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);

-- external_id may already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'external_id'
  ) THEN
    ALTER TABLE customers ADD COLUMN external_id VARCHAR(255);
  END IF;
END $$;

-- Unique constraint for external_id per org/source
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_external
  ON customers(organization_id, external_source, external_id)
  WHERE external_id IS NOT NULL;


-- ============================================
-- 5. Vehicles - External ID
-- ============================================

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);

-- Unique constraint for external_id per org/source
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_external
  ON vehicles(organization_id, external_source, external_id)
  WHERE external_id IS NOT NULL;


-- ============================================
-- 6. Organization Usage - DMS Tracking
-- ============================================

ALTER TABLE organization_usage
  ADD COLUMN IF NOT EXISTS dms_imports INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dms_bookings_imported INTEGER DEFAULT 0;


-- ============================================
-- 7. Row Level Security
-- ============================================

-- DMS Settings RLS
ALTER TABLE organization_dms_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_dms_settings_isolation ON organization_dms_settings;
CREATE POLICY org_dms_settings_isolation ON organization_dms_settings
  FOR ALL USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR current_setting('app.current_org_id', true) IS NULL
  );

-- Import History RLS
ALTER TABLE dms_import_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dms_import_history_isolation ON dms_import_history;
CREATE POLICY dms_import_history_isolation ON dms_import_history
  FOR ALL USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR current_setting('app.current_org_id', true) IS NULL
  );


-- ============================================
-- 8. Deletion Reasons Reference
-- ============================================
-- Valid deletion_reason values:
-- 'no_show' - Customer did not arrive
-- 'no_time' - Not enough time to perform inspection
-- 'not_required' - Customer declined inspection
-- 'customer_declined' - Customer declined after initial contact
-- 'vehicle_issue' - Vehicle has issues preventing inspection
-- 'duplicate' - Duplicate booking
-- 'other' - Other reason (requires notes)

COMMENT ON COLUMN health_checks.deletion_reason IS 'Valid values: no_show, no_time, not_required, customer_declined, vehicle_issue, duplicate, other';
COMMENT ON COLUMN health_checks.deletion_notes IS 'Required when deletion_reason is other';
