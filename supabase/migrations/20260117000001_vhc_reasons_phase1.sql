-- =============================================================================
-- VHC Reasons Phase 1: Database Schema
-- Provides predefined reason lists when marking inspection items
-- =============================================================================

-- =============================================================================
-- 1. REASON CATEGORIES (Global reference table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS reason_categories (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  color VARCHAR(7),
  -- Which RAG statuses this category typically applies to
  typical_rag VARCHAR(10)  -- 'red', 'amber', 'green', or 'any'
);

-- Seed categories (including positive for green items)
INSERT INTO reason_categories (id, name, description, display_order, color, typical_rag) VALUES
  ('safety', 'Safety Critical', 'Issues that affect vehicle safety - must be addressed immediately', 1, '#DC2626', 'red'),
  ('wear', 'Wear Item', 'Components that wear over time and need periodic replacement', 2, '#F59E0B', 'amber'),
  ('maintenance', 'Maintenance', 'Routine maintenance items', 3, '#3B82F6', 'amber'),
  ('advisory', 'Advisory', 'Items to monitor - not urgent but worth noting', 4, '#6B7280', 'amber'),
  ('positive', 'Positive Finding', 'Item checked and in good condition', 5, '#10B981', 'green')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. ADD REASON_TYPE TO TEMPLATE_ITEMS
-- Groups similar items so they share the same reasons (tyre, brake_assembly, etc.)
-- =============================================================================

ALTER TABLE template_items ADD COLUMN IF NOT EXISTS reason_type VARCHAR(50);

COMMENT ON COLUMN template_items.reason_type IS
'Groups similar items so they share the same reasons. Examples:
- tyre: All 4 tyre items share tyre reasons
- brake_assembly: Front/Rear brakes share brake reasons
- wiper: Front/Rear wipers share wiper reasons
- fluid_level: Oil/Coolant/Brake Fluid share fluid reasons
- NULL: Unique items have their own specific reasons';

-- Add index for reason_type lookups
CREATE INDEX IF NOT EXISTS idx_template_items_reason_type ON template_items(reason_type) WHERE reason_type IS NOT NULL;

-- =============================================================================
-- 3. ADD REASON_TONE TO ORGANIZATION_SETTINGS
-- =============================================================================

ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS reason_tone VARCHAR(50) DEFAULT 'friendly';

COMMENT ON COLUMN organization_settings.reason_tone IS
'Controls the tone of AI-generated reason descriptions:
- premium: Formal, technical language suitable for dealerships
- friendly: Warm, reassuring language suitable for independent garages';

-- =============================================================================
-- 4. ITEM REASONS TABLE
-- Reasons per template item OR reason_type
-- =============================================================================

CREATE TABLE IF NOT EXISTS item_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Link to EITHER a specific item OR a reason type (not both)
  template_item_id UUID REFERENCES template_items(id) ON DELETE CASCADE,
  reason_type VARCHAR(50),

  -- Reason text (what tech sees and selects)
  reason_text VARCHAR(255) NOT NULL,

  -- Descriptions
  technical_description TEXT,  -- For advisor: detailed technical explanation
  customer_description TEXT,   -- For customer: simple, clear explanation

  -- RAG and category
  default_rag VARCHAR(10) DEFAULT 'amber',  -- 'red', 'amber', 'green'
  category_id VARCHAR(50) REFERENCES reason_categories(id),

  -- Follow-up suggestion (optional - tech can override)
  suggested_follow_up_days INTEGER,  -- e.g., 90 for "3 months"
  suggested_follow_up_text VARCHAR(255),  -- e.g., "Recommend checking at next service"

  -- AI tracking
  ai_generated BOOLEAN DEFAULT false,
  ai_reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,

  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  -- Approval tracking (aggregated from check_result_reasons)
  times_approved INTEGER DEFAULT 0,
  times_declined INTEGER DEFAULT 0,

  -- Starter template flag (for copying to new orgs)
  is_starter_template BOOLEAN DEFAULT false,

  -- Status & ordering
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),

  -- Must have either template_item_id OR reason_type
  CONSTRAINT check_reason_target CHECK (
    (template_item_id IS NOT NULL AND reason_type IS NULL) OR
    (template_item_id IS NULL AND reason_type IS NOT NULL)
  )
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_reasons_unique_per_item
  ON item_reasons(organization_id, template_item_id, reason_text)
  WHERE template_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_reasons_unique_per_type
  ON item_reasons(organization_id, reason_type, reason_text)
  WHERE reason_type IS NOT NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_item_reasons_template ON item_reasons(template_item_id) WHERE template_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_reasons_type ON item_reasons(reason_type) WHERE reason_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_reasons_org ON item_reasons(organization_id);
