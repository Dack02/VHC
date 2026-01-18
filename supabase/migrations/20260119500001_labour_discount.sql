-- Migration: Add discount_percent column to repair_labour table
-- This allows labour line discounts to be applied

ALTER TABLE repair_labour
  ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN repair_labour.discount_percent IS 'Discount percentage applied to this labour line (0-100)';

-- Note: The total is now calculated as: (hours * rate) * (1 - discount_percent/100)
-- The application will handle this calculation when saving and displaying
