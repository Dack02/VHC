# Gemini OSI DMS Integration — Exploration & Build Plan

## Status

| Phase | Status | Notes |
|-------|--------|-------|
| **Phase A:** API Exploration | ✅ Complete | Auth, fields, response structure documented |
| **Phase B:** Data Mapping | ✅ Complete | Field mappings confirmed |
| **Phase C:** Implementation | ✅ Complete | Import working - 25 bookings imported successfully |
| **Phase D:** Dashboard | ✅ Complete | Awaiting Arrival section, Mark Arrived, No Show all implemented |
| **Phase E:** Quick Wins | ✅ Complete | Customer waiting, loan car, booked repairs, days on site |

**Last Updated:** 2026-01-16

---

## DMS Workflow Reference (Verified 2026-01-16)

### Complete Status Flow Diagram
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ DMS IMPORT WORKFLOW                                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐          │
│  │   DMS Import     │ →  │ awaiting_arrival │ →  │   Mark Arrived   │          │
│  │  (gemini-osi)    │    │                  │    │                  │          │
│  └──────────────────┘    └───────┬──────────┘    └─────────┬────────┘          │
│                                  │                         │                    │
│                                  │ No Show                 ↓                    │
│                                  ↓               ┌──────────────────┐          │
│                        ┌──────────────────┐     │     created      │          │
│                        │     no_show      │     │   (Technician    │          │
│                        │   (Actioned)     │     │      Queue)      │          │
│                        └──────────────────┘     └─────────┬────────┘          │
│                                                           │                    │
│                                                           │ Assign Tech        │
│                                                           ↓                    │
│                                                 ┌──────────────────┐          │
│                                                 │     assigned     │          │
│                                                 │   (Technician    │          │
│                                                 │      Queue)      │          │
│                                                 └─────────┬────────┘          │
│                                                           │                    │
│                                                           │ Start Work         │
│                                                           ↓                    │
│                                                 ┌──────────────────┐          │
│                                                 │   in_progress    │◄─┐       │
│                                                 │   (Technician    │  │       │
│                                                 │      Queue)      │  │ Resume│
│                                                 └─────────┬────────┘  │       │
│                                                     ↓     │           │       │
│                                               ┌─────┴─────┴───┐       │       │
│                                               │    paused     │───────┘       │
│                                               │  (Technician  │               │
│                                               │     Queue)    │               │
│                                               └───────────────┘               │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Status Visibility by UI Section

| Status | UI Section | Notes |
|--------|-----------|-------|
| `awaiting_arrival` | **Awaiting Arrival** (Dashboard) | DMS imports land here |
| `no_show` | Actioned | Vehicle didn't arrive |
| `created` | **Technician Queue** | After "Mark Arrived" |
| `assigned` | Technician Queue | Tech assigned but not started |
| `in_progress` | Technician Queue | Tech actively working |
| `paused` | Technician Queue | Work paused temporarily |
| `tech_completed` | Tech Done / Review | Tech finished inspection |
| `awaiting_review` | Tech Done / Review | Waiting for advisor review |
| `awaiting_pricing` | Tech Done / Review | Waiting for pricing |
| `awaiting_parts` | Tech Done / Review | Waiting for parts availability |
| `ready_to_send` | Ready to Send | Ready to send to customer |
| `sent`, `delivered`, `opened`, `partial_response` | With Customer | Customer has report |
| `authorized`, `declined`, `completed` | Actioned | Final states |

### Key Code Locations

| Function | File | Line |
|----------|------|------|
| DMS Import (sets `awaiting_arrival`) | `apps/api/src/jobs/dms-import.ts` | 389 |
| Mark Arrived (`awaiting_arrival` → `created`) | `apps/api/src/routes/health-checks.ts` | 971 |
| Mark No-Show (`awaiting_arrival` → `no_show`) | `apps/api/src/routes/health-checks.ts` | 1043 |
| Technician Queue statuses | `apps/api/src/routes/dashboard.ts` | 12 |
| Awaiting Arrival API | `apps/api/src/routes/dms-settings.ts` | 939 |
| Awaiting Arrival UI | `apps/web/src/pages/Dashboard.tsx` | 406-499 |

### Valid Status Transitions

```typescript
// From apps/api/src/routes/health-checks.ts:16-32
const validTransitions = {
  awaiting_arrival: ['created', 'no_show', 'cancelled'],
  no_show: ['awaiting_arrival', 'cancelled'],
  created: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['tech_completed', 'paused'],
  paused: ['in_progress'],
  tech_completed: ['awaiting_review', 'awaiting_pricing'],
  awaiting_review: ['awaiting_pricing', 'ready_to_send'],
  awaiting_pricing: ['awaiting_parts', 'ready_to_send'],
  awaiting_parts: ['ready_to_send'],
  ready_to_send: ['sent'],
  sent: ['delivered', 'opened'],
  delivered: ['opened'],
  opened: ['partial_response', 'authorized', 'declined'],
  partial_response: ['authorized', 'declined'],
  authorized: ['completed'],
  declined: ['completed']
}
```

---

## ✅ Phase E Complete (2026-01-16) — Quick Wins

**Migration:** `20260116500001_phase1_quick_wins.sql`

### E.1 - Customer Waiting Flag
- Added `customer_waiting` BOOLEAN to `health_checks`
- Imported from `booking.CustomerWaiting`
- Red WAITING badge with pulse animation on Dashboard Awaiting Arrival list
- Waiting customers automatically sorted to top of list

