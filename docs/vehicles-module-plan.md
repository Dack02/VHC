# VHC "Vehicles" Module — Build-Ready Implementation Plan

**Status:** Planned 2026-06-28 — build not started
**Researched against:** Garage Hive, MAM Autowork Online, Motasoft VGM, TechMan, GA4, Dragon2000, autoVHC (UK GMS); Keyloop/Kerridge, Pinewood/Pinnacle, CDK, Reynolds, Gemini (DMS); Tekmetric, Shopmonkey, AutoLeap, Shop-Ware, Mitchell1, Protractor (US shop-management UX); Epyx 1link / fleet-lease modelling; DVLA VES, DVSA MOT, Vehicle Data Global, UKVehicleData, Carweb (UK data APIs).

> A standalone vehicle asset register with **owner/driver roles**, **vehicle notes**, **ownership-transfer audit**, a **refresh-by-VRM** button, and **tenant-defined typed expiry dates** that drive marketing / Follow-Up campaigns — built on the **existing (uncommitted) DVSA MOT + paid VehicleDetails data layer**, mirroring the Estimates/Jobsheets standalone-module precedent.

---

## 1. Executive summary

### What already exists (do **not** rebuild)

| Capability | State | Where |
|---|---|---|
| `vehicles` table — single `customer_id` owner FK (nullable), plus `mileage INTEGER` | committed | `20240114000000_initial_schema.sql`, `20260116000005_add_vehicle_mileage.sql` |
| **DVSA MOT layer** — `mot_expiry_date`, `mot_status`, `first_used_date`, `mot_last_synced_at` + child `vehicle_mot_tests` (per-test odometer/defects) | committed; module **`vehicle_lookup`** (`defaultOn: true`) | `services/mot-history.ts`, `20260616130000_mot_history_lookup.sql` |
| **Paid DVLA spec/provenance enrichment** — ~25 cols (`derivative`, `body_type`, `transmission`, `power_bhp`, `co2_gkm`, `taxation_class`, `lifecycle_status` active/sold/scrapped/exported/destroyed, `keeper_start_date`, `number_of_previous_keepers`, `keeper_baseline_*`, `vehicle_spec` JSONB) + keeper-change **sold-detection** | **built, UNCOMMITTED**; migration `20260628120000` pending deploy; module **`vehicle_details`** (paid, `defaultOn: false`) | `services/vehicle-details.ts` |
| Re-lookup endpoints (same stored reg): `POST /:id/mot-sync`, `POST /:id/vehicle-details-refresh` | built | `routes/vehicles.ts` |
| `PATCH /:id` re-links `customer_id` (silent — **no audit, no transfer semantics**) | committed | `routes/vehicles.ts:428` |
| Customer-can-be-a-company (`customers.company_name`, `customer_contacts`) → **Lex Autolease is just a customer row** | built, uncommitted | `20260626210000_unified_customer_modal.sql` |
| Follow-Up engine (deferred-work recovery): configurable timelines/steps, send-window/quiet-hours, STOP/opt-out, `communication_logs`, in-process scheduler | live on dev | `services/follow-up-engine.ts`, `20260614120000_follow_up_module_phase1.sql` |
| Module registry + gating (`RequireModule`, `requireModule()`), Estimates/Jobsheets standalone-module precedent | committed | `lib/modules.ts` (×2), `App.tsx`, `index.ts` |

### What is new in this module

1. **A standalone `vehicles` surface** — module key, nav item, `/vehicles` list, `/vehicles/:id` detail "card". Today vehicles exist **only** as a tab inside Customer detail (`VehiclesTab.tsx`).
2. **Owner / driver roles** — a `vehicle_customer_links` join table (lease car *owned* by Lex Autolease, *driven* by Mrs Smith). `vehicles.customer_id` stays the denormalised **primary/billing** owner for backward-compat, kept in sync by trigger.
3. **Vehicle notes** — a proper `vehicle_notes` **table** (multi-author, pinnable, survives ownership changes) — not the single-TEXT `customers.notes` blob.
4. **Ownership audit** — `vehicle_ownership_history` + a real `POST /:id/transfer-owner` action; deprecate the silent `customer_id` overwrite.
5. **Typed, queryable expiry storage** — `expiry_types` (org config, system rows seeded) + `vehicle_expiry_dates` (one row per vehicle×type) so MOT / Service / Road Tax / tenant-custom expiries live in **one indexed surface** that powers campaigns.
6. **Expiry-driven reminders** — a new campaign audience that reuses the Follow-Up **delivery primitives** (send-window, opt-out, comms-logging) via a **dedicated `expiry_reminder_cases` table** (see §6 — we do **not** overload the deployed `follow_up_cases` table). Behind a `vehicle_reminders` module key (opt-in).
7. **List endpoint enrichment** — today `GET /vehicles` returns only basic identity; it needs MOT/lifecycle/keeper fields and `make` / `mot_due` / `lifecycle_status` filters.

### Opinionated headline decisions

