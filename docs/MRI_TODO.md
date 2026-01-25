# MRI / Check-In Feature - Implementation TODO

## Overview

This document guides implementation of the Check-In & MRI Scan feature. Each phase has clear acceptance criteria, self-tests, and a prompt for the next phase.

**Reference:** `check-in-mri-scan-spec.md` contains the full specification. Read it before starting.

**Approach:** This TODO tells you WHAT to achieve. HOW you implement it depends on the existing codebase patterns you discover. Explore first, then implement.

---

## Pre-Flight Checklist

Before starting any phase, run these checks:

```bash
# 1. Ensure tests pass
npm test

# 2. Ensure app builds
npm run build

# 3. Check current health_check statuses in use
grep -r "awaiting_arrival\|created\|assigned\|in_progress" --include="*.ts" --include="*.tsx" | head -20

# 4. Find existing status enum/type definition
grep -rn "status.*enum\|StatusType\|HealthCheckStatus" --include="*.ts" --include="*.tsx"

# 5. Understand current workflow transitions
grep -rn "setStatus\|updateStatus\|status:" --include="*.ts" --include="*.tsx" | head -30
```

Document what you find before proceeding.

---

## Phase 1: Database Schema & Status

### Goal
Add the `awaiting_checkin` status and check-in related fields to the database.

### Acceptance Criteria
- [ ] New status `awaiting_checkin` exists in the status enum/type
- [ ] `health_checks` table has new fields: `checked_in_at`, `checked_in_by`, `mileage_in`, `time_required`, `key_location`, `checkin_notes`, `checkin_notes_visible_to_tech`
- [ ] Migration runs without errors
- [ ] Existing health checks are unaffected

### Implementation Hints
- Find how other statuses are defined (enum in DB? TypeScript type? Both?)
- Follow existing migration patterns
- Check if `arrived_at` already exists (may need it for timeout calculation)
- Consider nullable fields for backwards compatibility

### Self-Tests

```bash
# 1. Run migration
npm run db:migrate

# 2. Verify new status exists - run in database
psql -c "SELECT enumlabel FROM pg_enum WHERE enumtypeid = (SELECT oid FROM pg_type WHERE typname = 'health_check_status');"
# OR if not using enum, check the TypeScript types compile

# 3. Verify new columns exist
psql -c "\d health_checks" | grep -E "checked_in_at|mileage_in|checkin_notes"

# 4. Verify existing data unaffected
psql -c "SELECT COUNT(*) FROM health_checks;"

# 5. Run full test suite
npm test
```

### Phase Complete When
- [ ] All self-tests pass
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] You can manually set a health check to `awaiting_checkin` status via database

### Next Phase Prompt

```
Phase 1 (Database Schema) is complete. The `awaiting_checkin` status and check-in fields now exist in the database.

Now implement Phase 2: Organisation Settings.

Read MRI_TODO.md Phase 2 for acceptance criteria and self-tests.

Goal: Add organisation-level setting to enable/disable the Check-In feature. When disabled, the feature should be completely hidden and workflow unchanged.

Explore the existing organisation settings patterns first, then implement.
```

---

## Phase 2: Organisation Settings

### Goal
Add organisation-level toggle to enable/disable Check-In feature, plus MRI item configuration tables.

### Acceptance Criteria
- [ ] New table `organisation_checkin_settings` with `checkin_enabled` boolean
- [ ] New table `mri_items` for configurable MRI checklist items
- [ ] New table `mri_scan_results` for storing scan results per health check
- [ ] API endpoint to get organisation's check-in settings
- [ ] API endpoint to update organisation's check-in settings
- [ ] Default MRI items seeded when feature is enabled for first time

### Implementation Hints
- Find existing organisation settings patterns
- Check how other feature toggles are implemented
- MRI items need: `name`, `category`, `item_type` (date_mileage/yes_no), `severity_when_due`, `enabled`, `sort_order`
- Consider a seed function for default MRI items

### Default MRI Items to Seed

