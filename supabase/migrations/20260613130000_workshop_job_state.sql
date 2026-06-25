-- ============================================================================
-- Workshop Job State
-- ----------------------------------------------------------------------------
-- The app was built around health_checks.status, which tracks the VHC
-- (inspection + quote) pipeline. The workshop board has been overloading that
-- single field to decide which column a job sits in - but a vehicle can still
-- be in the workshop after the health check is "done" (e.g. carrying out
-- authorised repairs), which status alone cannot express.
--
-- This adds a second, independent axis: job_state - the vehicle's lifecycle in
-- the workshop. The board reads job_state for column placement; status stays
-- the customer-facing pipeline (shown as a badge on the card).
--
-- Lifecycle:  due_in -> arrived -> in_workshop -> work_complete -> collected
--   due_in / arrived / in_workshop : maintained automatically (arrival,
--     technician assignment, clock-on) by the trigger below.
--   work_complete / collected      : deliberate human actions (board / modal),
--     decoupled from where the VHC quote happens to sit.
-- ============================================================================

ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS job_state VARCHAR(20) NOT NULL DEFAULT 'arrived';

-- Valid values (idempotent - ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'health_checks_job_state_check'
  ) THEN
    ALTER TABLE health_checks
      ADD CONSTRAINT health_checks_job_state_check
      CHECK (job_state IN ('due_in', 'arrived', 'in_workshop', 'work_complete', 'collected'));
  END IF;
END $$;

-- Backfill existing rows from the current VHC status (+ technician assignment).
-- Closed/cancelled/archived jobs are off-board (collected); not-yet-arrived are
-- due_in; anything with a technician is in_workshop; the rest are on-site
-- ("checked in" = arrived). Touches only freshly-defaulted rows, so re-running
-- is safe.
UPDATE health_checks SET job_state = CASE
  WHEN status = 'awaiting_arrival'                     THEN 'due_in'
  WHEN status IN ('completed', 'cancelled', 'no_show') THEN 'collected'
  WHEN technician_id IS NOT NULL                       THEN 'in_workshop'
  ELSE 'arrived'
END
WHERE job_state = 'arrived';

CREATE INDEX IF NOT EXISTS idx_health_checks_job_state
  ON health_checks(organization_id, site_id, job_state)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- Keep the automatic (early) transitions in sync from health-check events,
-- forward-only, without ever overriding a deliberate work_complete / collected
-- placement. Runs BEFORE so it can set NEW.job_state directly. Manual job_state
-- writes that don't touch status/technician_id (e.g. "mark work complete") do
-- not fire this trigger and are preserved as-is.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION health_check_job_state_sync()
RETURNS TRIGGER AS $$
DECLARE
  js TEXT := NEW.job_state;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New bookings not yet arrived start in Due In; everything else on-site.
    IF NEW.status = 'awaiting_arrival' AND js = 'arrived' THEN
      js := 'due_in';
    END IF;
  ELSE
    -- A technician actually starting work pulls the job into the workshop -
    -- and reopens it if it had been marked complete.
    IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress'
       AND js IN ('due_in', 'arrived', 'work_complete') THEN
      js := 'in_workshop';
    END IF;
    -- Vehicle has progressed past "due in" (checked in / created / assigned…)
    -- without being explicitly pre-allocated to a technician for planning.
    IF NEW.status <> 'awaiting_arrival' AND js = 'due_in'
       AND NOT (NEW.technician_id IS NOT NULL AND OLD.technician_id IS NULL) THEN
      js := 'arrived';
    END IF;
    -- A closed / cancelled / no-show health check leaves the active board.
    IF NEW.status IN ('completed', 'cancelled', 'no_show')
       AND OLD.status IS DISTINCT FROM NEW.status THEN
      js := 'collected';
    END IF;
  END IF;

  NEW.job_state := js;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_health_check_job_state_sync ON health_checks;
CREATE TRIGGER trg_health_check_job_state_sync
  BEFORE INSERT OR UPDATE OF status, technician_id ON health_checks
  FOR EACH ROW
  EXECUTE FUNCTION health_check_job_state_sync();
