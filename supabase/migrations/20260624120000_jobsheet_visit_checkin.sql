-- ============================================================================
-- Jobsheet visit / no-inspection check-in (Option 1: health_check = the visit)
-- ----------------------------------------------------------------------------
-- A jobsheet booked WITHOUT a VHC ("Requires VHC" off) still needs the vehicle
-- checked in (mileage, keys, customer waiting, MRI). Check-in lives only on
-- `health_checks`, so a no-VHC jobsheet gets a lightweight health_check "visit"
-- shell that carries the check-in but expects no inspection.
--
-- `inspection_required` is the hinge:
--   true  = a real VHC (DEFAULT — every existing row, every VHC-only / DMS check)
--   false = a visit shell: check-in (+ MRI) only, hidden from inspection
--           lists / the kanban board, created lazily at check-in.
--
-- A shell has no inspection template, so `template_id` is relaxed to nullable
-- (check-in and MRI never reference a template). Existing rows are unaffected —
-- they all already have a template and default to inspection_required = true.
-- Additive + a NOT NULL relaxation only; no data is moved or dropped.
-- ============================================================================

ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS inspection_required BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE health_checks ALTER COLUMN template_id DROP NOT NULL;

COMMENT ON COLUMN health_checks.inspection_required IS
  'false = a check-in-only "visit" shell for a no-VHC jobsheet (hidden from inspection lists/board); true = a normal VHC.';

-- Inspection-centric lists/board filter on this; index the common "real VHCs" path.
CREATE INDEX IF NOT EXISTS idx_health_checks_inspection_required
  ON health_checks(organization_id, inspection_required)
  WHERE deleted_at IS NULL;
