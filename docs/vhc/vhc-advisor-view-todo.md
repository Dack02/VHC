# VHC Advisor View — Build Tasks
> **For use with Claude Code**
> 
> Reference: `docs/vhc-advisor-view-spec.md`
> 
> Note: Technician input components (tyre, brake, RAG) already implemented.

---

## Phase 1: Database Updates for Advisor Features
**Estimated iterations: 10-15**

```bash
claude -p "Read docs/vhc-advisor-view-spec.md. Complete Phase 1 tasks in TODO-advisor-view.md. Check off each task with [x] when done." --dangerously-skip-permissions
```

### 1.1 Repair Items Table Updates
- [x] Add `parts_price` DECIMAL(10,2) to repair_items *(Already exists as `parts_cost`)*
- [x] Add `labour_price` DECIMAL(10,2) to repair_items *(Already exists as `labor_cost`)*
- [x] Add `is_mot_failure` BOOLEAN DEFAULT false to repair_items
- [x] Add `follow_up_date` DATE to repair_items
- [x] Add `work_completed_at` TIMESTAMPTZ to repair_items
- [x] Add `work_completed_by` UUID REFERENCES users(id) to repair_items

### 1.2 Check Results Updates
- [x] Add `is_mot_failure` BOOLEAN DEFAULT false to check_results

### 1.3 Health Checks Updates
- [x] Add `closed_at` TIMESTAMPTZ to health_checks
- [x] Add `closed_by` UUID REFERENCES users(id) to health_checks

### ⛔ HARD STOP — Phase 1 Verification
```
Before proceeding, verify:
- [x] Repair items table has parts_price, labour_price columns (as parts_cost, labor_cost)
- [x] Repair items table has is_mot_failure, follow_up_date columns
- [x] Repair items table has work_completed_at, work_completed_by columns
- [x] Health checks table has closed_at, closed_by columns
```

---

## Phase 2: API Updates
**Estimated iterations: 15-20**

```bash
claude -p "Continue with Phase 2 tasks in TODO-advisor-view.md. Update API endpoints for advisor features." --dangerously-skip-permissions
```

### 2.1 Repair Items API
- [x] Update PATCH /api/v1/repair-items/:id to accept:
  - parts_price, labour_price (optional, calculates total if provided)
  - is_mot_failure
  - follow_up_date
- [x] POST /api/v1/repair-items/:id/complete — Mark work done (sets work_completed_at, work_completed_by)
- [x] DELETE /api/v1/repair-items/:id/complete — Unmark work done (clears fields)

### 2.2 Health Check Close API
- [x] POST /api/v1/health-checks/:id/close
- [x] Validate: All authorised items must be marked complete
- [x] Return error with list of incomplete items if validation fails
- [x] Set closed_at and closed_by on success

### 2.3 Health Check Detail API
- [x] Ensure GET /api/v1/health-checks/:id returns (with `?include=advisor`):
  - All check_results with full item details
  - All repair_items with pricing
  - All photos/media
  - Customer response data (authorised/declined items)

### ⛔ HARD STOP — Phase 2 Verification
```
Before proceeding, verify:
- [x] Can update repair item with parts_price and labour_price
- [x] Can mark/unmark work complete via API
- [x] Close endpoint validates correctly
- [x] Health check detail returns all needed data (use ?include=advisor)
```

---

## Phase 3: Advisor View — Page Structure
**Estimated iterations: 15-20**

```bash
claude -p "Continue with Phase 3 tasks in TODO-advisor-view.md. Build the advisor health check detail page structure." --dangerously-skip-permissions
```

### 3.1 Page Layout
- [x] Create/update HealthCheckDetail page (/health-checks/:id)
- [x] Top action bar: Back button, Send Media, Print PDF, Close Health Check
- [x] Vehicle/Customer info bar (always visible)
- [x] Tab navigation: Summary, Health Check, Photos, Timeline

