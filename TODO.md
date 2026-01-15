# Vehicle Health Check (VHC) — Build Tasks

> **For use with Claude Code + Ralph Wiggum plugin**
> 
> Run phases as separate Ralph loops with hard stops for verification.
> Reference: `docs/vhc-master-specification.md`

---

## Phase 1: Project Setup & Database
**Estimated iterations: 20-30**

```bash
/ralph-loop "Complete all Phase 1 tasks in TODO.md. Check off each task when done. Stop at HARD STOP for verification. Output <promise>PHASE1_DONE</promise> when all Phase 1 tasks complete." --max-iterations 30
```

- [x] 1.1 Initialize monorepo structure:
  ```
  /vhc
  ├── /apps
  │   ├── /api          # Hono backend
  │   ├── /web          # React dashboard (Vite)
  │   └── /mobile       # Technician PWA (Vite)
  ├── /packages
  │   └── /shared       # Shared types, utilities
  ├── /docs             # Specification files
  ├── package.json      # Workspace root
  └── turbo.json        # Turborepo config
  ```
- [x] 1.2 Set up Turborepo with npm workspaces
- [x] 1.3 Create `/apps/api` with Hono + TypeScript:
  - Install: `hono`, `@hono/node-server`, `typescript`, `tsx`
  - Create `src/index.ts` with basic health endpoint
  - Add scripts: `dev`, `build`, `start`
- [x] 1.4 Create `/apps/web` with Vite + React + TypeScript:
  - Use `npm create vite@latest web -- --template react-ts`
  - Install Tailwind CSS and configure
  - Verify dev server runs
- [x] 1.5 Create `/apps/mobile` with Vite + React + TypeScript (PWA):
  - Use `npm create vite@latest mobile -- --template react-ts`
  - Install `vite-plugin-pwa` and configure
  - Install Tailwind CSS
- [x] 1.6 Create `/packages/shared`:
  - Set up TypeScript
  - Create `src/types/index.ts` for shared types
  - Export types for health checks, users, vehicles, etc.
- [x] 1.7 Create Supabase project (manual or CLI):
  - Note project URL and anon key
  - Create `.env` files in `/apps/api` with:
    ```
    SUPABASE_URL=
    SUPABASE_ANON_KEY=
    SUPABASE_SERVICE_KEY=
    ```
- [x] 1.8 Create `/apps/api/src/db/schema.sql` with full schema from spec section 3
- [x] 1.9 Run schema in Supabase SQL editor or via migration
- [x] 1.10 Verify all tables created: organizations, sites, users, customers, vehicles, check_templates, template_sections, template_items, health_checks, check_results, result_media, repair_items, authorizations, technician_time_entries, health_check_status_history, customer_activities, staff_notifications, scheduled_jobs

### ⛔ HARD STOP — Phase 1 Verification
```
Before proceeding, verify:
- [ ] All 17+ tables exist in Supabase
- [ ] RLS policies are enabled
- [ ] Functions created (update_health_check_status, clock_technician_in, clock_technician_out)
- [ ] Triggers working (update_rag_counts)
- [ ] API health endpoint returns 200
- [ ] Web app dev server runs on localhost:5173
- [ ] Mobile app dev server runs on localhost:5174
```

---

## Phase 2: Authentication & Users
**Estimated iterations: 25-35**

```bash
/ralph-loop "Complete all Phase 2 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE2_DONE</promise> when complete." --max-iterations 35
```

- [x] 2.1 Install Supabase client in `/apps/api`:
  - `npm install @supabase/supabase-js`
  - Create `src/lib/supabase.ts` with admin client
- [x] 2.2 Create auth middleware in `/apps/api/src/middleware/auth.ts`:
  - Verify JWT from Authorization header
  - Attach user to context
  - Set `app.current_org_id` for RLS
- [x] 2.3 Create role-based authorization middleware:
  - `authorize(['admin', 'service_advisor'])` pattern
  - Check user role from context
