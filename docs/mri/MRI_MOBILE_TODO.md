# MRI Mobile App - Implementation TODO

## Overview

This document covers adding MRI Summary view to the technician mobile app. This is a companion to the main `MRI_TODO.md` and should be implemented after Phase 7 (MRI Tab & Badge Display) is complete on the web app.

**Prerequisites:**
- Phase 7 complete (MRI Tab exists on web)
- API endpoint `/api/health-checks/{id}/mri-results` working
- MRI data being saved correctly

**Reference:** `check-in-mri-scan-spec.md` for full feature context

---

## Important: How MRI Items Work

**MRI Scan** = Advisor checks service history items (timing belt, brake fluid, recalls, etc.)

**When items are flagged as due:**
- System creates **repair items** in the Health Check
- They appear in the Red or Amber sections (based on configured severity)
- They have the [MRI] badge to show source
- They flow to customer PDF → authorisation → pricing (like normal inspection findings)

**What the mobile MRI Scan tab shows:**
- Read-only view of **all items scanned** (including OK/green items)
- Due dates and mileage recorded
- Indicates which items were added to Health Check
- Advisor check-in notes (when visible to tech)
- Provides service history context for the technician

**Where techs see the actual repair items:**
- In the Red/Amber tabs alongside other inspection findings (with [MRI] badge)
- These are normal repair items, just sourced from MRI scan

The MRI Scan tab is **supplementary context**, not the primary place for actioning work.

---

## Pre-Flight Checklist

Before starting, explore the mobile codebase:

```bash
# 1. Locate mobile app in monorepo
find . -name "package.json" -exec grep -l "react-native\|expo" {} \;
# OR
ls -la apps/ packages/

# 2. Understand mobile app structure
cd {mobile-app-directory}
ls -la src/

# 3. Find existing health check screens
grep -rn "health.check\|HealthCheck\|healthCheck" --include="*.tsx" --include="*.ts" | head -20

# 4. Find how API calls are made
grep -rn "fetch\|axios\|api\." --include="*.tsx" --include="*.ts" | head -20

# 5. Check existing patterns for detail views/tabs
grep -rn "Tab\|Screen\|View" --include="*.tsx" | head -20

# 6. Verify API endpoint works
curl -X GET http://localhost:3000/api/health-checks/{id}/mri-results \
  -H "Authorization: Bearer {token}"
```

Document what you find before proceeding.

---

## Goal

Add a read-only **"MRI Scan" tab** to the technician mobile app, alongside the existing inspection category tabs (Under Bonnet, Brakes, Tyres & Wheels, etc.).

This tab provides service history context from the advisor's check-in — techs can see what was scanned, what's due, and any notes.

---

## Acceptance Criteria

- [ ] New "MRI Scan" tab appears alongside inspection category tabs (Under Bonnet, Brakes, etc.)
- [ ] Tab only visible when MRI scan has been completed (or show with empty state)
- [ ] Tab is read-only (techs cannot edit MRI data)
- [ ] Shows all MRI items scanned, grouped by category (Service Items, Safety & Compliance, etc.)
- [ ] Displays RAG status for each item (red/amber/green indicators)
- [ ] Shows key data: item name, due date/mileage or yes/no value, notes
- [ ] Shows "Due if not already replaced" flag where applicable
- [ ] Indicates which items created repair items ("→ Added to Health Check")
- [ ] Check-In notes visible at top/bottom (when "show to technician" was checked)
- [ ] Graceful empty state when MRI scan not yet completed
- [ ] Tab hidden when Check-In feature is disabled for org

---

## API Contract

The mobile app should consume this endpoint:

```
GET /api/health-checks/{id}/mri-results
```

**Response when MRI complete:**
```json
{
  "completed": true,
  "completed_at": "2025-01-20T14:32:00Z",
  "results": [
    {
      "category": "Service Items",
      "item_name": "Timing Belt",
      "item_type": "date_mileage",
      "rag_status": "red",
      "next_due_date": null,
      "next_due_mileage": null,
      "due_if_not_replaced": true,
      "repair_item_created": true
    },
    {
      "category": "Service Items",
      "item_name": "Brake Fluid",
      "item_type": "date_mileage",
      "rag_status": "green",
      "next_due_date": "2026-03-15",
      "next_due_mileage": null,
      "due_if_not_replaced": false,
      "repair_item_created": false
    },
    {
      "category": "Safety & Compliance",
      "item_name": "Outstanding Recalls",
      "item_type": "yes_no",
      "rag_status": "red",
      "yes_no_value": true,
      "notes": "Airbag recall identified",
      "repair_item_created": true
    }
  ],
  "checkin_notes": "Customer mentioned rattle from rear when going over bumps.",
  "checkin_notes_visible": true
}
```

**Response when MRI not yet complete:**
```json
{
  "completed": false,
  "completed_at": null,
  "results": [],
  "checkin_notes": null,
  "checkin_notes_visible": false
}
```

**Response when Check-In disabled for org:**
```json
{
  "enabled": false
}
```

If the API doesn't match this structure, you may need to adjust it or create a mobile-specific endpoint.

---

## UI Mockup

