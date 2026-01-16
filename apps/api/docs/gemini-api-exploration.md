# Gemini OSI API Exploration

## Connection Status

**Status:** UNREACHABLE - Server timeout

The Gemini OSI server at `central-2304.geminiosi.co.uk` was not reachable during this exploration session. The connection attempts resulted in timeout errors (exit code 28), indicating the server is likely:
- Behind a firewall requiring VPN access
- Restricted to specific IP addresses
- Temporarily unavailable

```
$ curl -v --connect-timeout 15 "https://central-2304.geminiosi.co.uk/..."
* Host central-2304.geminiosi.co.uk:443 was resolved.
* IPv4: 57.129.129.156
* Trying 57.129.129.156:443...
* ipv4 connect timeout after 14998ms, move on!
* Failed to connect to central-2304.geminiosi.co.uk port 443
```

The following documentation is derived from the existing implementation in `/apps/api/src/services/gemini-osi.ts`, which was built based on prior API exploration.

---

## API Overview

| Property | Value |
|----------|-------|
| Base URL | `https://central-2304.geminiosi.co.uk/` |
| Authentication | HTTP Basic Auth |
| Content-Type | `application/json` |
| Primary Endpoint | `POST /api/v2/workshop/get-diary-bookings` |

---

## Authentication

The API uses **HTTP Basic Authentication**.

```bash
curl -X POST \
  -u "LeoDack:lgBh\$&19d" \
  -H "Content-Type: application/json" \
  -d '{"from":"2025-01-15","to":"2025-01-22","siteId":1}' \
  "https://central-2304.geminiosi.co.uk/api/v2/workshop/get-diary-bookings"
```

In code, the Basic Auth header is constructed as:
```typescript
const basicAuth = Buffer.from(`${username}:${password}`).toString('base64')
headers: {
  'Authorization': `Basic ${basicAuth}`,
  'Content-Type': 'application/json'
}
```

---

## Endpoint: Get Diary Bookings

### Request

| Property | Value |
|----------|-------|
| Method | `POST` |
| Path | `/api/v2/workshop/get-diary-bookings` |
| Content-Type | `application/json` |

### Request Body

