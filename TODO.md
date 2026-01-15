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

## 🔲 REMAINING PHASES

## Phase 9: Dashboard & Analytics
**Estimated iterations: 30-40**

```bash
claude -p "Complete Phase 9 tasks in TODO.md. Build the dashboard with Kanban board, technician workload, and analytics. Check off each task with [x] when done." --dangerously-skip-permissions
```

### 9.1 Dashboard API Endpoints
- [ ] `GET /api/v1/dashboard` — Summary metrics
- [ ] `GET /api/v1/dashboard/board` — Kanban board data
- [ ] `GET /api/v1/dashboard/technicians` — Technician workload
- [ ] `GET /api/v1/dashboard/activity` — Recent activity feed

### 9.2 Dashboard Metrics Calculations
- [ ] Total today, completed today
- [ ] Counts by status
- [ ] Average tech time
- [ ] Average customer response time
- [ ] Conversion rate (authorized / sent)
- [ ] Total value: sent, authorized, declined

### 9.3 Main Dashboard Page
- [ ] Summary cards at top (counts by category)
- [ ] "Needs Attention" section (overdue, expiring)
- [ ] Technician queue section
- [ ] Advisor queue section
- [ ] Customer queue section

### 9.4 Kanban Board View
- [ ] Columns: Technician, Tech Done, Advisor, With Customer, Actioned
- [ ] Drag cards to change status (where valid)
- [ ] Color-coded cards by priority/RAG

### 9.5 Technician Workload View
- [ ] List technicians with current status
- [ ] Show current job and time elapsed
- [ ] Queue count per technician
- [ ] Today's stats (completed, time)

### 9.6 Health Check Timeline View
- [ ] Vertical timeline of status changes
- [ ] Duration between each status
- [ ] Expandable details

### 9.7 Real-time Dashboard Updates
- [ ] Subscribe to WebSocket events
- [ ] Update counts without refresh
- [ ] Show live "in progress" indicators

### 9.8 SLA Warning Indicators
- [ ] Highlight overdue items (past promise time)
- [ ] Highlight items stuck in status too long
- [ ] Configurable thresholds

### 9.9 Filters
- [ ] Date range filter
- [ ] Advisor filter
- [ ] Technician filter

### 9.10 Basic Reporting Page
- [ ] Date range selector
- [ ] Metrics table: Total, Completed, Conversion, Value
- [ ] Chart: Completions over time (line chart)
- [ ] Export to CSV

### ⛔ HARD STOP — Phase 9 Verification
```
Before proceeding, verify:
- [ ] Dashboard loads with correct metrics
- [ ] Kanban board shows all health checks
- [ ] Can drag to change status
- [ ] Technician workload accurate
- [ ] Real-time updates working
- [ ] Overdue items highlighted
- [ ] Filters working
- [ ] Timeline view shows full history
- [ ] CSV export works
```

---

## Phase 10: Polish & Production
**Estimated iterations: 30-40**

```bash
claude -p "Complete Phase 10 tasks in TODO.md. Final polish, security audit, and deployment. Check off each task with [x] when done." --dangerously-skip-permissions
```

### 10.1 PDF Generation — COMPLETE ✅
- [x] PDF generation implemented in advisor view enhancements

### 10.2 Error Handling
- [ ] API error responses with codes
- [ ] Client-side error boundaries
- [ ] Toast notifications for errors
- [ ] Retry logic for failed requests

### 10.3 Loading States
- [ ] Skeleton loaders for lists
- [ ] Spinners for actions
- [ ] Disabled buttons during submission

### 10.4 Performance Optimization
- [ ] Review database indexes
- [ ] Implement API response caching
- [ ] Lazy load heavy components
- [ ] Optimize images (WebP, thumbnails)

### 10.5 Security Audit
- [ ] Review all API endpoints for auth
- [ ] Verify RLS policies working
- [ ] Check for SQL injection (parameterized queries)
- [ ] Validate all user inputs
- [ ] Rate limiting on public endpoints

### 10.6 Logging
- [ ] Structured logging in API
- [ ] Error tracking (Sentry or similar)
- [ ] Audit log for sensitive actions

### 10.7 Environment Configuration
- [ ] Production environment variables
- [ ] Separate Supabase project for prod (optional)
- [ ] Configure custom domain

### 10.8 Deploy to Railway
- [ ] Configure railway.toml
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

## Phase 11: DMS Integration (Gemini OSI) — OPTIONAL
**Estimated iterations: 25-35**

```bash
claude -p "Complete Phase 11 tasks in TODO.md. Implement Gemini OSI DMS integration for automatic booking import. Check off each task with [x] when done." --dangerously-skip-permissions
```

Reference: Section 11 in `docs/vhc-master-specification.md`

### 11.1 Database Updates
- [ ] Add deletion fields to health_checks (deleted_at, deleted_by, deletion_reason, deletion_notes)
- [ ] Add dms_settings JSONB to sites table
- [ ] Add external_id to health_checks, customers, vehicles

### 11.2 Gemini OSI API Client
- [ ] Create `/apps/api/src/services/gemini-osi.ts`
- [ ] Authenticate with API key
- [ ] `fetchDiaryBookings(date)` method
- [ ] Handle API errors and retries

### 11.3 DMS Import Job
- [ ] Create `/apps/api/src/jobs/dms-import.ts`
- [ ] Fetch bookings from Gemini API
- [ ] Find or create customer records
- [ ] Find or create vehicle records
- [ ] Create health checks with status 'created'
- [ ] Skip duplicates (check external_id)

### 11.4 Schedule Nightly Import
- [ ] Add cron job to BullMQ (default 8pm)
- [ ] Configurable per site

### 11.5 Manual Import Trigger
- [ ] `POST /api/v1/dms/import` — Manual import
- [ ] `GET /api/v1/dms/status` — Import job status

### 11.6 Deletion Workflow
- [ ] `DELETE /api/v1/health-checks/:id` — Soft delete with reason
- [ ] `DELETE /api/v1/health-checks/bulk` — Bulk delete
- [ ] Deletion reasons: no_show, no_time, not_required, customer_declined, vehicle_issue, duplicate, other
- [ ] Require notes for 'other' reason

### 11.7 Unactioned Health Checks Dashboard
- [ ] List health checks still in 'created' status
- [ ] Checkbox selection for bulk actions
- [ ] Show time since import
- [ ] Bulk delete modal with reason dropdown

### 11.8 DMS Settings Admin Page
- [ ] Enable/disable integration
- [ ] API credentials (encrypted)
- [ ] Import schedule
- [ ] Default template selection
- [ ] Test connection button

### 11.9 Import History Log
- [ ] Track each import run
- [ ] Show count: imported, skipped, errors
- [ ] Link to view imported health checks

### ⛔ HARD STOP — Phase 11 Verification
```
Before marking complete, verify:
- [ ] Can configure DMS settings in admin
- [ ] Manual import creates health checks
- [ ] Customers and vehicles created/linked correctly
- [ ] Duplicate bookings skipped
- [ ] Can delete with reason
- [ ] Bulk delete works
- [ ] Unactioned section shows imported checks
- [ ] Nightly import runs on schedule
```

---

## 🎉 COMPLETION

### Final Checklist:
- [x] Phase 7: Customer Portal complete
- [x] Phase 8: Notifications complete
- [ ] Phase 9: Dashboard complete
- [ ] Phase 10: Production deployment complete
- [ ] Phase 11: DMS Integration complete (optional)
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
