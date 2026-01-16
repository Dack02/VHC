# VHC Multi-Tenant — Build Tasks
> **For use with Claude Code**
> 
> Reference: `docs/vhc-multi-tenant-spec.md`
> 
> **Decisions:**
> - Route-based admin (`/admin/*`) — single app
> - Platform-level credentials with org override option
> - No self-service signup (Super Admin creates orgs)
> - No Stripe billing (manual for now)
> - No trial period

---

## Phase 1: Database Schema
**Estimated iterations: 15-20**

```bash
claude -p "Read docs/vhc-multi-tenant-spec.md. Complete Phase 1 tasks in TODO-multi-tenant.md. Create all database tables and migrations. Check off each task with [x] when done." --dangerously-skip-permissions
```

### 1.1 Super Admin Tables
- [x] Create `super_admins` table:
  - id, email, name, auth_user_id, is_active, last_login_at, created_at, updated_at
- [x] Create `super_admin_activity_log` table:
  - id, super_admin_id, action, target_type, target_id, details (JSONB), ip_address, user_agent, created_at

### 1.2 Platform Settings Table
- [x] Create `platform_settings` table:
  - id (VARCHAR PK), settings (JSONB), updated_at, updated_by
- [x] Seed default platform notification settings (empty, to be configured via UI)

### 1.3 Organization Enhancements
- [x] Add `status` VARCHAR(50) DEFAULT 'active' to organizations (pending, active, suspended, cancelled)
- [x] Add `onboarding_completed` BOOLEAN DEFAULT false to organizations
- [x] Add `onboarding_step` INTEGER DEFAULT 0 to organizations

### 1.4 Organization Settings Table
- [x] Create `organization_settings` table:
  - id, organization_id (unique FK)
  - Branding: logo_url, logo_dark_url, favicon_url, primary_color, secondary_color
  - Business: legal_name, company_number, vat_number
  - Address: address_line1, address_line2, city, county, postcode, country
  - Contact: phone, email, website
  - Preferences: timezone, date_format, currency
  - features_enabled (JSONB)
  - created_at, updated_at

### 1.5 Organization Notification Settings Table
- [x] Create `organization_notification_settings` table:
  - id, organization_id (unique FK)
  - use_platform_sms BOOLEAN DEFAULT true
  - use_platform_email BOOLEAN DEFAULT true
  - SMS: sms_enabled, twilio_account_sid_encrypted, twilio_auth_token_encrypted, twilio_phone_number
  - Email: email_enabled, resend_api_key_encrypted, resend_from_email, resend_from_name
  - Defaults: default_link_expiry_hours, default_reminder_enabled, default_reminder_intervals (JSONB)
  - created_at, updated_at

### 1.6 Subscription Tables (Basic - No Stripe)
- [x] Create `subscription_plans` table:
  - id (VARCHAR PK: 'starter', 'professional', 'enterprise')
  - name, description
  - Limits: max_sites, max_users, max_health_checks_per_month, max_storage_gb
  - Pricing: price_monthly, price_annual, currency
  - features (JSONB)
  - is_active, sort_order
- [x] Create `organization_subscriptions` table:
  - id, organization_id (unique FK)
  - plan_id, status (active, suspended, cancelled)
  - current_period_start, current_period_end
  - created_at, updated_at
- [x] Seed subscription plans (Starter £49, Professional £99, Enterprise £249)

### 1.7 Usage Tracking Table
- [x] Create `organization_usage` table:
  - id, organization_id
  - period_start, period_end
  - health_checks_created, health_checks_completed
  - sms_sent, emails_sent, storage_used_bytes
  - created_at, updated_at
  - UNIQUE(organization_id, period_start)