```
Service Items (date_mileage type):
- Timing Belt (Red)
- Brake Fluid (Red)
- Coolant (Amber)
- Gearbox Oil (Amber)
- Air Filter (Amber)
- Pollen Filter (Green)

Safety & Compliance (yes_no type):
- Outstanding Recalls (Yes=Red, No=Green)
- Warranty Status (Informational)
- Service Book Present (Informational)

Other:
- Key Fob Battery (Amber)
```

### Self-Tests

```bash
# 1. Run migrations
npm run db:migrate

# 2. Verify tables exist
psql -c "\dt" | grep -E "organisation_checkin|mri_items|mri_scan"

# 3. Test API - get settings (should return default/empty)
curl -X GET http://localhost:3000/api/organisations/{org_id}/checkin-settings \
  -H "Authorization: Bearer {token}"

# 4. Test API - enable check-in
curl -X PUT http://localhost:3000/api/organisations/{org_id}/checkin-settings \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"checkin_enabled": true}'

# 5. Verify MRI items were seeded
psql -c "SELECT name, item_type, severity_when_due FROM mri_items WHERE organisation_id = '{org_id}';"

# 6. Test API - get MRI items
curl -X GET http://localhost:3000/api/organisations/{org_id}/mri-items \
  -H "Authorization: Bearer {token}"

# 7. Run full test suite
npm test
```

### Phase Complete When
- [ ] All self-tests pass
- [ ] Can enable/disable check-in via API
- [ ] Default MRI items appear when enabled
- [ ] `npm test` passes

### Next Phase Prompt

```
Phase 2 (Organisation Settings) is complete. Organisations can now enable/disable Check-In, and MRI items are configurable.

Now implement Phase 3: Workflow Status Transitions.

Read MRI_TODO.md Phase 3 for acceptance criteria and self-tests.

Goal: When Check-In is enabled and "Mark Arrived" is clicked, status should become `awaiting_checkin` instead of `created`. Add the "Complete Check-In" action that transitions to `created`.

Explore the existing status transition logic first, then implement.
```

---

## Phase 3: Workflow Status Transitions

### Goal
Implement the status transition logic: `awaiting_arrival` → `awaiting_checkin` → `created` (when Check-In enabled).

### Acceptance Criteria
- [ ] "Mark Arrived" checks if org has Check-In enabled
- [ ] If enabled: status → `awaiting_checkin`
- [ ] If disabled: status → `created` (existing behaviour)
- [ ] New API endpoint: "Complete Check-In" transitions `awaiting_checkin` → `created`
- [ ] Complete Check-In records `checked_in_at` timestamp and `checked_in_by` user
- [ ] Vehicles in `awaiting_checkin` cannot be assigned to technicians (blocked)
- [ ] Manual health check creation also respects the Check-In setting

### Implementation Hints
- Find the "Mark Arrived" handler
- Check how status transitions are validated
- The blocking of technician assignment may be in the assign endpoint or UI
- Consider a helper function: `getNextStatusAfterArrival(orgId)` or similar

### Self-Tests

```bash
# 1. Enable check-in for test org
curl -X PUT http://localhost:3000/api/organisations/{org_id}/checkin-settings \
  -H "Authorization: Bearer {token}" \
  -d '{"checkin_enabled": true}'

# 2. Create a health check in awaiting_arrival status
# (Use existing create endpoint or direct DB insert for testing)

# 3. Mark as arrived - should become awaiting_checkin
curl -X POST http://localhost:3000/api/health-checks/{id}/arrive \
  -H "Authorization: Bearer {token}"

# 4. Verify status
psql -c "SELECT status FROM health_checks WHERE id = '{id}';"
# Expected: awaiting_checkin

# 5. Try to assign technician - should fail/be blocked
curl -X POST http://localhost:3000/api/health-checks/{id}/assign \
  -H "Authorization: Bearer {token}" \
  -d '{"technician_id": "{tech_id}"}'
# Expected: 400 error or validation failure

# 6. Complete check-in
curl -X POST http://localhost:3000/api/health-checks/{id}/complete-checkin \
  -H "Authorization: Bearer {token}"

# 7. Verify status and timestamp
psql -c "SELECT status, checked_in_at, checked_in_by FROM health_checks WHERE id = '{id}';"
# Expected: status=created, checked_in_at populated

# 8. Now assignment should work
curl -X POST http://localhost:3000/api/health-checks/{id}/assign \
  -H "Authorization: Bearer {token}" \
  -d '{"technician_id": "{tech_id}"}'
# Expected: Success

# 9. Test with check-in DISABLED - should skip awaiting_checkin
curl -X PUT http://localhost:3000/api/organisations/{org_id}/checkin-settings \
  -d '{"checkin_enabled": false}'
# Create new health check, mark arrived, verify goes straight to 'created'

# 10. Run full test suite
npm test
```

