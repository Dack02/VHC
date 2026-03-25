# T-Card Workshop Board — Feature Specification

**Author:** Claude (AI) + Leo
**Date:** 2026-03-25
**Status:** Draft
**App:** `apps/web` (Web Dashboard)

---

## 1. Overview

A Kanban-style "T-Card" workshop management board that gives service advisors and workshop controllers a real-time, visual overview of all jobs across technicians for the current and upcoming days.

The board replaces the physical T-Card boards found in most workshops, providing drag-and-drop job allocation, live status tracking, capacity visibility, and configurable job statuses — all within the existing VHC web dashboard.

### 1.1 Goals

- **Visual job allocation:** Drag job cards from "Due In" to technician columns
- **At-a-glance workshop state:** See every job, its status, and who's working on it
- **Capacity planning:** See each technician's allocated hours vs available hours
- **Configurable statuses:** Workshops define their own operational job statuses (e.g. "Parts on Order", "Awaiting Auth")
- **Reduce missed jobs:** Surface ageing vehicles, promise time breaches, and blocked work

### 1.2 Users

| Role | Access |
|------|--------|
| `org_admin` / `site_admin` | Full access — manage columns, drag cards, configure statuses |
| `service_advisor` | Full access — manage columns, drag cards |
| `technician` | Read-only (future: mobile view of own column) |

---

## 2. Board Layout

```
┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┬──────────────┐
│   DUE IN    │  CHECKED IN │  TECH: Dave  │  TECH: Mike  │  TECH: Sam  │  COMPLETED   │
│  (auto)     │  (unassigned)│  5.2/8.0 hrs│  3.0/8.0 hrs│  7.5/8.0 hrs│              │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────┼──────────────┤
│ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │ ┌──────────┐ │
│ │ AB12 CDE│ │ │ FG34 HIJ│ │ │ KL56 MNO│ │ │ QR78 STU│ │ │ VW90 XYZ│ │ │ AA11 BBB │ │
│ │ J Smith │ │ │ A Jones │ │ │ B Brown │ │ │ C Davis │ │ │ D Wilson│ │ │ E Taylor │ │
│ │ BMW 320d│ │ │ Audi A4 │ │ │ Ford Foc│ │ │ VW Golf │ │ │ Merc C20│ │ │ Kia Ceed │ │
│ │ 2.5 hrs │ │ │ 1.0 hrs │ │ │ 3.0 hrs │ │ │ 1.5 hrs │ │ │ 4.0 hrs │ │ │ 1.0 hrs  │ │
│ │ [WYW]   │ │ │ [LOAN]  │ │ │ [MOT]   │ │ │ [SVC]   │ │ │ [PARTS] │ │ │ [DONE]   │ │
│ └─────────┘ │ └─────────┘ │ └─────────┘ │ └─────────┘ │ └─────────┘ │ └──────────┘ │
│ ┌─────────┐ │             │ ┌─────────┐ │             │ ┌─────────┐ │              │
│ │ ...     │ │             │ │ ...     │ │             │ │ ...     │ │              │
│ └─────────┘ │             │ └─────────┘ │             │ └─────────┘ │              │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┴──────────────┘
```

### 2.1 Column Types

| Column | Behaviour | Auto-populated? |
|--------|-----------|----------------|
| **Due In** | Bookings from DMS import where `status = 'awaiting_arrival'` and `due_date` is within the selected date range. Fixed column, always first. | Yes — from DMS import |
| **Checked In** | Vehicles that have arrived (`status = 'awaiting_checkin'` or `'created'`) but not yet assigned to a technician. Fixed column, always second. | Yes — when "Mark Arrived" is used |
| **Technician columns** | One per active technician at the site. User-created and reorderable. Shows allocated/available hours. | Manual — drag cards here |
| **Completed** | Jobs marked complete for the day. Fixed column, always last. | Manual or auto when status reaches completion |

### 2.2 Column Header — Technician

```
┌──────────────────────────────┐
│  Dave Mitchell                │
│  ████████░░░░  5.2 / 8.0 hrs │
│  3 jobs                       │
└──────────────────────────────┘
```

- Technician name (from `users` table)
- Progress bar: allocated hours / available hours (colour: green < 80%, amber 80-100%, red > 100%)
- Job count

### 2.3 Column Management