- [x] 2.4 Create API routes for auth (`/apps/api/src/routes/auth.ts`):
  - `POST /api/v1/auth/login` — Supabase signInWithPassword
  - `POST /api/v1/auth/logout` — Supabase signOut
  - `GET /api/v1/auth/me` — Get current user with org/site
  - `POST /api/v1/auth/refresh` — Refresh token
- [x] 2.5 Create API routes for users (`/apps/api/src/routes/users.ts`):
  - `GET /api/v1/users` — List users (filtered by org/site)
  - `POST /api/v1/users` — Create user (creates Supabase auth + users record)
  - `GET /api/v1/users/:id` — Get single user
  - `PATCH /api/v1/users/:id` — Update user
  - `DELETE /api/v1/users/:id` — Deactivate user
- [x] 2.6 Create API routes for organizations (`/apps/api/src/routes/organizations.ts`):
  - `GET /api/v1/organizations/:id`
  - `PATCH /api/v1/organizations/:id`
- [x] 2.7 Create API routes for sites (`/apps/api/src/routes/sites.ts`):
  - `GET /api/v1/sites` — List sites for org
  - `POST /api/v1/sites` — Create site
  - `GET /api/v1/sites/:id`
  - `PATCH /api/v1/sites/:id`
- [x] 2.8 Install Supabase client in `/apps/web`:
  - Create `src/lib/supabase.ts`
  - Create auth context provider
- [x] 2.9 Create login page in `/apps/web/src/pages/Login.tsx`:
  - Email/password form
  - Error handling
  - Redirect on success
- [x] 2.10 Create auth-protected layout wrapper
- [x] 2.11 Create basic user management page (list users, invite user modal)
- [x] 2.12 Seed test data:
  - 1 organization
  - 2 sites
  - 5 users (1 admin, 2 advisors, 2 technicians)

### ⛔ HARD STOP — Phase 2 Verification
```
Before proceeding, verify:
- [ ] Can login via web app
- [ ] JWT stored and sent with requests
- [ ] /api/v1/auth/me returns correct user
- [ ] RLS filters data by organization
- [ ] Can create new user via API
- [ ] Role-based access working (tech can't access admin routes)
```

---

## Phase 3: Templates & Core Data
**Estimated iterations: 25-35**

```bash
/ralph-loop "Complete all Phase 3 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE3_DONE</promise> when complete." --max-iterations 35
```

- [x] 3.1 Create API routes for customers (`/apps/api/src/routes/customers.ts`):
  - `GET /api/v1/customers` — List with search/pagination
  - `POST /api/v1/customers` — Create customer
  - `GET /api/v1/customers/:id` — Get with vehicles
  - `PATCH /api/v1/customers/:id` — Update
  - `GET /api/v1/customers/search?q=` — Quick search
- [x] 3.2 Create API routes for vehicles (`/apps/api/src/routes/vehicles.ts`):
  - `GET /api/v1/vehicles` — List with filters
  - `POST /api/v1/vehicles` — Create vehicle
  - `GET /api/v1/vehicles/:id` — Get with customer
  - `PATCH /api/v1/vehicles/:id` — Update
  - `GET /api/v1/vehicles/lookup/:registration` — Find by reg
- [x] 3.3 Create API routes for templates (`/apps/api/src/routes/templates.ts`):
  - `GET /api/v1/templates` — List templates
  - `POST /api/v1/templates` — Create template
  - `GET /api/v1/templates/:id` — Get with sections and items
  - `PATCH /api/v1/templates/:id` — Update template
  - `DELETE /api/v1/templates/:id` — Soft delete
  - `POST /api/v1/templates/:id/duplicate` — Clone template
- [x] 3.4 Create API routes for template sections:
  - `POST /api/v1/templates/:id/sections` — Add section
  - `PATCH /api/v1/templates/:templateId/sections/:sectionId` — Update
  - `DELETE /api/v1/templates/:templateId/sections/:sectionId` — Delete
  - `POST /api/v1/templates/:id/sections/reorder` — Reorder sections
- [x] 3.5 Create API routes for template items:
  - `POST /api/v1/sections/:sectionId/items` — Add item
  - `PATCH /api/v1/items/:itemId` — Update item
  - `DELETE /api/v1/items/:itemId` — Delete item
  - `POST /api/v1/sections/:sectionId/items/reorder` — Reorder items