### E.2 - Loan Car Required
- Added `loan_car_required` BOOLEAN to `health_checks`
- Imported from `booking.LoanCar`
- Blue LOAN indicator shown on Dashboard Awaiting Arrival list
- Visible in health check detail view

### E.3 - Booked Repairs (Pre-Booked Work)
- Added `booked_repairs` JSONB to `health_checks`
- Imported from `booking.Jobsheet.Repairs` array
- New "Pre-Booked Work" section on health check detail Summary tab
- Items matching VHC findings marked as "Already Booked" (prevents double-recommending)

### E.4 - Customer Address Fields
- Added to `customers` table: `title`, `address_line1`, `address_line2`, `town`, `county`, `postcode`
- Imported from `booking.InvoiceTo` address fields
- Available in customer details and API responses

### E.5 - Booking & Time Tracking
- Added `booked_date` TIMESTAMPTZ to `health_checks` (when booking was imported)
- Added `due_date` TIMESTAMPTZ to `health_checks` (booking.DueDateTime)
- "Booked" date shown in health check detail view
- **Days on Site** calculated from `arrived_at` to now:
  - Normal: Gray text
  - >1 day: Amber text
  - >2 days: Red bold text
- Days on Site column added to Health Checks List view

### E.6 - Additional Fields
- Added `jobsheet_number` TEXT to `health_checks`
- Added `jobsheet_status` TEXT to `health_checks`
- Added `is_internal` BOOLEAN to `health_checks`

### Files Modified
- `apps/api/src/services/gemini-osi.ts` — Extended `GeminiBooking` interface with new fields
- `apps/api/src/jobs/dms-import.ts` — Updated import to store all new fields + customer address
- `apps/api/src/routes/dms-settings.ts` — `/unactioned` endpoint returns new fields, sorted by waiting
- `apps/api/src/routes/health-checks.ts` — Detail endpoint returns all Phase E fields
- `apps/web/src/lib/api.ts` — Extended `HealthCheck` and `Customer` interfaces
- `apps/web/src/pages/Dashboard.tsx` — WAITING badge, LOAN indicator, pre-booked count
- `apps/web/src/pages/HealthChecks/HealthCheckDetail.tsx` — Pre-Booked Work section, Days on Site, indicators
- `apps/web/src/pages/HealthChecks/HealthCheckList.tsx` — Days on Site column with color highlighting
- `supabase/migrations/20260116500001_phase1_quick_wins.sql` — New migration

---

## ✅ Phase D Complete (2026-01-16)

### D.1 - New Status Values Added
**Migration:** `20260116400001_add_arrival_statuses.sql`
- Added `awaiting_arrival` status (before `created` in enum)
- Added `no_show` status (after `cancelled` in enum)
- Added `arrived_at` timestamp column to `health_checks` table

**Status Flow:**
```
DMS Import → awaiting_arrival → Mark Arrived → created → assigned → in_progress → ...
                              → No Show → no_show
```

### D.2 - Dashboard Awaiting Arrival Section
**Location:** Main Dashboard (/) - appears after Alerts section
- Shows up to 10 health checks in `awaiting_arrival` status
- Displays: Registration, Vehicle (make/model), Customer name, Promise time
- Refresh button to reload data
- "View All" link to filtered health checks list
- **Mark Arrived** button (green) - transitions to `created` status
- **No Show** button (gray) - transitions to `no_show` status

### D.3 - DMS Integration Page Updates
**Location:** Settings > DMS Integration > Awaiting Arrival section
- Fixed display bug - API now returns flat structure matching frontend interface
- Added "Arrived" button per row
- Added "No Show" button per row
- Fixed date/time display issues

### D.4 - API Endpoints Added
**POST** `/api/v1/health-checks/:id/mark-arrived`
- Transitions from `awaiting_arrival` → `created`
- Records `arrived_at` timestamp
- Logs in status history

**POST** `/api/v1/health-checks/:id/mark-no-show`
- Transitions from `awaiting_arrival` → `no_show`
- Accepts optional `notes` in request body
- Logs in status history

### Files Modified
- `apps/api/src/routes/health-checks.ts` - Added mark-arrived & mark-no-show endpoints, updated validTransitions, added arrived_at/external_id/external_source to detail response
- `apps/api/src/routes/dms-settings.ts` - Fixed /unactioned to return flat data structure, query for awaiting_arrival
- `apps/api/src/routes/dashboard.ts` - Added no_show to actioned statusGroups
- `apps/api/src/jobs/dms-import.ts` - Changed initial status from 'created' to 'awaiting_arrival'
- `apps/web/src/pages/Dashboard.tsx` - Added Awaiting Arrival section with action buttons
- `apps/web/src/pages/Settings/DMSIntegration.tsx` - Added action handlers and buttons to table
- `supabase/migrations/20260116400001_add_arrival_statuses.sql` - New migration

### Verification (2026-01-16)
All Phase D functionality tested and working:

| Test | Result |
|------|--------|
| Dashboard shows Awaiting Arrival section | ✅ Pass |
| Table displays correctly (no empty columns) | ✅ Pass |
| Mark Arrived → status changes to `created` | ✅ Pass |
| Mark Arrived → `arrived_at` timestamp set | ✅ Pass |
| No Show → status changes to `no_show` | ✅ Pass |
| Health check appears in technician queue | ✅ Pass (21 in queue) |
| Refresh button syncs bookings | ✅ Pass (job queued) |

