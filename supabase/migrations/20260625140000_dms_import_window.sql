-- =============================================================================
-- DMS scheduled-import forward window
--
-- Previously the scheduled DMS import hard-coded a "today + next 2 working days"
-- window (apps/api/src/services/worker.ts), so any booking made further out than
-- ~2 days was invisible to VHC (and to the Follow-Up booking pre-check) until it
-- drifted into that window. We now pull a configurable forward horizon so all
-- future bookings are imported and kept in sync, with re-imports refreshing /
-- rescheduling existing awaiting_arrival bookings.
--
--   import_window_days — how many days ahead the scheduled import fetches.
--                        Default 365 (a full year). Per-org configurable.
--
-- Fully additive + idempotent. No destructive statements.
-- =============================================================================

ALTER TABLE organization_dms_settings
  ADD COLUMN IF NOT EXISTS import_window_days INTEGER DEFAULT 365;

COMMENT ON COLUMN organization_dms_settings.import_window_days IS 'Days ahead the scheduled DMS import fetches (forward horizon). Default 365.';

-- Backfill any pre-existing rows whose new column is NULL (the column default
-- only applies to rows inserted after the ALTER on some PG versions).
UPDATE organization_dms_settings SET import_window_days = 365 WHERE import_window_days IS NULL;
