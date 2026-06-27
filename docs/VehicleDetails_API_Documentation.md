# Vehicle Data Global — Vehicle Details API Documentation

> **Account:** Ollosoft Ltd | **Support Code:** R5E7YY | **Account Type:** Trial / Sandbox

---

## Overview

The **Vehicle Details API** (`VehicleDetails` data package) returns comprehensive DVLA-sourced vehicle identification, status, history, and technical details for a given UK vehicle registration mark (VRM). It is part of the Vehicle Data Global (VDGL) JSON web services platform.

- **Base Endpoint:** `https://uk.api.vehicledataglobal.com/r2/lookup`
- **Method:** `GET`
- **Authentication:** Bearer Token (API Key passed in `Authorization` header)
- **Response Format:** JSON

---

## Pricing (PayGo)

| Tier | Credit Top-Up | Price per Lookup |
|------|--------------|-----------------|
| Tier 1 | £50 credit | £0.15 |
| Tier 2 | £150 credit | £0.12 |
| Tier 3 | £249 credit | £0.08 |
| Tier 4 | £495 credit | £0.06 |
| Tier 5 | £995 credit | £0.04 |

> *All prices exclusive of VAT at current UK rate.*

---

## Request

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `packageName` | string | Yes | Must be `VehicleDetails` |
| `vrm` | string | Yes | Vehicle Registration Mark (number plate) to look up |

