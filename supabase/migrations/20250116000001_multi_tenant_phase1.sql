-- =============================================================================
-- Multi-Tenant Phase 1: Database Schema
-- =============================================================================

-- =============================================================================
-- 1.1 SUPER ADMIN TABLES
-- =============================================================================

-- Super admins are platform-level users (separate from tenant users)
CREATE TABLE IF NOT EXISTS super_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  auth_user_id UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Super admin activity log
CREATE TABLE IF NOT EXISTS super_admin_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  super_admin_id UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,  -- 'create_org', 'impersonate', 'update_subscription', etc.
  target_type VARCHAR(50),       -- 'organization', 'user', 'site'
  target_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_activity_admin ON super_admin_activity_log(super_admin_id);
CREATE INDEX IF NOT EXISTS idx_super_admin_activity_created ON super_admin_activity_log(created_at DESC);

-- =============================================================================
-- 1.2 PLATFORM SETTINGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  id VARCHAR(100) PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES super_admins(id)
);

-- Seed default platform settings
INSERT INTO platform_settings (id, settings) VALUES
  ('notifications', '{
    "sms_enabled": false,
    "email_enabled": false,
    "twilio_account_sid": null,
    "twilio_auth_token_encrypted": null,
    "twilio_phone_number": null,
    "resend_api_key_encrypted": null,
    "resend_from_email": null,
    "resend_from_name": "VHC Platform"
  }'),
  ('general', '{
    "platform_name": "Vehicle Health Check",
    "support_email": null,
    "support_phone": null
  }')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 1.3 ORGANIZATION ENHANCEMENTS
-- =============================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
  -- Statuses: pending, active, suspended, cancelled

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;

-- =============================================================================
-- 1.4 ORGANIZATION SETTINGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Branding
  logo_url TEXT,
  logo_dark_url TEXT,
  favicon_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#2563eb',
  secondary_color VARCHAR(7) DEFAULT '#1e40af',

  -- Business Details
  legal_name VARCHAR(255),
  company_number VARCHAR(50),
  vat_number VARCHAR(50),

  -- Address
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  county VARCHAR(100),
  postcode VARCHAR(20),
  country VARCHAR(100) DEFAULT 'United Kingdom',

  -- Contact
  phone VARCHAR(50),
  email VARCHAR(255),
  website VARCHAR(255),

  -- Preferences
  timezone VARCHAR(50) DEFAULT 'Europe/London',
  date_format VARCHAR(20) DEFAULT 'DD/MM/YYYY',
  currency VARCHAR(3) DEFAULT 'GBP',

  -- Feature Flags
  features_enabled JSONB DEFAULT '{
    "dms_integration": false,
    "customer_portal": true,
    "sms_notifications": true,
    "email_notifications": true,
    "pdf_generation": true,
    "photo_annotations": true,
    "video_capture": false,
    "api_access": false
  }',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_settings_org ON organization_settings(organization_id);

-- =============================================================================
-- 1.5 ORGANIZATION NOTIFICATION SETTINGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_notification_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Platform vs Own credentials
  use_platform_sms BOOLEAN DEFAULT true,
  use_platform_email BOOLEAN DEFAULT true,

  -- SMS Settings (Twilio) - encrypted fields
  sms_enabled BOOLEAN DEFAULT true,
  twilio_account_sid_encrypted TEXT,
  twilio_auth_token_encrypted TEXT,
  twilio_phone_number VARCHAR(20),

  -- Email Settings (Resend) - encrypted fields
  email_enabled BOOLEAN DEFAULT true,
  resend_api_key_encrypted TEXT,
  resend_from_email VARCHAR(255),
  resend_from_name VARCHAR(100),

  -- Default Settings
  default_link_expiry_hours INTEGER DEFAULT 72,
  default_reminder_enabled BOOLEAN DEFAULT true,
  default_reminder_intervals JSONB DEFAULT '[24, 48]',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_notification_settings_org ON organization_notification_settings(organization_id);

-- =============================================================================
-- 1.6 SUBSCRIPTION TABLES
-- =============================================================================

-- Available subscription plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,

  -- Limits
  max_sites INTEGER,
  max_users INTEGER,
  max_health_checks_per_month INTEGER,
  max_storage_gb INTEGER,

  -- Features
  features JSONB,

  -- Pricing
  price_monthly DECIMAL(10,2),
  price_annual DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'GBP',

  -- Display
  is_popular BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default plans
INSERT INTO subscription_plans (id, name, description, max_sites, max_users, max_health_checks_per_month, max_storage_gb, price_monthly, price_annual, features, is_popular, sort_order) VALUES
  ('starter', 'Starter', 'Perfect for single-site workshops', 1, 5, 100, 5, 49.00, 490.00,
   '{"dms_integration": false, "api_access": false, "priority_support": false}', false, 1),
  ('professional', 'Professional', 'For growing businesses', 3, 15, 500, 25, 99.00, 990.00,
   '{"dms_integration": true, "api_access": false, "priority_support": true}', true, 2),
  ('enterprise', 'Enterprise', 'For large dealer groups', NULL, NULL, NULL, 100, 249.00, 2490.00,
   '{"dms_integration": true, "api_access": true, "priority_support": true, "dedicated_support": true}', false, 3)
ON CONFLICT (id) DO NOTHING;

-- Organization subscriptions
CREATE TABLE IF NOT EXISTS organization_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Plan
  plan_id VARCHAR(50) NOT NULL REFERENCES subscription_plans(id),
  status VARCHAR(50) DEFAULT 'active',  -- 'active', 'suspended', 'cancelled'

  -- Billing period
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org ON organization_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan ON organization_subscriptions(plan_id);

