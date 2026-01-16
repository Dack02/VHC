-- =============================================================================
-- Fix Notifications Schema
-- Add is_read column and update indexes
-- =============================================================================

-- Add is_read column if it doesn't exist
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

-- Update existing records: set is_read based on read_at
UPDATE notifications
SET is_read = (read_at IS NOT NULL)
WHERE is_read IS NULL OR is_read = false;

-- Create index for unread notifications query
DROP INDEX IF EXISTS idx_notifications_unread;
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;

-- Create index for created_at sorting
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(user_id, created_at DESC);