**Fix Applied During Verification:**
- Health check detail endpoint (`GET /api/v1/health-checks/:id`) was missing `arrived_at`, `external_id`, `external_source` fields in response
- Added these fields to the response object at line 488-490

---

## ✅ Import Working (2026-01-16)

**Test Results:**
```
bookingsFound: 25
bookingsImported: 25
healthChecksCreated: 25
success: true
```

**Issues Found and Fixed:**

1. **Missing `mileage` column on `vehicles` table**
   - Error: `Could not find the 'mileage' column of 'vehicles' in the schema cache`
   - Fix: Added migration `20260116000003_add_vehicle_mileage.sql`

2. **Missing `notes` and `promise_time` columns on `health_checks` table**
   - Error: `Could not find the 'notes' column of 'health_checks' in the schema cache`
   - Fix: Added columns to same migration

3. **`site_id` NOT NULL constraint**
   - Error: `null value in column "site_id" violates not-null constraint`
   - Fix: Import now gets default site if none provided

4. **Sites table has no `is_active` column**
   - Error: `column "is_active" does not exist`
   - Fix: Removed `is_active` filter from site query

**Migration Applied:**
```sql
-- 20260116000003_add_vehicle_mileage.sql
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mileage INTEGER;
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS promise_time TIMESTAMPTZ;
```

**Files Modified:**
- `apps/api/src/jobs/dms-import.ts` - Debug logging + default site handling
- `apps/api/src/services/gemini-osi.ts` - Debug logging + raw response file save
- `supabase/migrations/20260116000003_add_vehicle_mileage.sql` - New migration

---

## ⚠️ Review Gates & Hard Stops

**STOP before proceeding to each phase. Manual review required.**

### Gate 1: Before First Import (After Phase C)
- [x] **Review:** Test connection works in settings UI ✅ (Fixed .env issue, URL encoding)
- [x] **Review:** Preview import shows expected bookings ✅ (25 bookings found)
- [x] **Review:** Field mappings look correct ✅ (Customer, Vehicle, Health Check all created)
- [x] **Review:** No duplicate detection issues ✅ (Re-running import skips already imported)
- [x] **Sign-off:** Leo confirms ready for first real import ✅ (2026-01-16)

**Issues Found & Fixed in Gate 1:**
1. **.env malformed** - `ENCRYPTION_KEY` and `PUBLIC_APP_URL` on same line → Fixed
2. **Missing DB columns** - `daily_import_limit` not in schema → Ran migration
3. **DateTime parsing** - URLSearchParams encoded colons as `%3A` → Manual query string building
4. **Missing `mileage` column on vehicles** → Added via migration
5. **Missing `notes`, `promise_time` on health_checks** → Added via migration
6. **Site ID required but not passed** → Added default site lookup

### Gate 2: After First Manual Import
- [x] **Review:** Imported health checks appear correctly ✅ (25 in Kanban, detail pages working)
- [x] **Review:** Customer data is complete and accurate ✅ (e.g., Tobey Graham, 07786897278)
- [x] **Review:** Vehicle data matches (reg, make, model) ✅ (e.g., T19TKG, Ford Ecosport)
- [x] **Review:** No duplicates created ✅ (re-running import skips existing)
- [x] **Review:** Status is `awaiting_arrival` ✅ (Fixed in Phase D - imports now use awaiting_arrival)
- [x] **Sign-off:** Leo confirms data quality acceptable ✅ (2026-01-16)

**Gate 2 Findings (2026-01-16):**

1. **Health Checks List**: 25 imported health checks visible in Kanban (Technician Queue)
2. **Detail Page**: Shows correct data - registration, vehicle, customer, contact, date
3. **Awaiting Arrival Section**: EXISTS on DMS Integration settings page (not main dashboard)
   - Shows "10 health checks waiting for vehicle arrival"
   - Has "Refresh" and "View All" buttons
   - ⚠️ **BUG**: Table columns (Registration, Vehicle, Customer) are empty
   - ⚠️ **BUG**: Promise Time shows "00:00", Imported shows "Invalid Date"
4. **Mark Arrived**: NOT implemented (Phase D pending)
5. **No Show**: NOT implemented (Phase D pending)
6. **Health Check Status**: Shows "Created" not "awaiting_arrival" - need to verify status values

### Gate 3: Before Enabling Auto-Import
- [ ] **Review:** Manual imports working reliably for 2-3 days
- [ ] **Review:** Import history shows no errors
- [ ] **Review:** Dashboard "Awaiting Arrival" section working
- [ ] **Review:** "Mark Arrived" flow works correctly
- [ ] **Sign-off:** Leo enables scheduled auto-import

