# VHC AI Configuration & Usage Monitoring
## Platform Administration Specification

---

## 1. OVERVIEW

### 1.1 Purpose
Provide platform administrators with tools to configure AI services, monitor usage, control costs, and set limits per organization.

**Related Document:** This extends the AI generation features defined in `vhc-reasons-spec.md` (Section 4: AI Generation).

### 1.2 Problem Statement
The VHC system uses AI (Anthropic Claude) for:
- Generating reason descriptions (technical + customer-facing)
- Bulk generation for templates
- Regenerating individual descriptions

Without proper management:
- No visibility into AI costs
- No way to update API key without server access
- No per-org limits — one org could exhaust budget
- No usage analytics for billing decisions

### 1.3 Goals
| Goal | Description |
|------|-------------|
| **Centralised Config** | Manage API key via UI, not environment variables |
| **Cost Visibility** | Track token usage and estimated costs in real-time |
| **Usage Control** | Set and enforce limits per organization |
| **Transparency** | Orgs can see their own usage |
| **Alerting** | Warn when approaching limits or budget |

---

## 2. ARCHITECTURE DECISION

### 2.1 Model Choice: Platform Key with Per-Org Tracking

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **API Key** | Single platform key | Simpler, you control costs |
| **Billing** | Included in subscription | AI is a feature, not separate charge (for now) |
| **Tracking** | Per-organization | Know who uses what |
| **Limits** | Per-org monthly cap | Prevent abuse, fair usage |

### 2.2 Future Considerations
- Per-org API keys (enterprise feature)
- AI usage as billable add-on
- Different limits per subscription tier

---

## 3. DATA MODEL

### 3.1 New Tables

```sql
-- Platform-level settings (Super Admin only)
CREATE TABLE platform_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,  -- Encrypted for sensitive values
  is_encrypted BOOLEAN DEFAULT false,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- Initial settings
INSERT INTO platform_settings (key, value, is_encrypted, description) VALUES
('anthropic_api_key', NULL, true, 'Anthropic API key for AI generation'),
('ai_enabled', 'true', false, 'Global toggle for AI features'),
('default_monthly_ai_limit', '100', false, 'Default AI generations per org per month'),
('ai_cost_alert_threshold_usd', '50', false, 'Alert when monthly cost exceeds this'),
('ai_model', 'claude-sonnet-4-20250514', false, 'Default AI model to use');

-- Organization AI settings and limits
CREATE TABLE organization_ai_settings (
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

-- Detailed AI usage logs
CREATE TABLE ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  
  -- What was done
  action VARCHAR(50) NOT NULL,  -- 'generate_reasons', 'regenerate_descriptions', 'generate_bulk'
  
  -- Context
  template_id UUID REFERENCES templates(id),
  template_item_id UUID REFERENCES template_items(id),
  reason_type VARCHAR(50),
  item_reason_id UUID REFERENCES item_reasons(id),
  
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

-- Indexes
CREATE INDEX idx_ai_usage_logs_org ON ai_usage_logs(organization_id);
CREATE INDEX idx_ai_usage_logs_org_date ON ai_usage_logs(organization_id, created_at DESC);
CREATE INDEX idx_ai_usage_logs_action ON ai_usage_logs(action);
CREATE INDEX idx_ai_usage_logs_created ON ai_usage_logs(created_at DESC);
CREATE INDEX idx_ai_usage_logs_user ON ai_usage_logs(user_id);

-- AI cost alerts log
CREATE TABLE ai_cost_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_type VARCHAR(50) NOT NULL,  -- 'org_limit_warning', 'org_limit_reached', 'platform_cost_alert'
  organization_id UUID REFERENCES organizations(id),
  
  -- Context
  threshold_value NUMERIC,
  current_value NUMERIC,
  message TEXT,
  
  -- Status
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Model Pricing Reference

```sql
-- AI model pricing (for cost calculations)
CREATE TABLE ai_model_pricing (
  model VARCHAR(100) PRIMARY KEY,
  input_cost_per_1m_tokens NUMERIC(10, 4) NOT NULL,
  output_cost_per_1m_tokens NUMERIC(10, 4) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,  -- NULL = current
  notes TEXT
);

