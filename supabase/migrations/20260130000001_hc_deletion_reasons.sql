-- =============================================================================
-- Health Check Deletion Reasons
-- Configurable reasons for deleting health checks (separate from repair item deletion reasons)
-- =============================================================================

-- =============================================================================
-- 1. HC DELETION REASONS TABLE (per organization)
-- =============================================================================

CREATE TABLE IF NOT EXISTS hc_deletion_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  reason VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_hc_deletion_reasons_org ON hc_deletion_reasons(organization_id);
CREATE INDEX IF NOT EXISTS idx_hc_deletion_reasons_active ON hc_deletion_reasons(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 2. ADD HC DELETION REASON FK TO HEALTH_CHECKS
-- =============================================================================

ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS hc_deletion_reason_id UUID REFERENCES hc_deletion_reasons(id);

-- =============================================================================
-- 3. UPDATE TIMESTAMPS TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_hc_deletion_reasons_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hc_deletion_reasons_updated ON hc_deletion_reasons;
CREATE TRIGGER trigger_hc_deletion_reasons_updated
  BEFORE UPDATE ON hc_deletion_reasons
  FOR EACH ROW EXECUTE FUNCTION update_hc_deletion_reasons_timestamp();

-- =============================================================================
-- 4. SEED DEFAULT HC DELETION REASONS FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_hc_deletion_reasons_for_org(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hc_deletion_reasons WHERE organization_id = p_organization_id) THEN
    INSERT INTO hc_deletion_reasons (organization_id, reason, sort_order, is_system) VALUES
      (p_organization_id, 'Customer no show', 1, false),
      (p_organization_id, 'Not enough time', 2, false),
      (p_organization_id, 'Not required', 3, false),
      (p_organization_id, 'Customer declined inspection', 4, false),
      (p_organization_id, 'Vehicle issue', 5, false),
      (p_organization_id, 'Duplicate booking', 6, false),
      (p_organization_id, 'Other', 99, true)
    ON CONFLICT (organization_id, reason) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 5. RLS POLICIES
-- =============================================================================

ALTER TABLE hc_deletion_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view hc deletion reasons" ON hc_deletion_reasons;
CREATE POLICY "Org members can view hc deletion reasons" ON hc_deletion_reasons
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can insert hc deletion reasons" ON hc_deletion_reasons;
CREATE POLICY "Admins can insert hc deletion reasons" ON hc_deletion_reasons
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can update hc deletion reasons" ON hc_deletion_reasons;
CREATE POLICY "Admins can update hc deletion reasons" ON hc_deletion_reasons
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can delete hc deletion reasons" ON hc_deletion_reasons;
CREATE POLICY "Admins can delete hc deletion reasons" ON hc_deletion_reasons
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- =============================================================================
-- 6. SEED FOR ALL EXISTING ORGANIZATIONS
-- =============================================================================

DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations
  LOOP
    PERFORM seed_hc_deletion_reasons_for_org(org_record.id);
  END LOOP;
END;
$$;

-- =============================================================================
-- DONE
-- =============================================================================
