-- Add authorization_method column to health_checks
-- Tracks how customer authorization was recorded: in_person, phone, not_sent, or NULL for online
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS authorization_method VARCHAR(20);
COMMENT ON COLUMN health_checks.authorization_method IS 'How customer authorization was recorded: in_person, phone, not_sent, or NULL for online';