### 3.2 Vehicle Info Bar Component
- [x] Registration (large, prominent)
- [x] Vehicle: Make, Model, Year
- [x] VIN (truncated with expand)
- [x] Customer name
- [x] Contact: Phone, Email, verified indicator
- [x] Mileage
- [ ] Job Number *(not yet implemented - requires data field)*
- [x] Technician name
- [x] Date completed
- [x] Status badge (color-coded)

### 3.3 Tab Navigation
- [x] Tab component with active state
- [x] Summary tab
- [x] Health Check tab (default active)
- [x] Photos tab (show count badge)
- [x] Timeline tab

### ⛔ HARD STOP — Phase 3 Verification
```
Before proceeding, verify:
- [x] Page loads with correct health check data
- [x] Vehicle info bar displays all fields
- [x] Tabs switch correctly
- [x] Back button works
```

---

## Phase 4: Health Check Tab — Display Components
**Estimated iterations: 25-30**

```bash
claude -p "Continue with Phase 4 tasks in TODO-advisor-view.md. Build the display components for the health check tab." --dangerously-skip-permissions
```

### 4.1 Tyre Display Component
- [x] Show 3-point readings: Outer, Middle, Inner (mm)
- [x] Calculate remaining legal tread: lowest_reading - 1.6mm
- [x] Warning if below legal limit (show "BELOW LEGAL LIMIT")
- [x] Show tyre details: Manufacturer, Size, Speed rating, Load rating
- [x] Format example:
  ```
  Outer: 3.5mm  Middle: 3.8mm  Inner: 3.2mm
  Remaining Legal Tread: 1.6mm
  Dunlop 205/55R17 91V
  ```

### 4.2 Brake Display Component
- [x] Show brake type: Disc or Drum
- [x] Show N/S and O/S readings
- [x] Pad thickness per side
- [x] Disc thickness per side (if disc brakes)
- [x] Format example:
  ```
  Front Brakes (Disc)
  N/S Pad: 6.0mm  O/S Pad: 3.0mm
  N/S Disc: 22mm  O/S Disc: 22mm
  ```

### 4.3 Section Header Component
- [x] Title with RAG color bar/background
- [x] Item count
- [x] Total price
- [x] Expand/collapse toggle (for green items)

### 4.4 Repair Item Row Component
- [x] Item name
- [x] Photo count with camera icon (clickable to view)
- [x] MOT Fail checkbox
- [x] Parts price (editable)
- [x] Labour price (editable)
- [x] Total price (calculated or editable)
- [x] Follow-up date picker (for amber items)
- [x] Work complete checkbox (for authorised items)
- [x] Expandable tech notes section

### ⛔ HARD STOP — Phase 4 Verification
```
Before proceeding, verify:
- [x] TyreDisplay shows correct format with calculation
- [x] BrakeDisplay shows all measurements
- [x] Section headers show counts and totals
- [x] Repair item row shows all columns
```

---

## Phase 5: Health Check Tab — Sections
**Estimated iterations: 25-30**

```bash
claude -p "Continue with Phase 5 tasks in TODO-advisor-view.md. Build the RAG-grouped sections for the health check tab." --dangerously-skip-permissions
```

### 5.1 Immediate Attention Section (Red)
- [x] Red background on header
- [x] Filter items where RAG = red
- [x] Show all repair item rows
- [x] For tyre items, show TyreDisplay below item name
- [x] For brake items, show BrakeDisplay below item name
- [x] Show tech notes (expandable)
- [x] Section total at bottom

### 5.2 Advisory Section (Amber)
- [x] Amber background on header
- [x] Filter items where RAG = amber
- [x] Show follow-up date column
- [x] Section total at bottom

### 5.3 Items OK Section (Green)
- [x] Green background on header
- [x] Collapsed by default
- [x] Click header to expand
- [x] Group by template section
- [x] Show condensed list (item name + ✓)
- [x] Show tyre/brake details inline when relevant

