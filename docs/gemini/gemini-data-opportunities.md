# Gemini OSI Data Opportunities

**Created:** 2026-01-16
**Updated:** 2026-01-16
**Purpose:** Document additional data available from Gemini OSI API that could enhance VHC functionality

---

## Implementation Status

| Feature | Status | Migration | Notes |
|---------|--------|-----------|-------|
| Customer Address Fields | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | Street1/2, Town, County, Postcode |
| Customer Title | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | Added to customers table |
| Customer Waiting Flag | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | Red badge on dashboard |
| Loan Car Required | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | Blue indicator on dashboard |
| Booked Repairs | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | Pre-Booked Work section |
| Jobsheet Number/Status | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | Stored on health_checks |
| Due Date | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | DueDateTime from DMS |
| Booked Date | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | Import timestamp |
| Days on Site | IMPLEMENTED | N/A (calculated) | Color-coded in UI |
| Is Internal Flag | IMPLEMENTED | `20260116500001_phase1_quick_wins.sql` | Internal/trade jobs |
| DeliverTo Contact | NOT STARTED | - | Phase 2 |
| Vehicle Specification | NOT STARTED | - | Low priority |
| Engine Size | NOT STARTED | - | Low priority |

---

## Overview

The Gemini OSI `/api/v2/workshop/get-diary-bookings` endpoint returns more data than we currently utilize. This document outlines opportunities to enhance VHC by leveraging additional fields.

---

## Currently Used Fields

### From Booking
| Field | Mapped To | Notes |
|-------|-----------|-------|
| `BookingID` | `external_id` | Unique booking reference |
| `DueDateTime` | `promise_time`, `bookingDate/Time` | When customer should arrive |
| `CollectionDateTime` | `promiseTime` | When vehicle should be ready |
| `Workshop` | `serviceType` | Service type identifier |
| `ArrivalStatus` | `status` | Current booking state |
| `Notes` | `description` | Free-text notes |

### From InvoiceTo (Customer)
| Field | Mapped To | Notes |
|-------|-----------|-------|
| `CustomerID` | `external_id` | Customer reference |
| `Forename` | `first_name` | |
| `Surname` | `last_name` | |
| `Email` | `email` | |
| `Mobile` | `mobile` | |
| `Telephone` | `phone` | Fallback when mobile not available |

### From Vehicle
| Field | Mapped To | Notes |
|-------|-----------|-------|
| `Registration` | `registration`, `external_id` | Used as vehicle ID |
| `ChassisNumber` | `vin` | VIN/Chassis |
| `Make` | `make` | |
| `Model` | `model` | |
| `Colour` | `color` | |
| `FuelType` | `fuel_type` | |
| `CurrentMileage` | `mileage`, `mileage_in` | |

---

## Unused Fields - Enhancement Opportunities

### 1. Customer Address (High Value)
**Fields available:**
- `InvoiceTo.Street1`
- `InvoiceTo.Street2`
- `InvoiceTo.Town`
- `InvoiceTo.County`
- `InvoiceTo.Postcode`

**Use cases:**
- Pre-populate customer address in reports
- Enable location-based analytics
- Improve customer lookup by postcode
- Send automated communications with full address

**Implementation:**
```sql
ALTER TABLE customers ADD COLUMN address_line1 TEXT;
ALTER TABLE customers ADD COLUMN address_line2 TEXT;
ALTER TABLE customers ADD COLUMN town TEXT;
ALTER TABLE customers ADD COLUMN county TEXT;
ALTER TABLE customers ADD COLUMN postcode TEXT;
```

---

### 2. Customer Title (Medium Value)
**Field:** `InvoiceTo.Title`

**Use cases:**
- Personalized communications ("Dear Mr. Smith")
- Professional report headers

**Implementation:**
```sql
ALTER TABLE customers ADD COLUMN title TEXT;
```

---

### 3. DeliverTo Contact (Medium Value)
**When different from InvoiceTo:**
- `DeliverTo.CustomerID`
- `DeliverTo.Forename`
- `DeliverTo.Surname`
- `DeliverTo.Mobile`
- `DeliverTo.Telephone`
- `DeliverTo.Email`

**Use cases:**
- Fleet vehicles where driver != owner
- Corporate accounts
- Contact correct person for vehicle updates

**Implementation:**
```sql
ALTER TABLE health_checks ADD COLUMN contact_name TEXT;
ALTER TABLE health_checks ADD COLUMN contact_mobile TEXT;
ALTER TABLE health_checks ADD COLUMN contact_email TEXT;
```

---

### 4. Jobsheet Information (High Value)
**Fields available:**
- `Jobsheet.Number` - Unique jobsheet ID
- `Jobsheet.Status` - Current state
- `Jobsheet.Total` - Estimated/actual cost
- `Jobsheet.Repairs[]` - List of repair items

**Use cases:**
- Link VHC findings to existing jobsheet items
- Show pre-booked work on health check
- Cost tracking and estimation
- Create context-aware recommendations

**Implementation:**
```sql
ALTER TABLE health_checks ADD COLUMN jobsheet_number TEXT;
ALTER TABLE health_checks ADD COLUMN jobsheet_status TEXT;
ALTER TABLE health_checks ADD COLUMN booked_repairs JSONB;
```

---

