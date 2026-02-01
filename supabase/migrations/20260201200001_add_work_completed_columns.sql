-- Re-add work_completed_at and work_completed_by columns to repair_items
-- These were originally added in 20250115000001_advisor_view_columns.sql but lost
-- when repair_items was dropped and recreated in 20260118300001_repair_groups_pricing_phase1.sql

ALTER TABLE repair_items
ADD COLUMN IF NOT EXISTS work_completed_at TIMESTAMPTZ;

ALTER TABLE repair_items
ADD COLUMN IF NOT EXISTS work_completed_by UUID REFERENCES users(id);

-- Index for finding incomplete work
CREATE INDEX IF NOT EXISTS idx_repair_items_work_incomplete
ON repair_items(health_check_id)
WHERE work_completed_at IS NULL;
