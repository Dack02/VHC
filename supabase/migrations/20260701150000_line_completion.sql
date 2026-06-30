-- TECH_JOB_MODEL.md P4 — per-line technician (fork A) for jobsheet work lines.
-- The repair_item is the line a tech owns/claims and marks complete (labour+parts hang
-- under it; it already carries work_completed_at/by). assigned_technician_id is the
-- per-line tech, distinct from the jobsheet's primary tech.
--
-- No historical jobsheet_id stamping backfill here (consistent with the deferred shell
-- backfill): inspection lines are stamped with jobsheet_id going forward in code, and the
-- jobsheet work-done/claim endpoints use a dual-parent ownership check (jobsheet_id OR the
-- linked VHC's health_check_id) so legacy un-stamped lines are still reachable.
-- Additive + idempotent. No destructive operations.

ALTER TABLE repair_items
  ADD COLUMN IF NOT EXISTS assigned_technician_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repair_items_assigned_technician
  ON repair_items(assigned_technician_id);

COMMENT ON COLUMN repair_items.assigned_technician_id IS
  'Per-line technician who claimed/owns this work line (TECH_JOB_MODEL.md §6.2/§10). Distinct from the jobsheet primary tech; set via the tech-permitted claim endpoint.';
