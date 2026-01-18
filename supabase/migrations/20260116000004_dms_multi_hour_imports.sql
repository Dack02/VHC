-- Phase C: Enhanced DMS Import Settings
-- Multi-hour imports, daily limit safety, and preview support

-- ============================================
-- 1. Update import schedule from single hour to multiple hours
-- ============================================

-- Add new column for multiple import hours
ALTER TABLE organization_dms_settings
  ADD COLUMN IF NOT EXISTS import_schedule_hours INTEGER[] DEFAULT '{6, 10, 14, 20}';

-- Add daily import limit as safety net
ALTER TABLE organization_dms_settings
  ADD COLUMN IF NOT EXISTS daily_import_limit INTEGER DEFAULT 100;

-- Add last sync timestamp (separate from last_import_at which tracks when import ran)
ALTER TABLE organization_dms_settings
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

-- Migrate existing single hour to array format if import_schedule_hour exists
UPDATE organization_dms_settings
SET import_schedule_hours = ARRAY[import_schedule_hour]
WHERE import_schedule_hour IS NOT NULL
  AND (import_schedule_hours IS NULL OR import_schedule_hours = '{6, 10, 14, 20}');

-- Set auto_import_enabled to false by default (was already default but making explicit)
-- This is a safety measure - users must explicitly enable
ALTER TABLE organization_dms_settings
  ALTER COLUMN auto_import_enabled SET DEFAULT false;

-- Comments for clarity
COMMENT ON COLUMN organization_dms_settings.import_schedule_hours IS 'Hours of day (0-23) for scheduled imports. Default: 6am, 10am, 2pm, 8pm';
COMMENT ON COLUMN organization_dms_settings.daily_import_limit IS 'Maximum health checks that can be imported per day. Safety net to prevent runaway imports.';
COMMENT ON COLUMN organization_dms_settings.last_sync_at IS 'Timestamp when bookings were last synced from DMS (for Awaiting Arrival display)';


-- ============================================
-- 2. Track daily import counts for limit enforcement
-- ============================================

-- Add column to track imports today
ALTER TABLE dms_import_history
  ADD COLUMN IF NOT EXISTS is_preview BOOLEAN DEFAULT false;

COMMENT ON COLUMN dms_import_history.is_preview IS 'True if this was a preview run (no data created)';


-- ============================================
-- 3. Function to check daily import limit
-- ============================================

CREATE OR REPLACE FUNCTION check_daily_import_limit(
  p_organization_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  imports_today INTEGER,
  daily_limit INTEGER,
  remaining INTEGER,
  limit_reached BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  -- Get daily limit for org
  SELECT COALESCE(daily_import_limit, 100)
  INTO v_limit
  FROM organization_dms_settings
  WHERE organization_id = p_organization_id;

  -- Count health checks imported today
  SELECT COUNT(*)
  INTO v_count
  FROM health_checks hc
  JOIN dms_import_history dih ON hc.import_batch_id = dih.id
  WHERE hc.organization_id = p_organization_id
    AND DATE(hc.created_at) = p_date
    AND hc.external_source = 'gemini_osi'
    AND hc.deleted_at IS NULL;

  RETURN QUERY SELECT
    v_count,
    COALESCE(v_limit, 100),
    GREATEST(0, COALESCE(v_limit, 100) - v_count),
    v_count >= COALESCE(v_limit, 100);
END;
$$;


-- ============================================
-- 4. Function to get awaiting arrival stats
-- ============================================

CREATE OR REPLACE FUNCTION get_awaiting_arrival_stats(
  p_organization_id UUID,
  p_site_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_awaiting INTEGER,
  checked_in INTEGER,
  pending INTEGER,
  last_sync_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_sync TIMESTAMPTZ;
BEGIN
  -- Get last sync time from settings
  SELECT ods.last_sync_at
  INTO v_last_sync
  FROM organization_dms_settings ods
  WHERE ods.organization_id = p_organization_id;

  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER AS total_awaiting,
    COUNT(*) FILTER (WHERE hc.status = 'arrived')::INTEGER AS checked_in,
    COUNT(*) FILTER (WHERE hc.status IN ('created', 'awaiting_arrival'))::INTEGER AS pending,
    v_last_sync
  FROM health_checks hc
  WHERE hc.organization_id = p_organization_id
    AND (p_site_id IS NULL OR hc.site_id = p_site_id)
    AND hc.external_source = 'gemini_osi'
    AND DATE(hc.created_at) = CURRENT_DATE
    AND hc.deleted_at IS NULL;
END;
$$;
