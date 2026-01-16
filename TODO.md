# Vehicle Health Check (VHC) — Build Tasks (UPDATED)
> **Last Updated: January 2026**
> 
> Reference: `docs/vhc-master-specification.md`

---

## ✅ COMPLETED PHASES

### Phase 1: Project Setup & Database — COMPLETE ✅
### Phase 2: Authentication & Users — COMPLETE ✅
### Phase 3: Templates & Core Data — COMPLETE ✅
### Phase 4: Health Check API & Core Flow — COMPLETE ✅
### Phase 5: Technician Mobile PWA — COMPLETE ✅
### Phase 6: Service Advisor Interface — COMPLETE ✅
### Phase 6B: Advisor View Enhancements — COMPLETE ✅
- Grouped sections (Red/Amber/Green/Authorised/Declined)
- Tyre display with remaining legal tread calculation
- Brake display with all measurements
- Inline pricing editing (parts/labour/total)
- MOT failure flagging
- Follow-up date scheduling
- Work complete tracking
- Close health check with validation
- Summary & Photos tabs
- PDF generation
- Organization-wide inspection thresholds

### Phase 7: Customer Portal — COMPLETE ✅
- Public API routes (`/api/public/vhc/:token`)
- Token validation and expiry handling
- Customer authorization/decline flow
- Signature capture with canvas
- Activity tracking (views, actions)
- Status updates from customer actions
- Mobile-first responsive portal
- RAG summary display
- Photo galleries with thumbnails

### Phase 8: Notifications System — COMPLETE ✅
- BullMQ with Redis for job queues
- Twilio SMS integration
- Resend email integration with HTML templates
- Socket.io WebSocket for real-time notifications
- In-app notification system (routes + database)
- Automatic reminder scheduling
- Staff notifications on customer actions
- Link expiry warnings
- Worker process for background jobs

---

### Phase 9: Dashboard & Analytics — COMPLETE ✅

### 9.1 Dashboard API Endpoints
- [x] `GET /api/v1/dashboard` — Summary metrics
- [x] `GET /api/v1/dashboard/board` — Kanban board data
- [x] `GET /api/v1/dashboard/technicians` — Technician workload
- [x] `GET /api/v1/dashboard/activity` — Recent activity feed

### 9.2 Dashboard Metrics Calculations
- [x] Total today, completed today
- [x] Counts by status
- [x] Average tech time
- [x] Average customer response time
- [x] Conversion rate (authorized / sent)
- [x] Total value: sent, authorized, declined

### 9.3 Main Dashboard Page
- [x] Summary cards at top (counts by category)
- [x] "Needs Attention" section (overdue, expiring)
- [x] Technician queue section
- [x] Advisor queue section
- [x] Customer queue section

### 9.4 Kanban Board View
- [x] Columns: Technician, Tech Done, Advisor, With Customer, Actioned
- [x] Drag cards to change status (where valid)
- [x] Color-coded cards by priority/RAG

### 9.5 Technician Workload View
- [x] List technicians with current status
- [x] Show current job and time elapsed
- [x] Queue count per technician
- [x] Today's stats (completed, time)

### 9.6 Health Check Timeline View
- [x] Vertical timeline of status changes
- [x] Duration between each status
- [x] Expandable details

### 9.7 Real-time Dashboard Updates
- [x] Subscribe to WebSocket events
- [x] Update counts without refresh
- [x] Show live "in progress" indicators

### 9.8 SLA Warning Indicators
- [x] Highlight overdue items (past promise time)
- [x] Highlight items stuck in status too long
- [x] Configurable thresholds

### 9.9 Filters
- [x] Date range filter
- [x] Advisor filter (via board/reports)
- [x] Technician filter (via board/reports)

### 9.10 Basic Reporting Page
- [x] Date range selector
- [x] Metrics table: Total, Completed, Conversion, Value
- [x] Chart: Completions over time (bar chart)
- [x] Export to CSV

---

## 🔲 REMAINING PHASES (Production Deployment)

---

## Phase 10: Polish & Production
**Estimated iterations: 30-40**

