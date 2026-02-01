# Vehicle Locations Feature

## Overview

Many inspection items are location-specific on a vehicle (e.g., coil springs, brake pads, tyres). Currently, technicians cannot record *where* on the vehicle a finding applies. This leads to vague repair items like "Coil Spring - Cracked" with no indication of which corner. Advisors then have to chase technicians for clarification, slowing down the workflow.

The Vehicle Locations feature allows organisations to define a set of vehicle locations (e.g., Front Left, Front Right, Rear Left, Rear Right) and flag template items as location-aware. During inspection, technicians select one or more locations per finding, producing distinct check results and repair items that include the location in the title.

## Problem Statement

- Technicians cannot specify which wheel/corner/side a finding applies to
- Repair items and customer-facing quotes lack location context
- Advisors waste time clarifying location with technicians
- No structured data for location-based reporting or trends

## Design Goals

1. Organisation-configurable location sets (not hardcoded)
2. Per-item opt-in via template builder (`requires_location` toggle)
3. Multi-select in a single interaction (e.g., both front tyres worn)
4. Location persists in repair item titles for customer-facing quotes
5. Denormalised location name so historical data survives renames/deactivations

---

## Data Model

### New Table: `vehicle_locations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `organization_id` | UUID FK → organizations | Multi-tenant scoping |
| `name` | VARCHAR(100) | Display name, e.g. "Front Left" |
| `short_name` | VARCHAR(20) | Compact label, e.g. "FL" |
| `sort_order` | INTEGER | Controls display order |
| `is_active` | BOOLEAN | Soft-delete flag |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Constraints:** `UNIQUE(organization_id, name)`

### Schema Changes: `template_items`

| Column | Type | Notes |
|--------|------|-------|
| `requires_location` | BOOLEAN DEFAULT false | Opt-in per item |

### Schema Changes: `check_results`

| Column | Type | Notes |
|--------|------|-------|
| `vehicle_location_id` | UUID FK → vehicle_locations | Nullable |
| `vehicle_location_name` | VARCHAR(100) | Denormalised for display |

The `vehicle_location_name` field is intentionally denormalised so that repair items, quotes, and historical records retain the correct location label even if the location entry is later renamed or deactivated.

### Updated Unique Constraint on `check_results`

The current unique index is on `(health_check_id, template_item_id, instance_number)`. This must include the location to allow separate results per location for the same item:

```sql
DROP INDEX IF EXISTS check_results_unique_instance;
CREATE UNIQUE INDEX check_results_unique_instance
  ON check_results(health_check_id, template_item_id, instance_number,
    COALESCE(vehicle_location_id, '00000000-0000-0000-0000-000000000000'));
```

### Seed Data

Default locations are seeded for all existing organisations on migration:

| name | short_name | sort_order |
|------|-----------|------------|
| Front Left | FL | 1 |
| Front Right | FR | 2 |
| Rear Left | RL | 3 |
| Rear Right | RR | 4 |

---

## Shared Types

**File:** `packages/shared/src/types/index.ts`

```typescript
interface VehicleLocation {
  id: string
  organizationId: string
  name: string
  shortName: string | null
  sortOrder: number
  isActive: boolean
}
```

Additional field additions:
- `TemplateItem.requiresLocation?: boolean`
- `CheckResult.vehicleLocationId?: string`
- `CheckResult.vehicleLocationName?: string`

---

## API Endpoints

### Vehicle Locations CRUD

**New route file:** `apps/api/src/routes/vehicle-locations.ts`

| Method | Endpoint | Min Role | Description |
|--------|----------|----------|-------------|
| GET | `/api/v1/vehicle-locations` | technician | List active locations for org |
| POST | `/api/v1/vehicle-locations` | org_admin | Create a new location |
| PATCH | `/api/v1/vehicle-locations/:id` | org_admin | Update name, short_name, sort_order |
| DELETE | `/api/v1/vehicle-locations/:id` | org_admin | Soft-delete (set `is_active = false`) |
| POST | `/api/v1/vehicle-locations/reorder` | org_admin | Bulk update sort_order |

All endpoints filter by `organization_id` from the authenticated user session.

### Template Items Update

**File:** `apps/api/src/routes/templates.ts`

- Item create/update endpoints accept and persist `requires_location`
- GET template responses include `requires_location` in item data

### Check Results Update

**File:** `apps/api/src/routes/check-results.ts` (or health-checks routes)

