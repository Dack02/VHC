-- =============================================================================
-- Repair Type — default discount %
--
-- Adds an optional standing discount to a Repair Type. Use case: a type bills at
-- a standard labour code's rate (e.g. Clutch on the £105/hr LAB code) but should
-- be discounted by a fixed % to stay competitively priced. The discount is the
-- DEFAULT applied to new labour lines on that type's work groups; advisors can
-- still override it per line (repair_labour.discount_percent already holds the
-- per-line value). Plan: GMS/REPAIR_TYPES.md.
--
-- Safety: ADDITIVE ONLY, idempotent (IF NOT EXISTS). No destructive statements.
-- NOTE: deploy via the pipeline (supabase db push), never out-of-band MCP SQL.
-- =============================================================================

ALTER TABLE repair_types
  ADD COLUMN IF NOT EXISTS default_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Bound it 0–100 (a percentage). Drop-then-add keeps the migration re-runnable.
ALTER TABLE repair_types
  DROP CONSTRAINT IF EXISTS repair_types_default_discount_percent_check;
ALTER TABLE repair_types
  ADD CONSTRAINT repair_types_default_discount_percent_check
  CHECK (default_discount_percent >= 0 AND default_discount_percent <= 100);
