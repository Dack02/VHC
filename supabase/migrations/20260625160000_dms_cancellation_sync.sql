-- =============================================================================
-- DMS cancellation sync (safe, reversible)
--
-- The Gemini diary feed (get-diary-bookings) has NO explicit "cancelled" status:
-- a booking cancelled in the DMS simply stops appearing in the feed. Treating
-- "vanished from the feed" as "cancelled" is dangerous because:
--   1. A successful HTTP 200 that returns a truncated/partial set looks identical
--      to a batch of cancellations.
--   2. `cancelled` is a TERMINAL health-check status (no outgoing transitions),
--      so a wrongly-cancelled booking would be permanent and silent.
--   3. We import every Gemini Site=1 booking onto the org's fallback VHC site, so
--      a window+site cancel could wrongly cancel another site's bookings on a
--      multi-site org (there is no Gemini-site <-> VHC-site mapping).
--
-- This migration adds the columns the importer's *soft, reversible* sweep needs.
-- The sweep (apps/api/src/jobs/dms-import.ts) only marks a booking absent, and
-- only hard-cancels after it has been missing across N consecutive SCHEDULED
-- runs (and a wall-clock floor). A booking that reappears is revived. The whole
-- thing is opt-in per org and off by default.
--
-- Fully additive + idempotent. No destructive statements. (See rules.md — never
-- run `supabase db reset`.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. organization_dms_settings: opt-in + Gemini site mapping
-- ---------------------------------------------------------------------------

-- Master opt-in for the cancellation sweep. OFF by default: until an org enables
-- this, the importer behaves exactly as before (import + reschedule/refresh,
-- explicit-DMS-cancel only) and never auto-cancels vanished bookings.
ALTER TABLE organization_dms_settings
  ADD COLUMN IF NOT EXISTS cancel_missing_bookings BOOLEAN DEFAULT false;

COMMENT ON COLUMN organization_dms_settings.cancel_missing_bookings IS
  'Opt-in: when true, the SCHEDULED DMS import soft-cancels awaiting_arrival bookings that vanish from the Gemini diary feed (after N consecutive absent runs). Off by default. Only runs for single-site orgs or when an explicit site is supplied — see dms-import.ts.';

-- Which Gemini "Site" the org's diary feed maps to. The feed fetch is scoped to
-- a single Gemini Site; recording it makes the import self-consistent with the
-- one VHC site the sweep is allowed to touch. Default 1 matches the previously
-- hard-coded Site=1, so this is behaviour-preserving.
ALTER TABLE organization_dms_settings
  ADD COLUMN IF NOT EXISTS gemini_site_id INTEGER DEFAULT 1;

COMMENT ON COLUMN organization_dms_settings.gemini_site_id IS
  'Gemini OSI Site number the diary feed is fetched for (get-diary-bookings ?Site=). Default 1.';

-- Backfill pre-existing rows whose new columns are NULL (column DEFAULT only
-- applies to rows inserted after the ALTER on some PG versions).
UPDATE organization_dms_settings SET cancel_missing_bookings = false WHERE cancel_missing_bookings IS NULL;
UPDATE organization_dms_settings SET gemini_site_id = 1 WHERE gemini_site_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. health_checks: soft "missing from feed" markers
-- ---------------------------------------------------------------------------

-- First scheduled run on which this booking was found absent from the feed.
-- NULL = currently present (or never swept). Cleared (back to NULL) the moment
-- the booking reappears, which also resets dms_missing_runs — that is what makes
-- "N CONSECUTIVE absent runs" consecutive.
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS dms_missing_since TIMESTAMPTZ;

COMMENT ON COLUMN health_checks.dms_missing_since IS
  'DMS sync: timestamp of the first scheduled import run that found this booking absent from the Gemini diary feed. NULL when present. Reset on reappearance.';

-- Count of consecutive scheduled runs the booking has been absent. Reset to 0 on
-- reappearance. Hard-cancel only fires once this crosses the configured floor AND
-- enough wall-clock time has elapsed since dms_missing_since.
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS dms_missing_runs INTEGER DEFAULT 0;

COMMENT ON COLUMN health_checks.dms_missing_runs IS
  'DMS sync: number of consecutive scheduled import runs this booking has been absent from the feed. Reset to 0 on reappearance.';

UPDATE health_checks SET dms_missing_runs = 0 WHERE dms_missing_runs IS NULL;

-- Index supporting the held-set window query: in-window awaiting_arrival Gemini
-- bookings for a given org+site. Partial to stay tiny (only the rows the sweep
-- ever scans).
CREATE INDEX IF NOT EXISTS idx_health_checks_dms_awaiting_window
  ON health_checks (organization_id, site_id, due_date)
  WHERE external_source = 'gemini_osi'
    AND status = 'awaiting_arrival'
    AND deleted_at IS NULL;

-- Index supporting revival of sweep-cancelled rows when they reappear (looked up
-- by external_id; this narrows to the small set of DMS-cancelled rows).
CREATE INDEX IF NOT EXISTS idx_health_checks_dms_missing_cancelled
  ON health_checks (organization_id, external_id)
  WHERE external_source = 'gemini_osi'
    AND status = 'cancelled'
    AND deletion_reason = 'dms_missing';
