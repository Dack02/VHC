# Check-In & MRI Scan Feature Specification

## Overview

The Check-In feature adds a mandatory workflow step between vehicle arrival and technician assignment. Service advisors complete a structured check-in process that includes an MRI (Manufacturer Recommended Items) scan to identify service items that may be due based on age, mileage, or unknown history.

This feature is optional per organisation and fully customisable.

---

## Feature Toggle

### Organisation Settings

```
┌─────────────────────────────────────────────────────────────┐
│ WORKFLOW SETTINGS                                           │
│                                                             │
│ ☑ Enable Check-In Procedure                                 │
│   When enabled, vehicles must complete check-in before      │
│   being assigned to a technician.                           │
│                                                             │
│   [Configure Check-In →]                                    │
└─────────────────────────────────────────────────────────────┘
```

### Behaviour by Toggle State

| Setting | "Mark Arrived" Behaviour | Check-In Tab | Workflow |
|---------|--------------------------|--------------|----------|
| **Enabled** | Status → `awaiting_checkin` | Visible | Must complete before tech assignment |
| **Disabled** | Status → `created` (current behaviour) | Hidden | Straight to Technician Queue |

Historical check-in data is preserved but hidden when feature is disabled.

---

## Workflow Changes

### New Status: `awaiting_checkin`

```
UPDATED WORKFLOW:

Dashboard (awaiting_arrival)
    │
    ▼ "Mark Arrived" clicked
    │
    ├─── Check-In ENABLED ───→ [awaiting_checkin] ──→ Advisor completes ──→ [created]
    │                                Check-In tab                              │
    │                                                                          ▼
    └─── Check-In DISABLED ──→ [created] ─────────────────────────────→ Technician Queue
                                                                               │
                                                                               ▼
                                                                         [assigned]
                                                                               │
                                                                               ▼
                                                                        [in_progress]
                                                                               │
                                                                               ▼
                                                                       [tech_complete]
```

### Manual Health Check Creation

When an advisor creates a health check manually (not from DMS import):
- If Check-In is **enabled**: Health check created in `awaiting_checkin` status
- If Check-In is **disabled**: Health check created in `created` status (current behaviour)

This ensures consistency — all vehicles go through the same workflow regardless of origin.

---

## Check-In Tab

A new tab appears on the health check view, positioned next to the Summary tab.

### Tab Visibility

| Role | Visibility | Access |
|------|------------|--------|
| Service Advisor | Always visible (when feature enabled) | Full edit during check-in, read-only after |
| Technician | Visible after check-in complete | Read-only |

### Tab Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Summary] [Check-In] [Inspection] [Repair Items] [MRI Scan]                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CHECK-IN                                                    ⏱ Checked in:  │
│                                                              14:32 today    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ VEHICLE DETAILS                                                     │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  Registration     AB12 CDE              ✓ Confirmed                 │   │
│  │  Make/Model       BMW 3 Series (F30)    ✓ Confirmed                 │   │
│  │  VIN              WBA8E9C50JA12345      ✓ Confirmed                 │   │
│  │  Mileage In       [ 45,230        ]     (optional)                  │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ CUSTOMER DETAILS                                                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  Name             John Smith            ✓ Confirmed                 │   │
│  │  Phone            07700 900123          ✓ Confirmed                 │   │
│  │  Email            john@example.com      ✓ Confirmed                 │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ BOOKING INFORMATION                                                 │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  Customer Waiting     [Yes ▼]           (auto-detected from DMS)    │   │
│  │  Time Required        [ 16:00     ]     (optional)                  │   │
│  │  Key Location         [Key Safe ▼]      (optional)                  │   │
│  │                       Options: In vehicle / Key safe / With         │   │
│  │                                advisor / Hook number: ___           │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PRE-BOOKED WORK                                        (from DMS)   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  • Full Service                                                     │   │
│  │  • MOT Test                                                         │   │
│  │  • Front brake pads - customer complaint of squealing               │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ MRI SCAN                                                            │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  [Complete MRI Scan →]                                              │   │
│  │                                                                     │   │
│  │  Status: Not started / 3 of 8 items checked / Complete              │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ NOTES                                                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │ Customer mentioned rattle from rear when going over bumps.   │ │   │
│  │  │ Also wants quote for alloy wheel refurbishment.              │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  │                                                                     │   │
│  │  ☑ Show notes to technician                                        │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │            [Complete Check-In]                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Check-In Timestamp

