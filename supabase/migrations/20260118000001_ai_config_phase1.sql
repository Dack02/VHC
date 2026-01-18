-- =============================================================================
-- AI Configuration Phase 1: Database & Core Functions
-- Provides platform AI configuration, per-org limits, and usage tracking
-- =============================================================================

-- =============================================================================
-- 1. PLATFORM AI SETTINGS TABLE (Key-Value Structure)
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_ai_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,  -- Encrypted for sensitive values
  is_encrypted BOOLEAN DEFAULT false,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES super_admins(id)
);

-- Seed default AI settings
INSERT INTO platform_ai_settings (key, value, is_encrypted, description) VALUES
  ('anthropic_api_key', NULL, true, 'Anthropic API key for AI generation'),
  ('ai_enabled', 'true', false, 'Global toggle for AI features'),
  ('default_monthly_ai_limit', '100', false, 'Default AI generations per org per month'),
  ('ai_cost_alert_threshold_usd', '50', false, 'Alert when monthly cost exceeds this'),
  ('ai_model', 'claude-sonnet-4-20250514', false, 'Default AI model to use')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. ORGANIZATION AI SETTINGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_ai_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  -- Limits
  monthly_generation_limit INTEGER,  -- NULL = use platform default
  is_ai_enabled BOOLEAN DEFAULT true,  -- Org-level toggle

  -- Current period tracking (denormalized for quick checks)
  current_period_start DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE),
  current_period_generations INTEGER DEFAULT 0,
  current_period_tokens INTEGER DEFAULT 0,
  current_period_cost_usd NUMERIC(10, 4) DEFAULT 0,

  -- Lifetime stats
  total_generations INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd NUMERIC(10, 4) DEFAULT 0,

  -- Alerts
  limit_warning_sent_at TIMESTAMPTZ,  -- When 80% warning was sent
  limit_reached_sent_at TIMESTAMPTZ,  -- When 100% notification was sent

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 3. AI USAGE LOGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  -- What was done
  action VARCHAR(50) NOT NULL,  -- 'generate_reasons', 'regenerate_descriptions', 'generate_bulk'

  -- Context (no FK constraints - these are optional reference fields for logging)
  template_id UUID,
  template_item_id UUID,
  reason_type VARCHAR(50),
  item_reason_id UUID,

  -- AI details
  model VARCHAR(100) NOT NULL,
  prompt_summary TEXT,  -- Brief description, not full prompt (for debugging)

  -- Token usage
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,

  -- Cost calculation (based on model pricing)
  input_cost_usd NUMERIC(10, 6),
  output_cost_usd NUMERIC(10, 6),
  total_cost_usd NUMERIC(10, 6),

  -- Result
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  items_generated INTEGER,  -- Number of reasons created

  -- Timing
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for ai_usage_logs
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_org ON ai_usage_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_org_date ON ai_usage_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_action ON ai_usage_logs(action);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON ai_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_template ON ai_usage_logs(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_template_item ON ai_usage_logs(template_item_id) WHERE template_item_id IS NOT NULL;

-- =============================================================================
-- 4. AI MODEL PRICING TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_model_pricing (
  model VARCHAR(100) PRIMARY KEY,
  input_cost_per_1m_tokens NUMERIC(10, 4) NOT NULL,
  output_cost_per_1m_tokens NUMERIC(10, 4) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,  -- NULL = current
  notes TEXT
);

-- Seed current Anthropic pricing
INSERT INTO ai_model_pricing (model, input_cost_per_1m_tokens, output_cost_per_1m_tokens, effective_from, notes) VALUES
  ('claude-sonnet-4-20250514', 3.00, 15.00, '2025-01-01', 'Claude Sonnet 4'),
  ('claude-haiku-4-5-20251001', 0.80, 4.00, '2025-01-01', 'Claude Haiku 4.5 - faster, cheaper')
ON CONFLICT (model) DO UPDATE SET
  input_cost_per_1m_tokens = EXCLUDED.input_cost_per_1m_tokens,
  output_cost_per_1m_tokens = EXCLUDED.output_cost_per_1m_tokens,
  effective_from = EXCLUDED.effective_from,
  notes = EXCLUDED.notes;

-- =============================================================================
-- 5. AI COST ALERTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_cost_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_type VARCHAR(50) NOT NULL,  -- 'org_limit_warning', 'org_limit_reached', 'platform_cost_alert'
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Context
  threshold_value NUMERIC,
  current_value NUMERIC,
  message TEXT,

  -- Status
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_cost_alerts_org ON ai_cost_alerts(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_cost_alerts_type ON ai_cost_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_ai_cost_alerts_created ON ai_cost_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cost_alerts_unacked ON ai_cost_alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

-- =============================================================================
-- 6. HELPER FUNCTION: get_org_ai_limit
-- Returns the effective AI generation limit for an organization
-- =============================================================================

CREATE OR REPLACE FUNCTION get_org_ai_limit(p_organization_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_org_limit INTEGER;
  v_default_limit INTEGER;
BEGIN
  -- Get org-specific limit
  SELECT monthly_generation_limit INTO v_org_limit
  FROM organization_ai_settings
  WHERE organization_id = p_organization_id;

  -- If set, use it
  IF v_org_limit IS NOT NULL THEN
    RETURN v_org_limit;
  END IF;

  -- Otherwise, get platform default
  SELECT value::INTEGER INTO v_default_limit
  FROM platform_ai_settings
  WHERE key = 'default_monthly_ai_limit';

  RETURN COALESCE(v_default_limit, 100);
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- 7. HELPER FUNCTION: can_org_generate_ai
-- Checks if org can generate (within limits, AI enabled)
-- =============================================================================

CREATE OR REPLACE FUNCTION can_org_generate_ai(p_organization_id UUID)
RETURNS TABLE (
  allowed BOOLEAN,
  reason TEXT,
  current_usage INTEGER,
  limit_value INTEGER,
  percentage_used NUMERIC
) AS $$
DECLARE
  v_global_enabled BOOLEAN;
  v_org_enabled BOOLEAN;
  v_limit INTEGER;
  v_current INTEGER;
  v_period_start DATE;
BEGIN
  -- Check global AI enabled
  SELECT value::BOOLEAN INTO v_global_enabled
  FROM platform_ai_settings WHERE key = 'ai_enabled';

  IF NOT COALESCE(v_global_enabled, true) THEN
    RETURN QUERY SELECT false, 'AI features are disabled platform-wide'::TEXT, 0, 0, 0::NUMERIC;
    RETURN;
  END IF;

  -- Check org AI enabled
  SELECT is_ai_enabled INTO v_org_enabled
  FROM organization_ai_settings
  WHERE organization_id = p_organization_id;

  IF NOT COALESCE(v_org_enabled, true) THEN
    RETURN QUERY SELECT false, 'AI features are disabled for your organization'::TEXT, 0, 0, 0::NUMERIC;
    RETURN;
  END IF;

  -- Get limit
  v_limit := get_org_ai_limit(p_organization_id);

  -- Get current usage (reset if new month)
  SELECT current_period_start, current_period_generations
  INTO v_period_start, v_current
  FROM organization_ai_settings
  WHERE organization_id = p_organization_id;

  -- If no record or new month, current = 0
  IF v_period_start IS NULL OR v_period_start < DATE_TRUNC('month', CURRENT_DATE) THEN
    v_current := 0;
  END IF;

  v_current := COALESCE(v_current, 0);

  -- Check limit
  IF v_current >= v_limit THEN
    RETURN QUERY SELECT
      false,
      format('Monthly AI generation limit reached (%s/%s)', v_current, v_limit)::TEXT,
      v_current,
      v_limit,
      100::NUMERIC;
    RETURN;
  END IF;

  -- Allowed
  RETURN QUERY SELECT
    true,
    NULL::TEXT,
    v_current,
    v_limit,
    ROUND((v_current::NUMERIC / NULLIF(v_limit, 0)) * 100, 1);
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- 8. HELPER FUNCTION: record_ai_usage
-- Records AI usage and updates org stats with cost calculation
-- =============================================================================

CREATE OR REPLACE FUNCTION record_ai_usage(
  p_organization_id UUID,
  p_user_id UUID,
  p_action VARCHAR(50),
  p_model VARCHAR(100),
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_items_generated INTEGER DEFAULT 1,
  p_template_id UUID DEFAULT NULL,
  p_template_item_id UUID DEFAULT NULL,
  p_reason_type VARCHAR(50) DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL,
  p_success BOOLEAN DEFAULT true,
  p_error_message TEXT DEFAULT NULL,
  p_prompt_summary TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
  v_input_cost NUMERIC;
  v_output_cost NUMERIC;
  v_total_cost NUMERIC;
  v_input_rate NUMERIC;
  v_output_rate NUMERIC;
BEGIN
  -- Get pricing for model
  SELECT input_cost_per_1m_tokens, output_cost_per_1m_tokens
  INTO v_input_rate, v_output_rate
  FROM ai_model_pricing
  WHERE model = p_model
    AND effective_to IS NULL;

  -- Default pricing if not found (Claude Sonnet 4 pricing)
  v_input_rate := COALESCE(v_input_rate, 3.00);
  v_output_rate := COALESCE(v_output_rate, 15.00);

  -- Calculate costs
  v_input_cost := (p_input_tokens::NUMERIC / 1000000) * v_input_rate;
  v_output_cost := (p_output_tokens::NUMERIC / 1000000) * v_output_rate;
  v_total_cost := v_input_cost + v_output_cost;

  -- Insert log
  INSERT INTO ai_usage_logs (
    organization_id, user_id, action, model,
    input_tokens, output_tokens,
    input_cost_usd, output_cost_usd, total_cost_usd,
    items_generated, duration_ms,
    template_id, template_item_id, reason_type,
    success, error_message, prompt_summary
  ) VALUES (
    p_organization_id, p_user_id, p_action, p_model,
    p_input_tokens, p_output_tokens,
    v_input_cost, v_output_cost, v_total_cost,
    p_items_generated, p_duration_ms,
    p_template_id, p_template_item_id, p_reason_type,
    p_success, p_error_message, p_prompt_summary
  ) RETURNING id INTO v_log_id;

  -- Update org stats (upsert)
  INSERT INTO organization_ai_settings (
    organization_id,
    current_period_start,
    current_period_generations,
    current_period_tokens,
    current_period_cost_usd,
    total_generations,
    total_tokens,
    total_cost_usd
  ) VALUES (
    p_organization_id,
    DATE_TRUNC('month', CURRENT_DATE),
    1,
    p_input_tokens + p_output_tokens,
    v_total_cost,
    1,
    p_input_tokens + p_output_tokens,
    v_total_cost
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    -- Reset if new month
    current_period_start = CASE
      WHEN organization_ai_settings.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
      THEN DATE_TRUNC('month', CURRENT_DATE)
      ELSE organization_ai_settings.current_period_start
    END,
    current_period_generations = CASE
      WHEN organization_ai_settings.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
      THEN 1
      ELSE organization_ai_settings.current_period_generations + 1
    END,
    current_period_tokens = CASE
      WHEN organization_ai_settings.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
      THEN p_input_tokens + p_output_tokens
      ELSE organization_ai_settings.current_period_tokens + p_input_tokens + p_output_tokens
    END,
    current_period_cost_usd = CASE
      WHEN organization_ai_settings.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
      THEN v_total_cost
      ELSE organization_ai_settings.current_period_cost_usd + v_total_cost
    END,
    total_generations = organization_ai_settings.total_generations + 1,
    total_tokens = organization_ai_settings.total_tokens + p_input_tokens + p_output_tokens,
    total_cost_usd = organization_ai_settings.total_cost_usd + v_total_cost,
    updated_at = NOW();

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 9. HELPER FUNCTION: get_ai_setting
-- Retrieves a platform AI setting (for non-encrypted values)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_ai_setting(p_key VARCHAR(100))
RETURNS TEXT AS $$
DECLARE
  v_value TEXT;
  v_is_encrypted BOOLEAN;
BEGIN
  SELECT value, is_encrypted INTO v_value, v_is_encrypted
  FROM platform_ai_settings
  WHERE key = p_key;

  -- Don't return encrypted values via this function
  IF v_is_encrypted THEN
    RETURN NULL;
  END IF;

  RETURN v_value;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- 10. RLS POLICIES
-- =============================================================================

-- Platform AI settings: Super admin only (accessed via service role)
ALTER TABLE platform_ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_ai_settings_service_only" ON platform_ai_settings;
CREATE POLICY "platform_ai_settings_service_only" ON platform_ai_settings
  FOR ALL USING (false);  -- Accessed only via service role

-- Organization AI settings: Org admins can view own, super admin all via service role
ALTER TABLE organization_ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_ai_settings_view_own" ON organization_ai_settings;
CREATE POLICY "org_ai_settings_view_own" ON organization_ai_settings
  FOR SELECT USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
  );

DROP POLICY IF EXISTS "org_ai_settings_update_own" ON organization_ai_settings;
CREATE POLICY "org_ai_settings_update_own" ON organization_ai_settings
  FOR UPDATE USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
  );

-- AI usage logs: Org admins can view own, system inserts via service role
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage_logs_view_own" ON ai_usage_logs;
CREATE POLICY "ai_usage_logs_view_own" ON ai_usage_logs
  FOR SELECT USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
  );

-- Note: INSERT is handled via service role by record_ai_usage function

-- AI model pricing: Readable by all (reference data)
ALTER TABLE ai_model_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_model_pricing_read_all" ON ai_model_pricing;
CREATE POLICY "ai_model_pricing_read_all" ON ai_model_pricing
  FOR SELECT USING (true);

-- AI cost alerts: Org-specific or platform-wide
ALTER TABLE ai_cost_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_cost_alerts_view_own" ON ai_cost_alerts;
CREATE POLICY "ai_cost_alerts_view_own" ON ai_cost_alerts
  FOR SELECT USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    OR organization_id IS NULL  -- Platform-wide alerts visible to all
  );

DROP POLICY IF EXISTS "ai_cost_alerts_update_own" ON ai_cost_alerts;
CREATE POLICY "ai_cost_alerts_update_own" ON ai_cost_alerts
  FOR UPDATE USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
  );

