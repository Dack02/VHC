# Gemini OSI DMS Integration — Exploration & Build Plan

## Overview

**Goal:** Import daily workshop bookings from Gemini OSI → Create health checks automatically

**Workflow:**
1. Nightly/morning import fetches today's bookings
2. Health checks created with status: `awaiting_arrival`
3. Service Advisor marks vehicle as "on site" when customer arrives
4. Normal VHC flow continues

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

**Questions to answer:**
- [ ] What authentication method? (Basic auth, Bearer token, API key?)
- [ ] Is there a separate auth endpoint to get a token?
- [ ] What's the exact base URL for API calls?
- [ ] Does the demo URL differ from production URL?

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

Expected structure (from docs):
```json
{
  "Bookings": [
    {
      "BookingID": 12345,
      "DueDateTime": "2026-01-15T09:00:00",
      "CollectionDateTime": "2026-01-15T17:00:00",
      "Workshop": "Service",
      "ArrivalStatus": "Expected",
      "CustomerWaiting": false,
      "LoanCar": false,
      "Internal": false,
      "Notes": "Full service + MOT",
      "Vehicle": {
        // What fields? Registration, Make, Model, VIN?
      },
      "InvoiceTo": {
        // Customer details? Name, Phone, Email, Address?
      },
      "DeliverTo": {
        // Same as InvoiceTo or different?
      },
      "Jobsheet": {
        // Job number? Work items?
      },
      "Duration": 4.5
    }
  ]
}
```

**Questions to answer from real response:**
- [ ] What fields are in `Vehicle` object?
- [ ] What fields are in `InvoiceTo` object (customer)?
- [ ] What's the difference between `InvoiceTo` and `DeliverTo`?
- [ ] What fields are in `Jobsheet`?
- [ ] What values does `ArrivalStatus` have?
- [ ] What values does `Workshop` have?
- [ ] Is `Site` parameter needed for multi-site orgs?

---

## PHASE B: Data Mapping

Once we have sample data, map Gemini fields → VHC fields.

### B.1 Vehicle Mapping

| Gemini Field | VHC Field | Notes |
|--------------|-----------|-------|
| `Vehicle.Registration` | `vehicles.registration` | Required |
| `Vehicle.Make` | `vehicles.make` | |
| `Vehicle.Model` | `vehicles.model` | |
| `Vehicle.VIN` | `vehicles.vin` | May be empty |
| `Vehicle.Colour` | `vehicles.color` | |
| `Vehicle.Year` | `vehicles.year` | Or RegistrationDate? |
| `Vehicle.Mileage` | `health_checks.mileage_in` | Latest mileage |
| `Vehicle.FuelType` | `vehicles.fuel_type` | |

### B.2 Customer Mapping

| Gemini Field | VHC Field | Notes |
|--------------|-----------|-------|
| `InvoiceTo.Name` | `customers.name` | Split first/last? |
| `InvoiceTo.Phone` | `customers.phone` | |
| `InvoiceTo.Mobile` | `customers.mobile` | Primary contact |
| `InvoiceTo.Email` | `customers.email` | |
| `InvoiceTo.Address` | `customers.address_*` | May need parsing |
| `InvoiceTo.Postcode` | `customers.postcode` | |
| `InvoiceTo.CustomerID` | `customers.external_id` | For matching |

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
  
  // 2. Is expected today (not already arrived/completed)
  if (booking.ArrivalStatus !== 'Expected') return false;
  
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
  import_schedule_hour INTEGER DEFAULT 6,  -- 6am default
  import_days_ahead INTEGER DEFAULT 0,     -- 0 = today only
  
  -- Filters
  workshop_types JSONB DEFAULT '[]',       -- Empty = all
  exclude_internal BOOLEAN DEFAULT true,
  
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
  ArrivalStatus: string;
  CustomerWaiting: boolean;
  LoanCar: boolean;
  Internal: boolean;
  Notes: string;
  Vehicle: {
    Registration: string;
    Make: string;
    Model: string;
    // ... to be discovered
  };
  InvoiceTo: {
    Name: string;
    Phone: string;
    Email: string;
    // ... to be discovered
  };
  DeliverTo: object;
  Jobsheet: {
    Number: string;
    // ... to be discovered
  };
  Duration: number;
}