### 1.8 User Enhancements
- [x] Add `is_org_admin` BOOLEAN DEFAULT false to users
- [x] Add `is_site_admin` BOOLEAN DEFAULT false to users
- [x] Add `invited_by` UUID REFERENCES users(id) to users
- [x] Add `invited_at` TIMESTAMPTZ to users
- [x] Add `last_login_at` TIMESTAMPTZ to users
- [x] Create `user_site_access` table (for users accessing multiple sites):
  - id, user_id, site_id, role, created_at
  - UNIQUE(user_id, site_id)

### 1.9 Encryption Utility
- [x] Create `/apps/api/src/lib/encryption.ts`:
  - encrypt(text) function using AES-256-GCM
  - decrypt(encryptedText) function
  - Uses ENCRYPTION_KEY env var (32 bytes / 64 hex chars)
- [x] Generate ENCRYPTION_KEY and add to .env.example (run `openssl rand -hex 32` to generate)

### 1.10 RLS Policies
- [x] Add RLS policies for super_admins (super admin only)
- [x] Add RLS policies for platform_settings (super admin only)
- [x] Add RLS policies for organization_settings (org members read, org admin write)
- [x] Add RLS policies for organization_notification_settings (org admin only)
- [x] Add RLS policies for organization_subscriptions (org members read)
- [x] Add RLS policies for organization_usage (org members read)

### ⛔ HARD STOP — Phase 1 Verification
```
Before proceeding, verify:
- [x] All tables created successfully (migration: 20250116000001_multi_tenant_phase1.sql)
- [x] Subscription plans seeded (starter, professional, enterprise)
- [x] Encryption utility works (test encrypt/decrypt) - /apps/api/src/lib/encryption.ts
- [x] RLS policies in place
```

---

## Phase 2: API — Platform & Credentials
**Estimated iterations: 20-25**

```bash
claude -p "Continue with Phase 2 tasks in TODO-multi-tenant.md. Build the platform settings and notification credentials APIs." --dangerously-skip-permissions
```

### 2.1 Super Admin Middleware
- [x] Create `requireSuperAdmin()` middleware:
  - Check if user exists in super_admins table
  - Attach superAdmin to context
  - Return 403 if not super admin

### 2.2 Platform Settings API (Super Admin only)
- [x] `GET /api/v1/admin/platform/settings/:id` — Get platform settings by key
- [x] `PATCH /api/v1/admin/platform/settings/:id` — Update platform settings
- [x] `GET /api/v1/admin/platform/notifications` — Get platform notification settings
- [x] `PATCH /api/v1/admin/platform/notifications` — Update platform notification settings
- [x] `POST /api/v1/admin/platform/notifications/test-sms` — Test SMS with platform credentials
- [x] `POST /api/v1/admin/platform/notifications/test-email` — Test email with platform credentials

### 2.3 Organization Notification Settings API
- [x] `GET /api/v1/organizations/:id/notification-settings` — Get org notification settings
- [x] `PATCH /api/v1/organizations/:id/notification-settings` — Update org notification settings
- [x] `POST /api/v1/organizations/:id/notification-settings/test-sms` — Test with org or platform credentials
- [x] `POST /api/v1/organizations/:id/notification-settings/test-email` — Test with org or platform credentials
- [x] Mask credentials in GET responses (show only last 4 chars)
- [x] Encrypt credentials before saving

### 2.4 Credential Resolution Service
- [x] Create `/apps/api/src/services/credentials.ts`:
  - `getSmsCredentials(organizationId)` — Returns org credentials if set, else platform
  - `getEmailCredentials(organizationId)` — Returns org credentials if set, else platform
  - Returns `{ source: 'organization' | 'platform', credentials: {...} }`

### 2.5 Update SMS Service
- [x] Update `sms.ts` to use `getSmsCredentials(organizationId)`
- [x] Add organizationId parameter to sendSMS function
- [x] Handle "not configured" gracefully (log warning, skip)

### 2.6 Update Email Service
- [x] Update `email.ts` to use `getEmailCredentials(organizationId)`
- [x] Add organizationId parameter to sendEmail function
- [x] Handle "not configured" gracefully

