-- Add exclude_from_ai flag to template items
-- When true, the item will be skipped during bulk AI reason generation
ALTER TABLE template_items ADD COLUMN IF NOT EXISTS exclude_from_ai BOOLEAN NOT NULL DEFAULT false;
