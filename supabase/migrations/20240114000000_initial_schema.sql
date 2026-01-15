-- =============================================================================
-- VHC Database Schema
-- Vehicle Health Check Application
-- =============================================================================

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUMS
-- =============================================================================
CREATE TYPE user_role AS ENUM (
  'super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician'
);

CREATE TYPE health_check_status AS ENUM (
  'created', 'assigned', 'in_progress', 'paused', 'tech_completed',
  'awaiting_review', 'awaiting_pricing', 'awaiting_parts', 'ready_to_send',
  'sent', 'delivered', 'opened', 'partial_response',
  'authorized', 'declined', 'expired', 'completed', 'cancelled'
);

CREATE TYPE rag_status AS ENUM ('green', 'amber', 'red', 'not_checked');

CREATE TYPE item_type AS ENUM (
  'rag', 'measurement', 'yes_no', 'text', 'number',
  'select', 'multi_select', 'tyre_depth', 'brake_measurement', 'fluid_level'
);

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- Organizations (top-level tenant)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sites (locations within an organization)
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  email VARCHAR(255),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sites_org ON sites(organization_id);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id UUID UNIQUE, -- Links to Supabase Auth
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(50),
  role user_role NOT NULL DEFAULT 'technician',
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_site ON users(site_id);
CREATE INDEX idx_users_auth ON users(auth_id);

-- Customers
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id),
  external_id VARCHAR(100), -- DMS reference
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  mobile VARCHAR(50),
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customers_org ON customers(organization_id);
CREATE INDEX idx_customers_external ON customers(external_id);

-- Vehicles
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  registration VARCHAR(20) NOT NULL,
  vin VARCHAR(50),
  make VARCHAR(100),
  model VARCHAR(100),
  year INTEGER,
  color VARCHAR(50),
  fuel_type VARCHAR(50),
  engine_size VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vehicles_org ON vehicles(organization_id);
CREATE INDEX idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX idx_vehicles_reg ON vehicles(registration);

-- =============================================================================
-- TEMPLATE TABLES
-- =============================================================================

-- Check Templates
CREATE TABLE check_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id), -- NULL = org-wide template
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_templates_org ON check_templates(organization_id);

