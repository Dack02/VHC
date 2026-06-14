-- =============================================================================
-- Library Gap Report — daily email digest of red/amber inspection findings where
-- a technician typed free text instead of using the Reason Library, plus any
-- custom reasons submitted for manager review. Lets a workshop manager spot new
-- library entries and coach technicians. Org-wide, single email.
-- =============================================================================

-- Settings live on organization_settings (one row per org), matching the
-- indirect-time settings pattern.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS library_gap_report_enabled BOOLEAN DEFAULT false;

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS library_gap_report_time VARCHAR(5) DEFAULT '07:00';

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS library_gap_report_skip_empty BOOLEAN DEFAULT true;

-- Org-local date (YYYY-MM-DD) the digest last ran. The in-process scheduler
-- (apps/api/src/services/scheduler.ts) checks this so the report fires at most
-- once per day and survives restarts without double-sending.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS library_gap_report_last_sent_on DATE;

-- Recipients: staff users (user_id set, email kept in sync at send time) and/or
-- free-form addresses (user_id null). Mirrors daily_sms_overview_recipients.
CREATE TABLE IF NOT EXISTS library_gap_report_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_library_gap_recipients_org
  ON library_gap_report_recipients(organization_id);
CREATE INDEX IF NOT EXISTS idx_library_gap_recipients_active
  ON library_gap_report_recipients(organization_id) WHERE is_active = true;

ALTER TABLE library_gap_report_recipients ENABLE ROW LEVEL SECURITY;

-- DROP + CREATE so the migration is safely re-runnable (CREATE POLICY has no
-- IF NOT EXISTS form).
DROP POLICY IF EXISTS library_gap_recipients_isolation ON library_gap_report_recipients;
CREATE POLICY library_gap_recipients_isolation ON library_gap_report_recipients
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);