- **`vehicles` module: `defaultOn: true`, NOT `core`.** A view over data the platform already holds (an asset register), like Estimates — not a paid add-on like `vehicle_details`.
- **Keep `vehicles.customer_id` as the canonical primary/billing owner**, mirrored from the links table by trigger → zero changes to the hot path (HC create, Follow-Up audience, list/get embeds) on day one.
- **Notes as a table, not a blob.**
- **One queryable expiry table** with MOT *projected* into it on every sync, so every campaign queries one indexed `(organization_id, type_code, due_date)` surface.
- **Reuse Follow-Up's send/suppress primitives, not its case table.** Expiry reminders get their own lightweight case table that shares the engine's delivery + suppression helpers (the deployed `follow_up_cases` is structurally bound to a `health_check_id NOT NULL` and must not be overloaded — see §6).

---

## 2. Competitive insights (what to adopt)

| Pattern | Seen in | Adopt as |
|---|---|---|
| **Vehicle is a first-class entity**; history/MOT/notes attach to the vehicle, not the current owner | Garage Hive, Keyloop, Pinewood, Tekmetric, Dragon2000 | Standalone `/vehicles/:id`; all child rows FK `vehicle_id`, never re-parent on transfer |
| **Owner / Driver / Keeper typed roles** (service reminders → driver, sales/invoice → owner) | Pinewood (best-in-class), CDK (`ownerHref`/`primaryDriverHref`), Salesforce Automotive Cloud | `vehicle_customer_links(role, is_primary, is_reminder_recipient)` |
| **Ownership transfer is an explicit action, not a field overwrite** | Keyloop "Change Ownership", Tekmetric tiered transfer, Pinewood transfer modal | `POST /:id/transfer-owner` + `vehicle_ownership_history` audit |
| **Refresh / Update-from-DVLA button** with last-updated timestamp; plate→VIN decode | Garage Hive, TechMan, CDK, AutoLeap | Unified "Refresh vehicle data" button (free DVSA always; paid DVLA opt-in) + "Correct registration" mode |
| **Typed reminder dates as rows, tenant-configurable types**, multi-stage sequences (MOT −30/−14/−7d) | MAM "Reminder Types", Garage Hive "Default Period Date Formula", MOTText | `expiry_types` config + `vehicle_expiry_dates`; reuse Follow-Up timeline steps for cadence |
| **Recency suppression** ("last activity > N years" excludes the lead) + **lifecycle suppression** (sold/scrapped) | Motasoft 2-year threshold; DVLA keeper-change signals | `vehicles.last_activity_at` gate + `lifecycle_status='active'` + opt-out |
| **Deferred/declined work auto-surfaces & feeds reminders** | Pinewood Aftersales Diary, Gemini missed-upsell, Shopmonkey/Tekmetric deferred tabs | Already covered by Follow-Up; expose a "Deferred work" panel on the vehicle card (P4) |
| **Pinned warning notes pop on lookup** | Garage Hive Extended Comments, Mitchell1 Recommendations pop-up | `vehicle_notes.is_pinned` + `category='warning'`, surfaced as a banner |
| **Archive, never delete** | Tekmetric | Soft via `lifecycle_status`; no hard delete in UI |
| **Full MOT history panel** (every test, pass/fail, mileage, advisories) | Garage Hive, Dragon2000, Motasoft | Already stored; render `GET /:id/mot-history` accordion |

---

## 3. Data model — additive SQL

New migration: **`supabase/migrations/20260628140000_vehicles_module.sql`** (additive + idempotent per `rules/database-safety.md`). Deploy **only** via `supabase db push` in the pipeline — never out-of-band MCP (avoids the orphan-version drift documented in memory).

> **Reconciliation:** add **no** MOT or VehicleDetails columns — they exist in `20260616130000` / `20260628120000`. MOT lives at `vehicles.mot_expiry_date`; it is *projected* into `vehicle_expiry_dates` by the service layer, not duplicated.