- **Checked in at**: Automatically recorded when advisor clicks "Complete Check-In"
- Displayed on Check-In tab and available for reporting
- Useful for tracking advisor efficiency and customer wait times

---

## MRI Scan

### Dedicated MRI Tab

A separate "MRI Scan" tab is visible to both advisors and technicians (read-only for techs).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Summary] [Check-In] [Inspection] [Repair Items] [MRI Scan]                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  MRI SCAN RESULTS                                          Completed: ✓     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SERVICE ITEMS                                                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  🔴 Timing Belt                                                     │   │
│  │     Next due: -- / --                                               │   │
│  │     ☑ Due if not already replaced                                   │   │
│  │     → Repair item created                                           │   │
│  │                                                                     │   │
│  │  🟢 Brake Fluid                                                     │   │
│  │     Next due: March 2026 / --                                       │   │
│  │     Not due                                                         │   │
│  │                                                                     │   │
│  │  🟠 Coolant                                                         │   │
│  │     Next due: -- / 48,000 miles                                     │   │
│  │     Due within threshold                                            │   │
│  │     → Repair item created                                           │   │
│  │                                                                     │   │
│  │  🟢 Gearbox Oil                                                     │   │
│  │     Next due: June 2027 / 60,000 miles                              │   │
│  │     Not due                                                         │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SAFETY & COMPLIANCE                                                 │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  🔴 Outstanding Recalls                                             │   │
│  │     Status: Yes                                                     │   │
│  │     Notes: Airbag recall - check with manufacturer                  │   │
│  │     → Repair item created                                           │   │
│  │                                                                     │   │
│  │  🟢 Warranty Status                                                 │   │
│  │     Status: No (out of warranty)                                    │   │
│  │                                                                     │   │
│  │  🟢 Service Book Present                                            │   │
│  │     Status: Yes                                                     │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### MRI Item Types

#### Type A: Date/Mileage Items

For service items with scheduled intervals.

**Configuration (per item):**
- Item name (e.g., "Timing Belt")
- Severity when due (Red / Amber / Green)
- Enabled/disabled toggle

**Data captured during check-in:**
- Next due date (optional)
- Next due mileage (optional)
- "Due if not already replaced" checkbox

**RAG Logic:**
- If "Due if not already replaced" is checked → Uses configured severity
- If date/mileage entered → Advisor assesses current status and selects RAG
- If not due → Green

**Examples:** Timing Belt, Brake Fluid, Coolant, Gearbox Oil, Spark Plugs, Air Filter, Pollen Filter, Transmission Fluid

#### Type B: Yes/No Items

For binary status checks.

**Configuration (per item):**
- Item name (e.g., "Outstanding Recalls")
- Severity when Yes/No (configurable per answer)
- Optional notes field
- Enabled/disabled toggle

**Data captured during check-in:**
- Yes/No selection
- Notes (optional)

**RAG Logic:**
- Configured per item (e.g., Recalls = Yes → Red, Recalls = No → Green)

**Examples:** Outstanding Recalls, Warranty Status, Service Book Present, Key Fob Battery Checked

---

## MRI Item Configuration

