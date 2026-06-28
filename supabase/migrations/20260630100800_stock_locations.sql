-- =============================================================================
-- Parts module P0 — stock_locations (GMS/PARTS.md §5.5)
-- =============================================================================
-- Where stock physically sits. One auto-seeded "Main" per org; location_id lives
-- on stock_movements from day 1 so multi-location (P4) is a non-breaking add.
-- Additive only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stock_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(30),
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_stock_location_name_per_org UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_stock_locations_org    ON stock_locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_stock_locations_active ON stock_locations(organization_id, is_active) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_location_default_per_org
  ON stock_locations(organization_id) WHERE is_default = true;

ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view stock locations" ON stock_locations;
CREATE POLICY "Org members can view stock locations" ON stock_locations
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Admins can insert stock locations" ON stock_locations;
CREATE POLICY "Admins can insert stock locations" ON stock_locations
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Admins can update stock locations" ON stock_locations;
CREATE POLICY "Admins can update stock locations" ON stock_locations
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Admins can delete stock locations" ON stock_locations;
CREATE POLICY "Admins can delete stock locations" ON stock_locations
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_stock_locations_updated_at ON stock_locations;
CREATE TRIGGER trg_stock_locations_updated_at
  BEFORE UPDATE ON stock_locations
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

CREATE OR REPLACE FUNCTION seed_default_stock_location_for_org(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO stock_locations (organization_id, name, code, is_default, sort_order)
  VALUES (p_organization_id, 'Main', 'MAIN', true, 0)
  ON CONFLICT (organization_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    PERFORM seed_default_stock_location_for_org(org_record.id);
  END LOOP;
END;
$$;