### Phase Complete When
- [ ] All self-tests pass
- [ ] Enabled org: arrived → awaiting_checkin → created
- [ ] Disabled org: arrived → created (unchanged)
- [ ] Assignment blocked during awaiting_checkin
- [ ] `npm test` passes

### Next Phase Prompt

```
Phase 3 (Workflow Status Transitions) is complete. The awaiting_checkin status is now integrated into the workflow.

Now implement Phase 4: Check-In Tab UI.

Read MRI_TODO.md Phase 4 for acceptance criteria and self-tests.

Goal: Add the Check-In tab to the health check view. Include vehicle confirmation, customer details, booking info, mileage in, key location, time required, and notes (with tech visibility toggle).

Explore the existing health check tabs structure first, then implement.
```

---

## Phase 4: Check-In Tab UI

### Goal
Create the Check-In tab UI for advisors to complete the check-in process.

### Acceptance Criteria
- [ ] New "Check-In" tab appears on health check view (next to Summary)
- [ ] Tab only visible when org has Check-In enabled
- [ ] Tab shows: Vehicle details (reg, make/model, VIN) with confirmation
- [ ] Tab shows: Customer details (name, phone, email) with confirmation
- [ ] Tab shows: Booking info - Customer waiting (Y/N), Time required, Key location
- [ ] Tab shows: Pre-booked work from DMS (read-only list)
- [ ] Tab shows: Notes field with "Show to technician" checkbox
- [ ] Tab shows: Mileage in field (optional)
- [ ] Tab shows: "Complete MRI Scan" button/link to MRI section
- [ ] Tab shows: "Complete Check-In" button (disabled until MRI complete)
- [ ] Checked-in timestamp displayed after completion
- [ ] Auto-save as fields are edited (partial save supported)
- [ ] Read-only mode after check-in complete

### Implementation Hints
- Find existing tab structure in health check view
- Check how other forms handle auto-save
- Key location could be: dropdown or free text (check spec)
- Customer waiting may auto-populate from DMS import
- Pre-booked work comes from existing DMS data (check `booked_repairs` or similar field)

### Self-Tests

```bash
# UI tests - manual verification checklist:

# 1. With Check-In DISABLED:
#    - [ ] Check-In tab is NOT visible on health check view

# 2. With Check-In ENABLED, vehicle in awaiting_checkin:
#    - [ ] Check-In tab IS visible
#    - [ ] Tab is editable
#    - [ ] Vehicle details section shows correct data
#    - [ ] Customer details section shows correct data
#    - [ ] Mileage in field accepts numeric input
#    - [ ] Customer waiting dropdown works
#    - [ ] Time required field works
#    - [ ] Key location field works
#    - [ ] Notes field accepts text
#    - [ ] "Show to technician" checkbox toggles
#    - [ ] Pre-booked work displays (if DMS data exists)
#    - [ ] Changes auto-save (refresh page, data persists)

# 3. After check-in complete:
#    - [ ] Tab shows read-only view
#    - [ ] Checked-in timestamp displayed
#    - [ ] Fields not editable

# 4. As technician viewing completed check-in:
#    - [ ] Check-In tab visible but read-only
#    - [ ] Notes visible only if "show to technician" was checked

# API verification:
curl -X GET http://localhost:3000/api/health-checks/{id} \
  -H "Authorization: Bearer {token}"
# Verify check-in fields are returned

curl -X PATCH http://localhost:3000/api/health-checks/{id}/checkin-data \
  -H "Authorization: Bearer {token}" \
  -d '{"mileage_in": 45230, "key_location": "Key safe", "checkin_notes": "Test note"}'
# Verify fields saved

npm test
```