**Tab bar (MRI Scan as last tab):**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ VHC00034  LG21WJR                                                    Pause  │
│ 0/56 items completed                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ Under Bonnet │ Brakes │ Tyres │ Steering │ ... │ Road Test │ MRI Scan │    │
│                                                               ─────────     │
│                                                               (selected)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**MRI Scan tab content:**
```
┌─────────────────────────────────────┐
│ Under Bonnet │ ... │ MRI Scan │    │
│                      ──────────     │
├─────────────────────────────────────┤
│                                     │
│ MRI SCAN                            │
│ Completed 14:32 today          🔒   │
│                        (read-only)  │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 📝 ADVISOR NOTES                │ │
│ │ Customer mentioned rattle from  │ │
│ │ rear when going over bumps.     │ │
│ └─────────────────────────────────┘ │
│                                     │
│ SERVICE ITEMS                       │
│ ┌─────────────────────────────────┐ │
│ │ 🔴 Timing Belt                  │ │
│ │    Due if not already replaced  │ │
│ │    → Added to Health Check      │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🟢 Brake Fluid                  │ │
│ │    Due: March 2026              │ │
│ │    OK - not due yet             │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🟠 Coolant                      │ │
│ │    Due: 48,000 miles            │ │
│ │    → Added to Health Check      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ SAFETY & COMPLIANCE                 │
│ ┌─────────────────────────────────┐ │
│ │ 🔴 Outstanding Recalls          │ │
│ │    Yes - Airbag recall          │ │
│ │    → Added to Health Check      │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🟢 Warranty Status              │ │
│ │    No (out of warranty)         │ │
│ └─────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

**Empty state (MRI not complete):**
```
┌─────────────────────────────────────┐
│ Under Bonnet │ ... │ MRI Scan │    │
│                      ──────────     │
├─────────────────────────────────────┤
│                                     │
│ MRI SCAN                            │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │                                 │ │
│ │   ⏳ Awaiting MRI Scan          │ │
│ │                                 │ │
│ │   The service advisor will      │ │
│ │   complete this during          │ │
│ │   vehicle check-in.             │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

---

## Implementation Hints

- Find where the inspection category tabs are rendered (Under Bonnet, Brakes, etc.)
- Add "MRI Scan" as the last tab in that tab bar
- Tab should only appear when Check-In feature is enabled for org
- Consider conditionally showing tab based on MRI completion status, or show with empty state
- RAG colours should match web app (check existing colour constants)
- Check-In notes section only shows when `checkin_notes_visible: true`
- Group items by `category` field (Service Items, Safety & Compliance, etc.)
- Format dates for readability (e.g., "March 2026" not "2026-03-15")
- Format mileage with commas (e.g., "48,000 miles")
- "→ Added to Health Check" indicates the item created a repair item (shows `repair_item_created: true`)

---

## Self-Tests

### API Verification

```bash
# 1. Test with completed MRI
curl -X GET http://localhost:3000/api/health-checks/{id_with_mri}/mri-results \
  -H "Authorization: Bearer {token}"
# Expected: completed: true, results array populated

# 2. Test with incomplete MRI
curl -X GET http://localhost:3000/api/health-checks/{id_without_mri}/mri-results \
  -H "Authorization: Bearer {token}"
# Expected: completed: false, results empty

# 3. Test with Check-In disabled org
curl -X GET http://localhost:3000/api/health-checks/{id_checkin_disabled}/mri-results \
  -H "Authorization: Bearer {token}"
# Expected: enabled: false OR empty response
```

### Mobile Build

```bash
cd {mobile-app-directory}

# Install dependencies
npm install

# Run tests
npm test

# Build (platform specific)
npm run build
# OR
npx expo build
# OR
npx react-native build-android / build-ios
```

### Manual Device Tests

**With completed MRI:**
- [ ] "MRI Scan" tab appears in tab bar (after Road Test or as last tab)
- [ ] Tapping tab shows MRI Scan content
- [ ] Read-only indicator visible (🔒 or similar)
- [ ] Items grouped by category correctly
- [ ] RAG colours display correctly (red/amber/green)
- [ ] Due dates shown in readable format
- [ ] Due mileage shown with formatting
- [ ] "Due if not already replaced" flag visible
- [ ] "→ Added to Health Check" indicator shown where applicable
- [ ] Advisor notes section visible at top (when flagged)
- [ ] Advisor notes hidden (when not flagged)
- [ ] Green/OK items also shown (for full context)

**Repair items from MRI (in other tabs):**
- [ ] MRI-created repair items visible in Red/Amber inspection tabs
- [ ] [MRI] badge shown on these items
- [ ] RAG status (coloured dot) visible

**With incomplete MRI:**
- [ ] "MRI Scan" tab still visible (or hidden - decide based on UX preference)
- [ ] If visible, shows empty/awaiting state
- [ ] No errors or crashes

**With Check-In disabled:**
- [ ] "MRI Scan" tab NOT visible in tab bar
- [ ] No errors when navigating between other tabs

**Cross-platform (if applicable):**
- [ ] iOS display correct
- [ ] Android display correct

---

## Phase Complete When

- [ ] "MRI Scan" tab appears in tab bar alongside inspection categories
- [ ] Tab content displays all MRI scan results correctly
- [ ] Read-only — no edit functionality
- [ ] All manual device tests pass
- [ ] Mobile app builds successfully
- [ ] Existing mobile tests still pass
- [ ] Works on both platforms (if applicable)

---

## Troubleshooting

### API returns 404
- Check endpoint path matches exactly
- Verify health check ID exists
- Check authentication token is valid

### MRI Scan tab not appearing
- Verify Check-In feature is enabled for the org
- Check where other tabs are rendered and ensure MRI tab is added there
- Verify conditional logic for showing/hiding tab

### Tab appears but content empty
- Verify API response structure matches what mobile expects
- Check if MRI scan was actually completed for this health check
- Verify data mapping in the component

### Colours not displaying
- Check colour constants exist in mobile codebase
- Verify RAG status string matches expected values (red/amber/green)

### Notes not showing
- Verify `checkin_notes_visible` is true in API response
- Check conditional rendering in component

### Build failures
- Check for TypeScript errors
- Verify all imports exist
- Run `npm install` to ensure dependencies

---

## Next Steps

After this is complete, continue with Phase 8 (Kanban & Dashboard Updates) in the main `MRI_TODO.md`.