```bash
claude -p "Complete Phase 10 tasks in TODO.md. Final polish, security audit, and deployment. Check off each task with [x] when done." --dangerously-skip-permissions
```

### 10.1 PDF Generation — COMPLETE ✅
- [x] PDF generation implemented in advisor view enhancements

### 10.2 Error Handling — COMPLETE ✅
- [x] API error responses with codes (`/apps/api/src/lib/errors.ts`)
- [x] Client-side error boundaries (`/apps/web/src/components/ErrorBoundary.tsx`, `/apps/mobile/src/components/ErrorBoundary.tsx`)
- [x] Toast notifications for errors (`/apps/web/src/contexts/ToastContext.tsx`, `/apps/mobile/src/context/ToastContext.tsx`)
- [x] Retry logic for failed requests (`/apps/web/src/lib/api.ts` - exponential backoff with jitter)

### 10.3 Loading States — COMPLETE ✅
- [x] Skeleton loaders for lists (`/apps/web/src/components/Skeleton.tsx`)
- [x] Spinners for actions (existing in components)
- [x] Disabled buttons during submission (existing patterns)

### 10.4 Performance Optimization — PARTIAL ✅
- [x] Review database indexes (`/apps/api/src/scripts/apply-phase10-migration.ts`)
- [ ] Implement API response caching
- [ ] Lazy load heavy components
- [x] Optimize images (thumbnails already implemented)

### 10.5 Security Audit — PARTIAL ✅
- [x] Review all API endpoints for auth (existing auth middleware)
- [x] Verify RLS policies working (existing policies)
- [x] Check for SQL injection (using Supabase parameterized queries)
- [x] Validate all user inputs (existing validation)
- [x] Rate limiting on public endpoints (`/apps/api/src/middleware/rate-limit.ts`)

### 10.6 Logging — COMPLETE ✅
- [x] Structured logging in API (`/apps/api/src/lib/logger.ts`)
- [x] Error tracking middleware (`/apps/api/src/middleware/error-handler.ts`)
- [x] Audit log for sensitive actions (`/apps/api/src/services/audit.ts`)

### 10.7 Environment Configuration — COMPLETE ✅
- [x] Production environment variables (`/apps/api/.env.example` updated)
- [ ] Separate Supabase project for prod (optional)
- [ ] Configure custom domain

### 10.8 Deploy to Railway — READY ✅
- [x] Configure railway.toml (`/apps/api/railway.toml`, `/apps/web/railway.toml`, `/apps/mobile/railway.toml`)
- [ ] Set up environment variables
- [ ] Deploy API service
- [ ] Deploy worker service
- [ ] Verify health checks

### 10.9 Deploy Web Apps
- [ ] Build web app for production
- [ ] Deploy to Vercel/Netlify/Railway
- [ ] Configure custom domain
- [ ] Build mobile PWA
- [ ] Deploy PWA

### 10.10 Final Testing
- [ ] Full flow: Create → Inspect → Price → Send → Authorize
- [ ] Mobile testing on real devices
- [ ] Offline testing
- [ ] Load testing (optional)

### 10.11 Documentation
- [ ] Setup guide
- [ ] User guide for advisors
- [ ] User guide for technicians
- [ ] API documentation (if needed)

### ⛔ FINAL VERIFICATION
```
Before marking complete, verify:
- [ ] All error states handled gracefully
- [ ] No console errors in production build
- [ ] Security audit passed
- [ ] Deployed to Railway successfully
- [ ] Custom domain configured
- [ ] Full user flow works in production
- [ ] Mobile PWA installs and works offline
- [ ] Documentation complete
```

---

## Phase 11: DMS Integration (Gemini OSI) — COMPLETE ✅
**Multi-tenant support with per-organization credentials**

Reference: Section 11 in `docs/vhc-master-specification.md`

### 11.1 Database Updates — COMPLETE ✅
- [x] Add deletion fields to health_checks (deleted_at, deleted_by, deletion_reason, deletion_notes)
- [x] Create `organization_dms_settings` table (per-organization, encrypted credentials)
- [x] Create `dms_import_history` table for tracking imports
- [x] Add external_id, external_source to health_checks, customers, vehicles
- [x] Migration: `/supabase/migrations/20260115000001_dms_integration.sql`

