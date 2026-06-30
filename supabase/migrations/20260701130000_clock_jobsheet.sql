-- TECH_JOB_MODEL.md P3 — re-home the clock onto the jobsheet.
-- The jobsheet is the unit of work, so a tech clocks the JOB. technician_time_entries
-- gains jobsheet_id; aggregation groups by COALESCE(jobsheet_id, jobsheet-via-hc) so
-- legacy/HC-only entries still resolve. Backfill stamps existing entries (incl OPEN
-- ones, §8.4) from their HC's jobsheet for a clean cutover.
-- Additive + idempotent. No destructive operations.

ALTER TABLE technician_time_entries
  ADD COLUMN IF NOT EXISTS jobsheet_id UUID REFERENCES jobsheets(id);

CREATE INDEX IF NOT EXISTS idx_tte_jobsheet ON technician_time_entries(jobsheet_id);

COMMENT ON COLUMN technician_time_entries.jobsheet_id IS
  'The job the segment belongs to (TECH_JOB_MODEL.md §8). Set directly by /jobsheets/:id/clock-*; for HC clock entries resolved via COALESCE(jobsheet_id, health_checks.jobsheet_id).';

-- Backfill jobsheet_id from each entry's HC (open + closed). Guarded + additive.
UPDATE technician_time_entries te
   SET jobsheet_id = hc.jobsheet_id
  FROM health_checks hc
 WHERE te.health_check_id = hc.id
   AND te.jobsheet_id IS NULL
   AND hc.jobsheet_id IS NOT NULL;