### 5.4 Authorised Work Section (Blue)
- [x] Only render if any items authorised by customer
- [x] Blue background on header
- [x] Show authorised items (from any RAG status)
- [x] Work complete checkbox column
- [x] Authorised total
- [x] Work completed total

### 5.5 Declined Work Section (Grey)
- [x] Only render if any items declined by customer
- [x] Grey background on header
- [x] Show declined items
- [x] No pricing/action columns needed

### ⛔ HARD STOP — Phase 5 Verification
```
Before proceeding, verify:
- [x] Red section shows only red items
- [x] Amber section shows only amber items
- [x] Green section is collapsed, expands on click
- [x] Authorised section only shows when items authorised
- [x] Declined section only shows when items declined
- [x] Tyre/brake displays render correctly in context
```

---

## Phase 6: Health Check Tab — Editing & Actions
**Estimated iterations: 20-25**

```bash
claude -p "Continue with Phase 6 tasks in TODO-advisor-view.md. Build inline editing and action features." --dangerously-skip-permissions
```

### 6.1 Inline Price Editing
- [x] Click on price cell to enter edit mode
- [x] Input field replaces text
- [x] Save on blur or Enter key
- [x] Cancel on Escape key
- [x] Show loading state while saving
- [x] Update total automatically when parts/labour change

### 6.2 Pricing Mode Toggle
- [x] Per-item toggle: "Parts + Labour" vs "Total Only"
- [x] When Parts + Labour: show parts, labour, calculated total
- [x] When Total Only: show single editable total field
- [ ] Save preference with item *(Note: preference is per-session, not persisted)*

### 6.3 MOT Fail Toggle
- [x] Checkbox click toggles is_mot_failure
- [x] Save immediately via API
- [x] Show loading state

### 6.4 Follow-Up Date Picker
- [x] Click to open date picker
- [x] Quick options: Next Service, 1 Month, 3 Months, 6 Months
- [x] Custom date option
- [x] Clear button
- [x] Save immediately via API

### 6.5 Work Complete Toggle
- [x] Checkbox click calls complete/uncomplete API
- [x] Show timestamp when marked complete
- [x] Only show for authorised items

### 6.6 Close Health Check
- [x] Close button in top action bar
- [x] If incomplete work: show error with list of items
- [x] If all complete: show confirmation modal
- [x] Confirmation shows summary (authorised total, declined count, no response count)
- [x] On confirm: call close API, redirect to list

### ⛔ HARD STOP — Phase 6 Verification
```
Before proceeding, verify:
- [x] Can edit prices inline
- [x] Can toggle between parts+labour and total modes
- [x] MOT fail checkbox saves
- [x] Follow-up date picker works
- [x] Work complete checkbox saves
- [x] Close button validates correctly
- [x] Health check closes when all work complete
```

---

## Phase 7: Summary & Photos Tabs
**Estimated iterations: 15-20**

```bash
claude -p "Continue with Phase 7 tasks in TODO-advisor-view.md. Build the Summary and Photos tabs." --dangerously-skip-permissions
```

### 7.1 Summary Tab
- [x] RAG summary cards in a row:
  - Red: count + total value
  - Amber: count + total value
  - Green: count only
  - Total items
- [x] Customer Response section:
  - Sent date/time
  - Opened date/time (or "Not yet opened")
  - Last activity
  - Expires date/time
  - Link expiry warning if approaching
- [x] Financials section:
  - Total Identified (all priced items)
  - Total Authorised
  - Total Declined
  - Pending Response
  - Work Completed (value)
  - Work Outstanding (value)

### 7.2 Photos Tab
- [x] Grid layout (4 columns on desktop, 2 on tablet)
- [x] Photo thumbnail card:
  - Thumbnail image
  - Item name
  - RAG indicator dot