### 2.7 Update Notification Jobs
- [x] Update notification worker to pass organizationId from health check
- [x] Update reminder worker to pass organizationId
- [x] Track SMS/email usage in organization_usage table

### ⛔ HARD STOP — Phase 2 Verification
```
Before proceeding, verify:
- [ ] Can set platform notification credentials via API
- [ ] Can set org notification credentials via API
- [ ] Credentials are encrypted in database
- [ ] SMS/Email services use correct credentials based on org settings
- [ ] Test buttons work for both platform and org credentials
```

---

## Phase 3: API — Super Admin Organization Management
**Estimated iterations: 20-25**

```bash
claude -p "Continue with Phase 3 tasks in TODO-multi-tenant.md. Build the Super Admin organization management APIs." --dangerously-skip-permissions
```

### 3.1 Organizations CRUD (Super Admin)
- [x] `GET /api/v1/admin/organizations` — List all orgs (paginated, filterable by status, plan)
- [x] `POST /api/v1/admin/organizations` — Create organization (with first admin user)
- [x] `GET /api/v1/admin/organizations/:id` — Get org with settings, subscription, usage
- [x] `PATCH /api/v1/admin/organizations/:id` — Update org
- [x] `DELETE /api/v1/admin/organizations/:id` — Soft delete org (set status: cancelled)

### 3.2 Organization Status Management
- [x] `POST /api/v1/admin/organizations/:id/suspend` — Suspend org (status: suspended)
- [x] `POST /api/v1/admin/organizations/:id/activate` — Activate org (status: active)
- [x] Suspended orgs: users can login but see "Account suspended" message

### 3.3 Organization Subscription Management
- [x] `GET /api/v1/admin/organizations/:id/subscription` — Get subscription details
- [x] `PATCH /api/v1/admin/organizations/:id/subscription` — Update subscription (change plan, dates)
- [x] Validate plan limits when changing

### 3.4 Organization Usage Stats
- [x] `GET /api/v1/admin/organizations/:id/usage` — Get usage for current period
- [x] `GET /api/v1/admin/organizations/:id/usage/history` — Get usage history (last 12 months)

### 3.5 Platform Stats (Super Admin Dashboard)
- [x] `GET /api/v1/admin/stats` — Platform-wide stats:
  - Total organizations (by status)
  - Total users (active)
  - Total health checks (this month)
  - Total SMS/emails (this month)

### 3.6 Activity Log
- [x] Log all super admin actions to super_admin_activity_log
- [x] `GET /api/v1/admin/activity` — Recent activity (paginated)

### 3.7 Impersonation
- [x] `POST /api/v1/admin/impersonate/:userId` — Start impersonation (requires reason)
- [x] `DELETE /api/v1/admin/impersonate` — End impersonation
- [x] Generate special JWT with `impersonating: true` and `original_user_id`
- [x] Log impersonation start/end

### 3.8 Subscription Plans (Super Admin)
- [x] `GET /api/v1/admin/plans` — List all plans
- [x] `PATCH /api/v1/admin/plans/:id` — Update plan (price, limits)

### ⛔ HARD STOP — Phase 3 Verification
```
Before proceeding, verify:
- [ ] Can list/create/update organizations as super admin
- [ ] Can suspend/activate organizations
- [ ] Can change org subscription plan
- [ ] Usage stats return correct data
- [ ] Platform stats aggregate correctly
- [ ] Impersonation generates valid JWT
- [ ] Activity log captures actions
```

---

## Phase 4: API — Org Admin Management
**Estimated iterations: 15-20**

```bash
claude -p "Continue with Phase 4 tasks in TODO-multi-tenant.md. Build the Org Admin management APIs." --dangerously-skip-permissions
```

### 4.1 Org Admin Middleware
- [x] Create `requireOrgAdmin()` middleware:
  - Check user.is_org_admin === true
  - Return 403 if not org admin

