-- Unable to Send Reasons table
-- Stores configurable reasons why a health check cannot be sent to a customer
CREATE TABLE IF NOT EXISTS unable_to_send_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, reason)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_unable_to_send_reasons_org ON unable_to_send_reasons(organization_id);
CREATE INDEX IF NOT EXISTS idx_unable_to_send_reasons_org_active ON unable_to_send_reasons(organization_id, is_active);

-- Add unable_to_send_reason_id column to health_checks
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS unable_to_send_reason_id UUID REFERENCES unable_to_send_reasons(id);
