/**
 * Credential Resolution Service
 * Resolves SMS and Email credentials based on organization settings
 * Falls back to platform credentials if org doesn't have custom credentials
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { decrypt } from '../lib/encryption.js'

export interface SmsCredentials {
  accountSid: string
  authToken: string
  phoneNumber: string
}

export interface EmailCredentials {
  apiKey: string
  fromEmail: string
  fromName: string
}

export interface CredentialResult<T> {
  source: 'organization' | 'platform'
  configured: boolean
  credentials: T | null
  error?: string
}

/**
 * Get SMS credentials for an organization
 * Returns org credentials if set and use_platform_sms is false, else platform credentials
 */
export async function getSmsCredentials(
  organizationId: string
): Promise<CredentialResult<SmsCredentials>> {
  console.log(`[Credentials] Getting SMS credentials for org ${organizationId}`)

  try {
    // First check organization notification settings
    const { data: orgSettings, error: orgError } = await supabaseAdmin
      .from('organization_notification_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    console.log(`[Credentials] Org notification settings:`, {
      found: !!orgSettings,
      error: orgError?.message,
      use_platform_sms: orgSettings?.use_platform_sms,
      sms_enabled: orgSettings?.sms_enabled,
      has_twilio_sid: !!orgSettings?.twilio_account_sid_encrypted,
      has_twilio_token: !!orgSettings?.twilio_auth_token_encrypted,
      has_phone: !!orgSettings?.twilio_phone_number
    })

    // If org has custom SMS credentials and is not using platform
    if (
      orgSettings &&
      !orgSettings.use_platform_sms &&
      orgSettings.sms_enabled &&
      orgSettings.twilio_account_sid_encrypted &&
      orgSettings.twilio_auth_token_encrypted &&
      orgSettings.twilio_phone_number
    ) {
      try {
        const credentials: SmsCredentials = {
          accountSid: decrypt(orgSettings.twilio_account_sid_encrypted),
          authToken: decrypt(orgSettings.twilio_auth_token_encrypted),
          phoneNumber: orgSettings.twilio_phone_number
        }

        console.log(`[Credentials] Using ORG SMS credentials for org ${organizationId}`)
        return {
          source: 'organization',
          configured: true,
          credentials
        }
      } catch (decryptError) {
        console.error('[Credentials] Failed to decrypt org SMS credentials:', decryptError)
        // Fall through to platform credentials
      }
    }

    // Fall back to platform credentials
    console.log(`[Credentials] Falling back to platform SMS credentials for org ${organizationId}`)
    const { data: platformSettings, error: platformError } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'notifications')
      .single()

    console.log(`[Credentials] Platform settings:`, {
      found: !!platformSettings,
      error: platformError?.message,
      settings_exists: !!platformSettings?.settings
    })

    if (!platformSettings?.settings) {
      console.log(`[Credentials] Platform notification settings not found`)
      return {
        source: 'platform',
        configured: false,
        credentials: null,
        error: 'Platform notification settings not found'
      }
    }

    const settings = platformSettings.settings as Record<string, unknown>

    console.log(`[Credentials] Platform SMS config:`, {
      sms_enabled: settings.sms_enabled,
      has_account_sid: !!settings.twilio_account_sid,
      has_auth_token: !!settings.twilio_auth_token_encrypted,
      has_phone: !!settings.twilio_phone_number
    })

    if (
      !settings.sms_enabled ||
      !settings.twilio_account_sid ||
      !settings.twilio_auth_token_encrypted ||
      !settings.twilio_phone_number
    ) {
      console.log(`[Credentials] Platform SMS not configured`)
      return {
        source: 'platform',
        configured: false,
        credentials: null,
        error: 'Platform SMS not configured'
      }
    }

    try {
      const credentials: SmsCredentials = {
        accountSid: settings.twilio_account_sid as string,
        authToken: decrypt(settings.twilio_auth_token_encrypted as string),
        phoneNumber: settings.twilio_phone_number as string
      }

      console.log(`[Credentials] Using PLATFORM SMS credentials for org ${organizationId}`)
      return {
        source: 'platform',
        configured: true,
        credentials
      }
    } catch (decryptError) {
      console.error('[Credentials] Failed to decrypt platform SMS credentials:', decryptError)
      return {
        source: 'platform',
        configured: false,
        credentials: null,
        error: 'Failed to decrypt platform credentials'
      }
    }
  } catch (error) {
    console.error('[Credentials] Error getting SMS credentials:', error)
    return {
      source: 'platform',
      configured: false,
      credentials: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get Email credentials for an organization
 * Returns org credentials if set and use_platform_email is false, else platform credentials
 */
export async function getEmailCredentials(
  organizationId: string
): Promise<CredentialResult<EmailCredentials>> {
  console.log(`[Credentials] Getting Email credentials for org ${organizationId}`)

  try {
    // First check organization notification settings
    const { data: orgSettings, error: orgError } = await supabaseAdmin
      .from('organization_notification_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    console.log(`[Credentials] Org notification settings for email:`, {
      found: !!orgSettings,
      error: orgError?.message,
      use_platform_email: orgSettings?.use_platform_email,
      email_enabled: orgSettings?.email_enabled,
      has_api_key: !!orgSettings?.resend_api_key_encrypted,
      has_from_email: !!orgSettings?.resend_from_email
    })

    // If org has custom Email credentials and is not using platform
    if (
      orgSettings &&
      !orgSettings.use_platform_email &&
      orgSettings.email_enabled &&
      orgSettings.resend_api_key_encrypted &&
      orgSettings.resend_from_email
    ) {
      try {
        const credentials: EmailCredentials = {
          apiKey: decrypt(orgSettings.resend_api_key_encrypted),
          fromEmail: orgSettings.resend_from_email,
          fromName: orgSettings.resend_from_name || 'Vehicle Health Check'
        }

        console.log(`[Credentials] Using ORG Email credentials for org ${organizationId}`)
        return {
          source: 'organization',
          configured: true,
          credentials
        }
      } catch (decryptError) {
        console.error('[Credentials] Failed to decrypt org Email credentials:', decryptError)
        // Fall through to platform credentials
      }
    }

    // Fall back to platform credentials
    console.log(`[Credentials] Falling back to platform Email credentials for org ${organizationId}`)
    const { data: platformSettings, error: platformError } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'notifications')
      .single()

    console.log(`[Credentials] Platform settings for email:`, {
      found: !!platformSettings,
      error: platformError?.message,
      settings_exists: !!platformSettings?.settings
    })

    if (!platformSettings?.settings) {
      console.log(`[Credentials] Platform notification settings not found for email`)
      return {
        source: 'platform',
        configured: false,
        credentials: null,
        error: 'Platform notification settings not found'
      }
    }

    const settings = platformSettings.settings as Record<string, unknown>

    console.log(`[Credentials] Platform Email config:`, {
      email_enabled: settings.email_enabled,
      has_api_key: !!settings.resend_api_key_encrypted,
      has_from_email: !!settings.resend_from_email
    })

    if (
      !settings.email_enabled ||
      !settings.resend_api_key_encrypted ||
      !settings.resend_from_email
    ) {
      console.log(`[Credentials] Platform Email not configured`)
      return {
        source: 'platform',
        configured: false,
        credentials: null,
        error: 'Platform Email not configured'
      }
    }

    try {
      const credentials: EmailCredentials = {
        apiKey: decrypt(settings.resend_api_key_encrypted as string),
        fromEmail: settings.resend_from_email as string,
        fromName: (settings.resend_from_name as string) || 'Vehicle Health Check'
      }

      console.log(`[Credentials] Using PLATFORM Email credentials for org ${organizationId}`)
      return {
        source: 'platform',
        configured: true,
        credentials
      }
    } catch (decryptError) {
      console.error('[Credentials] Failed to decrypt platform Email credentials:', decryptError)
      return {
        source: 'platform',
        configured: false,
        credentials: null,
        error: 'Failed to decrypt platform credentials'
      }
    }
  } catch (error) {
    console.error('[Credentials] Error getting Email credentials:', error)
    return {
      source: 'platform',
      configured: false,
      credentials: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Check if SMS is available for an organization (either org or platform)
 */
export async function isSmsAvailable(organizationId: string): Promise<boolean> {
  const result = await getSmsCredentials(organizationId)
  return result.configured
}

/**
 * Check if Email is available for an organization (either org or platform)
 */
export async function isEmailAvailable(organizationId: string): Promise<boolean> {
  const result = await getEmailCredentials(organizationId)
  return result.configured
}