- Check result creation accepts `vehicle_location_id` and `vehicle_location_name`
- New batch endpoint: `POST /api/v1/check-results/batch` for creating multiple results at once (one per selected location, same reasons/status)

---

## Web Dashboard

### Settings Page: Vehicle Locations

**New file:** `apps/web/src/pages/Settings/VehicleLocations.tsx`
**Route:** `/settings/vehicle-locations`

Features:
- Table listing all locations (name, short name, sort order, active status)
- Drag-to-reorder using `@dnd-kit` (consistent with TemplateBuilder)
- Inline editing of name and short_name
- Add new location row
- Soft-delete with confirmation dialog
- Standard settings page layout (SettingsBackLink, toast notifications)

Navigation: Add "Vehicle Locations" link in the settings sidebar/menu.

### Template Builder Integration

**File:** `apps/web/src/pages/Templates/TemplateBuilder.tsx`

- Add "Requires Location" toggle (checkbox or switch) on each item row
- Column header positioned alongside existing toggles (e.g., near "Required?")
- Toggle visible in both inline editing mode and the `InlineNewItemRow`
- Persists via existing `PATCH /api/v1/items/:itemId` endpoint

---

## Mobile PWA

### Location Picker Component

**New file:** `apps/mobile/src/components/LocationPicker.tsx`

- Bottom-sheet modal matching the existing `ReasonSelector` pattern
- Grid of location buttons fetched from API once and cached
- Multi-select with visual highlight feedback on selected buttons
- "Save" button to confirm selection and create findings

### Updated Inspection Flow

Current flow:
1. Tech taps item → selects RAG status → opens ReasonSelector → saves

New flow (for `requires_location` items):
1. Tech taps item → selects RAG status → opens ReasonSelector
2. ReasonSelector `onSave` checks `requires_location` on the template item
3. If `true` → opens LocationPicker modal instead of saving immediately
4. Tech picks one or more locations → confirms
5. System calls batch endpoint to create one `check_result` per location, each with the same reasons and RAG status
6. Each result appears as a separate entry in the inspection list with a location badge

For items where `requires_location` is `false`, the flow is unchanged.

### Display

- Completed items with a location show a compact badge next to the item name
- Example: "Coil Spring **[FL]**" in the inspection list
- Uses `short_name` for space efficiency on mobile

---

## Repair Item Title Generation

When repair items are auto-generated from check results that include a location:

**Format:** `{Location Name} {Item Name} - {Reason}`
**Example:** "Front Left Coil Spring - Cracked"

This applies to:
- Auto-generated repair items from inspection findings
- Manual repair items created from check results with a location

The location is taken from the denormalised `vehicle_location_name` field on the check result, ensuring the title remains accurate even if the location is later renamed.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/YYYYMMDDHHMMSS_vehicle_locations.sql` | **Create** - New table + schema changes + seed data |
| `packages/shared/src/types/index.ts` | **Modify** - Add `VehicleLocation` type, extend `TemplateItem` and `CheckResult` |
| `apps/api/src/routes/vehicle-locations.ts` | **Create** - CRUD endpoints |
| `apps/api/src/routes/templates.ts` | **Modify** - Accept `requires_location` |
| `apps/api/src/routes/check-results.ts` | **Modify** - Accept location fields, add batch endpoint |
| `apps/api/src/index.ts` | **Modify** - Register vehicle-locations routes |
| `apps/web/src/pages/Settings/VehicleLocations.tsx` | **Create** - Settings page |
| `apps/web/src/App.tsx` | **Modify** - Add route |
| `apps/web/src/pages/Templates/TemplateBuilder.tsx` | **Modify** - Add location toggle |
| `apps/mobile/src/components/LocationPicker.tsx` | **Create** - Location picker modal |
| `apps/mobile/src/pages/Inspection.tsx` | **Modify** - Integrate location picker into flow |

---

## Verification Plan

1. **Settings page** - Create, edit, reorder, and soft-delete vehicle locations in web settings
2. **Template builder** - Toggle `requires_location` on a template item; verify it persists after page reload
3. **Mobile inspection (location item):**
   - Mark a `requires_location` item as red/amber → select reasons → verify LocationPicker appears
   - Select multiple locations → verify separate check results are created per location
4. **Mobile inspection (non-location item):**
   - Mark a standard item → verify the LocationPicker does not appear
5. **Repair items** - Verify auto-generated repair items include the location name in the title
6. **Build** - Run `npm run build` across all apps to confirm no TypeScript errors
