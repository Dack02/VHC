# Repair Item Outcome Tracking

## Implementation Plan for Claude Code

**Total Estimate:** 100–140 iterations  
**Prerequisites:** Existing `repair_items` table, user authentication, organization context

---

## Database Schema

### New Tables

```sql
-- Declined reasons (per organization)
CREATE TABLE declined_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  reason VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,  -- System defaults can't be deleted
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, reason)
);

-- Deleted reasons (per organization)
CREATE TABLE deleted_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  reason VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, reason)
);

-- Indexes
CREATE INDEX idx_declined_reasons_org ON declined_reasons(organization_id);
CREATE INDEX idx_deleted_reasons_org ON deleted_reasons(organization_id);
```

### Seed Data

**Declined Reasons (seeded on org creation):**
- Too expensive
- Will do elsewhere
- Not needed right now
- Getting second opinion
- Vehicle being sold/scrapped
- Already arranged with another garage
- Other *(is_system = true)*

**Deleted Reasons (seeded on org creation):**
- Added in error
- Duplicate entry
- Customer requested removal before quote
- Other *(is_system = true)*

### Alter repair_items Table

```sql
-- Outcome tracking fields
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS outcome_status VARCHAR(20) DEFAULT 'incomplete';
  -- Values: 'incomplete', 'ready', 'authorised', 'deferred', 'declined', 'deleted'

ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS outcome_set_by UUID REFERENCES users(id);
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS outcome_set_at TIMESTAMPTZ;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS outcome_source VARCHAR(20);
  -- Values: 'manual', 'online'

-- Deferred fields
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deferred_until DATE;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deferred_notes TEXT;

-- Declined fields
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS declined_reason_id UUID REFERENCES declined_reasons(id);
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS declined_notes TEXT;

-- Deleted fields (soft delete with reason)
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deleted_reason_id UUID REFERENCES deleted_reasons(id);
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deleted_notes TEXT;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- Index for outcome queries
CREATE INDEX idx_repair_items_outcome ON repair_items(outcome_status);
```

---

## API Endpoints

### Declined Reasons (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/declined-reasons` | List org's declined reasons |
| POST | `/api/v1/declined-reasons` | Create new reason |
| PATCH | `/api/v1/declined-reasons/:id` | Update reason |
| DELETE | `/api/v1/declined-reasons/:id` | Soft delete (is_active=false) |

### Deleted Reasons (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/deleted-reasons` | List org's deleted reasons |
| POST | `/api/v1/deleted-reasons` | Create new reason |
| PATCH | `/api/v1/deleted-reasons/:id` | Update reason |
| DELETE | `/api/v1/deleted-reasons/:id` | Soft delete (is_active=false) |

### Repair Item Outcomes

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/repair-items/:id/authorise` | `{ notes?: string }` | Mark as authorised |
| POST | `/api/v1/repair-items/:id/defer` | `{ deferred_until: date, notes?: string }` | Mark as deferred |
| POST | `/api/v1/repair-items/:id/decline` | `{ declined_reason_id: uuid, notes?: string }` | Mark as declined |
| POST | `/api/v1/repair-items/:id/delete` | `{ deleted_reason_id: uuid, notes?: string }` | Soft delete with reason |
| POST | `/api/v1/repair-items/:id/reset` | — | Reset to 'ready' state |

### Bulk Outcomes

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/repair-items/bulk-authorise` | `{ repair_item_ids: uuid[], notes?: string }` | Bulk authorise |
| POST | `/api/v1/repair-items/bulk-defer` | `{ repair_item_ids: uuid[], deferred_until: date, notes?: string }` | Bulk defer |
| POST | `/api/v1/repair-items/bulk-decline` | `{ repair_item_ids: uuid[], declined_reason_id: uuid, notes?: string }` | Bulk decline |

### Health Check Completion

| Method | Endpoint | Response | Description |
|--------|----------|----------|-------------|
| GET | `/api/v1/health-checks/:id/can-complete` | `{ canComplete: boolean, pendingItems: number, message?: string }` | Check if completable |

---

## Business Logic

### Outcome Status Calculation

