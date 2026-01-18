-- Add awaiting_arrival and no_show statuses for DMS integration Phase D
-- Phase D: Dashboard / Arrival Workflow

-- Add new enum values to health_check_status
ALTER TYPE health_check_status ADD VALUE IF NOT EXISTS 'awaiting_arrival' BEFORE 'created';
ALTER TYPE health_check_status ADD VALUE IF NOT EXISTS 'no_show' AFTER 'cancelled';

-- Add arrived_at timestamp to track when vehicle arrived
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

COMMENT ON COLUMN health_checks.arrived_at IS 'Timestamp when vehicle arrived (transition from awaiting_arrival to created)';