- **Add column:** Select from active technicians at the current site (role = `technician`, `is_active = true`)
- **Remove column:** Removes tech from board (cards return to "Checked In"). Confirmation required if column has cards.
- **Reorder columns:** Drag column headers to reorder
- **Persist layout:** Column configuration saved per-site so all advisors at the same site see the same board

---

## 3. Job Cards

### 3.1 Card Layout

```
┌──────────────────────────────────┐
│ ● AB12 CDE              Due 2:30pm│  ← Reg (bold) + promise time
│ John Smith                        │  ← Customer name
│ BMW 320d (2021)                   │  ← Make, model, year
│ SA: Sarah Parker                  │  ← Service advisor
│ ⏱ 2.5 hrs  │  Day 2              │  ← Labour hours + days on site
│ [WYW] [MOT] [SVC]                │  ← Badges
│ ⚠ Awaiting Authorisation          │  ← Active job status (if set)
│ 📝 Customer calling back at 11    │  ← Note preview (if exists)
└──────────────────────────────────┘
```

### 3.2 Card Data (from existing fields)

| Field | Source | Notes |
|-------|--------|-------|
| Registration | `vehicles.registration` | Bold, prominent |
| Customer name | `customers.first_name + last_name` | |
| Make & model | `vehicles.make + model` | |
| Year | `vehicles.year` | If available |
| Service advisor | `users` via `health_checks.advisor_id` | "SA: FirstName LastName" |
| Labour hours | Sum of `booked_repairs` labour items OR `repair_labour.hours` | From DMS pre-booked or manual |
| Promise time | `health_checks.promise_time` | "Due HH:MM" — red if overdue |
| Days on site | Calculated from `health_checks.arrived_at` | Grey (0-1), Amber (2), Red (3+) |
| Jobsheet number | `health_checks.jobsheet_number` | Displayed if present |
| Job status | New: `tcard_status_id` (see §5) | Configurable per-org |
| Notes | New: `tcard_notes` (see §4) | Latest note preview |

### 3.3 Badges

Derived from existing DMS-imported fields:

| Badge | Source field | Colour | Label |
|-------|-------------|--------|-------|
| Customer Waiting | `health_checks.customer_waiting = true` | Red (bg-rag-red) | WYW |
| Loan Car | `health_checks.loan_car_required = true` | Blue (bg-blue-500) | LOAN |
| Internal/Trade | `health_checks.is_internal = true` | Purple (bg-purple-500) | INT |
| MOT | `booked_repairs` contains MOT-type code | Amber (bg-rag-amber) | MOT |
| Service | DMS `serviceType = 'Service'` | Green (bg-rag-green) | SVC |
| Repair | DMS `serviceType = 'Repair'` | Orange (bg-orange-500) | RPR |
| Diagnostic | DMS `serviceType = 'Diagnostic'` | Cyan (bg-cyan-500) | DIAG |

The `serviceType` is extractable from the `booked_repairs` JSONB data or can be stored as a top-level field on the health check (new column: `service_type`).

### 3.4 Card Interactions

- **Click:** Opens a slide-out panel with full detail + note history + status controls (does NOT navigate away from board)
- **Drag:** Drag to another column to reassign technician. Updates `health_checks.technician_id` and board assignment.
- **Right-click / long-press:** Quick-action context menu — Set status, Add note, Set priority, Open full health check

### 3.5 Card Visual States

- **Priority flag:** Optional star/pin icon in top-right corner (manual, stored per-card)
- **Overdue promise time:** Promise time text turns red, card gets red left-border
- **Ageing job:** Days-on-site badge colour escalates (grey → amber → red)
- **Blocked/status:** Coloured left border based on active job status colour (see §5)
- **Sort order:** Cards within a column maintain a manual sort order (`sort_position` integer)

---

## 4. Card Notes

Quick operational notes attached to a job card, separate from the formal health check `technician_notes` / `advisor_notes`.

### 4.1 Data Model