- [x] 3.6 Create default template seed data:
  - "Full Vehicle Health Check" with 9 sections, 58 items
  - Sections: Under Bonnet, Brakes, Tyres & Wheels, Steering & Suspension, Lights & Electrics, Exhaust, Interior, Exterior, Road Test
  - Include various item types: rag, tyre_depth, brake_measurement, fluid_level
- [x] 3.7 Create template builder UI in `/apps/web/src/pages/Templates/`:
  - `TemplateList.tsx` — List all templates
  - `TemplateBuilder.tsx` — Edit template with sections/items
- [x] 3.8 Create drag-and-drop for sections using `@dnd-kit/core`:
  - Reorder sections
  - Reorder items within sections
- [x] 3.9 Create item type configuration forms:
  - RAG (default, no config)
  - Measurement (unit, min, max, thresholds)
  - Yes/No
  - Select (options list)
  - Tyre depth (4 positions, threshold config)
  - Brake measurement (min thickness)
  - Fluid level (options: OK, Low, Very Low, Overfilled)
- [x] 3.10 Create customer/vehicle management pages in web app

### ⛔ HARD STOP — Phase 3 Verification
```
Before proceeding, verify:
- [ ] Can create/edit templates via UI
- [ ] Drag-and-drop reordering works
- [ ] All item types configurable
- [ ] Default template seeded with 47 items
- [ ] Customer CRUD working
- [ ] Vehicle CRUD working
- [ ] Vehicle lookup by registration works
```

---

## Phase 4: Health Check API & Core Flow
**Estimated iterations: 30-40**

```bash
/ralph-loop "Complete all Phase 4 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE4_DONE</promise> when complete." --max-iterations 40
```

- [x] 4.1 Create health check API routes (`/apps/api/src/routes/health-checks.ts`):
  - `GET /api/v1/health-checks` — List with filters (status, date, technician, advisor)
  - `POST /api/v1/health-checks` — Create new health check
  - `GET /api/v1/health-checks/:id` — Get full details
  - `PATCH /api/v1/health-checks/:id` — Update health check
  - `DELETE /api/v1/health-checks/:id` — Cancel health check
- [x] 4.2 Create status management endpoints:
  - `POST /api/v1/health-checks/:id/status` — Change status (with validation)
  - `GET /api/v1/health-checks/:id/history` — Get status history
- [x] 4.3 Create time tracking endpoints:
  - `POST /api/v1/health-checks/:id/clock-in` — Technician clock in
  - `POST /api/v1/health-checks/:id/clock-out` — Technician clock out
  - `GET /api/v1/health-checks/:id/time-entries` — Get time entries
- [x] 4.4 Create check results endpoints:
  - `GET /api/v1/health-checks/:id/results` — Get all results
  - `POST /api/v1/health-checks/:id/results` — Save single result
  - `POST /api/v1/health-checks/:id/results/batch` — Save multiple results
  - `PATCH /api/v1/health-checks/:id/results/:resultId` — Update result
- [x] 4.5 Create media upload endpoints:
  - `POST /api/v1/health-checks/:id/results/:resultId/media` — Upload photo
  - `DELETE /api/v1/media/:mediaId` — Delete photo
  - Configure Supabase Storage bucket for photos
  - Generate signed URLs for uploads
  - Create thumbnails on upload (or use Supabase transforms)
- [x] 4.6 Create repair items endpoints:
  - `GET /api/v1/health-checks/:id/repair-items` — List repair items
  - `POST /api/v1/health-checks/:id/repair-items` — Add repair item
  - `PATCH /api/v1/health-checks/:id/repair-items/:itemId` — Update (price, description)
  - `DELETE /api/v1/health-checks/:id/repair-items/:itemId` — Remove
  - `POST /api/v1/health-checks/:id/repair-items/reorder` — Reorder
- [x] 4.7 Create auto-generation of repair items from red/amber results
- [x] 4.8 Implement status transition validation:
  - Define valid transitions in code
  - Reject invalid status changes with error
