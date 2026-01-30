# VHC Multi-Tenant Architecture
## Complete Platform & Tenant Management System

---

# 1. OVERVIEW

## 1.1 Tenant Hierarchy

```
PLATFORM (Your Company - e.g., "VHC Platform")
│
├── Super Admins (Platform staff)
│   ├── Can create/manage ALL organizations
│   ├── Can impersonate users for support
│   ├── Access platform analytics
│   └── Manage subscriptions/billing
│
└── Organizations (Tenants = Businesses)
    │
    ├── ABC Motors Ltd (Organization 1)
    │   ├── Organization Admins (Business owners)
    │   ├── Settings (branding, notifications, billing)
    │   ├── Sites (Branches/Locations)
    │   │   ├── ABC Motors Birmingham
    │   │   │   ├── Site Admin
    │   │   │   ├── Service Advisors
    │   │   │   ├── Technicians
    │   │   │   └── Parts Users
    │   │   └── ABC Motors London
    │   │       └── ... staff ...
    │   └── Customers & Vehicles (org-wide)
    │
    └── XYZ Automotive Group (Organization 2)
        └── ... same structure ...
```

## 1.2 User Role Hierarchy

| Role | Scope | Can Manage |
|------|-------|------------|
| **Super Admin** | Platform-wide | All organizations, all users, platform settings |
| **Org Admin** | Single organization | Sites, users, org settings, notification credentials |
| **Site Admin** | Single site | Users at site, site settings |
| **Service Advisor** | Single site | Health checks, customers, pricing |
| **Technician** | Single site | Inspections only |
| **Parts** | Single site | Parts pricing only |

---

# 2. DATABASE SCHEMA

## 2.1 Platform Level — Super Admins

```sql
-- Super admins are platform-level users (separate from tenant users)
CREATE TABLE super_admins (
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
CREATE TABLE super_admin_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  super_admin_id UUID REFERENCES super_admins(id),
  action VARCHAR(100) NOT NULL,  -- 'create_org', 'impersonate', 'update_subscription'
  target_type VARCHAR(50),       -- 'organization', 'user', 'site'
  target_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 2.2 Organization (Tenant) Enhancements

```sql
-- Update organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
  -- Statuses: pending, trial, active, suspended, cancelled

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;

-- Organization branding & settings
CREATE TABLE organization_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Branding
  logo_url TEXT,
  logo_dark_url TEXT,              -- For dark mode
  favicon_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#2563eb',   -- Hex color
  secondary_color VARCHAR(7) DEFAULT '#1e40af',
  
  -- Business Details
  legal_name VARCHAR(255),
  company_number VARCHAR(50),      -- UK company registration
  vat_number VARCHAR(50),
  
  -- Contact
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  county VARCHAR(100),
  postcode VARCHAR(20),
  country VARCHAR(100) DEFAULT 'United Kingdom',
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

-- Subscription / Billing
CREATE TABLE organization_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Plan
  plan_id VARCHAR(50) NOT NULL,    -- 'starter', 'professional', 'enterprise'
  plan_name VARCHAR(100),
  
  -- Limits
  max_sites INTEGER DEFAULT 1,
  max_users INTEGER DEFAULT 5,
  max_health_checks_per_month INTEGER,  -- NULL = unlimited
  max_storage_gb INTEGER DEFAULT 5,
  
  -- Billing
  billing_cycle VARCHAR(20) DEFAULT 'monthly',  -- 'monthly', 'annual'
  price_per_month DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'GBP',
  
  -- Trial
  trial_ends_at TIMESTAMPTZ,
  is_trial BOOLEAN DEFAULT false,
  
  -- Status
  status VARCHAR(50) DEFAULT 'active',  -- 'active', 'past_due', 'cancelled', 'paused'
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  
  -- External billing (Stripe, etc.)
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id)
);

-- Usage tracking
CREATE TABLE organization_usage (
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
```

## 2.3 Update Users Table

```sql
-- Add org admin flag and site admin capability
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_org_admin BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_site_admin BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Users can potentially access multiple sites (for org admins)
CREATE TABLE user_site_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,  -- Role at this specific site
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, site_id)
);

