-- Link MRI items to service packages
-- When an MRI item flags red/amber and auto-creates a repair item,
-- the linked service package's labour and parts are auto-applied.

ALTER TABLE mri_items
  ADD COLUMN IF NOT EXISTS service_package_id UUID REFERENCES service_packages(id) ON DELETE SET NULL;

-- Partial index for efficient lookups on items that have a linked package
CREATE INDEX IF NOT EXISTS idx_mri_items_service_package_id
  ON mri_items (service_package_id)
  WHERE service_package_id IS NOT NULL;
