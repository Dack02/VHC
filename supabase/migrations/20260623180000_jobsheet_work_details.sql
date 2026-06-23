-- =============================================================================
-- GMS Phase 2 — Jobsheet Work Details
--
-- Booked work belongs to the JOBSHEET (not the VHC); the VHC becomes optional.
-- A jobsheet work line *is* a repair_item — we reuse the existing repair engine
-- (repair_labour / repair_parts / pricing triggers / service_packages) and only
-- make the parent polymorphic. Additive only — no destructive changes, re-runnable.
-- =============================================================================

-- 1. repair_items can hang off a jobsheet directly (booked work), not just a VHC.
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS jobsheet_id UUID
  REFERENCES jobsheets(id) ON DELETE CASCADE;

-- health_check_id is no longer mandatory (a booked line has a jobsheet parent only).
ALTER TABLE repair_items ALTER COLUMN health_check_id DROP NOT NULL;

-- A work line must always have at least one parent (a VHC or a jobsheet).
DO $$ BEGIN
  ALTER TABLE repair_items ADD CONSTRAINT repair_items_parent_chk
    CHECK (health_check_id IS NOT NULL OR jobsheet_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Origin discriminator for reporting / grouping.
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS source VARCHAR(20);
COMMENT ON COLUMN repair_items.source IS
  'Origin of the work line: booking (added on the jobsheet) | inspection (VHC finding) | manual. NULL = legacy/unspecified.';

CREATE INDEX IF NOT EXISTS idx_repair_items_jobsheet ON repair_items(jobsheet_id) WHERE jobsheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repair_items_source   ON repair_items(source)      WHERE source IS NOT NULL;

-- 2. Jobsheet: optional VHC, its own Vehicle Status, and a booking-notes overview.
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS vhc_required  BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS job_state     VARCHAR(20) NOT NULL DEFAULT 'due_in';
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS booking_notes TEXT;

COMMENT ON COLUMN jobsheets.vhc_required IS 'Whether a VHC is attached. Default true; advisor can opt out at booking ("Requires VHC").';
COMMENT ON COLUMN jobsheets.job_state IS 'The jobsheet''s Vehicle Status (workshop position) — same value set as health_checks.job_state. Option 2: the jobsheet is the visit entity.';
COMMENT ON COLUMN jobsheets.booking_notes IS 'Work Details overview / customer concern. Distinct from customer_contact_notes.';

-- Backfill the jobsheet's Vehicle Status from its linked VHC where one exists,
-- so existing jobsheets reflect the live workshop position.
UPDATE jobsheets j
SET job_state = hc.job_state
FROM health_checks hc
WHERE hc.jobsheet_id = j.id
  AND hc.deleted_at IS NULL
  AND hc.job_state IS NOT NULL;
