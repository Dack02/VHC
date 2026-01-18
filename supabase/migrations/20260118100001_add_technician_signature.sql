-- Add technician signature column to health_checks table
-- This stores the base64 encoded PNG signature image

ALTER TABLE health_checks
ADD COLUMN IF NOT EXISTS technician_signature TEXT;

COMMENT ON COLUMN health_checks.technician_signature IS 'Base64 encoded PNG image of technician signature at inspection completion';