- [x] 4.9 Create health check assignment endpoint:
  - `POST /api/v1/health-checks/:id/assign` — Assign technician
  - Auto-update status to 'assigned'
- [x] 4.10 Write API tests for all health check endpoints

### ⛔ HARD STOP — Phase 4 Verification
```
Before proceeding, verify:
- [ ] Can create health check via API
- [ ] Can assign technician
- [ ] Clock in/out updates status correctly
- [ ] Can save check results with RAG status
- [ ] Can upload photos to results
- [ ] Repair items auto-generated from red/amber
- [ ] Status transitions validated
- [ ] RAG counts update automatically (trigger working)
```

---

## Phase 5: Technician Mobile PWA
**Estimated iterations: 40-50**

```bash
/ralph-loop "Complete all Phase 5 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE5_DONE</promise> when complete." --max-iterations 50
```

- [x] 5.1 Set up PWA configuration in `/apps/mobile`:
  - Configure `vite-plugin-pwa` with proper manifest
  - Set up service worker for offline caching
  - Add install prompt handling
- [x] 5.2 Create shared components in `/apps/mobile/src/components/`:
  - `Button.tsx` — Square edges, large touch target (56px min)
  - `Card.tsx` — Square edges, subtle shadow
  - `Input.tsx` — Large text, clear labels
  - `Badge.tsx` — Status badges with colors
- [x] 5.3 Create RAGSelector component:
  - Three large buttons (72px height): Green, Amber, Red
  - Visual feedback on selection
  - Haptic feedback (navigator.vibrate)
  - Accessible labels
- [x] 5.4 Create auth flow for mobile:
  - Login page (large inputs, simple form)
  - Store token in localStorage
  - Auth context provider
- [x] 5.5 Create job list screen (`/apps/mobile/src/pages/JobList.tsx`):
  - List assigned health checks
  - Show status, vehicle reg, customer name
  - Large tappable cards
  - Pull-to-refresh
  - Filter: Today / All
- [x] 5.6 Create pre-check screen (`/apps/mobile/src/pages/PreCheck.tsx`):
  - Display vehicle details for confirmation
  - Mileage input (large numeric keypad)
  - "Start Inspection" button (clocks in)
- [x] 5.7 Create main inspection screen (`/apps/mobile/src/pages/Inspection.tsx`):
  - Current item display with description
  - RAGSelector for status
  - Notes input (expandable)
  - Photo button
  - Previous/Next navigation
  - Progress indicator (X of Y)
  - Section jump menu
- [x] 5.8 Create photo capture component:
  - Full-screen camera view
  - Large capture button
  - Preview after capture
  - Retake option
  - Multiple photos per item (up to 5)
- [x] 5.9 Create photo annotation component:
  - Draw on image (red default color)
  - Arrow tool
  - Circle tool
  - Box tool
  - Clear/undo
  - Save annotated image
- [x] 5.10 Create tyre depth input component:
  - Visual diagram of 4 tyre positions
  - Numeric input for each position (mm)
  - Auto-calculate RAG based on thresholds
  - Color-coded display
- [x] 5.11 Create brake measurement input:
  - Front/rear inputs
  - Disc thickness (mm)
  - Pad thickness (mm)
  - Auto-calculate RAG
- [x] 5.12 Create section overview screen:
  - List all sections with completion status
  - Tap to jump to section
  - Color-coded by worst item in section
- [x] 5.13 Create completion summary screen:
  - RAG summary counts
  - List of red items
  - List of amber items
  - Technician notes input
  - "Complete Inspection" button (clocks out, changes status)
- [x] 5.14 Set up IndexedDB for offline storage:
  - Install `idb` package
  - Create stores: jobs, results, mediaQueue, syncQueue
  - Save results locally as user works
- [x] 5.15 Implement offline sync:
  - Queue results when offline
  - Background sync when online
  - Sync status indicator
  - Conflict resolution (server wins)
- [x] 5.16 Add pull-to-refresh and loading states
- [ ] 5.17 Test on tablet (iPad Mini size)

