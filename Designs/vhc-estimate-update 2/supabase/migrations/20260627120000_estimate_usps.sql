-- Estimate USPs (tenant selling points) shown on the customer estimate portal.
--
-- Stored as a JSONB array of short strings on organization_settings, alongside the other
-- estimate settings columns (20260626160000_estimates_send.sql). Free text; the portal
-- auto-matches an icon to each line from its wording (no icon stored).
--
-- Additive + idempotent. No backfill: orgs start with an empty list and add their own in
-- Settings → Estimates → Your selling points.

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS estimate_usps jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN organization_settings.estimate_usps IS
  'Tenant selling points (max 6 short strings) rendered as a trust strip on the customer estimate portal. Icon is auto-matched client-side from the wording.';
