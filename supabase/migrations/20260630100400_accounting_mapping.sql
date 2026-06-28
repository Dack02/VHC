-- =============================================================================
-- Parts module — GL mapping layer (GMS/PARTS.md §5.11). Inert until a provider
-- connects. Xero is the confirmed first provider, so default code seeds mirror
-- Xero's UK chart, each marked "remap on connect".
-- Additive only.
-- =============================================================================

-- 1. accounting_connections — per-org connected provider (inert until keyed)
CREATE TABLE IF NOT EXISTS accounting_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('xero', 'qbo', 'sage')),
  tenant_ref TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connected', 'error', 'expired')),
  default_currency TEXT NOT NULL DEFAULT 'GBP',
  connected_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_accounting_connection_per_org_provider UNIQUE (organization_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_accounting_connections_org ON accounting_connections(organization_id);

-- 2. account_code_map — internal_account_key -> provider account code.
--    connection_id NULL = the inert per-org default (placeholder) mapping.
CREATE TABLE IF NOT EXISTS account_code_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES accounting_connections(id) ON DELETE CASCADE,
  internal_account_key TEXT NOT NULL,
  provider_account_code TEXT,
  provider_account_id TEXT,
  is_placeholder BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_code_map_default
  ON account_code_map(organization_id, internal_account_key) WHERE connection_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_code_map_conn
  ON account_code_map(connection_id, internal_account_key) WHERE connection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_code_map_org ON account_code_map(organization_id);

-- 3. tax_code_map — internal_tax_key -> rate + provider tax type
CREATE TABLE IF NOT EXISTS tax_code_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES accounting_connections(id) ON DELETE CASCADE,
  internal_tax_key TEXT NOT NULL,
  rate_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  provider_tax_type TEXT,
  is_placeholder BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tax_code_map_default
  ON tax_code_map(organization_id, internal_tax_key) WHERE connection_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tax_code_map_conn
  ON tax_code_map(connection_id, internal_tax_key) WHERE connection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tax_code_map_org ON tax_code_map(organization_id);

-- 4. contact_links — party -> provider contact (reuse, never recreate)
CREATE TABLE IF NOT EXISTS contact_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES accounting_connections(id) ON DELETE CASCADE,
  party_type TEXT NOT NULL CHECK (party_type IN ('supplier', 'customer')),
  party_id UUID NOT NULL,
  provider_contact_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_contact_link UNIQUE (connection_id, party_type, party_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_links_org ON contact_links(organization_id);

-- 5. journal_push_log — per-push idempotency (the PROVIDER token lives here, never
--    on the journal header). A sale's ACCREC and its bill's ACCPAY are distinct.
CREATE TABLE IF NOT EXISTS journal_push_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES inventory_journal(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES accounting_connections(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,        -- ACCREC | ACCPAY | ACCPAYCREDIT | manual_journal
  external_idempotency_key TEXT NOT NULL,
  provider_document_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pushed', 'error', 'skipped')),
  error_message TEXT,
  pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_journal_push_idempotency UNIQUE (connection_id, external_idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_journal_push_log_org     ON journal_push_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_journal_push_log_journal ON journal_push_log(journal_id);

-- 6. RLS (view for org members; writes go through service-role/server)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_connections','account_code_map','tax_code_map','contact_links','journal_push_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Org members can view %1$s" ON %1$s', t);
    EXECUTE format($p$CREATE POLICY "Org members can view %1$s" ON %1$s FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid)$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS "Org members can write %1$s" ON %1$s', t);
    EXECUTE format($p$CREATE POLICY "Org members can write %1$s" ON %1$s FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid) WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid)$p$, t);
  END LOOP;
END;
$$;

-- 7. updated_at touch triggers
DROP TRIGGER IF EXISTS trg_accounting_connections_updated_at ON accounting_connections;
CREATE TRIGGER trg_accounting_connections_updated_at BEFORE UPDATE ON accounting_connections
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();
DROP TRIGGER IF EXISTS trg_account_code_map_updated_at ON account_code_map;
CREATE TRIGGER trg_account_code_map_updated_at BEFORE UPDATE ON account_code_map
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();
DROP TRIGGER IF EXISTS trg_tax_code_map_updated_at ON tax_code_map;
CREATE TRIGGER trg_tax_code_map_updated_at BEFORE UPDATE ON tax_code_map
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();
DROP TRIGGER IF EXISTS trg_contact_links_updated_at ON contact_links;
CREATE TRIGGER trg_contact_links_updated_at BEFORE UPDATE ON contact_links
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- 8. Seeders — placeholder Xero UK chart defaults (connection_id NULL), "remap on connect"
CREATE OR REPLACE FUNCTION seed_default_account_code_map_for_org(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO account_code_map (organization_id, internal_account_key, provider_account_code, is_placeholder)
  VALUES
    (p_organization_id, 'parts_stock',             '630', true),  -- Inventory (current asset)
    (p_organization_id, 'parts_wip',               '631', true),  -- WIP / uninvoiced parts cost (placeholder)
    (p_organization_id, 'accounts_payable',        '800', true),  -- Accounts Payable
    (p_organization_id, 'accounts_receivable',     '610', true),  -- Accounts Receivable
    (p_organization_id, 'vat_input',               '820', true),  -- VAT
    (p_organization_id, 'vat_output',              '820', true),  -- VAT
    (p_organization_id, 'parts_sales',             '200', true),  -- Sales
    (p_organization_id, 'parts_cogs',              '310', true),  -- Cost of Goods Sold
    (p_organization_id, 'purchase_price_variance', '312', true),  -- PPV (placeholder)
    (p_organization_id, 'stock_adjustment',        '313', true),  -- Stock adjustment / write-off (placeholder)
    (p_organization_id, 'core_liability',          '835', true)   -- Core deposits (placeholder liability)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION seed_default_tax_code_map_for_org(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO tax_code_map (organization_id, internal_tax_key, rate_percent, provider_tax_type, is_placeholder)
  VALUES
    (p_organization_id, 'STD_20', 20.00, NULL, true),  -- provider_tax_type resolved by direction at push (P4)
    (p_organization_id, 'ZERO',    0.00, NULL, true),
    (p_organization_id, 'EXEMPT',  0.00, NULL, true),
    (p_organization_id, 'NO_VAT',  0.00, NULL, true)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 9. Backfill existing orgs
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    PERFORM seed_default_account_code_map_for_org(org_record.id);
    PERFORM seed_default_tax_code_map_for_org(org_record.id);
  END LOOP;
END;
$$;
