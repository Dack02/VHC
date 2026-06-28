-- =============================================================================
-- Jobsheet invoice state — THE COGS/sale trigger (GMS/PARTS.md §7.3, decision 3/4)
-- =============================================================================
-- The jobsheet invoice IS the customer VAT invoice and the single accounting
-- trigger. VHC close is NOT a trigger. Today jobsheets only have a free
-- `jobsheet_complete` checkbox + workshop `job_state` — neither is a money event.
-- This adds the real invoice state + a per-org invoice-number counter, mirroring
-- the existing generate_jobsheet_reference() counter mechanism.
-- Additive only.
-- =============================================================================

-- 1. Per-org invoice-number counter (mirrors next_jobsheet_number)
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS next_invoice_number INTEGER DEFAULT 1;

-- 2. Jobsheet invoice columns
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS tax_point_date DATE;
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);

COMMENT ON COLUMN jobsheets.closed_at IS
  'When the jobsheet was invoiced (the single COGS/sale trigger). NULL = not yet invoiced. Cleared on reopen (GMS/PARTS.md §7.7).';
COMMENT ON COLUMN jobsheets.invoice_number IS
  'Customer VAT invoice number stamped at invoice time (GMS/PARTS.md decision 4).';
COMMENT ON COLUMN jobsheets.tax_point_date IS
  'VAT tax point of the invoice (defaults to closed_at date).';

-- 3. Indexes + per-org invoice-number uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS uniq_jobsheet_invoice_number_per_org
  ON jobsheets(organization_id, invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobsheets_closed_at
  ON jobsheets(organization_id, closed_at) WHERE closed_at IS NOT NULL;

-- 4. Invoice-number generator — called explicitly by POST /jobsheets/:id/invoice.
--    Atomically increments the per-org counter (mirrors generate_jobsheet_reference).
CREATE OR REPLACE FUNCTION next_jobsheet_invoice_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE organization_settings
  SET next_invoice_number = COALESCE(next_invoice_number, 1) + 1,
      updated_at = NOW()
  WHERE organization_id = p_org_id
  RETURNING next_invoice_number - 1 INTO v_next;

  -- If no organization_settings row exists yet, create one.
  IF v_next IS NULL THEN
    INSERT INTO organization_settings (organization_id, next_invoice_number, created_at, updated_at)
    VALUES (p_org_id, 2, NOW(), NOW())
    ON CONFLICT (organization_id) DO UPDATE
    SET next_invoice_number = COALESCE(organization_settings.next_invoice_number, 1) + 1,
        updated_at = NOW()
    RETURNING next_invoice_number - 1 INTO v_next;
  END IF;

  RETURN 'INV' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;
