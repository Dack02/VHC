-- =============================================================================
-- GMS — Jobsheets (Phase 1)
--
-- Introduces the Jobsheet as the top-level booking document. A jobsheet is the
-- parent; a health check (VHC) is attached via health_checks.jobsheet_id. When a
-- jobsheet is created the API also creates the linked VHC (status awaiting_arrival,
-- job_state due_in).
--
-- New objects:
--   - service_types        (org-scoped lookup, single-select on a jobsheet)
--   - booking_codes        (org-scoped lookup, multi-select — the renamed
--                           Garage-Hive "Extended Status Code")
--   - jobsheets            (the booking document; auto JS00001 reference)
--   - jobsheet_booking_codes (jobsheet <-> booking_codes join)
--   - health_checks.jobsheet_id (nullable link; existing/DMS checks untouched)
--   - customers.phone, customers.contact_name (additive)
--   - organization_settings.next_jobsheet_number (per-org counter)
--   - subscription_plans.features.jobsheets = false (module OFF by default)
--
-- Safety: all idempotent (IF NOT EXISTS / DO NOTHING). No destructive statements.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Lookup: service_types (single-select on a jobsheet)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  label TEXT,
  colour VARCHAR(7) NOT NULL DEFAULT '#6366F1',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_service_types_org
  ON service_types(organization_id, is_active, sort_order);

-- ----------------------------------------------------------------------------
-- 2. Lookup: booking_codes (multi-select — renamed "Extended Status Code")
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  label TEXT,
  colour VARCHAR(7) NOT NULL DEFAULT '#6366F1',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_booking_codes_org
  ON booking_codes(organization_id, is_active, sort_order);

-- ----------------------------------------------------------------------------
-- 3. Additive customer contact fields (landline + named contact)
-- ----------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- ----------------------------------------------------------------------------
-- 4. Per-org jobsheet reference counter
-- ----------------------------------------------------------------------------
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS next_jobsheet_number INTEGER DEFAULT 1;