### 4.2 Organization Settings API (Org Admin)
- [x] `GET /api/v1/organizations/:id/settings` — Get org settings
- [x] `PATCH /api/v1/organizations/:id/settings` — Update settings (branding, business, contact)
- [x] `POST /api/v1/organizations/:id/settings/logo` — Upload logo (Supabase Storage)

### 4.3 Sites Management (Org Admin)
- [x] `GET /api/v1/organizations/:id/sites` — List org sites
- [x] `POST /api/v1/organizations/:id/sites` — Create site (check max_sites limit)
- [x] `PATCH /api/v1/sites/:id` — Update site (org admin or site admin)
- [x] `DELETE /api/v1/sites/:id` — Soft delete site

### 4.4 Users Management (Org Admin)
- [x] `GET /api/v1/organizations/:id/users` — List org users (with site assignments)
- [x] `POST /api/v1/organizations/:id/users` — Invite user:
  - Check max_users limit
  - Create Supabase auth user
  - Create users record
  - Send welcome email
- [x] `PATCH /api/v1/users/:id` — Update user (role, site, is_active)
- [x] `DELETE /api/v1/users/:id` — Deactivate user (set is_active: false)
- [x] `POST /api/v1/users/:id/resend-invite` — Resend welcome email

### 4.5 Subscription View (Org Admin - Read Only)
- [x] `GET /api/v1/organizations/:id/subscription` — View current subscription
- [x] `GET /api/v1/organizations/:id/usage` — View current usage

### 4.6 Limit Enforcement
- [x] Create `/apps/api/src/services/limits.ts`:
  - `checkSiteLimit(organizationId)` — Can add more sites?
  - `checkUserLimit(organizationId)` — Can add more users?
  - `checkHealthCheckLimit(organizationId)` — Can create more health checks this month?
- [x] Integrate limit checks into relevant API endpoints

### ⛔ HARD STOP — Phase 4 Verification
```
Before proceeding, verify:
- [ ] Org admin can update settings
- [ ] Org admin can upload logo
- [ ] Org admin can create/manage sites (within limits)
- [ ] Org admin can invite/manage users (within limits)
- [ ] Limit enforcement works (returns 403 with message when exceeded)
```

---

## Phase 5: Super Admin Portal UI
**Estimated iterations: 25-30**

```bash
claude -p "Continue with Phase 5 tasks in TODO-multi-tenant.md. Build the Super Admin portal UI at /admin route." --dangerously-skip-permissions
```

### 5.1 Admin Layout & Auth
- [x] Create `/apps/web/src/layouts/AdminLayout.tsx`:
  - Separate sidebar for admin
  - Different color scheme (dark?)
  - Super admin user menu
- [x] Create admin auth guard — redirect non-super-admins
- [x] Update login to detect super admin and redirect to /admin

### 5.2 Admin Dashboard
- [x] Create `/admin` dashboard page:
  - Stats cards: Total orgs, Active, Trial, Suspended, MRR
  - Organizations table (paginated, searchable)
  - Recent activity feed

### 5.3 Organizations List Page
- [x] Create `/admin/organizations` page:
  - Table: Name, Sites, Users, Plan, Status, Actions
  - Filters: Status, Plan
  - Search by name
  - Pagination
  - Click row to view details

### 5.4 Create Organization Modal
- [x] Create 3-step wizard:
  - Step 1: Business details (name, email, phone)
  - Step 2: Select plan
  - Step 3: First admin user (name, email)
- [x] Create org, settings, subscription, and first user
- [x] Send welcome email to admin

### 5.5 Organization Detail Page
- [x] Create `/admin/organizations/:id` page:
  - Header: Name, status badge, quick actions
  - Tabs: Overview, Sites, Users, Billing, Activity
  - Overview: Subscription info, usage stats, org admins
  - Sites: List with user counts
  - Users: Full user list
  - Billing: Subscription details, change plan
  - Activity: Org-specific activity log

### 5.6 Organization Actions
- [x] Suspend organization modal (with confirmation)
- [x] Activate organization button
- [x] Change plan modal
- [x] Add note to organization

