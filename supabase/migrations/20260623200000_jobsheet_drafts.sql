-- =============================================================================
-- GMS — Jobsheet drafts (one-screen "book + quote" flow)
--
-- The New Jobsheet page builds the booking and the priced work (labour/parts) on
-- a single screen. Work lines are repair_items that need a parent jobsheet id, so
-- the jobsheet is created as a DRAFT the moment a vehicle + customer are chosen.
-- A draft is invisible everywhere (excluded from lists/tiles), has NO reference and
-- NO linked VHC, and is only "committed" (reference assigned + VHC kicked off) when
-- the advisor clicks Create. Abandoned drafts are discarded (hard-deleted, cascading
-- to their work lines) — they never burn a JS number or hit the workshop board.
--
-- Additive only — no destructive changes, re-runnable.
-- =============================================================================

-- 1. Draft flag. Existing rows are committed jobsheets, so default false.
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN jobsheets.is_draft IS
  'True while a jobsheet is being built on the New screen (no reference, no VHC, hidden from lists/tiles). Set false on commit, which assigns the JS reference and kicks off the VHC.';

-- 2. Reference assignment now skips drafts and runs on commit.
--    A draft is inserted with reference NULL and is_draft=true → no number burned
--    (NULLs are distinct under the (organization_id, reference) unique constraint).
--    When is_draft flips to false (commit) and reference is still NULL, the trigger
--    assigns 'JS00001'. Committed rows already have a reference, so re-updates skip.
CREATE OR REPLACE FUNCTION generate_jobsheet_reference()
RETURNS TRIGGER AS $$
DECLARE
  v_next_number INTEGER;
BEGIN
  -- Drafts don't get a reference; it's assigned when the jobsheet is committed.
  IF NEW.reference IS NULL AND COALESCE(NEW.is_draft, false) = false THEN
    -- Atomically get and increment the per-org counter
    UPDATE organization_settings
    SET next_jobsheet_number = COALESCE(next_jobsheet_number, 1) + 1,
        updated_at = NOW()
    WHERE organization_id = NEW.organization_id
    RETURNING next_jobsheet_number - 1 INTO v_next_number;

    -- If no organization_settings row exists, create one
    IF v_next_number IS NULL THEN
      INSERT INTO organization_settings (organization_id, next_jobsheet_number, created_at, updated_at)
      VALUES (NEW.organization_id, 2, NOW(), NOW())
      ON CONFLICT (organization_id) DO UPDATE
      SET next_jobsheet_number = COALESCE(organization_settings.next_jobsheet_number, 1) + 1,
          updated_at = NOW()
      RETURNING next_jobsheet_number - 1 INTO v_next_number;
    END IF;

    NEW.reference := 'JS' || LPAD(v_next_number::TEXT, 5, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fire on UPDATE too, so committing a draft (is_draft -> false) assigns the reference.
DROP TRIGGER IF EXISTS trg_generate_jobsheet_reference ON jobsheets;
CREATE TRIGGER trg_generate_jobsheet_reference
BEFORE INSERT OR UPDATE ON jobsheets
FOR EACH ROW
EXECUTE FUNCTION generate_jobsheet_reference();

-- 3. Most list queries want only committed jobsheets — a partial index keeps that fast.
CREATE INDEX IF NOT EXISTS idx_jobsheets_active
  ON jobsheets(organization_id, created_at DESC)
  WHERE is_draft = false AND deleted_at IS NULL;
