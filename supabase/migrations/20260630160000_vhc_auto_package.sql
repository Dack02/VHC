-- Automatic VHC work line
-- ------------------------------------------------------------------
-- When a jobsheet is created with "Requires VHC" ticked, the system can
-- automatically add a pre-authorised booked work line from a nominated
-- service package, so the technician sees on the job card that a health
-- check is to be performed. This column nominates which service package
-- that is. NULL = feature off (no line added).
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS vhc_service_package_id UUID
  REFERENCES service_packages(id) ON DELETE SET NULL;

COMMENT ON COLUMN organization_settings.vhc_service_package_id IS
  'Service package auto-added as a booked work line on a jobsheet when it is created with a VHC. NULL = off.';