```sql
CREATE TABLE IF NOT EXISTS tcard_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- Short, timestamped notes (max 500 chars)
- Card shows most recent note preview
- Slide-out panel shows full history
- No editing/deleting — append-only log (workshop accountability)

---

## 5. Configurable Job Statuses

Workshops can define their own operational statuses that are applied to cards on the board. These are separate from the system `HealthCheckStatus` and represent workshop-floor states.

### 5.1 Data Model

```sql
CREATE TABLE IF NOT EXISTS tcard_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name VARCHAR(50) NOT NULL,           -- e.g. "Awaiting Authorisation"
    colour VARCHAR(7) NOT NULL,          -- Hex colour, e.g. "#EF4444"
    icon VARCHAR(50),                    -- Optional icon name (lucide-react)
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, name)
);
```

### 5.2 Default Statuses (Seeded)

| Name | Colour | Icon |
|------|--------|------|
| Awaiting Authorisation | #EF4444 (red) | `clock` |
| Parts on Order | #F59E0B (amber) | `package` |
| Parts on Back Order | #DC2626 (dark red) | `package-x` |
| Awaiting Schedule | #6366F1 (indigo) | `calendar` |
| Sublet Out | #8B5CF6 (purple) | `external-link` |
| Waiting for Customer | #3B82F6 (blue) | `phone` |
| Quality Check | #10B981 (green) | `check-circle` |
| Ready for Wash | #06B6D4 (cyan) | `droplets` |
| Ready for Collection | #16A34A (green) | `car` |

### 5.3 Settings UI

Located at **Settings → Workshop Board → Job Statuses**:

- List of statuses with name, colour swatch, icon preview, active toggle
- Add / Edit / Delete (soft-delete via `is_active = false`)
- Drag to reorder (`sort_order`)
- Colour picker (preset palette + custom hex input)
- Icon picker (subset of lucide-react icons relevant to automotive)

---

## 6. Board Configuration

### 6.1 Data Model

```sql
-- Board configuration per site
CREATE TABLE IF NOT EXISTS tcard_board_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    site_id UUID NOT NULL REFERENCES sites(id),
    default_tech_hours DECIMAL(4,1) NOT NULL DEFAULT 8.0,
    show_completed_column BOOLEAN NOT NULL DEFAULT true,
    auto_complete_statuses TEXT[] DEFAULT ARRAY['completed', 'closed', 'archived'],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, site_id)
);

-- Technician columns for a site's board
CREATE TABLE IF NOT EXISTS tcard_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    site_id UUID NOT NULL REFERENCES sites(id),
    technician_id UUID NOT NULL REFERENCES users(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    available_hours DECIMAL(4,1) NOT NULL DEFAULT 8.0,  -- Override per-tech per-day if needed
    is_visible BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(site_id, technician_id)
);

-- Card assignments and positions on the board
CREATE TABLE IF NOT EXISTS tcard_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
    column_type VARCHAR(20) NOT NULL DEFAULT 'due_in',  -- 'due_in', 'checked_in', 'technician', 'completed'
    technician_id UUID REFERENCES users(id),            -- NULL for due_in/checked_in/completed
    sort_position INTEGER NOT NULL DEFAULT 0,
    tcard_status_id UUID REFERENCES tcard_statuses(id),
    priority VARCHAR(10) DEFAULT 'normal',              -- 'normal', 'high', 'urgent'
    board_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(health_check_id, board_date)
);
```

### 6.2 Board Date Handling

- Board shows a single selected date (default: today)
- Date picker in board header: today, tomorrow, +2 days
- "Due In" column: shows `health_checks` where `due_date::date` matches selected date AND `status = 'awaiting_arrival'`
- Since DMS imports +2 days ahead, tomorrow and day-after views are useful for forward planning
- Cards that span multiple days (arrived yesterday, still in progress) appear on all relevant dates

---

## 7. Slide-Out Detail Panel

When a card is clicked, a right-side slide-out panel opens (does not navigate away from board).

### 7.1 Panel Sections

1. **Header:** Registration (large), customer name, make/model
2. **Quick Info:** Promise time, days on site, labour hours, jobsheet number
3. **Badges:** All applicable badges (WYW, LOAN, MOT, etc.)
4. **Status Selector:** Dropdown of configured tcard statuses with colour swatches
5. **Priority Toggle:** Normal / High / Urgent
6. **Pre-Booked Work:** List from `booked_repairs` JSONB
7. **Notes:** Full history (append-only) + "Add note" input
8. **Actions:**
   - "Open Health Check" → navigates to full `/health-checks/:id` detail page
   - "Mark Complete" → moves card to Completed column
   - "Return to Checked In" → moves card back to unassigned

---

## 8. Filtering & Views

### 8.1 Board Filters (toolbar above board)

| Filter | Options |
|--------|---------|
| Date | Today / Tomorrow / +2 days / Custom date |
| Service Advisor | Dropdown of advisors — filter cards to only those assigned to selected advisor |
| Job Status | Multi-select of tcard statuses — show only cards with selected statuses |
| Service Type | Multi-select: MOT, Service, Repair, Diagnostic, etc. |
| Flags | Toggles: Customer Waiting, Loan Car, Overdue Promise Time, High Priority |

### 8.2 Search

Global search bar: type a registration, customer name, or jobsheet number to highlight/find the card on the board.

### 8.3 Wall Display Mode (Phase 2)

- Toggled via a "TV Mode" button in toolbar
- Hides all controls, maximises board area
- Larger cards, larger text
- Auto-refreshes via Socket.io (already real-time)
- Dark header bar with site name and current time
- Auto-scrolls horizontally if columns overflow

---

## 9. Real-Time Updates

Using the existing Socket.io infrastructure:

### 9.1 New Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `tcard:card_moved` | Card dragged to new column | `{ healthCheckId, fromColumn, toColumn, technicianId, sortPosition }` |
| `tcard:status_changed` | Job status updated | `{ healthCheckId, statusId, statusName, statusColour }` |
| `tcard:note_added` | New note added | `{ healthCheckId, note, userName }` |
| `tcard:column_updated` | Column added/removed/reordered | `{ siteId, columns[] }` |
| `tcard:card_updated` | Card data changed (priority, etc.) | `{ healthCheckId, changes }` |

### 9.2 Existing Events to Listen For

| Event | Effect on Board |
|-------|----------------|
| `health-check:status-changed` | Auto-move card if status implies column change (e.g. `awaiting_arrival` → `awaiting_checkin` moves from Due In to Checked In) |
| `health-check:created` | New card appears in appropriate column |
| `dms:import-complete` | Refresh Due In column with new bookings |

---

## 10. API Endpoints

All under `/api/v1/tcard/` with auth middleware requiring minimum role `service_advisor`.

### 10.1 Board

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/board?siteId=&date=` | Get full board state: columns, cards, assignments |
| `GET` | `/board/config?siteId=` | Get board configuration for site |
| `PATCH` | `/board/config` | Update board config (default hours, etc.) |