```sql
-- ============================================================================
-- 20260628140000_vehicles_module.sql  — all additive + idempotent.
-- ============================================================================

-- 0. last_activity_at on vehicles — drives recency suppression for campaigns.
--    (Was referenced by the suppression query but never existed.) Maintained by
--    the service layer on HC create / jobsheet close / MOT sync (see §4 services).
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_vehicles_last_activity
  ON vehicles(organization_id, last_activity_at);
-- One-time backfill from existing health-check activity.
UPDATE vehicles v SET last_activity_at = sub.last_at
FROM (SELECT vehicle_id, MAX(created_at) AS last_at FROM health_checks GROUP BY vehicle_id) sub
WHERE sub.vehicle_id = v.id AND v.last_activity_at IS NULL;

-- 1. OWNER / DRIVER ROLES. vehicles.customer_id stays canonical primary owner,
--    kept in sync by trigger (step 4).
CREATE TABLE IF NOT EXISTS vehicle_customer_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id)  ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner','driver','keeper','fleet_account')),
  is_primary BOOLEAN NOT NULL DEFAULT false,            -- mirrors vehicles.customer_id
  is_reminder_recipient BOOLEAN NOT NULL DEFAULT false, -- who marketing/reminders target
  start_date DATE,
  end_date   DATE,                                      -- NULL = current
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vcl_vehicle_customer_role
  ON vehicle_customer_links(vehicle_id, customer_id, role);
CREATE INDEX IF NOT EXISTS idx_vcl_vehicle  ON vehicle_customer_links(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vcl_customer ON vehicle_customer_links(organization_id, customer_id);
-- At most one CURRENT primary and one CURRENT reminder-recipient per vehicle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vcl_primary_per_vehicle
  ON vehicle_customer_links(vehicle_id) WHERE is_primary AND end_date IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vcl_reminder_per_vehicle
  ON vehicle_customer_links(vehicle_id) WHERE is_reminder_recipient AND end_date IS NULL;

-- 2. VEHICLE NOTES (table, not blob).
CREATE TABLE IF NOT EXISTS vehicle_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general'
    CHECK (category IN ('general','warning','blocked','internal')),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_notes_vehicle
  ON vehicle_notes(vehicle_id, is_pinned DESC, created_at DESC);

-- 3. OWNERSHIP HISTORY (append-only audit).
CREATE TABLE IF NOT EXISTS vehicle_ownership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  from_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  to_customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(40),  -- sold | new_keeper_detected | data_correction | merge | other
  notes TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voh_vehicle ON vehicle_ownership_history(vehicle_id, changed_at DESC);

-- 4. Mirror vehicles.customer_id from the current PRIMARY link (legacy reads keep working).
CREATE OR REPLACE FUNCTION sync_vehicle_primary_customer() RETURNS TRIGGER AS $$
DECLARE v_vehicle UUID := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
BEGIN
  UPDATE vehicles SET customer_id = (
    SELECT customer_id FROM vehicle_customer_links
    WHERE vehicle_id = v_vehicle AND is_primary AND end_date IS NULL
    ORDER BY updated_at DESC LIMIT 1
  )
  WHERE id = v_vehicle
    AND customer_id IS DISTINCT FROM (
      SELECT customer_id FROM vehicle_customer_links
      WHERE vehicle_id = v_vehicle AND is_primary AND end_date IS NULL
      ORDER BY updated_at DESC LIMIT 1);  -- guard: only write when it actually changes
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_vcl_sync_primary ON vehicle_customer_links;
CREATE TRIGGER trg_vcl_sync_primary
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_customer_links
  FOR EACH ROW EXECUTE FUNCTION sync_vehicle_primary_customer();

CREATE OR REPLACE FUNCTION gms_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_vcl_updated_at ON vehicle_customer_links;
CREATE TRIGGER trg_vcl_updated_at BEFORE UPDATE ON vehicle_customer_links
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();
DROP TRIGGER IF EXISTS trg_vehicle_notes_updated_at ON vehicle_notes;
CREATE TRIGGER trg_vehicle_notes_updated_at BEFORE UPDATE ON vehicle_notes
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- 5. BACKFILL existing single-owner FK as an owner link (primary + reminder recipient).
INSERT INTO vehicle_customer_links
  (organization_id, vehicle_id, customer_id, role, is_primary, is_reminder_recipient)
SELECT v.organization_id, v.id, v.customer_id, 'owner', true, true
FROM vehicles v
WHERE v.customer_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM vehicle_customer_links l
                  WHERE l.vehicle_id = v.id AND l.customer_id = v.customer_id AND l.role = 'owner');

-- 6. ORG EXPIRY-TYPE CONFIG (tenant-defined; MOT/Service/Road Tax seeded as system types).
CREATE TABLE IF NOT EXISTS expiry_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,                  -- 'mot' | 'service' | 'road_tax' | <custom slug>
  label VARCHAR(120) NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,   -- system types are non-deletable
  is_mileage_based BOOLEAN NOT NULL DEFAULT false,
  default_interval_months INTEGER,
  default_interval_miles INTEGER,
  default_channel VARCHAR(10) NOT NULL DEFAULT 'sms',  -- sms | email | both
  default_lead_days INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_expiry_types_org ON expiry_types(organization_id, is_active);
DROP TRIGGER IF EXISTS trg_expiry_types_updated_at ON expiry_types;
CREATE TRIGGER trg_expiry_types_updated_at BEFORE UPDATE ON expiry_types
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- 7. PER-VEHICLE TYPED EXPIRY FACT TABLE (the queryable campaign surface).
CREATE TABLE IF NOT EXISTS vehicle_expiry_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  expiry_type_id UUID REFERENCES expiry_types(id) ON DELETE SET NULL,
  type_code VARCHAR(40) NOT NULL,             -- denormalised for fast filtering
  due_date DATE,                              -- next due (date track)
  due_mileage INTEGER,                        -- next due odometer (service)
  source VARCHAR(20) NOT NULL DEFAULT 'manual', -- dvsa | dvla | computed | manual | dms | service
  is_active BOOLEAN NOT NULL DEFAULT true,    -- false = dismissed for this vehicle
  last_notified_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  notes TEXT,
  computed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vehicle_id, type_code)
);
CREATE INDEX IF NOT EXISTS idx_ved_due
  ON vehicle_expiry_dates(organization_id, type_code, due_date) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_ved_vehicle ON vehicle_expiry_dates(vehicle_id);
DROP TRIGGER IF EXISTS trg_ved_updated_at ON vehicle_expiry_dates;
CREATE TRIGGER trg_ved_updated_at BEFORE UPDATE ON vehicle_expiry_dates
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- 8. OPTIONAL mileage history (feeds future date+mileage service prediction).
CREATE TABLE IF NOT EXISTS vehicle_mileage_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reading_date DATE NOT NULL,
  mileage INTEGER NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'health_check', -- health_check | mot | dms | manual
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vmr_vehicle ON vehicle_mileage_readings(vehicle_id, reading_date DESC);

-- 9. EXPIRY CAMPAIGN config — which expiry type uses which Follow-Up timeline cadence.
CREATE TABLE IF NOT EXISTS expiry_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expiry_type_id UUID NOT NULL REFERENCES expiry_types(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  timeline_id UUID REFERENCES follow_up_timelines(id),  -- cadence/templates; anchor = due_date
  lead_days INTEGER NOT NULL DEFAULT 30,
  is_enabled BOOLEAN NOT NULL DEFAULT false,            -- opt-in
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, expiry_type_id)
);
DROP TRIGGER IF EXISTS trg_expiry_campaigns_updated_at ON expiry_campaigns;
CREATE TRIGGER trg_expiry_campaigns_updated_at BEFORE UPDATE ON expiry_campaigns
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- 10. DEDICATED EXPIRY REMINDER CASES (do NOT overload follow_up_cases — that table
--     is health_check_id NOT NULL + UNIQUE(health_check_id), bound to a real HC).
--     This table reuses the engine's SEND + SUPPRESS helpers, not its schema.
CREATE TABLE IF NOT EXISTS expiry_reminder_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES expiry_campaigns(id) ON DELETE CASCADE,
  recipient_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  type_code VARCHAR(40) NOT NULL,
  due_date DATE NOT NULL,                     -- the expiry window this case is for
  timeline_id UUID REFERENCES follow_up_timelines(id),
  current_step INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','engaged','booking_found','closed')),
  next_action_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  closed_reason VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One open case per (vehicle, type, due window) — prevents re-firing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_erc_open
  ON expiry_reminder_cases(organization_id, vehicle_id, type_code, due_date)
  WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS idx_erc_due ON expiry_reminder_cases(organization_id, status, next_action_at);
DROP TRIGGER IF EXISTS trg_erc_updated_at ON expiry_reminder_cases;
CREATE TRIGGER trg_erc_updated_at BEFORE UPDATE ON expiry_reminder_cases
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- 11. SEED system expiry types per org + project existing MOT dates into the fact table.
CREATE OR REPLACE FUNCTION seed_expiry_types_for_org(p_org UUID) RETURNS VOID AS $$
BEGIN
  INSERT INTO expiry_types
    (organization_id, code, label, is_system, is_mileage_based,
     default_interval_months, default_interval_miles, default_channel, default_lead_days, sort_order)
  VALUES
    (p_org,'mot','MOT',true,false,NULL,NULL,'sms',30,1),
    (p_org,'service','Service',true,true,12,12000,'sms',21,2),
    (p_org,'road_tax','Road Tax (VED)',true,false,12,NULL,'sms',14,3)
  ON CONFLICT (organization_id, code) DO NOTHING;
END; $$ LANGUAGE plpgsql;

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM organizations LOOP PERFORM seed_expiry_types_for_org(r.id); END LOOP;
END $$;

-- Project any vehicle that already has an MOT expiry into the fact table (seeding ran above).
INSERT INTO vehicle_expiry_dates
  (organization_id, vehicle_id, type_code, due_date, source, expiry_type_id)
SELECT v.organization_id, v.id, 'mot', v.mot_expiry_date, 'dvsa', et.id
FROM vehicles v
LEFT JOIN expiry_types et ON et.organization_id = v.organization_id AND et.code = 'mot'
WHERE v.mot_expiry_date IS NOT NULL
ON CONFLICT (vehicle_id, type_code)
  DO UPDATE SET due_date = EXCLUDED.due_date, source = 'dvsa',
                expiry_type_id = EXCLUDED.expiry_type_id, updated_at = NOW();

-- 12. RLS — defence-in-depth ONLY. The Hono API uses the service role and never sets
--     app.current_org_id, so these policies do NOT isolate the app's own traffic; they
--     only bite if something connects as anon/authenticated. Org isolation is enforced
--     in the API via explicit .eq('organization_id', orgId) on every query (as today).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicle_customer_links','vehicle_notes','vehicle_ownership_history',
    'expiry_types','vehicle_expiry_dates','vehicle_mileage_readings',
    'expiry_campaigns','expiry_reminder_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_isolation') THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (organization_id = current_setting(''app.current_org_id'', true)::uuid)', t||'_isolation', t);
    END IF;
  END LOOP;
END $$;
```

