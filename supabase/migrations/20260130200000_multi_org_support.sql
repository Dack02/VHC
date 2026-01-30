-- Multi-Organization User Support
-- Allows users (by auth_id) to belong to multiple organizations with different roles.
-- Each user row = one org membership. user_preferences tracks last active org.

-- 1. Drop the UNIQUE constraint on users.auth_id so one auth_id can have multiple user rows
--    PostgreSQL auto-names inline UNIQUE constraints as <table>_<column>_key
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_id_key;

-- 2. Add composite unique constraint to prevent duplicate user-org combos
--    A given auth_id can only appear once per organization
ALTER TABLE users ADD CONSTRAINT users_auth_id_organization_id_key
  UNIQUE (auth_id, organization_id);

-- 3. Create user_preferences table to track last active organization per auth user
CREATE TABLE IF NOT EXISTS user_preferences (
  auth_id UUID PRIMARY KEY,
  last_active_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by auth_id (already primary key, but adding for clarity on the users table)
CREATE INDEX IF NOT EXISTS idx_users_auth_org ON users(auth_id, organization_id);