-- Template Sections
CREATE TABLE template_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES check_templates(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sections_template ON template_sections(template_id);

-- Template Items
CREATE TABLE template_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID NOT NULL REFERENCES template_sections(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  item_type item_type NOT NULL DEFAULT 'rag',
  is_required BOOLEAN DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  config JSONB DEFAULT '{}', -- Type-specific configuration
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_items_section ON template_items(section_id);

-- =============================================================================
-- HEALTH CHECK TABLES
-- =============================================================================

-- Health Checks (main record)
CREATE TABLE health_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES check_templates(id),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Assignment
  technician_id UUID REFERENCES users(id),
  advisor_id UUID REFERENCES users(id),

  -- Job info
  job_number VARCHAR(50),
  job_type VARCHAR(100),
  bay_number VARCHAR(20),
  mileage_in INTEGER,

  -- Status tracking
  status health_check_status DEFAULT 'created',
  priority VARCHAR(20) DEFAULT 'normal',
  promised_at TIMESTAMPTZ,
  blocked_reason TEXT,
  blocked_at TIMESTAMPTZ,

  -- Timestamps for each stage
  assigned_at TIMESTAMPTZ,
  tech_started_at TIMESTAMPTZ,
  tech_completed_at TIMESTAMPTZ,
  advisor_reviewed_at TIMESTAMPTZ,
  pricing_completed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  first_opened_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  fully_responded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Customer portal
  public_token VARCHAR(64) UNIQUE,
  token_expires_at TIMESTAMPTZ,
  customer_view_count INTEGER DEFAULT 0,
  customer_first_viewed_at TIMESTAMPTZ,
  customer_last_viewed_at TIMESTAMPTZ,

  -- Reminders
  reminders_sent INTEGER DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,

  -- Time tracking
  active_time_entry_id UUID,
  total_tech_time_minutes INTEGER DEFAULT 0,

  -- Settings snapshot at publish
  publish_settings JSONB DEFAULT '{}',

  -- Counts (denormalized for performance)
  green_count INTEGER DEFAULT 0,
  amber_count INTEGER DEFAULT 0,
  red_count INTEGER DEFAULT 0,
  not_checked_count INTEGER DEFAULT 0,

  -- Notes
  technician_notes TEXT,
  advisor_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_health_checks_org ON health_checks(organization_id);
CREATE INDEX idx_health_checks_site ON health_checks(site_id);
CREATE INDEX idx_health_checks_status ON health_checks(status);
CREATE INDEX idx_health_checks_technician ON health_checks(technician_id);
CREATE INDEX idx_health_checks_advisor ON health_checks(advisor_id);
CREATE INDEX idx_health_checks_vehicle ON health_checks(vehicle_id);
CREATE INDEX idx_health_checks_token ON health_checks(public_token);
CREATE INDEX idx_health_checks_created ON health_checks(created_at DESC);

-- Check Results (individual item results)
CREATE TABLE check_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  template_item_id UUID NOT NULL REFERENCES template_items(id),

  -- Result data
  rag_status rag_status,
  value JSONB, -- Flexible storage for different item types
  notes TEXT,

  -- Timestamps
  checked_at TIMESTAMPTZ,
  checked_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_results_health_check ON check_results(health_check_id);
CREATE UNIQUE INDEX idx_results_unique ON check_results(health_check_id, template_item_id);

-- Result Media (photos/videos)
CREATE TABLE result_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_result_id UUID NOT NULL REFERENCES check_results(id) ON DELETE CASCADE,

  media_type VARCHAR(20) NOT NULL, -- 'photo', 'video'
  storage_path VARCHAR(500) NOT NULL,
  thumbnail_path VARCHAR(500),
  original_filename VARCHAR(255),
  file_size INTEGER,
  mime_type VARCHAR(100),

  -- Metadata
  sort_order INTEGER DEFAULT 0,
  caption TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_media_result ON result_media(check_result_id);

-- Repair Items (priced work items)
CREATE TABLE repair_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  check_result_id UUID REFERENCES check_results(id) ON DELETE SET NULL,

  -- Description
  title VARCHAR(255) NOT NULL,
  description TEXT,
  rag_status rag_status NOT NULL,

  -- Pricing
  parts_cost DECIMAL(10,2) DEFAULT 0,
  labor_cost DECIMAL(10,2) DEFAULT 0,
  total_price DECIMAL(10,2) NOT NULL,

  -- Visibility
  is_visible BOOLEAN DEFAULT true, -- Show to customer
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_repair_items_health_check ON repair_items(health_check_id);

-- Authorizations (customer decisions)
CREATE TABLE authorizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  repair_item_id UUID NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,

  decision VARCHAR(20) NOT NULL, -- 'approved', 'declined'
  decided_at TIMESTAMPTZ DEFAULT NOW(),

  -- Signature (for approved items)
  signature_data TEXT, -- Base64 or storage path
  signature_ip INET,
  signature_user_agent TEXT,

  -- Notes
  customer_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_authorizations_health_check ON authorizations(health_check_id);
CREATE UNIQUE INDEX idx_authorizations_unique ON authorizations(repair_item_id);

-- =============================================================================
-- TIME TRACKING
-- =============================================================================

CREATE TABLE technician_time_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES users(id),

  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ,
  duration_minutes INTEGER,

  work_type VARCHAR(50) DEFAULT 'inspection',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_time_entries_health_check ON technician_time_entries(health_check_id);
CREATE INDEX idx_time_entries_technician ON technician_time_entries(technician_id);

-- =============================================================================
-- STATUS HISTORY
-- =============================================================================

CREATE TABLE health_check_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,

  from_status health_check_status,
  to_status health_check_status NOT NULL,

  changed_by UUID REFERENCES users(id),
  change_source VARCHAR(50) NOT NULL, -- 'user', 'system', 'customer'
  notes TEXT,

  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_status_history_health_check ON health_check_status_history(health_check_id);

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================

-- Customer activity tracking
CREATE TABLE customer_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,

  activity_type VARCHAR(50) NOT NULL,
  repair_item_id UUID REFERENCES repair_items(id),
  metadata JSONB DEFAULT '{}',

  ip_address INET,
  user_agent TEXT,
  device_type VARCHAR(20),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_activities_check ON customer_activities(health_check_id);

-- Staff notifications
CREATE TABLE staff_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  health_check_id UUID REFERENCES health_checks(id) ON DELETE CASCADE,

  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'normal',

  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  action_url VARCHAR(500),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_notifications_user ON staff_notifications(user_id);
CREATE INDEX idx_staff_notifications_unread ON staff_notifications(user_id, read_at) WHERE read_at IS NULL;

-- Scheduled jobs
CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type VARCHAR(50) NOT NULL,
  health_check_id UUID REFERENCES health_checks(id) ON DELETE CASCADE,

  scheduled_for TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  attempts INTEGER DEFAULT 0,

  payload JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scheduled_jobs_pending ON scheduled_jobs(scheduled_for) WHERE status = 'pending';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only see their organization's data)
CREATE POLICY org_isolation ON organizations
  FOR ALL USING (id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY site_isolation ON sites
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY user_isolation ON users
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY customer_isolation ON customers
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY vehicle_isolation ON vehicles
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY template_isolation ON check_templates
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY health_check_isolation ON health_checks
  FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Update health check status with history
CREATE OR REPLACE FUNCTION update_health_check_status(
  p_health_check_id UUID,
  p_new_status health_check_status,
  p_changed_by UUID DEFAULT NULL,
  p_change_source VARCHAR DEFAULT 'system',
  p_notes TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_current_status health_check_status;
BEGIN
  SELECT status INTO v_current_status FROM health_checks WHERE id = p_health_check_id;

  IF v_current_status = p_new_status THEN RETURN; END IF;

  INSERT INTO health_check_status_history
    (health_check_id, from_status, to_status, changed_by, change_source, notes)
  VALUES
    (p_health_check_id, v_current_status, p_new_status, p_changed_by, p_change_source, p_notes);

  UPDATE health_checks SET
    status = p_new_status,
    assigned_at = CASE WHEN p_new_status = 'assigned' THEN NOW() ELSE assigned_at END,
    tech_started_at = CASE WHEN p_new_status = 'in_progress' AND tech_started_at IS NULL THEN NOW() ELSE tech_started_at END,
    tech_completed_at = CASE WHEN p_new_status = 'tech_completed' THEN NOW() ELSE tech_completed_at END,
    sent_at = CASE WHEN p_new_status = 'sent' THEN NOW() ELSE sent_at END,
    first_opened_at = CASE WHEN p_new_status = 'opened' AND first_opened_at IS NULL THEN NOW() ELSE first_opened_at END,
    completed_at = CASE WHEN p_new_status = 'completed' THEN NOW() ELSE completed_at END,
    updated_at = NOW()
  WHERE id = p_health_check_id;
END;
$$ LANGUAGE plpgsql;

-- Clock technician in
CREATE OR REPLACE FUNCTION clock_technician_in(
  p_health_check_id UUID,
  p_technician_id UUID
) RETURNS UUID AS $$
DECLARE
  v_time_entry_id UUID;
BEGIN
  INSERT INTO technician_time_entries (health_check_id, technician_id, clock_in_at)
  VALUES (p_health_check_id, p_technician_id, NOW())
  RETURNING id INTO v_time_entry_id;

  UPDATE health_checks SET
    active_time_entry_id = v_time_entry_id,
    technician_id = p_technician_id
  WHERE id = p_health_check_id;

  PERFORM update_health_check_status(p_health_check_id, 'in_progress', p_technician_id, 'user');

  RETURN v_time_entry_id;
END;
$$ LANGUAGE plpgsql;

-- Clock technician out
CREATE OR REPLACE FUNCTION clock_technician_out(
  p_health_check_id UUID,
  p_technician_id UUID,
  p_mark_complete BOOLEAN DEFAULT FALSE
) RETURNS void AS $$
DECLARE
  v_time_entry_id UUID;
  v_duration INTEGER;
BEGIN
  SELECT active_time_entry_id INTO v_time_entry_id FROM health_checks WHERE id = p_health_check_id;

  UPDATE technician_time_entries SET
    clock_out_at = NOW(),
    duration_minutes = EXTRACT(EPOCH FROM (NOW() - clock_in_at)) / 60
  WHERE id = v_time_entry_id
  RETURNING duration_minutes INTO v_duration;

  UPDATE health_checks SET
    active_time_entry_id = NULL,
    total_tech_time_minutes = total_tech_time_minutes + COALESCE(v_duration, 0)
  WHERE id = p_health_check_id;

  IF p_mark_complete THEN
    PERFORM update_health_check_status(p_health_check_id, 'tech_completed', p_technician_id, 'user');
  ELSE
    PERFORM update_health_check_status(p_health_check_id, 'paused', p_technician_id, 'user');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Update RAG counts trigger
CREATE OR REPLACE FUNCTION update_rag_counts() RETURNS TRIGGER AS $$
BEGIN
  UPDATE health_checks SET
    green_count = (SELECT COUNT(*) FROM check_results WHERE health_check_id = NEW.health_check_id AND rag_status = 'green'),
    amber_count = (SELECT COUNT(*) FROM check_results WHERE health_check_id = NEW.health_check_id AND rag_status = 'amber'),
    red_count = (SELECT COUNT(*) FROM check_results WHERE health_check_id = NEW.health_check_id AND rag_status = 'red'),
    not_checked_count = (SELECT COUNT(*) FROM check_results WHERE health_check_id = NEW.health_check_id AND rag_status = 'not_checked')
  WHERE id = NEW.health_check_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_rag_counts
  AFTER INSERT OR UPDATE ON check_results
  FOR EACH ROW EXECUTE FUNCTION update_rag_counts();
