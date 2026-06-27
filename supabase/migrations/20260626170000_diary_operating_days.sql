-- =============================================================================
-- Workshop operating days (Booking Diary weekend hiding)
--
-- Per-site list of weekdays the workshop is open, as ISO day-of-week integers
-- (1 = Mon … 7 = Sun). The Booking Diary's calendar-style views (Month / Week)
-- and the Agenda hide columns/sections for non-operating weekdays — except any
-- day that actually has bookings, which always shows so data is never hidden.
--
-- Default = all seven days (no behaviour change for existing sites). Fully
-- additive + idempotent.
-- =============================================================================

ALTER TABLE workshop_board_config
  ADD COLUMN IF NOT EXISTS operating_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}';

COMMENT ON COLUMN workshop_board_config.operating_days IS
  'Weekdays the site operates, ISO dow ints (1=Mon..7=Sun). Booking Diary hides non-operating weekday columns (a day with bookings still shows). Default all 7.';
