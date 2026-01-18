-- Add missing columns for DMS import
-- Required for full DMS integration

-- 1. Add mileage column to vehicles table
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS mileage INTEGER;

COMMENT ON COLUMN vehicles.mileage IS 'Current vehicle mileage, updated from DMS bookings';

-- 2. Add notes column to health_checks table
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN health_checks.notes IS 'Job notes imported from DMS booking';

-- 3. Add promise_time column to health_checks (alternative to promised_at for DMS imports)
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS promise_time TIMESTAMPTZ;

COMMENT ON COLUMN health_checks.promise_time IS 'Promised completion time from DMS booking';
