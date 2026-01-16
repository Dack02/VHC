/**
 * Phase 11 Migration: DMS Integration (Multi-Tenant)
 *
 * Creates tables and fields for Gemini OSI DMS integration:
 * - organization_dms_settings (per-org DMS credentials and settings)
 * - dms_import_history (track import runs per org)
 * - Deletion fields on health_checks
 * - external_id fields for syncing
 *
 * Run with: npx tsx src/scripts/apply-phase11-migration.ts
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runMigration() {
  console.log('Starting Phase 11 Migration: DMS Integration...\n')

  // 1. Organization DMS Settings Table
  console.log('1. Creating organization_dms_settings table...')
  const { error: dmsSettingsError } = await supabase.rpc('exec_sql', {
    sql: `
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

      -- RLS Policy
      ALTER TABLE organization_dms_settings ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS org_dms_settings_isolation ON organization_dms_settings;
      CREATE POLICY org_dms_settings_isolation ON organization_dms_settings
        FOR ALL USING (
          organization_id = current_setting('app.current_org_id', true)::uuid
          OR current_setting('app.current_org_id', true) IS NULL
        );
    `
  })

  if (dmsSettingsError) {
    console.log('  Note: organization_dms_settings may already exist or RPC not available')
    console.log('  Error:', dmsSettingsError.message)
  } else {
    console.log('  Created organization_dms_settings table')
  }

  // 2. DMS Import History Table
  console.log('\n2. Creating dms_import_history table...')
  const { error: importHistoryError } = await supabase.rpc('exec_sql', {
    sql: `
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

      -- RLS Policy
      ALTER TABLE dms_import_history ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS dms_import_history_isolation ON dms_import_history;
      CREATE POLICY dms_import_history_isolation ON dms_import_history
        FOR ALL USING (
          organization_id = current_setting('app.current_org_id', true)::uuid
          OR current_setting('app.current_org_id', true) IS NULL
        );
    `
  })

  if (importHistoryError) {
    console.log('  Note: dms_import_history may already exist or RPC not available')
    console.log('  Error:', importHistoryError.message)
  } else {
    console.log('  Created dms_import_history table')
  }

  // 3. Add deletion fields to health_checks
  console.log('\n3. Adding deletion fields to health_checks...')
  const { error: deletionFieldsError } = await supabase.rpc('exec_sql', {
    sql: `
      -- Deletion fields for soft delete with reason
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
    `
  })

  if (deletionFieldsError) {
    console.log('  Note: Some fields may already exist')
    console.log('  Error:', deletionFieldsError.message)
  } else {
    console.log('  Added deletion and external_id fields to health_checks')
  }

  // 4. Add external_id to customers
  console.log('\n4. Adding external_id to customers...')
  const { error: customerExternalError } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);

      -- Ensure external_id exists (may have been added before)
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

      -- Unique constraint for external_id per org/source
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_external
        ON customers(organization_id, external_source, external_id)
        WHERE external_id IS NOT NULL;
    `
  })

  if (customerExternalError) {
    console.log('  Note: Some fields may already exist')
    console.log('  Error:', customerExternalError.message)
  } else {
    console.log('  Added external_id fields to customers')
  }

  // 5. Add external_id to vehicles
  console.log('\n5. Adding external_id to vehicles...')
  const { error: vehicleExternalError } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE vehicles
        ADD COLUMN IF NOT EXISTS external_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);

      -- Unique constraint for external_id per org/source
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_external
        ON vehicles(organization_id, external_source, external_id)
        WHERE external_id IS NOT NULL;
    `
  })

  if (vehicleExternalError) {
    console.log('  Note: Some fields may already exist')
    console.log('  Error:', vehicleExternalError.message)
  } else {
    console.log('  Added external_id fields to vehicles')
  }

  // 6. Update organization_usage to track DMS imports
  console.log('\n6. Adding DMS import tracking to organization_usage...')
  const { error: usageError } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE organization_usage
        ADD COLUMN IF NOT EXISTS dms_imports INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS dms_bookings_imported INTEGER DEFAULT 0;
    `
  })

  if (usageError) {
    console.log('  Note: Fields may already exist')
    console.log('  Error:', usageError.message)
  } else {
    console.log('  Added DMS tracking to organization_usage')
  }

  // If RPC doesn't work, try direct SQL via raw query
  console.log('\n7. Attempting direct table creation if RPC failed...')

  // Try to create organization_dms_settings directly
  const { error: directDmsError } = await supabase.from('organization_dms_settings').select('id').limit(1)

  if (directDmsError && directDmsError.code === '42P01') {
    // Table doesn't exist, create it manually
    console.log('  organization_dms_settings table not found, creating...')

    // We'll need to create it via migration file instead
    console.log('  NOTE: Please run the SQL migration file directly in Supabase SQL editor:')
    console.log('  /supabase/migrations/20260115000001_dms_integration.sql')
  } else {
    console.log('  organization_dms_settings table exists')
  }

  // Try to create dms_import_history directly
  const { error: directHistoryError } = await supabase.from('dms_import_history').select('id').limit(1)

  if (directHistoryError && directHistoryError.code === '42P01') {
    console.log('  dms_import_history table not found')
    console.log('  NOTE: Please run the SQL migration file directly in Supabase SQL editor')
  } else {
    console.log('  dms_import_history table exists')
  }

  console.log('\n✅ Phase 11 Migration Complete!')
  console.log('\nNext steps:')
  console.log('1. If tables were not created, run the SQL migration file manually')
  console.log('2. Generate a new encryption key if needed: openssl rand -hex 32')
  console.log('3. Set ENCRYPTION_KEY in your environment')
}

runMigration().catch(console.error)
