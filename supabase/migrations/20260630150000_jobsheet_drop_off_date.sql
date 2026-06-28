-- Schedule-vs-drop-off split for advisor bookings.
--
-- jobsheets.due_in_date is the WORKSHOP SCHEDULE date — the day work is planned and
-- capacity is consumed (it drives vw_diary_bookings load + the booking picker). It is
-- relabelled "Workshop Schedule Date" in the advisor UI; the column name is unchanged.
--
-- drop_off_date is when the customer physically drops the vehicle in, when EARLIER than
-- the schedule date (e.g. dropped Monday, worked Wednesday). NULL = same day as the
-- schedule date. It drives ARRIVALS (Today → Arrivals, Booking Diary day view) so an
-- advisor knows the car is coming in — it does NOT change workshop capacity/loading,
-- which stays on due_in_date.

ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS drop_off_date DATE;

COMMENT ON COLUMN jobsheets.due_in_date IS 'Workshop schedule date — the day work is planned and capacity is consumed (drives diary load + booking picker). Relabelled "Workshop Schedule Date" in the UI.';
COMMENT ON COLUMN jobsheets.drop_off_date IS 'Date the customer drops the vehicle in, when earlier than due_in_date (schedule). NULL = same as due_in_date. Drives arrivals (Today / Booking Diary), not capacity.';

-- Arrivals-by-drop-off lookups (only the split bookings carry a value).
CREATE INDEX IF NOT EXISTS idx_jobsheets_org_drop_off
  ON jobsheets(organization_id, drop_off_date)
  WHERE drop_off_date IS NOT NULL;