**New-org bootstrap:** add `seed_expiry_types_for_org(orgId)` to `services/provisioning.ts → seedDefaultLibraries()` (next to `seed_tyre_reference_for_org`, `seed_follow_up_config_for_org`), and lazy-seed on first `GET /expiry-types` so orgs predating the backfill are covered.

---

## 4. API surface

All vehicle routes live on the already-mounted `/api/v1/vehicles` router. **Critical gating rule:** do **not** put `requireModule('vehicles')` at the router root — `GET /:id`, `GET /lookup/:reg`, `POST /` (create), `PATCH /:id`, `POST /:id/mot-sync`, `GET /:id/mot-history` are reused by the Customers tab, `AddVehicleModal`, and the HC/estimate/jobsheet creation flows for tenants **without** the module. Gate only the new sub-resources and the org-wide collection list.

### Changed

| Endpoint | Change |
|---|---|
| `GET /api/v1/vehicles` | **Enrich** response (`make/model/year/derivative`, `mot_status`, `mot_expiry_date`, `lifecycle_status`, `number_of_previous_keepers`, owner/driver summary). **Add filters:** `make`, `lifecycle_status`, `mot_due` (`expired`/`30`/`60`/`90` vs `mot_expiry_date`); keep `search`, `customer_id`, `limit`/`offset`. **Paginate in-DB** (PostgREST 1000-row cap). **Gate the org-wide list (no `customer_id`) behind `requireModule('vehicles')`; the `customer_id`-scoped call the Customers tab uses stays ungated.** |
| `GET /api/v1/vehicles/:id` | Add `links[]` (owner/driver/keeper/fleet, each embedding customer), `notes[]`, `expiries[]` (joined to `expiry_types`) so the detail card renders in one fetch. Keep top-level `customer` (primary) for backward-compat. **Note:** `links[]`/`notes[]`/`expiries[]` are to-**many** (arrays); the existing `customer` embed is to-**one** (object) — mind the [[postgrest-toone-embed-gotcha]]. |
| `PATCH /api/v1/vehicles/:id` | Route a `customerId` change through the audit helper **only when it actually differs from the current `vehicles.customer_id`** — a plain make/model PATCH must not write an ownership-history row or fire the sync trigger. |

