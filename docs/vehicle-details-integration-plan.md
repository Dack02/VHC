# Vehicle Details API Integration Plan (Vehicle Data Global)

**Status:** Planned 2026-06-27 — build not started
**Source doc:** `docs/VehicleDetails_API_Documentation.md`
**Provider:** Vehicle Data Global (VDGL) — `VehicleDetails` package

---

## 1. Purpose & relationship to MOT lookup

VHC already has a **DVSA MOT History** integration (`vehicle_lookup` module) that is
**free** and provides MOT expiry, MOT status, per-test history, odometer readings, and
advisories. That stays as-is.

`VehicleDetails` is **complementary, not a replacement**:

- It is **DVLA-sourced identity + full spec + provenance** — it returns **no MOT data
  whatsoever** (no expiry, status, test history, or advisories). MOT remains DVSA-only.
- It is **paid per-lookup** (£0.06–£0.15 depending on credit tier), so it is fired
  deliberately, not on every reg search.

| Concern | Source |
|---|---|
| MOT expiry / status / test history / advisories / recall | **DVSA MOT History** (free, unchanged) |
| VIN, body type, derivative, power, dimensions, weights, tax/VED, EV spec, NCAP, keeper/colour/scrap provenance | **VehicleDetails** (this integration) |
| make / model / colour / fuel / engine | **VehicleDetails wins** (DVLA more granular); DVSA fills only if VehicleDetails absent |

---

## 2. Decisions (locked)

1. **Trigger:** Auto-enrich **once on vehicle creation** + a manual **"Refresh vehicle
   data"** button for later re-lookup. DVSA MOT lookup stays free/automatic as today.
2. **Source of truth:** VehicleDetails **overwrites** identity fields
   (make/model/variant/colour/fuel). MOT lookup remains the source only for MOT fields.
3. **Storage:** A handful of queryable **core columns** + full payload in a
   **`vehicle_spec JSONB`** column.

---

## 3. Architecture — mirror `postcode-lookup`

The postcode-lookup module is the template (env-first creds, encrypted DB fallback,
always-return-200-with-errorCode, inert until keyed).

### 3.1 Service — `apps/api/src/services/vehicle-details.ts`

- **Credential resolution (env-first):**
  - `VEHICLE_DETAILS_API_KEY`
  - `VEHICLE_DETAILS_ENABLED` (default true once a key is present)
  - `VEHICLE_DETAILS_BASE_URL` (default `https://uk.api.vehicledataglobal.com/r2/lookup`
    — lets sandbox↔live be pure config)
  - Fallback: encrypted `platform_settings` row `id='vehicle_details'`
    (`settings.api_key_encrypted` AES-256-GCM, `settings.enabled`), `source` =
    `env|database|none`.
- **Request:** `GET {baseUrl}?packageName=VehicleDetails&vrm={VRM}` with
  `Authorization: Bearer {key}`. ~12s timeout.
- **Always-return-result** shape with `errorCode`:
  `NOT_CONFIGURED | DISABLED | INVALID | NOT_FOUND | RATE_LIMITED | AUTH_FAILED | API_ERROR | EXCEPTION`.
  Never throw 5xx — keeps it inert until keyed and lets UI degrade.
- **Status mapping:** upstream `responseInformation.isSuccessStatusCode=false` →
  `NOT_FOUND`/`API_ERROR`; HTTP 429 → `RATE_LIMITED`; 401/403 → `AUTH_FAILED`.
- **Mapper** `mapVehicleDetails(raw)` → flat `VehicleDetailsResult` pulling the core
  fields below plus the raw `results` object for the JSONB blob.
- `testVehicleDetailsConnection(sampleVrm?)` for the admin test button.
- `persistVehicleDetails(orgId, vehicleId, result, { overwriteIdentity: true })`.

### 3.2 Route — `apps/api/src/routes/vehicle-details.ts`

