-- =============================================================================
-- Resource Manager — P1 (technician skills + certifications)
--
-- Adds the per-technician capability matrix (which repair types a tech can do,
-- their primary lane, and a per-day job cap) and gating certifications (MOT
-- tester, EV/HV, F-Gas) with expiry. Powers the advisory "suggest technician"
-- and feeds skill-segmented capacity in P2. Advisory only — nothing gates a
-- booking yet.
--
-- Also extends repair_types with `required_cert` (hard gate for MOT/AC) and
-- `default_estimated_hours` (capacity duration fallback, e.g. for DMS imports).
--
-- Plan: GMS/RESOURCE_MANAGER.md (§5, §7). ADDITIVE ONLY — idempotent, no
-- destructive statements. Deploy via the pipeline (supabase db push).
-- =============================================================================

CREATE OR REPLACE FUNCTION gms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. Technician capability matrix (technician × repair_type) + per-day throttle.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technician_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repair_type_id UUID NOT NULL REFERENCES repair_types(id) ON DELETE CASCADE,
  proficiency SMALLINT NOT NULL DEFAULT 3,        -- 1 apprentice … 5 expert
  is_primary BOOLEAN NOT NULL DEFAULT false,      -- the tech's protected lane
  daily_job_cap SMALLINT,                         -- max jobs/category/tech/day (NULL = ∞)
  daily_job_target SMALLINT,                      -- soft "keep at ~N" target
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (technician_id, repair_type_id)
);

CREATE INDEX IF NOT EXISTS idx_technician_skills_org
  ON technician_skills(organization_id, repair_type_id, is_active);
CREATE INDEX IF NOT EXISTS idx_technician_skills_tech
  ON technician_skills(technician_id, is_active);

DROP TRIGGER IF EXISTS trg_technician_skills_updated_at ON technician_skills;
CREATE TRIGGER trg_technician_skills_updated_at
  BEFORE UPDATE ON technician_skills
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

ALTER TABLE technician_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own org technician skills" ON technician_skills;
CREATE POLICY "Users can view own org technician skills"
  ON technician_skills FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. Gating certifications with expiry (MOT tester, EV/HV, F-Gas, free text).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technician_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cert_type VARCHAR(40) NOT NULL,                 -- mot_tester | ev_hv | f_gas | <free text>
  reference VARCHAR(80),
  issued_date DATE,
  expires_date DATE,                              -- NULL = never expires
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (technician_id, cert_type)
);

CREATE INDEX IF NOT EXISTS idx_technician_certs_tech
  ON technician_certifications(technician_id, cert_type, expires_date);

DROP TRIGGER IF EXISTS trg_technician_certs_updated_at ON technician_certifications;
CREATE TRIGGER trg_technician_certs_updated_at
  BEFORE UPDATE ON technician_certifications
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

ALTER TABLE technician_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own org technician certs" ON technician_certifications;
CREATE POLICY "Users can view own org technician certs"
  ON technician_certifications FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. repair_types: certification gate + capacity duration fallback.
-- ----------------------------------------------------------------------------
ALTER TABLE repair_types
  ADD COLUMN IF NOT EXISTS required_cert VARCHAR(40),
  ADD COLUMN IF NOT EXISTS default_estimated_hours NUMERIC(5,2);

COMMENT ON COLUMN repair_types.required_cert IS 'Cert a tech must hold to be assigned this type (e.g. mot_tester, f_gas). NULL = none.';
COMMENT ON COLUMN repair_types.default_estimated_hours IS 'Fallback job hours for capacity when a booking has no estimate (e.g. DMS imports).';
