-- =============================================================================
-- GMS — Estimates default ON
--
-- The original estimates migration (20260626140000) seeded the plan feature
-- `estimates = false` (opt-in). Leo has since decided Estimates should be available
-- to every org by default (unlike Jobsheets, which stays opt-in). The plan-level
-- feature flag wins over the module registry's defaultOn, so flip it to true here.
--
-- Resolution order: org override (organization_settings.module_overrides) → plan
-- default (subscription_plans.features) → registry defaultOn. Orgs that have an
-- explicit override keep it; everyone else now resolves Estimates ON.
--
-- Additive + idempotent. No destructive statements.
-- =============================================================================

UPDATE subscription_plans
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('estimates', true);
