-- ============================================================================
-- Social Media — multi-PROFILE support (Zernio profiles as first-class)
--
-- An organization can now hold MANY Zernio profiles (a profile = a Zernio
-- workspace / brand grouping; under each are linked social accounts/pages).
-- This is what lets each Facebook PAGE live in its own profile (Zernio only
-- reports analytics for one active FB page per profile). See GMS/SOCIAL_MEDIA.md §17.
--
-- Additive only. Multi-tenant. Idempotent backfill. No supabase db reset — ever.
-- ============================================================================

CREATE TABLE IF NOT EXISTS social_profiles (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zernio_profile_id  TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT 'Profile',
  color              TEXT,
  is_default         BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'connected',  -- connected | needs_reauth | error
  last_synced_at     TIMESTAMPTZ,
  last_error         TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, zernio_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_social_profiles_org ON social_profiles(organization_id);

-- Each linked account belongs to one profile. Deleting a profile removes its
-- accounts (and their metrics/posts cascade from social_accounts).
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS social_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_social_accounts_profile ON social_accounts(social_profile_id);

-- ----------------------------------------------------------------------------
-- Backfill: migrate each org's existing single profile (held on
-- social_connections.zernio_profile_id) into a social_profiles row, and link
-- that org's existing accounts to it. Idempotent (guards on existence).
-- ----------------------------------------------------------------------------
DO $$
DECLARE rec RECORD; prof_id UUID;
BEGIN
  FOR rec IN
    SELECT organization_id, zernio_profile_id
    FROM social_connections
    WHERE zernio_profile_id IS NOT NULL
  LOOP
    SELECT id INTO prof_id
    FROM social_profiles
    WHERE organization_id = rec.organization_id AND zernio_profile_id = rec.zernio_profile_id;

    IF prof_id IS NULL THEN
      INSERT INTO social_profiles (organization_id, zernio_profile_id, name, is_default, status)
      VALUES (rec.organization_id, rec.zernio_profile_id, 'Main', true, 'connected')
      RETURNING id INTO prof_id;
    END IF;

    UPDATE social_accounts
    SET social_profile_id = prof_id
    WHERE organization_id = rec.organization_id AND social_profile_id IS NULL;
  END LOOP;
END $$;
