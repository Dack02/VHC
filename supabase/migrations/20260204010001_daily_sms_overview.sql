-- =============================================================================
-- Daily SMS Overview - Recipients table and notification settings columns
-- =============================================================================

-- New table: daily_sms_overview_recipients
CREATE TABLE IF NOT EXISTS daily_sms_overview_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_sms_recipients_org ON daily_sms_overview_recipients(organization_id);
CREATE INDEX IF NOT EXISTS idx_daily_sms_recipients_site ON daily_sms_overview_recipients(site_id);
CREATE INDEX IF NOT EXISTS idx_daily_sms_recipients_active ON daily_sms_overview_recipients(organization_id) WHERE is_active = true;

-- RLS
ALTER TABLE daily_sms_overview_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_sms_recipients_isolation ON daily_sms_overview_recipients
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Add daily SMS overview columns to organization_notification_settings
ALTER TABLE organization_notification_settings
  ADD COLUMN IF NOT EXISTS daily_sms_overview_enabled BOOLEAN DEFAULT false;

ALTER TABLE organization_notification_settings
  ADD COLUMN IF NOT EXISTS daily_sms_overview_time VARCHAR(5) DEFAULT '18:00';