### ⛔ HARD STOP — Phase 5 Verification
```
Before proceeding, verify:
- [ ] PWA installs on device
- [ ] Login works on mobile
- [ ] Job list loads assigned checks
- [ ] Can complete full inspection flow
- [ ] Photos capture and display correctly
- [ ] Annotation tools work
- [ ] Tyre depth calculates RAG correctly
- [ ] Offline mode works (can complete check without network)
- [ ] Data syncs when back online
- [ ] Touch targets are large enough for gloves
```

---

## Phase 6: Service Advisor Interface
**Estimated iterations: 35-45**

```bash
/ralph-loop "Complete all Phase 6 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE6_DONE</promise> when complete." --max-iterations 45
```

- [x] 6.1 Create main layout in `/apps/web/src/layouts/`:
  - Sidebar navigation
  - Header with user menu, notifications bell
  - Main content area
- [x] 6.2 Create health check list page:
  - Table view with columns: Reg, Customer, Status, Assigned, Created
  - Filters: Status, Date range, Technician, Advisor
  - Search by registration or customer
  - Pagination
- [x] 6.3 Create health check detail page with tabs:
  - Summary tab: Vehicle info, RAG counts, status timeline mini
  - Results tab: All items grouped by section with RAG
  - Pricing tab: Repair items with editable prices
  - Photos tab: Gallery of all photos
  - Timeline tab: Full status history
- [x] 6.4 Create pricing interface:
  - List repair items (auto-generated from red/amber)
  - Editable fields: Title, Description, Parts cost, Labor cost
  - Total calculation
  - Add/remove items
  - Drag to reorder
  - Toggle visibility (show to customer or not)
- [x] 6.5 Create customer preview:
  - Preview modal with device toggle (Mobile/Tablet/Desktop)
  - Render exact customer portal view
  - Disable all interactive elements
  - "Edit" and "Looks Good — Send" buttons
- [x] 6.6 Create publish modal:
  - Contact details (mobile, email) with validation
  - Send via checkboxes (SMS, Email)
  - Link expiry dropdown (24h, 48h, 3 days, 5 days, 7 days, 14 days)
  - Reminder settings (enable, intervals)
  - Display options (show pricing, require signature)
  - Custom message textarea
  - Preview button (opens preview modal)
  - Send button
- [x] 6.7 Create publish API endpoint:
  - `POST /api/v1/health-checks/:id/publish`
  - Generate public token
  - Set expiry
  - Queue SMS/Email notifications
  - Update status to 'sent'
  - Return public URL
- [x] 6.8 Create advisor queue view:
  - Cards for: Tech Completed, Awaiting Pricing, Ready to Send
  - Quick actions on each card
  - Time in status indicator
- [x] 6.9 Create quick status change actions:
  - "Start Review" button on tech_completed items
  - "Mark Ready" when pricing complete
  - Status change with confirmation
- [x] 6.10 Create resend functionality:
  - Resend link button on expired/sent items
  - Regenerate token if expired
  - Queue new notifications

### ⛔ HARD STOP — Phase 6 Verification
```
Before proceeding, verify:
- [ ] Health check list with filters works
- [ ] Detail page shows all data correctly
- [ ] Can edit repair item pricing
- [ ] Preview shows exact customer view
- [ ] Can switch preview device sizes
- [ ] Publish modal validates inputs
- [ ] Publish creates token and queues notifications
- [ ] Status updates correctly through advisor flow
```

---

## Phase 7: Customer Portal
**Estimated iterations: 30-40**

```bash
/ralph-loop "Complete all Phase 7 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE7_DONE</promise> when complete." --max-iterations 40
```

- [ ] 7.1 Create public routes in API (`/apps/api/src/routes/public.ts`):
  - `GET /api/public/vhc/:token` — Get health check data (no auth)
  - Validate token exists and not expired
  - Return vehicle, customer, repair items, photos
  - Track view activity
- [ ] 7.2 Create authorization endpoints:
  - `POST /api/public/vhc/:token/authorize/:itemId` — Approve item
  - `POST /api/public/vhc/:token/decline/:itemId` — Decline item
  - `POST /api/public/vhc/:token/authorize-all` — Approve all
  - `POST /api/public/vhc/:token/decline-all` — Decline all
