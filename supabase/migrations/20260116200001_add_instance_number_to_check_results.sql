-- Migration: Add instance_number to check_results for duplicate item support
-- This allows technicians to create multiple instances of the same check item
-- (e.g., two oil leaks, two concerns of same type)

-- Add instance_number column with default of 1 for existing records
ALTER TABLE check_results
ADD COLUMN instance_number INTEGER NOT NULL DEFAULT 1;

-- Add constraint to ensure instance_number is positive
ALTER TABLE check_results
ADD CONSTRAINT check_results_instance_number_positive
CHECK (instance_number >= 1);

-- Drop the existing unique index
DROP INDEX IF EXISTS idx_results_unique;

-- Create new unique index that includes instance_number
-- This allows multiple results for the same template_item, each with different instance_number
CREATE UNIQUE INDEX idx_results_unique
ON check_results(health_check_id, template_item_id, instance_number);

-- Add index to help with queries that need to get all instances of an item
CREATE INDEX idx_results_instance
ON check_results(template_item_id, instance_number);

-- Comment for documentation
COMMENT ON COLUMN check_results.instance_number IS
'Instance number for duplicate items. Defaults to 1. When a technician creates a duplicate
of an item (e.g., multiple oil leaks), each gets a sequential instance_number (1, 2, 3...).
The combination of (health_check_id, template_item_id, instance_number) must be unique.';
