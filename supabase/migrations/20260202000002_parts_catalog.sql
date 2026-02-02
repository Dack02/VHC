-- =============================================================================
-- Parts Catalog: Saved part number/description/cost for autocomplete
-- =============================================================================

-- =============================================================================
-- 1. PARTS CATALOG TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS parts_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_number VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL,
  cost_price DECIMAL(10,2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique part number per organization
  CONSTRAINT unique_part_number_per_org UNIQUE (organization_id, part_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_parts_catalog_org ON parts_catalog(organization_id);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_org_part ON parts_catalog(organization_id, part_number);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_active ON parts_catalog(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 2. RLS POLICIES
-- =============================================================================

ALTER TABLE parts_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view parts catalog" ON parts_catalog;
CREATE POLICY "Org members can view parts catalog" ON parts_catalog
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Org members can insert parts catalog" ON parts_catalog;
CREATE POLICY "Org members can insert parts catalog" ON parts_catalog
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Org members can update parts catalog" ON parts_catalog;
CREATE POLICY "Org members can update parts catalog" ON parts_catalog
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Org members can delete parts catalog" ON parts_catalog;
CREATE POLICY "Org members can delete parts catalog" ON parts_catalog
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- =============================================================================
-- 3. UPDATED_AT TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_parts_catalog_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_parts_catalog_updated ON parts_catalog;
CREATE TRIGGER trigger_parts_catalog_updated
  BEFORE UPDATE ON parts_catalog
  FOR EACH ROW EXECUTE FUNCTION update_parts_catalog_timestamp();

-- =============================================================================
-- DONE
-- =============================================================================
