-- ============================================================================
-- Check-In & MRI Scan Feature - Phase 1: Database Schema & Status
-- Adds awaiting_checkin status and check-in fields to health_checks table
-- ============================================================================

-- Add awaiting_checkin status to health_check_status enum
-- Position: after awaiting_arrival, before created
ALTER TYPE health_check_status ADD VALUE IF NOT EXISTS 'awaiting_checkin' AFTER 'awaiting_arrival';

-- Add check-in fields to health_checks table
-- Note: mileage_in already exists in the schema

-- Timestamp when advisor completed check-in
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

COMMENT ON COLUMN health_checks.checked_in_at IS 'Timestamp when advisor completed the check-in process';

-- User ID of advisor who completed check-in
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES users(id);

COMMENT ON COLUMN health_checks.checked_in_by IS 'User ID of the advisor who completed check-in';

-- Time when customer needs vehicle back
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS time_required TIME;

COMMENT ON COLUMN health_checks.time_required IS 'Time when customer needs the vehicle back';

-- Key location (e.g., in vehicle, key safe, with advisor, hook number)
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS key_location TEXT;

COMMENT ON COLUMN health_checks.key_location IS 'Where the vehicle keys are located during service';

-- Advisor notes during check-in
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS checkin_notes TEXT;

COMMENT ON COLUMN health_checks.checkin_notes IS 'Notes from advisor during check-in process';

-- Whether check-in notes should be visible to technician
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS checkin_notes_visible_to_tech BOOLEAN DEFAULT true;

COMMENT ON COLUMN health_checks.checkin_notes_visible_to_tech IS 'Whether check-in notes are visible to the assigned technician';

-- Create index for faster queries on awaiting_checkin status
CREATE INDEX IF NOT EXISTS idx_health_checks_awaiting_checkin
  ON health_checks(arrived_at)
  WHERE status = 'awaiting_checkin';