### New (gated `requireModule('vehicles')`; per-row `authorize`)

| Method + path | Purpose | Min role |
|---|---|---|
| `GET/POST/PATCH/DELETE /:id/links` | Manage `vehicle_customer_links`. Setting a new primary/reminder closes the old one in the **same transaction** (avoid `23505` on the partial unique index). | `service_advisor` (read: `technician`) |
| `POST /:id/transfer-owner` `{toCustomerId, reason, notes}` | Atomic: read current primary as `from_customer_id`; close old owner link (`end_date=today`), open new owner link (`is_primary=true`); insert `vehicle_ownership_history`. HCs/jobsheets/notes/MOT/expiries **never move** (they FK `vehicle_id`). If `reason='sold'`, set `lifecycle_status='sold'`. **v1 = simple re-link + audit** (work history stays with the car); skip Tekmetric-style multi-tier rewrites. | `org_admin` |
| `GET /:id/ownership-history` | Audit timeline (embed customer names). | `service_advisor` |
| `GET/POST/PATCH/DELETE /:id/notes` | CRUD `vehicle_notes` (`author_id = auth.user.id`). `internal` hidden from `technician`; delete gated `site_admin`+. | `service_advisor` |
| `GET/PUT/DELETE /:id/expiries` | Set/clear/snooze/dismiss a `vehicle_expiry_dates` row (UPSERT on `(vehicle_id, type_code)`). MOT row read-only (DVSA source). | `service_advisor` |
| `POST /:id/refresh` `{newRegistration?, includePaidDetails?}` | **Unified refresh-by-VRM.** Always runs the **free** DVSA mot-sync. The **paid** VehicleDetails call fires **only when `includePaidDetails:true`** AND a **server-side `requireModule('vehicle_details')` re-check** passes — so the default Refresh never re-bills DVLA. If `newRegistration` differs → update `vehicles.registration` (uppercased, spaces stripped) **and reset `keeper_baseline_*`** so sold-detection re-baselines (no false "sold"). After MOT sync, UPSERT `vehicle_expiry_dates(type_code='mot', source='dvsa')` and stamp `last_activity_at`. Surface reg-collision `23505` as `409`. Returns `{mot:{found,status}, details:{found,lifecycleStatus}|null}`. | `service_advisor` |

### New top-level routes (mounted next to `serviceTypes`/`repairTypes` in `index.ts`)

| Method + path | Purpose |
|---|---|
| `GET/POST/PATCH/DELETE /api/v1/expiry-types` | Org expiry-type config CRUD. `org_admin` to create/edit; system types non-deletable; lazy-seed on first read. |
| `GET/PATCH /api/v1/expiry-campaigns` (+ `GET /:id/audience-count`) | Enable/disable, pick `timeline_id`, set `lead_days`; audience preview via the indexed query. `requireModule('vehicle_reminders')`. |

### New services

- **`services/vehicle-expiry.ts`** — `recomputeVehicleExpiries(orgId, vehicleId)`: the single writer of `vehicle_expiry_dates`. `mot` ← copy `mot_expiry_date`; `road_tax` ← from `vehicle_spec` if present, else `date_first_registered + 12mo` (`source='computed'`); **`service` is manual-entry in v1** (no service-event source exists today — see §8 Q2). Called from `persistMotHistory`, `persistVehicleDetails`, and HC completion / jobsheet close (which also append a `vehicle_mileage_readings` row and stamp `vehicles.last_activity_at`).
- **`services/vehicle-activity.ts`** (or inline) — stamp `vehicles.last_activity_at = NOW()` on HC create, jobsheet close, and MOT sync.