-- Index
CREATE INDEX idx_user_site_access_user ON user_site_access(user_id);
CREATE INDEX idx_user_site_access_site ON user_site_access(site_id);
```

## 2.4 Plans / Pricing Table

```sql
-- Available subscription plans
CREATE TABLE subscription_plans (
  id VARCHAR(50) PRIMARY KEY,  -- 'starter', 'professional', 'enterprise'
  name VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- Limits
  max_sites INTEGER,
  max_users INTEGER,
  max_health_checks_per_month INTEGER,  -- NULL = unlimited
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
INSERT INTO subscription_plans (id, name, description, max_sites, max_users, max_health_checks_per_month, max_storage_gb, price_monthly, price_annual, features, sort_order) VALUES
('starter', 'Starter', 'Perfect for single-site workshops', 1, 5, 100, 5, 49.00, 490.00, 
 '{"dms_integration": false, "api_access": false, "priority_support": false}', 1),
('professional', 'Professional', 'For growing businesses', 3, 15, 500, 25, 99.00, 990.00,
 '{"dms_integration": true, "api_access": false, "priority_support": true}', 2),
('enterprise', 'Enterprise', 'For large dealer groups', NULL, NULL, NULL, 100, 249.00, 2490.00,
 '{"dms_integration": true, "api_access": true, "priority_support": true, "dedicated_support": true}', 3);
```

---

# 3. SUPER ADMIN PORTAL

## 3.1 Separate App or Route?

**Recommended: Separate subdomain**
```
app.vhcplatform.com      → Tenant app (organizations)
admin.vhcplatform.com    → Super admin portal
```

Or route-based:
```
app.vhcplatform.com/admin/*  → Super admin (check super_admin role)
```

## 3.2 Super Admin Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🔧 VHC Platform Admin                              [John Smith ▼] [Logout] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐              │
│  │   42    │ │   38    │ │    3    │ │    1    │ │  £4.2k  │              │
│  │  Total  │ │ Active  │ │  Trial  │ │Suspended│ │   MRR   │              │
│  │  Orgs   │ │  Orgs   │ │  Orgs   │ │  Orgs   │ │         │              │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘              │
│                                                                             │
│  ORGANIZATIONS                                        [+ Create New Org]    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                             │
│  Search: [________________________]  Status: [All ▼]  Plan: [All ▼]        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Organization        Sites  Users  Plan          Status     Actions  │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ ABC Motors Ltd      2      8      Professional  ● Active   [•••]   │   │
│  │ XYZ Automotive      5      23     Enterprise    ● Active   [•••]   │   │
│  │ Quick Fix Garage    1      3      Starter       ● Trial    [•••]   │   │
│  │ Smith & Sons Auto   1      4      Professional  ○ Suspended[•••]   │   │
│  │ ...                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  RECENT ACTIVITY                                                            │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  • ABC Motors Ltd upgraded to Professional (2 hours ago)                    │
│  • Quick Fix Garage started trial (5 hours ago)                            │
│  • XYZ Automotive added new site "Manchester" (1 day ago)                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3.3 Organization Detail (Super Admin View)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Back to Organizations                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ABC Motors Ltd                                          ● Active           │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                             │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐                  │
│  │ Overview │  Sites   │  Users   │ Billing  │ Activity │                  │
│  │          │          │          │          │          │                  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘                  │
│                                                                             │
│  SUBSCRIPTION                           USAGE THIS MONTH                    │
│  ─────────────────────                  ─────────────────────               │
│  Plan: Professional                     Health Checks: 127 / 500            │
│  Price: £99/month                       SMS Sent: 89                        │
│  Next billing: 15 Feb 2026              Emails Sent: 134                    │
│  Status: Active                         Storage: 2.3 GB / 25 GB             │
│                                                                             │
│  [Change Plan] [Pause] [Cancel]                                             │
│                                                                             │
│  QUICK ACTIONS                                                              │
│  ─────────────────────                                                      │
│  [👤 Impersonate User]  [📧 Send Message]  [🔄 Reset Password]             │
│                                                                             │
│  ORGANIZATION ADMINS                                                        │
│  ─────────────────────                                                      │
│  • John Smith (john@abcmotors.com) — Owner                                  │
│  • Sarah Jones (sarah@abcmotors.com) — Admin                               │
│                                                                             │
│  NOTES                                                                      │
│  ─────────────────────                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 15/01/2026 - Called about DMS integration, scheduled demo for      │   │
│  │              next week. - JS                                        │   │
│  │                                                                     │   │
│  │ [+ Add Note]                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3.4 Create Organization Flow (Super Admin)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Create New Organization                                               ✕    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 1 OF 3: Business Details                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                             │
│  Organization Name *                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ABC Motors Ltd                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Legal Name (if different)                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Primary Contact Email *                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  owner@abcmotors.com                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phone                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  +44 121 234 5678                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                                                         [Cancel] [Next →]   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Create New Organization                                               ✕    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 2 OF 3: Subscription                                                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                             │
│  Select Plan                                                                │
│                                                                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │    STARTER      │ │  PROFESSIONAL   │ │   ENTERPRISE    │              │
│  │    £49/mo       │ │    £99/mo       │ │    £249/mo      │              │
│  │                 │ │    ★ POPULAR    │ │                 │              │
│  │  1 site         │ │  3 sites        │ │  Unlimited      │              │
│  │  5 users        │ │  15 users       │ │  Unlimited      │              │
│  │  100 checks/mo  │ │  500 checks/mo  │ │  Unlimited      │              │
│  │                 │ │                 │ │                 │              │
│  │  [Select]       │ │  [Selected ✓]   │ │  [Select]       │              │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘              │
│                                                                             │
│  ☑ Start with 14-day free trial                                            │
│                                                                             │
│                                                      [← Back] [Next →]      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Create New Organization                                               ✕    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 3 OF 3: First Admin User                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                             │
│  This person will be the organization owner with full admin access.         │
│                                                                             │
│  Full Name *                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  John Smith                                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Email * (login email)                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  owner@abcmotors.com                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ☑ Send welcome email with login instructions                              │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  SUMMARY                                                                    │
│  Organization: ABC Motors Ltd                                               │
│  Plan: Professional (14-day trial, then £99/month)                         │
│  Admin: John Smith (owner@abcmotors.com)                                   │
│                                                                             │
│                                              [← Back] [Create Organization] │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3.5 Impersonate User

Super admins can "impersonate" a user to troubleshoot issues:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Impersonate User                                                      ✕    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ⚠️ You are about to impersonate a user. This action is logged.            │
│                                                                             │
│  Organization: ABC Motors Ltd                                               │
│  User: Sarah Jones (sarah@abcmotors.com)                                   │
│  Role: Service Advisor                                                      │
│                                                                             │
│  Reason for impersonation *                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  User reported issue with pricing screen not loading               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Start Impersonation                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

When impersonating, show a banner:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ IMPERSONATING: Sarah Jones (ABC Motors Ltd)              [End Session]  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# 4. ORGANIZATION ONBOARDING

## 4.1 Self-Service Sign Up (Optional)

If you want organizations to sign up themselves:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                        🚗 Vehicle Health Check                              │
│                                                                             │
│                    Start your 14-day free trial                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Business Name                                                      │   │
│  │  [                                                                ] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Your Name                                                          │   │
│  │  [                                                                ] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Email                                                              │   │
│  │  [                                                                ] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Password                                                           │   │
│  │  [                                                                ] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Start Free Trial                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Already have an account? [Sign in]                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 4.2 Onboarding Wizard (Post Sign-Up)

After creating account, guide them through setup:

```
Step 1: Business Details
  - Logo upload
  - Address
  - Phone, Email, Website
  
Step 2: First Site
  - Site name
  - Address (can copy from org)
  - Contact details
  
Step 3: Invite Team
  - Add service advisors
  - Add technicians
  - Skip for now option
  
Step 4: Notification Setup
  - Twilio credentials (or skip)
  - Resend credentials (or skip)
  - Test connections
  
Step 5: First Template
  - Use default template
  - Or customize
  
Step 6: Ready!
  - Create first health check
  - Watch tutorial video
```

## 4.3 Onboarding Progress Tracking

```sql
-- Track onboarding progress
UPDATE organizations 
SET onboarding_step = 3, 
    onboarding_completed = false 
WHERE id = 'xxx';

-- Onboarding steps:
-- 0: Just created
-- 1: Business details completed
-- 2: First site created
-- 3: First user invited (besides owner)
-- 4: Notifications configured
-- 5: Template reviewed
-- 6: Complete
```

---

# 5. ORGANIZATION ADMIN PORTAL

## 5.1 Org Admin Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ABC Motors Ltd                                          [Settings] [Help]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Welcome back, John! Here's your overview.                                  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SUBSCRIPTION: Professional                     [Manage Billing →]  │   │
│  │  2 of 3 sites used • 8 of 15 users • 127 of 500 checks this month  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  SITES                                                   [+ Add Site]       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Site                  Users  Today  This Month  Status              │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Birmingham            5      12     78          ● Active            │   │
│  │ London                3      8      49          ● Active            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  TEAM                                                    [+ Invite User]    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Name              Email                  Site         Role          │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ John Smith        john@abc.com           All Sites    Owner         │   │
│  │ Sarah Jones       sarah@abc.com          All Sites    Admin         │   │
│  │ Mike Tech         mike@abc.com           Birmingham   Technician    │   │
│  │ Lisa Advisor      lisa@abc.com           Birmingham   Advisor       │   │
│  │ ...                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 5.2 Org Settings Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Settings                                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  General              Business details, branding                    │   │
│  │  Sites                Manage locations                              │   │
│  │  Users                Manage team members                           │   │
│  │  Notifications        SMS & Email setup                             │   │
│  │  Templates            Inspection templates                          │   │
│  │  Thresholds           Tyre & brake thresholds                       │   │
│  │  Integrations         DMS, API access                               │   │
│  │  Billing              Subscription & invoices                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# 6. API ENDPOINTS

## 6.1 Super Admin Endpoints

```
# Organizations
GET    /api/v1/admin/organizations              # List all orgs (paginated)
POST   /api/v1/admin/organizations              # Create org
GET    /api/v1/admin/organizations/:id          # Get org details
PATCH  /api/v1/admin/organizations/:id          # Update org
DELETE /api/v1/admin/organizations/:id          # Delete org (soft)

# Organization management
POST   /api/v1/admin/organizations/:id/suspend  # Suspend org
POST   /api/v1/admin/organizations/:id/activate # Activate org
GET    /api/v1/admin/organizations/:id/usage    # Get usage stats

# Subscriptions
GET    /api/v1/admin/organizations/:id/subscription
PATCH  /api/v1/admin/organizations/:id/subscription
POST   /api/v1/admin/organizations/:id/subscription/change-plan

# Impersonation
POST   /api/v1/admin/impersonate/:userId        # Start impersonation
DELETE /api/v1/admin/impersonate                # End impersonation

# Platform stats
GET    /api/v1/admin/stats                      # Platform-wide stats
GET    /api/v1/admin/activity                   # Recent activity

# Plans
GET    /api/v1/admin/plans                      # List subscription plans
POST   /api/v1/admin/plans                      # Create plan
PATCH  /api/v1/admin/plans/:id                  # Update plan
```

## 6.2 Organization Admin Endpoints

```
# Organization settings
GET    /api/v1/organizations/:id/settings       # Get settings
PATCH  /api/v1/organizations/:id/settings       # Update settings

# Sites (org admin can manage)
GET    /api/v1/organizations/:id/sites          # List org sites
POST   /api/v1/organizations/:id/sites          # Create site
PATCH  /api/v1/sites/:id                        # Update site
DELETE /api/v1/sites/:id                        # Delete site

# Users (org admin can manage)
GET    /api/v1/organizations/:id/users          # List org users
POST   /api/v1/organizations/:id/users          # Invite user
PATCH  /api/v1/users/:id                        # Update user
DELETE /api/v1/users/:id                        # Deactivate user

# Billing
GET    /api/v1/organizations/:id/subscription   # Get subscription
GET    /api/v1/organizations/:id/invoices       # List invoices
POST   /api/v1/organizations/:id/subscription/upgrade  # Upgrade plan
```

---

# 7. AUTHENTICATION FLOW

## 7.1 Login Detection

When user logs in, determine their type:

```typescript
async function handleLogin(email: string, password: string) {
  // 1. Authenticate with Supabase
  const { data: authData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) throw error;
  
  // 2. Check if super admin
  const { data: superAdmin } = await supabase
    .from('super_admins')
    .select('*')
    .eq('auth_user_id', authData.user.id)
    .single();
  
  if (superAdmin) {
    // Redirect to super admin portal
    return { type: 'super_admin', redirect: '/admin' };
  }
  
  // 3. Check if regular user
  const { data: user } = await supabase
    .from('users')
    .select('*, organization:organizations(*), site:sites(*)')
    .eq('auth_user_id', authData.user.id)
    .single();
  
  if (user) {
    // Redirect to tenant app
    return { type: 'user', user, redirect: '/dashboard' };
  }
  
  throw new Error('User not found in any organization');
}
```

## 7.2 Middleware Updates

```typescript
// Check if super admin
export function requireSuperAdmin() {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    
    const { data: superAdmin } = await supabase
      .from('super_admins')
      .select('*')
      .eq('auth_user_id', user.id)
      .single();
    
    if (!superAdmin) {
      return c.json({ error: 'Super admin access required' }, 403);
    }
    
    c.set('superAdmin', superAdmin);
    await next();
  };
}

// Check if org admin
export function requireOrgAdmin() {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    
    if (!user.is_org_admin) {
      return c.json({ error: 'Organization admin access required' }, 403);
    }
    
    await next();
  };
}
```

---

# 8. IMPLEMENTATION CHECKLIST

## 8.1 Database
- [ ] Create `super_admins` table
- [ ] Create `super_admin_activity_log` table
- [ ] Create `organization_settings` table
- [ ] Create `organization_subscriptions` table
- [ ] Create `organization_usage` table
- [ ] Create `subscription_plans` table
- [ ] Create `user_site_access` table
- [ ] Update `users` table with `is_org_admin`, `is_site_admin`
- [ ] Update `organizations` table with `status`, `onboarding_*`
- [ ] Seed subscription plans
- [ ] Add RLS policies for all new tables

## 8.2 API — Super Admin
- [ ] CRUD for organizations
- [ ] Organization suspend/activate
- [ ] Impersonation start/end
- [ ] Platform stats endpoint
- [ ] Activity log endpoint
- [ ] Plans CRUD

## 8.3 API — Org Admin
- [ ] Organization settings get/update
- [ ] Sites management
- [ ] Users management (invite, update, deactivate)
- [ ] Subscription/billing endpoints

## 8.4 Super Admin Portal
- [ ] Login page (separate or shared)
- [ ] Dashboard with org list
- [ ] Organization detail page
- [ ] Create organization wizard
- [ ] Impersonate user modal
- [ ] Platform stats dashboard

## 8.5 Organization Admin UI
- [ ] Org admin dashboard
- [ ] Settings page structure
- [ ] Business details settings
- [ ] Branding settings (logo upload)
- [ ] Sites management page
- [ ] Users management page
- [ ] Billing/subscription page

## 8.6 Onboarding
- [ ] Self-service signup page (optional)
- [ ] Onboarding wizard (6 steps)
- [ ] Progress tracking
- [ ] Skip options

## 8.7 Authentication
- [ ] Update login to detect super admin vs user
- [ ] Super admin middleware
- [ ] Org admin middleware
- [ ] Impersonation handling
- [ ] Impersonation banner UI

---

# 9. SECURITY CONSIDERATIONS

1. **Super Admin Isolation** — Super admins should not be in the `users` table
2. **Audit Logging** — Log ALL super admin actions
3. **Impersonation** — Require reason, log everything, show banner
4. **RLS Policies** — Ensure org users cannot access other orgs
5. **Rate Limiting** — Protect signup and login endpoints
6. **Encryption** — Encrypt all credentials at rest
7. **Subscription Enforcement** — Check limits before allowing actions

---

# 10. SUMMARY

This multi-tenant architecture provides:

| Feature | Description |
|---------|-------------|
| **Super Admin Portal** | Platform-wide management of all organizations |
| **Organization Admin** | Self-service management of their business |
| **Site Management** | Multiple locations per organization |
| **User Management** | Role-based access at org and site level |
| **Subscription/Billing** | Plan limits, usage tracking, upgrades |
| **Onboarding** | Guided setup for new organizations |
| **Impersonation** | Support access with audit trail |
| **Branding** | Per-organization logo and colors |

---

*Document Version: 1.0*
*Created: January 2026*
