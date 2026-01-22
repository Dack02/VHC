# Line Completion Feature

## Overview

The Line Completion feature ensures that every repair item in a Vehicle Health Check (VHC) has a recorded customer decision before the health check can be closed. This provides full traceability of customer responses and prevents incomplete health checks from being finalised.

Each repair line displays a circular action button that reflects its current state and allows advisors to record the customer's decision efficiently.

---

## How It Works

### The Action Button

Every repair item row displays a circular button on the right side. The button's colour and icon indicate the item's current status:

| Colour | Icon | Status | Meaning |
|--------|------|--------|---------|
| Grey | × | Incomplete | Labour and/or parts not yet allocated |
| Purple | ! | Ready | Awaiting customer decision |
| Blue | ✓ | Authorised | Customer approved the repair |
| Blue | Calendar | Deferred | Scheduled for a future date |
| Blue | × | Declined | Customer said no |

**Deleted items** are hidden from view entirely.

---

## Status Flow

```
INCOMPLETE (Grey)
     │
     │ Complete Labour & Parts allocation
     ▼
READY (Purple)
     │
     │ Record customer decision
     ▼
┌────────────────────────────────────────┐
│  AUTHORISED  │  DEFERRED  │  DECLINED  │
│   (Blue ✓)   │ (Blue Cal) │  (Blue ×)  │
└────────────────────────────────────────┘
     │
     │ Reset (if needed)
     ▼
READY (Purple)
```

---

## Recording Customer Decisions

### Clicking the Button

**Grey (Incomplete) Button:**
- Click to see a limited menu
- Only "Delete" is available (for removing items added in error)
- A message explains that Labour & Parts must be completed first for full options

**Purple (Ready) Button:**
- Click to see the full action menu:
  - **Authorise** - Customer approved the work
  - **Defer** - Schedule for a future date
  - **Decline** - Customer said no
  - **Delete** - Remove from the health check

**Blue (Actioned) Button:**
- Click to see the Reset option
- Resetting returns the item to "Ready" status

### Authorise

When the customer approves a repair:
1. Click the purple button
2. Select "Authorise"
3. The button turns blue with a tick icon
4. The item is added to the authorised work list

### Defer

When the customer wants to delay the repair:
1. Click the purple button
2. Select "Defer..."
3. A modal appears with:
   - Quick select buttons (1 Month, 3 Months, 6 Months, 1 Year)
   - A date picker for custom dates
   - Optional notes field
4. Select a date and click "Defer"
5. The button turns blue with a calendar icon

### Decline

When the customer declines a repair:
1. Click the purple button
2. Select "Decline..."
3. A modal appears with:
   - A required reason dropdown
   - Optional notes (required if "Other" is selected)
4. Select a reason and click "Decline"
5. The button turns blue with an X icon

**Standard decline reasons include:**
- Too expensive
- Will do elsewhere
- Not needed right now
- Getting second opinion
- Vehicle being sold/scrapped
- Already arranged with another garage
- Other (requires notes)

### Delete

When an item needs to be removed (added in error, duplicate, etc.):
1. Click the button (grey or purple)
2. Select "Delete..."
3. A modal appears with:
   - A warning message
   - A required reason dropdown
   - Optional notes (required if "Other" is selected)
4. Select a reason and click "Delete"
5. The item is hidden from view

**Standard delete reasons include:**
- Added in error
- Duplicate entry
- Customer requested removal before quote
- Other (requires notes)

### Reset

To change a decision that's already been recorded:
1. Click the blue button
2. Select "Reset"
3. The item returns to "Ready" status (purple)
4. You can now record a new decision

---

## Bulk Actions

When multiple items need the same decision, you can action them together:

### Selecting Items

1. Items in "Ready" status show a purple checkbox
2. Click individual checkboxes to select specific items
3. Or use "Select All" to select all ready items

### Bulk Action Bar

When items are selected, a floating action bar appears at the bottom:
- Shows the count of selected items
- Provides bulk action buttons:
  - **Authorise All** - Approve all selected items
  - **Defer All** - Defer all selected items (opens date picker)
  - **Decline All** - Decline all selected items (opens reason picker)
- **Clear** button to deselect all

After a bulk action completes, the selection is automatically cleared.

---

## Hovering for Details

Hover over any actioned (blue) button to see:
- The recorded outcome (Authorised/Deferred/Declined)
- Who recorded it (advisor name or "Online" for customer portal)
- When it was recorded (date and time)
- For deferred items: the scheduled date
- For declined items: the reason selected

Example: *"Authorised by John Smith - 18 Jan 2026, 14:32"*

---

## Customer Portal Integration

When customers respond through the online portal:
- Approving an item sets it to "Authorised" with source "Online"
- Declining an item sets it to "Declined" with source "Online"
- The advisor view updates automatically
- Hover tooltips show "by customer online"

---

## Closing a Health Check

A health check cannot be closed until all repair items have an outcome recorded.

### What Blocks Closing?

- **Incomplete items** - Labour and/or parts not allocated
- **Ready items** - Awaiting customer decision

### What Allows Closing?

Items with any of these outcomes allow the health check to be closed:
- Authorised
- Deferred
- Declined
- Deleted

### Close Health Check Modal

When you attempt to close a health check:

1. If items are pending, the modal shows:
   - A count of pending items
   - A list of items needing attention
   - The "Close" button is disabled

2. If all items are actioned, the modal shows:
   - Summary statistics (authorised count, declined count, etc.)
   - A confirmation message
   - The "Close" button is enabled

---

## Group Behaviour

For grouped repair items:
- One action button appears per group (not per child item)
- All items in a group share the same outcome
- Groups are treated as all-or-nothing for customer decisions

---

## Admin Configuration

Organisations can customise their decline and delete reasons:

### Settings > Declined Reasons
- Add custom reasons for your business
- Edit existing reasons
- Deactivate reasons no longer needed
- "Other" is a system reason and cannot be deleted

### Settings > Deleted Reasons
- Add custom reasons for your business
- Edit existing reasons
- Deactivate reasons no longer needed
- "Other" is a system reason and cannot be deleted

---

## Summary

The Line Completion feature ensures:

1. **Every repair item gets a decision** - No items are left unactioned
2. **Full traceability** - Know who recorded each decision and when
3. **Customer portal sync** - Online responses are captured automatically
4. **Efficient bulk actions** - Handle multiple items with the same decision quickly
5. **Soft delete with audit trail** - Removed items are hidden but kept for records
6. **Completion enforcement** - Health checks can only close when fully actioned
