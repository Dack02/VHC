-- TECH_JOB_MODEL.md §8.3 — DB backstop for "one active productive segment per technician".
-- The app helper closeOpenSegmentsForTech enforces this, but it is non-atomic (SELECT-open
-- then UPDATE-each), so two near-simultaneous clock-ins for the same tech can each find
-- nothing open and both INSERT, leaving two concurrent open timers that double-count time.
-- A partial unique index makes the invariant airtight at the DB. Idempotent.

-- Dedupe any pre-existing multi-open rows first so the unique index can build: close every
-- open segment EXCEPT the latest one per technician. Only touches violating rows.
UPDATE technician_time_entries te
   SET clock_out_at = NOW(),
       duration_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - te.clock_in_at)) / 60.0)::int),
       closed_reason = 'dedupe'
 WHERE te.clock_out_at IS NULL
   AND EXISTS (
     SELECT 1 FROM technician_time_entries t2
      WHERE t2.technician_id = te.technician_id
        AND t2.clock_out_at IS NULL
        AND (t2.clock_in_at > te.clock_in_at
             OR (t2.clock_in_at = te.clock_in_at AND t2.id > te.id))
   );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tte_one_open_per_tech
  ON technician_time_entries (technician_id)
  WHERE clock_out_at IS NULL;