### Gate 4: After First Auto-Import
- [ ] **Review:** Scheduled import ran at correct time
- [ ] **Review:** Correct bookings imported (not yesterday's, not duplicates)
- [ ] **Review:** No unexpected data created
- [ ] **Sign-off:** Leo confirms auto-import approved for ongoing use

---

## Safety Features to Implement

| Feature | Purpose |
|---------|---------|
| **Preview before import** | See what WILL be imported without creating data |
| **Import history log** | Track every import: count, errors, who triggered |
| **Duplicate detection** | Skip bookings already imported (by BookingID) |
| **Dry-run mode** | Test import logic without writing to database |
| **Daily limit** | Max imports per day to prevent runaway jobs |
| **Rollback capability** | Delete all health checks from a specific import batch |

### Rollback Implementation
```sql
-- Add import_batch_id to track which import created each record
ALTER TABLE health_checks ADD COLUMN import_batch_id UUID REFERENCES dms_import_history(id);

-- Rollback a bad import
DELETE FROM health_checks WHERE import_batch_id = 'xxx-xxx-xxx';
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v2/workshop/get-diary-bookings` | GET | Fetch today's bookings |
| `/api/v2/customers/get-customer-list` | GET | Fetch full customer details |

**Use case for customer list:**
- Booking data may have limited customer fields
- Use `CustomerID` from booking to fetch full customer record
- Get complete address, contact preferences, GDPR flags, vehicle history

---

## Overview

**Goal:** Import daily workshop bookings from Gemini OSI → Create health checks automatically

**Workflow:**
1. Scheduled imports fetch today's bookings (4x daily: 6am, 10am, 2pm, 8pm)
2. Manual "Refresh" button for same-day bookings between scheduled imports
3. Health checks created with status: `awaiting_arrival`
4. Service Advisor marks vehicle as "on site" when customer arrives
5. Normal VHC flow continues

**Import Schedule:**
| Time | Purpose |
|------|---------|
| 06:00 | Morning — catches overnight bookings |
| 10:00 | Mid-morning — catches early same-day bookings |
| 14:00 | Afternoon — catches lunch-time bookings |
| 20:00 | Evening — prep for next day |
| Manual | 🔄 Refresh button for urgent same-day jobs |

---

## PHASE A: API Exploration (Manual Testing)

### A.1 Test Connection

**Base URL:** `https://central-2304.geminiosi.co.uk/`

**Credentials:**
- Username: `LeoDack`
- Password: `lgBh$&19d`

**Test endpoint:** `GET /api/v2/workshop/get-diary-bookings`

```bash
# Try basic auth first
curl -X GET "https://central-2304.geminiosi.co.uk/api/v2/workshop/get-diary-bookings?StartTime=$(date +%Y-%m-%d)T00:00:00&EndTime=$(date +%Y-%m-%d)T23:59:59" \
  -H "Content-Type: application/json" \
  -u "LeoDack:lgBh\$&19d"

# If that fails, try bearer token (may need to get token first)
# Check if there's an auth endpoint like /api/auth/token
```

**Questions to answer:** ✅ ALL COMPLETED
- [x] What authentication method? Basic Auth (username:password)
- [x] Is there a separate auth endpoint? No - inline basic auth
- [x] What's the exact base URL for API calls? https://central-2304.geminiosi.co.uk
- [x] Does the demo URL differ from production URL? TBD per organization

### A.2 Fetch Sample Data

Once connected, fetch today's bookings:

```bash
# Get today's bookings
curl -X GET "https://central-2304.geminiosi.co.uk/api/v2/workshop/get-diary-bookings?StartTime=2026-01-15T00:00:00&EndTime=2026-01-15T23:59:59" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Save response to file for analysis:**
```bash
curl ... > gemini_sample_response.json
```

### A.3 Document Response Structure

**✅ DISCOVERED - Actual API Response Structure:**

```json
{
  "error": { "message": "", "code": 0 },
  "result": {
    "Bookings": [
      {
        "BookingID": 12345,
        "DueDateTime": "2026-01-15T09:00:00",
        "CollectionDateTime": "2026-01-15T17:00:00",
        "Workshop": "Service",
        "ArrivalStatus": "PENDING",
        "CustomerWaiting": false,
        "LoanCar": false,
        "Internal": false,
        "Notes": "Full service + MOT",
        "Duration": 4.5,
        "Vehicle": {
          "Registration": "AB12 CDE",
          "ChassisNumber": "WDB1234567890",
          "Make": "Mercedes",
          "Model": "C Class",
          "Colour": "Silver",
          "FuelType": "Diesel"
        },
        "InvoiceTo": {
          "CustomerID": 12345,
          "Forename": "John",
          "Surname": "Smith",
          "Mobile": "07700900123",
          "Telephone": "01onal234567",
          "Email": "john@example.com",
          "Street1": "123 Main Road",
          "Town": "Birmingham",
          "County": "West Midlands",
          "Postcode": "B1 1AA"
        },
        "DeliverTo": {
          // Same structure as InvoiceTo
        },
        "Jobsheet": {
          "Number": "JS12345",
          "Status": "Open",
          "Total": 250.00,
          "Repairs": [...]
        }
      }
    ]
  }
}
```

**✅ ANSWERS FROM EXPLORATION:**

| Question | Answer |
|----------|--------|
| Authentication | Basic Auth (username:password) |
| HTTP Method | GET with query parameters |
| Vehicle.VIN field | `ChassisNumber` (not VIN) |
| Customer name | `Forename` + `Surname` (not Name) |
| Address fields | `Street1`, `Town`, `County`, `Postcode` |
| ArrivalStatus values | `PENDING`, `CHECKED IN` |
| Jobsheet | Object with `Number`, `Status`, `Total`, `Repairs` |
| Site parameter | Integer, optional |

---

## PHASE B: Data Mapping

Once we have sample data, map Gemini fields → VHC fields.

### B.1 Vehicle Mapping

| Gemini Field | VHC Field | Notes |
|--------------|-----------|-------|
| `Vehicle.Registration` | `vehicles.registration` | Required |
| `Vehicle.Make` | `vehicles.make` | |
| `Vehicle.Model` | `vehicles.model` | |
| `Vehicle.ChassisNumber` | `vehicles.vin` | Note: Gemini uses ChassisNumber |
| `Vehicle.Colour` | `vehicles.color` | |
| `Vehicle.FuelType` | `vehicles.fuel_type` | |

### B.2 Customer Mapping

| Gemini Field | VHC Field | Notes |
|--------------|-----------|-------|
| `InvoiceTo.Forename` + `InvoiceTo.Surname` | `customers.name` | Combine with space |
| `InvoiceTo.Telephone` | `customers.phone` | Landline |
| `InvoiceTo.Mobile` | `customers.mobile` | Primary contact |
| `InvoiceTo.Email` | `customers.email` | |
| `InvoiceTo.Street1` | `customers.address_line1` | |
| `InvoiceTo.Town` | `customers.city` | |
| `InvoiceTo.County` | `customers.county` | |
| `InvoiceTo.Postcode` | `customers.postcode` | |
| `InvoiceTo.CustomerID` | `customers.external_id` | For matching |

**Enhanced customer import (optional):**
If booking `InvoiceTo` data is incomplete, use `CustomerID` to fetch full details:
```typescript
// In import service
const booking = ...; // from diary bookings
let customerData = booking.InvoiceTo;

// If missing key fields, fetch full customer record
if (!customerData.Email || !customerData.Mobile) {
  const fullCustomer = await geminiClient.getCustomerById(customerData.CustomerID);
  if (fullCustomer) {
    customerData = { ...customerData, ...fullCustomer };
  }
}
```

### B.3 Health Check Mapping

| Gemini Field | VHC Field | Notes |
|--------------|-----------|-------|
| `BookingID` | `health_checks.external_id` | Prevent duplicates |
| `DueDateTime` | `health_checks.scheduled_date` | When expected |
| `CollectionDateTime` | `health_checks.promise_time` | When to be ready |
| `Notes` | `health_checks.advisor_notes` | Job description |
| `Jobsheet.Number` | `health_checks.job_number` | Reference |
| `Workshop` | - | Filter? Only import certain types? |
| `ArrivalStatus` | - | Only import "Expected"? |
| `Duration` | - | Estimated time |

### B.4 Filtering Rules

Define which bookings to import:

```javascript
function shouldImportBooking(booking) {
  // Only import if:
  // 1. Has a vehicle registration
  if (!booking.Vehicle?.Registration) return false;
  
  // 2. Is pending arrival (not already checked in/completed)
  // ArrivalStatus values: 'PENDING', 'CHECKED IN'
  if (booking.ArrivalStatus !== 'PENDING') return false;
  
  // 3. Is a relevant workshop type (exclude internal?)
  if (booking.Internal === true) return false;
  
  // 4. Not already imported (check external_id)
  // This is checked in database
  
  return true;
}
```

---

## PHASE C: Implementation

### C.1 Database Updates

```sql
-- Add external IDs for matching
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS external_source VARCHAR(50); -- 'gemini_osi'
ALTER TABLE customers ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);

