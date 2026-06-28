-- =============================================================================
-- Resource Manager — P3 (online booking backend)
--
-- Wires the estimate portal's (inert) slot picker to the capacity engine. Adds
-- the booking-mode columns on repair_types (drop-off default vs timed slot), the
-- requested-slot columns on estimates the public /book endpoint persists, and a
-- per-org switch to turn customer online booking on. Availability + booking
-- validation run through services/resource-capacity (canBook), so online bookings
-- respect the same loading target + category quotas as everything else.
--
-- Plan: GMS/RESOURCE_MANAGER.md (§6.3, §10.1). ADDITIVE ONLY — idempotent.
-- Deploy via the pipeline (supabase db push).
-- =============================================================================

-- Booking mode per repair type (§6.3): drop_off (default) or timed_slot.
ALTER TABLE repair_types
  ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(10) NOT NULL DEFAULT 'drop_off',
  ADD COLUMN IF NOT EXISTS slot_minutes INTEGER;

COMMENT ON COLUMN repair_types.booking_mode IS 'drop_off (car left for the day; customer picks a morning drop-off time) | timed_slot (real appointment time, e.g. MOT/AC).';
COMMENT ON COLUMN repair_types.slot_minutes IS 'Timed-slot length for timed_slot types; NULL → derive from default_estimated_hours.';

-- The slot a customer requested via online booking (persisted by /book).
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS requested_date DATE,
  ADD COLUMN IF NOT EXISTS requested_time TIME,
  ADD COLUMN IF NOT EXISTS requested_slot_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS courtesy_car_requested BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_booked_at TIMESTAMPTZ;

-- Per-org switch: show the customer online-booking step on accepted estimates.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS estimate_online_booking_enabled BOOLEAN NOT NULL DEFAULT false;
