-- =============================================================================
-- Migration: Remove Brake Disc Thresholds
-- Disc thickness thresholds are vehicle-specific (manufacturer min spec)
-- so they shouldn't be organization-wide settings
-- =============================================================================

ALTER TABLE inspection_thresholds
DROP COLUMN IF EXISTS brake_disc_red_below_mm;

ALTER TABLE inspection_thresholds
DROP COLUMN IF EXISTS brake_disc_amber_below_mm;