-- Index for duplicate checking
CREATE UNIQUE INDEX idx_health_checks_external 
  ON health_checks(organization_id, external_source, external_id) 
  WHERE external_id IS NOT NULL;

-- Add awaiting_arrival status if not exists
-- Check current status enum/values
```

### C.2 DMS Settings Table

```sql
-- Per-organization DMS settings (similar to notification settings)
CREATE TABLE organization_dms_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Provider
  provider VARCHAR(50) DEFAULT 'gemini_osi',
  is_enabled BOOLEAN DEFAULT false,
  
  -- Credentials (encrypted)
  api_base_url TEXT,
  api_username_encrypted TEXT,
  api_password_encrypted TEXT,
  api_token_encrypted TEXT,  -- If using token auth
  
  -- Site mapping (Gemini site ID → VHC site ID)
  site_mapping JSONB DEFAULT '{}',
  
  -- Import settings
  auto_import_enabled BOOLEAN DEFAULT false,
  -- Multiple import times (array of hours in 24h format)
  import_schedule_hours INTEGER[] DEFAULT '{6, 10, 14, 20}',  -- 6am, 10am, 2pm, 8pm
  import_days_ahead INTEGER DEFAULT 0,     -- 0 = today only
  
  -- Filters
  workshop_types JSONB DEFAULT '[]',       -- Empty = all
  exclude_internal BOOLEAN DEFAULT true,
  
  -- Safety limits
  daily_import_limit INTEGER DEFAULT 100,
  
  -- Default template for created health checks
  default_template_id UUID REFERENCES check_templates(id),
  
  -- Last import
  last_import_at TIMESTAMPTZ,
  last_import_status VARCHAR(50),
  last_import_count INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id)
);
```

### C.3 Import History Table

```sql
CREATE TABLE dms_import_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'running', -- running, completed, failed
  
  -- Stats
  bookings_fetched INTEGER DEFAULT 0,
  bookings_imported INTEGER DEFAULT 0,
  bookings_skipped INTEGER DEFAULT 0,
  bookings_failed INTEGER DEFAULT 0,
  
  -- Details
  errors JSONB DEFAULT '[]',
  
  -- Trigger
  triggered_by VARCHAR(50), -- 'schedule', 'manual'
  triggered_by_user_id UUID REFERENCES users(id)
);
```

### C.4 API Endpoints

```
# DMS Settings (Org Admin)
GET    /api/v1/organizations/:id/dms-settings
PATCH  /api/v1/organizations/:id/dms-settings
POST   /api/v1/organizations/:id/dms-settings/test-connection