### Phase Complete When
- [ ] All manual UI tests pass
- [ ] Auto-save working
- [ ] Tab visibility respects org setting
- [ ] Read-only after completion
- [ ] `npm test` passes

### Next Phase Prompt

```
Phase 4 (Check-In Tab UI) is complete. Advisors can now see and complete the Check-In tab.

Now implement Phase 5: MRI Scan UI.

Read MRI_TODO.md Phase 5 for acceptance criteria and self-tests.

Goal: Create the MRI Scan interface within the Check-In flow. Advisors work through configured MRI items, entering due dates/mileage or yes/no values. Show progress indicator.

Explore the MRI items configuration and results tables, then implement the UI.
```

---

## Phase 5: MRI Scan UI

### Goal
Create the MRI Scan interface for advisors to complete the manufacturer recommended items checklist.

### Acceptance Criteria
- [ ] MRI Scan section accessible from Check-In tab
- [ ] Shows all enabled MRI items for the organisation, grouped by category
- [ ] Date/Mileage items show: Next due date field, Next due mileage field, "Due if not already replaced" checkbox
- [ ] Yes/No items show: Yes/No toggle, optional notes field
- [ ] Progress indicator: "3 of 8 items checked"
- [ ] RAG status displayed based on configuration and input
- [ ] Save progress (partial completion allowed)
- [ ] "Complete MRI Scan" marks scan as complete
- [ ] Results saved to `mri_scan_results` table

### Implementation Hints
- Fetch MRI items from `/api/organisations/{org_id}/mri-items`
- Group items by category for display
- Consider a sub-component for each item type
- RAG logic: if "Due if not replaced" checked → use configured severity
- Items can be completed in any order

### UI Mockup Reference

```
┌─────────────────────────────────────────────────────────────────┐
│ MRI SCAN                                        Progress: 3/8   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ SERVICE ITEMS                                                   │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ○ Timing Belt                                               │ │
│ │   Next due date:    [___________]                           │ │
│ │   Next due mileage: [___________]                           │ │
│ │   ☐ Due if not already replaced                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✓ Brake Fluid                                    🟢 OK      │ │
│ │   Next due date:    [March 2026]                            │ │
│ │   Next due mileage: [___________]                           │ │
│ │   ☐ Due if not already replaced                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ SAFETY & COMPLIANCE                                             │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✓ Outstanding Recalls                            🔴         │ │
│ │   [Yes ▼]                                                   │ │
│ │   Notes: [Airbag recall identified______________]           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│                              [Save Progress] [Complete MRI Scan]│
└─────────────────────────────────────────────────────────────────┘
```

### Self-Tests

```bash
# 1. Verify MRI items load for organisation
curl -X GET http://localhost:3000/api/organisations/{org_id}/mri-items \
  -H "Authorization: Bearer {token}"
# Expected: Array of configured MRI items

# 2. Submit MRI scan results
curl -X POST http://localhost:3000/api/health-checks/{id}/mri-results \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "results": [
      {"mri_item_id": "{timing_belt_id}", "due_if_not_replaced": true},
      {"mri_item_id": "{brake_fluid_id}", "next_due_date": "2026-03-15"},
      {"mri_item_id": "{recalls_id}", "yes_no_value": true, "notes": "Airbag recall"}
    ]
  }'

# 3. Verify results saved
psql -c "SELECT * FROM mri_scan_results WHERE health_check_id = '{id}';"

# 4. Verify partial save works (submit some items, refresh, they persist)

# UI manual tests:
# - [ ] Items grouped by category
# - [ ] Date picker works for date fields
# - [ ] Number input works for mileage fields  
# - [ ] Checkbox toggles "due if not replaced"
# - [ ] Yes/No dropdown works
# - [ ] Notes field appears for yes/no items
# - [ ] Progress indicator updates as items completed
# - [ ] RAG indicator shows correct colour based on input
# - [ ] Save Progress button works
# - [ ] Complete MRI Scan marks as complete

npm test
```

