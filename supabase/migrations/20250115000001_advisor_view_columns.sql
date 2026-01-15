-- =============================================================================
-- Migration: Advisor View Columns
-- Adds columns needed for advisor view functionality
-- =============================================================================

-- =============================================================================
-- REPAIR ITEMS TABLE UPDATES
-- =============================================================================

-- Note: parts_price/labour_price already exist as parts_cost/labor_cost
-- Adding advisor-specific columns

-- MOT failure flag
ALTER TABLE repair_items
ADD COLUMN IF NOT EXISTS is_mot_failure BOOLEAN DEFAULT false;

-- Follow-up date for advisory items
ALTER TABLE repair_items
ADD COLUMN IF NOT EXISTS follow_up_date DATE;

-- Work completion tracking
ALTER TABLE repair_items
ADD COLUMN IF NOT EXISTS work_completed_at TIMESTAMPTZ;

ALTER TABLE repair_items
ADD COLUMN IF NOT EXISTS work_completed_by UUID REFERENCES users(id);

-- =============================================================================
-- CHECK RESULTS TABLE UPDATES
-- =============================================================================

-- MOT failure flag (set by technician during inspection)
ALTER TABLE check_results
ADD COLUMN IF NOT EXISTS is_mot_failure BOOLEAN DEFAULT false;

-- =============================================================================
-- HEALTH CHECKS TABLE UPDATES
-- =============================================================================

-- Health check closure tracking
ALTER TABLE health_checks
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE health_checks
ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Index for finding incomplete work
CREATE INDEX IF NOT EXISTS idx_repair_items_work_incomplete
ON repair_items(health_check_id)
WHERE work_completed_at IS NULL;

-- Index for follow-up dates
CREATE INDEX IF NOT EXISTS idx_repair_items_follow_up
ON repair_items(follow_up_date)
WHERE follow_up_date IS NOT NULL;

-- Index for MOT failures
CREATE INDEX IF NOT EXISTS idx_repair_items_mot_failure
ON repair_items(health_check_id)
WHERE is_mot_failure = true;

CREATE INDEX IF NOT EXISTS idx_check_results_mot_failure
ON check_results(health_check_id)
WHERE is_mot_failure = true;