-- =============================================================================
-- 1.7 USAGE TRACKING TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  health_checks_created INTEGER DEFAULT 0,
  health_checks_completed INTEGER DEFAULT 0,
  sms_sent INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  storage_used_bytes BIGINT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_org_usage_org ON organization_usage(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_usage_period ON organization_usage(period_start, period_end);

-- =============================================================================
-- 1.8 USER ENHANCEMENTS
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_org_admin BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_site_admin BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Users can potentially access multiple sites (for org admins)
CREATE TABLE IF NOT EXISTS user_site_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,  -- Role at this specific site
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_user_site_access_user ON user_site_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_site_access_site ON user_site_access(site_id);

-- =============================================================================
-- 1.10 RLS POLICIES
-- =============================================================================

-- Enable RLS on new tables
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admin_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_site_access ENABLE ROW LEVEL SECURITY;

-- Super admin tables: only super admins via service role (no direct user access)
CREATE POLICY super_admins_service_only ON super_admins
  FOR ALL USING (false);  -- Accessed only via service role

CREATE POLICY super_admin_activity_service_only ON super_admin_activity_log
  FOR ALL USING (false);  -- Accessed only via service role

CREATE POLICY platform_settings_service_only ON platform_settings
  FOR ALL USING (false);  -- Accessed only via service role

-- Subscription plans: readable by all authenticated users
CREATE POLICY subscription_plans_read ON subscription_plans
  FOR SELECT USING (true);

-- Organization settings: org members can read, org admin can write
CREATE POLICY org_settings_read ON organization_settings
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY org_settings_write ON organization_settings
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Organization notification settings: org admin only
CREATE POLICY org_notification_settings_isolation ON organization_notification_settings
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Organization subscriptions: org members can read
CREATE POLICY org_subscriptions_read ON organization_subscriptions
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Organization usage: org members can read
CREATE POLICY org_usage_read ON organization_usage
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- User site access: based on user's organization
CREATE POLICY user_site_access_isolation ON user_site_access
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = user_site_access.user_id
      AND users.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to get or create current month's usage record
CREATE OR REPLACE FUNCTION get_or_create_org_usage(p_organization_id UUID)
RETURNS UUID AS $$
DECLARE
  v_usage_id UUID;
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
  v_period_end := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT id INTO v_usage_id
  FROM organization_usage
  WHERE organization_id = p_organization_id
    AND period_start = v_period_start;

  IF v_usage_id IS NULL THEN
    INSERT INTO organization_usage (organization_id, period_start, period_end)
    VALUES (p_organization_id, v_period_start, v_period_end)
    RETURNING id INTO v_usage_id;
  END IF;

  RETURN v_usage_id;
END;
$$ LANGUAGE plpgsql;

-- Function to increment usage counters
CREATE OR REPLACE FUNCTION increment_org_usage(
  p_organization_id UUID,
  p_health_checks_created INTEGER DEFAULT 0,
  p_health_checks_completed INTEGER DEFAULT 0,
  p_sms_sent INTEGER DEFAULT 0,
  p_emails_sent INTEGER DEFAULT 0,
  p_storage_bytes BIGINT DEFAULT 0
) RETURNS void AS $$
DECLARE
  v_usage_id UUID;
BEGIN
  v_usage_id := get_or_create_org_usage(p_organization_id);

  UPDATE organization_usage SET
    health_checks_created = health_checks_created + p_health_checks_created,
    health_checks_completed = health_checks_completed + p_health_checks_completed,
    sms_sent = sms_sent + p_sms_sent,
    emails_sent = emails_sent + p_emails_sent,
    storage_used_bytes = storage_used_bytes + p_storage_bytes,
    updated_at = NOW()
  WHERE id = v_usage_id;
END;
$$ LANGUAGE plpgsql;

-- Function to check subscription limits
CREATE OR REPLACE FUNCTION check_org_limit(
  p_organization_id UUID,
  p_limit_type VARCHAR(50)
) RETURNS JSONB AS $$
DECLARE
  v_plan subscription_plans%ROWTYPE;
  v_current_count INTEGER;
  v_limit INTEGER;
  v_allowed BOOLEAN;
BEGIN
  -- Get the organization's plan
  SELECT sp.* INTO v_plan
  FROM organization_subscriptions os
  JOIN subscription_plans sp ON sp.id = os.plan_id
  WHERE os.organization_id = p_organization_id
    AND os.status = 'active';

  IF v_plan.id IS NULL THEN
    -- No active subscription, use starter limits
    SELECT * INTO v_plan FROM subscription_plans WHERE id = 'starter';
  END IF;

  CASE p_limit_type
    WHEN 'sites' THEN
      SELECT COUNT(*) INTO v_current_count FROM sites WHERE organization_id = p_organization_id;
      v_limit := v_plan.max_sites;
    WHEN 'users' THEN
      SELECT COUNT(*) INTO v_current_count FROM users WHERE organization_id = p_organization_id AND is_active = true;
      v_limit := v_plan.max_users;
    WHEN 'health_checks' THEN
      SELECT health_checks_created INTO v_current_count
      FROM organization_usage
      WHERE organization_id = p_organization_id
        AND period_start = date_trunc('month', CURRENT_DATE)::DATE;
      v_limit := v_plan.max_health_checks_per_month;
    ELSE
      RETURN jsonb_build_object('error', 'Unknown limit type');
  END CASE;

  v_current_count := COALESCE(v_current_count, 0);
  v_allowed := v_limit IS NULL OR v_current_count < v_limit;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current', v_current_count,
    'limit', v_limit,
    'plan_id', v_plan.id,
    'plan_name', v_plan.name
  );
END;
$$ LANGUAGE plpgsql;