- [x] Filter buttons: All, Red, Amber, Green
- [x] Click thumbnail to open lightbox
- [x] Lightbox:
  - Full-size image
  - Annotations visible
  - Item name and notes
  - Previous/Next navigation
  - Close button

### ⛔ HARD STOP — Phase 7 Verification
```
Before proceeding, verify:
- [x] Summary cards show correct counts
- [x] Financials calculate correctly
- [x] Photos grid displays
- [x] Filter buttons work
- [x] Lightbox opens and navigates
```

---

## Phase 8: PDF Generation
**Estimated iterations: 20-25**

```bash
claude -p "Continue with Phase 8 tasks in TODO-advisor-view.md. Implement PDF generation for health checks." --dangerously-skip-permissions
```

### 8.1 Setup
- [x] Install PDF library (@react-pdf/renderer or puppeteer) *(puppeteer installed)*
- [x] Create PDF generation service *(apps/api/src/services/pdf-generator.ts)*
- [x] Add GET /api/v1/health-checks/:id/pdf endpoint

### 8.2 PDF Template
- [x] Header: Dealer/Site logo, Health Check title, Date
- [x] Vehicle info section: Reg, Make/Model, VIN, Mileage
- [x] Customer info section: Name, Contact
- [x] Immediate Attention section:
  - Red items with descriptions
  - Tyre/brake details
  - Photos (embedded, scaled)
  - Pricing
- [x] Advisory section:
  - Amber items
  - Follow-up dates
  - Photos
  - Pricing
- [x] Items OK section:
  - Condensed list grouped by category
- [x] Pricing Summary:
  - Table with all priced items
  - Totals by status
- [x] Signature area (if customer signed):
  - Signature image
  - Date signed
  - Items authorised
- [x] Footer: Dealer contact info, page numbers

### 8.3 PDF Download
- [x] Print PDF button in advisor view
- [x] Show loading spinner during generation
- [x] Open in new tab or download file *(downloads file)*
- [x] Handle errors gracefully

### ⛔ HARD STOP — Phase 8 Verification
```
Before proceeding, verify:
- [x] PDF generates without errors
- [x] All sections present
- [x] Photos embedded and visible
- [x] Pricing correct
- [x] Download works in browser
```

---

## Phase 9: Technician App — MOT Failure Flag
**Estimated iterations: 5-10**

```bash
claude -p "Continue with Phase 9 tasks in TODO-advisor-view.md. Add MOT failure checkbox to technician app." --dangerously-skip-permissions
```

### 9.1 MOT Failure Checkbox in Inspection
- [x] When technician selects RED/URGENT, show checkbox
- [x] Checkbox label: "Possible MOT Failure"
- [x] Save to check_results.is_mot_failure
- [x] Auto-create repair item with is_mot_failure = true

### ⛔ HARD STOP — Phase 9 Verification
```
Verify:
- [x] Checkbox appears when selecting red
- [x] Checkbox hidden for amber/green
- [x] Value saves correctly
- [x] Shows in advisor view
```

---

## Phase 10: Admin Settings (Optional)
**Estimated iterations: 15-20**

```bash
claude -p "Continue with Phase 10 tasks in TODO-advisor-view.md. Build admin settings pages if not already present." --dangerously-skip-permissions
```

### 10.1 Check Existing Admin Pages
- [x] Check if tyre manufacturers admin exists — **API exists, no UI**
- [x] Check if tyre sizes admin exists — **API exists, no UI**
- [x] Check if thresholds settings exists — **Hardcoded in template config, no UI**

### 10.2 Build Missing Admin Pages
- [x] Tyre Manufacturers list — **Built at /admin/tyre-manufacturers**
- [x] Tyre Sizes list — **Built at /admin/tyre-sizes**
- [x] Inspection Thresholds settings — **Built at /settings/thresholds**