### Organisation Settings Interface

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MRI SCAN CONFIGURATION                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Configure which items appear on the MRI Scan checklist and their          │
│  severity ratings when flagged.                                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SERVICE ITEMS                                              [+ Add]  │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  ☑ Timing Belt              When due: [Red ▼]         [Edit] [⋮]   │   │
│  │  ☑ Brake Fluid              When due: [Red ▼]         [Edit] [⋮]   │   │
│  │  ☑ Coolant                  When due: [Amber ▼]       [Edit] [⋮]   │   │
│  │  ☑ Gearbox Oil              When due: [Amber ▼]       [Edit] [⋮]   │   │
│  │  ☐ Spark Plugs              When due: [Amber ▼]       [Edit] [⋮]   │   │
│  │  ☑ Air Filter               When due: [Amber ▼]       [Edit] [⋮]   │   │
│  │  ☑ Pollen Filter            When due: [Green ▼]       [Edit] [⋮]   │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SAFETY & COMPLIANCE                                        [+ Add]  │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  ☑ Outstanding Recalls      Yes: [Red ▼]  No: [Green ▼]   [Edit]   │   │
│  │  ☑ Warranty Status          (Informational only)          [Edit]   │   │
│  │  ☑ Service Book Present     (Informational only)          [Edit]   │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ OTHER                                                      [+ Add]  │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                     │   │
│  │  ☑ Key Fob Battery          When due: [Amber ▼]       [Edit] [⋮]   │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Default MRI Items

When an organisation enables Check-In, provide sensible defaults:

| Category | Item | Type | Default Severity |
|----------|------|------|------------------|
| Service Items | Timing Belt | Date/Mileage | Red |
| Service Items | Brake Fluid | Date/Mileage | Red |
| Service Items | Coolant | Date/Mileage | Amber |
| Service Items | Gearbox Oil | Date/Mileage | Amber |
| Service Items | Air Filter | Date/Mileage | Amber |
| Service Items | Pollen Filter | Date/Mileage | Green |
| Safety & Compliance | Outstanding Recalls | Yes/No | Red (if Yes) |
| Safety & Compliance | Warranty Status | Yes/No | Informational |
| Safety & Compliance | Service Book Present | Yes/No | Informational |
| Other | Key Fob Battery | Date/Mileage | Amber |

Organisations can enable/disable, reorder, and add custom items.

---

## Auto-Created Repair Items

When an MRI item is flagged (due, overdue, or "due if not replaced"), the system automatically creates a repair item.

### Repair Item Creation

| Field | Value |
|-------|-------|
| Description | MRI item name (e.g., "Timing Belt Replacement") |
| RAG Status | Inherited from MRI configuration |
| Source | `mri_scan` (stored in `source` field for internal traceability) |
| Category | Uncategorised (advisor assigns) |
| Pricing | Unpopulated (advisor prices up) |

### MRI Badge (Internal Only)

- **Advisor/Tech UI:** Show `[MRI]` badge on repair item line
- **Customer PDF:** No badge — appears as a normal repair item
- **Purpose:** Lets staff know origin without confusing customers

### Workflow

1. Advisor completes MRI Scan
2. System identifies items flagged as due/overdue
3. Repair items auto-created with appropriate RAG and `source: 'mri_scan'`
4. Items appear in Repair Items tab for pricing (with [MRI] badge)
5. Advisor prices and groups as normal
6. Customer PDF shows items without MRI badge

---

## Data Model Changes

### New Fields on `health_checks` Table

```sql
-- Check-in status and timestamps
status                    -- Add 'awaiting_checkin' to enum
checked_in_at             TIMESTAMPTZ     -- When check-in completed
checked_in_by             UUID            -- User who completed check-in

-- Check-in data
mileage_in                INTEGER         -- Odometer reading at check-in
customer_waiting          BOOLEAN         -- Auto from DMS or manual
time_required             TIME            -- When customer needs vehicle
key_location              TEXT            -- Free text or enum

-- Check-in notes
checkin_notes             TEXT            -- Advisor notes
checkin_notes_visible     BOOLEAN         -- Show to technician
```

### New Table: `mri_scan_results`

```sql
CREATE TABLE mri_scan_results (
    id                      UUID PRIMARY KEY,
    health_check_id         UUID REFERENCES health_checks(id),
    mri_item_id             UUID REFERENCES mri_items(id),
    
    -- Type A: Date/Mileage items
    next_due_date           DATE,
    next_due_mileage        INTEGER,
    due_if_not_replaced     BOOLEAN DEFAULT FALSE,
    
    -- Type B: Yes/No items
    yes_no_value            BOOLEAN,
    
    -- Common
    notes                   TEXT,
    rag_status              TEXT,           -- 'red', 'amber', 'green'
    repair_item_id          UUID,           -- Link to auto-created repair item
    
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
```