- `GET /api/v1/vehicle-details/status` → `{ configured, enabled, provider, source }`
- `GET /api/v1/vehicle-details/:registration` → `VehicleDetailsResult` (read-only preview,
  no DB write). `service_advisor` role gate (no module gate — inert via `NOT_CONFIGURED`,
  same as postcode-lookup). Register in `apps/api/src/index.ts` next to
  `vehicle-lookup` / `postcode-lookup`.

### 3.3 Persistence — extend `POST /api/v1/vehicles`

- On create from a reg lookup, if VehicleDetails is configured, fire it and persist.
- Add an `enrichVehicleDetails` flag (mirrors existing `syncMotHistory`).
- With `overwriteIdentity: true`, write make/model/colour/fuel/engine from VehicleDetails;
  store VIN + core spec columns + `vehicle_spec` JSONB.
- Manual refresh: `POST /api/v1/vehicles/:id/refresh-vehicle-details`.

---

## 4. Database migration (additive, `IF NOT EXISTS`)

New migration `supabase/migrations/<ts>_vehicle_details_enrichment.sql`:

```sql
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin                   VARCHAR(50);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS derivative            VARCHAR(120); -- model variant/series
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS body_type             VARCHAR(60);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission          VARCHAR(40);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS drive_type            VARCHAR(20);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS power_bhp             INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS co2_gkm               INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS euro_status           VARCHAR(20);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS date_first_registered DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_scrapped           BOOLEAN;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_imported           BOOLEAN;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_spec          JSONB;     -- full results payload
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_data_synced_at TIMESTAMPTZ;

-- Keeper / V5 reporting (promoted to columns — drives "customer sold vehicle" detection)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS keeper_start_date            DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS number_of_previous_keepers   INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS previous_keeper_disposal_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS latest_v5c_issue_date        DATE;
-- Derived ownership signal
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_status             VARCHAR(20) DEFAULT 'owned'; -- owned | likely_sold
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_changed_at         TIMESTAMPTZ; -- when we detected the change
-- Baseline captured at first enrichment, to compare against on refresh
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS keeper_baseline_start_date   DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS keeper_baseline_count        INTEGER;

CREATE INDEX IF NOT EXISTS idx_vehicles_ownership_status ON vehicles(organization_id, ownership_status);
CREATE INDEX IF NOT EXISTS idx_vehicles_keeper_start ON vehicles(organization_id, keeper_start_date);
```

(`make`, `model`, `year`, `color`, `fuel_type`, `engine_size`, `mileage` already exist.)

`platform_settings` row `id='vehicle_details'` is created on first admin save / read
(no migration needed — matches postcode/MOT pattern).

---

## 5. Field mapping (VehicleDetails → vehicles)

| vehicles column | VehicleDetails path |
|---|---|
| make | `results.vehicleDetails.vehicleIdentification.dvlaMake` (or `modelDetails.modelIdentification.make`) |
| model | `modelDetails.modelIdentification.model` ?? `vehicleIdentification.dvlaModel` |
| derivative | `modelDetails.modelIdentification.modelVariant` / `series` |
| color | `vehicleHistory.colourDetails.currentColour` |
| fuel_type | `vehicleIdentification.dvlaFuelType` / `powertrain.fuelType` |
| engine_size | `dvlaTechnicalDetails.engineCapacityCc` |
| year | `vehicleIdentification.yearOfManufacture` |
| vin | `vehicleIdentification.vin` |
| body_type | `modelDetails.bodyDetails.bodyStyle` ?? `vehicleIdentification.dvlaBodyType` |
| transmission | `powertrain.transmission.transmissionType` |
| drive_type | `powertrain.transmission.driveType` |
| power_bhp | `performance.power.bhp` |
| co2_gkm | `vehicleExciseDutyDetails.dvlaCo2` ?? `emissions.manufacturerCo2` |
| euro_status | `emissions.euroStatus` |
| date_first_registered | `vehicleIdentification.dateFirstRegisteredInUk` |
| is_scrapped | `vehicleStatus.isScrapped` |
| is_imported | `vehicleStatus.isImported` |
| keeper_start_date | `vehicleHistory.keeperChangeList[latest].keeperStartDate` |
| number_of_previous_keepers | `vehicleHistory.keeperChangeList[latest].numberOfPreviousKeepers` |
| previous_keeper_disposal_date | `vehicleHistory.keeperChangeList[latest].previousKeeperDisposalDate` |
| latest_v5c_issue_date | `max(vehicleHistory.v5cCertificateList[].issueDate)` |
| vehicle_spec | full `results` object (incl. full keeper/V5C/plate-change arrays) |

