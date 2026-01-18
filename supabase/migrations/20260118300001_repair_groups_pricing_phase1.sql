-- =============================================================================
-- Repair Groups & Pricing System - Phase 1: Database & Settings
-- =============================================================================
-- This migration creates the comprehensive repair groups and pricing schema
-- including labour codes, suppliers, repair items with options, and pricing
-- calculations.
-- =============================================================================

-- =============================================================================
-- 1. LABOUR CODES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS labour_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  code VARCHAR(20) NOT NULL,           -- 'LAB', 'DIAG', 'MOT'
  description VARCHAR(255) NOT NULL,   -- 'Standard Labour', 'Diagnostic', 'MOT Labour'
  hourly_rate DECIMAL(10,2) NOT NULL,  -- 85.00
  is_vat_exempt BOOLEAN DEFAULT false, -- true for MOT
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,    -- Default selection
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_labour_codes_org ON labour_codes(organization_id);
CREATE INDEX IF NOT EXISTS idx_labour_codes_active ON labour_codes(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 2. SUPPLIERS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,          -- 'GSF Car Parts'
  code VARCHAR(50),                    -- 'GSF' (optional short code)
  account_number VARCHAR(100),         -- Account reference (optional)
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  address TEXT,
  notes TEXT,

  is_active BOOLEAN DEFAULT true,
  is_quick_add BOOLEAN DEFAULT false,  -- true if added via quick-add (minimal data)
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(organization_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 3. ORGANIZATION PRICING SETTINGS
-- =============================================================================

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS default_margin_percent DECIMAL(5,2) DEFAULT 40.00;

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 20.00;

-- =============================================================================
-- 4. DROP OLD REPAIR_ITEMS AND RELATED TABLES
-- =============================================================================

-- First drop dependent tables
DROP TABLE IF EXISTS authorizations CASCADE;

-- Drop old repair_items table
DROP TABLE IF EXISTS repair_items CASCADE;

-- =============================================================================
-- 5. NEW REPAIR ITEMS TABLE (groups or individual)
-- =============================================================================

CREATE TABLE repair_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Repair details
  name VARCHAR(255) NOT NULL,          -- 'Front Brake Overhaul', 'Drive Belt Replacement'
  description TEXT,
  is_group BOOLEAN DEFAULT false,      -- true = group, false = individual

  -- Pricing (calculated or overridden)
  labour_total DECIMAL(10,2) DEFAULT 0,
  parts_total DECIMAL(10,2) DEFAULT 0,
  subtotal DECIMAL(10,2) DEFAULT 0,    -- labour + parts (ex VAT)
  vat_amount DECIMAL(10,2) DEFAULT 0,
  total_inc_vat DECIMAL(10,2) DEFAULT 0,

  -- Price override
  price_override DECIMAL(10,2),        -- If advisor manually sets price
  price_override_reason TEXT,

  -- Status tracking
  labour_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'in_progress', 'complete'
  parts_status VARCHAR(20) DEFAULT 'pending',   -- 'pending', 'in_progress', 'complete'
  quote_status VARCHAR(20) DEFAULT 'pending',   -- 'pending', 'ready'

  -- Customer response
  customer_approved BOOLEAN,           -- null = not responded, true/false = decision
  customer_approved_at TIMESTAMPTZ,
  customer_declined_reason TEXT,

  -- Selected repair option (if options exist)
  selected_option_id UUID,             -- References repair_options.id (added after repair_options created)

  -- Audit
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  labour_completed_by UUID REFERENCES users(id),
  labour_completed_at TIMESTAMPTZ,
  parts_completed_by UUID REFERENCES users(id),
  parts_completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_repair_items_hc ON repair_items(health_check_id);
CREATE INDEX IF NOT EXISTS idx_repair_items_org ON repair_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_repair_items_status ON repair_items(quote_status);

-- =============================================================================
-- 6. REPAIR ITEM CHECK RESULTS JUNCTION TABLE
-- =============================================================================

CREATE TABLE repair_item_check_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_item_id UUID NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,
  check_result_id UUID NOT NULL REFERENCES check_results(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(repair_item_id, check_result_id)
);

CREATE INDEX IF NOT EXISTS idx_repair_item_check_results_ri ON repair_item_check_results(repair_item_id);
CREATE INDEX IF NOT EXISTS idx_repair_item_check_results_cr ON repair_item_check_results(check_result_id);

-- =============================================================================
-- 7. REPAIR OPTIONS TABLE (alternatives like Standard vs Premium)
-- =============================================================================

CREATE TABLE repair_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_item_id UUID NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,          -- 'Standard', 'Premium', 'Budget'
  description TEXT,                    -- 'OEM quality parts'

  -- Pricing for this option
  labour_total DECIMAL(10,2) DEFAULT 0,
  parts_total DECIMAL(10,2) DEFAULT 0,
  subtotal DECIMAL(10,2) DEFAULT 0,
  vat_amount DECIMAL(10,2) DEFAULT 0,
  total_inc_vat DECIMAL(10,2) DEFAULT 0,

  is_recommended BOOLEAN DEFAULT false, -- Highlight as recommended option
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_options_ri ON repair_options(repair_item_id);

-- Now add the foreign key for selected_option_id
ALTER TABLE repair_items
  ADD CONSTRAINT fk_repair_items_selected_option
  FOREIGN KEY (selected_option_id) REFERENCES repair_options(id) ON DELETE SET NULL;

-- =============================================================================
-- 8. REPAIR LABOUR TABLE
-- =============================================================================

CREATE TABLE repair_labour (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_item_id UUID REFERENCES repair_items(id) ON DELETE CASCADE,
  repair_option_id UUID REFERENCES repair_options(id) ON DELETE CASCADE,

  labour_code_id UUID NOT NULL REFERENCES labour_codes(id),

  hours DECIMAL(5,2) NOT NULL,         -- 1.5
  rate DECIMAL(10,2) NOT NULL,         -- 85.00 (copied from labour_code at time of entry)
  total DECIMAL(10,2) NOT NULL,        -- 127.50
  is_vat_exempt BOOLEAN DEFAULT false, -- Copied from labour_code

  notes TEXT,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Must belong to either repair_item or repair_option
  CONSTRAINT check_labour_parent CHECK (
    (repair_item_id IS NOT NULL AND repair_option_id IS NULL) OR
    (repair_item_id IS NULL AND repair_option_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_repair_labour_ri ON repair_labour(repair_item_id);
CREATE INDEX IF NOT EXISTS idx_repair_labour_ro ON repair_labour(repair_option_id);
CREATE INDEX IF NOT EXISTS idx_repair_labour_code ON repair_labour(labour_code_id);

-- =============================================================================
-- 9. REPAIR PARTS TABLE
-- =============================================================================

CREATE TABLE repair_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_item_id UUID REFERENCES repair_items(id) ON DELETE CASCADE,
  repair_option_id UUID REFERENCES repair_options(id) ON DELETE CASCADE,

  part_number VARCHAR(100),            -- 'BRK-PAD-001'
  description VARCHAR(255) NOT NULL,   -- 'Front Brake Pads'
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,

  supplier_id UUID REFERENCES suppliers(id),
  supplier_name VARCHAR(255),          -- Denormalized for display

  cost_price DECIMAL(10,2) NOT NULL,   -- 25.00
  sell_price DECIMAL(10,2) NOT NULL,   -- 45.00
  line_total DECIMAL(10,2) NOT NULL,   -- qty x sell_price = 45.00

  margin_percent DECIMAL(5,2),         -- 44.44%
  markup_percent DECIMAL(5,2),         -- 80%

  notes TEXT,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Must belong to either repair_item or repair_option
  CONSTRAINT check_parts_parent CHECK (
    (repair_item_id IS NOT NULL AND repair_option_id IS NULL) OR
    (repair_item_id IS NULL AND repair_option_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_repair_parts_ri ON repair_parts(repair_item_id);
CREATE INDEX IF NOT EXISTS idx_repair_parts_ro ON repair_parts(repair_option_id);
CREATE INDEX IF NOT EXISTS idx_repair_parts_supplier ON repair_parts(supplier_id);

-- =============================================================================
-- 10. RECREATE AUTHORIZATIONS TABLE (with new repair_items reference)
-- =============================================================================

CREATE TABLE authorizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  repair_item_id UUID NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,

  decision VARCHAR(20) NOT NULL, -- 'approved', 'declined'
  decided_at TIMESTAMPTZ DEFAULT NOW(),

  -- Signature (for approved items)
  signature_data TEXT, -- Base64 or storage path
  signature_ip INET,
  signature_user_agent TEXT,

  -- Notes
  customer_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_authorizations_health_check ON authorizations(health_check_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_authorizations_unique ON authorizations(repair_item_id);

-- =============================================================================
-- 11. CALCULATE REPAIR ITEM TOTALS FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_repair_item_totals(p_repair_item_id UUID)
RETURNS void AS $$
DECLARE
  v_labour_total DECIMAL(10,2);
  v_labour_vat_exempt DECIMAL(10,2);
  v_parts_total DECIMAL(10,2);
  v_vat_rate DECIMAL(5,2);
  v_vat_amount DECIMAL(10,2);
  v_org_id UUID;
BEGIN
  -- Get org for VAT rate
  SELECT organization_id INTO v_org_id FROM repair_items WHERE id = p_repair_item_id;

  -- Get VAT rate from organization settings
  SELECT COALESCE(os.vat_rate, 20.00) INTO v_vat_rate
  FROM organization_settings os
  WHERE os.organization_id = v_org_id;

  -- Default to 20% if no settings exist
  IF v_vat_rate IS NULL THEN
    v_vat_rate := 20.00;
  END IF;

  -- Sum labour (separate VAT exempt)
  SELECT
    COALESCE(SUM(CASE WHEN NOT is_vat_exempt THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_vat_exempt THEN total ELSE 0 END), 0)
  INTO v_labour_total, v_labour_vat_exempt
  FROM repair_labour
  WHERE repair_item_id = p_repair_item_id;

  -- Sum parts
  SELECT COALESCE(SUM(line_total), 0) INTO v_parts_total
  FROM repair_parts
  WHERE repair_item_id = p_repair_item_id;

  -- Calculate VAT (only on VAT-able labour + parts)
  v_vat_amount := ROUND((v_labour_total + v_parts_total) * (v_vat_rate / 100), 2);

  -- Update repair item
  UPDATE repair_items SET
    labour_total = v_labour_total + v_labour_vat_exempt,
    parts_total = v_parts_total,
    subtotal = v_labour_total + v_labour_vat_exempt + v_parts_total,
    vat_amount = v_vat_amount,
    total_inc_vat = v_labour_total + v_labour_vat_exempt + v_parts_total + v_vat_amount,
    updated_at = NOW()
  WHERE id = p_repair_item_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 12. CALCULATE REPAIR OPTION TOTALS FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_repair_option_totals(p_repair_option_id UUID)
RETURNS void AS $$
DECLARE
  v_labour_total DECIMAL(10,2);
  v_labour_vat_exempt DECIMAL(10,2);
  v_parts_total DECIMAL(10,2);
  v_vat_rate DECIMAL(5,2);
  v_vat_amount DECIMAL(10,2);
  v_org_id UUID;
BEGIN
  -- Get org for VAT rate (via repair_item)
  SELECT ri.organization_id INTO v_org_id
  FROM repair_options ro
  JOIN repair_items ri ON ri.id = ro.repair_item_id
  WHERE ro.id = p_repair_option_id;

  -- Get VAT rate from organization settings
  SELECT COALESCE(os.vat_rate, 20.00) INTO v_vat_rate
  FROM organization_settings os
  WHERE os.organization_id = v_org_id;

  -- Default to 20% if no settings exist
  IF v_vat_rate IS NULL THEN
    v_vat_rate := 20.00;
  END IF;

  -- Sum labour (separate VAT exempt)
  SELECT
    COALESCE(SUM(CASE WHEN NOT is_vat_exempt THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_vat_exempt THEN total ELSE 0 END), 0)
  INTO v_labour_total, v_labour_vat_exempt
  FROM repair_labour
  WHERE repair_option_id = p_repair_option_id;

  -- Sum parts
  SELECT COALESCE(SUM(line_total), 0) INTO v_parts_total
  FROM repair_parts
  WHERE repair_option_id = p_repair_option_id;

  -- Calculate VAT (only on VAT-able labour + parts)
  v_vat_amount := ROUND((v_labour_total + v_parts_total) * (v_vat_rate / 100), 2);

  -- Update repair option
  UPDATE repair_options SET
    labour_total = v_labour_total + v_labour_vat_exempt,
    parts_total = v_parts_total,
    subtotal = v_labour_total + v_labour_vat_exempt + v_parts_total,
    vat_amount = v_vat_amount,
    total_inc_vat = v_labour_total + v_labour_vat_exempt + v_parts_total + v_vat_amount,
    updated_at = NOW()
  WHERE id = p_repair_option_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 13. AUTO-RECALCULATE TRIGGERS
-- =============================================================================

-- Trigger function for labour changes
CREATE OR REPLACE FUNCTION trigger_recalculate_repair_totals_labour()
RETURNS TRIGGER AS $$
DECLARE
  v_repair_item_id UUID;
  v_repair_option_id UUID;
BEGIN
  -- Handle DELETE case
  IF TG_OP = 'DELETE' THEN
    v_repair_item_id := OLD.repair_item_id;
    v_repair_option_id := OLD.repair_option_id;
  ELSE
    v_repair_item_id := NEW.repair_item_id;
    v_repair_option_id := NEW.repair_option_id;
  END IF;

  IF v_repair_item_id IS NOT NULL THEN
    PERFORM calculate_repair_item_totals(v_repair_item_id);
  END IF;
  IF v_repair_option_id IS NOT NULL THEN
    PERFORM calculate_repair_option_totals(v_repair_option_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for parts changes
CREATE OR REPLACE FUNCTION trigger_recalculate_repair_totals_parts()
RETURNS TRIGGER AS $$
DECLARE
  v_repair_item_id UUID;
  v_repair_option_id UUID;
BEGIN
  -- Handle DELETE case
  IF TG_OP = 'DELETE' THEN
    v_repair_item_id := OLD.repair_item_id;
    v_repair_option_id := OLD.repair_option_id;
  ELSE
    v_repair_item_id := NEW.repair_item_id;
    v_repair_option_id := NEW.repair_option_id;
  END IF;

  IF v_repair_item_id IS NOT NULL THEN
    PERFORM calculate_repair_item_totals(v_repair_item_id);
  END IF;
  IF v_repair_option_id IS NOT NULL THEN
    PERFORM calculate_repair_option_totals(v_repair_option_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER trigger_labour_recalc
  AFTER INSERT OR UPDATE OR DELETE ON repair_labour
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_repair_totals_labour();

CREATE TRIGGER trigger_parts_recalc
  AFTER INSERT OR UPDATE OR DELETE ON repair_parts
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_repair_totals_parts();

-- =============================================================================
-- 14. UPDATE REPAIR ITEM STATUS FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION update_repair_item_status(p_repair_item_id UUID)
RETURNS void AS $$
DECLARE
  v_has_labour BOOLEAN;
  v_has_parts BOOLEAN;
  v_has_options BOOLEAN;
  v_options_have_labour BOOLEAN;
  v_options_have_parts BOOLEAN;
BEGIN
  -- Check if repair item has direct labour/parts
  SELECT EXISTS(SELECT 1 FROM repair_labour WHERE repair_item_id = p_repair_item_id) INTO v_has_labour;
  SELECT EXISTS(SELECT 1 FROM repair_parts WHERE repair_item_id = p_repair_item_id) INTO v_has_parts;

  -- Check if repair item has options
  SELECT EXISTS(SELECT 1 FROM repair_options WHERE repair_item_id = p_repair_item_id) INTO v_has_options;

  IF v_has_options THEN
    -- Check if any option has labour/parts
    SELECT EXISTS(
      SELECT 1 FROM repair_labour rl
      JOIN repair_options ro ON ro.id = rl.repair_option_id
      WHERE ro.repair_item_id = p_repair_item_id
    ) INTO v_options_have_labour;

    SELECT EXISTS(
      SELECT 1 FROM repair_parts rp
      JOIN repair_options ro ON ro.id = rp.repair_option_id
      WHERE ro.repair_item_id = p_repair_item_id
    ) INTO v_options_have_parts;

    v_has_labour := v_has_labour OR v_options_have_labour;
    v_has_parts := v_has_parts OR v_options_have_parts;
  END IF;

  UPDATE repair_items SET
    labour_status = CASE WHEN v_has_labour THEN 'complete' ELSE 'pending' END,
    parts_status = CASE WHEN v_has_parts THEN 'complete' ELSE 'pending' END,
    quote_status = CASE WHEN v_has_labour OR v_has_parts THEN 'ready' ELSE 'pending' END,
    updated_at = NOW()
  WHERE id = p_repair_item_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update status on labour/parts changes
CREATE OR REPLACE FUNCTION trigger_update_repair_item_status_labour()
RETURNS TRIGGER AS $$
DECLARE
  v_repair_item_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_repair_item_id := OLD.repair_item_id;
    -- For options, get the parent repair_item_id
    IF v_repair_item_id IS NULL AND OLD.repair_option_id IS NOT NULL THEN
      SELECT repair_item_id INTO v_repair_item_id FROM repair_options WHERE id = OLD.repair_option_id;
    END IF;
  ELSE
    v_repair_item_id := NEW.repair_item_id;
    -- For options, get the parent repair_item_id
    IF v_repair_item_id IS NULL AND NEW.repair_option_id IS NOT NULL THEN
      SELECT repair_item_id INTO v_repair_item_id FROM repair_options WHERE id = NEW.repair_option_id;
    END IF;
  END IF;

  IF v_repair_item_id IS NOT NULL THEN
    PERFORM update_repair_item_status(v_repair_item_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_labour_status_update
  AFTER INSERT OR UPDATE OR DELETE ON repair_labour
  FOR EACH ROW EXECUTE FUNCTION trigger_update_repair_item_status_labour();

CREATE TRIGGER trigger_parts_status_update
  AFTER INSERT OR UPDATE OR DELETE ON repair_parts
  FOR EACH ROW EXECUTE FUNCTION trigger_update_repair_item_status_labour();

-- =============================================================================
-- 15. ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- Enable RLS on all new tables
ALTER TABLE labour_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_item_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_labour ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorizations ENABLE ROW LEVEL SECURITY;

-- Labour codes: Org members can read, admins can write
CREATE POLICY labour_codes_select ON labour_codes
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY labour_codes_insert ON labour_codes
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY labour_codes_update ON labour_codes
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY labour_codes_delete ON labour_codes
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Suppliers: Same pattern
CREATE POLICY suppliers_select ON suppliers
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY suppliers_insert ON suppliers
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY suppliers_update ON suppliers
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY suppliers_delete ON suppliers
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Repair items: Org members full access
CREATE POLICY repair_items_select ON repair_items
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY repair_items_insert ON repair_items
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY repair_items_update ON repair_items
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY repair_items_delete ON repair_items
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Repair item check results: Based on repair_item's org
CREATE POLICY repair_item_check_results_select ON repair_item_check_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_item_check_results.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY repair_item_check_results_insert ON repair_item_check_results
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_item_check_results.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY repair_item_check_results_delete ON repair_item_check_results
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_item_check_results.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

-- Repair options: Based on repair_item's org
CREATE POLICY repair_options_select ON repair_options
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_options.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY repair_options_insert ON repair_options
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_options.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY repair_options_update ON repair_options
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_options.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY repair_options_delete ON repair_options
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_options.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

-- Repair labour: Based on repair_item or repair_option's org
CREATE POLICY repair_labour_select ON repair_labour
  FOR SELECT USING (
    (repair_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_labour.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
    OR
    (repair_option_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_options ro
      JOIN repair_items ri ON ri.id = ro.repair_item_id
      WHERE ro.id = repair_labour.repair_option_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
  );

CREATE POLICY repair_labour_insert ON repair_labour
  FOR INSERT WITH CHECK (
    (repair_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_labour.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
    OR
    (repair_option_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_options ro
      JOIN repair_items ri ON ri.id = ro.repair_item_id
      WHERE ro.id = repair_labour.repair_option_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
  );

CREATE POLICY repair_labour_update ON repair_labour
  FOR UPDATE USING (
    (repair_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_labour.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
    OR
    (repair_option_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_options ro
      JOIN repair_items ri ON ri.id = ro.repair_item_id
      WHERE ro.id = repair_labour.repair_option_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
  );

CREATE POLICY repair_labour_delete ON repair_labour
  FOR DELETE USING (
    (repair_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_labour.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
    OR
    (repair_option_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_options ro
      JOIN repair_items ri ON ri.id = ro.repair_item_id
      WHERE ro.id = repair_labour.repair_option_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
  );

-- Repair parts: Based on repair_item or repair_option's org
CREATE POLICY repair_parts_select ON repair_parts
  FOR SELECT USING (
    (repair_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_parts.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
    OR
    (repair_option_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_options ro
      JOIN repair_items ri ON ri.id = ro.repair_item_id
      WHERE ro.id = repair_parts.repair_option_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
  );

CREATE POLICY repair_parts_insert ON repair_parts
  FOR INSERT WITH CHECK (
    (repair_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_parts.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
    OR
    (repair_option_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_options ro
      JOIN repair_items ri ON ri.id = ro.repair_item_id
      WHERE ro.id = repair_parts.repair_option_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
  );

CREATE POLICY repair_parts_update ON repair_parts
  FOR UPDATE USING (
    (repair_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_parts.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
    OR
    (repair_option_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_options ro
      JOIN repair_items ri ON ri.id = ro.repair_item_id
      WHERE ro.id = repair_parts.repair_option_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
  );

CREATE POLICY repair_parts_delete ON repair_parts
  FOR DELETE USING (
    (repair_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_items ri
      WHERE ri.id = repair_parts.repair_item_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
    OR
    (repair_option_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM repair_options ro
      JOIN repair_items ri ON ri.id = ro.repair_item_id
      WHERE ro.id = repair_parts.repair_option_id
      AND ri.organization_id = current_setting('app.current_org_id', true)::uuid
    ))
  );

-- Authorizations: Based on health_check's org
CREATE POLICY authorizations_select ON authorizations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM health_checks hc
      WHERE hc.id = authorizations.health_check_id
      AND hc.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY authorizations_insert ON authorizations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM health_checks hc
      WHERE hc.id = authorizations.health_check_id
      AND hc.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY authorizations_update ON authorizations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM health_checks hc
      WHERE hc.id = authorizations.health_check_id
      AND hc.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

CREATE POLICY authorizations_delete ON authorizations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM health_checks hc
      WHERE hc.id = authorizations.health_check_id
      AND hc.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

-- =============================================================================
-- 16. SEED DEFAULT LABOUR CODES FUNCTION
-- =============================================================================

-- Function to seed default labour codes for a new organization
CREATE OR REPLACE FUNCTION seed_default_labour_codes(p_organization_id UUID)
RETURNS void AS $$
BEGIN
  -- Only seed if no labour codes exist for this org
  IF NOT EXISTS (SELECT 1 FROM labour_codes WHERE organization_id = p_organization_id) THEN
    INSERT INTO labour_codes (organization_id, code, description, hourly_rate, is_vat_exempt, is_default, sort_order)
    VALUES
      (p_organization_id, 'LAB', 'Standard Labour', 85.00, false, true, 1),
      (p_organization_id, 'DIAG', 'Diagnostic', 95.00, false, false, 2),
      (p_organization_id, 'MOT', 'MOT Labour', 45.00, true, false, 3);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-seed labour codes when organization_settings is created
CREATE OR REPLACE FUNCTION trigger_seed_labour_codes_on_org_settings()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_default_labour_codes(NEW.organization_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_org_settings_seed_labour_codes
  AFTER INSERT ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_seed_labour_codes_on_org_settings();

-- Also create a trigger on organizations table for orgs created without settings
CREATE OR REPLACE FUNCTION trigger_seed_labour_codes_on_org()
RETURNS TRIGGER AS $$
BEGIN
  -- Delay seeding slightly to allow organization_settings to be created first
  -- If org_settings already triggers it, this will be a no-op due to the EXISTS check
  PERFORM seed_default_labour_codes(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_org_seed_labour_codes
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION trigger_seed_labour_codes_on_org();

-- =============================================================================
-- 17. SEED EXISTING ORGANIZATIONS WITH DEFAULT LABOUR CODES
-- =============================================================================

-- Seed labour codes for any existing organizations that don't have them
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    PERFORM seed_default_labour_codes(org_record.id);
  END LOOP;
END $$;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
