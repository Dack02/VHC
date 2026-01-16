# VHC Bug Fixes & Enhancements — January 2026

## Instructions for Claude Code
Work through each issue below. Test after fixing. Check off with [x] when verified working.

---

## 🐛 BUGS (Fix First)

### BUG-001: Health Check Tab Not Showing Red/Amber Items
**Priority:** HIGH
**Status:** [ ] Fixed [ ] Tested

**Problem:**
After completing a health check, the Red and Amber items are NOT showing on the Health Check tab of the Health Check detail page. However, the Summary tab correctly shows the counts, so the data exists.

**Expected:**
- Health Check tab should display grouped sections: Immediate Attention (red), Advisory (amber), Items OK (green)
- Items should show with their details, photos, pricing columns

**Debug Steps:**
1. Check the API endpoint that fetches health check details - is it returning check_results?
2. Check the HealthCheckTab component - is it filtering/grouping results correctly?
3. Check if there's a rendering condition that's failing
4. Compare what Summary tab receives vs Health Check tab

**Test After Fix:**
- [ ] Complete a health check with red, amber, and green items
- [ ] Navigate to Health Check detail page
- [ ] Verify Health Check tab shows all sections with correct items

---

### BUG-002: Dashboard KPIs Not Updating
**Priority:** HIGH  
**Status:** [ ] Fixed [ ] Tested

**Problem:**
After completing a health check, the "Tech Done" KPI on the dashboard did not update. Other dashboard metrics may also not be updating.

**Expected:**
- Dashboard metrics should reflect current state
- Either via real-time WebSocket updates OR refresh on navigation

**Debug Steps:**
1. Check dashboard API endpoint - is it returning correct counts?
2. Check if WebSocket is connected and receiving events
3. Check if dashboard component is subscribed to updates
4. Check if there's caching that needs invalidation

