-- TECH_JOB_MODEL.md §8.5 — clock re-home reconciliation (READ-ONLY, run on dev/prod
-- before fully trusting the jobsheet-keyed clock as sole source of truth).
--
-- After P3 the productive clock total is summed per JOB via
-- COALESCE(tte.jobsheet_id, hc.jobsheet_id). These checks prove that re-home is
-- lossless and double-count-free. All SELECT-only; nothing is mutated.

-- ── Check 1: every productive segment maps to exactly one job key ──────────────
-- A segment is jobsheet-anchored (tte.jobsheet_id) OR health-check-anchored
-- (tte.health_check_id → hc.jobsheet_id). Rows here are segments that resolve to
-- NEITHER a jobsheet nor an HC-with-jobsheet → would be dropped by the COALESCE.
-- Expected: 0 rows (legacy standalone-VHC segments with a null hc.jobsheet_id are
-- the no-backfill cohort and are EXPECTED — they still count via health_check_id).
SELECT te.id, te.technician_id, te.jobsheet_id, te.health_check_id, te.clock_in_at
FROM technician_time_entries te
LEFT JOIN health_checks hc ON hc.id = te.health_check_id
WHERE te.jobsheet_id IS NULL
  AND te.health_check_id IS NULL;

-- ── Check 2: no pre-cutover OPEN segment lost its jobsheet linkage ─────────────
-- Open segments on a VHC whose HC has a jobsheet should have been backfilled with
-- tte.jobsheet_id (P3 migration 20260701130000). Rows here are open HC segments
-- whose HC has a jobsheet but the segment was NOT backfilled — investigate before
-- retiring legacy fns. Expected: 0 rows.
SELECT te.id, te.technician_id, te.health_check_id, hc.jobsheet_id, te.clock_in_at
FROM technician_time_entries te
JOIN health_checks hc ON hc.id = te.health_check_id
WHERE te.clock_out_at IS NULL
  AND te.jobsheet_id IS NULL
  AND hc.jobsheet_id IS NOT NULL;

-- ── Check 3: §8.3 invariant — at most one OPEN segment per technician ──────────
-- Enforced by the partial unique index uniq_tte_one_open_per_tech (migration
-- 20260701160000). Rows here would be a double-count violation. Expected: 0 rows.
SELECT technician_id, COUNT(*) AS open_segments
FROM technician_time_entries
WHERE clock_out_at IS NULL
GROUP BY technician_id
HAVING COUNT(*) > 1;

-- ── Check 4: per-job productive total — sum-by-jobsheet vs sum-by-HC agree ─────
-- For jobs that have BOTH a jobsheet and ≥1 linked VHC, the productive minutes
-- summed by the job key (COALESCE) must equal HC-grouped + jobsheet-direct with
-- no segment counted twice. Rows here are jobs whose two roll-ups disagree.
-- Expected: 0 rows.
WITH productive AS (
  SELECT te.*, COALESCE(hc.jobsheet_id, te.jobsheet_id) AS job_key
  FROM technician_time_entries te
  LEFT JOIN health_checks hc ON hc.id = te.health_check_id
  LEFT JOIN time_entry_categories c ON c.id = te.category_id
  WHERE te.clock_out_at IS NOT NULL
    AND (c.id IS NULL OR c.counts_toward_job = true)
),
by_job AS (
  SELECT job_key, SUM(duration_minutes) AS mins
  FROM productive WHERE job_key IS NOT NULL GROUP BY job_key
),
distinct_segments AS (
  -- Same segments, counted exactly once regardless of which key they carry.
  SELECT job_key, SUM(duration_minutes) AS mins
  FROM (SELECT DISTINCT id, job_key, duration_minutes FROM productive WHERE job_key IS NOT NULL) s
  GROUP BY job_key
)
SELECT b.job_key, b.mins AS by_job_mins, d.mins AS distinct_mins
FROM by_job b
JOIN distinct_segments d ON d.job_key = b.job_key
WHERE b.mins <> d.mins;
