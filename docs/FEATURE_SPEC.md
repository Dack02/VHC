# Repair Item Outcome Tracking

## Feature Specification

**Version:** 1.0  
**Date:** January 2026  
**Status:** Ready for Implementation

---

## Overview

Each repair item in a Vehicle Health Check (VHC) requires outcome tracking before the health check can be completed. Advisors must action every repair item/group with one of four outcomes: **Authorised**, **Deferred**, **Declined**, or **Deleted**.

This feature adds a visual action button to each repair line that reflects its current state and enables advisors to record customer decisions efficiently.

---

## Visual States

The action button is a circular indicator positioned at the right side of each repair item row.

| State | Circle Colour | Icon | Meaning |
|-------|---------------|------|---------|
| **Incomplete** | Light Grey | × | Labour and/or parts not yet added |
| **Ready** | Purple | ! | Labour & parts complete; awaiting customer decision |
| **Authorised** | Blue | ✓ | Customer approved the repair |
| **Deferred** | Blue | 📅 | Scheduled for a future date |
| **Declined** | Blue | ✗ | Customer said no |
| **Deleted** | *(Row hidden)* | — | Removed from quote (tech error, duplicate, etc.) |

---

## State Transitions

```
┌─────────────┐
│  INCOMPLETE │  (Grey × button, disabled)
│  L&P needed │
└──────┬──────┘
       │ Labour + Parts complete
       ▼
┌─────────────┐
│    READY    │  (Purple ! button, clickable)
│  Awaiting   │
│  decision   │
└──────┬──────┘
       │ Advisor/Customer actions
       ▼
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐
│  │AUTHORISED │  │ DEFERRED │  │ DECLINED │  │ DELETED │
│  │  Blue ✓   │  │  Blue 📅  │  │  Blue ✗  │  │ Hidden  │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘
│        │             │             │             │
│        └─────────────┴─────────────┴─────────────┘
│                      │
│                      ▼ Reset option
│               ┌─────────────┐
│               │    READY    │
│               └─────────────┘
└─────────────────────────────────────────────────────┘
```

---

## User Interface

### Action Button Position

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Engine Oil Level                    □ MOT   £0.00  £68.00  £81.60    (●)   │
│                                             Parts  Labour  Total    GREY   │
├─────────────────────────────────────────────────────────────────────────────┤
│ Suspension Group Test  [GROUP(2)]   □ MOT   £0.00  £170.00 £204.00   (●)   │
│                                             Parts  Labour  Total   PURPLE  │
├─────────────────────────────────────────────────────────────────────────────┤
│ Battery Condition                   □ MOT   £0.00  £85.00  £102.00   (●)   │
│                                             Parts  Labour  Total    BLUE   │
│                                                              Authorised ✓   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Dropdown Menu (Ready State)

When clicking a **purple** (ready) button:

```
┌──────────────────────┐
│ ✓ Authorise          │
│ 📅 Defer...          │
│ ✗ Decline...         │
│ 🗑 Delete...          │
└──────────────────────┘
```

### Dropdown Menu (Actioned State)

When clicking a **blue** (actioned) button:

```
┌──────────────────────┐
│ ↺ Reset              │
└──────────────────────┘
```

### Hover Tooltip (Actioned Items)

Shows contextual information:
- Who set the outcome (advisor name or "Online")
- When (date/time)
- Source (manual or online)
- For deferred: the scheduled date
- For declined: the reason selected

Example: *"Authorised online by customer - 18 Jan 2026, 14:32"*

---

## Outcome Actions

### Authorise

- Adds repair to the authorised work list
- Records: advisor/source, timestamp
- Button turns blue with ✓ icon

### Defer

- Opens calendar date picker modal
- Records: deferred date, optional notes
- Button turns blue with 📅 icon

**Defer Modal:**
```
┌─────────────────────────────────────────────────────────────┐
│ Defer Repair                                           ✕    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Item: Suspension Group Test                                 │
│                                                             │
│ Defer until:                                                │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 📅  Select date...                                      ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ Notes (optional):                                           │
│ ┌─────────────────────────────────────────────────────────┐│
│ │                                                         ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│              [Cancel]                    [Defer]            │
└─────────────────────────────────────────────────────────────┘
```

### Decline

