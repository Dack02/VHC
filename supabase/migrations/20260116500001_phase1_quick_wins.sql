-- =============================================================================
-- Phase 1 Quick Wins - Additional Gemini DMS Data Fields
-- Created: 2026-01-16
-- =============================================================================

-- =============================================================================
-- 1. CUSTOMER WAITING FLAG
-- Import from booking.CustomerWaiting
-- =============================================================================
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS customer_waiting BOOLEAN DEFAULT false;

-- Index for efficient sorting/filtering of waiting customers
CREATE INDEX IF NOT EXISTS idx_health_checks_customer_waiting
  ON health_checks(customer_waiting, status, promise_time)
  WHERE customer_waiting = true AND status = 'awaiting_arrival';

-- =============================================================================
-- 2. BOOKED REPAIRS (Pre-booked work from DMS)
-- Import from booking.Jobsheet.Repairs array
-- =============================================================================
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS booked_repairs JSONB DEFAULT '[]';

-- Example structure:
-- [
--   { "code": "SERV-A", "description": "Annual Service", "notes": "" },
--   { "code": "OIL-C", "description": "Oil Change", "notes": "Longlife specification" }
-- ]

-- =============================================================================
-- 3. CUSTOMER ADDRESS FIELDS
-- Import from booking.InvoiceTo address fields
-- =============================================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS town TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS postcode TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS title TEXT;

-- Index for postcode lookup
CREATE INDEX IF NOT EXISTS idx_customers_postcode ON customers(postcode) WHERE postcode IS NOT NULL;

-- =============================================================================
-- 4. LOAN CAR FLAG
-- Import from booking.LoanCar
-- =============================================================================
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS loan_car_required BOOLEAN DEFAULT false;

-- =============================================================================
-- 5. BOOKING & TIME TRACKING
-- =============================================================================

-- When booking was made in DMS
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS booked_date TIMESTAMPTZ;

-- When customer is expected (DueDateTime from DMS)
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;

-- Index for calculating and sorting by days on site
CREATE INDEX IF NOT EXISTS idx_health_checks_arrived_at ON health_checks(arrived_at) WHERE arrived_at IS NOT NULL;

-- Combined index for dashboard sorting (waiting customers first, then by due time)
CREATE INDEX IF NOT EXISTS idx_health_checks_awaiting_priority
  ON health_checks(status, customer_waiting DESC, due_date ASC)
  WHERE status = 'awaiting_arrival';

-- =============================================================================
-- 6. JOBSHEET INFO (Additional fields)
-- =============================================================================
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS jobsheet_number TEXT;
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS jobsheet_status TEXT;

-- =============================================================================
-- 7. INTERNAL FLAG
-- Import from booking.Internal (internal/trade jobs)
-- =============================================================================
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false;

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON COLUMN health_checks.customer_waiting IS 'True if customer is waiting on-site for the vehicle';
COMMENT ON COLUMN health_checks.booked_repairs IS 'JSON array of pre-booked work items from DMS: [{code, description, notes}]';
COMMENT ON COLUMN health_checks.loan_car_required IS 'True if customer has requested a loan car';
COMMENT ON COLUMN health_checks.booked_date IS 'When the booking was originally made in the DMS';
COMMENT ON COLUMN health_checks.due_date IS 'Expected arrival date/time from DMS (DueDateTime)';
COMMENT ON COLUMN health_checks.jobsheet_number IS 'Jobsheet reference number from DMS';
COMMENT ON COLUMN health_checks.jobsheet_status IS 'Current jobsheet status in DMS (Open, Closed, etc)';
COMMENT ON COLUMN health_checks.is_internal IS 'True if this is an internal/trade job';
COMMENT ON COLUMN customers.address_line1 IS 'Primary street address from DMS';
COMMENT ON COLUMN customers.address_line2 IS 'Secondary address line from DMS';
COMMENT ON COLUMN customers.town IS 'Town/city from DMS';
COMMENT ON COLUMN customers.county IS 'County from DMS';
COMMENT ON COLUMN customers.postcode IS 'Postal code from DMS';
COMMENT ON COLUMN customers.title IS 'Customer title (Mr, Mrs, Ms, etc) from DMS';