> The promoted columns hold the **latest** keeper/V5 values for fast querying; the full
> historical arrays stay in `vehicle_spec` for the history panel.

---

## 5a. Ownership-change detection ("customer sold the vehicle")

**Why:** a change in keeper data is the strongest signal a customer no longer owns the
vehicle — so we should stop MOT/marketing reminders and flag the record. This data exists
**only** in the paid VehicleDetails API (DVSA MOT and DVLA VES do not expose keeper info),
so detection always costs a lookup → it must be triggered deliberately.

**Baseline:** on the **first** enrichment (while the customer is the known owner), store
`keeper_baseline_start_date` + `keeper_baseline_count`.

**Detection (on every later refresh):** flag `ownership_status = 'likely_sold'` +
stamp `ownership_changed_at` when either:
- `keeper_start_date` advances **past** the baseline (a new keeper started), **or**
- `number_of_previous_keepers` increases beyond the baseline.

Optional corroboration: the new `keeper_start_date` is **after** the customer's last
job/visit date (reduces false positives where the customer themselves just re-registered).

**Consumers of the flag:**
- **Suppress** MOT reminders / Follow-Up / marketing for `likely_sold` vehicles.
- **Report:** "vehicles sold in last N days" / lost-customer list (queryable via the new
  columns + indexes).
- UI badge on the vehicle/customer ("Likely sold — keeper changed {date}").

**Open decision — DEFERRED.** When the paid re-check fires (just-in-time before outbound
reminders / scheduled sweep / manual-only / combo) is to be decided later. For now the
build must simply **capture + store** all V5/keeper fields (columns above) on every
enrichment + manual refresh, and stamp the baseline on first enrichment, so the detection
logic can be switched on later without a re-migration or re-lookup of history.

---

## 6. Admin & frontend

- **Admin** (`admin/platform.ts` + `AdminSettings.tsx`): add a `vehicleDetails` block
  (enabled toggle, masked API key, base URL, env-managed banner, **Test** button →
  `POST /api/v1/admin/platform/vehicle-details/test`). Mirror the MOT/postcode blocks.
- **Module registry** (`apps/web/src/lib/modules.ts`): reuse the existing
  `vehicle_lookup` module OR add `vehicle_details` (key: `vehicle_details`, label
  "Vehicle Data (DVLA spec)", `defaultOn: false` — it costs money). **Recommend a
  separate module** so a tenant can have free MOT on without paying for spec.
- **NewHealthCheck / NewJobsheet / NewEstimate:** after the existing reg lookup, when a
  vehicle is created, pass `enrichVehicleDetails: true`. Surface a small "Vehicle data"
  panel (derivative, VIN, body, power, CO2) + a **Refresh** button.

---

## 7. Sandbox notes (from the doc)

- Sandbox key `2C676359-...` is **non-production**, data up to **12 months stale**, only
  VRMs **containing 'A'** work, no VIN lookups, 100 req/day. Test VRMs: `SA22 MWF`,
  `JS53 GAS`, `KS03 APE`, etc.
- Build with `VEHICLE_DETAILS_BASE_URL` so going live = swap key + (same URL). Keep the
  integration **inert until a real key is set** (NOT_CONFIGURED path).

---

## 8. Build order

1. Service (`vehicle-details.ts`) + types in `vhc-shared` (or local) — incl. mapper + error codes.
2. Route + register in `index.ts`.
3. Migration (additive columns).
4. Extend `POST /api/v1/vehicles` (+ refresh endpoint) with persist + identity overwrite.
5. Admin settings block + test endpoint.
6. Frontend: enrich-on-create flag + vehicle-data panel + refresh button across the 3 New* pages.
7. Test against sandbox (A-VRMs); then key live on Railway.
