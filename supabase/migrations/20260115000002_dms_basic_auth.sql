-- Phase 11b: Update DMS Integration for Basic Auth
-- Gemini API uses username/password Basic Auth instead of API key

-- Add username and password columns for Basic Auth
ALTER TABLE organization_dms_settings
  ADD COLUMN IF NOT EXISTS username_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS password_encrypted TEXT;

-- Keep api_key_encrypted for potential future providers that use API keys
-- Add comment to clarify usage
COMMENT ON COLUMN organization_dms_settings.api_key_encrypted IS 'Legacy: API key for providers that use token auth. Not used by Gemini OSI.';
COMMENT ON COLUMN organization_dms_settings.username_encrypted IS 'Encrypted username for Basic Auth (Gemini OSI)';
COMMENT ON COLUMN organization_dms_settings.password_encrypted IS 'Encrypted password for Basic Auth (Gemini OSI)';