# Import (Org Admin)
POST   /api/v1/organizations/:id/dms/import          -- Manual import
GET    /api/v1/organizations/:id/dms/import-history  -- View history
GET    /api/v1/organizations/:id/dms/preview         -- Preview what would be imported
```

### C.5 Gemini API Client

```typescript
// /apps/api/src/services/gemini-osi.ts

interface GeminiConfig {
  baseUrl: string;
  username: string;
  password: string;
}

interface GeminiBooking {
  BookingID: number;
  DueDateTime: string;
  CollectionDateTime: string;
  Workshop: string;
  ArrivalStatus: 'PENDING' | 'CHECKED IN';
  CustomerWaiting: boolean;
  LoanCar: boolean;
  Internal: boolean;
  Notes: string;
  Duration: number;
  Vehicle: {
    Registration: string;
    ChassisNumber: string;  // This is the VIN
    Make: string;
    Model: string;
    Colour: string;
    FuelType: string;
  };
  InvoiceTo: {
    CustomerID: number;
    Forename: string;
    Surname: string;
    Mobile: string;
    Telephone: string;
    Email: string;
    Street1: string;
    Town: string;
    County: string;
    Postcode: string;
  };
  DeliverTo: object;
  Jobsheet: {
    Number: string;
    Status: string;
    Total: number;
    Repairs: any[];
  };
}

interface GeminiResponse {
  error: { message: string; code: number };
  result: { Bookings: GeminiBooking[] };
}

// TODO: Explore /api/v2/customers/get-customer-list to confirm structure
interface GeminiCustomer {
  CustomerID: number;
  Forename: string;
  Surname: string;
  Title?: string;
  Mobile: string;
  Telephone: string;
  Email: string;
  Street1: string;
  Street2?: string;
  Town: string;
  County: string;
  Postcode: string;
  // Likely additional fields:
  GDPRConsent?: boolean;
  MarketingConsent?: boolean;
  DateOfBirth?: string;
  Notes?: string;
  Vehicles?: any[];  // Linked vehicles?
}

export class GeminiOsiClient {
  private config: GeminiConfig;
  
  constructor(config: GeminiConfig) {
    this.config = config;
  }
  
  private getAuthHeader(): string {
    // Basic Auth - base64 encode username:password
    const credentials = Buffer.from(
      `${this.config.username}:${this.config.password}`
    ).toString('base64');
    return `Basic ${credentials}`;
  }
  
  async getDiaryBookings(date: Date, siteId?: number): Promise<GeminiBooking[]> {
    const startTime = `${date.toISOString().split('T')[0]}T00:00:00`;
    const endTime = `${date.toISOString().split('T')[0]}T23:59:59`;
    
    // Use GET with query parameters (not POST)
    const params = new URLSearchParams({
      StartTime: startTime,
      EndTime: endTime,
    });
    
    if (siteId) {
      params.append('Site', siteId.toString());
    }
    
    const url = `${this.config.baseUrl}/api/v2/workshop/get-diary-bookings?${params}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }
    
    // Response is wrapped in { error, result }
    const data: GeminiResponse = await response.json();
    
    if (data.error?.code !== 0) {
      throw new Error(`Gemini API error: ${data.error.message}`);
    }
    
    return data.result?.Bookings || [];
  }
  
  async testConnection(): Promise<{ success: boolean; error?: string; count?: number }> {
    try {
      const bookings = await this.getDiaryBookings(new Date());
      return { success: true, count: bookings.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  async getCustomerList(customerIds?: number[]): Promise<GeminiCustomer[]> {
    // Fetch full customer details
    // Use when booking InvoiceTo data is incomplete
    const params = new URLSearchParams();
    
    if (customerIds?.length) {
      params.append('CustomerIDs', customerIds.join(','));
    }
    
    const url = `${this.config.baseUrl}/api/v2/customers/get-customer-list?${params}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error?.code !== 0) {
      throw new Error(`Gemini API error: ${data.error.message}`);
    }
    
    return data.result?.Customers || [];
  }
  
  async getCustomerById(customerId: number): Promise<GeminiCustomer | null> {
    const customers = await this.getCustomerList([customerId]);
    return customers[0] || null;
  }
}
```

### C.6 Import Service

```typescript
// /apps/api/src/services/dms-import.ts