-- =============================================================================
-- 11. TRIGGER: Update organization_ai_settings.updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION update_org_ai_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_org_ai_settings_updated ON organization_ai_settings;
CREATE TRIGGER trigger_org_ai_settings_updated
  BEFORE UPDATE ON organization_ai_settings
  FOR EACH ROW EXECUTE FUNCTION update_org_ai_settings_timestamp();

-- =============================================================================
-- 12. HELPER FUNCTION: check_and_create_ai_alert
-- Creates an alert if threshold is reached (with deduplication)
-- =============================================================================

CREATE OR REPLACE FUNCTION check_and_create_ai_alert(
  p_alert_type VARCHAR(50),
  p_organization_id UUID,
  p_threshold_value NUMERIC,
  p_current_value NUMERIC,
  p_message TEXT
)
RETURNS UUID AS $$
DECLARE
  v_alert_id UUID;
  v_existing_id UUID;
BEGIN
  -- Check if unacknowledged alert of same type exists for this org this month
  SELECT id INTO v_existing_id
  FROM ai_cost_alerts
  WHERE alert_type = p_alert_type
    AND (organization_id = p_organization_id OR (organization_id IS NULL AND p_organization_id IS NULL))
    AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
    AND acknowledged_at IS NULL
  LIMIT 1;

  -- If exists, return existing ID (no duplicate alert)
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Create new alert
  INSERT INTO ai_cost_alerts (
    alert_type, organization_id, threshold_value, current_value, message
  ) VALUES (
    p_alert_type, p_organization_id, p_threshold_value, p_current_value, p_message
  ) RETURNING id INTO v_alert_id;

  RETURN v_alert_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 13. HELPER FUNCTION: get_org_ai_usage_summary