### Headers

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <YOUR_API_KEY>` |

### Example Request URL

```
GET https://uk.api.vehicledataglobal.com/r2/lookup?packageName=VehicleDetails&vrm=SA22MWF
Authorization: Bearer 2c676359-ebf3-4a89-b35f-918eb85b181c
```

---

## Response Structure

The API returns a JSON object with the following top-level sections:

### Top-Level Object

| Field | Type | Description |
|-------|------|-------------|
| `requestInformation` | object | Details about the request made |
| `responseInformation` | object | Status and metadata about the response |
| `billingInformation` | object | Billing transaction details |
| `results` | object | The vehicle data payload |

---

### `requestInformation`

| Field | Type | Description |
|-------|------|-------------|
| `packageName` | string | The name of the package used for the request |
| `searchTerm` | string | The VRM used for the lookup |
| `searchType` | string | The type of data item being looked up |
| `requestIp` | string | IP address from which the request was made |

---

### `responseInformation`

| Field | Type | Description |
|-------|------|-------------|
| `statusCode` | int | HTTP-style status code |
| `statusMessage` | string | Human-readable status description |
| `isSuccessStatusCode` | bool | Whether the request was successful |
| `queryTimeMs` | int | Time taken for the query in milliseconds |
| `responseId` | string | Unique identifier for this response (use for support queries) |

---

### `billingInformation`

| Field | Type | Description |
|-------|------|-------------|
| `billingTransactionId` | string? | Unique billing reference (null if no billing occurred) |
| `accountType` | int | Current account billing type |
| `accountBalance` | float? | Current account balance (PayGo accounts) |
| `transactionCost` | float? | Cost of this transaction |
| `billingResult` | int | Billing result code |
| `billingResultMessage` | string | Billing result as text |
| `refundAmount` | float? | Any refund amount applied |
| `refundResult` | int? | Refund result code |
| `refundResultMessage` | string | Refund result as text |

---

### `results`

Contains three sub-objects: `vehicleCodes`, `vehicleDetails`, and `modelDetails`.

---

#### `results.vehicleCodes`

| Field | Type | Description |
|-------|------|-------------|
| `uvc` | string | Universal Vehicle Code — VDGL's internal unique model code |

---

#### `results.vehicleDetails`

Top-level vehicle details object.

| Field | Type | Description |
|-------|------|-------------|
| `vehicleIdentification` | object? | DVLA vehicle identification details |
| `vehicleStatus` | object? | Import, export, and scrapped status |
| `vehicleHistory` | object? | Colour, keeper, and plate change history |
| `dvlaTechnicalDetails` | object? | Additional DVLA technical specifications |
| `statusCode` | int | API response status code |
| `statusMessage` | string | Human-readable API response status |
| `documentVersion` | int | Data source version number |

##### `vehicleDetails.vehicleIdentification`

| Field | Type | Description |
|-------|------|-------------|
| `vrm` | string | Vehicle Registration Mark |
| `vin` | string | Vehicle Identification Number (Chassis Number) |
| `vinLast5` | string | Last 5 digits of the VIN |
| `dvlaMake` | string | Vehicle make (e.g. Ford, Volkswagen) |
| `dvlaModel` | string | Vehicle model (e.g. Galaxy, Golf) |
| `dvlaWheelPlan` | string | Wheel plan (e.g. 2 AXLE RIGID BODY) |
| `dateFirstRegisteredInUk` | DateTime? | Date first registered in the UK |
| `dateFirstRegistered` | DateTime? | Date first registered globally |
| `dateOfManufacture` | DateTime? | Date of manufacture |
| `yearOfManufacture` | int? | Year of manufacture |
| `vehicleUsedBeforeFirstRegistration` | bool | Whether the vehicle was used prior to first registration |
| `engineNumber` | string | Engine number |
| `previousVrmNi` | string | Previous Northern Ireland VRM (if applicable) |
| `dvlaBodyType` | string | DVLA body type |
| `dvlaFuelType` | string | DVLA fuel type |

##### `vehicleDetails.vehicleStatus`

| Field | Type | Description |
|-------|------|-------------|
| `isImported` | bool | Imported from within the EU |
| `isImportedFromNi` | bool | Imported from Northern Ireland |
| `isImportedFromOutsideEu` | bool | Imported from outside the EU |
| `dateImported` | DateTime? | Date of import |
| `certificateOfDestructionIssued` | bool | Whether a Certificate of Destruction has been issued |
| `isExported` | bool | Recorded as exported |
| `dateExported` | DateTime? | Date of export |
| `isScrapped` | bool | Recorded as scrapped |
| `isUnscrapped` | bool | Recorded as un-scrapped |
| `dateScrapped` | DateTime? | Date of scrapping |
| `dvlaCherishedTransferMarker` | bool? | Subject to cherished transfers per DVLA |
| `vehicleExciseDutyDetails` | object? | Tax and CO2 details (see below) |

**`vehicleExciseDutyDetails`:**

| Field | Type | Description |
|-------|------|-------------|
| `dvlaCo2` | int? | CO2 value from DVLA |
| `dvlaCo2Band` | string | CO2 band from DVLA |
| `dvlaBand` | string | DVLA band details |
| `vedRate` | object? | Road tax charge details |

**`vedRate`** contains three rate objects (`firstYear`, `premiumVehicle`, `standard`), each with:

| Field | Type | Description |
|-------|------|-------------|
| `sixMonths` | float? | Road tax cost for 6 months |
| `twelveMonths` | float? | Road tax cost for 12 months |

##### `vehicleDetails.vehicleHistory`

| Field | Type | Description |
|-------|------|-------------|
| `colourDetails` | object? | Current and previous colour details |
| `keeperChangeList` | array | List of keeper changes |
| `plateChangeList` | array | List of plate changes |
| `v5cCertificateList` | array | List of V5C certificate issue dates |

**`colourDetails`:**

| Field | Type | Description |
|-------|------|-------------|
| `currentColour` | string | Current recorded colour |
| `numberOfColourChanges` | int? | Number of colour changes recorded |
| `originalColour` | string | Original colour |
| `previousColour` | string | Previous colour |
| `latestColourChangeDate` | DateTime? | Date of the most recent colour change |

**Each `keeperChangeList` item:**

| Field | Type | Description |
|-------|------|-------------|
| `numberOfPreviousKeepers` | int? | Number of previous keepers |
| `keeperStartDate` | DateTime? | Date current keeper started |
| `previousKeeperDisposalDate` | DateTime? | Date previous keeper disposed of vehicle |

**Each `plateChangeList` item:**

| Field | Type | Description |
|-------|------|-------------|
| `currentVrm` | string | Current VRM |
| `transferType` | string | Type of plate transfer |
| `dateOfReceipt` | DateTime? | Date of receipt for the transfer |
| `previousVrm` | string | Previous VRM before this change |
| `dateOfTransaction` | DateTime? | Date of transfer transaction |

**Each `v5cCertificateList` item:**

| Field | Type | Description |
|-------|------|-------------|
| `issueDate` | DateTime | V5C certificate issue date |

##### `vehicleDetails.dvlaTechnicalDetails`

| Field | Type | Description |
|-------|------|-------------|
| `numberOfSeats` | int? | Number of seats (including driver) |
| `engineCapacityCc` | int? | Engine capacity in CC |
| `grossWeightKg` | int? | Gross vehicle weight in kg |
| `maxNetPowerKw` | int? | Maximum net power in kW |
| `massInServiceKg` | int? | Mass in service in kg |
| `powerToWeightRatio` | float? | Power to weight ratio |
| `maxPermissibleBrakedTrailerMassKg` | int? | Max braked trailer mass in kg |
| `maxPermissibleUnbrakedTrailerMassKg` | int? | Max unbraked trailer mass in kg |

---

#### `results.modelDetails`

Rich manufacturer model data included alongside the DVLA data.

| Field | Type | Description |
|-------|------|-------------|
| `modelIdentification` | object? | Make, range, model, series, dates |
| `modelClassification` | object? | Vehicle class and taxation category |
| `additionalInformation` | object? | Warranty, subscriptions, software |
| `bodyDetails` | object? | Body style, doors, seats, dimensions |
| `dimensions` | object? | Height, length, width, wheelbase |
| `weights` | object? | Kerb weight, gross weight, payload |
| `powertrain` | object? | Engine, EV, and transmission details |
| `safety` | object? | Euro NCAP ratings |
| `emissions` | object? | Euro status, CO2, sound levels |
| `performance` | object? | Torque, power, acceleration, fuel economy |
| `statusCode` | int | API response status code |
| `statusMessage` | string | API response status message |
| `documentVersion` | int | Data source version |

##### `modelDetails.modelIdentification`

| Field | Type | Description |
|-------|------|-------------|
| `make` | string | Vehicle make (e.g. Ford, Volkswagen, Audi) |
| `range` | string | Vehicle range (e.g. C-Max, Focus) |
| `model` | string | Vehicle model (e.g. C-Max Style TDCi) |
| `modelVariant` | string | Model variant (null if no variants) |
| `series` | string | Manufacturer series (e.g. C214, E46) |
| `mark` | int? | Model mark number (e.g. VW Golf Mark 2) |
| `startDate` | DateTime? | Manufacturer start date for this model |
| `endDate` | DateTime? | Manufacturer end date for this model |
| `introductionDate` | DateTime? | Date record was created in the system |
| `countryOfOrigin` | string | Country where the vehicle was manufactured |
| `variantCode` | int? | Numeric variant code (null if no variants) |

##### `modelDetails.modelClassification`

| Field | Type | Description |
|-------|------|-------------|
| `typeApprovalCategory` | string | Type approval category code |
| `marketSectorCode` | string | Market sector code |
| `vehicleClass` | string | Class of vehicle (e.g. Car) |
| `taxationClass` | string | Taxation class (Car, PVC, LCV, HCV or Quad) |

##### `modelDetails.bodyDetails`

| Field | Type | Description |
|-------|------|-------------|
| `bodyShape` | string | Body shape (commercial vehicles) |
| `bodyStyle` | string | Body style (e.g. Saloon, Hatchback, MPV) |
| `cabType` | string | Cab type (commercial vehicles, e.g. Luton Van) |
| `platformName` | string | Name of the platform the vehicle is based on |
| `platformIsSharedAcrossModels` | bool? | Whether platform is shared across models |
| `wheelbaseType` | string | Wheelbase type (e.g. Short/Long Wheelbase) |
| `numberOfAxles` | int? | Number of axles |
| `numberOfDoors` | int? | Number of doors |
| `numberOfSeats` | int? | Number of seats |
| `payloadVolumeLitres` | float? | Load area volume in litres |
| `fuelTankCapacityLitres` | int? | Fuel tank capacity in litres |

##### `modelDetails.dimensions`

| Field | Type | Description |
|-------|------|-------------|
| `heightMm` | int? | Overall height in mm |
| `lengthMm` | int? | Overall length (bumper to bumper) in mm |
| `widthMm` | int? | Overall width (including mirrors) in mm |
| `wheelbaseLengthMm` | int? | Wheelbase length in mm |
| `internalLoadLengthMm` | int? | Internal load length (commercial) in mm |

##### `modelDetails.weights`

| Field | Type | Description |
|-------|------|-------------|
| `kerbWeightKg` | int? | Kerb weight in kg (full fuel, standard equipment) |
| `grossTrainWeightKg` | int? | Max permissible weight including trailer, in kg |
| `unladenWeightKg` | int? | Unladen weight in kg |
| `payloadWeightKg` | int? | Payload weight in kg |
| `grossVehicleWeightKg` | int? | Gross vehicle weight in kg |
| `grossCombinedWeightKg` | int? | Gross combined weight (vehicle + trailer) in kg |

##### `modelDetails.powertrain`

| Field | Type | Description |
|-------|------|-------------|
| `powertrainType` | string | Powertrain type (ICE, REEV, BEV, PHEV) |
| `fuelType` | string | Fuel type (e.g. DIESEL, PETROL) |
| `iceDetails` | object? | Internal combustion engine details |
| `evDetails` | object? | Electric vehicle details |
| `transmission` | object? | Transmission details |

**`iceDetails`:**

| Field | Type | Description |
|-------|------|-------------|
| `engineFamily` | string | Engine family/group identifier |
| `engineLocation` | string | Engine location within the vehicle |
| `engineDescription` | string | Engine type description |
| `engineManufacturer` | string | Engine manufacturer |
| `fuelDelivery` | string | Fuel delivery mechanism (e.g. Injection) |
| `aspiration` | string | Aspiration type (e.g. Turbo charged) |
| `cylinderArrangement` | string | Cylinder arrangement (e.g. Inline, Vee) |
| `numberOfCylinders` | int? | Number of cylinders |
| `boreMm` | int? | Cylinder bore diameter in mm |
| `strokeMm` | int? | Piston stroke length in mm |
| `valveGear` | string | Valve actuation mechanism (e.g. DOHC) |
| `valvesPerCylinder` | int? | Number of valves per cylinder |
| `engineCapacityCc` | int? | Engine cubic capacity in CC |
| `engineCapacityLitres` | float? | Engine cubic capacity in litres |

**`evDetails` key fields:**

| Field | Type | Description |
|-------|------|-------------|
| `technicalDetails.numberOfChargePorts` | int | Number of charge ports |
| `technicalDetails.chargeCableDetailsList` | array | Charge cable details |
| `technicalDetails.chargePortDetailsList` | array | Charge port details (type, location, max kW) |
| `technicalDetails.batteryDetailsList` | array | Battery details (capacity, chemistry, warranty) |
| `technicalDetails.motorDetailsList` | array | Motor details (type, power kW, torque, location) |
| `performance.maxChargeInputPowerKw` | int? | Max charge input power in kW |
| `performance.whMile` | int? | Energy used per mile (Wh) |
| `performance.rangeFigures.realRangeMiles` | int? | Real-world range in miles |
| `performance.rangeFigures.realRangeKm` | int? | Real-world range in km |

**`transmission`:**

| Field | Type | Description |
|-------|------|-------------|
| `transmissionType` | string | Transmission type (e.g. Automatic, Manual, CVT) |
| `numberOfGears` | int? | Number of forward gears |
| `driveType` | string | Drive configuration (e.g. 4x4, 4x2) |
| `drivingAxle` | string | Axle driven by the motor |

##### `modelDetails.safety.euroNcap`

| Field | Type | Description |
|-------|------|-------------|
| `ncapStarRating` | int? | NCAP star rating (0–5) |
| `ncapChildPercent` | int? | Child occupant protection percentage |
| `ncapAdultPercent` | int? | Adult occupant protection percentage |
| `ncapPedestrianPercent` | int? | Pedestrian protection percentage |
| `ncapSafetyAssistPercent` | int? | Safety assist systems percentage |

##### `modelDetails.emissions`

| Field | Type | Description |
|-------|------|-------------|
| `euroStatus` | string | European emission standard (e.g. Euro 6) |
| `manufacturerCo2` | int? | Manufacturer's claimed CO2 emissions |
| `soundLevels.stationaryDb` | int? | Sound level (dB) when stationary |
| `soundLevels.engineSpeedRpm` | int? | Engine RPM during sound measurement |
| `soundLevels.driveByDb` | int? | Sound level (dB) during drive-by test |

##### `modelDetails.performance`

| Field | Type | Description |
|-------|------|-------------|
| `dragCoefficient` | float? | Aerodynamic drag coefficient |
| `torque.nm` | float? | Max torque in Newton Metres |
| `torque.lbFt` | float? | Max torque in Pound Feet |
| `torque.rpm` | int? | RPM at peak torque |
| `power.bhp` | float? | Max power in BHP |
| `power.ps` | float? | Max power in PS |
| `power.kw` | float? | Max power in kW |
| `power.rpm` | int? | RPM at peak power |
| `statistics.zeroToSixtyMph` | float? | 0–60 mph time in seconds |
| `statistics.zeroToOneHundredKph` | float? | 0–100 kph time in seconds |
| `statistics.maxSpeedKph` | int? | Top speed in kph |
| `statistics.maxSpeedMph` | int? | Top speed in mph |
| `fuelEconomy.urbanColdMpg` | float? | Urban cold fuel economy in MPG |
| `fuelEconomy.extraUrbanMpg` | float? | Extra urban fuel economy in MPG |
| `fuelEconomy.combinedMpg` | float? | Combined fuel economy in MPG |
| `fuelEconomy.urbanColdL100Km` | float? | Urban cold fuel economy in L/100km |
| `fuelEconomy.extraUrbanL100Km` | float? | Extra urban fuel economy in L/100km |
| `fuelEconomy.combinedL100Km` | float? | Combined fuel economy in L/100km |

---

## Sandbox / Trial Account Details

### Account Information

| Item | Value |
|------|-------|
| **Account Type** | Trial / Sandbox |
| **Support Code** | `R5E7YY` |
| **Sandbox API Key** | `2C676359-EBF3-4A89-B35F-918EB85B181C` |
| **API Key Type** | Sandbox |
| **Daily Rate Limit** | 100 requests/day |
| **Per Second Limit** | 10 requests/second |
| **IP Restrictions** | All IPs allowed |

### Sandbox Base URL

```
https://uk.api.vehicledataglobal.com/r2/lookup
```

### Example Sandbox Request (PHP)

```php
define('UKVD_ENDPOINT', 'https://uk.api.vehicledataglobal.com/r2/lookup');