export async function importBookingsForOrganization(
  organizationId: string,
  triggeredBy: 'schedule' | 'manual',
  userId?: string
): Promise<ImportResult> {
  // 1. Get org DMS settings
  const settings = await getOrgDmsSettings(organizationId);
  if (!settings?.is_enabled) {
    return { skipped: true, reason: 'DMS not enabled' };
  }
  
  // 2. Create import history record
  const importRecord = await createImportRecord(organizationId, triggeredBy, userId);
  
  // 3. Initialize Gemini client with decrypted credentials
  const client = new GeminiOsiClient({
    baseUrl: settings.api_base_url,
    username: decrypt(settings.api_username_encrypted),
    password: decrypt(settings.api_password_encrypted),
  });
  
  try {
    // 4. Fetch today's bookings
    const bookings = await client.getDiaryBookings(new Date());
    
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    
    // 5. Process each booking
    for (const booking of bookings) {
      try {
        // Skip if already imported
        const existing = await findHealthCheckByExternalId(
          organizationId,
          'gemini_osi',
          booking.BookingID.toString()
        );
        
        if (existing) {
          skipped++;
          continue;
        }
        
        // Skip based on filters
        if (!shouldImportBooking(booking, settings)) {
          skipped++;
          continue;
        }
        
        // Find or create customer
        const customer = await findOrCreateCustomer(organizationId, booking.InvoiceTo);
        
        // Find or create vehicle
        const vehicle = await findOrCreateVehicle(organizationId, customer.id, booking.Vehicle);
        
        // Determine site (from mapping)
        const siteId = settings.site_mapping[booking.Site] || settings.default_site_id;
        
        // Create health check
        await createHealthCheck({
          organization_id: organizationId,
          site_id: siteId,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          template_id: settings.default_template_id,
          status: 'awaiting_arrival',
          external_id: booking.BookingID.toString(),
          external_source: 'gemini_osi',
          scheduled_date: booking.DueDateTime,
          promise_time: booking.CollectionDateTime,
          job_number: booking.Jobsheet?.Number,
          advisor_notes: booking.Notes,
        });
        
        imported++;
      } catch (err) {
        failed++;
        errors.push({ bookingId: booking.BookingID, error: err.message });
      }
    }
    
    // 6. Update import record
    await updateImportRecord(importRecord.id, {
      status: 'completed',
      completed_at: new Date(),
      bookings_fetched: bookings.length,
      bookings_imported: imported,
      bookings_skipped: skipped,
      bookings_failed: failed,
      errors,
    });
    
    return { success: true, imported, skipped, failed };
    
  } catch (error) {
    await updateImportRecord(importRecord.id, {
      status: 'failed',
      completed_at: new Date(),
      errors: [{ error: error.message }],
    });
    
    throw error;
  }
}
```

### C.7 Settings UI

Add to `/settings/integrations`:

**⚠️ IMPORTANT: Preview is mandatory before first import**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Settings > Integrations                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DMS INTEGRATION (Gemini OSI)                                               │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  [Toggle] Enable DMS Integration                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  API Base URL                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  https://central-2304.geminiosi.co.uk                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Username                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  LeoDack                                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Password                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ••••••••••                                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────┐                                                   │
│  │  Test Connection    │   Status: ✅ Connected (24 bookings today)       │
│  └─────────────────────┘                                                   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  IMPORT SETTINGS                                                            │
│                                                                             │
│  ☐ Enable automatic daily import  ⚠️ Complete Gate 3 review first         │
│                                                                             │
│  Import schedule                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ☑ 06:00  — Morning (overnight bookings)                           │   │
│  │  ☑ 10:00  — Mid-morning                                            │   │
│  │  ☑ 14:00  — Afternoon                                              │   │
│  │  ☑ 20:00  — Evening (next-day prep)                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Default template for imported checks                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Full Vehicle Health Check                                      ▼   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ☑ Exclude internal jobs                                                   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  MANUAL IMPORT                                                              │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐                          │
│  │  Preview Import     │  │  Import Now         │  ← Disabled until       │
│  └─────────────────────┘  └─────────────────────┘    preview reviewed      │
│                                                                             │
│  Last import: Today at 06:00 — 12 bookings imported, 3 skipped             │
│                                                                             │
│  [View Import History]                                                      │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Save Changes                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### C.8 Preview Modal

**Must review before importing:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Preview Import — 24 bookings found                                    ✕    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Date: Friday 16 January 2026                                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ WILL IMPORT (18)                                                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Reg        Customer         Due    Workshop   Status                │   │
│  │ AB12 CDE   John Smith       09:00  Service    PENDING               │   │
│  │ XY34 FGH   Jane Doe         09:30  MOT        PENDING               │   │
│  │ GH56 IJK   Bob Wilson       10:00  Service    PENDING               │   │
│  │ ...                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ WILL SKIP (6)                                                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Reg        Customer         Reason                                  │   │
│  │ LM78 NOP   Internal Test    Internal job                            │   │
│  │ QR90 STU   Already Here     Status: CHECKED IN                      │   │
│  │ VW12 XYZ   John Smith       Already imported (ID: 12345)            │   │
│  │ ...                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ☐ I have reviewed this preview and confirm the data looks correct         │
│                                                                             │
│  ┌───────────────┐  ┌───────────────┐                                      │
│  │    Cancel     │  │ Import Now    │  ← Enabled when checkbox ticked      │
│  └───────────────┘  └───────────────┘                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## PHASE D: Awaiting Arrival Status

### D.1 Add Status to Workflow

Update health check statuses to include `awaiting_arrival`:

```typescript
const STATUS_FLOW = {
  'awaiting_arrival': ['arrived', 'no_show', 'cancelled'],
  'arrived': ['assigned', 'cancelled'],
  'assigned': ['in_progress', 'cancelled'],
  // ... rest of existing flow
};
```

### D.2 Dashboard Updates

Add "Awaiting Arrival" section to dashboard:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AWAITING ARRIVAL (8)                        [🔄 Refresh]        [View All] │
│  Last synced: 10:02am                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  AB12 CDE    John Smith      09:00    Full Service    [Mark Arrived]│   │
│  │  XY34 FGH    Jane Doe        09:30    MOT + Service   [Mark Arrived]│   │
│  │  GH56 IJK    Bob Wilson      10:00    Brake Check     [Mark Arrived]│   │
│  │  ...                                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Refresh button:** Triggers manual import for same-day bookings added after last scheduled import.

### D.3 "Mark Arrived" Action

When service advisor clicks "Mark Arrived":
1. Update status: `awaiting_arrival` → `arrived`
2. Record arrival time
3. Show in technician queue for assignment

---

## Execution Prompts

### Prompt 1: API Exploration — ✅ COMPLETED

Phase A has been completed. Key findings:
- Basic Auth works
- GET method with query parameters
- Response wrapped in `{ error, result }`
- Field names discovered and documented above

### Prompt 2: Complete Implementation with Safety Features

```bash
claude -p "Read docs/vhc-gemini-dms-plan.md. Complete Phase C with safety features: 1) Add import_batch_id to health_checks for rollback capability, 2) Build Preview Import endpoint that returns what WILL be imported vs skipped WITHOUT creating data, 3) Build Preview Modal UI showing will-import and will-skip lists with reasons, 4) Require preview confirmation checkbox before Import Now button is enabled, 5) Auto-import toggle should be disabled by default with warning 'Complete Gate 3 review first', 6) Add daily import limit (default 100) as safety net, 7) Test connection should show booking count. Verify all safety features work before proceeding." --dangerously-skip-permissions
```

### Prompt 3: Dashboard Integration (After Gate 2 Sign-off)

```bash
claude -p "Add 'Awaiting Arrival' section to dashboard. Show health checks with status awaiting_arrival, sorted by scheduled time. Include: registration, customer name, scheduled time, job type (from notes). Add 'Mark Arrived' button that changes status to 'arrived' and records arrival_time. Add 'No Show' button for vehicles that don't arrive. Include count badge in sidebar navigation." --dangerously-skip-permissions
```

### Prompt 4: Explore Customer Endpoint

```bash
claude -p "Explore the Gemini customer endpoint: GET /api/v2/customers/get-customer-list. Base URL: https://central-2304.geminiosi.co.uk/ Credentials: LeoDack / lgBh\$&19d. Test what parameters it accepts, document response structure, check for GDPR flags. Update the GeminiOsiClient with getCustomerList method. Update docs/vhc-gemini-dms-plan.md with findings." --dangerously-skip-permissions
```

---

## Implementation Notes (From Claude Code)

### Endpoints to Explore

**Customer List Endpoint — needs exploration:**
```bash
curl -X GET "https://central-2304.geminiosi.co.uk/api/v2/customers/get-customer-list" \
  -H "Content-Type: application/json" \
  -u "LeoDack:lgBh\$&19d"
