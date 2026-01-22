-- Migration: Add customer signature fields to repair_items table
-- This unifies the authorization system by storing signatures directly on repair_items
-- instead of in the separate authorizations table

-- Add customer signature fields to repair_items
ALTER TABLE repair_items
ADD COLUMN IF NOT EXISTS customer_signature_data TEXT,
ADD COLUMN IF NOT EXISTS customer_signature_ip INET,
ADD COLUMN IF NOT EXISTS customer_signature_user_agent TEXT,
ADD COLUMN IF NOT EXISTS customer_notes TEXT;

-- Add comments for documentation
COMMENT ON COLUMN repair_items.customer_signature_data IS 'Base64 encoded signature image or storage path';
COMMENT ON COLUMN repair_items.customer_signature_ip IS 'IP address when customer signed';
COMMENT ON COLUMN repair_items.customer_signature_user_agent IS 'User agent string when customer signed';
COMMENT ON COLUMN repair_items.customer_notes IS 'Notes provided by customer during approval/decline';