### New Table: `mri_items` (Configuration)

```sql
CREATE TABLE mri_items (
    id                      UUID PRIMARY KEY,
    organisation_id         UUID REFERENCES organisations(id),
    
    name                    TEXT NOT NULL,
    category                TEXT,           -- For grouping in UI
    item_type               TEXT NOT NULL,  -- 'date_mileage' or 'yes_no'
    
    -- RAG configuration
    severity_when_due       TEXT,           -- For date/mileage items
    severity_when_yes       TEXT,           -- For yes/no items
    severity_when_no        TEXT,           -- For yes/no items
    is_informational        BOOLEAN,        -- No RAG, just record
    
    -- Settings
    enabled                 BOOLEAN DEFAULT TRUE,
    sort_order              INTEGER,
    
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
```

### New Table: `organisation_checkin_settings`

```sql
CREATE TABLE organisation_checkin_settings (
    organisation_id         UUID PRIMARY KEY REFERENCES organisations(id),
    
    checkin_enabled         BOOLEAN DEFAULT FALSE,
    
    -- Optional field visibility
    show_mileage_in         BOOLEAN DEFAULT TRUE,
    show_time_required      BOOLEAN DEFAULT TRUE,
    show_key_location       BOOLEAN DEFAULT TRUE,
    
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
```

---

## UI Flow Summary

### Advisor Flow

1. **Dashboard**: See vehicle in "Awaiting Arrival"
2. **Mark Arrived**: Click button, status changes to `awaiting_checkin`
3. **Health Check View**: Opens on Check-In tab
4. **Complete Check-In Tab**: 
   - Confirm vehicle/customer details
   - Enter mileage, time required, key location (optional)
   - Note customer waiting status
   - Add notes (with technician visibility toggle)
5. **Complete MRI Scan**: 
   - Work through enabled items
   - Enter due dates/mileage or check "due if not replaced"
   - Answer yes/no items
6. **Click "Complete Check-In"**: 
   - Timestamp recorded
   - Flagged MRI items create repair items
   - Status changes to `created`
   - Vehicle moves to Technician Queue

### Technician Flow

1. **Kanban Board**: See vehicle in queue
2. **Health Check View**: 
   - Check-In tab visible (read-only) - see notes if marked visible
   - MRI Scan tab visible (read-only) - see flagged items
3. **Inspection**: Complete as normal
4. **Repair Items**: See MRI-generated items alongside inspection findings

---

## Implementation Phases

### Phase 1: Foundation
- Add `awaiting_checkin` status to workflow
- Organisation setting to enable/disable
- Basic Check-In tab UI (vehicle/customer confirmation, notes)
- Status transition logic

**Estimate:** 20-30 iterations

### Phase 2: MRI Configuration
- MRI items configuration tables and API
- Organisation settings UI for MRI items
- Default item seeding on feature enable

**Estimate:** 25-35 iterations

### Phase 3: MRI Scan UI
- MRI Scan interface on Check-In tab
- Date/mileage item input
- Yes/no item input
- RAG status display

**Estimate:** 25-35 iterations

### Phase 4: Auto-Creation & Integration
- Auto-create repair items from flagged MRI results
- MRI Scan tab (read-only view for techs)
- Source indicators on repair items
- PDF report integration (MRI section)

**Estimate:** 20-30 iterations

### Phase 5: Polish & Refinements
- Dashboard updates for `awaiting_checkin` status
- Reporting/analytics for check-in times
- Bulk operations consideration
- Edge case handling

**Estimate:** 15-20 iterations

**Total Estimate:** 105-150 iterations

---

## Resolved Design Decisions

### 1. Kanban Visual Treatment (No New Column)

Keep the existing 5-column Kanban layout. Vehicles in `awaiting_checkin` status appear in the **Technician Queue** column but with distinct visual treatment:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TECHNICIAN QUEUE                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🔴 AB12 CDE                                    CHECK-IN REQUIRED    │   │
│  │ BMW 3 Series                                                        │   │
│  │ John Smith                                     Arrived: 14:32       │   │
│  │                                                                     │   │
│  │ Background: Light red/pink tint (#FEF2F2 or similar)                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ CD34 EFG                                       ✓ Checked in         │   │
│  │ Ford Focus                                                          │   │
│  │ Jane Doe                                       Ready to assign      │   │
│  │                                                                     │   │
│  │ Background: Normal white/default                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Visual indicators for `awaiting_checkin`:**
- Light red/pink background tint
- "CHECK-IN REQUIRED" badge
- Cannot be assigned to technician (drag disabled, or shows warning)

**Dashboard Section:**

Additionally, the Dashboard shows a dedicated "Check-In Required" section:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CHECK-IN REQUIRED                                                 3 vehicles│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🔴 AB12 CDE    BMW 3 Series       John Smith      14:32  ⚠️ 25 mins       │
│     CD34 EFG    Ford Focus         Jane Doe        14:45  12 mins          │
│     EF56 GHI    Audi A4            Bob Wilson      14:51  6 mins           │
│                                                                             │
│  ⚠️ = Over 20 minute threshold                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. MRI on PDF Report (Integrated)

MRI-flagged items appear as **normal repair items** on the customer-facing PDF. No separate MRI section.

**On PDF:** Indistinguishable from inspection findings — just another repair item with RAG status.

**On Advisor/Tech UI:** "MRI" badge shows origin for internal reference:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REPAIR ITEMS                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🔴 Timing Belt Replacement                                    [MRI]        │
│     Due if not already replaced                                             │
│     Labour: £180.00  Parts: £95.00  Total: £275.00                         │
│                                                                             │
│  🔴 Front Brake Pads                                                        │
│     Worn below minimum thickness (2mm remaining)                            │
│     Labour: £45.00  Parts: £89.00  Total: £134.00                          │
│                                                                             │
│  🟠 Coolant Flush                                              [MRI]        │
│     Approaching service interval                                            │
│     Labour: £65.00  Parts: £25.00  Total: £90.00                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The `[MRI]` badge is **not shown** on the customer PDF — purely internal.

---

### 3. Partial Check-In (Save & Return)

Advisors can save progress and return later. Check-in does not need to be completed in one session.

**Implementation:**
- Auto-save as fields are completed
- "Save Progress" button available
- Status remains `awaiting_checkin` until "Complete Check-In" clicked
- MRI scan can be partially completed
- Visual indicator shows completion progress (e.g., "3 of 8 MRI items checked")

---

### 4. Check-In Timeout Alert (20 Minutes)

If a vehicle remains in `awaiting_checkin` for more than **20 minutes**, trigger an alert.

**Alert behaviour:**
- Dashboard "Check-In Required" section shows ⚠️ warning icon
- Time elapsed shown in amber/red after threshold
- Optional: Browser notification to advisors (if notifications enabled)
- Optional: Highlight in Kanban card

**Escalation display:**

| Time in Check-In | Visual Treatment |
|------------------|------------------|
| 0-20 minutes | Normal, shows elapsed time |
| 20+ minutes | ⚠️ Warning icon, amber text |
| 45+ minutes | 🔴 Critical, red text (optional second threshold) |

---

## Additional Data Model Updates

Based on these decisions, add to `health_checks` table:

```sql
-- Check-in timing for alerts
arrived_at                TIMESTAMPTZ     -- When "Mark Arrived" clicked (for timeout calc)
```

Note: `arrived_at` may already exist. The timeout is calculated as: `NOW() - arrived_at` while status is `awaiting_checkin`.

### Repair Items Table Update

Add a `source` field to track where repair items originated:

```sql
-- Add to repair_items table
source                    TEXT            -- 'inspection', 'mri_scan', 'manual', 'dms_prebooked'
```

This enables the [MRI] badge display and future reporting on item origins.