### Module registry (edit **both** `apps/api/src/lib/modules.ts` and `apps/web/src/lib/modules.ts`)

```ts
| 'vehicles'
| 'vehicle_reminders'
{ key: 'vehicles',          label: 'Vehicles',         description: 'Vehicle asset register with owners/drivers, MOT/service/custom expiry tracking and campaign targeting', defaultOn: true },
{ key: 'vehicle_reminders', label: 'Expiry Reminders', description: 'Expiry-driven (MOT/Service/custom) reminder campaigns via the Follow-Up engine', defaultOn: false },
```

> Both files are hand-duplicated — edit both or the API is ungated / the nav is hidden. The admin Modules toggle UI auto-enumerates (no admin-UI edit needed).

---

## 5. Frontend

### Nav + routes (mirror Estimates)

- `App.tsx` — `const VehicleList = lazy(() => import('./pages/Vehicles/VehicleList'))`, `VehicleDetail` likewise; routes `/vehicles` and `/vehicles/:id` each wrapped in `<RequireModule module="vehicles">`, inside the `DashboardLayout` block.
- `layouts/DashboardLayout.tsx` — add a flat `NavItem` (car icon) **directly below Customers** (a register pairs with CRM, not booking docs). `roles: ['super_admin','org_admin','site_admin','service_advisor']`, `module: 'vehicles'`. (API still allows `technician` GET for mobile reuse; nav hidden — confirm in §8 Q5.)

### `/vehicles` list — `pages/Vehicles/VehicleList.tsx`

Copy `EstimatesList.tsx`. Filter bar: search (reg/VIN/make/model), make dropdown, MOT-due selector (expired / 30 / 60), lifecycle dropdown. Each row → `/vehicles/:id`: yellow reg plate (reuse `VehicleCard` plate styling), make/model/year, primary owner, MOT badge (`bg-rag-red` expired / `bg-rag-amber` soon / `bg-rag-green` valid), lifecycle pill. `+ Add Vehicle` opens existing `AddVehicleModal`. Cards `rounded-xl`.

### `/vehicles/:id` detail "card" — `pages/Vehicles/VehicleDetail.tsx`

Single fetch from enriched `GET /:id`. Sections (all `rounded-xl`):

1. **Header** — reg plate + make/model/derivative + lifecycle banner (`active` hidden; `sold`/`scrapped`/`exported`/`destroyed` shown amber/red with `lifecycle_changed_at`). Actions: **Refresh vehicle data** (default = free DVSA; a separate "Update DVLA spec (paid)" option appears only when `isEnabled('vehicle_details')`, with a cost-aware confirm → posts `includePaidDetails:true`); **Correct registration** (inline VRM editor → `{newRegistration}`); **Change owner** → transfer modal.
2. **Identity / Spec** — DVLA columns + promoted `vehicle_spec` JSONB (dimensions, NCAP, EV range, economy), read-only; degrade gracefully when null / `vehicle_details` off.
3. **MOT** — `GET /:id/mot-history`: expiry + collapsible per-test history (date, pass/fail, mileage, advisories).
4. **Owner & Drivers** — current owner + drivers/fleet from `links[]`, each a chip linking to the customer; badges **Primary (billed to)** and **Reminders to**; "Add person" (pick existing customer + role). *(Lex Autolease = owner; Mrs Smith = driver, reminders-to.)*
5. **Expiry & reminders** — each type (MOT/Service/Road Tax/custom) with `due_date`, `due_mileage`, a RAG days-to-due pill, source badge, inline Edit / Snooze / Dismiss. MOT row read-only.
6. **Notes** — pinned-first list (author + relative date + category pill + pin/edit/delete) + add-note composer. Match `NotesTab.tsx` styling; not the single-textarea customer pattern.
7. **History timeline (P4)** — reverse-chron unified feed: health checks, jobsheets, MOT results, DVLA refreshes, ownership changes, deferred work, comms, notes. VIN-anchored; persists across ownership changes.

### Shared

- `VehicleCard.tsx` — wrap in `<Link to="/vehicles/:id">` when `vehicles` enabled, so the Customers › Vehicles tab cards navigate into the standalone detail; `VehiclesTab` stays the customer-scoped subset.
- Transfer-owner / add-person modals follow `docs/form-design-guidelines.md` (dark `#16191f` action, `rounded-[10px]` inputs / `rounded-[18px]` card, label-rail layout).
- **Settings (P3):** "Vehicle Expiry Types" page (mirror `ServiceTypes.tsx`/`RepairTypes.tsx`) + a `SettingsHub` card; "Reminder Campaigns" page (per type: enable toggle, timeline picker reusing the Follow-Up cadence editor, lead-days, live audience count).
- Shared types — add `VehicleCustomerLink`, `VehicleNote`, `VehicleExpiry`, `ExpiryType`; extend `Vehicle` with DVLA columns + `links[]`.

