# Repair Options Migration: Summary Tab to Health Check Tab

**Date:** 2026-01-29
**Branch:** dev

## Overview

Moved repair options UI from the Summary Tab (where it was create-only, no pricing) to the Health Check Tab with full lifecycle management via a new `RepairOptionsModal`. Summary Tab is now read-only for options.

## Problem

- Options UI lived in Summary Tab with only name/description creation (no pricing)
- Backend fully supported per-option labour/parts/pricing but no UI existed to manage it
- Options are a "configure then select" workflow that belongs alongside the repair items in the Health Check Tab

## Files Changed

### `apps/web/src/lib/api.ts`
- Added two fields to `RepairItem` interface (around line 388):
  - `options?: RepairOption[]`
  - `selected_option_id?: string | null`

### `apps/api/src/routes/health-checks/crud.ts`
- Extended both Supabase queries (main fetch + auto-generated re-fetch) to join `repair_options`:
  ```
  options:repair_options(id, name, description, labour_total, parts_total, subtotal, vat_amount, total_inc_vat, is_recommended, sort_order)
  ```
- Added `options` array and `selected_option_id` to the response mapping, converting DB snake_case to camelCase

### `apps/web/src/pages/HealthChecks/components/RepairOptionsModal.tsx` (NEW)
- Full option management modal with two modes:
  - **List mode**: View all options with pricing summaries, create new options (name/description/recommended), select an option, delete options
  - **Edit pricing mode**: Per-option labour entries (labour code dropdown, hours, rate) and parts entries (part number, description, qty, cost/sell price) with add/delete
- Fetches labour codes from `GET /api/v1/organizations/:id/labour-codes`
- All option CRUD uses existing API routes (no new endpoints)
- Calls `onUpdate()` after every mutation to trigger parent data refresh

### `apps/web/src/pages/HealthChecks/components/RepairItemRow.tsx`
- Added `onManageOptions?: () => void` prop
- Added computed `hasOptions` and `selectedOption` derived from `item.options` and `item.selected_option_id`
- **Badge**: Indigo OPTIONS badge in title area (desktop + mobile), clickable, shows count and "(selected)" if one is active
- **Pricing columns** (desktop + mobile): When `hasOptions` is true, shows read-only selected option pricing instead of editable inline prices. If no option selected, shows "No option selected" with 0.00
- **Expanded section**: Shows options summary cards with SELECTED/RECOMMENDED badges and pricing. "Manage Options" button opens modal. If no options, shows "+ Add Repair Options" button

### `apps/web/src/pages/HealthChecks/components/HealthCheckTabContent.tsx`
- Imported `RepairOptionsModal`
- Added state: `optionsModalItemId`, `optionsModalItemTitle`
- Passed `onManageOptions` callback to all `RepairItemRow` instances (red items, amber items, authorised items sections)
- Renders `RepairOptionsModal` when `optionsModalItemId` is set
- Updated totals calculation (`redTotal`, `amberTotal`, `authorisedTotal`, `authorisedCompletedTotal`) via `getItemEffectiveTotal()` helper that uses selected option's `totalIncVat` when available, falls back to `item.total_price`

### `apps/web/src/pages/HealthChecks/tabs/SummaryTab.tsx`
- **Removed**: `showAddOptionModal` state, `addOptionItemId` state
- **Removed**: `handleAddOption()` function, `handleSelectOption()` function
- **Removed**: `onAddOption` and `onSelectOption` from `RepairItemCard` props and interface
- **Removed**: Option radio buttons with interactive selection UI
- **Removed**: "Add Option" button from card action bar
- **Removed**: Entire `AddOptionModal` component (~120 lines)
- **Replaced with**: Read-only option display showing each option name and price, with "Selected:" prefix on the active option

## API Routes Used (all pre-existing)

| Route | Method | Purpose |
|-------|--------|---------|
| `/repair-items/:id/options` | GET | Fetch options for a repair item |
| `/repair-items/:id/options` | POST | Create option |
| `/repair-options/:id` | PATCH | Update option (name/description/recommended) |
| `/repair-options/:id` | DELETE | Delete option (cascades labour/parts) |
| `/repair-items/:id/select-option` | POST | Set selected option |
| `/repair-options/:id/labour` | GET | List labour entries for option |
| `/repair-options/:id/labour` | POST | Add labour entry to option |
| `/repair-labour/:id` | DELETE | Delete labour entry |
| `/repair-options/:id/parts` | GET | List parts for option |
| `/repair-options/:id/parts` | POST | Add part to option |
| `/repair-parts/:id` | DELETE | Delete part entry |
| `/organizations/:id/labour-codes` | GET | Fetch labour codes for dropdown |

## Design Decisions

### Pricing when options exist
- Item's direct `parts_cost`/`labor_cost`/`total_price` become irrelevant - pricing lives on the options
- RepairItemRow disables inline price editing and shows selected option's pricing instead
- If no option is selected yet, shows 0.00
- Direct pricing left in DB as fallback, but UI ignores it when options exist
- Section totals (`redTotal`, `amberTotal`, etc.) use `getItemEffectiveTotal()` which checks for selected option first

