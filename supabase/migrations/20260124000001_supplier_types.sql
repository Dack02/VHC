-- =============================================================================
-- Supplier Types: Categorization for suppliers (Dealer, Factor, Tyres, Other)
-- =============================================================================

-- =============================================================================
-- 1. SUPPLIER TYPES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS supplier_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique name per organization
  CONSTRAINT unique_supplier_type_name_per_org UNIQUE (organization_id, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_supplier_types_org ON supplier_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_supplier_types_active ON supplier_types(organization_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_supplier_types_sort ON supplier_types(organization_id, sort_order);

-- =============================================================================
-- 2. ADD supplier_type_id TO SUPPLIERS TABLE
-- =============================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_type_id UUID REFERENCES supplier_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_type ON suppliers(supplier_type_id) WHERE supplier_type_id IS NOT NULL;

-- =============================================================================
-- 3. RLS POLICIES
-- =============================================================================

ALTER TABLE supplier_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view supplier types" ON supplier_types;
CREATE POLICY "Org members can view supplier types" ON supplier_types
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can insert supplier types" ON supplier_types;
CREATE POLICY "Admins can insert supplier types" ON supplier_types
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can update supplier types" ON supplier_types;
CREATE POLICY "Admins can update supplier types" ON supplier_types
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can delete supplier types" ON supplier_types;
CREATE POLICY "Admins can delete supplier types" ON supplier_types
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- =============================================================================
-- 4. SEED DEFAULT SUPPLIER TYPES FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_default_supplier_types(target_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  INSERT INTO supplier_types (organization_id, name, description, sort_order, is_system)
  VALUES
    (target_org_id, 'Dealer', 'OEM dealership parts', 1, false),
    (target_org_id, 'Factor', 'Parts factor / wholesaler', 2, false),
    (target_org_id, 'Tyres', 'Tyre supplier', 3, false),
    (target_org_id, 'Other', 'Other supplier type', 99, true)
  ON CONFLICT (organization_id, name) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 5. UPDATED_AT TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_supplier_types_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_supplier_types_updated ON supplier_types;
CREATE TRIGGER trigger_supplier_types_updated
  BEFORE UPDATE ON supplier_types
  FOR EACH ROW EXECUTE FUNCTION update_supplier_types_timestamp();

-- =============================================================================
-- 6. SEED EXISTING ORGANIZATIONS
-- =============================================================================

DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    PERFORM seed_default_supplier_types(org_record.id);
  END LOOP;
END $$;

-- =============================================================================
-- DONE
-- =============================================================================