- [ ] 7.3 Create signature endpoint:
  - `POST /api/public/vhc/:token/signature` — Submit signature
  - Store signature data (base64 or Supabase storage)
  - Capture IP and user agent
- [ ] 7.4 Create activity tracking endpoint:
  - `POST /api/public/vhc/:token/track` — Track customer activity
  - Types: view, photo_view, pdf_download
  - Rate limit to prevent spam
- [ ] 7.5 Create customer portal app (can be separate Vite app or route in web):
  - Public route: `/c/:token`
  - No authentication required
  - Mobile-first responsive design
- [ ] 7.6 Create portal header:
  - Dealer logo (from site settings)
  - Vehicle registration and description
  - Date of inspection
  - Mileage
- [ ] 7.7 Create RAG summary section:
  - Four boxes: Passed (green), Advisory (amber), Urgent (red), Not Checked
  - Large numbers, clear colors
- [ ] 7.8 Create repair items list:
  - Grouped by RAG status (Urgent first, then Advisory)
  - Each item shows: Title, description, price, photos
  - Photo thumbnails that expand to gallery
  - Approve/Decline buttons per item
- [ ] 7.9 Create photo gallery component:
  - Swipeable on mobile
  - Pinch to zoom
  - Show annotations
- [ ] 7.10 Create signature capture component:
  - Canvas for drawing signature
  - Clear button
  - Works on touch devices
  - Captures as base64 PNG
- [ ] 7.11 Create authorization summary:
  - Show approved items with total
  - Show declined items
  - "Submit" button to finalize
- [ ] 7.12 Create confirmation page:
  - Thank you message
  - Summary of decisions
  - Contact information for questions
- [ ] 7.13 Create expired link page:
  - Friendly message
  - Contact dealer prompt
- [ ] 7.14 Handle status updates from customer actions:
  - First view → status: 'opened'
  - First action → status: 'partial_response'
  - All actioned → status: 'authorized' or 'declined'
- [ ] 7.15 Test on mobile devices (iPhone, Android)

### ⛔ HARD STOP — Phase 7 Verification
```
Before proceeding, verify:
- [ ] Public URL loads without login
- [ ] Expired tokens show error page
- [ ] Customer can view all repair items
- [ ] Photos display and expand correctly
- [ ] Can approve/decline individual items
- [ ] Signature capture works on touch
- [ ] Status updates to 'opened' on first view
- [ ] Status updates to 'authorized'/'declined' when complete
- [ ] Mobile responsive and usable
```

---

## Phase 8: Notifications System
**Estimated iterations: 35-45**

```bash
/ralph-loop "Complete all Phase 8 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE8_DONE</promise> when complete." --max-iterations 45
```

- [ ] 8.1 Set up Redis on Railway:
  - Add Redis service to railway.toml
  - Get REDIS_URL environment variable
- [ ] 8.2 Set up BullMQ in `/apps/api`:
  - Install `bullmq`
  - Create queue configuration
  - Create queues: notifications, reminders, scheduled
- [ ] 8.3 Create worker service (`/apps/api/src/worker.ts`):
  - Process notification queue
  - Process reminder queue
  - Process scheduled jobs queue
  - Separate start script for worker
- [ ] 8.4 Integrate Twilio for SMS:
  - Install `twilio`
  - Create SMS service (`/apps/api/src/services/sms.ts`)
  - Send health check ready notification
  - Send reminder notifications
  - Handle delivery webhooks (optional)
- [ ] 8.5 Integrate Resend for email:
  - Install `resend`
  - Create email service (`/apps/api/src/services/email.ts`)
  - Create email templates (React Email or HTML):
    - Health check ready
    - Reminder
    - Expiry warning
  - Send emails via queue
- [ ] 8.6 Create notification scheduling on publish:
  - Schedule reminders based on settings (24h, 48h, etc.)
  - Schedule expiry warning notification
  - Schedule expiry status update
