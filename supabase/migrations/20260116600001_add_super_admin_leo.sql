-- =============================================================================
-- Add Super Admin: leo@dack.co.uk
-- =============================================================================

-- Note: This migration creates the super_admins record.
-- The auth.users record must be created via Supabase Auth API separately.
-- After running this migration, run the create-super-admin script to create the auth user.

-- Insert super admin record (auth_user_id will be updated by script)
INSERT INTO super_admins (email, name, is_active, created_at, updated_at)
VALUES ('leo@dack.co.uk', 'Leo Dack', true, NOW(), NOW())
ON CONFLICT (email) DO UPDATE SET
  is_active = true,
  updated_at = NOW();