export class GeminiOsiClient {
  private config: GeminiConfig;
  private token: string | null = null;
  
  constructor(config: GeminiConfig) {
    this.config = config;
  }
  
  async authenticate(): Promise<void> {
    // Implement based on actual auth method discovered in Phase A
  }
  
  async getDiaryBookings(date: Date, siteId?: number): Promise<GeminiBooking[]> {
    const startTime = `${date.toISOString().split('T')[0]}T00:00:00`;
    const endTime = `${date.toISOString().split('T')[0]}T23:59:59`;
    
    const params = new URLSearchParams({
      StartTime: startTime,
      EndTime: endTime,
    });
    
    if (siteId) {
      params.append('Site', siteId.toString());
    }
    
    const response = await fetch(
      `${this.config.baseUrl}/api/v2/workshop/get-diary-bookings?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.Bookings || [];
  }
  
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.authenticate();
      // Try to fetch a small date range
      await this.getDiaryBookings(new Date());
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
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
│  │  Test Connection    │   Status: ○ Not tested                           │
│  └─────────────────────┘                                                   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  IMPORT SETTINGS                                                            │
│                                                                             │
│  ☑ Enable automatic daily import                                           │
│                                                                             │
│  Import time                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  06:00                                                          ▼   │   │
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
│  │  Preview Import     │  │  Import Now         │                          │
│  └─────────────────────┘  └─────────────────────┘                          │
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
│  AWAITING ARRIVAL (8)                                            [View All] │
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

### D.3 "Mark Arrived" Action

When service advisor clicks "Mark Arrived":
1. Update status: `awaiting_arrival` → `arrived`
2. Record arrival time
3. Show in technician queue for assignment

---

## Execution Prompts

### Prompt 1: API Exploration

```bash
claude -p "Explore the Gemini OSI API. Base URL: https://central-2304.geminiosi.co.uk/ Credentials: LeoDack / lgBh\$&19d Endpoint: /api/v2/workshop/get-diary-bookings. Tasks: 1) Determine authentication method (basic auth, bearer token, or API key), 2) Successfully connect and fetch today's bookings, 3) Save a sample response to a file, 4) Document the FULL structure of Vehicle, InvoiceTo, DeliverTo, and Jobsheet objects, 5) List all possible values for ArrivalStatus and Workshop fields. Output findings to docs/gemini-api-exploration.md" --dangerously-skip-permissions
```

### Prompt 2: Build Integration (after exploration)

```bash
claude -p "Read docs/gemini-api-exploration.md and docs/vhc-multi-tenant-spec.md. Build the Gemini OSI DMS integration with multi-tenant support: 1) Create organization_dms_settings table with encrypted credentials, 2) Create dms_import_history table, 3) Add external_id columns to health_checks/customers/vehicles, 4) Build GeminiOsiClient service using discovered auth method, 5) Build import service that creates health checks with awaiting_arrival status, 6) Create API endpoints for settings, test connection, preview, and import, 7) Build settings UI at /settings/integrations. Use the field mappings discovered in exploration." --dangerously-skip-permissions
```

### Prompt 3: Dashboard Integration

```bash
claude -p "Add 'Awaiting Arrival' section to dashboard. Show health checks with status awaiting_arrival, sorted by scheduled time. Include: registration, customer name, scheduled time, job type. Add 'Mark Arrived' button that changes status to 'arrived'. Add no-show handling for vehicles that don't arrive." --dangerously-skip-permissions
```

---

## Questions to Answer in Phase A

1. **Authentication:** Basic auth? Token-based? API key header?
2. **Vehicle fields:** Full list of available fields?
3. **Customer fields:** Full list from InvoiceTo?
4. **Site handling:** Is Site parameter a number? How to map to VHC sites?
5. **ArrivalStatus values:** Expected, Arrived, Completed, NoShow?
6. **Workshop values:** Service, MOT, Bodyshop, etc.?
7. **Rate limits:** Any API rate limiting?
8. **Pagination:** Are results paginated for busy days?