- [ ] 8.7 Create staff notification system:
  - Create notification on customer view
  - Create notification on customer action
  - Create notification on link expiring
  - Create notification on link expired
  - Store in staff_notifications table
- [ ] 8.8 Set up WebSocket with Socket.io:
  - Install `socket.io`
  - Create WebSocket server alongside HTTP
  - Authenticate connections with JWT
  - Join user to personal room and site room
- [ ] 8.9 Push real-time notifications:
  - Push to advisor when customer views
  - Push when customer approves/declines
  - Push when tech completes inspection
- [ ] 8.10 Create notification bell UI in web app:
  - Badge with unread count
  - Dropdown panel with recent notifications
  - Mark as read on click
  - "Mark all read" button
- [ ] 8.11 Create toast notifications:
  - Install `react-hot-toast` or similar
  - Show toast on real-time events
  - Click to navigate to health check
- [ ] 8.12 Create "customer viewing" live indicator:
  - Track active viewers via WebSocket
  - Show pulsing indicator on health check card
  - Auto-clear after 5 minutes of inactivity
- [ ] 8.13 Implement notification throttling:
  - Don't notify on every page refresh
  - Throttle to once per 5 minutes per health check
- [ ] 8.14 Test full notification flow:
  - Publish → SMS received → Email received
  - Customer opens → Staff notified
  - Reminder sent after 24h

### ⛔ HARD STOP — Phase 8 Verification
```
Before proceeding, verify:
- [ ] Redis connected and working
- [ ] BullMQ queues processing jobs
- [ ] SMS sends via Twilio
- [ ] Email sends via Resend
- [ ] Reminders scheduled correctly
- [ ] WebSocket connects with auth
- [ ] Real-time notifications appear
- [ ] Notification bell shows unread count
- [ ] "Customer viewing" indicator works
- [ ] Throttling prevents spam
```

---

## Phase 9: Dashboard & Analytics
**Estimated iterations: 30-40**

```bash
/ralph-loop "Complete all Phase 9 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE9_DONE</promise> when complete." --max-iterations 40
```

- [ ] 9.1 Create dashboard API endpoints:
  - `GET /api/v1/dashboard` — Summary metrics
  - `GET /api/v1/dashboard/board` — Kanban board data
  - `GET /api/v1/dashboard/technicians` — Technician workload
  - `GET /api/v1/dashboard/activity` — Recent activity feed
- [ ] 9.2 Create dashboard metrics calculations:
  - Total today, completed today
  - By status counts
  - Average tech time
  - Average customer response time
  - Conversion rate (authorized / sent)
  - Total value sent, authorized, declined
- [ ] 9.3 Create main dashboard page:
  - Summary cards at top (counts by category)
  - "Needs Attention" section (overdue, expiring)
  - Technician queue section
  - Advisor queue section
  - Customer queue section
- [ ] 9.4 Create Kanban board view:
  - Columns: Technician, Tech Done, Advisor, With Customer, Actioned
  - Drag cards to change status (where valid)
  - Color-coded cards by priority/RAG
- [ ] 9.5 Create technician workload view:
  - List technicians with current status
  - Show current job and time elapsed
  - Queue count per technician
  - Today's stats (completed, time)
- [ ] 9.6 Create health check timeline view:
  - Vertical timeline of status changes
  - Duration between each status
  - Expandable details
- [ ] 9.7 Create real-time dashboard updates:
  - Subscribe to WebSocket events
  - Update counts without refresh
  - Show live "in progress" indicators
- [ ] 9.8 Create SLA warning indicators:
  - Highlight overdue items (past promise time)
  - Highlight items stuck in status too long
  - Configurable thresholds
- [ ] 9.9 Create date/advisor/technician filters for dashboard
- [ ] 9.10 Create basic reporting page:
  - Date range selector
  - Metrics table: Total, Completed, Conversion, Value
  - Chart: Completions over time (line chart)
  - Export to CSV

### ⛔ HARD STOP — Phase 9 Verification
```
Before proceeding, verify:
- [ ] Dashboard loads with correct metrics
- [ ] Kanban board shows all health checks
- [ ] Technician workload accurate
- [ ] Real-time updates working
- [ ] Overdue items highlighted
- [ ] Filters working
- [ ] Timeline view shows full history
```

