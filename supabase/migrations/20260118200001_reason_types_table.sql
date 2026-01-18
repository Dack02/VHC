-- =============================================================================
-- Reason Types Table Migration
-- Provides a managed registry of reason types that can be assigned to items
-- =============================================================================

-- =============================================================================
-- 1. CREATE REASON_TYPES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS reason_types (
  id VARCHAR(50) PRIMARY KEY,  -- Slug format: tyre, brake_assembly
  name VARCHAR(100) NOT NULL,  -- Display name: Tyre, Brake Assembly
  description TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = global/system type
  is_system BOOLEAN DEFAULT false,  -- true = cannot delete (built-in types)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: same id cannot exist twice for same org (or globally)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reason_types_unique_per_org
  ON reason_types(id, organization_id)
  WHERE organization_id IS NOT NULL;

-- Index for querying by organization
CREATE INDEX IF NOT EXISTS idx_reason_types_org ON reason_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_reason_types_system ON reason_types(is_system) WHERE is_system = true;

-- =============================================================================
-- 2. SEED STANDARD REASON TYPES (System types - cannot delete)
-- =============================================================================

INSERT INTO reason_types (id, name, description, organization_id, is_system) VALUES
  ('tyre', 'Tyre', 'All tyre items share tyre reasons', NULL, true),
  ('brake_assembly', 'Brake Assembly', 'Front/Rear brakes share brake reasons', NULL, true),
  ('brake_disc', 'Brake Disc', 'Front/Rear brake discs', NULL, true),
  ('brake_pad', 'Brake Pad', 'Front/Rear brake pads', NULL, true),
  ('wiper', 'Wiper', 'Front/Rear wipers share wiper reasons', NULL, true),
  ('shock_absorber', 'Shock Absorber', 'Front/Rear shock absorbers', NULL, true),
  ('fluid_level', 'Fluid Level', 'Oil, coolant, brake fluid, washer fluid levels', NULL, true),
  ('light_cluster', 'Light Cluster', 'Headlights, rear lights, indicators', NULL, true),
  ('seat_belt', 'Seat Belt', 'Driver/Passenger seat belts', NULL, true),
  ('suspension_arm', 'Suspension Arm', 'Wishbones, control arms', NULL, true),
  ('cv_boot', 'CV Boot', 'Inner/Outer CV boots', NULL, true),
  ('mirror', 'Mirror', 'Wing mirrors, rear view mirror', NULL, true),
  ('horn', 'Horn', 'Vehicle horn', NULL, true),
  ('exhaust', 'Exhaust', 'Exhaust system components', NULL, true),
  ('steering', 'Steering', 'Steering system components', NULL, true),
  ('wheel', 'Wheel', 'Wheels and wheel bearings', NULL, true),
  ('suspension', 'Suspension', 'Suspension system components', NULL, true),
  ('battery', 'Battery', 'Vehicle battery', NULL, true),
  ('air_filter', 'Air Filter', 'Engine air filter', NULL, true),
  ('drive_belt', 'Drive Belt', 'Engine drive belts', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. RLS POLICIES
-- =============================================================================

ALTER TABLE reason_types ENABLE ROW LEVEL SECURITY;

-- Everyone can view system types and types for their org
DROP POLICY IF EXISTS "View reason types" ON reason_types;
CREATE POLICY "View reason types" ON reason_types
  FOR SELECT USING (
    organization_id IS NULL  -- System types visible to all
    OR organization_id = current_setting('app.current_org_id', true)::uuid
  );

-- Only org admins can create custom types
DROP POLICY IF EXISTS "Create reason types" ON reason_types;
CREATE POLICY "Create reason types" ON reason_types
  FOR INSERT WITH CHECK (
    organization_id = current_setting('app.current_org_id', true)::uuid
    AND organization_id IS NOT NULL  -- Cannot create global types
  );

-- Only org admins can update their org's custom types (not system types)
DROP POLICY IF EXISTS "Update reason types" ON reason_types;
CREATE POLICY "Update reason types" ON reason_types
  FOR UPDATE USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    AND is_system = false
  );

-- Only org admins can delete their org's custom types (not system types)
DROP POLICY IF EXISTS "Delete reason types" ON reason_types;
CREATE POLICY "Delete reason types" ON reason_types
  FOR DELETE USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    AND is_system = false
  );

-- =============================================================================
-- 4. HELPER FUNCTION: Get all reason types for an organization
-- Returns both system types and org-specific custom types
-- =============================================================================

CREATE OR REPLACE FUNCTION get_reason_types_for_org(
  p_organization_id UUID
)
RETURNS TABLE (
  id VARCHAR(50),
  name VARCHAR(100),
  description TEXT,
  organization_id UUID,
  is_system BOOLEAN,
  is_custom BOOLEAN,
  item_count BIGINT,
  reason_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    rt.id,
    rt.name,
    rt.description,
    rt.organization_id,
    rt.is_system,
    (rt.organization_id IS NOT NULL) as is_custom,
    (SELECT COUNT(*) FROM template_items ti WHERE ti.reason_type = rt.id) as item_count,
    (SELECT COUNT(*) FROM item_reasons ir
     WHERE ir.reason_type = rt.id
     AND ir.organization_id = p_organization_id
     AND ir.is_active = true) as reason_count
  FROM reason_types rt
  WHERE rt.organization_id IS NULL  -- System types
     OR rt.organization_id = p_organization_id  -- Org custom types
  ORDER BY rt.is_system DESC, rt.name ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- 5. UPDATE TIMESTAMP TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_reason_types_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_reason_types_updated ON reason_types;
CREATE TRIGGER trigger_reason_types_updated
  BEFORE UPDATE ON reason_types
  FOR EACH ROW EXECUTE FUNCTION update_reason_types_timestamp();

-- =============================================================================
-- DONE
-- =============================================================================