---

## 6. Marketing / reminder integration

**Principle: reuse the Follow-Up *delivery primitives*, not its case table.** The deployed `follow_up_cases` is `health_check_id UUID NOT NULL` + `UNIQUE(health_check_id)` with the engine hardwired to a real HC (token fetch, ws emit, comms log). Expiry reminders have no health check, so they use the dedicated **`expiry_reminder_cases`** table (§3 step 10) and a parallel `processExpiryCases()` that **shares** the engine's send-window/quiet-hours, STOP/opt-out, `communication_logs`, and org-branded templating helpers. This inherits all consent/logging behaviour without a structural change to a live table, and keeps the Follow-Up board's deferred-work semantics clean.

**Audience query** (indexed via `idx_ved_due`; paginate with `.order('due_date')`):

```sql
SELECT e.vehicle_id, v.registration, v.make, v.model,
       c.id AS recipient_id, c.first_name, c.last_name, c.mobile, c.email,
       et.label AS reminder_type, e.due_date, e.due_mileage
FROM vehicle_expiry_dates e
JOIN vehicles v       ON v.id = e.vehicle_id
JOIN expiry_types et  ON et.id = e.expiry_type_id
-- recipient = the reminder-recipient link, NOT vehicles.customer_id:
JOIN vehicle_customer_links l
  ON l.vehicle_id = v.id AND l.is_reminder_recipient AND l.end_date IS NULL
JOIN customers c ON c.id = l.customer_id
WHERE e.organization_id = $1 AND e.type_code = $2 AND e.is_active
  AND e.due_date BETWEEN current_date AND current_date + ($3 || ' days')::interval
  AND v.lifecycle_status = 'active'                          -- sold/scrapped suppression
  AND NOT c.contact_opt_out                                  -- PECR / STOP suppression
  AND (e.snoozed_until IS NULL OR e.snoozed_until < now())
  AND (v.last_activity_at IS NULL OR v.last_activity_at > now() - interval '2 years') -- recency gate
  AND NOT EXISTS (                                           -- already booked-in suppression
    SELECT 1 FROM health_checks hc
    WHERE hc.vehicle_id = v.id
      AND hc.status IN ('awaiting_arrival','awaiting_checkin','created','assigned','in_progress')
      AND hc.created_at > now() - interval '60 days')
ORDER BY e.due_date ASC;
```

**Engine wiring:** extend the existing sweep with `createExpiryCasesForOrg(orgId)` — for each enabled `expiry_campaign`, open an `expiry_reminder_cases` row for vehicles entering the lead window (deduped by `uq_erc_open`). `processExpiryCases()` steps the chosen `timeline_id`, calling the shared send/suppress helpers. A renewed MOT (changed `due_date`) closes the old case and opens a new window.

**Suppression rules:** `lifecycle_status='active'` · `customers.contact_opt_out`/STOP · per-vehicle `is_active`/`snoozed_until` · `last_activity_at` recency (default 2 yrs, configurable) · already-booked-in (open HC < 60 days) · **double-contact cooldown** (skip an expiry send if any open follow-up/expiry case for that customer was contacted within N days).

**Recipient is always the reminder-recipient link** (default = primary owner for retail; driver for lease), never `vehicles.customer_id` — so a lease MOT reminder reaches **Mrs Smith**, not Lex Autolease. This is the core owner-vs-driver payoff.

---

## 7. Phased build order

**Phase 0 — Deploy the pending data layer (prereq).** Commit + deploy `20260628120000_vehicle_details_enrichment.sql` and the uncommitted vehicle-details code to dev via the pipeline. *Milestone: `vehicle_details` columns live on dev; `npm run build` clean.*

**Phase 1 — Migration + module + standalone surface (no new behaviour).** Deploy `20260628140000`; verify backfill + MOT projection + `last_activity_at`. Register `vehicles` module (both files), nav item, routes. Enrich `GET /vehicles`. `VehicleList` + `VehicleDetail` (identity/spec + MOT only). `VehicleCard` → link to detail. *Milestone: advisor browses `/vehicles`, opens a card, sees all DVLA+MOT data; Customers tab unaffected.*

**Phase 2 — Notes, owners/drivers, transfer, unified refresh.** `vehicle_notes` + `vehicle_customer_links` + `vehicle_ownership_history` endpoints; PATCH audit guard. `POST /:id/refresh` (free-by-default, opt-in paid, reg-correction, baseline reset). `POST /:id/transfer-owner`. Detail-page Notes / Owner & Drivers panels + modals. *Milestone: add a driver to a lease car, transfer ownership with audit, refresh/correct a reg.*

**Phase 3 — Expiry storage + campaigns.** `services/vehicle-expiry.ts` + recompute hooks. `expiry-types` + `expiry-campaigns` routes; Settings pages (Expiry Types, Reminder Campaigns w/ audience count). `expiry_reminder_cases` + `createExpiryCasesForOrg`/`processExpiryCases` behind `vehicle_reminders`; cooldown guard. Expiry panel on the card. *Milestone: tenant enables an MOT campaign; due vehicles get reminders, suppressed correctly. (Service campaigns ship as **manual-date** — auto-prediction deferred to P4.)*

