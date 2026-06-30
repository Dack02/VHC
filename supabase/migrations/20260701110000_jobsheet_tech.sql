-- TECH_JOB_MODEL.md P1 — Jobsheet technician linkage (fork A: primary tech on the job)
-- The jobsheet is the unit of work; assigned_technician_id is the job's owning tech
-- ("the whole time on a job sheet"). Mirrors advisor_id's ON DELETE SET NULL.
-- Per-line tech (repair_items.assigned_technician_id) is added in P4.
-- Additive + idempotent. No destructive operations.

ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS assigned_technician_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tech_assigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobsheets_assigned_technician
  ON jobsheets(assigned_technician_id);

COMMENT ON COLUMN jobsheets.assigned_technician_id IS
  'Primary technician owning the whole job (TECH_JOB_MODEL.md §6.1). Mirrored to health_checks.technician_id through P1-P3, sole truth from P5.';