### Phase Complete When
- [ ] All self-tests pass
- [ ] Both item types (date/mileage, yes/no) working
- [ ] Progress tracking accurate
- [ ] Partial save working
- [ ] RAG colours correct
- [ ] `npm test` passes

### Next Phase Prompt

```
Phase 5 (MRI Scan UI) is complete. Advisors can now complete the MRI Scan checklist.

Now implement Phase 6: Auto-Create Repair Items.

Read MRI_TODO.md Phase 6 for acceptance criteria and self-tests.

Goal: When MRI Scan is completed, automatically create repair items for any flagged items (due, overdue, or "due if not replaced"). Items should have the configured RAG status and be marked with source='mri_scan'.

Explore the existing repair item creation logic, then implement the auto-creation.
```

---

## Phase 6: Auto-Create Repair Items

### Goal
Automatically create repair items from flagged MRI results when check-in is completed.

### Acceptance Criteria
- [ ] When "Complete Check-In" is clicked, system reviews MRI results
- [ ] For each flagged item (due/overdue/"due if not replaced"), create a repair item
- [ ] Repair item inherits: description from MRI item name, RAG from MRI configuration
- [ ] Repair item has `source` field set to `mri_scan`
- [ ] Repair item linked back to MRI result (optional: `mri_result_id` foreign key)
- [ ] Items appear in Repair Items tab ready for pricing
- [ ] No duplicate items created if check-in is re-saved

### Implementation Hints
- Find existing repair item creation logic
- May need to add `source` column to repair_items table if not exists
- Check for existing MRI-sourced items before creating (prevent duplicates)
- Consider creating items as part of the "Complete Check-In" transaction

### Self-Tests

```bash
# 1. Verify source column exists on repair_items
psql -c "\d repair_items" | grep source

# 2. Complete a check-in with flagged MRI items
# (Set up: health check in awaiting_checkin, MRI results with due_if_not_replaced=true)

curl -X POST http://localhost:3000/api/health-checks/{id}/complete-checkin \
  -H "Authorization: Bearer {token}"

# 3. Verify repair items were created
psql -c "SELECT description, rag_status, source FROM repair_items WHERE health_check_id = '{id}';"
# Expected: Items with source='mri_scan' and correct RAG

# 4. Verify no duplicates on re-save
curl -X POST http://localhost:3000/api/health-checks/{id}/complete-checkin \
  -H "Authorization: Bearer {token}"
psql -c "SELECT COUNT(*) FROM repair_items WHERE health_check_id = '{id}' AND source = 'mri_scan';"
# Expected: Same count as before

# 5. Verify items appear in API response
curl -X GET http://localhost:3000/api/health-checks/{id}/repair-items \
  -H "Authorization: Bearer {token}"
# Expected: MRI items included with source field

# 6. Test with no flagged items - should create no repair items
# (Set up: MRI results with all items OK/not due)

npm test
```

### Phase Complete When
- [ ] All self-tests pass
- [ ] Flagged MRI items create repair items
- [ ] Source field correctly set
- [ ] No duplicates on re-run
- [ ] `npm test` passes

### Next Phase Prompt

```
Phase 6 (Auto-Create Repair Items) is complete. MRI-flagged items now automatically become repair items.

Now implement Phase 7: MRI Tab & Badge Display.

Read MRI_TODO.md Phase 7 for acceptance criteria and self-tests.

Goal: Add a dedicated read-only MRI Scan tab (visible to techs), and show [MRI] badge on repair items in the UI (but NOT on customer PDF).

Explore the existing repair items display and tabs, then implement.
```