**Phase 4 — Polish (optional).** History timeline; deferred-work panel; backfill `vehicle_mileage_readings` from `vehicle_mot_tests.odometer_value` + capture service date/mileage at jobsheet close → light up **auto service-due prediction**; spec-panel JSONB promotions; free DVLA VES tax-status; recall flag.

---

## 8. Product decisions

### Locked 2026-06-28

1. **Expiry-reminder engine →** **dedicated `expiry_reminder_cases` table** that reuses the Follow-Up send/opt-out/logging primitives. No structural change to the live `follow_up_cases` (it stays `health_check_id NOT NULL`). *(§3.10, §6.)*
2. **"Service due" →** **manual date/mileage entry in v1.** Capture service date + mileage at jobsheet/HC close into `vehicle_mileage_readings`; auto-prediction lights up in Phase 4. *(§4, §7.)*
3. **Reminder recipient →** **per-vehicle, smart default** (retail = owner, lease/fleet = driver) via `vehicle_customer_links.is_reminder_recipient`, overridable per vehicle. *(§6.)*
4. **Ownership transfer →** **simple re-link + `vehicle_ownership_history` audit; work history stays with the car.** No multi-tier historical rewrite in v1. *(§4 `transfer-owner`.)*

### Still open (sensible defaults applied; flag if you disagree)

5. **Marketing consent (UK PECR/GDPR).** Default: treat MOT/Service as service messages (legitimate interest) under the existing `contact_opt_out`/STOP. Revisit a dedicated marketing-consent flag if custom expiry types become pure marketing.
6. **Technicians browse the standalone list (mobile)?** Default: API allows `technician` GET (mobile reuse), nav item hidden (advisor/admin browse).
7. **Registered keeper (DVLA) auto-created as a customer/driver?** Default: read-only provenance on the vehicle; `keeper` role available but added manually.
8. **Recency suppression window.** Default: 2 years (Motasoft precedent), per-org configurable.
9. **`vehicle_details` `defaultOn`** is already `false` (paid). Kept — the refresh button's paid path inherits that gate.

---

## 9. Risk register (folded from adversarial review)

| Risk | Mitigation in this plan |
|---|---|
| Overloading `follow_up_cases` (NOT NULL + UNIQUE `health_check_id`) breaks expiry inserts | Dedicated `expiry_reminder_cases` table (§3.10, §6) |
| `last_activity_at` referenced but never existed | Added + backfilled + maintained (§3.0, services) |
| `service` expiry has no data source | Manual in v1; capture at jobsheet close for P4 auto-predict (§8 Q2) |
| Accidental re-billing of paid DVLA on every Refresh | Paid call opt-in per request + **server-side** module re-check; default Refresh = free DVSA only (§4) |
| Silent ownership change via PATCH | Audit only when `customer_id` actually differs; transfer endpoint is the real path (§4) |
| Setting new primary/reminder hits `23505` partial-unique | Close-old + open-new in one transaction (§4) |
| MOT-projection rows orphaned with NULL `expiry_type_id` | Seed runs before projection; `ON CONFLICT … DO UPDATE SET expiry_type_id` (§3.11) |
| Customers tab breaks if list is gated | Tab uses the ungated `customer_id`-scoped call; only the org-wide list is gated (§4) |
| RLS assumed to isolate API traffic | Stated as defence-in-depth only — service role bypasses RLS; isolation is the `.eq(organization_id)` discipline (§3.12) |
| to-many vs to-one embed shape bug | `links[]/notes[]/expiries[]` are arrays; `customer` is an object — see [[postgrest-toone-embed-gotcha]] (§4) |
| Reg-correction falsely flags "sold" | Reset `keeper_baseline_*` on reg change so sold-detection re-baselines; verify `persistVehicleDetails` honours it (§4) |
| Migration drift from out-of-band MCP apply | Deploy only via pipeline `supabase db push` — see [[dev-migration-drift]] (§3) |

---

### Key files

- **Migration:** `supabase/migrations/20260628140000_vehicles_module.sql` (new)
- **API:** `apps/api/src/routes/vehicles.ts` (enrich list, add sub-routes), new `routes/expiry-types.ts` + `routes/expiry-campaigns.ts`, new `services/vehicle-expiry.ts`, hook `services/mot-history.ts` / `services/vehicle-details.ts` / `services/follow-up-engine.ts` / `services/provisioning.ts`, register in `apps/api/src/index.ts`, `apps/api/src/lib/modules.ts`
- **Web:** `apps/web/src/lib/modules.ts`, `App.tsx`, `layouts/DashboardLayout.tsx`, new `pages/Vehicles/VehicleList.tsx` + `VehicleDetail.tsx`, `pages/Customers/components/VehicleCard.tsx`, `packages/shared/src/types/index.ts`
- **Precedent to copy:** `apps/web/src/pages/Estimates/EstimatesList.tsx`, `apps/api/src/routes/estimates.ts`, `docs/form-design-guidelines.md`, `apps/web/src/pages/Settings/RepairTypes.tsx` (settings-page pattern)