```typescript
function calculateOutcomeStatus(repairItem: RepairItem): OutcomeStatus {
  // If soft deleted
  if (repairItem.deleted_at) return 'deleted';
  
  // If has an explicit outcome
  if (repairItem.outcome_status === 'authorised') return 'authorised';
  if (repairItem.outcome_status === 'deferred') return 'deferred';
  if (repairItem.outcome_status === 'declined') return 'declined';
  
  // Check if ready (labour AND parts complete)
  const labourComplete = repairItem.labour_status === 'complete' || repairItem.no_labour_required;
  const partsComplete = repairItem.parts_status === 'complete' || repairItem.no_parts_required;
  
  if (labourComplete && partsComplete) return 'ready';
  
  return 'incomplete';
}
```

### Completion Check

```typescript
async function canCompleteHealthCheck(healthCheckId: string): Promise<CompletionCheck> {
  const { data: repairItems } = await supabase
    .from('repair_items')
    .select('id, outcome_status')
    .eq('health_check_id', healthCheckId)
    .is('deleted_at', null);  // Exclude deleted items
  
  const pendingItems = repairItems.filter(
    item => item.outcome_status === 'incomplete' || item.outcome_status === 'ready'
  );
  
  if (pendingItems.length > 0) {
    return {
      canComplete: false,
      pendingItems: pendingItems.length,
      message: `Cannot complete: ${pendingItems.length} repair item(s) need an outcome`
    };
  }
  
  return { canComplete: true, pendingItems: 0 };
}
```

### Customer Portal Sync

```typescript
// When customer authorises online
async function handleCustomerAuthorise(repairItemId: string) {
  await supabase
    .from('repair_items')
    .update({
      outcome_status: 'authorised',
      customer_approved: true,
      customer_approved_at: new Date().toISOString(),
      outcome_set_at: new Date().toISOString(),
      outcome_source: 'online'
    })
    .eq('id', repairItemId);
}

// When customer declines online
async function handleCustomerDecline(repairItemId: string) {
  await supabase
    .from('repair_items')
    .update({
      outcome_status: 'declined',
      customer_approved: false,
      outcome_set_at: new Date().toISOString(),
      outcome_source: 'online'
      // declined_reason_id left null for online declines
    })
    .eq('id', repairItemId);
}
```

---

## UI Components

### OutcomeButton Component

```tsx
interface OutcomeButtonProps {
  repairItem: RepairItem;
  onAuthorise: () => void;
  onDefer: () => void;
  onDecline: () => void;
  onDelete: () => void;
  onReset: () => void;
}

// Visual specifications:
// - Size: ~32px diameter circle
// - Position: Right side of each repair item row
// 
// States:
// - incomplete: bg-gray-200, × icon, disabled (not clickable)
// - ready: bg-purple-500, ! icon, clickable → shows action dropdown
// - authorised: bg-blue-500, ✓ icon, clickable → shows Reset option
// - deferred: bg-blue-500, calendar icon, clickable → shows Reset option
// - declined: bg-blue-500, ✗ icon, clickable → shows Reset option
// - deleted: row hidden from view
//
// Hover tooltip displays:
// - Who set the outcome (advisor name or "Online")
// - When (date/time)
// - For deferred: the scheduled date
// - For declined: the reason
```

### Required Modals

1. **DeferModal** - Date picker + optional notes
2. **DeclineModal** - Reason dropdown (required) + notes (required if "Other")
3. **DeleteModal** - Reason dropdown (required) + notes (required if "Other") + warning message

### Bulk Action Bar

```tsx
// Appears when items are selected
interface BulkActionBarProps {
  selectedCount: number;
  onAuthoriseAll: () => void;
  onDeferAll: () => void;
  onDeclineAll: () => void;
  onClearSelection: () => void;
}
```

### Admin Settings Pages

1. **Settings > Declined Reasons** - CRUD table
2. **Settings > Deleted Reasons** - CRUD table

Both follow the same pattern with Edit/Delete actions (system reasons cannot be deleted).

---

## Implementation Phases

### Phase 1: Database & Reasons Admin
**Estimate:** 15–20 iterations

- [x] Create `declined_reasons` table with seed data
- [x] Create `deleted_reasons` table with seed data
- [x] Add outcome columns to `repair_items` table
- [x] Create API endpoints for `declined_reasons` CRUD
- [x] Create API endpoints for `deleted_reasons` CRUD
- [x] Create Settings > Declined Reasons page
- [x] Create Settings > Deleted Reasons page
- [x] Add navigation links in settings sidebar
- [x] Seed reasons on organization creation (or first access)

