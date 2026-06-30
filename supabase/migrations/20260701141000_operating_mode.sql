-- TECH_JOB_MODEL.md P0 — Operating mode (VHC-only vs full GMS)
-- Mirrors the parts_mode <- parts_stock precedent: the `jobsheets` module is the
-- super-admin master gate; operating_mode is a coerced reflection of it.
-- The MODULE gates the MODE (never the reverse). Coercion lives in the org-settings
-- read/write path + the admin module-toggle handler, NOT in services/modules.ts.
--
-- Additive + idempotent. No destructive operations. No shell-jobsheet backfill here
-- (that is a separate P2 data event, deliberately deferred).

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS operating_mode TEXT NOT NULL DEFAULT 'vhc_only'
    CHECK (operating_mode IN ('vhc_only', 'gms'));

COMMENT ON COLUMN organization_settings.operating_mode IS
  'VHC-only vs full GMS chrome. Coerced from the jobsheets module (module on => gms, off => vhc_only). Read-time COALESCE to vhc_only for row-less orgs. See GMS/TECH_JOB_MODEL.md §4.';

-- Seed existing GMS orgs so they are not silently downgraded to vhc_only.
-- `jobsheets` is override-only (absent from subscription_plans.features, registry
-- defaultOn:false), so module_overrides->>'jobsheets'='true' captures every org that
-- currently has the module enabled. These orgs definitionally already have a settings
-- row (the override lives on it). Row-less orgs are vhc_only by read-time coalesce.
UPDATE organization_settings
   SET operating_mode = 'gms',
       updated_at = NOW()
 WHERE module_overrides->>'jobsheets' = 'true'
   AND operating_mode <> 'gms';
