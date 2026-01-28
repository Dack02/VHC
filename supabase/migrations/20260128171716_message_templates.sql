-- Migration: Message Templates
-- Adds customizable SMS and email templates per organization

-- Create message templates table
CREATE TABLE IF NOT EXISTS organization_message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Template identification
  template_type VARCHAR(50) NOT NULL,  -- 'health_check_ready', 'reminder', 'reminder_urgent', 'authorization_confirmation'
  channel VARCHAR(10) NOT NULL,        -- 'sms', 'email'

  -- SMS content (single text field with placeholders)
  sms_content TEXT,

  -- Email content (block-based structure - NOT raw HTML)
  email_subject TEXT,
  email_greeting TEXT,        -- e.g., "Hi {{customerName}},"
  email_body TEXT,            -- Main message paragraph(s)
  email_closing TEXT,         -- e.g., "If you have any questions, please contact us."
  email_signature TEXT,       -- e.g., "{{dealershipName}}"
  email_cta_text TEXT,        -- Call-to-action button text, e.g., "View Health Check"

  -- Metadata
  is_custom BOOLEAN DEFAULT true,     -- true = org has customized this template
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each org can have one template per type/channel combination
  UNIQUE(organization_id, template_type, channel)
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_org_message_templates_org
  ON organization_message_templates(organization_id);

CREATE INDEX IF NOT EXISTS idx_org_message_templates_lookup
  ON organization_message_templates(organization_id, template_type, channel);

-- Add RLS policies
ALTER TABLE organization_message_templates ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view templates for their own organization
CREATE POLICY "Users can view own org message templates"
  ON organization_message_templates
  FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));

-- Policy: Org admins can manage templates for their organization
CREATE POLICY "Org admins can manage message templates"
  ON organization_message_templates
  FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM users
    WHERE id = auth.uid() AND role IN ('super_admin', 'org_admin')
  ));

-- Add comment for documentation
COMMENT ON TABLE organization_message_templates IS
  'Stores customizable SMS and email templates per organization for customer notifications';