```json
{
  "from": "2025-01-15",
  "to": "2025-01-22",
  "siteId": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Start date (YYYY-MM-DD format) |
| `to` | string | End date (YYYY-MM-DD format) |
| `siteId` | number | Site/branch identifier (default: 1) |

### Response

The API returns an array of booking objects (or an object with numeric keys that can be converted to an array).

```json
[
  {
    "Id": 12345,
    "BookingDate": "2025-01-15",
    "TimeBooked": "09:00",
    "PromiseTime": "17:00",
    "ArrivalStatus": "Not Arrived",
    "Workshop": "Service",
    "Vehicle": { ... },
    "InvoiceTo": { ... },
    "DeliverTo": { ... },
    "Jobsheets": [ ... ]
  }
]
```

---

## Data Structures

### Booking Object (Root)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `Id` | number | Yes | Unique booking identifier |
| `BookingDate` | string | Yes | Date of booking (YYYY-MM-DD) |
| `TimeBooked` | string | Yes | Time booked (HH:MM format) |
| `PromiseTime` | string | No | Promised completion time (HH:MM) |
| `ArrivalStatus` | string | Yes | Current arrival status |
| `Workshop` | string | Yes | Workshop/department type |
| `Vehicle` | object | Yes | Vehicle details |
| `InvoiceTo` | object | Yes | Invoice recipient (customer) |
| `DeliverTo` | object | No | Delivery recipient (if different) |
| `Jobsheets` | array | No | Associated jobsheets |

---

### Vehicle Object

The `Vehicle` object contains all vehicle-related information.

```json
{
  "Id": 67890,
  "Registration": "AB12 CDE",
  "VIN": "WVWZZZ3CZWE123456",
  "Make": "Volkswagen",
  "Model": "Golf",
  "Colour": "Blue",
  "FuelType": "Petrol",
  "CurrentMileage": 45000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `Id` | number | Yes | Unique vehicle identifier in Gemini |
| `Registration` | string | Yes | Vehicle registration number |
| `VIN` | string | No | Vehicle Identification Number (17 chars) |
| `Make` | string | No | Vehicle manufacturer (e.g., "Volkswagen", "Ford") |
| `Model` | string | No | Vehicle model (e.g., "Golf", "Focus") |
| `Colour` | string | No | Vehicle colour (British spelling) |
| `FuelType` | string | No | Fuel type (e.g., "Petrol", "Diesel", "Electric") |
| `CurrentMileage` | number | No | Current odometer reading |

**Notes:**
- `Registration` is the primary identifier for matching vehicles
- `VIN` may be empty for older vehicles
- `Colour` uses British English spelling
- `CurrentMileage` is the last recorded mileage in the DMS

---

### InvoiceTo Object (Customer)

The `InvoiceTo` object contains customer billing/contact information.

```json
{
  "Id": 11111,
  "Title": "Mr",
  "Forename": "John",
  "Surname": "Smith",
  "Email": "john.smith@example.com",
  "Mobile": "07700900123",
  "Telephone": "01234567890",
  "Address1": "123 Main Street",
  "Address2": "Anytown",
  "Address3": "County",
  "Postcode": "AB1 2CD"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `Id` | number | Yes | Unique customer identifier in Gemini |
| `Title` | string | No | Honorific (Mr, Mrs, Ms, Dr, etc.) |
| `Forename` | string | Yes | First name |
| `Surname` | string | Yes | Last name |
| `Email` | string | No | Email address |
| `Mobile` | string | No | Mobile phone number |
| `Telephone` | string | No | Landline phone number |
| `Address1` | string | No | Address line 1 (street address) |
| `Address2` | string | No | Address line 2 (city/town) |
| `Address3` | string | No | Address line 3 (county/region) |
| `Postcode` | string | No | UK postcode |

**Notes:**
- `Mobile` is the preferred contact number for SMS notifications
- `Telephone` is the secondary contact (landline)
- Address fields may be partially populated
- `Email` is required for digital VHC report delivery

---

### DeliverTo Object

The `DeliverTo` object contains delivery recipient information when different from the invoice recipient.

```json
{
  "Id": 22222,
  "Title": "Mrs",
  "Forename": "Jane",
  "Surname": "Smith",
  "Email": "jane.smith@example.com",
  "Mobile": "07700900456",
  "Telephone": "01onal234890"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `Id` | number | Yes | Unique identifier |
| `Title` | string | No | Honorific |
| `Forename` | string | Yes | First name |
| `Surname` | string | Yes | Last name |
| `Email` | string | No | Email address |
| `Mobile` | string | No | Mobile phone number |
| `Telephone` | string | No | Landline phone number |

**Notes:**
- This object is optional and may be null/undefined
- Used when vehicle is to be delivered to someone other than invoice recipient
- Does not include address fields (delivery address managed separately)

---

### Jobsheet Object

The `Jobsheets` array contains work order information.

```json
{
  "Id": 99999,
  "JobsheetNumber": "JS-2025-001234",
  "Description": "Full service and MOT inspection",
  "Status": "Open"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `Id` | number | Yes | Unique jobsheet identifier |
| `JobsheetNumber` | string | Yes | Human-readable job number |
| `Description` | string | No | Work description/notes |
| `Status` | string | No | Jobsheet status |

**Notes:**
- A booking may have multiple jobsheets
- The first jobsheet (`Jobsheets[0]`) is typically the primary work order
- `Description` contains the job notes visible to technicians

---

## Enum Values

### ArrivalStatus

Based on the implementation, the following values are expected:

| Value | Description | VHC Mapping |
|-------|-------------|-------------|
| `Not Arrived` | Customer has not yet arrived | `awaiting_arrival` |
| `Arrived` | Customer has arrived on site | `arrived` |
| `In Progress` | Work is currently being performed | `in_progress` |
| `Completed` | Work is completed | `completed` |
| `No Show` | Customer did not arrive | `no_show` |

**Note:** Actual values may include variations. The implementation normalizes these to VHC status values.

### Workshop

The `Workshop` field indicates the department/service type:

| Value | Description | Notes |
|-------|-------------|-------|
| `Service` | General service department | Most common |
| `MOT` | MOT testing | UK annual roadworthiness test |
| `Bodyshop` | Body repair/paint | Collision repair |
| `Parts` | Parts department | Parts collection/fitting |
| `Valeting` | Vehicle cleaning | Pre-delivery prep |

**Note:** These are expected values based on typical DMS configurations. Actual values depend on dealership setup.

---

## VHC Field Mapping

### Vehicle Mapping

| Gemini Field | VHC Field | Notes |
|--------------|-----------|-------|
| `Vehicle.Id` | `vehicles.external_id` | For matching |
| `Vehicle.Registration` | `vehicles.registration` | Primary identifier |
| `Vehicle.VIN` | `vehicles.vin` | Optional |
| `Vehicle.Make` | `vehicles.make` | |
| `Vehicle.Model` | `vehicles.model` | |
| `Vehicle.Colour` | `vehicles.color` | Note spelling difference |
| `Vehicle.FuelType` | `vehicles.fuel_type` | |
| `Vehicle.CurrentMileage` | `health_checks.mileage_in` | Latest reading |

### Customer Mapping

| Gemini Field | VHC Field | Notes |
|--------------|-----------|-------|
| `InvoiceTo.Id` | `customers.external_id` | For matching |
| `InvoiceTo.Title` | - | Not stored |
| `InvoiceTo.Forename` | `customers.first_name` | |
| `InvoiceTo.Surname` | `customers.last_name` | |
| `InvoiceTo.Email` | `customers.email` | |
| `InvoiceTo.Mobile` | `customers.mobile` | Primary contact |
| `InvoiceTo.Telephone` | `customers.phone` | Secondary |
| `InvoiceTo.Address1-3` | `customers.address` | Concatenated |
| `InvoiceTo.Postcode` | `customers.postcode` | |

### Health Check Mapping

| Gemini Field | VHC Field | Notes |
|--------------|-----------|-------|
| `Id` | `health_checks.external_id` | Prevent duplicates |
| `BookingDate` + `TimeBooked` | `health_checks.scheduled_at` | Combined |
| `PromiseTime` | `health_checks.promise_time` | When to be ready |
| `Jobsheets[0].Description` | `health_checks.notes` | Job description |
| `Jobsheets[0].JobsheetNumber` | `health_checks.job_number` | Reference |
| `Workshop` | `health_checks.service_type` | Service category |
| `ArrivalStatus` | `health_checks.status` | Mapped to VHC status |

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 401 | Unauthorized | Check credentials |
| 403 | Forbidden | Check permissions |
| 404 | Not Found | Check API URL |
| 429 | Rate Limited | Wait and retry |
| 500+ | Server Error | Retry with backoff |

### Retry Strategy

The implementation uses exponential backoff:
- Max retries: 3
- Base delay: 1000ms
- Delay formula: `baseDelay * 2^(attempt - 1)`

---

## Usage Example

```typescript
import { fetchDiaryBookings, GeminiCredentials } from './services/gemini-osi'

const credentials: GeminiCredentials = {
  apiUrl: 'https://central-2304.geminiosi.co.uk/',
  username: 'LeoDack',
  password: 'lgBh$&19d'
}

// Fetch today's bookings
const today = new Date().toISOString().split('T')[0]
const result = await fetchDiaryBookings(credentials, today, { siteId: 1 })

if (result.success) {
  console.log(`Found ${result.totalCount} bookings`)
  for (const booking of result.bookings) {
    console.log(`${booking.vehicleReg} - ${booking.customerFirstName} ${booking.customerLastName}`)
  }
} else {
  console.error(`Failed: ${result.error}`)
}
```

---

## Files

- Sample response: `docs/gemini-sample-response.json`
- API client: `src/services/gemini-osi.ts`
- Import job: `src/jobs/dms-import.ts`
- Settings routes: `src/routes/dms-settings.ts`

---

## Next Steps

1. **Obtain network access** - VPN or IP whitelist may be required
2. **Test with live data** - Validate field mappings with real responses
3. **Discover additional enum values** - Capture all ArrivalStatus/Workshop values
4. **Rate limit testing** - Determine actual API limits
5. **Error scenario testing** - Document edge cases
