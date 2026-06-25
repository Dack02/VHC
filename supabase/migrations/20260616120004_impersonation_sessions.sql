-- =============================================================================
-- Impersonation session records: audit + expiry + admin visibility/revoke.
-- =============================================================================

CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id  UUID NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
  target_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  end_reason      VARCHAR(16)   -- 'manual' | 'expired' | 'admin_revoked'
);

CREATE INDEX IF NOT EXISTS idx_impersonation_active  ON impersonation_sessions(target_user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_impersonation_started ON impersonation_sessions(started_at DESC);

ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
