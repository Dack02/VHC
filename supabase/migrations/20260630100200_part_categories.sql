-- =============================================================================
-- Parts module — part_categories lookup (GMS/PARTS.md §5.1)
-- =============================================================================
-- Single-level (optionally 2-level via parent_id) category tree for items,
-- reporting and the later pricing matrix. Seeded per-org (new + existing).
-- Additive only. Mirrors the supplier_types lookup convention.
-- =============================================================================

CREATE TABLE IF NOT EXISTS part_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES part_categories(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_part_category_name_per_org UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_part_categories_org    ON part_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_part_categories_active ON part_categories(organization_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_part_categories_sort   ON part_categories(organization_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_part_categories_parent ON part_categories(parent_id) WHERE parent_id IS NOT NULL;

-- RLS (defense-in-depth alongside in-code org filtering)
ALTER TABLE part_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view part categories" ON part_categories;
CREATE POLICY "Org members can view part categories" ON part_categories
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can insert part categories" ON part_categories;
CREATE POLICY "Admins can insert part categories" ON part_categories
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can update part categories" ON part_categories;
CREATE POLICY "Admins can update part categories" ON part_categories
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can delete part categories" ON part_categories;
CREATE POLICY "Admins can delete part categories" ON part_categories
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- updated_at (reuse the shared trigger fn introduced with repair_types)
DROP TRIGGER IF EXISTS trg_part_categories_updated_at ON part_categories;
CREATE TRIGGER trg_part_categories_updated_at
  BEFORE UPDATE ON part_categories
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- Seeder (new orgs via provisioning + existing orgs via backfill below)
CREATE OR REPLACE FUNCTION seed_default_part_categories_for_org(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO part_categories (organization_id, name, sort_order, is_system)
  VALUES
    (p_organization_id, 'Brakes',                 10, false),
    (p_organization_id, 'Filters',                20, false),
    (p_organization_id, 'Oils & Fluids',          30, false),
    (p_organization_id, 'Tyres',                   40, false),
    (p_organization_id, 'Electrical & Batteries',  50, false),
    (p_organization_id, 'Suspension & Steering',   60, false),
    (p_organization_id, 'Exhaust',                 70, false),
    (p_organization_id, 'Engine',                  80, false),
    (p_organization_id, 'Service Parts',           90, false),
    (p_organization_id, 'Consumables & Sundries', 100, false),
    (p_organization_id, 'Other',                   999, true)
  ON CONFLICT (organization_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing orgs
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    PERFORM seed_default_part_categories_for_org(org_record.id);
  END LOOP;
END;
$$;