---

## Phase 10: Polish & Production
**Estimated iterations: 40-50**

```bash
/ralph-loop "Complete all Phase 10 tasks in TODO.md. Check off each task when done. Stop at HARD STOP. Output <promise>PHASE10_DONE</promise> when complete." --max-iterations 50
```

- [ ] 10.1 Create PDF generation:
  - Install `@react-pdf/renderer` or `puppeteer`
  - Create PDF template matching customer portal
  - Generate on demand via API endpoint
  - Store in Supabase Storage
- [ ] 10.2 Add PDF download to customer portal
- [ ] 10.3 Implement proper error handling:
  - API error responses with codes
  - Client-side error boundaries
  - Toast notifications for errors
  - Retry logic for failed requests
- [ ] 10.4 Add loading states everywhere:
  - Skeleton loaders for lists
  - Spinners for actions
  - Disabled buttons during submission
- [ ] 10.5 Optimize performance:
  - Add indexes review in database
  - Implement API response caching
  - Lazy load heavy components
  - Optimize images (WebP, thumbnails)
- [ ] 10.6 Security audit:
  - Review all API endpoints for auth
  - Verify RLS policies working
  - Check for SQL injection (parameterized queries)
  - Validate all user inputs
  - Rate limiting on public endpoints
- [ ] 10.7 Add logging:
  - Structured logging in API
  - Error tracking (Sentry or similar)
  - Audit log for sensitive actions
- [ ] 10.8 Environment configuration:
  - Production environment variables
  - Separate Supabase project for prod (optional)
  - Configure custom domain
- [ ] 10.9 Deploy to Railway:
  - Configure railway.toml
  - Set up environment variables
  - Deploy API service
  - Deploy worker service
  - Verify health checks
- [ ] 10.10 Deploy web apps:
  - Build web app for production
  - Deploy to Vercel/Netlify/Railway
  - Configure custom domain
  - Build mobile PWA
  - Deploy to same or separate host
- [ ] 10.11 Final testing:
  - Full flow test: Create → Inspect → Price → Send → Authorize
  - Mobile testing on real devices
  - Offline testing
  - Load testing (optional)
- [ ] 10.12 Create admin documentation:
  - Setup guide
  - User guide for advisors
  - User guide for technicians
  - API documentation (if needed)

### ⛔ HARD STOP — Phase 10 Verification
```
Before proceeding, verify:
- [ ] PDF generation working
- [ ] All error states handled gracefully
- [ ] No console errors in production build
- [ ] Security audit passed
- [ ] Deployed to Railway successfully
- [ ] Custom domain configured
- [ ] Full user flow works in production
- [ ] Mobile PWA installs and works offline
```

---

## 🎉 COMPLETION

When all phases complete, output:

```
<promise>VHC_BUILD_COMPLETE</promise>
```

### Final Checklist:
- [ ] All 10 phases completed
- [ ] All hard stops verified
- [ ] Application deployed and accessible
- [ ] Test account created for demo
- [ ] Documentation complete

---

## Recovery Prompts

If Ralph gets stuck, use these targeted prompts:

**Database issues:**
```bash
/ralph-loop "Fix database errors. Run migrations, check RLS policies, verify all tables exist. Output <promise>DB_FIXED</promise> when clean." --max-iterations 15
```

**Build errors:**
```bash
/ralph-loop "Fix all TypeScript and build errors in /apps/api, /apps/web, /apps/mobile. No type errors, builds succeed. Output <promise>BUILD_FIXED</promise>." --max-iterations 20
```

**Test failures:**
```bash
/ralph-loop "Fix all failing tests. Run tests, fix issues, repeat until all green. Output <promise>TESTS_PASS</promise>." --max-iterations 25
```

**API not working:**
```bash
/ralph-loop "Debug API issues. Check routes, middleware, database connection. All endpoints return expected responses. Output <promise>API_FIXED</promise>." --max-iterations 20
```
