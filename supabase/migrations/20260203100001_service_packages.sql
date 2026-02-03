-- =============================================================================
-- Service Packages Feature
-- =============================================================================
-- Pre-built packages of labour + parts that can be applied to repair items.
-- =============================================================================

-- =============================================================================
-- 1. SERVICE PACKAGES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_service_packages_org ON service_packages(organization_id);
CREATE INDEX IF NOT EXISTS idx_service_packages_active ON service_packages(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 2. SERVICE PACKAGE LABOUR TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_package_labour (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_package_id UUID NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,

  labour_code_id UUID NOT NULL REFERENCES labour_codes(id) ON DELETE CASCADE,
  hours DECIMAL(10,2) NOT NULL DEFAULT 1,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  is_vat_exempt BOOLEAN DEFAULT false,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_package_labour_package ON service_package_labour(service_package_id);
CREATE INDEX IF NOT EXISTS idx_service_package_labour_code ON service_package_labour(labour_code_id);

-- =============================================================================
-- 3. SERVICE PACKAGE PARTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_package_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_package_id UUID NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,

  part_number VARCHAR(100),
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name VARCHAR(255),
  cost_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  sell_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_package_parts_package ON service_package_parts(service_package_id);
CREATE INDEX IF NOT EXISTS idx_service_package_parts_supplier ON service_package_parts(supplier_id);

-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE service_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_package_labour ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_package_parts ENABLE ROW LEVEL SECURITY;

-- Service packages: direct org check
CREATE POLICY service_packages_select ON service_packages
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY service_packages_insert ON service_packages
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY service_packages_update ON service_packages
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY service_packages_delete ON service_packages
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Service package labour: EXISTS subquery on parent
CREATE POLICY service_package_labour_select ON service_package_labour
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM service_packages sp
      WHERE sp.id = service_package_labour.service_package_id
      AND sp.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY service_package_labour_insert ON service_package_labour
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM service_packages sp
      WHERE sp.id = service_package_labour.service_package_id
      AND sp.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY service_package_labour_update ON service_package_labour
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM service_packages sp
      WHERE sp.id = service_package_labour.service_package_id
      AND sp.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY service_package_labour_delete ON service_package_labour
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM service_packages sp
      WHERE sp.id = service_package_labour.service_package_id
      AND sp.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

-- Service package parts: EXISTS subquery on parent
CREATE POLICY service_package_parts_select ON service_package_parts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM service_packages sp
      WHERE sp.id = service_package_parts.service_package_id
      AND sp.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY service_package_parts_insert ON service_package_parts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM service_packages sp
      WHERE sp.id = service_package_parts.service_package_id
      AND sp.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY service_package_parts_update ON service_package_parts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM service_packages sp
      WHERE sp.id = service_package_parts.service_package_id
      AND sp.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY service_package_parts_delete ON service_package_parts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM service_packages sp
      WHERE sp.id = service_package_parts.service_package_id
      AND sp.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );
