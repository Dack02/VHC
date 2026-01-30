# MRI Implementation Update - v2 Corrections

## Overview

This document corrects a misunderstanding in the initial MRI implementation. Use this to fix the current implementation.

**Problem:** MRI items were added to the Labour tab as a separate checklist. This is incorrect — they bypass the customer communication flow entirely.

**Solution:** MRI-flagged items must create **repair items** in the Health Check tab, under a new category called "Manufacturer Recommended Items".

---

## Current (Incorrect) Implementation

```
MRI Scan completed
    ↓
Items appear in Labour tab as "Labour Checklist"
    ↓
❌ NOT sent to customer
❌ NOT part of health check findings
❌ RAG status not visible
❌ Bypasses authorisation flow
```

---

## Correct Implementation

```
MRI Scan completed
    ↓
Flagged items create REPAIR ITEMS
    ↓
Appear in Health Check tab under "Manufacturer Recommended Items" category
    ↓
✅ RAG status visible (coloured dot)
✅ Flows to customer PDF
✅ Customer can authorise/decline
    ↓
Once authorised → priced up with Labour + Parts
```

---

## Key Concept

**Repair Item = Labour + Parts**

A repair item is a finding that:
1. Appears in Health Check tab (with RAG status)
2. Gets sent to customer on PDF
3. Customer authorises/defers/declines
4. Once authorised, gets priced with labour and parts

MRI items must follow this same flow — they are repair items, not a separate checklist.

---

## Required Changes

### 1. New Health Check Category

Create a new category in the Health Check tab:

**"Manufacturer Recommended Items"** (or "MRI - Service Items")

This category holds all repair items created from the MRI Scan.

```
Health Check Tab
├── Brakes
├── Steering & Suspension
├── Lights & Electrics
├── ... (other inspection categories)
└── Manufacturer Recommended Items    ← NEW
    ├── 🔴 Timing Belt Replacement
    ├── 🟠 Coolant Flush
    └── 🔴 Outstanding Recall - Airbag
```

### 2. MRI Creates Repair Items (Not Labour Checklist)

When MRI Scan is completed and items are flagged:

```typescript
// WRONG - Don't do this
createLabourChecklistItem({
  name: "Timing Belt",
  // ...
});

// CORRECT - Do this
createRepairItem({
  health_check_id: healthCheckId,
  category: "Manufacturer Recommended Items",  // or category_id for this new category
  description: "Timing Belt Replacement",
  rag_status: "red",  // From MRI item configuration
  source: "mri_scan",
  // ... other repair item fields
});
```

### 3. RAG Status Must Display

Repair items created from MRI must show the coloured RAG dot:
- 🔴 Red — urgent/safety
- 🟠 Amber — advisory/due soon
- 🟢 Green — OK (typically wouldn't create a repair item, but if recorded)

The RAG status comes from the MRI item configuration (set in organisation settings).

### 4. Remove Labour Checklist

The "Labour Checklist" shown in the screenshot should be removed. MRI items should not appear there.

If the Labour Checklist concept is needed for something else, that's separate — but MRI items don't belong there.

---

## Database/API Changes

### Ensure Category Exists

Either:
- **Option A:** Create a system category "Manufacturer Recommended Items" that exists for all orgs with MRI enabled
- **Option B:** Add to existing categories seed/setup when MRI is enabled

### Repair Item Creation

When creating repair items from MRI, ensure:

```sql
INSERT INTO repair_items (
  health_check_id,
  category_id,           -- "Manufacturer Recommended Items" category
  description,
  rag_status,            -- 'red', 'amber', 'green'
  source,                -- 'mri_scan'
  mri_scan_result_id,    -- Link back to MRI result (optional)
  -- ... standard repair item fields
)
```

### Remove Labour Checklist Table/Logic (if MRI-specific)

If a `labour_checklist` or similar was created for MRI items, this needs removing or repurposing.

---

## UI Changes

### Health Check Tab

1. Add "Manufacturer Recommended Items" category section
2. MRI-sourced repair items appear here with:
   - RAG coloured dot
   - Description
   - [MRI] badge (internal, not on PDF)
3. Advisor can edit/price these like any repair item

### Labour Tab

1. Remove the "Labour Checklist" that shows MRI items
2. MRI items only appear in Labour tab AFTER they've been priced (like normal repair items)

### Customer PDF

1. MRI items appear as normal repair items
2. Under "Manufacturer Recommended Items" section (or grouped with other findings)
3. RAG status shown
4. No [MRI] badge (customer doesn't need to know source)

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MRI SCAN                                    │
│                    (Advisor at Check-In)                            │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Item flagged as due?  │
                    └───────────────────────┘
                       │              │
                      Yes             No
                       │              │
                       ▼              ▼
            ┌──────────────────┐   (No action)
            │ Create REPAIR    │
            │ ITEM with:       │
            │ - RAG status     │
            │ - Category: MRI  │
            │ - Source: mri    │
            └──────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    HEALTH CHECK TAB                                 │
│         "Manufacturer Recommended Items" section                    │
│                                                                     │
│  🔴 Timing Belt Replacement                              [MRI]      │
│  🟠 Coolant Flush                                        [MRI]      │
└─────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CUSTOMER PDF                                     │
│                                                                     │
│  Manufacturer Recommended Items                                     │
│  ──────────────────────────────                                     │
│  🔴 Timing Belt Replacement                                         │
│     Timing belt is due for replacement based on age/mileage.        │
│                                                                     │
│  🟠 Coolant Flush                                                   │
│     Coolant system flush recommended.                               │
└─────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 CUSTOMER AUTHORISATION                              │
│                                                                     │
│  🔴 Timing Belt Replacement      [Authorise] [Defer] [Decline]      │
│  🟠 Coolant Flush                [Authorise] [Defer] [Decline]      │
└─────────────────────────────────────────────────────────────────────┘
                       │
                       ▼ (If authorised)
┌─────────────────────────────────────────────────────────────────────┐
│                    LABOUR & PARTS                                   │
│              (Pricing for authorised work)                          │
│                                                                     │
│  Timing Belt Replacement                                            │
│    Labour: 3.5 hrs @ £85/hr = £297.50                              │
│    Parts: Timing belt kit = £145.00                                 │
│    Total: £442.50                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Self-Tests After Fix

```bash
# 1. Complete an MRI Scan with flagged items

# 2. Verify repair items created (NOT labour checklist)
psql -c "SELECT description, rag_status, source, category_id FROM repair_items WHERE health_check_id = '{id}' AND source = 'mri_scan';"
# Expected: Items exist with rag_status and source='mri_scan'

# 3. Verify category is correct
psql -c "SELECT c.name FROM repair_items ri JOIN categories c ON ri.category_id = c.id WHERE ri.source = 'mri_scan';"
# Expected: "Manufacturer Recommended Items" or similar

# 4. UI Check - Health Check Tab:
#    - [ ] "Manufacturer Recommended Items" section visible
#    - [ ] MRI items appear there with RAG coloured dot
#    - [ ] [MRI] badge shown

# 5. UI Check - Labour Tab:
#    - [ ] "Labour Checklist" removed (or doesn't show MRI items)
#    - [ ] MRI items only appear after pricing

# 6. Generate PDF:
#    - [ ] MRI items appear as repair items
#    - [ ] RAG status shown
#    - [ ] Grouped under appropriate section

# 7. Authorisation flow:
#    - [ ] Customer can authorise/decline MRI items
#    - [ ] Authorised items can be priced with labour + parts
```

---

## Summary

| Aspect | Wrong (Current) | Correct (Fix) |
|--------|-----------------|---------------|
| Where MRI items appear | Labour tab checklist | Health Check tab as repair items |
| Category | None / Labour Checklist | "Manufacturer Recommended Items" |
| RAG status | Not showing | Coloured dot visible |
| Customer PDF | Not included | Included as normal findings |
| Authorisation | Bypassed | Normal auth flow |
| Pricing | Direct in Labour | After authorisation |

---

## Prompt for Fix

```
Read docs/MRI_UPDATE_v2.md - this documents a correction needed to the MRI implementation.

The current implementation incorrectly adds MRI items to a Labour Checklist. This bypasses the customer flow.

Fix required:
1. MRI-flagged items must create REPAIR ITEMS (not labour checklist items)
2. Create a new Health Check category: "Manufacturer Recommended Items"
3. Repair items appear in Health Check tab with RAG coloured dot
4. Remove the Labour Checklist that currently shows MRI items
5. MRI items flow through to customer PDF and authorisation like normal repair items

Run the self-tests in MRI_UPDATE_v2.md to verify the fix is complete.
```
