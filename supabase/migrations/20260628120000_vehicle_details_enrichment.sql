-- Vehicle Details enrichment (Vehicle Data Global — VehicleDetails package).
-- Adds DVLA spec/provenance columns to vehicles. Complements (does not replace)
-- the DVSA MOT columns added in 20260616130000_mot_history_lookup.sql.
-- Additive + idempotent; see docs/vehicle-details-integration-plan.md.

-- Identity / spec
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS derivative            VARCHAR(120); -- model variant / series
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS body_type             VARCHAR(60);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission          VARCHAR(40);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS drive_type            VARCHAR(20);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS power_bhp             INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS co2_gkm               INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS euro_status           VARCHAR(20);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS date_first_registered DATE;

-- Powertrain (cleanly separates EV/hybrid — fuel_type alone doesn't)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS powertrain_type       VARCHAR(10); -- ICE | BEV | PHEV | REEV

-- Vehicle classification (org segments car vs van/commercial for pricing/reporting)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS taxation_class        VARCHAR(10); -- Car | PVC | LCV | HCV | Quad
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_class         VARCHAR(40); -- e.g. Car

-- Raw lifecycle facts from DVLA (also drive lifecycle_status below)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_scrapped           BOOLEAN;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_exported           BOOLEAN;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_imported           BOOLEAN;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS certificate_of_destruction_issued BOOLEAN;

-- Keeper / V5 reporting (drives "customer sold vehicle" detection)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS keeper_start_date            DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS number_of_previous_keepers   INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS previous_keeper_disposal_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS latest_v5c_issue_date        DATE;

-- Unified lifecycle status — single field the reminder/Follow-Up suppression reads.
-- active = serviceable; sold = keeper changed (derived); scrapped/exported/destroyed = DVLA fact.
-- Precedence when set: destroyed > scrapped > exported > sold > active.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS lifecycle_status      VARCHAR(12) DEFAULT 'active';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS lifecycle_changed_at  TIMESTAMPTZ;

-- Baseline captured at first enrichment, to compare against on refresh (sold detection)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS keeper_baseline_start_date   DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS keeper_baseline_count        INTEGER;

-- Full results payload (everything we don't promote to a column lives here)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_spec          JSONB;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_data_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vehicles_lifecycle_status ON vehicles(organization_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_vehicles_powertrain_type ON vehicles(organization_id, powertrain_type);
CREATE INDEX IF NOT EXISTS idx_vehicles_taxation_class ON vehicles(organization_id, taxation_class);
CREATE INDEX IF NOT EXISTS idx_vehicles_keeper_start ON vehicles(organization_id, keeper_start_date);