### 5.7 Impersonate User
- [x] Impersonate modal (select user, enter reason)
- [x] Impersonation banner at top of app
- [x] End impersonation button
- [x] Log impersonation actions

### 5.8 Platform Settings Page
- [x] Create `/admin/settings` page:
  - Platform notification credentials (SMS, Email)
  - Test connection buttons
  - Save button

### ⛔ HARD STOP — Phase 5 Verification
```
Before proceeding, verify:
- [ ] Super admin login redirects to /admin
- [ ] Dashboard shows correct stats
- [ ] Can create new organization via wizard
- [ ] Can view organization details
- [ ] Can suspend/activate organizations
- [ ] Can change organization plan
- [ ] Impersonation works with banner
- [ ] Platform settings save correctly
```

---

## Phase 6: Org Admin Settings UI
**Estimated iterations: 20-25**

```bash
claude -p "Continue with Phase 6 tasks in TODO-multi-tenant.md. Build the Org Admin settings pages." --dangerously-skip-permissions
```

### 6.1 Settings Page Structure
- [ ] Create `/settings` page with sidebar menu:
  - General (business details)
  - Branding (logo, colors)
  - Sites
  - Users
  - Notifications
  - Integrations (existing DMS, thresholds)
  - Subscription

### 6.2 General Settings Page
- [ ] `/settings/general`:
  - Legal name, Company number, VAT number
  - Address fields
  - Contact: phone, email, website
  - Timezone, date format, currency
  - Save button

### 6.3 Branding Settings Page
- [ ] `/settings/branding`:
  - Logo upload (drag & drop or click)
  - Logo preview
  - Primary color picker
  - Secondary color picker
  - Preview of how branding looks
  - Save button

### 6.4 Sites Management Page
- [ ] `/settings/sites`:
  - List of sites with user counts
  - Add site button (check limit)
  - Edit site modal
  - Delete site (with confirmation, check for health checks)
  - Show limit: "2 of 3 sites used"

### 6.5 Users Management Page
- [ ] `/settings/users`:
  - List of users with role, site, status
  - Invite user button (check limit)
  - Invite modal: name, email, role, site(s)
  - Edit user modal: change role, site, active status
  - Resend invite button
  - Deactivate user (with confirmation)
  - Show limit: "8 of 15 users"

### 6.6 Notifications Settings Page
- [ ] `/settings/notifications`:
  - SMS section:
    - Radio: Use platform default / Use own Twilio
    - If own: Account SID, Auth Token, Phone Number fields
    - Test SMS button
    - Connection status indicator
  - Email section:
    - Radio: Use platform default / Use own Resend
    - If own: API Key, From Email, From Name fields
    - Test Email button
    - Connection status indicator
  - Default settings:
    - Link expiry dropdown
    - Reminder toggle and intervals

### 6.7 Subscription Page (Read-Only for Org Admin)
- [ ] `/settings/subscription`:
  - Current plan name and price
  - Usage this month (health checks, SMS, emails, storage)
  - Usage bar graphs
  - "Contact us to upgrade" message
  - Next billing date

### ⛔ HARD STOP — Phase 6 Verification
```
Before proceeding, verify:
- [ ] Org admin can access settings pages
- [ ] Can update business details
- [ ] Can upload and preview logo
- [ ] Can manage sites (within limits)
- [ ] Can invite and manage users (within limits)
- [ ] Notification settings show platform/own toggle
- [ ] Test buttons work for SMS and email
- [ ] Subscription page shows correct usage
```

---

## Phase 7: Authentication Updates
**Estimated iterations: 10-15**

```bash
claude -p "Continue with Phase 7 tasks in TODO-multi-tenant.md. Update authentication to handle super admin, org admin, and regular users." --dangerously-skip-permissions
```

