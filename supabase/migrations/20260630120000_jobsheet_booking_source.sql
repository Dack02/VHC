-- Booking provenance on jobsheets, so customer self-booked bookings (from an online
-- estimate acceptance) can be flagged for advisor review and told apart from advisor-
-- created bookings. Additive + safe (IF NOT EXISTS); NULL = normal manual/advisor booking.

ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS booking_source VARCHAR(20);

COMMENT ON COLUMN jobsheets.booking_source IS
  'How the booking was created: ''online_estimate'' = customer self-booked a slot from an online estimate (auto-converted to this jobsheet); NULL = manual/advisor booking.';