-- Current Anthropic pricing (as of late 2024)
INSERT INTO ai_model_pricing (model, input_cost_per_1m_tokens, output_cost_per_1m_tokens, effective_from, notes) VALUES
('claude-sonnet-4-20250514', 3.00, 15.00, '2024-01-01', 'Claude Sonnet 4'),
('claude-haiku-4-5-20251001', 0.80, 4.00, '2024-01-01', 'Claude Haiku 4.5 - faster, cheaper');
```

### 3.3 Helper Functions

```sql
-- Get effective limit for an organization
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
  FROM platform_settings
  WHERE key = 'default_monthly_ai_limit';
  
  RETURN COALESCE(v_default_limit, 100);
END;
$$ LANGUAGE plpgsql;

-- Check if org can generate (within limits)
CREATE OR REPLACE FUNCTION can_org_generate_ai(p_organization_id UUID)
RETURNS TABLE (
  allowed BOOLEAN,
  reason TEXT,
  current_usage INTEGER,
  limit_value INTEGER,
  percentage_used NUMERIC
) AS $$
DECLARE
  v_ai_enabled BOOLEAN;
  v_global_enabled BOOLEAN;
  v_org_enabled BOOLEAN;
  v_limit INTEGER;
  v_current INTEGER;
  v_period_start DATE;
BEGIN
  -- Check global AI enabled
  SELECT value::BOOLEAN INTO v_global_enabled
  FROM platform_settings WHERE key = 'ai_enabled';
  
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
    ROUND((v_current::NUMERIC / v_limit) * 100, 1);
END;
$$ LANGUAGE plpgsql;