---

## Phase 7: MRI Tab & Badge Display

### Goal
Add MRI visibility for technicians and source badges on repair items.

### Acceptance Criteria
- [ ] New "MRI Scan" tab on health check view (separate from Check-In tab)
- [ ] MRI tab visible to both advisors and technicians (read-only for all after completion)
- [ ] MRI tab shows all scan results with RAG status and values entered
- [ ] Repair items in UI show `[MRI]` badge when `source='mri_scan'`
- [ ] Badge NOT shown on customer-facing PDF
- [ ] Technician can view MRI tab to understand service history context

### Implementation Hints
- Check-In tab is for the process; MRI tab is for viewing results
- Badge can be a small pill/tag component
- PDF generation needs to filter out/ignore the source badge
- Consider showing "→ Repair item created" indicator on MRI tab for flagged items

### Self-Tests

```bash
# UI manual tests:

# As Advisor:
# - [ ] MRI Scan tab visible on health check
# - [ ] Tab shows all MRI results with categories
# - [ ] RAG indicators displayed correctly
# - [ ] "Repair item created" shown for flagged items

# As Technician:
# - [ ] MRI Scan tab visible (read-only)
# - [ ] Can see all MRI results
# - [ ] Cannot edit any values

# Repair Items display:
# - [ ] [MRI] badge appears on MRI-sourced items
# - [ ] Badge has distinct styling (pill, different colour)
# - [ ] Non-MRI items have no badge (or show [Inspection])

# PDF generation:
# - [ ] Generate PDF for health check with MRI items
# - [ ] MRI items appear as normal repair items
# - [ ] NO [MRI] badge visible on PDF
# - [ ] Customer sees no indication of MRI vs inspection source

# API check:
curl -X GET http://localhost:3000/api/health-checks/{id}/mri-results \
  -H "Authorization: Bearer {token}"
# Expected: Complete MRI results for the health check

npm test
```

### Phase Complete When
- [ ] MRI tab visible and functional
- [ ] Badge displays in UI
- [ ] Badge hidden from PDF
- [ ] Technician access working
- [ ] `npm test` passes

### Next Phase Prompt

```
Phase 7 (MRI Tab & Badge Display) is complete. Technicians can view MRI results and badges show item source.

Now implement Phase 8: Kanban & Dashboard Updates.

Read MRI_TODO.md Phase 8 for acceptance criteria and self-tests.

Goal: Show awaiting_checkin vehicles in Technician Queue with red tint and "CHECK-IN REQUIRED" badge. Add "Check-In Required" section to Dashboard with timeout warnings (20+ mins).

Explore the existing Kanban and Dashboard components, then implement.
```

---

## Phase 8: Kanban & Dashboard Updates

### Goal
Visual treatment for `awaiting_checkin` status on Kanban board and Dashboard.

### Acceptance Criteria

**Kanban Board:**
- [ ] Vehicles with `awaiting_checkin` appear in Technician Queue column
- [ ] These cards have light red/pink background tint
- [ ] "CHECK-IN REQUIRED" badge displayed on card
- [ ] Drag-to-assign is blocked (shows error or prevented)
- [ ] Cards return to normal styling once check-in complete

**Dashboard:**
- [ ] New "Check-In Required" section showing all `awaiting_checkin` vehicles
- [ ] Shows: Registration, Make/Model, Customer name, Time arrived, Elapsed time
- [ ] Elapsed time shown for each vehicle
- [ ] Warning icon (⚠️) if elapsed > 20 minutes
- [ ] Amber/red text styling for overdue check-ins
- [ ] Clicking a row opens the health check (Check-In tab)

### Implementation Hints
- Kanban cards likely have a status-based styling system already
- Dashboard section could be similar to existing "Awaiting Arrival" section
- Elapsed time calculation: `now - arrived_at`
- Consider a refresh interval for elapsed time (every minute?)

### Self-Tests