### 10.2 Columns

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/columns?siteId=` | List technician columns for site |
| `POST` | `/columns` | Add technician column |
| `PATCH` | `/columns/:id` | Update column (hours, visibility) |
| `DELETE` | `/columns/:id` | Remove column (returns cards to Checked In) |
| `PATCH` | `/columns/reorder` | Reorder columns (batch `sort_order` update) |

### 10.3 Cards / Assignments

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/cards/move` | Move card to column (drag-and-drop) |
| `PATCH` | `/cards/:healthCheckId/status` | Set tcard job status |
| `PATCH` | `/cards/:healthCheckId/priority` | Set priority |
| `PATCH` | `/cards/reorder` | Reorder cards within column (batch `sort_position` update) |

### 10.4 Notes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/notes/:healthCheckId` | Get notes for a health check |
| `POST` | `/notes` | Add note to a health check |

### 10.5 Statuses

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/statuses` | List all tcard statuses for org |
| `POST` | `/statuses` | Create new status |
| `PATCH` | `/statuses/:id` | Update status (name, colour, icon, active) |
| `DELETE` | `/statuses/:id` | Soft-delete (set `is_active = false`) |
| `PATCH` | `/statuses/reorder` | Reorder statuses |

---

## 11. Navigation

- **Sidebar:** New nav item "Workshop Board" with `layout-grid` icon (lucide-react), positioned between "Health Checks" and "Upcoming"
- **Route:** `/workshop-board`
- **Settings:** New settings section "Workshop Board" under the existing Settings hub, containing:
  - Job Statuses (manage configurable statuses)
  - Board Settings (default hours, display preferences)

---

## 12. Permissions

| Action | Minimum Role |
|--------|-------------|
| View board | `service_advisor` |
| Drag cards / move jobs | `service_advisor` |
| Add/edit notes | `service_advisor` |
| Set job status / priority | `service_advisor` |
| Add/remove/reorder columns | `service_advisor` |
| Manage tcard statuses (Settings) | `site_admin` |
| Manage board config (Settings) | `site_admin` |

---

## 13. Implementation Plan

### Phase 1: Foundation (Database + API + Basic Board)

**Step 1.1 — Database Migration**
- Create migration: `tcard_statuses`, `tcard_board_config`, `tcard_columns`, `tcard_assignments`, `tcard_notes` tables
- Seed default statuses
- Add RLS policies (filter by `organization_id`)
- Add indexes for performance

**Step 1.2 — Shared Types**
- Add TypeScript types to `packages/shared/src/types/index.ts`:
  `TCardStatus`, `TCardColumn`, `TCardAssignment`, `TCardNote`, `TCardBoardConfig`

**Step 1.3 — API Routes**
- Create `apps/api/src/routes/tcard/` directory with:
  - `index.ts` — mount sub-routers
  - `board.ts` — GET board state (aggregate query joining health_checks, vehicles, customers, users, assignments)
  - `columns.ts` — CRUD for technician columns
  - `cards.ts` — move, reorder, set status/priority
  - `notes.ts` — list and create notes
  - `statuses.ts` — CRUD for configurable statuses
  - `config.ts` — board configuration
- Register routes in `apps/api/src/index.ts`
- Emit Socket.io events on mutations

**Self-Test 1:** Use REST client (or curl) to:
- Create statuses, columns, and assignments via API
- Verify GET `/board` returns properly structured data
- Verify multi-tenancy: org A cannot see org B's board
- Verify role enforcement: technician gets 403 on write endpoints

---

### Phase 2: Board UI (Core Kanban)

**Step 2.1 — Board Page Shell**
- Create `apps/web/src/pages/WorkshopBoard/WorkshopBoard.tsx`
- Add route to `App.tsx` at `/workshop-board` (lazy-loaded)
- Add nav item in `DashboardLayout.tsx`
- Board header: date picker, filter bar, search

**Step 2.2 — Board Columns**
- Fixed columns: "Due In", "Checked In", "Completed"
- Dynamic technician columns from API
- Column headers with name, hours progress bar, job count
- "Add Technician" button (opens picker modal)
- Column reorder via drag-and-drop on headers

**Step 2.3 — Job Cards**
- `JobCard.tsx` component matching §3.1 layout
- Badges component (`CardBadges.tsx`) for WYW, LOAN, MOT, etc.
- Days-on-site calculation with colour escalation
- Promise time display with overdue highlighting
- Left-border colour from active tcard status

**Step 2.4 — Drag and Drop**
- Use existing `@dnd-kit` library (already installed)
- `DndContext` wrapping the board
- `SortableContext` per column (vertical sort)
- Cross-column drag: update `tcard_assignments` via API on drop
- Optimistic UI: move card immediately, revert on API failure
- `DragOverlay` for the dragged card preview

**Self-Test 2:**
- Render board with mock data
- Drag card from "Due In" to a technician column — verify API call fires and card stays in new column
- Drag card within column to reorder — verify sort order persists after page refresh
- Add/remove technician column — verify cards return to "Checked In" on remove
- Verify column hours calculation updates when card is moved in/out

---

### Phase 3: Detail Panel + Notes + Status

**Step 3.1 — Slide-Out Panel**
- `CardDetailPanel.tsx` — right-side slide-out (like a drawer)
- Sections per §7.1: header, quick info, badges, status, priority, pre-booked work, notes, actions
- Animate in/out (translate-x transition)

**Step 3.2 — Job Status Selector**
- Dropdown of configured statuses with colour dots
- "Clear status" option
- Updates card border colour in real-time

**Step 3.3 — Notes**
- Notes history list (newest first, timestamped, with author)
- "Add note" text input at bottom
- Append-only (no edit/delete)

**Step 3.4 — Priority & Actions**
- Priority toggle: Normal / High / Urgent
- "Open Health Check" link
- "Mark Complete" / "Return to Checked In" buttons

**Self-Test 3:**
- Click card → panel opens with correct data
- Add note → appears in list immediately (optimistic + Socket.io)
- Change status → card border colour updates on board
- Set priority → card shows priority indicator
- Open second browser tab → changes reflect in real-time via Socket.io

---

### Phase 4: Settings UI

**Step 4.1 — Job Statuses Settings Page**
- `apps/web/src/pages/Settings/TCardStatuses.tsx`
- List with colour swatch, icon, name, active toggle
- Add/Edit modal with colour picker + icon picker
- Drag to reorder
- Register in `SettingsHub.tsx` under new "Workshop Board" category

**Step 4.2 — Board Settings Page**
- `apps/web/src/pages/Settings/TCardBoardSettings.tsx`
- Default technician hours per day
- Show/hide completed column toggle
- Which health check statuses auto-move to "Completed"
- Register in `SettingsHub.tsx`

**Self-Test 4:**
- Create new status → appears in status dropdown on board
- Deactivate status → disappears from dropdown, cards with that status show "(Removed)"
- Change default hours → new columns use updated default
- Verify settings are org-scoped (switch org → different statuses)

---

### Phase 5: Filtering, Search & Polish

**Step 5.1 — Filters**
- Date picker (today/tomorrow/+2 days/custom)
- Service advisor filter dropdown
- Job status multi-select filter
- Service type multi-select filter
- Flag toggles (WYW, Loan, Overdue, High Priority)
- Persist active filters in URL params for shareability

**Step 5.2 — Search**
- Search bar in toolbar
- Search by registration, customer name, jobsheet number
- Matching card highlighted/scrolled-to on the board

**Step 5.3 — Empty States & Edge Cases**
- Empty board (no columns set up): onboarding prompt to add technicians
- Empty "Due In" column: "No bookings for [date]" message
- No matching filters: "No jobs match your filters" message
- Technician with no jobs: "No jobs assigned" in column body

**Step 5.4 — Responsive & Overflow**
- Horizontal scroll when columns exceed viewport width
- Sticky column headers during vertical scroll
- Minimum column width with horizontal scroll behaviour

**Self-Test 5:**
- Filter by advisor → only their cards visible
- Filter by "Parts on Order" status → only those cards visible
- Search "AB12" → card highlighted on board
- Switch date to tomorrow → "Due In" shows tomorrow's bookings
- Resize browser → board scrolls horizontally, headers stay visible

---

### Phase 6: Wall Display Mode (Future / Phase 2)

- "TV Mode" toggle in toolbar
- Full-screen, auto-refreshing, large-format view
- Consider as a separate enhancement after core board is stable

---

## 14. New Files Summary

### Database
```
supabase/migrations/YYYYMMDDHHMMSS_tcard_workshop_board.sql
```

### Shared Types
```
packages/shared/src/types/index.ts  (add TCard types)
```

### API
```
apps/api/src/routes/tcard/
├── index.ts
├── board.ts
├── columns.ts
├── cards.ts
├── notes.ts
├── statuses.ts
└── config.ts
```

### Web
```
apps/web/src/pages/WorkshopBoard/
├── WorkshopBoard.tsx          (main board page)
├── BoardColumn.tsx            (column component)
├── BoardColumnHeader.tsx      (header with hours bar)
├── JobCard.tsx                (draggable card)
├── CardBadges.tsx             (badge strip)
├── CardDetailPanel.tsx        (slide-out panel)
├── AddColumnModal.tsx         (technician picker)
├── BoardToolbar.tsx           (filters, search, date picker)
└── hooks/
    ├── useBoardData.ts        (fetch + Socket.io subscription)
    ├── useBoardDragDrop.ts    (dnd-kit logic)
    └── useBoardFilters.ts     (filter state management)