- Opens modal with reason selection
- Requires reason from predefined list
- Notes required if "Other" selected
- Button turns blue with ✗ icon

**Decline Modal:**
```
┌─────────────────────────────────────────────────────────────┐
│ Decline Repair                                         ✕    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Item: Suspension Group Test                                 │
│                                                             │
│ Reason: *                                                   │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Select reason...                                      ▼ ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ Notes (required if "Other"):                                │
│ ┌─────────────────────────────────────────────────────────┐│
│ │                                                         ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│              [Cancel]                   [Decline]           │
└─────────────────────────────────────────────────────────────┘
```

**Default Declined Reasons:**
- Too expensive
- Will do elsewhere
- Not needed right now
- Getting second opinion
- Vehicle being sold/scrapped
- Already arranged with another garage
- Other *(system reason, cannot be deleted)*

### Delete

- Opens modal with reason selection
- Soft deletes the item (hidden from view)
- Used for tech errors, duplicates, etc.

**Delete Modal:**
```
┌─────────────────────────────────────────────────────────────┐
│ Delete Repair Item                                     ✕    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ⚠️ This will remove the item from the health check.        │
│                                                             │
│ Item: Engine Oil Level                                      │
│                                                             │
│ Reason: *                                                   │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Select reason...                                      ▼ ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ Notes (required if "Other"):                                │
│ ┌─────────────────────────────────────────────────────────┐│
│ │                                                         ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│              [Cancel]                   [Delete]            │
└─────────────────────────────────────────────────────────────┘
```

**Default Deleted Reasons:**
- Added in error
- Duplicate entry
- Customer requested removal before quote
- Other *(system reason, cannot be deleted)*

### Reset

- Available on any actioned (blue) item
- Reverts item back to "Ready" state
- Clears outcome data but logs who reset
- Any advisor can reset

---

## Bulk Actions

### Select All

A "Select All" checkbox allows selecting multiple ready items for bulk actioning.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ☑ Select All                                         3 items selected   │
│                                                                         │
│ Bulk Actions: [Authorise All] [Defer All...] [Decline All...]          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Use Case:** Customer declines all items—advisor can select all and decline in one action.

---

## Group Behaviour

- **One action button per group** (not per child item)
- All items in a group share the same outcome
- Groups are treated as all-or-nothing for customer approval

---

## Completion Enforcement

**Rule:** A health check cannot be marked as "Completed" until all repair items have an outcome assigned.

- Items in "Incomplete" or "Ready" state block completion
- Deleted items are excluded from this check (already actioned)
- System displays count of pending items if completion attempted prematurely

**Blocked States:**
- `incomplete` - Labour/parts not complete
- `ready` - Awaiting customer decision

**Actioned States (allow completion):**
- `authorised`
- `deferred`
- `declined`
- `deleted`

---

## Customer Portal Integration

When customers authorise or decline repairs online:

| Customer Action | System Response |
|-----------------|-----------------|
| Authorises item | Sets `outcome_status = 'authorised'`, `outcome_source = 'online'` |
| Declines item | Sets `outcome_status = 'declined'`, `outcome_source = 'online'` |

**Notes:**
- Online declines may not have a `declined_reason_id` (customer didn't select a reason)
- Hover tooltip shows "Authorised online by customer" with timestamp

---

## Admin Configuration

### Settings > Declined Reasons

Organisations can manage their declined reasons list:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Declined Reasons                                          [+ Add New]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ REASON                                    │ ACTIONS                     │
│ ──────────────────────────────────────────┼──────────────────────────── │
│ Too expensive                             │ [Edit] [Delete]             │
│ Will do elsewhere                         │ [Edit] [Delete]             │
│ Not needed right now                      │ [Edit] [Delete]             │
│ Getting second opinion                    │ [Edit] [Delete]             │
│ Vehicle being sold/scrapped               │ [Edit] [Delete]             │
│ Already arranged with another garage      │ [Edit] [Delete]             │
│ Other                                     │ [Edit] (system - no delete) │
└─────────────────────────────────────────────────────────────────────────┘
```

### Settings > Deleted Reasons

Same pattern as Declined Reasons.

---

## Future Considerations

1. **Follow-up Module:** Deferred items will integrate with a future follow-up/reminder system
2. **Reporting:** Outcome analytics (decline reasons, deferral patterns)
3. **Audit History:** Track all outcome changes over time