-- Returns a summary of org's current AI usage
-- =============================================================================

CREATE OR REPLACE FUNCTION get_org_ai_usage_summary(p_organization_id UUID)
RETURNS TABLE (
  current_period_start DATE,
  current_generations INTEGER,
  current_tokens INTEGER,
  current_cost_usd NUMERIC,
  total_generations INTEGER,
  total_tokens INTEGER,
  total_cost_usd NUMERIC,
  monthly_limit INTEGER,
  percentage_used NUMERIC,
  is_ai_enabled BOOLEAN,
  limit_warning_sent BOOLEAN,
  limit_reached_sent BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(
      CASE WHEN oas.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
           THEN DATE_TRUNC('month', CURRENT_DATE)::DATE
           ELSE oas.current_period_start
      END,
      DATE_TRUNC('month', CURRENT_DATE)::DATE
    ) as current_period_start,
    COALESCE(
      CASE WHEN oas.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
           THEN 0
           ELSE oas.current_period_generations
      END,
      0
    )::INTEGER as current_generations,
    COALESCE(
      CASE WHEN oas.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
           THEN 0
           ELSE oas.current_period_tokens
      END,
      0
    )::INTEGER as current_tokens,
    COALESCE(
      CASE WHEN oas.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
           THEN 0
           ELSE oas.current_period_cost_usd
      END,
      0
    ) as current_cost_usd,
    COALESCE(oas.total_generations, 0)::INTEGER as total_generations,
    COALESCE(oas.total_tokens, 0)::INTEGER as total_tokens,
    COALESCE(oas.total_cost_usd, 0) as total_cost_usd,
    get_org_ai_limit(p_organization_id) as monthly_limit,
    ROUND(
      COALESCE(
        CASE WHEN oas.current_period_start < DATE_TRUNC('month', CURRENT_DATE)
             THEN 0
             ELSE oas.current_period_generations
        END,
        0
      )::NUMERIC / NULLIF(get_org_ai_limit(p_organization_id), 0) * 100,
      1
    ) as percentage_used,
    COALESCE(oas.is_ai_enabled, true) as is_ai_enabled,
    (oas.limit_warning_sent_at IS NOT NULL AND oas.limit_warning_sent_at >= DATE_TRUNC('month', CURRENT_DATE)) as limit_warning_sent,
    (oas.limit_reached_sent_at IS NOT NULL AND oas.limit_reached_sent_at >= DATE_TRUNC('month', CURRENT_DATE)) as limit_reached_sent
  FROM (SELECT 1) as dummy
  LEFT JOIN organization_ai_settings oas ON oas.organization_id = p_organization_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- DONE
-- =============================================================================
