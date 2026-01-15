# Vehicle Health Check (VHC) Application
## Complete Technical Specification
### For Claude Code / AI-Assisted Development

---

# QUICK START FOR AI ASSISTANT

This is a complete specification for building a Vehicle Health Check (VHC) SaaS application for automotive dealerships and workshops. 

**Tech Stack:**
- Frontend: React + TypeScript + Tailwind CSS
- Backend: Hono (TypeScript) on Railway
- Database: Supabase (PostgreSQL + Auth + Storage)
- Queue: BullMQ + Redis on Railway
- SMS: Twilio
- Email: Resend

**Build Order:**
1. Database schema & Supabase setup
2. Authentication & user management
3. Template builder (admin)
4. Technician mobile interface (PWA)
5. Service Advisor interface
6. Customer portal (public)
7. Notifications & real-time
8. Dashboard & reporting

---

# TABLE OF CONTENTS

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Database Schema](#3-database-schema)
4. [API Specification](#4-api-specification)
5. [Status Workflow](#5-status-workflow)
6. [User Interfaces](#6-user-interfaces)
7. [Technician Mobile App](#7-technician-mobile-app)
8. [Customer Portal](#8-customer-portal)
9. [Notifications System](#9-notifications-system)
10. [Design System](#10-design-system)

---

# 1. PROJECT OVERVIEW

## 1.1 What It Does

A Vehicle Health Check (VHC) system that allows:
1. **Technicians** to inspect vehicles using a mobile/tablet interface, recording RAG (Red/Amber/Green) status for each check item with photos
2. **Service Advisors** to review findings, add pricing, preview, and send reports to customers
3. **Customers** to view their health check online, see photos of issues, and authorize/decline repairs with digital signature
4. **Management** to track status, measure performance, and see real-time dashboard

## 1.2 Core Workflow

```
Job Created → Tech Assigned → Tech Inspects (clock in/out) → Tech Complete
    → Advisor Reviews → Advisor Prices → Preview → Send to Customer
    → Customer Opens → Customer Authorizes/Declines → Work Scheduled
```

## 1.3 Multi-Tenancy

- **Organizations** own multiple **Sites** (dealership locations)
- **Sites** have **Users**, **Customers**, **Vehicles**, **Templates**
- All data is isolated by organization with Row Level Security (RLS)

---

# 2. ARCHITECTURE

## 2.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
├─────────────────────────────────────────────────────────────────┤
│  React SPA (Vite)           │  Customer Portal (Public)         │
│  - Admin/Advisor Dashboard  │  - View health check              │
│  - Technician PWA           │  - Authorize/decline              │
│  - Template Builder         │  - Signature capture              │
└─────────────────────────────┴───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API LAYER (Hono)                            │
├─────────────────────────────────────────────────────────────────┤
│  /api/v1/health-checks      │  /api/v1/templates                │
│  /api/v1/customers          │  /api/v1/users                    │
│  /api/v1/dashboard          │  /api/public/vhc/:token           │
└─────────────────────────────┴───────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    SUPABASE     │ │     REDIS       │ │    STORAGE      │
│   PostgreSQL    │ │    + BullMQ     │ │   (Supabase)    │
│   + Auth        │ │   Job Queue     │ │   Photos/PDFs   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## 2.2 Railway Services

```yaml
services:
  vhc-api:
    type: web
    runtime: node
    buildCommand: npm run build
    startCommand: npm run start
    envVars:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
      REDIS_URL: ${{ services.redis.REDIS_URL }}
      TWILIO_ACCOUNT_SID: ${{ secrets.TWILIO_ACCOUNT_SID }}
      TWILIO_AUTH_TOKEN: ${{ secrets.TWILIO_AUTH_TOKEN }}
      RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}

  vhc-worker:
    type: worker
    runtime: node
    startCommand: npm run worker
    envVars:
      REDIS_URL: ${{ services.redis.REDIS_URL }}

  redis:
    type: redis
```

---

# 3. DATABASE SCHEMA

## 3.1 Complete SQL Schema

```sql
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
  FOR ALL USING (id = current_setting('app.current_org_id')::uuid);

CREATE POLICY site_isolation ON sites
  FOR ALL USING (organization_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY user_isolation ON users
  FOR ALL USING (organization_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY customer_isolation ON customers
  FOR ALL USING (organization_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY vehicle_isolation ON vehicles
  FOR ALL USING (organization_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY template_isolation ON check_templates
  FOR ALL USING (organization_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY health_check_isolation ON health_checks
  FOR ALL USING (organization_id = current_setting('app.current_org_id')::uuid);

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
```

---

# 4. API SPECIFICATION

## 4.1 API Structure

```
/api/v1/
├── auth/
│   ├── POST /login
│   ├── POST /logout
│   └── GET  /me
├── health-checks/
│   ├── GET    /                    # List (with filters)
│   ├── POST   /                    # Create
│   ├── GET    /:id                 # Get single
│   ├── PATCH  /:id                 # Update
│   ├── POST   /:id/status          # Change status
│   ├── POST   /:id/clock-in        # Tech clock in
│   ├── POST   /:id/clock-out       # Tech clock out
│   ├── GET    /:id/results         # Get all results
│   ├── POST   /:id/results         # Save result
│   ├── POST   /:id/results/:rid/media  # Upload photo
│   ├── GET    /:id/repair-items    # Get repair items
│   ├── POST   /:id/repair-items    # Add repair item
│   ├── PATCH  /:id/repair-items/:rid   # Update repair item
│   ├── GET    /:id/preview         # Preview for advisor
│   ├── POST   /:id/publish         # Send to customer
│   └── GET    /:id/history         # Status history
├── templates/
│   ├── GET    /
│   ├── POST   /
│   ├── GET    /:id
│   ├── PATCH  /:id
│   └── DELETE /:id
├── customers/
│   ├── GET    /
│   ├── POST   /
│   ├── GET    /:id
│   └── PATCH  /:id
├── vehicles/
│   ├── GET    /
│   ├── POST   /
│   └── GET    /:id
├── users/
│   ├── GET    /
│   ├── POST   /
│   ├── GET    /:id
│   └── PATCH  /:id
├── dashboard/
│   ├── GET    /                    # Main dashboard data
│   ├── GET    /board               # Kanban board data
│   └── GET    /technicians         # Technician workload
└── notifications/
    ├── GET    /                    # User's notifications
    ├── PATCH  /:id/read            # Mark as read
    └── POST   /dismiss-all         # Dismiss all

/api/public/
├── vhc/:token                      # Customer portal data
├── vhc/:token/authorize            # Authorize repair item
├── vhc/:token/decline              # Decline repair item
├── vhc/:token/signature            # Submit signature
└── vhc/:token/track                # Track customer activity
```

## 4.2 Key Request/Response Examples

### Create Health Check
```typescript
POST /api/v1/health-checks
{
  "templateId": "uuid",
  "vehicleId": "uuid",
  "customerId": "uuid",
  "technicianId": "uuid",
  "jobNumber": "SVC-2026-0142",
  "jobType": "Full Service",
  "bayNumber": "3",
  "mileageIn": 45230
}

Response: 201
{
  "id": "uuid",
  "status": "assigned",
  ...
}
```

### Save Check Result
```typescript
POST /api/v1/health-checks/:id/results
{
  "templateItemId": "uuid",
  "ragStatus": "amber",
  "value": { "measurement": 3.2 },
  "notes": "Showing signs of wear"
}
```

### Publish to Customer
```typescript
POST /api/v1/health-checks/:id/publish
{
  "sendVia": ["sms", "email"],
  "mobile": "+447700900123",
  "email": "customer@example.com",
  "linkExpiryHours": 72,
  "remindersEnabled": true,
  "reminderIntervals": [24, 48],
  "showPricing": true,
  "requireSignature": true,
  "customMessage": "Hi John, please review..."
}

Response: 200
{
  "publicToken": "abc123...",
  "publicUrl": "https://vhc.example.com/c/abc123",
  "expiresAt": "2026-01-18T14:30:00Z"
}
```

---

# 5. STATUS WORKFLOW

## 5.1 Complete Status List

| Status | Code | Owner | Description |
|--------|------|-------|-------------|
| Created | `created` | System | Job created, awaiting assignment |
| Assigned | `assigned` | Technician | Assigned to tech, in queue |
| In Progress | `in_progress` | Technician | Tech actively working (clocked in) |
| Paused | `paused` | Technician | Tech paused (clocked out) |
| Tech Completed | `tech_completed` | Advisor | Inspection complete |
| Awaiting Review | `awaiting_review` | Advisor | Needs advisor review |
| Awaiting Pricing | `awaiting_pricing` | Advisor | Needs pricing |
| Awaiting Parts | `awaiting_parts` | Advisor | Waiting for parts info |
| Ready to Send | `ready_to_send` | Advisor | Ready to publish |
| Sent | `sent` | Customer | Published, notification sent |
| Delivered | `delivered` | Customer | SMS/Email confirmed |
| Opened | `opened` | Customer | Customer viewed |
| Partial Response | `partial_response` | Customer | Some items actioned |
| Authorized | `authorized` | Complete | All approved |
| Declined | `declined` | Complete | All declined |
| Expired | `expired` | Complete | Link expired |
| Completed | `completed` | Closed | Work done |
| Cancelled | `cancelled` | Closed | Cancelled |

## 5.2 Status Flow Diagram

```
created → assigned → in_progress ↔ paused → tech_completed
                                                    ↓
    ready_to_send ← awaiting_pricing ← awaiting_review
          ↓                ↕
         sent         awaiting_parts
          ↓
     delivered → opened → partial_response
                    ↓           ↓
              authorized / declined / expired
                          ↓
                      completed
```

---

# 6. USER INTERFACES

## 6.1 Service Advisor Dashboard

Main dashboard showing:
- Summary cards (counts by status category)
- Needs Attention section (overdue, expiring)
- Technician Queue (live progress)
- Advisor Queue (awaiting pricing, ready to send)
- Customer Queue (sent, viewed, responding)
- Today's completions with conversion metrics

## 6.2 Kanban Board View

Columns:
1. **Technician** (Assigned, In Progress, Paused)
2. **Tech Done** (Tech Completed)
3. **Advisor** (Awaiting Review, Pricing, Parts, Ready)
4. **With Customer** (Sent, Delivered, Opened, Partial)
5. **Actioned** (Authorized, Declined)

## 6.3 Health Check Detail Page

Tabs:
- **Summary** - Overview, RAG counts, customer info
- **Results** - All check items with RAG status
- **Pricing** - Repair items with costs
- **Photos** - Gallery of all images
- **Timeline** - Status history with timestamps
- **Activity** - Customer activity log

## 6.4 Template Builder

- Drag-and-drop sections and items
- Configure item types (RAG, measurement, etc.)
- Set required/optional
- Preview template
- Version management

---

# 7. TECHNICIAN MOBILE APP

## 7.1 Key Requirements

- **PWA** (Progressive Web App) for Phase 1
- **Offline-first** with IndexedDB + background sync
- **Large touch targets** (56px minimum) for gloves
- **One-handed operation** with bottom navigation
- **High contrast** for workshop lighting

## 7.2 Core Screens

1. **Job List** - Today's assigned jobs with status
2. **Pre-Check** - Confirm vehicle, enter mileage
3. **Inspection** - RAG buttons, photo capture, notes
4. **Tyre Depth** - 4-position input per tyre
5. **Section Overview** - Jump between sections
6. **Summary** - Review before submitting

## 7.3 Key Components

```typescript
// RAG Selector - Large buttons for glove use
<RAGSelector
  value="amber"
  onChange={(status) => saveResult(status)}
  size="large" // 72px height
/>

// Photo Capture - Full screen camera with annotation
<PhotoCapture
  onCapture={(photo) => uploadPhoto(photo)}
  maxPhotos={5}
  allowAnnotation={true}
/>

// Tyre Depth Input - Visual 4-position grid
<TyreDepthInput
  position="front_left"
  onComplete={(depths) => saveDepths(depths)}
/>
```

## 7.4 Offline Architecture

```typescript
// IndexedDB stores
- jobs: Assigned health checks with full data
- results: Check results pending sync
- media: Photos/videos pending upload
- syncQueue: Pending API calls

// Service Worker
- Cache app shell
- Queue failed requests
- Background sync when online
```

---

# 8. CUSTOMER PORTAL

## 8.1 Public URL Structure

```
https://vhc.example.com/c/{publicToken}
```

No login required - token-based access with expiry.

## 8.2 Portal Sections

1. **Header** - Dealer logo, vehicle info, date
2. **Summary** - RAG count boxes (green/amber/red)
3. **Urgent Items** (Red) - With photos, pricing, approve/decline
4. **Advisory Items** (Amber) - Same format
5. **Passed Items** - Collapsed list of green items
6. **Signature** - Canvas for digital signature
7. **Submit** - Confirm all decisions

## 8.3 Mobile-First Design

- 90%+ customers view on phone
- Large approve/decline buttons
- Swipeable photo gallery
- Collapsible sections
- Fixed bottom action bar

## 8.4 Preview Mode

Service Advisors can preview exactly what customer sees:
- Same React component with `previewMode={true}`
- Approve/Decline buttons disabled
- Toggle between Mobile/Tablet/Desktop widths
- Edit/Send buttons in preview header

---

# 9. NOTIFICATIONS SYSTEM

## 9.1 Customer Notifications

| Event | SMS | Email |
|-------|-----|-------|
| Health check ready | ✓ | ✓ |
| Reminder (24h) | ✓ | ✓ |
| Reminder (48h) | ✓ | ✓ |
| Link expiring soon | ✓ | ✓ |

## 9.2 Staff Notifications

| Event | In-App | Email | SMS |
|-------|--------|-------|-----|
| Customer viewed | ✓ | ✓ | - |
| Customer authorized | ✓ | ✓ | ✓ |
| Customer declined | ✓ | ✓ | - |
| Link expiring | ✓ | - | - |
| Link expired | ✓ | ✓ | - |

## 9.3 Real-Time (WebSocket)

```typescript
// Events pushed to dashboard
'health_check:status_changed'
'technician:clocked_in'
'technician:progress_updated'
'customer:viewing'
'customer:action'
'alert:sla_warning'
```

## 9.4 Publish Settings

Configurable at Site level with per-check override:
- Link expiry: 24h, 48h, 72h (default), 5d, 7d, 14d
- Reminders: Enable/disable, intervals
- Display: Show pricing, parts breakdown, PDF download
- Signature: Required/optional

---

# 10. DESIGN SYSTEM

## 10.1 Core Principles

- **Square edges** (no rounded corners) - Professional, automotive aesthetic
- **High contrast** - Works in bright workshop lighting
- **Large touch targets** - Glove-friendly (56px min)
- **RAG colors** - Industry standard traffic light system

## 10.2 Color Tokens

```css
:root {
  /* Primary */
  --color-primary: #1e40af;
  --color-primary-dark: #1e3a8a;
  
  /* RAG Status */
  --color-rag-green: #16a34a;
  --color-rag-green-bg: #dcfce7;
  --color-rag-amber: #ca8a04;
  --color-rag-amber-bg: #fef9c3;
  --color-rag-red: #dc2626;
  --color-rag-red-bg: #fee2e2;
  
  /* Neutrals */
  --color-gray-50: #f9fafb;
  --color-gray-900: #111827;
  
  /* Status */
  --color-success: #16a34a;
  --color-warning: #ca8a04;
  --color-error: #dc2626;
  --color-info: #2563eb;
}
```

## 10.3 Component Styles

```css
/* Buttons - Square edges */
.btn {
  border-radius: 0;
  font-weight: 600;
  min-height: 44px;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

/* Cards - Sharp corners, subtle shadow */
.card {
  border-radius: 0;
  border: 1px solid var(--color-gray-200);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

/* RAG Status Indicators */
.rag-green { background: var(--color-rag-green); }
.rag-amber { background: var(--color-rag-amber); }
.rag-red { background: var(--color-rag-red); }
```

## 10.4 Typography

```css
/* Font Stack */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

/* Scale */
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
```

---

# BUILD CHECKLIST

## Phase 1: Foundation (Week 1-2)
- [ ] Supabase project setup
- [ ] Database schema migration
- [ ] Hono API scaffolding
- [ ] Supabase Auth integration
- [ ] User CRUD endpoints
- [ ] Basic React app structure

## Phase 2: Templates (Week 3)
- [ ] Template CRUD API
- [ ] Template builder UI
- [ ] Section/item drag-and-drop
- [ ] Default template seeding

## Phase 3: Technician App (Week 4-6)
- [ ] PWA setup with Vite
- [ ] Job list screen
- [ ] Inspection interface
- [ ] RAG selector component
- [ ] Photo capture + annotation
- [ ] Tyre/brake inputs
- [ ] Offline storage (IndexedDB)
- [ ] Background sync

## Phase 4: Advisor Interface (Week 7-8)
- [ ] Health check list/detail views
- [ ] Pricing interface
- [ ] Customer preview
- [ ] Publish modal
- [ ] Repair item management

## Phase 5: Customer Portal (Week 9-10)
- [ ] Public token validation
- [ ] Portal UI (mobile-first)
- [ ] Photo gallery
- [ ] Authorize/decline flow
- [ ] Signature capture
- [ ] Activity tracking

## Phase 6: Notifications (Week 11-12)
- [ ] BullMQ job queue setup
- [ ] Twilio SMS integration
- [ ] Resend email integration
- [ ] WebSocket (Socket.io)
- [ ] In-app notifications
- [ ] Reminder scheduling

## Phase 7: Dashboard (Week 13-14)
- [ ] Dashboard API endpoints
- [ ] Summary metrics
- [ ] Kanban board view
- [ ] Real-time updates
- [ ] Technician workload view

## Phase 8: Polish (Week 15-16)
- [ ] PDF generation
- [ ] Performance optimization
- [ ] Error handling
- [ ] Testing
- [ ] Security audit
- [ ] Deployment

---

*Document Version: 1.0*
*Consolidated: January 2026*
*For: Claude Code / AI-Assisted Development*
