-- =============================================================================
-- Estimates — online booking ("the clear next step")
--
-- After a customer approves an estimate online, they can book the work in themselves.
-- Bookable slots are derived from the SAME workshop capacity the Booking Diary uses
-- (diary_day_summary / workshop_board_config) — this migration does NOT introduce a
-- second capacity model. It adds:
--   1. per-org booking config on organization_settings (toggle + window + slot length)
--   2. estimate_bookings — the customer's chosen slot (a request the garage confirms /
--      converts into the diary; we never silently inject into the workshop feed).
--
-- Additive + idempotent. No destructive statements. Re-runnable.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Booking config (per org). All optional with safe defaults; booking is OFF
--    until a tenant turns it on in Settings → Estimates.
-- ----------------------------------------------------------------------------
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS estimate_online_booking_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimate_booking_lead_days      INTEGER NOT NULL DEFAULT 1,    -- earliest bookable = today + lead
  ADD COLUMN IF NOT EXISTS estimate_booking_window_days    INTEGER NOT NULL DEFAULT 21,   -- how far ahead the picker shows
  ADD COLUMN IF NOT EXISTS estimate_booking_slot_minutes   INTEGER NOT NULL DEFAULT 90,   -- slot granularity + assumed job duration for capacity
  ADD COLUMN IF NOT EXISTS estimate_booking_day_start      TEXT    NOT NULL DEFAULT '08:30',
  ADD COLUMN IF NOT EXISTS estimate_booking_day_end        TEXT    NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS estimate_booking_courtesy_car   BOOLEAN NOT NULL DEFAULT false; -- offer the courtesy-car opt-in on the slot picker

COMMENT ON COLUMN organization_settings.estimate_online_booking_enabled IS
  'When true, the customer estimate portal lets the customer book a slot online after approving. Slots come from Booking Diary capacity (diary_day_summary).';
COMMENT ON COLUMN organization_settings.estimate_booking_slot_minutes IS
  'Slot length shown in the picker, also used as the assumed job duration when checking a day has free workshop hours.';

-- ----------------------------------------------------------------------------
-- 2. estimate_bookings — a customer's chosen slot for an approved estimate.
--    status: requested -> confirmed (garage) | cancelled. Converting into an
--    actual diary booking (jobsheet) is a garage-side action; this row is the link.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estimate_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id         UUID REFERENCES sites(id) ON DELETE SET NULL,

  requested_date  DATE NOT NULL,
  requested_time  TEXT NOT NULL,            -- 'HH:MM'
  slot_minutes    INTEGER NOT NULL DEFAULT 90,
  courtesy_car_requested BOOLEAN NOT NULL DEFAULT false,

  status          VARCHAR(20) NOT NULL DEFAULT 'requested',  -- requested | confirmed | cancelled
  customer_name   TEXT,                     -- snapshot for the diary view
  converted_to_jobsheet_id UUID REFERENCES jobsheets(id) ON DELETE SET NULL,

  -- audit (mirrors the portal's customer_activities capture)
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live (non-cancelled) booking per estimate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estimate_bookings_live
  ON estimate_bookings(estimate_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_estimate_bookings_site_date
  ON estimate_bookings(organization_id, site_id, requested_date);

DROP TRIGGER IF EXISTS trg_estimate_bookings_updated_at ON estimate_bookings;
CREATE TRIGGER trg_estimate_bookings_updated_at
  BEFORE UPDATE ON estimate_bookings
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

ALTER TABLE estimate_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own org estimate bookings" ON estimate_bookings;
CREATE POLICY "Users can view own org estimate bookings"
  ON estimate_bookings FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));
