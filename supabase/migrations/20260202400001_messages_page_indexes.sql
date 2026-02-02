-- Indexes for Messages page: conversation listing and unread counts

-- Index for conversation listing grouped by phone number
CREATE INDEX IF NOT EXISTS idx_sms_messages_conversation
  ON sms_messages(organization_id, created_at DESC);

-- Index for unread count by from_number
CREATE INDEX IF NOT EXISTS idx_sms_messages_from_unread
  ON sms_messages(organization_id, from_number)
  WHERE direction = 'inbound' AND is_read = false;