### Phase 2: Outcome API Endpoints
**Estimate:** 15–20 iterations

- [x] POST `/repair-items/:id/authorise`
- [x] POST `/repair-items/:id/defer`
- [x] POST `/repair-items/:id/decline`
- [x] POST `/repair-items/:id/delete` (soft delete)
- [x] POST `/repair-items/:id/reset`
- [x] POST `/repair-items/bulk-authorise`
- [x] POST `/repair-items/bulk-defer`
- [x] POST `/repair-items/bulk-decline`
- [x] GET `/health-checks/:id/can-complete`

### Phase 3: OutcomeButton Component
**Estimate:** 15–20 iterations

- [x] Create OutcomeButton component with all visual states
- [x] Implement dropdown menu for ready state
- [x] Implement Reset option for actioned states
- [x] Add hover tooltip with outcome details
- [x] Position button at end of repair item rows
- [x] Handle group items (single button for group)

### Phase 4: Outcome Modals
**Estimate:** 15–20 iterations

- [x] Defer modal with date picker
- [x] Decline modal with reason dropdown
- [x] Delete modal with reason dropdown + warning
- [x] Validation (notes required for "Other")
- [x] Loading states and error handling
- [x] Connect modals to API endpoints

### Phase 5: Bulk Actions
**Estimate:** 10–15 iterations

- [x] Select All checkbox on Health Check tab
- [x] Individual item selection checkboxes
- [x] Show "X items selected" count
- [x] Bulk action bar with Authorise/Defer/Decline buttons
- [x] Bulk modals (same as individual but for multiple items)
- [x] Clear selection after bulk action

### Phase 6: Completion Enforcement
**Estimate:** 10–15 iterations

- [x] Add `canComplete` check to health check status update endpoint
- [x] Show warning when trying to complete with pending items
- [x] Display pending count in UI
- [x] Block "Mark Complete" button if pending items exist
- [x] Show list of items needing attention

### Phase 7: Customer Portal Sync
**Estimate:** 10–15 iterations

- [x] Update customer authorise handler to set `outcome_status`
- [x] Update customer decline handler to set `outcome_status`
- [x] Set `outcome_source = 'online'` for customer actions
- [x] Ensure advisor view updates when customer acts
- [ ] Real-time sync if using subscriptions (optional - not implemented)

**Completed:** 2026-01-21

### Phase 8: Polish & Testing
**Estimate:** 10–15 iterations

- [x] Test all outcome flows end-to-end
- [x] Ensure deleted items hidden from customer view
- [x] Audit logging for outcome changes
- [x] Mobile responsive modals and buttons
- [x] Edge case handling (concurrent edits, etc.)

**Completed:** 2026-01-21

---

## Claude Code Prompts

### Phase 1 Prompt

```
Implement Repair Item Outcome Tracking - Phase 1: Database & Reasons Admin.

Context:
- Each repair item needs outcome tracking: incomplete → ready → authorised/deferred/declined/deleted
- Advisors must action every item before health check can be completed
- Need admin UI for managing declined and deleted reasons

Tasks:

1. Create declined_reasons table:
   - id, organization_id, reason, description, is_active, is_system, sort_order, timestamps
   - Seed defaults: 'Too expensive', 'Will do elsewhere', 'Not needed right now', 
     'Getting second opinion', 'Vehicle being sold/scrapped', 
     'Already arranged with another garage', 'Other'
   - 'Other' should have is_system=true (can't be deleted)

2. Create deleted_reasons table:
   - Same structure as declined_reasons
   - Seed defaults: 'Added in error', 'Duplicate entry', 
     'Customer requested removal before quote', 'Other'

3. Add columns to repair_items table:
   - outcome_status VARCHAR(20) DEFAULT 'incomplete'
   - outcome_set_by UUID REFERENCES users(id)
   - outcome_set_at TIMESTAMPTZ
   - outcome_source VARCHAR(20) -- 'manual', 'online'
   - deferred_until DATE
   - deferred_notes TEXT
   - declined_reason_id UUID REFERENCES declined_reasons(id)
   - declined_notes TEXT
   - deleted_reason_id UUID REFERENCES deleted_reasons(id)
   - deleted_notes TEXT
   - deleted_at TIMESTAMPTZ
   - deleted_by UUID REFERENCES users(id)

4. Create API endpoints:
   - GET/POST/PATCH/DELETE for /api/v1/declined-reasons
   - GET/POST/PATCH/DELETE for /api/v1/deleted-reasons

5. Create Settings pages:
   - Settings > Declined Reasons - table with CRUD
   - Settings > Deleted Reasons - table with CRUD
   - Add nav links in settings sidebar

6. Seed reasons on org creation (or first access)
```

