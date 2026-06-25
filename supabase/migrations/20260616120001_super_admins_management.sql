-- =============================================================================
-- Super-admin user management: audit columns + active-count index.
-- Additive/forward-only. The super_admins table already exists.
-- =============================================================================

ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS created_by     UUID REFERENCES super_admins(id);
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES super_admins(id);

-- Fast "count of active admins" guard for last-admin protection.
CREATE INDEX IF NOT EXISTS idx_super_admins_active ON super_admins(is_active) WHERE is_active = true;
