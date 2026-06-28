-- =============================================================================
-- Parts module P3 — stocktake_sessions + stocktake_session_lines (GMS/PARTS.md §7.4)
-- =============================================================================
-- Structured stocktake: pick a scope (category / location / supplier / all) → snapshot
-- expected qty (FREEZE) → enter counted qty → system computes per-line variance → commit
-- posts `adjustment` stock_movements with a MANDATORY reason_code + Event 6 journal.
-- The freeze captures expected_qty + unit_cost at session-open so a later movement
-- can't silently rewrite the variance. Additive only.
-- =============================================================================

ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS next_stocktake_number INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS stocktake_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference TEXT,                                   -- ST000001
  location_id UUID REFERENCES stock_locations(id) ON DELETE SET NULL,
  scope_type VARCHAR(16) NOT NULL DEFAULT 'all'     -- all | category | location | supplier
    CHECK (scope_type IN ('all', 'category', 'location', 'supplier')),
  scope_category_id UUID REFERENCES part_categories(id) ON DELETE SET NULL,
  scope_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'counting'    -- counting | committed | cancelled
    CHECK (status IN ('counting', 'committed', 'cancelled')),
  notes TEXT,
  line_count INTEGER NOT NULL DEFAULT 0,
  variance_value DECIMAL(12,2) NOT NULL DEFAULT 0,  -- net £ variance at commit (+found / -shrinkage)
  committed_at TIMESTAMPTZ,
  committed_by UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stocktake_session_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stocktake_session_id UUID NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES parts_catalog(id) ON DELETE CASCADE,
  part_number TEXT,
  description TEXT,
  expected_qty DECIMAL(12,3) NOT NULL DEFAULT 0,    -- FROZEN at session open
  counted_qty DECIMAL(12,3),                        -- NULL until entered
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,       -- FROZEN avg cost at session open
  variance_qty DECIMAL(12,3) NOT NULL DEFAULT 0,    -- counted - expected (computed on entry)
  reason_code VARCHAR(40),                          -- mandatory on commit when variance <> 0
  movement_id UUID REFERENCES stock_movements(id) ON DELETE SET NULL,  -- the adjustment posted at commit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (stocktake_session_id, stock_item_id)
);

CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_org    ON stocktake_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_status ON stocktake_sessions(organization_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stocktake_reference_per_org
  ON stocktake_sessions(organization_id, reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_session ON stocktake_session_lines(stocktake_session_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_org     ON stocktake_session_lines(organization_id);

ALTER TABLE stocktake_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktake_session_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members manage stocktake sessions" ON stocktake_sessions;
CREATE POLICY "Org members manage stocktake sessions" ON stocktake_sessions
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Org members manage stocktake lines" ON stocktake_session_lines;
CREATE POLICY "Org members manage stocktake lines" ON stocktake_session_lines
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Per-org stocktake-reference generator (atomic; mirrors next_supplier_return_number).
CREATE OR REPLACE FUNCTION next_stocktake_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE organization_settings
  SET next_stocktake_number = COALESCE(next_stocktake_number, 1) + 1, updated_at = NOW()
  WHERE organization_id = p_org_id
  RETURNING next_stocktake_number - 1 INTO v_next;

  IF v_next IS NULL THEN
    INSERT INTO organization_settings (organization_id, next_stocktake_number, created_at, updated_at)
    VALUES (p_org_id, 2, NOW(), NOW())
    ON CONFLICT (organization_id) DO UPDATE
    SET next_stocktake_number = COALESCE(organization_settings.next_stocktake_number, 1) + 1, updated_at = NOW()
    RETURNING next_stocktake_number - 1 INTO v_next;
  END IF;

  RETURN 'ST' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;
