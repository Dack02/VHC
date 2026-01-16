-- Migration: Fix corrupted instance_numbers in check_results
-- Some records may have non-sequential instance_numbers (like database IDs)
-- This migration renumbers them to be sequential (1, 2, 3...)

-- Create a temporary table to hold the corrected instance numbers
WITH numbered_results AS (
  SELECT
    id,
    health_check_id,
    template_item_id,
    instance_number as old_instance_number,
    ROW_NUMBER() OVER (
      PARTITION BY health_check_id, template_item_id
      ORDER BY COALESCE(instance_number, 999999), created_at
    ) as new_instance_number
  FROM check_results
)
-- Update records where instance_number is wrong (not sequential starting from 1)
UPDATE check_results cr
SET instance_number = nr.new_instance_number
FROM numbered_results nr
WHERE cr.id = nr.id
  AND cr.instance_number != nr.new_instance_number;

-- Delete true duplicates (multiple records with same health_check_id, template_item_id, instance_number)
-- Keep the most recently updated one
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY health_check_id, template_item_id, instance_number
      ORDER BY updated_at DESC, created_at DESC
    ) as rn
  FROM check_results
)
DELETE FROM check_results
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Log cleanup results
DO $$
DECLARE
  total_records INTEGER;
  max_instance INTEGER;
BEGIN
  SELECT COUNT(*), MAX(instance_number)
  INTO total_records, max_instance
  FROM check_results;

  RAISE NOTICE 'Cleanup complete. Total records: %, Max instance_number: %', total_records, max_instance;
END $$;