```bash
# UI manual tests:

# Kanban Board:
# 1. Create health check, mark arrived (with check-in enabled)
# 2. Verify:
#    - [ ] Card appears in Technician Queue column
#    - [ ] Card has red/pink tint background
#    - [ ] "CHECK-IN REQUIRED" badge visible
#    - [ ] Try to drag to assign - should be blocked
# 3. Complete check-in
# 4. Verify:
#    - [ ] Card styling returns to normal
#    - [ ] Can now assign technician

# Dashboard:
# 1. With vehicles in awaiting_checkin status:
#    - [ ] "Check-In Required" section visible
#    - [ ] All awaiting_checkin vehicles listed
#    - [ ] Elapsed time displayed
#    - [ ] Click opens health check
# 2. Wait 20+ minutes (or adjust arrived_at in DB for testing):
#    - [ ] Warning icon appears
#    - [ ] Text colour changes to amber/red
# 3. After completing all check-ins:
#    - [ ] Section shows empty state or hides

# Test the 20-minute threshold:
psql -c "UPDATE health_checks SET arrived_at = NOW() - INTERVAL '25 minutes' WHERE id = '{id}';"
# Refresh dashboard - should show warning

npm test
```

### Phase Complete When
- [ ] Kanban visual treatment working
- [ ] Assignment blocking working
- [ ] Dashboard section showing correctly
- [ ] Timeout warnings displaying
- [ ] `npm test` passes

### Next Phase Prompt

```
Phase 8 (Kanban & Dashboard Updates) is complete. The awaiting_checkin status is now visually distinct and Dashboard shows pending check-ins.

Now implement Phase 9: Settings UI.

Read MRI_TODO.md Phase 9 for acceptance criteria and self-tests.

Goal: Create the organisation settings UI to enable/disable Check-In and configure MRI items.

Explore the existing settings/admin UI patterns, then implement.
```

---

## Phase 9: Settings UI

### Goal
Admin interface for organisations to configure Check-In feature and MRI items.

### Acceptance Criteria

**Check-In Toggle:**
- [ ] Settings page has "Workflow Settings" section
- [ ] Toggle to enable/disable Check-In Procedure
- [ ] Help text explaining what the feature does
- [ ] "Configure MRI Items" link (visible when enabled)

**MRI Configuration:**
- [ ] List all MRI items grouped by category
- [ ] Each item shows: name, type, severity, enabled status
- [ ] Can enable/disable individual items
- [ ] Can edit item severity (Red/Amber/Green dropdown)
- [ ] Can add custom items
- [ ] Can reorder items within categories
- [ ] Can delete custom items (not default items?)

### Implementation Hints
- Follow existing settings page patterns
- Consider a modal or slide-out panel for editing items
- Drag-and-drop for reordering (or simple up/down arrows)
- Save button or auto-save depending on existing patterns

### Self-Tests

```bash
# UI manual tests:

# Check-In Toggle:
# - [ ] Find toggle in settings
# - [ ] Toggle OFF - Check-In tab disappears on health checks
# - [ ] Toggle ON - Check-In tab appears

# MRI Configuration:
# - [ ] Access MRI config (link or section)
# - [ ] See all default items listed
# - [ ] Toggle item enabled/disabled
# - [ ] Change item severity (e.g., Coolant Red→Amber)
# - [ ] Add custom item (e.g., "Wiper Blades")
# - [ ] Verify custom item appears in MRI Scan
# - [ ] Reorder items
# - [ ] Verify order reflected in MRI Scan

# API verification:
curl -X GET http://localhost:3000/api/organisations/{org_id}/mri-items \
  -H "Authorization: Bearer {token}"
# Verify changes reflected

npm test
```

### Phase Complete When
- [ ] Toggle working end-to-end
- [ ] MRI items configurable
- [ ] Changes reflected in MRI Scan
- [ ] `npm test` passes

### Next Phase Prompt