### 11.2 Gemini OSI API Client — COMPLETE ✅
- [x] Create `/apps/api/src/services/gemini-osi.ts`
- [x] Authenticate with API key (AES-256-GCM encrypted storage)
- [x] `fetchDiaryBookings(date)` method
- [x] `testConnection()` method
- [x] `isDmsAvailable()` method
- [x] Handle API errors and retries

### 11.3 DMS Import Job — COMPLETE ✅
- [x] Create `/apps/api/src/jobs/dms-import.ts`
- [x] Fetch bookings from Gemini API
- [x] Find or create customer records (by external_id, email, or mobile)
- [x] Find or create vehicle records (by external_id, registration, or VIN)
- [x] Create health checks with status 'created'
- [x] Skip duplicates (check external_id + external_source)
- [x] Track import results per organization

### 11.4 Schedule Nightly Import — COMPLETE ✅
- [x] Add cron job to BullMQ (configurable hour, default 8pm)
- [x] Configurable days (Mon-Sat by default)
- [x] Per-organization scheduling

### 11.5 Manual Import Trigger — COMPLETE ✅
- [x] `POST /api/v1/dms-settings/import` — Manual import
- [x] `GET /api/v1/dms-settings/import/status` — Import job status
- [x] `GET /api/v1/dms-settings/import/history` — Import history

### 11.6 Deletion Workflow — COMPLETE ✅
- [x] `POST /api/v1/health-checks/:id/delete` — Soft delete with reason
- [x] `POST /api/v1/health-checks/bulk-delete` — Bulk delete
- [x] `POST /api/v1/health-checks/:id/restore` — Restore soft-deleted
- [x] Deletion reasons: no_show, no_time, not_required, customer_declined, vehicle_issue, duplicate, other
- [x] Require notes for 'other' reason

### 11.7 Unactioned Health Checks Section — COMPLETE ✅
- [x] List health checks still in 'created' status from DMS
- [x] `GET /api/v1/dms-settings/unactioned` endpoint
- [x] Section in DMS Integration settings page
- [x] Link to health check list with status filter

### 11.8 DMS Settings Admin Page — COMPLETE ✅
- [x] Enable/disable integration toggle
- [x] API credentials (encrypted storage)
- [x] Import schedule (hour, days)
- [x] Default template selection
- [x] Test connection button
- [x] Manual import trigger
- [x] UI at `/settings/integrations`
- [x] Navigation link for org admins

### 11.9 Import History Log — COMPLETE ✅
- [x] Track each import run in `dms_import_history` table
- [x] Show count: found, imported, skipped, failed
- [x] Show customers/vehicles created
- [x] Display in DMS Settings page

### ⛔ Phase 11 Verification — COMPLETE ✅
```
- [x] Can configure DMS settings in admin (/settings/integrations)
- [x] Manual import creates health checks
- [x] Customers and vehicles created/linked correctly
- [x] Duplicate bookings skipped (external_id check)
- [x] Can delete with reason
- [x] Bulk delete works
- [x] Unactioned section shows imported checks
- [x] Scheduled import configurable per organization
```

---

## 🎉 COMPLETION

### Final Checklist:
- [x] Phase 7: Customer Portal complete
- [x] Phase 8: Notifications complete
- [x] Phase 9: Dashboard complete
- [ ] Phase 10: Production deployment complete
- [x] Phase 11: DMS Integration complete (multi-tenant)
- [ ] Full end-to-end testing passed
- [ ] Documentation delivered

---

## Recovery Prompts

**Database issues:**
```bash
claude -p "Fix database errors. Check migrations, RLS policies, verify tables exist." --dangerously-skip-permissions
```

**Build errors:**
```bash
claude -p "Fix all TypeScript and build errors. No type errors, builds succeed." --dangerously-skip-permissions
```

**API not working:**
```bash
claude -p "Debug API issues. Check routes, middleware, database connection." --dangerously-skip-permissions
```

**Component not rendering:**
```bash
claude -p "The [ComponentName] is not rendering. Check imports, props, and conditions." --dangerously-skip-permissions
```