### 5. Repair Items Detail (High Value)
**From `Jobsheet.Repairs[]`:**
- `Code` - Repair code/operation number
- `Description` - What work is booked
- `Notes` - Additional details

**Use cases:**
- Pre-populate health check with known work
- Flag items as "already booked"
- Avoid recommending work that's already scheduled
- Create timeline of vehicle service history

**Implementation idea:**
```typescript
// In health check display
if (bookedRepairs.some(r => r.code === 'BRAKE_PAD')) {
  // Don't show amber warning for brake pads - already booked
}
```

---

### 6. Waiting/Loan Car Flags (Medium Value)
**Fields:**
- `CustomerWaiting` (boolean)
- `LoanCar` (boolean)
- `Internal` (boolean)

**Use cases:**
- Prioritize checks for waiting customers
- Dashboard filtering by job type
- Resource planning

**Implementation:**
```sql
ALTER TABLE health_checks ADD COLUMN customer_waiting BOOLEAN DEFAULT false;
ALTER TABLE health_checks ADD COLUMN loan_car_required BOOLEAN DEFAULT false;
ALTER TABLE health_checks ADD COLUMN is_internal BOOLEAN DEFAULT false;
```

---

### 7. Vehicle Specification (Low Value)
**Field:** `Vehicle.Specification`

**Use cases:**
- Display trim level
- May help identify equipment levels

---

### 8. Engine Size (Low Value)
**Field:** `Vehicle.EngineSize`

**Use cases:**
- Filter recommendations by engine type
- May be useful for parts lookup

**Implementation:**
```sql
ALTER TABLE vehicles ADD COLUMN engine_size INTEGER;
```

---

### 9. Secondary Contact Details (Low Value)
**Fields:**
- `InvoiceTo.Telephone2`
- `InvoiceTo.Email2`

**Use cases:**
- Backup contact methods
- Work vs personal contacts

---

## Recommended Enhancement Phases

### Phase 1: Quick Wins (Low Effort, High Value) - COMPLETE
1. ~~Add customer address fields~~ DONE
2. ~~Add `customer_waiting` flag to health_checks~~ DONE
3. ~~Store `jobsheet_number` reference~~ DONE
4. ~~Add `loan_car_required` flag~~ DONE (bonus)
5. ~~Add `booked_repairs` JSONB array~~ DONE (bonus)
6. ~~Add `due_date` and `booked_date` timestamps~~ DONE (bonus)
7. ~~Add Days on Site display with color coding~~ DONE (bonus)

### Phase 2: Workflow Enhancements
1. Implement DeliverTo contact handling
2. ~~Store and display booked repairs~~ DONE (moved to Phase 1)
3. Add fleet/corporate account support

### Phase 3: Advanced Features
1. ~~Auto-prioritization based on customer waiting~~ DONE (implemented in Phase 1)
2. ~~Intelligent recommendations excluding booked work~~ DONE ("Already Booked" badges)
3. Service history timeline from DMS data

---

## API Response Reference

Full example structure (see `gemini-full-response-sample.json` for actual data):

```json
{
  "error": {
    "message": "Success",
    "code": 0
  },
  "result": {
    "Bookings": [
      {
        "BookingID": 12345,
        "DueDateTime": "2026-01-16T09:00:00",
        "CollectionDateTime": "2026-01-16T17:00:00",
        "Workshop": "Service",
        "ArrivalStatus": "Not Arrived",
        "CustomerWaiting": false,
        "LoanCar": false,
        "Internal": false,
        "Notes": "Annual service due",
        "Vehicle": {
          "Registration": "AB12 CDE",
          "ChassisNumber": "WVWZZZ3CZWE123456",
          "Make": "Volkswagen",
          "Model": "Golf",
          "Specification": "SE Navigation",
          "Colour": "Deep Black",
          "FuelType": "Petrol",
          "EngineSize": 1500,
          "CurrentMileage": 45000
        },
        "InvoiceTo": {
          "CustomerID": 1001,
          "Reference": "C1001",
          "Title": "Mr",
          "Forename": "John",
          "Surname": "Smith",
          "Email": "john.smith@example.com",
          "Mobile": "07700900123",
          "Telephone": "01onal234567",
          "Street1": "123 High Street",
          "Street2": "",
          "Town": "Manchester",
          "County": "Greater Manchester",
          "Postcode": "M1 1AA"
        },
        "DeliverTo": null,
        "Jobsheet": {
          "Number": 98765,
          "Status": "Open",
          "Total": 199.99,
          "Repairs": [
            {
              "Code": "SERV-A",
              "Description": "Annual Service",
              "Notes": ""
            },
            {
              "Code": "OIL-C",
              "Description": "Oil Change",
              "Notes": "Longlife specification"
            }
          ]
        }
      }
    ]
  }
}
```

---

## Customer Search API

We also have access to `/api/v2/customers/get-customer-list` for customer lookup:

**Parameters:**
- `Surname`
- `Postcode`
- `Telephone`
- `Mobile`
- `Email`
- `Site`

**Returns:** Customer list with contact details.

**Use cases:**
- Search for existing customers before creating new
- Link VHC customers to DMS records
- Enable manual customer lookup

---

## Notes

1. All data mapping should preserve the original Gemini field values where possible
2. Consider adding `gemini_raw_data` JSONB column to preserve unmapped fields
3. Run import with verbose logging to identify any missing fields in actual responses
4. Test with production-like data before deploying new field mappings
