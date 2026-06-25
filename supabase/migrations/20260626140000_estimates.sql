-- =============================================================================
-- GMS — Estimates (P1)
--
-- An Estimate is a standalone, pre-booking priced quote that MIRRORS the Jobsheet
-- (its own document, NO inspection required). The advisor builds priced work lines
-- from reg + customer, sends it to the customer to accept, and on acceptance it is
-- converted into a Jobsheet ("Make Jobsheet"). Document model: Estimate -> Jobsheet
-- -> Invoice (Garage Hive lineage).
--
-- An estimate work line *is* a repair_item — we reuse the existing repair engine
-- (repair_labour / repair_parts / pricing triggers / service_packages) exactly as the
-- jobsheet does, by making repair_items.estimate_id another nullable parent.
--
-- Mirrors the jobsheets schema (20260623120000) incl. the draft flow (20260623200000)
-- and the lifecycle/customer-portal fields borrowed from health_checks.
--
-- Safety: additive + idempotent (IF NOT EXISTS / IF EXISTS / DO-blocks). No destructive
-- statements. Re-runnable.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Per-org estimate reference counter (mirrors next_jobsheet_number)
-- ----------------------------------------------------------------------------
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS next_estimate_number INTEGER DEFAULT 1;

-- ----------------------------------------------------------------------------
-- 2. estimates — the standalone quote document
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  reference VARCHAR(20),                    -- auto EST00001 via trigger (skips drafts)
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  advisor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  mileage INTEGER,                          -- optional

  -- Lifecycle (borrowed from the VHC send/response machine)
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft|sent|opened|accepted|partial|declined|expired|converted|cancelled
  valid_until DATE,                         -- "valid until" — drives expiry
  public_token TEXT,                        -- tokenised customer portal access
  token_expires_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  first_opened_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,

  -- Conversion (Make Jobsheet)
  converted_to_jobsheet_id UUID REFERENCES jobsheets(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,

  -- Content
  customer_notes TEXT,                      -- customer-visible
  internal_notes TEXT,                      -- staff-only
  is_draft BOOLEAN NOT NULL DEFAULT true,   -- true while building on the New screen (no ref)

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- "Document Date"
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT estimates_org_reference_unique UNIQUE (organization_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_estimates_org_created
  ON estimates(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_estimates_active
  ON estimates(organization_id, created_at DESC)
  WHERE is_draft = false AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_customer ON estimates(customer_id);
CREATE INDEX IF NOT EXISTS idx_estimates_vehicle ON estimates(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_estimates_public_token
  ON estimates(public_token) WHERE public_token IS NOT NULL;

COMMENT ON COLUMN estimates.created_at IS 'Document creation date/time (automated). Surfaced as the estimate "Document Date".';
COMMENT ON COLUMN estimates.is_draft IS
  'True while an estimate is being built on the New screen (no reference, hidden from lists). Set false on commit, which assigns the EST reference.';
COMMENT ON COLUMN estimates.status IS
  'draft -> sent -> opened -> accepted|partial|declined -> expired; terminal: converted, cancelled.';

-- ----------------------------------------------------------------------------
-- 3. repair_items can hang off an estimate (the reuse hinge — mirrors jobsheet_id)
-- ----------------------------------------------------------------------------
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS estimate_id UUID
  REFERENCES estimates(id) ON DELETE CASCADE;

-- Widen the parent constraint to three parents: VHC, jobsheet, or estimate.
ALTER TABLE repair_items DROP CONSTRAINT IF EXISTS repair_items_parent_chk;
DO $$ BEGIN
  ALTER TABLE repair_items ADD CONSTRAINT repair_items_parent_chk
    CHECK (health_check_id IS NOT NULL OR jobsheet_id IS NOT NULL OR estimate_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_repair_items_estimate
  ON repair_items(estimate_id) WHERE estimate_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Auto-generate estimate reference (EST00001), skipping drafts. Mirrors
--    generate_jobsheet_reference: assigns only when reference IS NULL AND not draft,
--    so committing a draft (is_draft -> false) burns the number.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_estimate_reference()
RETURNS TRIGGER AS $$
DECLARE
  v_next_number INTEGER;
BEGIN
  IF NEW.reference IS NULL AND COALESCE(NEW.is_draft, false) = false THEN
    UPDATE organization_settings
    SET next_estimate_number = COALESCE(next_estimate_number, 1) + 1,
        updated_at = NOW()
    WHERE organization_id = NEW.organization_id
    RETURNING next_estimate_number - 1 INTO v_next_number;

    IF v_next_number IS NULL THEN
      INSERT INTO organization_settings (organization_id, next_estimate_number, created_at, updated_at)
      VALUES (NEW.organization_id, 2, NOW(), NOW())
      ON CONFLICT (organization_id) DO UPDATE
      SET next_estimate_number = COALESCE(organization_settings.next_estimate_number, 1) + 1,
          updated_at = NOW()
      RETURNING next_estimate_number - 1 INTO v_next_number;
    END IF;

    NEW.reference := 'EST' || LPAD(v_next_number::TEXT, 5, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_estimate_reference ON estimates;
CREATE TRIGGER trg_generate_estimate_reference
BEFORE INSERT OR UPDATE ON estimates
FOR EACH ROW
EXECUTE FUNCTION generate_estimate_reference();

-- ----------------------------------------------------------------------------
-- 5. updated_at touch trigger (reuse the GMS helper from the jobsheets migration)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_estimates_updated_at ON estimates;
CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. RLS (API uses service role; policies are defence-in-depth, matching jobsheets)
-- ----------------------------------------------------------------------------
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own org estimates" ON estimates;
CREATE POLICY "Users can view own org estimates"
  ON estimates FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 7. Module default: estimates OFF for every plan (opt-in per org)
-- ----------------------------------------------------------------------------
UPDATE subscription_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('estimates', false);
