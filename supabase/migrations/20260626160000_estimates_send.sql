-- =============================================================================
-- GMS — Estimates P2 (send & accept)
--
-- Adds: per-org Estimate settings (link expiry, auto-expire, require-signature,
-- terms text); and makes communication_logs + customer_activities able to reference
-- an estimate (so estimate sends + customer responses are logged through the same
-- machinery as health checks).
--
-- Safety: additive + idempotent. health_check_id is RELAXED to nullable (it was
-- required); existing rows keep their value, so nothing is lost.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Estimate settings (column-per-setting on organization_settings, matching the
--    follow-up / check-in convention).
-- ----------------------------------------------------------------------------
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS estimate_link_expiry_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS estimate_auto_expire BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS estimate_require_signature BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS estimate_terms_text TEXT;

COMMENT ON COLUMN organization_settings.estimate_link_expiry_days IS
  'Days a sent estimate''s customer link stays live (drives estimates.token_expires_at + default valid_until).';
COMMENT ON COLUMN organization_settings.estimate_auto_expire IS
  'When true, a scheduler may mark sent estimates expired after valid_until (scheduler is a later phase).';
COMMENT ON COLUMN organization_settings.estimate_require_signature IS
  'When true, the customer must sign to accept on the estimate portal.';
COMMENT ON COLUMN organization_settings.estimate_terms_text IS
  'Terms & conditions text shown on the estimate portal / PDF.';

-- ----------------------------------------------------------------------------
-- 2. communication_logs can reference an estimate (not just a health check).
-- ----------------------------------------------------------------------------
ALTER TABLE communication_logs ALTER COLUMN health_check_id DROP NOT NULL;
ALTER TABLE communication_logs
  ADD COLUMN IF NOT EXISTS estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_communication_logs_estimate
  ON communication_logs(estimate_id) WHERE estimate_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. customer_activities can reference an estimate (portal view / accept / decline).
-- ----------------------------------------------------------------------------
ALTER TABLE customer_activities ALTER COLUMN health_check_id DROP NOT NULL;
ALTER TABLE customer_activities
  ADD COLUMN IF NOT EXISTS estimate_id UUID REFERENCES estimates(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_customer_activities_estimate
  ON customer_activities(estimate_id) WHERE estimate_id IS NOT NULL;
