-- =============================================================================
-- Parts module — inventory_journal + inventory_journal_lines (GMS/PARTS.md §5.10)
-- =============================================================================
-- The journal-ready double-entry ledger. Immutable balanced Dr/Cr rows that a
-- future Xero/QBO/Sage push consumes directly. SUM(debit)=SUM(credit) per
-- journal is enforced by the WRITER SERVICE (cross-row, not a column CHECK).
-- Corrections = reverse-and-repost, never edit a posted journal.
-- Additive only.
-- =============================================================================

-- 1. Header
CREATE TABLE IF NOT EXISTS inventory_journal (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  source_event TEXT NOT NULL CHECK (source_event IN (
    'simple_purchase', 'simple_sale',
    'goods_receipt', 'purchase_invoice', 'part_sale', 'part_cogs',
    'non_stock_invoice', 'non_stock_cogs', 'supplier_credit',
    'stock_adjustment', 'price_variance', 'core_charge', 'reversal'
  )),
  source_type TEXT,                 -- jobsheet | health_check | po | stocktake | supplier_return | repair_part
  source_id UUID,
  jobsheet_id UUID REFERENCES jobsheets(id) ON DELETE SET NULL,
  health_check_id UUID REFERENCES health_checks(id) ON DELETE SET NULL,

  document_date DATE NOT NULL,
  period_key TEXT NOT NULL,         -- YYYY-MM derived from the POSTED date (period-lock aware)
  invoice_number TEXT,              -- stamped on sale-side events
  tax_point_date DATE,

  net_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross_total DECIMAL(12,2) NOT NULL DEFAULT 0,

  idempotency_key TEXT NOT NULL,    -- internal dedup: source_event + source_id + line-set
  posting_status TEXT NOT NULL DEFAULT 'unposted'
    CHECK (posting_status IN ('unposted', 'draft', 'posted', 'blocked', 'error', 'voided')),
  reversal_of UUID REFERENCES inventory_journal(id) ON DELETE SET NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uniq_inventory_journal_idempotency UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_journal_org        ON inventory_journal(organization_id);
CREATE INDEX IF NOT EXISTS idx_inventory_journal_jobsheet   ON inventory_journal(jobsheet_id) WHERE jobsheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_journal_source     ON inventory_journal(organization_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_inventory_journal_period     ON inventory_journal(organization_id, period_key);
CREATE INDEX IF NOT EXISTS idx_inventory_journal_status     ON inventory_journal(organization_id, posting_status);
CREATE INDEX IF NOT EXISTS idx_inventory_journal_event_date ON inventory_journal(organization_id, document_date);

-- 2. Lines (one Dr or Cr each; VAT isolated on its own control line)
CREATE TABLE IF NOT EXISTS inventory_journal_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_id UUID NOT NULL REFERENCES inventory_journal(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  internal_account_key TEXT NOT NULL,   -- parts_stock | parts_wip | accounts_payable | vat_input |
                                        -- accounts_receivable | parts_sales | parts_cogs | vat_output |
                                        -- stock_adjustment | purchase_price_variance | core_liability
  debit DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_code TEXT,                        -- STD_20 | ZERO | EXEMPT | NO_VAT
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,

  tracking_site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  tracking_job_id UUID,                 -- jobsheet/health_check id for departmental tracking
  entity_type TEXT,                     -- supplier | customer | stock_item
  entity_id UUID,
  line_description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- A line is exactly one side, non-negative.
  CONSTRAINT inventory_journal_line_one_side CHECK (
    (debit >= 0 AND credit >= 0) AND NOT (debit > 0 AND credit > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_inventory_journal_lines_journal ON inventory_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_inventory_journal_lines_org     ON inventory_journal_lines(organization_id);
CREATE INDEX IF NOT EXISTS idx_inventory_journal_lines_account ON inventory_journal_lines(organization_id, internal_account_key);

-- 3. RLS
ALTER TABLE inventory_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_journal_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view inventory journal" ON inventory_journal;
CREATE POLICY "Org members can view inventory journal" ON inventory_journal
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Org members can write inventory journal" ON inventory_journal;
CREATE POLICY "Org members can write inventory journal" ON inventory_journal
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS "Org members can view inventory journal lines" ON inventory_journal_lines;
CREATE POLICY "Org members can view inventory journal lines" ON inventory_journal_lines
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Org members can write inventory journal lines" ON inventory_journal_lines;
CREATE POLICY "Org members can write inventory journal lines" ON inventory_journal_lines
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

-- 4. updated_at on the header
DROP TRIGGER IF EXISTS trg_inventory_journal_updated_at ON inventory_journal;
CREATE TRIGGER trg_inventory_journal_updated_at
  BEFORE UPDATE ON inventory_journal
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();