**Test After Fix:**
- [ ] Note current dashboard KPI values
- [ ] Complete a health check (tech flow)
- [ ] Verify "Tech Done" count increases by 1
- [ ] Verify other relevant KPIs update (Today's Total, etc.)

---

### BUG-003: Fluid Level Items No Visual Selection Feedback
**Priority:** MEDIUM
**Status:** [ ] Fixed [ ] Tested

**Problem:**
When clicking on a fluid level item (like Brake Fluid), there's no visual indication that a selection was made. Other item types show color changes on selection.

**Expected:**
- Clicking an option should highlight it (background color change, border, or checkmark)
- Selected state should be visually obvious

**Fix:**
- Check FluidLevelSelector component (or equivalent)
- Add selected state styling matching other selectors
- Ensure state is being tracked correctly

**Test After Fix:**
- [ ] Open a fluid level check item
- [ ] Click each option (OK, Low, Very Low, Overfilled)
- [ ] Verify selected option is visually highlighted
- [ ] Verify selection persists after navigating away and back

---

## 🔧 ENHANCEMENTS

### ENH-001: Rename "Brake Fluid Level" and Change Options
**Priority:** MEDIUM
**Status:** [ ] Done [ ] Tested

**Current:**
- Name: "Brake Fluid Level"
- Options: OK, Low, Very Low, Overfilled (fluid level options)

**Required:**
- Name: "Brake Fluid"
- Options: OK, Replacement Required

**Implementation:**
1. Update in default template seed data
2. Update any existing templates (migration or manual)
3. May need a new input type or custom options for this item

**Test After Fix:**
- [ ] Check template shows "Brake Fluid" not "Brake Fluid Level"
- [ ] Technician app shows only: OK, Replacement Required
- [ ] Existing health checks still display correctly

---

### ENH-002: Restructure Tyre Input - Split Details from Tread
**Priority:** HIGH
**Status:** [ ] Done [ ] Tested

**Current:**
Tyre input has tabs: "Tyre Details" and "Tyre Tread" - requires multiple clicks to see all tyres.

**Required Structure:**

```
TYRE DETAILS (Top Section - Always Visible)
┌─────────────────────────────────────────────────────────────────┐
│  FRONT LEFT                          FRONT RIGHT               │
│  Manufacturer: [Dropdown    ▼]       Manufacturer: [Dropdown ▼]│
│  Size:         [Dropdown    ▼]       Size:         [Dropdown ▼]│
│  Speed Rating: [Dropdown    ▼]       Speed Rating: [Dropdown ▼]│
│  Load Rating:  [Dropdown    ▼]       Load Rating:  [Dropdown ▼]│
│                                                                │
│  REAR LEFT                           REAR RIGHT                │
│  Manufacturer: [Dropdown    ▼]       Manufacturer: [Dropdown ▼]│
│  Size:         [Dropdown    ▼]       Size:         [Dropdown ▼]│
│  Speed Rating: [Dropdown    ▼]       Speed Rating: [Dropdown ▼]│
│  Load Rating:  [Dropdown    ▼]       Load Rating:  [Dropdown ▼]│
│                                                                │
│  [Copy First Tyre to All]                                      │
└─────────────────────────────────────────────────────────────────┘

TREAD DEPTH (Per Tyre - Separate Sections)
┌─────────────────────────────────────────────────────────────────┐
│  FRONT LEFT TREAD                                              │
│  Outer: [===|====] 4.5mm   Middle: [====|===] 5.0mm           │
│  Inner: [===|====] 4.2mm                                       │
│  Damage: [ ] None  [ ] Cut  [ ] Bulge  [ ] Cracking  [ ] Other│
└─────────────────────────────────────────────────────────────────┘
(Repeat for each tyre)
```

**Key Changes:**
1. Tyre Details shows all 4 tyres at once (2x2 grid) - no tabs
2. "Copy to All" button copies first tyre's details to other 3
3. Tread sections are separate for each tyre
4. Add "Damage" multi-select for each tyre: None, Cut, Bulge, Cracking, Sidewall Damage, Other

**Implementation:**
1. Restructure TyreInput component
2. Remove tabs, show grid layout
3. Add damage selection per tyre
4. Update data model to store damage type

**Test After Fix:**
- [ ] Open tyre check in technician app
- [ ] Can see all 4 tyre detail sections without scrolling excessively
- [ ] Can enter first tyre and click "Copy to All"
- [ ] Can enter tread depth for each tyre
- [ ] Can select damage type for each tyre
- [ ] Data saves correctly and shows in advisor view

---

### ENH-003: Move Kanban View to Health Checks Page as Default
**Priority:** MEDIUM
**Status:** [ ] Done [ ] Tested

**Current:**
- Kanban board is on Dashboard page
- Health Checks page shows table/list view

**Required:**
- Kanban board should be on Health Checks page (`/health-checks`)
- Kanban should be the DEFAULT view
- Option to switch to List view (toggle button)
- Dashboard should show summary cards only (no Kanban)

**Implementation:**
1. Move KanbanBoard component from Dashboard to HealthChecks page
2. Add view toggle: [Kanban] [List]
3. Store view preference (localStorage or user preference)
4. Default to Kanban on first visit
5. Remove Kanban from Dashboard, keep summary metrics

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Health Checks                    [Kanban] [List]  [+ New]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AWAITING    │ IN PROGRESS │ TECH DONE  │ WITH CUST │ COMPLETE │
│  ──────────  │ ──────────  │ ─────────  │ ───────── │ ──────── │
│  ┌────────┐  │ ┌────────┐  │ ┌────────┐ │           │          │
│  │AB12 CDE│  │ │XY34 FGH│  │ │GH56 IJK│ │           │          │
│  │J Smith │  │ │J Doe   │  │ │B Wilson│ │           │          │
│  │09:00   │  │ │Mike T  │  │ │        │ │           │          │
│  └────────┘  │ └────────┘  │ └────────┘ │           │          │
│  ┌────────┐  │             │            │           │          │
│  │...     │  │             │            │           │          │
│  └────────┘  │             │            │           │          │
│              │             │            │           │          │
└─────────────────────────────────────────────────────────────────┘
```

**Test After Fix:**
- [ ] Navigate to /health-checks
- [ ] Kanban view shows by default
- [ ] Can toggle to List view
- [ ] View preference persists on page refresh
- [ ] Dashboard no longer has Kanban, just summary cards
- [ ] Can drag cards between columns (if implemented)

---

## Execution Order

1. **BUG-001** — Health Check Tab (blocking advisor workflow)
2. **BUG-002** — Dashboard KPIs (visibility issue)
3. **BUG-003** — Fluid Level selection feedback
4. **ENH-003** — Move Kanban to Health Checks (UX improvement)
5. **ENH-001** — Brake Fluid rename (quick fix)
6. **ENH-002** — Tyre input restructure (larger change)

---

## Prompt to Run

```bash
claude -p "Read docs/vhc-bugs-jan2026.md. Fix bugs and enhancements in order listed. For each issue: 1) Identify root cause, 2) Implement fix, 3) Test the fix works, 4) Check off the item. Start with BUG-001: Health Check Tab not showing red/amber items." --dangerously-skip-permissions
```