### 10.3 Organization-Wide Thresholds (Added)
- [x] Created `inspection_thresholds` database table with organization-wide settings
- [x] API endpoints: GET/PATCH `/api/v1/organizations/:id/thresholds`
- [x] Admin settings page with Reset to Defaults button
- [x] Updated TyreDepthInput component to use org thresholds
- [x] Updated BrakeMeasurementInput component to use org thresholds
- [x] Created ThresholdsContext for mobile app

### ⛔ HARD STOP — Phase 10 Verification
```
Verify:
- [x] Can manage tyre manufacturers
- [x] Can manage tyre sizes
- [x] Can configure thresholds at /settings/thresholds
- [x] Technician components use org thresholds instead of template config
```

---

## Phase 11: Polish & Testing
**Estimated iterations: 10-15**

```bash
claude -p "Continue with Phase 11 tasks in TODO-advisor-view.md. Final polish and testing." --dangerously-skip-permissions
```

### 11.1 Responsive Design
- [x] Test advisor view on desktop (1920px+)
- [x] Test advisor view on laptop (1366px)
- [x] Test advisor view on tablet (768px)
- [x] Adjust layouts for each breakpoint
  - VehicleInfoBar: Mobile stacked layout with priority info (md:hidden/hidden md:flex)
  - Top Action Bar: Condensed button text on mobile (hidden sm:inline)
  - RepairItemRow: Separate mobile/desktop layouts (lg:hidden/hidden lg:flex)
  - PhotosTab: 2-column on mobile, 4-column on desktop

### 11.2 Error Handling
- [x] API error handling with user messages
- [x] Loading states for all actions
- [x] Retry logic for failed saves (exponential backoff, max 3 attempts)
- [x] Offline handling (show warning via useOnlineStatus hook)

### 11.3 Edge Cases
- [x] Health check with 0 red items (empty sections hidden)
- [x] Health check with 0 photos (shows "No photos" message)
- [x] All items declined (shows Declined section only)
- [x] No customer response yet (Pending response shown in Summary)
- [x] Expired link (shows EXPIRED badge with red styling in Summary)

### 11.4 Performance
- [x] Lazy load photos (IntersectionObserver in LazyImage component)
- [x] Paginate if many items *(Not needed - lazy loading handles this)*
- [x] Optimize re-renders (useCallback for fetch, stable dependencies)

### ⛔ FINAL VERIFICATION
```
Complete advisor view verification:
- [x] Can view health check with all sections
- [x] Tyre display shows remaining legal tread
- [x] Brake display shows all measurements
- [x] Can edit pricing inline
- [x] Can toggle MOT fail flag
- [x] Can set follow-up dates
- [x] Can mark work complete
- [x] Can close health check (with validation)
- [x] Summary tab shows correct data
- [x] Photos tab filters and displays correctly
- [x] PDF generates with all content
- [x] Responsive on all screen sizes
```

---

## 🎉 ADVISOR VIEW COMPLETE

Features implemented:
- ✅ Grouped sections (Red/Amber/Green/Authorised/Declined)
- ✅ Tyre display with remaining legal tread calculation
- ✅ Brake display with all measurements
- ✅ Inline price editing (parts/labour/total)
- ✅ MOT failure flagging
- ✅ Follow-up date scheduling
- ✅ Work complete tracking
- ✅ Health check closing with validation
- ✅ Summary tab with financials
- ✅ Photos tab with filtering
- ✅ PDF generation

---

## Recovery Prompts

### Database migration fails:
```bash
claude -p "Database migration failed with: [error]. Fix and re-run." --dangerously-skip-permissions
```

### Component not rendering:
```bash
claude -p "The [SectionName] section is not rendering. Check the filter logic and data." --dangerously-skip-permissions
```

### API errors:
```bash
claude -p "API endpoint [path] returns 500. Check server logs and fix." --dangerously-skip-permissions
```

### PDF issues:
```bash
claude -p "PDF generation fails with: [error]. Debug the template." --dangerously-skip-permissions
```
