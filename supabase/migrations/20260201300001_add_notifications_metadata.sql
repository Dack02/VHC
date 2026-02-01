-- =============================================================================
-- Add metadata column to notifications table
-- The createNotification function inserts a metadata field but the column
-- was missing, causing all notification inserts to fail silently.
-- =============================================================================

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