-- Record AI usage and update org stats
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
  p_error_message TEXT DEFAULT NULL
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
  
  -- Default pricing if not found
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
    success, error_message
  ) VALUES (
    p_organization_id, p_user_id, p_action, p_model,
    p_input_tokens, p_output_tokens,
    v_input_cost, v_output_cost, v_total_cost,
    p_items_generated, p_duration_ms,
    p_template_id, p_template_item_id, p_reason_type,
    p_success, p_error_message
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
```

### 3.4 RLS Policies

```sql
-- Platform settings: Super admin only
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin only" ON platform_settings
  FOR ALL USING (current_user_role() = 'super_admin');

-- Organization AI settings: Org admins can view own, super admin all
ALTER TABLE organization_ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins view own" ON organization_ai_settings
  FOR SELECT USING (
    organization_id = current_org_id() 
    OR current_user_role() = 'super_admin'
  );

CREATE POLICY "Super admin manages all" ON organization_ai_settings
  FOR ALL USING (current_user_role() = 'super_admin');

-- AI usage logs: Same pattern
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins view own logs" ON ai_usage_logs
  FOR SELECT USING (
    organization_id = current_org_id() 
    OR current_user_role() = 'super_admin'
  );

CREATE POLICY "System inserts logs" ON ai_usage_logs
  FOR INSERT WITH CHECK (true);  -- Service role only
```

---

## 4. API ENDPOINTS

### 4.1 Platform Settings (Super Admin)

```
# Get all platform AI settings
GET /api/v1/admin/ai-settings
  → Returns: { 
      api_key_configured: boolean,
      api_key_last_4: string | null,
      ai_enabled: boolean,
      default_monthly_limit: number,
      cost_alert_threshold: number,
      model: string
    }

# Update platform settings
PATCH /api/v1/admin/ai-settings
  Body: { 
    anthropic_api_key?: string,  -- Only if changing
    ai_enabled?: boolean,
    default_monthly_ai_limit?: number,
    ai_cost_alert_threshold_usd?: number,
    ai_model?: string
  }
  → Returns: { success: true, updated: string[] }

# Test API key connection
POST /api/v1/admin/ai-settings/test
  → Returns: { success: boolean, error?: string, model?: string }
```

### 4.2 Platform Usage Dashboard (Super Admin)

```
# Get platform-wide AI usage summary
GET /api/v1/admin/ai-usage/summary
  Query: ?period=30d (7d, 30d, 90d, all)
  → Returns: {
      period: { start: date, end: date },
      totals: {
        generations: number,
        tokens: number,
        cost_usd: number,
        success_rate: number
      },
      by_action: [
        { action: string, count: number, tokens: number, cost: number }
      ],
      daily_breakdown: [
        { date: date, generations: number, cost: number }
      ]
    }

# Get usage by organization
GET /api/v1/admin/ai-usage/by-organization
  Query: ?period=30d&sort=cost_desc
  → Returns: {
      organizations: [
        {
          id: uuid,
          name: string,
          generations: number,
          tokens: number,
          cost_usd: number,
          limit: number,
          percentage_used: number
        }
      ]
    }

# Get detailed logs (paginated)
GET /api/v1/admin/ai-usage/logs
  Query: ?organization_id=&action=&from=&to=&page=1&limit=50
  → Returns: {
      logs: AiUsageLog[],
      pagination: { page, limit, total, pages }
    }

# Export usage to CSV
GET /api/v1/admin/ai-usage/export
  Query: ?period=30d&format=csv
  → Returns: CSV file download
```

### 4.3 Organization Limits (Super Admin)

```
# Get organization AI settings
GET /api/v1/admin/organizations/:id/ai-settings
  → Returns: {
      monthly_generation_limit: number | null,
      effective_limit: number,
      is_ai_enabled: boolean,
      current_period: {
        start: date,
        generations: number,
        tokens: number,
        cost_usd: number
      },
      lifetime: {
        generations: number,
        tokens: number,
        cost_usd: number
      }
    }

# Update organization AI settings
PATCH /api/v1/admin/organizations/:id/ai-settings
  Body: {
    monthly_generation_limit?: number | null,
    is_ai_enabled?: boolean
  }
  → Returns: { success: true }

# Reset organization's current period (manual override)
POST /api/v1/admin/organizations/:id/ai-settings/reset-period
  → Returns: { success: true, previous: {...} }
```

### 4.4 Organization View (Org Admin)

```
# Get own organization's AI usage
GET /api/v1/organizations/:id/ai-usage
  Query: ?period=30d
  → Returns: {
      limit: number,
      used: number,
      remaining: number,
      percentage_used: number,
      period: { start: date, end: date },
      cost_usd: number,  -- Only if platform allows visibility
      recent_generations: [
        { date, user, action, items_count }
      ]
    }

# Get AI usage history
GET /api/v1/organizations/:id/ai-usage/history
  Query: ?page=1&limit=20
  → Returns: {
      logs: [
        {
          id, created_at, user_name,
          action, items_generated,
          template_item_name, reason_type
        }
      ],
      pagination: {...}
    }
```

### 4.5 Pre-Generation Check

```
# Check if org can generate (called before AI operations)
GET /api/v1/organizations/:id/ai-usage/can-generate
  → Returns: {
      allowed: boolean,
      reason?: string,
      current_usage: number,
      limit: number,
      percentage_used: number
    }
```

---

## 5. AI SERVICE INTEGRATION

### 5.1 Update AI Service

The existing `ai-reasons.ts` service (from `vhc-reasons-spec.md`) needs updates:

```typescript
// apps/api/src/services/ai-reasons.ts

import { getDb } from '../db';

// Get API key from platform settings (not env)
async function getApiKey(): Promise<string> {
  const db = getDb();
  const result = await db.query(
    `SELECT value FROM platform_settings 
     WHERE key = 'anthropic_api_key' AND value IS NOT NULL`
  );
  
  if (!result.rows[0]?.value) {
    throw new Error('AI API key not configured. Please configure in Super Admin settings.');
  }
  
  // Decrypt if encrypted (implement based on your encryption approach)
  return decryptValue(result.rows[0].value);
}

// Check limits before generating
async function checkGenerationAllowed(organizationId: string): Promise<void> {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM can_org_generate_ai($1)`,
    [organizationId]
  );
  
  const check = result.rows[0];
  if (!check.allowed) {
    throw new ApiError(429, check.reason);
  }
}

// Wrap generation with usage tracking
async function generateWithTracking<T>(
  organizationId: string,
  userId: string,
  action: string,
  context: {
    templateId?: string;
    templateItemId?: string;
    reasonType?: string;
  },
  generateFn: () => Promise<{ result: T; usage: { input_tokens: number; output_tokens: number } }>
): Promise<T> {
  // Check limits first
  await checkGenerationAllowed(organizationId);
  
  const startTime = Date.now();
  let success = true;
  let errorMessage: string | undefined;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let itemsGenerated = 0;
  let result: T;
  
  try {
    const response = await generateFn();
    result = response.result;
    usage = response.usage;
    
    // Count items if array
    if (Array.isArray(result)) {
      itemsGenerated = result.length;
    }
  } catch (error) {
    success = false;
    errorMessage = error.message;
    throw error;
  } finally {
    // Always record usage (even failures)
    const durationMs = Date.now() - startTime;
    const model = await getModel();
    
    await recordUsage(
      organizationId,
      userId,
      action,
      model,
      usage.input_tokens,
      usage.output_tokens,
      itemsGenerated,
      context.templateId,
      context.templateItemId,
      context.reasonType,
      durationMs,
      success,
      errorMessage
    );
  }
  
  return result;
}

// Updated generate function
export async function generateReasonsForItem(
  organizationId: string,
  userId: string,
  templateItem: TemplateItem,
  tone: 'premium' | 'friendly'
): Promise<GeneratedReason[]> {
  return generateWithTracking(
    organizationId,
    userId,
    'generate_reasons',
    { templateItemId: templateItem.id },
    async () => {
      const apiKey = await getApiKey();
      const anthropic = new Anthropic({ apiKey });
      
      const prompt = generateReasonsPrompt(templateItem, tone);
      
      const response = await anthropic.messages.create({
        model: await getModel(),
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      });
      
      const reasons = parseResponse(response);
      
      return {
        result: reasons,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens
        }
      };
    }
  );
}
```

---

## 6. SUPER ADMIN UI

### 6.1 AI Configuration Page

**Location:** Super Admin > Settings > AI Configuration

```
┌─────────────────────────────────────────────────────────────────┐
│  Super Admin > Settings > AI Configuration                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AI SERVICE STATUS                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ● Connected                    Model: Claude Sonnet 4    │   │
│  │   Last tested: 2 hours ago     [Test Connection]         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  API CONFIGURATION                                              │
│                                                                 │
│  Anthropic API Key                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ••••••••••••••••••••••••••••••••••••••••••sk-7x4m      │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [Change Key]                                                   │
│                                                                 │
│  AI Model                                                       │
│  ┌────────────────────────────────────┐                        │
│  │ Claude Sonnet 4               ▼   │                        │
│  └────────────────────────────────────┘                        │
│  Recommended for reason generation (balance of quality/cost)    │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GLOBAL CONTROLS                                                │
│                                                                 │
│  [✓] Enable AI Features                                        │
│      Turn off to disable all AI generation across platform      │
│                                                                 │
│  Default Monthly Limit (per organization)                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 100                                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│  generations per month. Can be overridden per organization.     │
│                                                                 │
│  Cost Alert Threshold                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ £50.00                                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  Alert when monthly platform cost exceeds this amount.          │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                        Save Changes                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 AI Usage Dashboard

**Location:** Super Admin > AI Usage

```
┌─────────────────────────────────────────────────────────────────┐
│  Super Admin > AI Usage                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Period: [This Month ▼]                          [Export CSV]   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │     247      │  │   892,450    │  │    £12.84    │          │
│  │ Generations  │  │    Tokens    │  │  Est. Cost   │          │
│  │   +12% ▲     │  │   +8% ▲      │  │   +9% ▲      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  DAILY USAGE                                     [Line Chart]   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │     ╭─╮                                                 │   │
│  │    ╭╯ ╰╮   ╭──╮        ╭╮                              │   │
│  │ ───╯    ╰──╯  ╰────────╯╰───                           │   │
│  │  1    5    10    15    20    25    30                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  USAGE BY ORGANIZATION                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Organization        │ Gens │ Tokens │  Cost  │  Limit   │   │
│  ├─────────────────────┼──────┼────────┼────────┼──────────│   │
│  │ Acme Motors         │   89 │ 324,500│  £4.67 │  89/100  │   │
│  │ ████████████████░░  │      │        │        │    89%   │   │
│  ├─────────────────────┼──────┼────────┼────────┼──────────│   │
│  │ Smith's Garage      │   67 │ 245,200│  £3.52 │  67/100  │   │
│  │ █████████████░░░░░  │      │        │        │    67%   │   │
│  ├─────────────────────┼──────┼────────┼────────┼──────────│   │
│  │ QuickFit Bristol    │   45 │ 178,900│  £2.51 │  45/100  │   │
│  │ █████████░░░░░░░░░  │      │        │        │    45%   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [View All Organizations]                                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  USAGE BY ACTION                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ generate_reasons         ████████████████████  189 (76%)│   │
│  │ generate_bulk            ████████              42 (17%) │   │
│  │ regenerate_descriptions  ███                   16 (7%)  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Organization AI Settings (within org detail page)

```
┌─────────────────────────────────────────────────────────────────┐
│  Organization: Acme Motors > AI Settings                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CURRENT PERIOD (January 2026)                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  ████████████████████████████████████░░░░░░  89/100     │   │
│  │                                              89%        │   │
│  │                                                         │   │
│  │  Generations: 89   Tokens: 324,500   Est. Cost: £4.67   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LIMITS                                                         │
│                                                                 │
│  Monthly Generation Limit                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 100                                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│  Leave blank to use platform default (100)                      │
│                                                                 │
│  [✓] AI Features Enabled                                       │
│      Uncheck to disable AI for this organization                │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  LIFETIME TOTALS                                                │
│  Generations: 456  │  Tokens: 1,892,450  │  Est. Cost: £27.34   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  [Reset Current Period]        [View Usage History]             │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                        Save Changes                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. ORGANIZATION ADMIN UI

### 7.1 AI Usage View

**Location:** Settings > AI Usage

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings > AI Usage                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  THIS MONTH'S USAGE                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  ████████████████████████████████████░░░░░░  67/100     │   │
│  │                                                         │   │
│  │  You've used 67 of 100 AI generations this month        │   │
│  │  33 remaining • Resets on 1st February                  │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  RECENT AI GENERATIONS                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Today, 14:32                                            │   │
│  │ John Smith generated reasons for Tyres (8 reasons)      │   │
│  ├─────────────────────────────────────────────────────────│   │
│  │ Today, 11:15                                            │   │
│  │ John Smith generated reasons for Drive Belt (6 reasons) │   │
│  ├─────────────────────────────────────────────────────────│   │
│  │ Yesterday, 16:45                                        │   │
│  │ Sarah Jones regenerated descriptions for 1 reason       │   │
│  ├─────────────────────────────────────────────────────────│   │
│  │ Yesterday, 09:20                                        │   │
│  │ John Smith bulk generated for Full VHC (45 reasons)     │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [View Full History]                                            │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  💡 Tips to reduce AI usage:                                    │
│  • Use the Starter Template when setting up                     │
│  • Review and edit generated reasons before regenerating        │
│  • Copy reasons between similar templates                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Limit Warning Banner

When org reaches 80% of limit, show banner across admin area:

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️ You've used 89 of 100 AI generations this month.            │
│    Contact support if you need a higher limit.          [✕]    │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Limit Reached Error

When trying to generate after limit reached:

```
┌─────────────────────────────────────────────────────────────────┐
│                         ⚠️                                       │
│                                                                 │
│        Monthly AI Generation Limit Reached                      │
│                                                                 │
│  Your organization has used all 100 AI generations              │
│  for this month. Your limit will reset on 1st February.         │
│                                                                 │
│  In the meantime, you can:                                      │
│  • Manually add reasons in the Reason Library                   │
│  • Edit existing generated reasons                              │
│  • Contact support to request a limit increase                  │
│                                                                 │
│                    [ OK ]                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. ALERTS & NOTIFICATIONS

### 8.1 Alert Types

| Alert | Trigger | Recipient | Action |
|-------|---------|-----------|--------|
| Org 80% Warning | Usage hits 80% of limit | Org Admin | Banner + optional email |
| Org Limit Reached | Usage hits 100% | Org Admin | Block + modal |
| Platform Cost Alert | Monthly cost exceeds threshold | Super Admin | Email + dashboard alert |
| API Key Expiring | If detectable | Super Admin | Dashboard warning |
| API Errors Spike | >10% failure rate in 1 hour | Super Admin | Dashboard + email |

### 8.2 Alert Logic

```typescript
// Check and send alerts after each generation
async function checkAlerts(organizationId: string) {
  const db = getDb();
  
  // Get current usage
  const usage = await db.query(
    `SELECT * FROM can_org_generate_ai($1)`,
    [organizationId]
  );
  
  const { current_usage, limit_value, percentage_used } = usage.rows[0];
  
  // Check 80% warning
  if (percentage_used >= 80 && percentage_used < 100) {
    const settings = await db.query(
      `SELECT limit_warning_sent_at FROM organization_ai_settings WHERE organization_id = $1`,
      [organizationId]
    );
    
    // Only send once per period
    if (!settings.rows[0]?.limit_warning_sent_at) {
      await sendOrgLimitWarning(organizationId, current_usage, limit_value);
      await db.query(
        `UPDATE organization_ai_settings SET limit_warning_sent_at = NOW() WHERE organization_id = $1`,
        [organizationId]
      );
    }
  }
  
  // Check platform cost alert (Super Admin)
  const platformCost = await db.query(
    `SELECT SUM(total_cost_usd) as total 
     FROM ai_usage_logs 
     WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)`
  );
  
  const threshold = await db.query(
    `SELECT value::NUMERIC FROM platform_settings WHERE key = 'ai_cost_alert_threshold_usd'`
  );
  
  if (platformCost.rows[0]?.total >= threshold.rows[0]?.value) {
    await checkAndSendPlatformCostAlert(platformCost.rows[0].total);
  }
}
```

---

## 9. IMPLEMENTATION PHASES

### Phase 1: Database & Core Functions (15-20 iterations)
- [ ] Create platform_settings table with encryption support
- [ ] Create organization_ai_settings table
- [ ] Create ai_usage_logs table
- [ ] Create ai_model_pricing table with current pricing
- [ ] Create ai_cost_alerts table
- [ ] Implement get_org_ai_limit() function
- [ ] Implement can_org_generate_ai() function
- [ ] Implement record_ai_usage() function
- [ ] Add RLS policies
- [ ] Add indexes

### Phase 2: AI Service Integration (10-15 iterations)
- [ ] Update ai-reasons.ts to get API key from database
- [ ] Add limit checking before generation
- [ ] Add usage recording after generation
- [ ] Handle token counting from Anthropic response
- [ ] Calculate and store costs
- [ ] Add error handling for limit exceeded

### Phase 3: Platform Settings API (10-15 iterations)
- [ ] GET /api/v1/admin/ai-settings
- [ ] PATCH /api/v1/admin/ai-settings
- [ ] POST /api/v1/admin/ai-settings/test
- [ ] Implement API key encryption/decryption
- [ ] Add validation

### Phase 4: Usage Tracking API (10-15 iterations)
- [ ] GET /api/v1/admin/ai-usage/summary
- [ ] GET /api/v1/admin/ai-usage/by-organization
- [ ] GET /api/v1/admin/ai-usage/logs
- [ ] GET /api/v1/admin/ai-usage/export
- [ ] GET /api/v1/organizations/:id/ai-usage
- [ ] GET /api/v1/organizations/:id/ai-usage/can-generate

### Phase 5: Organization Limits API (5-10 iterations)
- [ ] GET /api/v1/admin/organizations/:id/ai-settings
- [ ] PATCH /api/v1/admin/organizations/:id/ai-settings
- [ ] POST /api/v1/admin/organizations/:id/ai-settings/reset-period

### Phase 6: Super Admin UI (20-25 iterations)
- [ ] AI Configuration page
- [ ] API key management with masking
- [ ] Test connection functionality
- [ ] AI Usage dashboard with charts
- [ ] Usage by organization table
- [ ] Organization AI settings in org detail page
- [ ] Alerts display

### Phase 7: Org Admin UI (10-15 iterations)
- [ ] AI Usage page showing own usage
- [ ] Usage history list
- [ ] Progress bar visualization
- [ ] Warning banner at 80%
- [ ] Limit reached error modal

### Phase 8: Alerts & Polish (10-15 iterations)
- [ ] Implement alert checking logic
- [ ] 80% warning notifications
- [ ] Platform cost alerts
- [ ] Email notifications (if email system exists)
- [ ] Error handling and edge cases
- [ ] Testing

---

## 10. IMPLEMENTATION PROMPTS

### Phase 1: Database

```bash
claude -p "Read docs/vhc-ai-config-spec.md. Complete Phase 1: Database & Core Functions.

1. Create platform_settings table with encryption support for API key
2. Create organization_ai_settings table for limits and usage tracking
3. Create ai_usage_logs table for detailed logging
4. Create ai_model_pricing table and seed with Claude Sonnet 4 pricing
5. Create ai_cost_alerts table
6. Implement get_org_ai_limit() function
7. Implement can_org_generate_ai() function
8. Implement record_ai_usage() function with cost calculation
9. Add RLS policies (super admin for platform, org admins for own data)
10. Add all indexes" --dangerously-skip-permissions
```

### Phase 2: AI Service Integration

```bash
claude -p "Read docs/vhc-ai-config-spec.md and docs/vhc-reasons-spec.md. Complete Phase 2: AI Service Integration.

Update apps/api/src/services/ai-reasons.ts to:
1. Get API key from platform_settings instead of environment variable
2. Check limits via can_org_generate_ai() before any generation
3. Record usage via record_ai_usage() after generation (success or failure)
4. Extract token counts from Anthropic response (response.usage.input_tokens, output_tokens)
5. Track duration of API calls
6. Return 429 error with friendly message when limit exceeded
7. Add generateWithTracking() wrapper function for all AI operations" --dangerously-skip-permissions
```

---

*Document Version: 1.0*
*Created: January 2026*
*Related: vhc-reasons-spec.md*