-- ----------------------------------------------------------------------------
-- 5. jobsheets — the top-level booking document
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobsheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  reference VARCHAR(20),                    -- auto JS00001 via trigger
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  service_type_id UUID REFERENCES service_types(id) ON DELETE SET NULL,
  advisor_id UUID REFERENCES users(id) ON DELETE SET NULL,    -- Service Advisor
  mileage INTEGER,                          -- optional at every stage
  requested_delivery_at TIMESTAMPTZ,
  courtesy_vehicle_required BOOLEAN NOT NULL DEFAULT false,
  collection_and_delivery BOOLEAN NOT NULL DEFAULT false,
  vehicle_on_site BOOLEAN NOT NULL DEFAULT false,
  customer_contact_notes TEXT,
  jobsheet_complete BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- "Document Date" (automated)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT jobsheets_org_reference_unique UNIQUE (organization_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_jobsheets_org_created
  ON jobsheets(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobsheets_org_active
  ON jobsheets(organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_jobsheets_customer ON jobsheets(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobsheets_vehicle ON jobsheets(vehicle_id);

COMMENT ON COLUMN jobsheets.created_at IS 'Document creation date/time (automated). Surfaced as the jobsheet "Document Date".';
COMMENT ON COLUMN jobsheets.mileage IS 'Optional at every stage — never required.';

-- ----------------------------------------------------------------------------
-- 6. jobsheet_booking_codes — multi-select join
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobsheet_booking_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jobsheet_id UUID NOT NULL REFERENCES jobsheets(id) ON DELETE CASCADE,
  booking_code_id UUID NOT NULL REFERENCES booking_codes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (jobsheet_id, booking_code_id)
);

CREATE INDEX IF NOT EXISTS idx_jobsheet_booking_codes_js
  ON jobsheet_booking_codes(jobsheet_id);

-- ----------------------------------------------------------------------------
-- 7. Link the VHC to its jobsheet (nullable — existing/DMS checks untouched)
-- ----------------------------------------------------------------------------
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS jobsheet_id UUID REFERENCES jobsheets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_health_checks_jobsheet_id
  ON health_checks(jobsheet_id);

-- ----------------------------------------------------------------------------
-- 8. Auto-generate jobsheet reference (JS00001), mirroring generate_vhc_reference
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_jobsheet_reference()
RETURNS TRIGGER AS $$
DECLARE
  v_next_number INTEGER;
BEGIN
  IF NEW.reference IS NULL THEN
    -- Atomically get and increment the per-org counter
    UPDATE organization_settings
    SET next_jobsheet_number = COALESCE(next_jobsheet_number, 1) + 1,
        updated_at = NOW()
    WHERE organization_id = NEW.organization_id
    RETURNING next_jobsheet_number - 1 INTO v_next_number;

    -- If no organization_settings row exists, create one
    IF v_next_number IS NULL THEN
      INSERT INTO organization_settings (organization_id, next_jobsheet_number, created_at, updated_at)
      VALUES (NEW.organization_id, 2, NOW(), NOW())
      ON CONFLICT (organization_id) DO UPDATE
      SET next_jobsheet_number = COALESCE(organization_settings.next_jobsheet_number, 1) + 1,
          updated_at = NOW()
      RETURNING next_jobsheet_number - 1 INTO v_next_number;
    END IF;

    NEW.reference := 'JS' || LPAD(v_next_number::TEXT, 5, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_jobsheet_reference ON jobsheets;
CREATE TRIGGER trg_generate_jobsheet_reference
BEFORE INSERT ON jobsheets
FOR EACH ROW
EXECUTE FUNCTION generate_jobsheet_reference();

-- ----------------------------------------------------------------------------
-- 9. updated_at touch trigger (dedicated function, matching the per-feature
--    convention used elsewhere in this schema)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobsheets_updated_at ON jobsheets;
CREATE TRIGGER trg_jobsheets_updated_at
  BEFORE UPDATE ON jobsheets
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

DROP TRIGGER IF EXISTS trg_service_types_updated_at ON service_types;
CREATE TRIGGER trg_service_types_updated_at
  BEFORE UPDATE ON service_types
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

DROP TRIGGER IF EXISTS trg_booking_codes_updated_at ON booking_codes;
CREATE TRIGGER trg_booking_codes_updated_at
  BEFORE UPDATE ON booking_codes
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- ----------------------------------------------------------------------------
-- 10. RLS (API uses service role; policies are defence-in-depth, matching the
--     workshop_statuses convention)
-- ----------------------------------------------------------------------------
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobsheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobsheet_booking_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own org service types" ON service_types;
CREATE POLICY "Users can view own org service types"
  ON service_types FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own org booking codes" ON booking_codes;
CREATE POLICY "Users can view own org booking codes"
  ON booking_codes FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own org jobsheets" ON jobsheets;
CREATE POLICY "Users can view own org jobsheets"
  ON jobsheets FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own org jobsheet booking codes" ON jobsheet_booking_codes;
CREATE POLICY "Users can view own org jobsheet booking codes"
  ON jobsheet_booking_codes FOR SELECT
  USING (jobsheet_id IN (
    SELECT id FROM jobsheets
    WHERE organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid())
  ));

-- ----------------------------------------------------------------------------
-- 11. Module default: jobsheets OFF for every plan (opt-in per org)
-- ----------------------------------------------------------------------------
UPDATE subscription_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('jobsheets', false);

-- ----------------------------------------------------------------------------
-- 12. Seed sensible UK defaults for existing orgs (DO NOTHING — easy to edit/delete).
--     New orgs are lazy-seeded by the API on first fetch.
-- ----------------------------------------------------------------------------
INSERT INTO service_types (organization_id, code, label, colour, sort_order)
SELECT o.id, s.code, s.label, s.colour, s.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('MOT',              'MOT',                '#EF4444', 10),
  ('Full Service',     'Full Service',       '#16A34A', 20),
  ('Interim Service',  'Interim Service',    '#22C55E', 30),
  ('Repair',           'Repair',             '#F59E0B', 40),
  ('Diagnostic',       'Diagnostic',         '#6366F1', 50),
  ('Tyres',            'Tyres',              '#0EA5E9', 60),
  ('Air Conditioning', 'Air Conditioning',   '#06B6D4', 70),
  ('Warranty',         'Warranty',           '#8B5CF6', 80)
) AS s(code, label, colour, sort_order)
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO booking_codes (organization_id, code, label, colour, sort_order)
SELECT o.id, b.code, b.label, b.colour, b.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Waiting',               'Waiting',               '#EF4444', 10),
  ('Drop Off',              'Drop Off',              '#6366F1', 20),
  ('Courtesy Car',          'Courtesy Car',          '#16A34A', 30),
  ('Collection & Delivery', 'Collection & Delivery', '#0EA5E9', 40),
  ('Fleet',                 'Fleet',                 '#F59E0B', 50),
  ('Warranty Work',         'Warranty Work',         '#8B5CF6', 60),
  ('Internal',              'Internal',              '#64748B', 70)
) AS b(code, label, colour, sort_order)
ON CONFLICT (organization_id, code) DO NOTHING;
