-- =============================================================================
-- Parts module P3 — pricing_matrix + pricing_matrix_bands (the banded markup engine) (GMS/PARTS.md §5.12)
-- =============================================================================
-- The deferred sell-price upgrade (decision 7). v1/P0 used a FLAT markup
-- (cost × default_margin_percent). This adds a cost-banded markup table so cheap
-- parts carry a higher markup (research: +8–10% blended margin). Precedence once
-- live: job-line override → item sell_price_override → matrix → flat fallback.
-- The matrix is OPTIONAL per org and gated by organization_settings.pricing_matrix_enabled
-- (default FALSE) — existing orgs keep their flat markup until they explicitly opt in,
-- so this deploy does NOT silently shift anyone's margins. Additive only.
-- =============================================================================

-- Master switch: the banded engine only applies when this is TRUE (default off).
ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS pricing_matrix_enabled BOOLEAN NOT NULL DEFAULT false;

-- One matrix per org by default; an optional per-category matrix can override it.
CREATE TABLE IF NOT EXISTS pricing_matrix (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  category_id UUID REFERENCES part_categories(id) ON DELETE CASCADE,  -- NULL = org default matrix
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pricing_matrix_bands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pricing_matrix_id UUID NOT NULL REFERENCES pricing_matrix(id) ON DELETE CASCADE,
  cost_from DECIMAL(10,2) NOT NULL DEFAULT 0,       -- inclusive lower bound
  cost_to DECIMAL(10,2),                            -- NULL = open-ended top band
  markup_pct DECIMAL(6,2),                          -- one of markup_pct / multiplier populated
  multiplier DECIMAL(6,3),                          -- e.g. ×2.0 on cheap parts
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_matrix_org      ON pricing_matrix(organization_id);
CREATE INDEX IF NOT EXISTS idx_pricing_matrix_category ON pricing_matrix(organization_id, category_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pricing_matrix_name ON pricing_matrix(organization_id, name);
-- Exactly one default matrix per org (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pricing_matrix_default
  ON pricing_matrix(organization_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_pricing_matrix_bands_matrix ON pricing_matrix_bands(pricing_matrix_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pricing_matrix_bands_org    ON pricing_matrix_bands(organization_id);

ALTER TABLE pricing_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_matrix_bands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members manage pricing matrix" ON pricing_matrix;
CREATE POLICY "Org members manage pricing matrix" ON pricing_matrix
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
DROP POLICY IF EXISTS "Org members manage pricing matrix bands" ON pricing_matrix_bands;
CREATE POLICY "Org members manage pricing matrix bands" ON pricing_matrix_bands
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Seed the garage-sensible default bands (§5.12): higher markup on cheap parts.
-- £0–10 ×2.0 / £10–100 ×1.6 / £100+ ×1.4. Idempotent: only creates a matrix if the
-- org has none. Called from provisioning for new orgs + backfilled below.
CREATE OR REPLACE FUNCTION seed_default_pricing_matrix_for_org(p_organization_id UUID)
RETURNS void AS $$
DECLARE
  v_matrix_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM pricing_matrix WHERE organization_id = p_organization_id) THEN
    RETURN;
  END IF;

  INSERT INTO pricing_matrix (organization_id, name, category_id, is_default, is_active)
  VALUES (p_organization_id, 'Default markup matrix', NULL, true, true)
  RETURNING id INTO v_matrix_id;

  INSERT INTO pricing_matrix_bands (organization_id, pricing_matrix_id, cost_from, cost_to, multiplier, markup_pct, sort_order)
  VALUES
    (p_organization_id, v_matrix_id, 0,   10,   2.0, NULL, 1),
    (p_organization_id, v_matrix_id, 10,  100,  1.6, NULL, 2),
    (p_organization_id, v_matrix_id, 100, NULL, 1.4, NULL, 3);
END;
$$ LANGUAGE plpgsql;

-- Backfill: seed the default matrix + bands for every existing org that has none, so the
-- bands are pre-populated when an org flips pricing_matrix_enabled on. The engine stays
-- OFF (pricing_matrix_enabled defaults false) — seeding here changes no live pricing.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organizations LOOP
    PERFORM seed_default_pricing_matrix_for_org(r.id);
  END LOOP;
END $$;