### 7.1 Login Flow Update
- [x] Update login handler to:
  1. Authenticate with Supabase
  2. Check if super_admin → redirect to /admin
  3. Check if user → redirect to /dashboard
  4. If neither → show error

### 7.2 Suspended Organization Handling
- [x] If user's org status === 'suspended':
  - Allow login
  - Show "Account Suspended" banner on all pages
  - Block most actions (read-only mode)
  - Show contact support message

### 7.3 Impersonation Token Handling
- [x] When impersonating, JWT includes:
  - `impersonating: true`
  - `original_super_admin_id`
  - `impersonated_user_id`
- [x] API uses impersonated_user_id for auth but logs original_super_admin_id

### 7.4 Impersonation UI
- [x] Create ImpersonationBanner component:
  - Yellow warning banner at top of page
  - Shows: "Impersonating: John Smith (ABC Motors)"
  - "End Session" button
- [x] Show banner when `impersonating: true` in JWT

### 7.5 Role-Based Navigation
- [x] Update sidebar to show/hide based on role:
  - Super Admin: Show admin navigation
  - Org Admin: Show settings with full access
  - Site Admin: Show settings with limited access
  - Service Advisor: Hide settings (or limited)
  - Technician: Mobile-only, minimal nav

### ⛔ HARD STOP — Phase 7 Verification
```
Before proceeding, verify:
- [x] Super admin login goes to /admin
- [x] Regular user login goes to /dashboard
- [x] Suspended org users see banner
- [x] Impersonation works end-to-end
- [x] Navigation adapts to user role
```

---

## Phase 8: Onboarding Flow
**Estimated iterations: 15-20**

```bash
claude -p "Continue with Phase 8 tasks in TODO-multi-tenant.md. Build the organization onboarding wizard for new organizations." --dangerously-skip-permissions
```

### 8.1 Onboarding Detection
- [x] On login, check if `organization.onboarding_completed === false`
- [x] If not completed, redirect to `/onboarding`

### 8.2 Onboarding Wizard
- [x] Create `/onboarding` page with steps:

**Step 1: Business Details**
- [x] Logo upload (optional, can skip)
- [x] Business address
- [x] Contact details

**Step 2: First Site**
- [x] Site name
- [x] Site address (copy from org option)
- [x] Site contact

**Step 3: Invite Team (Optional)**
- [x] Add service advisors
- [x] Add technicians
- [x] "Skip for now" option

**Step 4: Notifications (Optional)**
- [x] Use platform default or configure own
- [x] Test connection if own
- [x] "Skip for now" option

**Step 5: Ready!**
- [x] Summary of what's set up
- [x] "Create first health check" button
- [x] Links to help/documentation

### 8.3 Progress Tracking
- [x] Update `organizations.onboarding_step` as user progresses
- [x] Allow going back to previous steps
- [x] Mark `onboarding_completed = true` on final step

### 8.4 Skip Onboarding
- [x] Allow org admin to skip remaining steps
- [x] "Complete later" link
- [x] Show reminder in dashboard if not completed

### ⛔ HARD STOP — Phase 8 Verification
```
Before proceeding, verify:
- [x] New org admin sees onboarding on first login
- [x] Can progress through all steps
- [x] Can skip optional steps
- [x] Progress saves if user leaves and returns
- [x] Dashboard shows reminder if incomplete
- [x] Completed onboarding doesn't show again
```

---

## Phase 9: Apply Branding
**Estimated iterations: 10-15**

```bash
claude -p "Continue with Phase 9 tasks in TODO-multi-tenant.md. Apply organization branding throughout the app and customer portal." --dangerously-skip-permissions
```

### 9.1 Branding Context
- [x] Create BrandingContext/Provider:
  - Fetch org settings on load
  - Provide logo_url, primary_color, secondary_color
  - Provide org name

### 9.2 Apply Branding in Tenant App
- [x] Header: Show org logo
- [x] Sidebar: Use primary color for active items
- [x] Buttons: Use primary color as accent