### Grouped items
- Options attach to the group (parent) repair item, not individual children
- The options badge/indicator appears on the group's RepairItemRow
- Matches backend: `repair_options.repair_item_id` = group item ID

### Data refresh pattern
- `RepairOptionsModal` receives `onUpdate: () => void` from `HealthCheckTabContent`
- After any option CRUD, `onUpdate()` triggers the parent page's full data refresh via `HealthCheckDetail.tsx`'s `refreshData()`

### Modal vs inline
- RepairItemRow is already ~950 lines; options are a "configure then select" workflow
- Modal contains per-option pricing tables without cluttering the main row

## Post-Deploy Fix: Supabase FK Ambiguity

The initial implementation broke the Health Check Tab entirely. The `repair_items` table has **two FK relationships** with `repair_options`:
- `repair_options.repair_item_id -> repair_items.id` (one-to-many: item has many options)
- `repair_items.selected_option_id -> repair_options.id` (many-to-one: item points to selected option)

Supabase PostgREST cannot auto-resolve ambiguous relationships. The join `options:repair_options(...)` failed silently, returning `null` for `repairItems`, which made the entire Health Check Tab blank.

**Fix:** Added explicit FK hint to the Supabase select:
```
options:repair_options!repair_options_repair_item_id_fkey(...)
```

Also added error logging:
```typescript
if (repairItemsError) {
  console.error('Failed to fetch repair items with options:', repairItemsError)
}
```

**Lesson:** When a Supabase table has multiple FK relationships to the same table, always use explicit FK hints (`!constraint_name`) in `.select()` joins. Check constraint names with:
```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'table_name'::regclass AND contype = 'f';
```

## Phase 2: Inline Option Parts in PartsTab

**Date:** 2026-01-29

### Changes

The initial implementation had a separate labour/parts editor inside `RepairOptionsModal`. This was replaced with inline option part editing directly in the PartsTab.

**Design principle:** Options are about different **parts**, not different labour. Labour stays on the repair item directly. When a repair item has options, its parts appear as expandable indigo-styled sub-sections within the Parts tab (one sub-section per option).

### Files Changed

#### `apps/api/src/routes/repair-items/repair-items.ts`
- Nested `repair_parts` inside `repair_options` in the Supabase query for the list endpoint (GET `/health-checks/:id/repair-items`)
- Added camelCase `parts` array mapping inside each option's response object

#### `apps/web/src/pages/HealthChecks/components/RepairOptionsModal.tsx`
- Removed all labour/parts editing (edit pricing mode, labour CRUD, parts CRUD, labour codes state)
- Kept only option CRUD: create, delete, select, toggle recommended
- Read-only pricing summary per option (shows totals calculated by DB triggers)
- Reduced from ~777 lines to ~330 lines

#### `apps/web/src/pages/HealthChecks/tabs/PartsTab.tsx`
- Added `RepairOptionsModal` import and state (`optionsModalItemId`, `optionsModalItemTitle`)
- Extended `RowEditState.allocationType` to include `'option'`
- Extended `addNewPartRow` and `removeNewPartRow` to support `'option'` sectionType with optional `optionId`
- Extended `saveRowPart` to POST to `/repair-options/:id/parts` when `optionId` is provided
- Added indigo-styled option sub-sections for both GROUP and STANDALONE items
- Added "Options" button to group header and standalone item header
- Added "Manage Options" button below option sub-sections in groups
- Rendered `RepairOptionsModal` at bottom of component

### Visual Hierarchy

```
> Battery System                GROUP (3)   4 parts   $245.00   [Options] [Expand]
  |- Shared Parts (purple)       2 parts    $80.00    [+ Add]
  |   +-- [MultiPartRow...]
  |- Option: Standard (indigo)   1 part     $65.00    [+ Add]   RECOMMENDED
  |   +-- [MultiPartRow...]
  |- Option: Premium (indigo)    1 part     $100.00   [+ Add]   SELECTED
  |   +-- [MultiPartRow...]
  [Manage Options]
  |- Battery Condition (child)   ...
  +-- Alternator Check (child)   ...
```

## Potential Bug Areas

1. **Option totals not refreshing**: If DB triggers fail to recalculate `labour_total`/`parts_total`/`subtotal`/`vat_amount`/`total_inc_vat` on `repair_options`, the modal totals display will be stale. The modal re-fetches options after each add/delete to get fresh trigger-calculated values.
2. **Selected option cleared on delete**: If the selected option is deleted, `selected_option_id` should be nulled by the DB cascade. Verify this works.
3. **Customer view**: The customer-facing view may still reference options. This migration only covers the advisor web dashboard. Check `apps/web/src/pages/CustomerView/` and `apps/mobile/` if customers or technicians see options.
4. **Quote totals in SummaryTab**: The `quoteTotals` calculation in SummaryTab uses `item.selectedOptionId` and `item.options` from the `NewRepairItem` type (different from `RepairItem`). This was not changed since it already worked correctly.
5. **HealthCheckTabContent totals**: The `getItemEffectiveTotal()` uses `totalIncVat` from selected option. This is the inc-VAT figure. The existing `item.total_price` was also inc-VAT (mapped from `total_inc_vat` in crud.ts), so this is consistent.