```

Questions to answer:
- [ ] What query parameters does it accept? (CustomerID, search term?)
- [ ] What fields are in the customer response?
- [ ] Does it include GDPR/marketing consent flags?
- [ ] Does it include linked vehicles?

### Worker Added
A DMS import worker has been added to `worker.ts` to handle:
- `dms_import` — Manual import jobs
- `dms_scheduled_import` — Scheduled daily imports

Ensure the worker is running (`npm run dev:all`) for imports to process.

### Key Code Fixes Made
1. Changed from POST to GET method
2. Added Basic Auth header generation
3. Updated response parsing for `{ error, result }` wrapper
4. Fixed field mappings:
   - `CustomerID` (not `Id`)
   - `ChassisNumber` (not `VIN`)
   - `Forename` + `Surname` (not `Name`)
   - `Street1`, `Town`, `County` (not `Address1`, etc.)
   - `Jobsheet.Number` (object property, not array)
5. Fixed .env formatting - ENCRYPTION_KEY was concatenated with PUBLIC_APP_URL
6. Fixed URL encoding - built query string manually to avoid encoding colons in datetime

### Debug Logging Added (2026-01-16)

**`gemini-osi.ts`:**
- `[Gemini]` prefix for all logs
- Logs full raw API response to `docs/gemini-full-response-sample.json`
- Logs first raw booking for field inspection

**`dms-import.ts`:**
- `[DMS Import]` prefix for all logs
- Logs each booking's raw data before processing
- Logs customer lookup/create results
- Logs vehicle lookup/create results (validates `vehicleReg` is present)
- Logs health check insert data and results
- Logs final import summary

**To run import with debug output:**
```bash
# Trigger manual import via API
curl -X POST http://localhost:5180/api/v1/dms-settings/import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-01-16"}'
```

Then check the API server console for `[DMS Import]` and `[Gemini]` logs.

---

## Questions to Answer in Phase A

✅ All questions answered during API exploration:

1. **Authentication:** ✅ Basic Auth (username:password base64 encoded)
2. **HTTP Method:** ✅ GET with query parameters (not POST)
3. **Vehicle fields:** ✅ Registration, ChassisNumber, Make, Model, Colour, FuelType
4. **Customer fields:** ✅ CustomerID, Forename, Surname, Mobile, Telephone, Email, Street1, Town, County, Postcode
5. **Site handling:** ✅ Integer parameter, optional
6. **ArrivalStatus values:** ✅ `PENDING`, `CHECKED IN`
7. **Jobsheet structure:** ✅ Object with Number, Status, Total, Repairs array
8. **Response wrapper:** ✅ `{ error: {...}, result: { Bookings: [...] } }`