apps/web/src/pages/Settings/
├── TCardStatuses.tsx          (status management)
└── TCardBoardSettings.tsx     (board config)
```

---

## 15. Data Flow Diagram

```
DMS Import (scheduled)
    │
    ▼
health_checks (status: awaiting_arrival, due_date set)
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    WORKSHOP BOARD                            │
│                                                             │
│  Due In ──drag──► Checked In ──drag──► Tech Column          │
│  (auto)           (auto on arrival)    (manual assign)      │
│                                            │                │
│                                            ▼                │
│                                       Completed             │
│                                       (manual / auto)       │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
Existing health check workflow continues
(inspection → pricing → customer → completion)
```

---

## 16. Key Design Decisions

1. **Separate from health check statuses:** T-Card statuses are operational/workshop-floor concerns. The system `HealthCheckStatus` continues to track the formal inspection workflow. Both can coexist on the same health check.

2. **Board is a layer, not a replacement:** The board reads from `health_checks` + related tables and adds its own assignment/position/status metadata. It doesn't replace any existing views — it's an additional tool.

3. **Per-site columns:** Each site has its own board layout because different sites have different technicians. Multi-site orgs see the board for their currently-selected site.

4. **Date-scoped assignments:** `tcard_assignments.board_date` ensures each day gets a fresh board. Carryover jobs (still in progress from yesterday) should auto-appear on today's board.

5. **@dnd-kit reuse:** Already installed and used in the health check list. Same patterns, same library, no new dependencies needed.

6. **Optimistic updates:** Card moves update the UI immediately and fire an API call in the background. On failure, the card snaps back with a toast error. This keeps the drag-and-drop feeling instant.