$apiKey      = '2c676359-ebf3-4a89-b35f-918eb85b181c';
$packageName = 'VehicleDetails';
$vrm         = 'SA22MWF'; // Example sandbox VRM

$queryParams = http_build_query([
    'packageName' => $packageName,
    'vrm'         => $vrm,
]);

$fullUrl = UKVD_ENDPOINT . '?' . $queryParams;

$options = [
    'http' => [
        'header' => "Authorization: Bearer $apiKey",
        'method' => 'GET'
    ]
];
$context  = stream_context_create($options);
$response = file_get_contents($fullUrl, false, $context);

$responseData = json_decode($response, true);
```

### Sandbox Restrictions

> These restrictions apply **only** to Sandbox/Trial API keys and do **not** apply to live accounts.

| Restriction | Detail |
|------------|--------|
| **VRM search constraint** | Only VRMs **containing the letter 'A'** can be searched |
| **Data freshness** | All data is up to **12 months out of date** |
| **Production use** | Data **may not** be used in a production or for-profit environment |
| **VIN lookups** | VINs **cannot** be used with Sandbox API Keys |
| **Max Sandbox Keys** | Maximum of **1 Sandbox API Key** per account |

### Example Test VRMs (Sandbox)

The following VRMs all contain the letter 'A' and are suitable for sandbox testing:

| VRM | VRM | VRM | VRM |
|-----|-----|-----|-----|
| JS53 GAS | SA22 MWF | KS03 APE | RO22 ASX |
| SA22 NKJ | SD22 SYA | SD22 ZWA | SA22 NMJ |

> You can generate additional test VRMs via the **Quick Lookup** tool in the portal: `Products & Services → Quick Lookup → Get Random Registrations`.

---

## Available Code Sample Languages

The Code Builder in the portal generates ready-to-use samples for the following languages:

- C#
- VB.Net
- SwiftUI (iOS)
- PHP
- Java
- OpenAPI

---

## Portal Quick Reference

| Resource | URL Path |
|----------|----------|
| Code Builder | Documentation & Tools → Code Builder |
| API Keys & Security | API Keys & Packages → API Keys & Security |
| Quick Lookup (test tool) | Products & Services → Quick Lookup |
| Account Pricing | Billing Account → Balance & Upgrades |

---

*Document generated from Vehicle Data Global portal — Version 2.45.7.501 | © Vehicle Data Global Ltd 2026*
