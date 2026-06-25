-- =============================================================================
-- Feature/module enablement: per-org override store + plan-default backfill.
--
-- Model: effective module state = org override ?? plan default ?? registry
-- default. Plan defaults live in subscription_plans.features; per-org overrides
-- live in a NEW organization_settings.module_overrides column (a dedicated
-- column, NOT the legacy features_enabled JSONB — which already contains a
-- colliding "dms_integration" key and other descriptive flags).
--
-- Behaviour-neutral on deploy: every module is turned ON for every plan, so the
-- enforcement middleware (requireModule) blocks nothing until a super-admin
-- explicitly disables a module for a plan or org. The legacy per-feature toggles
-- (follow_up_enabled, indirect_time_enabled, library_gap_report_enabled,
-- is_ai_enabled) are NOT touched — they remain each feature's own in-app switch.
-- =============================================================================

-- Per-org module overrides (absent key = inherit plan default).
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS module_overrides JSONB NOT NULL DEFAULT '{}';

-- Plan-level module defaults: turn EVERY module ON for every plan. The merge (||)
-- preserves any existing keys (priority_support, api_access, etc.). These plan
-- feature flags are descriptive only today, so flipping them is behaviour-neutral
-- until requireModule enforcement is wired up.
UPDATE subscription_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'health_checks',      true,
  'workshop_board',     true,
  'follow_up',          true,
  'job_clocking',       true,
  'library_gap_report', true,
  'dms_integration',    true,
  'customer_comms',     true,
  'reports',            true,
  'ai_generation',      true
);
