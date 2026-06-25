-- =============================================================================
-- In-app feedback / bug reporting (Ollo Inspect → Ollo Dev integration)
--
-- Local mirror of tickets pushed to Ollo Dev, so users can report bugs/feature
-- requests with screenshots and track status + dev replies in-app. Tenancy is
-- enforced in app code by organization_id filtering (like vehicle_mot_tests);
-- the service-role key is used for writes. The storage bucket gets RLS policies.
--
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT) per the project
-- DB-safety rules — no destructive statements.
-- =============================================================================

-- 1. feedback_tickets — local mirror of the Ollo Dev ticket --------------------
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id             UUID REFERENCES sites(id) ON DELETE SET NULL,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Denormalised reporter snapshot (survives later user/role changes).
  reporter_name       TEXT NOT NULL,
  reporter_email      TEXT NOT NULL,
  reporter_role       VARCHAR(30),
  reporter_org_name   TEXT,
  -- Ticket content.
  type                VARCHAR(20)  NOT NULL DEFAULT 'bug',    -- bug | feature | question
  subject             TEXT         NOT NULL,
  description         TEXT         NOT NULL DEFAULT '',
  priority            VARCHAR(20)  NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  -- Status mirrored FROM Ollo Dev (open | pending | in_progress | resolved | closed).
  status              VARCHAR(30)  NOT NULL DEFAULT 'open',
  -- Ollo Dev linkage + sync bookkeeping.
  ollo_dev_ticket_id  TEXT,
  sync_state          VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending | synced | failed
  sync_error          TEXT,
  sync_attempts       INTEGER      NOT NULL DEFAULT 0,
  last_synced_at      TIMESTAMPTZ,
  -- Silent diagnostics blob (route/url, app version, browser/device, console errors).
  diagnostics         JSONB        NOT NULL DEFAULT '{}',
  source_app          VARCHAR(20)  NOT NULL DEFAULT 'web',     -- web | mobile
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_tickets_org_created
  ON feedback_tickets (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_user
  ON feedback_tickets (user_id, created_at DESC);
-- The inbound webhook resolves a local ticket by its Ollo Dev id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_tickets_ollo_dev_id
  ON feedback_tickets (ollo_dev_ticket_id) WHERE ollo_dev_ticket_id IS NOT NULL;
-- The retry sweep scans unsynced rows.
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_sync_state
  ON feedback_tickets (sync_state) WHERE sync_state <> 'synced';

-- 2. feedback_comments — two-way thread ---------------------------------------
CREATE TABLE IF NOT EXISTS feedback_comments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feedback_ticket_id  UUID NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  author_type         VARCHAR(10) NOT NULL,             -- user | dev
  author_name         TEXT,
  body                TEXT NOT NULL,
  -- 'inspect' = created locally (pushed up); 'ollo_dev' = arrived via webhook.
  origin              VARCHAR(10) NOT NULL DEFAULT 'inspect',
  -- Ollo Dev comment id for inbound dedup (null for local-origin comments).
  external_comment_id TEXT,
  author_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_ticket
  ON feedback_comments (feedback_ticket_id, created_at ASC);
-- Idempotent inbound: never insert the same Ollo Dev comment twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_comments_external
  ON feedback_comments (feedback_ticket_id, external_comment_id)
  WHERE external_comment_id IS NOT NULL;

-- 3. feedback_attachments — screenshots ---------------------------------------
CREATE TABLE IF NOT EXISTS feedback_attachments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feedback_ticket_id  UUID NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  storage_path        TEXT NOT NULL,
  public_url          TEXT NOT NULL,         -- the URL sent to Ollo Dev
  content_type        VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
  byte_size           INTEGER,
  width               INTEGER,
  height              INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_ticket
  ON feedback_attachments (feedback_ticket_id);

-- 4. Storage bucket for feedback screenshots (public-read so Ollo Dev can fetch)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ollo-feedback',
  'ollo-feedback',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can upload feedback screenshots" ON storage.objects;
  DROP POLICY IF EXISTS "Public read access for feedback screenshots" ON storage.objects;
END $$;

CREATE POLICY "Authenticated users can upload feedback screenshots"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ollo-feedback');

CREATE POLICY "Public read access for feedback screenshots"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'ollo-feedback');

-- 5. Platform credential row for the Ollo Dev integration ----------------------
-- Env vars (OLLO_DEV_*) take precedence; this row is the admin-UI/DB fallback.
-- api_key / webhook_secret are AES-256-GCM encrypted before storage.
INSERT INTO platform_settings (id, settings)
VALUES (
  'ollo_dev',
  jsonb_build_object(
    'provider', 'ollo_dev',
    'enabled', false,
    'api_url', '',
    'api_key_encrypted', '',
    'project_id', '',
    'webhook_secret_encrypted', ''
  )
)
ON CONFLICT (id) DO NOTHING;
