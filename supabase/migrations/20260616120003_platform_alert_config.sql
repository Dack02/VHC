-- =============================================================================
-- Platform alerting configuration: typed alert settings + recipients, and a
-- `source` discriminator on the existing ai_cost_alerts so non-AI alert types
-- share the same inbox + dedup machinery. Forward-only/idempotent.
-- The existing ai_cost_alerts + check_and_create_ai_alert() stay untouched.
-- =============================================================================

ALTER TABLE ai_cost_alerts ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'ai';

CREATE TABLE IF NOT EXISTS platform_alert_settings (
  alert_type     VARCHAR(64) PRIMARY KEY,
  is_enabled     BOOLEAN NOT NULL DEFAULT true,
  threshold      NUMERIC,
  window_minutes INTEGER,
  config         JSONB NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     UUID REFERENCES super_admins(id)
);

CREATE TABLE IF NOT EXISTS platform_alert_recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  alert_types TEXT[] NOT NULL DEFAULT '{}',  -- empty = all types
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES super_admins(id)
);

-- Service-role only (no policies → only the service key, which bypasses RLS, can read/write).
ALTER TABLE platform_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_alert_recipients ENABLE ROW LEVEL SECURITY;

-- Seed default alert types; migrate the existing AI cost threshold in.
INSERT INTO platform_alert_settings (alert_type, is_enabled, threshold, window_minutes) VALUES
  ('ai_platform_cost',   true, (SELECT NULLIF(value, '')::NUMERIC FROM platform_ai_settings WHERE key = 'ai_cost_alert_threshold_usd'), NULL),
  ('comms_failure_rate', true, 10,  60),    -- >10 failed comms in 60 min
  ('org_limit_breach',   true, 100, NULL),  -- 100% of an org limit
  ('worker_down',        true, NULL, 5)     -- no workers for 5 min
ON CONFLICT (alert_type) DO NOTHING;