### Phase 2 Prompt

```
Implement Repair Item Outcome Tracking - Phase 2: Outcome API Endpoints.

Context:
- Phase 1 complete: declined_reasons and deleted_reasons tables exist
- repair_items table has outcome columns
- Now need endpoints to action repair items

Tasks:

1. POST /api/v1/repair-items/:id/authorise
   - Body: { notes?: string }
   - Sets outcome_status='authorised', outcome_set_by, outcome_set_at, outcome_source='manual'

2. POST /api/v1/repair-items/:id/defer
   - Body: { deferred_until: date, notes?: string }
   - Sets outcome_status='deferred', deferred_until, deferred_notes

3. POST /api/v1/repair-items/:id/decline
   - Body: { declined_reason_id: uuid, notes?: string }
   - Validates declined_reason_id exists and belongs to org
   - Sets outcome_status='declined', declined_reason_id, declined_notes

4. POST /api/v1/repair-items/:id/delete
   - Body: { deleted_reason_id: uuid, notes?: string }
   - Soft delete: sets deleted_at, deleted_by, deleted_reason_id, deleted_notes
   - Sets outcome_status='deleted'

5. POST /api/v1/repair-items/:id/reset
   - Clears all outcome fields, sets outcome_status back to 'ready'
   - Logs who performed the reset

6. Bulk endpoints:
   - POST /api/v1/repair-items/bulk-authorise
   - POST /api/v1/repair-items/bulk-defer  
   - POST /api/v1/repair-items/bulk-decline
   - All accept { repair_item_ids: uuid[], ...relevant fields }

7. GET /api/v1/health-checks/:id/can-complete
   - Returns { canComplete: boolean, pendingItems: number, message?: string }
   - Checks all non-deleted items have outcome set
```

### Phase 3 Prompt

```
Implement Repair Item Outcome Tracking - Phase 3: OutcomeButton Component.

Context:
- API endpoints exist for all outcome actions
- Need visual button component for each repair item row

Tasks:

1. Create OutcomeButton component:
   - Circular button (~32px diameter)
   - Position: right side of repair item row, after total price
   
2. Visual states:
   - incomplete: bg-gray-200, × icon, disabled
   - ready: bg-purple-500, ! icon, clickable
   - authorised: bg-blue-500, ✓ icon
   - deferred: bg-blue-500, calendar icon
   - declined: bg-blue-500, ✗ icon
   
3. Dropdown for ready state:
   - ✓ Authorise
   - 📅 Defer...
   - ✗ Decline...
   - 🗑 Delete...
   
4. Dropdown for actioned states (blue):
   - ↺ Reset
   
5. Hover tooltip showing:
   - Who set outcome (advisor name or "Online")
   - When (formatted date/time)
   - For deferred: scheduled date
   - For declined: reason text

6. Integrate into repair items list
   - Single button per group (not per child)
   - Hidden for deleted items (row should be hidden)
```

---

## Testing Checklist

- [x] Can create/edit/delete declined reasons (non-system)
- [x] Cannot delete system reasons ("Other")
- [x] Can authorise a ready item
- [x] Can defer with date selection
- [x] Can decline with reason selection
- [x] Notes required when "Other" reason selected
- [x] Can soft delete with reason
- [x] Can reset an actioned item
- [x] Bulk actions work for multiple items
- [x] Cannot complete health check with pending items
- [x] Can complete health check when all items actioned
- [x] Customer online auth syncs to outcome_status
- [x] Deleted items hidden from view
- [x] Group items have single action button
- [x] Tooltips display correct information
