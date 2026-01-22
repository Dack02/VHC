-- =============================================================================
-- Repair Item Outcome Tracking - Phase 1: Database Schema
-- Adds declined_reasons, deleted_reasons tables and outcome columns to repair_items
-- =============================================================================

-- =============================================================================
-- 1. DECLINED REASONS TABLE (per organization)
-- =============================================================================

CREATE TABLE IF NOT EXISTS declined_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  reason VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,  -- System defaults can't be deleted
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_declined_reasons_org ON declined_reasons(organization_id);
CREATE INDEX IF NOT EXISTS idx_declined_reasons_active ON declined_reasons(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 2. DELETED REASONS TABLE (per organization)
-- =============================================================================

CREATE TABLE IF NOT EXISTS deleted_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  reason VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,  -- System defaults can't be deleted
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_deleted_reasons_org ON deleted_reasons(organization_id);
CREATE INDEX IF NOT EXISTS idx_deleted_reasons_active ON deleted_reasons(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 3. ADD OUTCOME COLUMNS TO REPAIR_ITEMS TABLE
-- =============================================================================

-- Outcome tracking fields
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS outcome_status VARCHAR(20) DEFAULT 'incomplete';
  -- Values: 'incomplete', 'ready', 'authorised', 'deferred', 'declined', 'deleted'

ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS outcome_set_by UUID REFERENCES users(id);
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS outcome_set_at TIMESTAMPTZ;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS outcome_source VARCHAR(20);
  -- Values: 'manual', 'online'

-- Deferred fields
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deferred_until DATE;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deferred_notes TEXT;

-- Declined fields
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS declined_reason_id UUID REFERENCES declined_reasons(id);
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS declined_notes TEXT;

-- Deleted fields (soft delete with reason)
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deleted_reason_id UUID REFERENCES deleted_reasons(id);
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deleted_notes TEXT;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- Index for outcome queries
CREATE INDEX IF NOT EXISTS idx_repair_items_outcome ON repair_items(outcome_status);
CREATE INDEX IF NOT EXISTS idx_repair_items_deleted ON repair_items(deleted_at) WHERE deleted_at IS NOT NULL;

-- =============================================================================
-- 4. UPDATE TIMESTAMPS TRIGGER FOR DECLINED_REASONS
-- =============================================================================

CREATE OR REPLACE FUNCTION update_declined_reasons_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_declined_reasons_updated ON declined_reasons;
CREATE TRIGGER trigger_declined_reasons_updated
  BEFORE UPDATE ON declined_reasons
  FOR EACH ROW EXECUTE FUNCTION update_declined_reasons_timestamp();

-- =============================================================================
-- 5. UPDATE TIMESTAMPS TRIGGER FOR DELETED_REASONS
-- =============================================================================

CREATE OR REPLACE FUNCTION update_deleted_reasons_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_deleted_reasons_updated ON deleted_reasons;
CREATE TRIGGER trigger_deleted_reasons_updated
  BEFORE UPDATE ON deleted_reasons
  FOR EACH ROW EXECUTE FUNCTION update_deleted_reasons_timestamp();

-- =============================================================================
-- 6. SEED DEFAULT REASONS FUNCTION
-- Seeds default declined and deleted reasons for an organization
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_outcome_reasons_for_org(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Seed declined reasons (only if none exist for org)
  IF NOT EXISTS (SELECT 1 FROM declined_reasons WHERE organization_id = p_organization_id) THEN
    INSERT INTO declined_reasons (organization_id, reason, sort_order, is_system) VALUES
      (p_organization_id, 'Too expensive', 1, false),
      (p_organization_id, 'Will do elsewhere', 2, false),
      (p_organization_id, 'Not needed right now', 3, false),
      (p_organization_id, 'Getting second opinion', 4, false),
      (p_organization_id, 'Vehicle being sold/scrapped', 5, false),
      (p_organization_id, 'Already arranged with another garage', 6, false),
      (p_organization_id, 'Other', 99, true)  -- is_system = true, cannot be deleted
    ON CONFLICT (organization_id, reason) DO NOTHING;
  END IF;

  -- Seed deleted reasons (only if none exist for org)
  IF NOT EXISTS (SELECT 1 FROM deleted_reasons WHERE organization_id = p_organization_id) THEN
    INSERT INTO deleted_reasons (organization_id, reason, sort_order, is_system) VALUES
      (p_organization_id, 'Added in error', 1, false),
      (p_organization_id, 'Duplicate entry', 2, false),
      (p_organization_id, 'Customer requested removal before quote', 3, false),
      (p_organization_id, 'Other', 99, true)  -- is_system = true, cannot be deleted
    ON CONFLICT (organization_id, reason) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 7. RLS POLICIES
-- =============================================================================

-- declined_reasons: Org members can read, admins can write
ALTER TABLE declined_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view declined reasons" ON declined_reasons;
CREATE POLICY "Org members can view declined reasons" ON declined_reasons
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can insert declined reasons" ON declined_reasons;
CREATE POLICY "Admins can insert declined reasons" ON declined_reasons
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can update declined reasons" ON declined_reasons;
CREATE POLICY "Admins can update declined reasons" ON declined_reasons
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can delete declined reasons" ON declined_reasons;
CREATE POLICY "Admins can delete declined reasons" ON declined_reasons
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- deleted_reasons: Org members can read, admins can write
ALTER TABLE deleted_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view deleted reasons" ON deleted_reasons;
CREATE POLICY "Org members can view deleted reasons" ON deleted_reasons
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can insert deleted reasons" ON deleted_reasons;
CREATE POLICY "Admins can insert deleted reasons" ON deleted_reasons
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can update deleted reasons" ON deleted_reasons;
CREATE POLICY "Admins can update deleted reasons" ON deleted_reasons
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Admins can delete deleted reasons" ON deleted_reasons;
CREATE POLICY "Admins can delete deleted reasons" ON deleted_reasons
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- =============================================================================
-- 8. SEED REASONS FOR ALL EXISTING ORGANIZATIONS
-- =============================================================================

DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations
  LOOP
    PERFORM seed_outcome_reasons_for_org(org_record.id);
  END LOOP;
END;
$$;

-- =============================================================================
-- DONE
-- =============================================================================
