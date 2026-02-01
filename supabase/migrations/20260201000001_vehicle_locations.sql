-- Migration: Vehicle Locations
-- Adds vehicle_locations table for tracking where on a vehicle an inspection item applies
-- (e.g., Front Left, Front Right, Rear Left, Rear Right)
-- Also adds requires_location flag to template_items and location fields to check_results

-- 1. Create vehicle_locations table
CREATE TABLE IF NOT EXISTS vehicle_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  short_name VARCHAR(10) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

-- Index for org lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_org
  ON vehicle_locations(organization_id, sort_order);

-- 2. Add requires_location to template_items
ALTER TABLE template_items
  ADD COLUMN IF NOT EXISTS requires_location BOOLEAN NOT NULL DEFAULT false;

-- 3. Add location fields to check_results
ALTER TABLE check_results
  ADD COLUMN IF NOT EXISTS vehicle_location_id UUID REFERENCES vehicle_locations(id);

ALTER TABLE check_results
  ADD COLUMN IF NOT EXISTS vehicle_location_name VARCHAR(100);

-- 4. Update the unique index on check_results to include vehicle_location_id
-- This allows the same template item to have multiple results at different locations
DROP INDEX IF EXISTS idx_results_unique;

CREATE UNIQUE INDEX idx_results_unique
  ON check_results(
    health_check_id,
    template_item_id,
    instance_number,
    COALESCE(vehicle_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Index for location lookups on results
CREATE INDEX IF NOT EXISTS idx_results_vehicle_location
  ON check_results(vehicle_location_id)
  WHERE vehicle_location_id IS NOT NULL;

-- 5. Enable RLS on vehicle_locations
ALTER TABLE vehicle_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_locations_select ON vehicle_locations;
CREATE POLICY vehicle_locations_select ON vehicle_locations
  FOR SELECT USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS vehicle_locations_insert ON vehicle_locations;
CREATE POLICY vehicle_locations_insert ON vehicle_locations
  FOR INSERT WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS vehicle_locations_update ON vehicle_locations;
CREATE POLICY vehicle_locations_update ON vehicle_locations
  FOR UPDATE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS vehicle_locations_delete ON vehicle_locations;
CREATE POLICY vehicle_locations_delete ON vehicle_locations
  FOR DELETE USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- 6. Seed default locations for all existing organizations
INSERT INTO vehicle_locations (organization_id, name, short_name, sort_order)
SELECT o.id, loc.name, loc.short_name, loc.sort_order
FROM organizations o
CROSS JOIN (
  VALUES
    ('Front Left', 'FL', 1),
    ('Front Right', 'FR', 2),
    ('Rear Left', 'RL', 3),
    ('Rear Right', 'RR', 4)
) AS loc(name, short_name, sort_order)
ON CONFLICT (organization_id, name) DO NOTHING;

-- Comment for documentation
COMMENT ON TABLE vehicle_locations IS
'Vehicle location labels for inspection items (e.g., Front Left, Rear Right).
Each organization can customize their own set of locations.';

COMMENT ON COLUMN template_items.requires_location IS
'When true, the technician must select one or more vehicle locations when inspecting this item.
A separate check_result is created for each selected location.';

COMMENT ON COLUMN check_results.vehicle_location_id IS
'Reference to the vehicle location this result applies to. NULL for items that do not require location.';

COMMENT ON COLUMN check_results.vehicle_location_name IS
'Denormalized location name for display purposes and to preserve history if the location is later renamed.';
