-- ============================================================================
-- Workshop Management Board
-- Kanban board for workshop control: Due In → Checked In → technician columns
-- → custom queue columns (Awaiting Parts, Valeting...) → Work Complete.
--
-- Position model ("auto with manual override"):
--   - Due In / Checked In / technician columns are DERIVED from health_checks
--     (status, technician_id) so cards move themselves as the VHC pipeline runs.
--   - workshop_cards holds per-card board metadata and the manual overrides:
--     placement 'queue' (sits in a queue column) or 'work_complete'.
--   - placement 'auto' (default) = derive position from the health check.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Configurable operational statuses (card flags, org-scoped)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshop_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  colour VARCHAR(7) NOT NULL DEFAULT '#6366F1',
  icon VARCHAR(50),
  -- Optional SMS template. When set, applying this status prompts the advisor
  -- (always with a confirmation popup) to send this message to the customer.
  -- Placeholders: {customer_name} {registration} {site_name} {org_name}
  sms_message TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workshop_statuses_org
  ON workshop_statuses(organization_id, is_active, sort_order);

-- ----------------------------------------------------------------------------
-- Board columns per site: technician columns + custom queue columns
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshop_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  column_type VARCHAR(20) NOT NULL DEFAULT 'technician'
    CHECK (column_type IN ('technician', 'queue')),
  technician_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- technician columns
  name VARCHAR(60),                                           -- queue columns
  colour VARCHAR(7),                                          -- queue header accent
  available_hours DECIMAL(4,1) NOT NULL DEFAULT 8.0,          -- technician capacity
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (column_type = 'technician' AND technician_id IS NOT NULL)
    OR (column_type = 'queue' AND name IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_workshop_columns_tech
  ON workshop_columns(site_id, technician_id)
  WHERE technician_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workshop_columns_site
  ON workshop_columns(site_id, sort_order);

-- ----------------------------------------------------------------------------
-- Per-card board metadata + manual placement overrides
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshop_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  placement VARCHAR(20) NOT NULL DEFAULT 'auto'
    CHECK (placement IN ('auto', 'queue', 'work_complete')),
  queue_column_id UUID REFERENCES workshop_columns(id) ON DELETE SET NULL,
  sort_position INTEGER NOT NULL DEFAULT 0,
  workshop_status_id UUID REFERENCES workshop_statuses(id) ON DELETE SET NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'high', 'urgent')),
  estimated_hours DECIMAL(5,2),
  work_completed_at TIMESTAMPTZ,
  work_completed_by UUID REFERENCES users(id),
  placed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(health_check_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_cards_org
  ON workshop_cards(organization_id);
CREATE INDEX IF NOT EXISTS idx_workshop_cards_hc
  ON workshop_cards(health_check_id);

-- ----------------------------------------------------------------------------
-- Card notes (append-only operational log)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshop_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workshop_notes_hc
  ON workshop_notes(health_check_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- Board configuration per site
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshop_board_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  default_tech_hours DECIMAL(4,1) NOT NULL DEFAULT 8.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, site_id)
);

-- ----------------------------------------------------------------------------
-- Auto-sync: when a technician actually starts work (clock-in moves the job to
-- in_progress), pull the card out of any manual queue/work-complete placement
-- so it snaps back to the technician's column in real time.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workshop_card_auto_sync()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    UPDATE workshop_cards
    SET placement = 'auto',
        queue_column_id = NULL,
        work_completed_at = NULL,
        work_completed_by = NULL,
        updated_at = NOW()
    WHERE health_check_id = NEW.id
      AND placement IN ('queue', 'work_complete');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workshop_card_auto_sync ON health_checks;
CREATE TRIGGER trg_workshop_card_auto_sync
  AFTER UPDATE OF status ON health_checks
  FOR EACH ROW
  EXECUTE FUNCTION workshop_card_auto_sync();

-- ----------------------------------------------------------------------------
-- RLS (API uses service role; policies are defence in depth, matching existing
-- convention from organization_message_templates)
-- ----------------------------------------------------------------------------
ALTER TABLE workshop_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_board_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own org workshop statuses" ON workshop_statuses;
CREATE POLICY "Users can view own org workshop statuses"
  ON workshop_statuses FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own org workshop columns" ON workshop_columns;
CREATE POLICY "Users can view own org workshop columns"
  ON workshop_columns FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own org workshop cards" ON workshop_cards;
CREATE POLICY "Users can view own org workshop cards"
  ON workshop_cards FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own org workshop notes" ON workshop_notes;
CREATE POLICY "Users can view own org workshop notes"
  ON workshop_notes FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own org workshop board config" ON workshop_board_config;
CREATE POLICY "Users can view own org workshop board config"
  ON workshop_board_config FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- Seed default statuses for existing organizations (UK workshop vocabulary).
-- New organizations are lazy-seeded by the API on first statuses fetch.
-- ----------------------------------------------------------------------------
INSERT INTO workshop_statuses (organization_id, name, colour, icon, sort_order, sms_message)
SELECT o.id, s.name, s.colour, s.icon, s.sort_order, s.sms_message
FROM organizations o
CROSS JOIN (VALUES
  ('Awaiting Authorisation', '#EF4444', 'clock',          10, NULL),
  ('Authorised',             '#16A34A', 'check-circle',   20, NULL),
  ('Awaiting Parts',         '#F59E0B', 'package',        30, NULL),
  ('Parts Arrived',          '#14B8A6', 'package-check',  40, NULL),
  ('On Road Test',           '#6366F1', 'route',          50, NULL),
  ('Quality Check',          '#8B5CF6', 'shield-check',   60, NULL),
  ('Ready for Wash',         '#06B6D4', 'droplets',       70, NULL),
  ('Sublet Out',             '#A855F7', 'external-link',  80, NULL),
  ('Ready for Collection',   '#10B981', 'key',            90,
   'Hi {customer_name}, your vehicle {registration} is now ready for collection. Thank you, {site_name}')
) AS s(name, colour, icon, sort_order, sms_message)
ON CONFLICT (organization_id, name) DO NOTHING;
