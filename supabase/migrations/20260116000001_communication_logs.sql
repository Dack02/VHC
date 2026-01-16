-- =============================================================================
-- Communication Logs Table
-- Tracks all SMS and email communications sent to customers
-- =============================================================================

-- Communication logs table for tracking all notifications
CREATE TABLE IF NOT EXISTS communication_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID REFERENCES health_checks(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Channel information
  channel VARCHAR(20) NOT NULL,  -- 'email', 'sms'
  recipient VARCHAR(255) NOT NULL,

  -- Message details
  subject VARCHAR(500),
  message_body TEXT,
  template_id VARCHAR(100),

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'sent', 'failed', 'delivered', 'bounced'
  external_id VARCHAR(255),  -- Twilio SID or Resend message ID
  error_message TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_communication_logs_health_check ON communication_logs(health_check_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_org ON communication_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_channel ON communication_logs(channel);
CREATE INDEX IF NOT EXISTS idx_communication_logs_status ON communication_logs(status);
CREATE INDEX IF NOT EXISTS idx_communication_logs_created ON communication_logs(created_at DESC);

-- Enable RLS
ALTER TABLE communication_logs ENABLE ROW LEVEL SECURITY;

-- RLS policy: org isolation
CREATE POLICY communication_logs_org_isolation ON communication_logs
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Notifications table for in-app user notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Notification details
  type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'

  -- Related entities
  health_check_id UUID REFERENCES health_checks(id) ON DELETE CASCADE,
  action_url VARCHAR(500),

  -- Status
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_health_check ON notifications(health_check_id);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can only see their own notifications
CREATE POLICY notifications_user_isolation ON notifications
  FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_communication_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_communication_logs_updated_at
  BEFORE UPDATE ON communication_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_communication_logs_updated_at();
