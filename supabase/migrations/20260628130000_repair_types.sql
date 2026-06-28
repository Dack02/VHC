-- =============================================================================
-- Repair Types (Phase 1 — Foundation)
--
-- Introduces "Repair Type": an org-scoped, single-select classification chosen
-- PER WORK GROUP when pricing (Clutch, Suspension, Service, MOT, Diagnostic…).
-- It will drive the labour rate (each type points at a default labour code) and
-- power repair-type revenue/mix reporting. Plan: GMS/REPAIR_TYPES.md.
--
-- This migration is ADDITIVE ONLY (P1 foundation + the inert columns later phases
-- need so we only migrate once). No behaviour change ships until the API/UI wire it.
--
-- New objects:
--   - repair_types                      (org-scoped lookup; soft-delete; default_labour_code_id)
--   - repair_items.repair_type_id       (the per-work-group attach point; resolve-upward)
--   - template_items.repair_type_id     (P3 VHC default — inert until wired)
--   - service_packages.default_repair_type_id (P2.5 package type — inert until wired)
--
-- Safety: all idempotent (IF NOT EXISTS / DO NOTHING). No destructive statements.
-- NOTE: deploy via the pipeline (supabase db push), never out-of-band MCP SQL.
-- =============================================================================

-- gms_set_updated_at() already exists (jobsheets migration); redefine idempotently
-- so this migration is self-contained.
CREATE OR REPLACE FUNCTION gms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. Lookup: repair_types (single-select per work group)
--    Mirrors service_types, plus default_labour_code_id (the labour feed).
--    Soft-delete via is_active so historical reports keep a resolvable type.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  label TEXT,
  colour VARCHAR(7) NOT NULL DEFAULT '#6366F1',
  default_labour_code_id UUID REFERENCES labour_codes(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_repair_types_org
  ON repair_types(organization_id, is_active, sort_order);

DROP TRIGGER IF EXISTS trg_repair_types_updated_at ON repair_types;
CREATE TRIGGER trg_repair_types_updated_at
  BEFORE UPDATE ON repair_types
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

ALTER TABLE repair_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own org repair types" ON repair_types;
CREATE POLICY "Users can view own org repair types"
  ON repair_types FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. Attach point on the work group (resolve-upward: only the top-level row
--    carries a type; children/options climb to the parent for their rate).
-- ----------------------------------------------------------------------------
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS repair_type_id UUID
  REFERENCES repair_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_repair_items_repair_type
  ON repair_items(repair_type_id) WHERE repair_type_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. VHC template default (P3 — inert until TemplateBuilder + derivation wire it)
-- ----------------------------------------------------------------------------
ALTER TABLE template_items ADD COLUMN IF NOT EXISTS repair_type_id UUID
  REFERENCES repair_types(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 4. Service-package default type (P2.5 — inert until package CRUD/apply wire it)
-- ----------------------------------------------------------------------------
ALTER TABLE service_packages ADD COLUMN IF NOT EXISTS default_repair_type_id UUID
  REFERENCES repair_types(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 5. Seed sensible UK defaults for existing orgs, each mapped to a labour code.
--    default_labour_code_id resolves per org via LEFT JOIN (NULL if the code is
--    absent — harmless, the type is still usable once a code is assigned).
--    New orgs are lazy-seeded by the API on first fetch (same defaults + mapping).
-- ----------------------------------------------------------------------------
INSERT INTO repair_types (organization_id, code, label, colour, sort_order, default_labour_code_id)
SELECT o.id, v.code, v.label, v.colour, v.sort_order, lc.id
FROM organizations o
CROSS JOIN (VALUES
  ('Service',          'Service',           '#16A34A', 10, 'LAB'),
  ('MOT',              'MOT',               '#EF4444', 20, 'MOT'),
  ('Diagnostic',       'Diagnostic',        '#6366F1', 30, 'DIAG'),
  ('Tyres',            'Tyres',             '#0EA5E9', 40, 'LAB'),
  ('Brakes',           'Brakes',            '#F97316', 50, 'LAB'),
  ('Suspension',       'Suspension',        '#8B5CF6', 60, 'LAB'),
  ('Clutch',           'Clutch',            '#0D9488', 70, 'LAB'),
  ('Air Conditioning', 'Air Conditioning',  '#06B6D4', 80, 'LAB')
) AS v(code, label, colour, sort_order, labour_code)
LEFT JOIN labour_codes lc
  ON lc.organization_id = o.id AND lc.code = v.labour_code AND lc.is_active = true
ON CONFLICT (organization_id, code) DO NOTHING;
