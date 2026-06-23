-- =============================================================================
-- GMS — Jobsheet Due-In date/time (mandatory date, optional time)
--
-- A jobsheet now carries a mandatory "Due In Date" (when the customer is due in)
-- and an optional "Due In Time" (NULL = time flexible / to be agreed). The linked
-- VHC's `health_checks.due_date` is derived from these, so the inspection flows
-- into the Upcoming view and the workshop "Due In" column on the right day.
--
-- Safety: additive + idempotent. Column is added nullable, backfilled, then set
-- NOT NULL so it's safe even if jobsheet rows already exist.
-- =============================================================================

-- 1. Add the columns (nullable first for a safe backfill)
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS due_in_date DATE;
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS due_in_time TIME;  -- NULL = flexible / TBC

-- 2. Backfill any pre-existing jobsheets (created before this column) so the
--    NOT NULL constraint can be applied. Use the document date as a sensible default.
UPDATE jobsheets SET due_in_date = created_at::date WHERE due_in_date IS NULL;

-- 3. Enforce: due-in date is mandatory
ALTER TABLE jobsheets ALTER COLUMN due_in_date SET NOT NULL;

-- 4. Backfill the linked VHC's due_date for existing jobsheet-created checks that
--    have none, combining date + time (default 08:00 when the time is flexible).
UPDATE health_checks hc
SET due_date = (j.due_in_date + COALESCE(j.due_in_time, TIME '08:00'))
FROM jobsheets j
WHERE hc.jobsheet_id = j.id
  AND hc.due_date IS NULL
  AND hc.deleted_at IS NULL;

-- 5. Helpful index for forward-calendar / date-range listing
CREATE INDEX IF NOT EXISTS idx_jobsheets_org_due_in
  ON jobsheets(organization_id, due_in_date);

COMMENT ON COLUMN jobsheets.due_in_date IS 'Mandatory date the customer is due in.';
COMMENT ON COLUMN jobsheets.due_in_time IS 'Optional agreed time; NULL = flexible / to be agreed. Drives health_checks.due_date (default 08:00 when NULL).';