### 9.3 Apply Branding in Customer Portal
- [x] Header: Show org logo
- [x] Use primary/secondary colors for buttons and accents
- [x] Footer: Show org name and contact

### 9.4 Apply Branding in Emails
- [x] Include org logo in email header
- [x] Use org name in "From" field (if using own credentials)
- [x] Use org colors in email template

### 9.5 Apply Branding in PDFs
- [x] Header: Show org logo
- [x] Use org name and address
- [x] Footer: Show org contact details

### ⛔ HARD STOP — Phase 9 Verification
```
Before proceeding, verify:
- [x] Tenant app shows org logo
- [x] Customer portal shows org branding
- [x] Emails include org logo and name
- [x] PDFs show org branding
```

---

## Phase 10: Polish & Testing
**Estimated iterations: 15-20**

```bash
claude -p "Continue with Phase 10 tasks in TODO-multi-tenant.md. Final polish and testing of multi-tenant features." --dangerously-skip-permissions
```

### 10.1 Create Test Data
- [x] Create 2-3 test organizations
- [x] Create users at different roles
- [x] Create sample health checks

### 10.2 Test Role Permissions
- [x] Test super admin can access all orgs
- [x] Test org admin can only access their org
- [x] Test site admin can only access their site
- [x] Test service advisor permissions
- [x] Test technician permissions

### 10.3 Test Limit Enforcement
- [x] Test site limit (can't exceed max_sites)
- [x] Test user limit (can't exceed max_users)
- [x] Test health check limit (can't exceed monthly limit)
- [x] Verify friendly error messages

### 10.4 Test Credential Hierarchy
- [x] Test SMS with platform credentials
- [x] Test SMS with org credentials
- [x] Test email with platform credentials
- [x] Test email with org credentials
- [x] Test fallback when org credentials not set

### 10.5 Test Impersonation
- [x] Super admin can impersonate any user
- [x] Actions logged correctly
- [x] Banner shows during impersonation
- [x] Can end impersonation

### 10.6 Test Onboarding
- [x] New org sees onboarding
- [x] Can complete all steps
- [x] Can skip and return later
- [x] Completed orgs don't see onboarding

### 10.7 Security Review
- [x] Verify RLS policies working
- [x] Verify org isolation (can't access other org's data)
- [x] Verify credentials encrypted at rest
- [x] Verify activity logging

### ⛔ FINAL VERIFICATION
```
Multi-tenant implementation complete:
- [x] Super admin portal functional
- [x] Can create and manage organizations
- [x] Org admins can manage their settings
- [x] Notification credentials work (platform + org override)
- [x] Branding applied throughout
- [x] Limits enforced correctly
- [x] Onboarding guides new orgs
- [x] Impersonation works for support
- [x] Security audit passed
```

---

## 🎉 MULTI-TENANT COMPLETE

Features implemented:
- ✅ Super Admin portal at /admin
- ✅ Organization management (create, suspend, activate)
- ✅ Subscription plans with limits
- ✅ Platform notification credentials (Twilio, Resend)
- ✅ Per-org credential override option
- ✅ Org admin settings (branding, users, sites)
- ✅ Role-based access control
- ✅ Impersonation for support
- ✅ Onboarding wizard
- ✅ Branding throughout app

---

## Recovery Prompts

**RLS policy issues:**
```bash
claude -p "RLS policies are blocking access incorrectly. Review and fix policies for [table_name]." --dangerously-skip-permissions
```

**Credential encryption issues:**
```bash
claude -p "Credential encryption/decryption is failing. Check encryption.ts and ensure ENCRYPTION_KEY is correct." --dangerously-skip-permissions
```

**Limit enforcement not working:**
```bash
claude -p "Subscription limits are not being enforced when [action]. Fix the limit check in the API." --dangerously-skip-permissions
```

**Impersonation not working:**
```bash
claude -p "Impersonation JWT is not working correctly. Debug the impersonation flow." --dangerously-skip-permissions
```