CREATE INDEX IF NOT EXISTS idx_item_reasons_category ON item_reasons(category_id);
CREATE INDEX IF NOT EXISTS idx_item_reasons_rag ON item_reasons(default_rag);
CREATE INDEX IF NOT EXISTS idx_item_reasons_usage ON item_reasons(organization_id, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_item_reasons_starter ON item_reasons(is_starter_template) WHERE is_starter_template = true;
CREATE INDEX IF NOT EXISTS idx_item_reasons_active ON item_reasons(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 5. REASON SUBMISSIONS TABLE
-- Custom reason submissions (tech suggestions → manager approval)
-- =============================================================================

CREATE TABLE IF NOT EXISTS reason_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- What the reason applies to
  template_item_id UUID REFERENCES template_items(id),
  reason_type VARCHAR(50),

  -- Submitted content
  submitted_reason_text VARCHAR(255) NOT NULL,
  submitted_notes TEXT,  -- Tech's explanation of why this should be added

  -- Context (which inspection triggered this)
  health_check_id UUID REFERENCES health_checks(id),
  check_result_id UUID REFERENCES check_results(id),
  submitted_by UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),

  -- Review workflow
  status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,  -- Reason for rejection, or notes on approval

  -- If approved, link to created reason
  approved_reason_id UUID REFERENCES item_reasons(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT check_submission_target CHECK (
    template_item_id IS NOT NULL OR reason_type IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_reason_submissions_org ON reason_submissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_reason_submissions_status ON reason_submissions(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_reason_submissions_pending ON reason_submissions(organization_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reason_submissions_submitted_by ON reason_submissions(submitted_by);

-- =============================================================================
-- 6. CHECK RESULT REASONS TABLE
-- Junction table: selected reasons per check result
-- =============================================================================

CREATE TABLE IF NOT EXISTS check_result_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_result_id UUID NOT NULL REFERENCES check_results(id) ON DELETE CASCADE,
  item_reason_id UUID NOT NULL REFERENCES item_reasons(id),

  -- Denormalized for analytics queries
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),  -- Tech who selected

  -- Allow override of descriptions per check
  technical_description_override TEXT,
  customer_description_override TEXT,

  -- Tech-selected follow-up (can differ from reason's suggestion)
  follow_up_days INTEGER,
  follow_up_text VARCHAR(255),

  -- Track if tech overrode the auto-RAG
  rag_overridden BOOLEAN DEFAULT false,

  -- Approval tracking (updated when customer responds)
  customer_approved BOOLEAN,  -- NULL = not yet responded, true/false = decision
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(check_result_id, item_reason_id)
);

CREATE INDEX IF NOT EXISTS idx_check_result_reasons_result ON check_result_reasons(check_result_id);
CREATE INDEX IF NOT EXISTS idx_check_result_reasons_reason ON check_result_reasons(item_reason_id);
CREATE INDEX IF NOT EXISTS idx_check_result_reasons_user ON check_result_reasons(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_result_reasons_org ON check_result_reasons(organization_id);
CREATE INDEX IF NOT EXISTS idx_check_result_reasons_approval ON check_result_reasons(item_reason_id, customer_approved) WHERE customer_approved IS NOT NULL;

-- =============================================================================
-- 7. ADD CUSTOM REASON FIELDS TO CHECK_RESULTS
-- =============================================================================

ALTER TABLE check_results ADD COLUMN IF NOT EXISTS custom_reason_text TEXT;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS custom_reason_submitted BOOLEAN DEFAULT false;

-- =============================================================================
-- 8. HELPER FUNCTIONS
-- =============================================================================

-- Get reasons for a template item (merges specific + type-based reasons)
CREATE OR REPLACE FUNCTION get_reasons_for_item(
  p_template_item_id UUID,
  p_organization_id UUID
)
RETURNS TABLE (
  id UUID,
  reason_text VARCHAR(255),
  technical_description TEXT,
  customer_description TEXT,
  default_rag VARCHAR(10),
  category_id VARCHAR(50),
  category_name VARCHAR(100),
  category_color VARCHAR(7),
  suggested_follow_up_days INTEGER,
  suggested_follow_up_text VARCHAR(255),
  usage_count INTEGER,
  approval_rate NUMERIC,
  source VARCHAR(20)  -- 'specific' or 'type'
) AS $$
DECLARE
  v_reason_type VARCHAR(50);
BEGIN
  -- Get the item's reason type
  SELECT ti.reason_type INTO v_reason_type
  FROM template_items ti
  WHERE ti.id = p_template_item_id;

  RETURN QUERY
  -- Specific reasons for this exact item
  SELECT
    ir.id,
    ir.reason_text,
    ir.technical_description,
    ir.customer_description,
    ir.default_rag,
    ir.category_id,
    rc.name as category_name,
    rc.color as category_color,
    ir.suggested_follow_up_days,
    ir.suggested_follow_up_text,
    ir.usage_count,
    CASE WHEN (ir.times_approved + ir.times_declined) > 0
      THEN ROUND(ir.times_approved::NUMERIC / (ir.times_approved + ir.times_declined) * 100, 1)
      ELSE NULL
    END as approval_rate,
    'specific'::VARCHAR(20) as source
  FROM item_reasons ir
  LEFT JOIN reason_categories rc ON rc.id = ir.category_id
  WHERE ir.template_item_id = p_template_item_id
    AND ir.organization_id = p_organization_id
    AND ir.is_active = true

  UNION ALL

  -- Type-based reasons (only if item has a reason type)
  SELECT
    ir.id,
    ir.reason_text,
    ir.technical_description,
    ir.customer_description,
    ir.default_rag,
    ir.category_id,
    rc.name as category_name,
    rc.color as category_color,
    ir.suggested_follow_up_days,
    ir.suggested_follow_up_text,
    ir.usage_count,
    CASE WHEN (ir.times_approved + ir.times_declined) > 0
      THEN ROUND(ir.times_approved::NUMERIC / (ir.times_approved + ir.times_declined) * 100, 1)
      ELSE NULL
    END as approval_rate,
    'type'::VARCHAR(20) as source
  FROM item_reasons ir
  LEFT JOIN reason_categories rc ON rc.id = ir.category_id
  WHERE ir.reason_type = v_reason_type
    AND v_reason_type IS NOT NULL
    AND ir.organization_id = p_organization_id
    AND ir.is_active = true
    -- Exclude if there's a specific reason with same text (specific overrides type)
    AND NOT EXISTS (
      SELECT 1 FROM item_reasons ir2
      WHERE ir2.template_item_id = p_template_item_id
        AND ir2.organization_id = p_organization_id
        AND ir2.reason_text = ir.reason_text
        AND ir2.is_active = true
    )

  ORDER BY default_rag DESC, usage_count DESC NULLS LAST, reason_text;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- 9. TRIGGERS
-- =============================================================================

-- Increment usage count when reason is selected
CREATE OR REPLACE FUNCTION increment_reason_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE item_reasons
  SET usage_count = usage_count + 1,
      last_used_at = NOW(),
      updated_at = NOW()
  WHERE id = NEW.item_reason_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_increment_reason_usage ON check_result_reasons;
CREATE TRIGGER trigger_increment_reason_usage
  AFTER INSERT ON check_result_reasons
  FOR EACH ROW EXECUTE FUNCTION increment_reason_usage();

-- Update approval stats when customer responds
CREATE OR REPLACE FUNCTION update_reason_approval_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_approved IS NOT NULL AND (OLD.customer_approved IS NULL OR OLD.customer_approved != NEW.customer_approved) THEN
    -- First decrement old value if it was set
    IF OLD.customer_approved IS NOT NULL THEN
      IF OLD.customer_approved = true THEN
        UPDATE item_reasons SET times_approved = GREATEST(0, times_approved - 1), updated_at = NOW() WHERE id = NEW.item_reason_id;
      ELSE
        UPDATE item_reasons SET times_declined = GREATEST(0, times_declined - 1), updated_at = NOW() WHERE id = NEW.item_reason_id;
      END IF;
    END IF;

    -- Then increment new value
    IF NEW.customer_approved = true THEN
      UPDATE item_reasons SET times_approved = times_approved + 1, updated_at = NOW() WHERE id = NEW.item_reason_id;
    ELSE
      UPDATE item_reasons SET times_declined = times_declined + 1, updated_at = NOW() WHERE id = NEW.item_reason_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_approval_stats ON check_result_reasons;
CREATE TRIGGER trigger_update_approval_stats
  AFTER UPDATE OF customer_approved ON check_result_reasons
  FOR EACH ROW EXECUTE FUNCTION update_reason_approval_stats();

-- Update item_reasons updated_at on any change
CREATE OR REPLACE FUNCTION update_item_reasons_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_item_reasons_updated ON item_reasons;
CREATE TRIGGER trigger_item_reasons_updated
  BEFORE UPDATE ON item_reasons
  FOR EACH ROW EXECUTE FUNCTION update_item_reasons_timestamp();

-- =============================================================================
-- 10. COPY STARTER REASONS FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION copy_starter_reasons_to_org(
  target_org_id UUID,
  source_org_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  copied_count INTEGER := 0;
BEGIN
  INSERT INTO item_reasons (
    organization_id, template_item_id, reason_type, reason_text,
    technical_description, customer_description,
    default_rag, category_id,
    suggested_follow_up_days, suggested_follow_up_text,
    ai_generated, ai_reviewed,
    is_active, sort_order
  )
  SELECT
    target_org_id, NULL, reason_type, reason_text,  -- Use reason_type, not template_item_id
    technical_description, customer_description,
    default_rag, category_id,
    suggested_follow_up_days, suggested_follow_up_text,
    ai_generated, true,  -- Mark as reviewed
    is_active, sort_order
  FROM item_reasons
  WHERE is_starter_template = true
    AND reason_type IS NOT NULL  -- Only copy type-based reasons
    AND (source_org_id IS NULL OR organization_id = source_org_id)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS copied_count = ROW_COUNT;
  RETURN copied_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 11. RLS POLICIES
-- =============================================================================

-- reason_categories: Everyone can read
ALTER TABLE reason_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view reason categories" ON reason_categories;
CREATE POLICY "Anyone can view reason categories" ON reason_categories
  FOR SELECT USING (true);

-- item_reasons: Org members can read, managers can write
ALTER TABLE item_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view reasons" ON item_reasons;
CREATE POLICY "Org members can view reasons" ON item_reasons
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Managers can insert reasons" ON item_reasons;
CREATE POLICY "Managers can insert reasons" ON item_reasons
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Managers can update reasons" ON item_reasons;
CREATE POLICY "Managers can update reasons" ON item_reasons
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Managers can delete reasons" ON item_reasons;
CREATE POLICY "Managers can delete reasons" ON item_reasons
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- reason_submissions: Tech can submit, managers can review
ALTER TABLE reason_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view submissions" ON reason_submissions;
CREATE POLICY "Org members can view submissions" ON reason_submissions
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Techs can create submissions" ON reason_submissions;
CREATE POLICY "Techs can create submissions" ON reason_submissions
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Managers can update submissions" ON reason_submissions;
CREATE POLICY "Managers can update submissions" ON reason_submissions
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- check_result_reasons: Based on org access
ALTER TABLE check_result_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view check result reasons" ON check_result_reasons;
CREATE POLICY "Org members can view check result reasons" ON check_result_reasons
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Org members can insert check result reasons" ON check_result_reasons;
CREATE POLICY "Org members can insert check result reasons" ON check_result_reasons
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Org members can update check result reasons" ON check_result_reasons;
CREATE POLICY "Org members can update check result reasons" ON check_result_reasons
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Org members can delete check result reasons" ON check_result_reasons;
CREATE POLICY "Org members can delete check result reasons" ON check_result_reasons
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- =============================================================================
-- 12. SEED STANDARD REASON TYPES
-- Update existing template items with reason_type based on their names
-- =============================================================================

-- This updates template items across ALL organizations
-- Tyres
UPDATE template_items SET reason_type = 'tyre'
WHERE LOWER(name) LIKE '%tyre%'
  OR LOWER(name) LIKE '%tire%'
  AND reason_type IS NULL;

-- Brake assemblies (full brake systems)
UPDATE template_items SET reason_type = 'brake_assembly'
WHERE (LOWER(name) LIKE '%brake%' AND LOWER(name) NOT LIKE '%disc%' AND LOWER(name) NOT LIKE '%pad%' AND LOWER(name) NOT LIKE '%fluid%')
  AND reason_type IS NULL;

-- Brake discs
UPDATE template_items SET reason_type = 'brake_disc'
WHERE LOWER(name) LIKE '%brake%disc%' OR LOWER(name) LIKE '%disc%brake%'
  AND reason_type IS NULL;

-- Brake pads
UPDATE template_items SET reason_type = 'brake_pad'
WHERE LOWER(name) LIKE '%brake%pad%' OR LOWER(name) LIKE '%pad%'
  AND reason_type IS NULL;

-- Wipers
UPDATE template_items SET reason_type = 'wiper'
WHERE LOWER(name) LIKE '%wiper%'
  AND reason_type IS NULL;

-- Shock absorbers
UPDATE template_items SET reason_type = 'shock_absorber'
WHERE LOWER(name) LIKE '%shock%' OR LOWER(name) LIKE '%damper%' OR LOWER(name) LIKE '%strut%'
  AND reason_type IS NULL;

-- Fluid levels
UPDATE template_items SET reason_type = 'fluid_level'
WHERE LOWER(name) LIKE '%fluid%' OR LOWER(name) LIKE '%oil level%' OR LOWER(name) LIKE '%coolant%' OR LOWER(name) LIKE '%washer%'
  AND reason_type IS NULL;

-- Light clusters
UPDATE template_items SET reason_type = 'light_cluster'
WHERE LOWER(name) LIKE '%light%' OR LOWER(name) LIKE '%headlight%' OR LOWER(name) LIKE '%indicator%' OR LOWER(name) LIKE '%lamp%'
  AND reason_type IS NULL;

-- Seat belts
UPDATE template_items SET reason_type = 'seat_belt'
WHERE LOWER(name) LIKE '%seat%belt%' OR LOWER(name) LIKE '%seatbelt%'
  AND reason_type IS NULL;

-- Suspension arms
UPDATE template_items SET reason_type = 'suspension_arm'
WHERE LOWER(name) LIKE '%wishbone%' OR LOWER(name) LIKE '%control arm%' OR LOWER(name) LIKE '%suspension arm%'
  AND reason_type IS NULL;

-- CV boots
UPDATE template_items SET reason_type = 'cv_boot'
WHERE LOWER(name) LIKE '%cv%boot%' OR LOWER(name) LIKE '%cv joint%' OR LOWER(name) LIKE '%drive shaft boot%'
  AND reason_type IS NULL;

-- Mirrors
UPDATE template_items SET reason_type = 'mirror'
WHERE LOWER(name) LIKE '%mirror%'
  AND reason_type IS NULL;

-- Horn
UPDATE template_items SET reason_type = 'horn'
WHERE LOWER(name) LIKE '%horn%'
  AND reason_type IS NULL;

-- Exhaust
UPDATE template_items SET reason_type = 'exhaust'
WHERE LOWER(name) LIKE '%exhaust%'
  AND reason_type IS NULL;

-- Steering
UPDATE template_items SET reason_type = 'steering'
WHERE LOWER(name) LIKE '%steering%'
  AND reason_type IS NULL;

-- =============================================================================
-- DONE
-- =============================================================================
