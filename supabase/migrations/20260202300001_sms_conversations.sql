-- SMS Conversations: Two-way SMS messaging between staff and customers
-- Stores both inbound (customer replies) and outbound (staff-sent) messages

CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  health_check_id UUID REFERENCES health_checks(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number VARCHAR(20) NOT NULL,
  to_number VARCHAR(20) NOT NULL,
  body TEXT NOT NULL,
  twilio_sid VARCHAR(50),
  twilio_status VARCHAR(30) DEFAULT 'received',
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  read_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sms_messages_org ON sms_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_health_check ON sms_messages(health_check_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_customer ON sms_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_from_number ON sms_messages(from_number);
CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at ON sms_messages(created_at DESC);

-- Partial index for unread inbound messages (for badge counts)
CREATE INDEX IF NOT EXISTS idx_sms_messages_unread
  ON sms_messages(organization_id, health_check_id)
  WHERE direction = 'inbound' AND is_read = false;

-- Index on customers.mobile for phone lookup during inbound matching
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile) WHERE mobile IS NOT NULL;

-- RLS policies
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

-- Service role has full access (API uses supabaseAdmin)
DROP POLICY IF EXISTS "service_role_sms_messages" ON sms_messages;
CREATE POLICY "service_role_sms_messages"
  ON sms_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
