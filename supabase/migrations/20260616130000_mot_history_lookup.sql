-- =============================================================================
-- MOT History / DVSA vehicle lookup
--
-- Adds DVSA MOT History API support so a registration can be looked up when
-- creating a manual health check:
--   1. vehicle MOT summary columns (rolled up from the latest test)
--   2. a full per-test history table (vehicle_mot_tests)
--   3. the platform credential row (platform_settings id='vehicle_lookup')
--   4. registration of the 'vehicle_lookup' feature module
--
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT) per the project
-- DB-safety rules — no destructive statements.
-- =============================================================================

-- 1. Vehicle MOT summary columns (rolled up from the most recent MOT test) -----
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mot_expiry_date    DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mot_status         VARCHAR(30);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS first_used_date    DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mot_last_synced_at TIMESTAMPTZ;

-- 2. Full MOT test history (one row per MOT test returned by DVSA) --------------
CREATE TABLE IF NOT EXISTS vehicle_mot_tests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id        UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  mot_test_number   VARCHAR(40),
  completed_date    TIMESTAMPTZ,
  test_result       VARCHAR(20),                  -- PASSED | FAILED
  expiry_date       DATE,
  odometer_value    INTEGER,
  odometer_unit     VARCHAR(10),                  -- mi | km
  odometer_result   VARCHAR(20),                  -- READ | UNREADABLE | NO_ODOMETER
  data_source       VARCHAR(40),
  defects           JSONB NOT NULL DEFAULT '[]',  -- [{ text, type, dangerous }]
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent re-sync: a test is unique per vehicle by its DVSA test number.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_mot_tests_vehicle_testno
  ON vehicle_mot_tests (vehicle_id, mot_test_number);

CREATE INDEX IF NOT EXISTS idx_vehicle_mot_tests_vehicle
  ON vehicle_mot_tests (vehicle_id, completed_date DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_mot_tests_org
  ON vehicle_mot_tests (organization_id);

-- 3. Platform credential row for the DVSA MOT History API ----------------------
-- Global (not per-org), stored alongside the other platform_settings rows. The
-- API encrypts mot_client_secret / mot_api_key (AES-256-GCM) before writing;
-- mot_client_id and mot_tenant_id are non-secret. Empty defaults so the row
-- exists for the admin Credentials UI to populate.
INSERT INTO platform_settings (id, settings)
VALUES (
  'vehicle_lookup',
  jsonb_build_object(
    'provider', 'dvsa_mot_history',
    'enabled', false,
    'mot_client_id', '',
    'mot_tenant_id', '',
    'mot_client_secret_encrypted', '',
    'mot_api_key_encrypted', ''
  )
)
ON CONFLICT (id) DO NOTHING;

-- 4. Register the 'vehicle_lookup' module on every plan (behaviour-neutral: ON).
-- The registry (lib/modules.ts) already defaults it on; this keeps plan defaults
-- explicit so the admin module-enablement UI shows the correct state. Mirrors the
-- pattern in 20260615130000_module_enablement.sql.
UPDATE subscription_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('vehicle_lookup', true);
