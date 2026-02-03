-- Add rate column to service_package_labour so packages store their own labour rate
-- instead of relying on the current labour_codes.hourly_rate at application time.
-- Null means "use the labour code's current rate" (backwards compatible with existing packages).
ALTER TABLE service_package_labour ADD COLUMN IF NOT EXISTS rate DECIMAL(10,2);