```
Phase 9 (Settings UI) is complete. Organisations can now configure Check-In and MRI items.

Now implement Phase 10: Polish & Edge Cases.

Read MRI_TODO.md Phase 10 for acceptance criteria and self-tests.

Goal: Handle edge cases, improve UX, and ensure robustness. This is the final phase.
```

---

## Phase 10: Polish & Edge Cases

### Goal
Handle edge cases, add finishing touches, ensure feature is production-ready.

### Acceptance Criteria

**Edge Cases:**
- [ ] Health check created before Check-In was enabled - should not require check-in
- [ ] Check-In disabled mid-workflow - vehicle in awaiting_checkin can still complete
- [ ] Organisation with no MRI items configured - graceful handling
- [ ] MRI item deleted that has existing results - results preserved, item shown as "Deleted item"

**UX Polish:**
- [ ] Loading states for all async operations
- [ ] Error handling with user-friendly messages
- [ ] Confirmation dialogs where appropriate
- [ ] Empty states for sections with no data
- [ ] Keyboard navigation support

**Performance:**
- [ ] MRI items cached appropriately (don't fetch on every render)
- [ ] Dashboard check-in section doesn't slow page load
- [ ] Large number of MRI items handles gracefully

**Documentation:**
- [ ] Update any API documentation
- [ ] Add feature to user guide/help docs (if applicable)

### Self-Tests

```bash
# Edge case tests:

# 1. Legacy health check (created before feature enabled)
psql -c "INSERT INTO health_checks (id, status, ...) VALUES ('{id}', 'created', ...);"
# Verify: No check-in required, normal workflow

# 2. Feature disabled mid-workflow
# - Create health check, mark arrived (status: awaiting_checkin)
# - Disable check-in feature in settings
# - Verify: Can still complete check-in OR status auto-transitions (decide behaviour)

# 3. No MRI items
# - Disable all MRI items in settings
# - Start check-in
# - Verify: MRI section shows "No items configured" or is hidden

# 4. Deleted MRI item with results
# - Complete MRI scan with all items
# - Delete one MRI item from settings
# - View MRI results
# - Verify: Shows result with "Item no longer configured" or similar

# Performance test:
# - Create 50+ health checks in awaiting_checkin
# - Load dashboard
# - Verify: Loads in < 2 seconds

# Full regression:
npm test
npm run build
```

### Phase Complete When
- [ ] All edge cases handled gracefully
- [ ] UX polish complete
- [ ] Performance acceptable
- [ ] Full test suite passes
- [ ] Feature is production-ready

---

## Final Checklist

Before marking feature complete:

```bash
# 1. Full test suite
npm test

# 2. Build succeeds
npm run build

# 3. Manual smoke test - complete workflow
#    - Enable Check-In for org
#    - Configure MRI items
#    - Create health check
#    - Mark arrived
#    - Complete Check-In with MRI Scan
#    - Verify repair items created
#    - Assign technician
#    - Complete inspection
#    - Generate PDF (MRI items appear without badge)

# 4. Test with Check-In disabled
#    - Workflow unchanged from before

# 5. No console errors in browser

# 6. No new TypeScript errors
npm run typecheck
```

---

## Troubleshooting Guide

### Common Issues

**Status enum not updating:**
- Check migration ran successfully
- May need to restart server after enum changes
- Verify TypeScript types match database

**Check-In tab not appearing:**
- Verify org has `checkin_enabled: true`
- Check for frontend caching issues
- Verify API returns correct setting

**MRI items not loading:**
- Check default items were seeded
- Verify organisation ID is correct
- Check API endpoint response

**Repair items not created:**
- Verify MRI results have flagged items
- Check "Complete Check-In" logic runs
- Look for errors in server logs

**Assignment not blocked:**
- Check status is exactly `awaiting_checkin`
- Verify blocking logic in assign endpoint
- May also need UI-side prevention

---

## Reference Documents

- `check-in-mri-scan-spec.md` - Full feature specification
- `vhc-gemini-dms-plan.md` - DMS integration context
- Existing codebase patterns - explore before implementing
