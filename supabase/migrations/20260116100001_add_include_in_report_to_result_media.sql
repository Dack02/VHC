-- Add include_in_report column to result_media table
-- Default is true so all existing photos are included
ALTER TABLE result_media ADD COLUMN IF NOT EXISTS include_in_report BOOLEAN NOT NULL DEFAULT true;

-- Add index for filtering photos by include_in_report
CREATE INDEX IF NOT EXISTS idx_media_include_in_report ON result_media(check_result_id, include_in_report);
