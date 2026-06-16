-- Add an optional mobile/phone number to super admins.
-- Used as the recipient(s) for platform alerts — notably the SMS sent to super
-- admins when a new organization signs up (see services/super-admin-alerts.ts).
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
