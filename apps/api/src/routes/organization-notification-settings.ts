/**
 * Organization Notification Settings API Routes
 * Manages per-organization notification credentials
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, requireOrgAdmin } from '../middleware/auth.js'
import { encrypt, decrypt, maskString, isEncryptionConfigured } from '../lib/encryption.js'
import { testSmsWithCredentials } from '../services/sms.js'
import { testEmailWithCredentials } from '../services/email.js'
import { getSmsCredentials, getEmailCredentials } from '../services/credentials.js'

const orgNotificationSettingsRoutes = new Hono()

// All routes require authentication
orgNotificationSettingsRoutes.use('*', authMiddleware)

/**
 * GET /api/v1/organizations/:id/notification-settings
 * Get organization notification settings (with masked credentials)
 */
orgNotificationSettingsRoutes.get('/:id/notification-settings', async (c) => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Get or create notification settings
  let { data: settings, error } = await supabaseAdmin
    .from('organization_notification_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .single()

  if (error && error.code === 'PGRST116') {
    // Not found - create default settings
    const { data: newSettings, error: createError } = await supabaseAdmin
      .from('organization_notification_settings')
      .insert({ organization_id: organizationId })
      .select()
      .single()

    if (createError) {
      return c.json({ error: createError.message }, 500)
    }
    settings = newSettings
  } else if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Build response in camelCase for frontend
  let twilioAccountSidMasked: string | undefined
  let resendApiKeyMasked: string | undefined

  // Try to show masked actual values
  if (isEncryptionConfigured()) {
    try {
      if (settings.twilio_account_sid_encrypted) {
        const decrypted = decrypt(settings.twilio_account_sid_encrypted)
        twilioAccountSidMasked = maskString(decrypted)
      }
    } catch {
      // Ignore decryption errors
    }

    try {
      if (settings.resend_api_key_encrypted) {
        const decrypted = decrypt(settings.resend_api_key_encrypted)
        resendApiKeyMasked = maskString(decrypted)
      }
    } catch {
      // Ignore decryption errors
    }
  }

  // Return camelCase response matching frontend interface
  return c.json({
    id: settings.id,
    usePlatformSms: settings.use_platform_sms,
    usePlatformEmail: settings.use_platform_email,
    smsEnabled: settings.sms_enabled,
    emailEnabled: settings.email_enabled,
    twilioPhoneNumber: settings.twilio_phone_number,
    resendFromEmail: settings.resend_from_email,
    resendFromName: settings.resend_from_name,
    defaultLinkExpiryHours: settings.default_link_expiry_hours,
    defaultReminderEnabled: settings.default_reminder_enabled,
    defaultReminderIntervals: settings.default_reminder_intervals,
    hasTwilioCredentials: !!(settings.twilio_account_sid_encrypted && settings.twilio_auth_token_encrypted),
    hasResendCredentials: !!settings.resend_api_key_encrypted,
    twilioAccountSidMasked,
    resendApiKeyMasked
  })
})

/**
 * PATCH /api/v1/organizations/:id/notification-settings
 * Update organization notification settings (Org Admin only)
 */
orgNotificationSettingsRoutes.patch('/:id/notification-settings', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Get existing settings
  let { data: settings, error: fetchError } = await supabaseAdmin
    .from('organization_notification_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .single()

  if (fetchError && fetchError.code === 'PGRST116') {
    // Not found - create default settings first
    const { data: newSettings, error: createError } = await supabaseAdmin
      .from('organization_notification_settings')
      .insert({ organization_id: organizationId })
      .select()
      .single()

    if (createError) {
      return c.json({ error: createError.message }, 500)
    }
    settings = newSettings
  } else if (fetchError) {
    return c.json({ error: fetchError.message }, 500)
  }

  // Build update object
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  // Update platform preference flags
  if (body.use_platform_sms !== undefined) {
    updateData.use_platform_sms = body.use_platform_sms
  }
  if (body.use_platform_email !== undefined) {
    updateData.use_platform_email = body.use_platform_email
  }

  // Check if encryption is configured when trying to save credentials
  const hasCredentialUpdates = body.twilio_account_sid || body.twilio_auth_token || body.resend_api_key
  if (hasCredentialUpdates && !isEncryptionConfigured()) {
    return c.json({
      error: 'Cannot save credentials: ENCRYPTION_KEY environment variable is not configured on the server'
    }, 500)
  }

  // Update SMS settings
  if (body.sms_enabled !== undefined) {
    updateData.sms_enabled = body.sms_enabled
  }
  if (body.twilio_account_sid !== undefined) {
    if (body.twilio_account_sid) {
      updateData.twilio_account_sid_encrypted = encrypt(body.twilio_account_sid)
    } else {
      updateData.twilio_account_sid_encrypted = null
    }
  }
  if (body.twilio_auth_token !== undefined) {
    if (body.twilio_auth_token) {
      updateData.twilio_auth_token_encrypted = encrypt(body.twilio_auth_token)
    } else {
      updateData.twilio_auth_token_encrypted = null
    }
  }
  if (body.twilio_phone_number !== undefined) {
    updateData.twilio_phone_number = body.twilio_phone_number || null
  }

  // Update Email settings
  if (body.email_enabled !== undefined) {
    updateData.email_enabled = body.email_enabled
  }
  if (body.resend_api_key !== undefined) {
    if (body.resend_api_key) {
      updateData.resend_api_key_encrypted = encrypt(body.resend_api_key)
    } else {
      updateData.resend_api_key_encrypted = null
    }
  }
  if (body.resend_from_email !== undefined) {
    updateData.resend_from_email = body.resend_from_email || null
  }
  if (body.resend_from_name !== undefined) {
    updateData.resend_from_name = body.resend_from_name || null
  }

  // Update default settings
  if (body.default_link_expiry_hours !== undefined) {
    updateData.default_link_expiry_hours = body.default_link_expiry_hours
  }
  if (body.default_reminder_enabled !== undefined) {
    updateData.default_reminder_enabled = body.default_reminder_enabled
  }
  if (body.default_reminder_intervals !== undefined) {
    updateData.default_reminder_intervals = body.default_reminder_intervals
  }

  const { data: updatedSettings, error: updateError } = await supabaseAdmin
    .from('organization_notification_settings')
    .update(updateData)
    .eq('id', settings.id)
    .select()
    .single()

  if (updateError) {
    return c.json({ error: updateError.message }, 500)
  }

  // Build response in camelCase for frontend
  let twilioAccountSidMasked: string | undefined
  let resendApiKeyMasked: string | undefined

  if (isEncryptionConfigured()) {
    try {
      if (updatedSettings.twilio_account_sid_encrypted) {
        const decrypted = decrypt(updatedSettings.twilio_account_sid_encrypted)
        twilioAccountSidMasked = maskString(decrypted)
      }
    } catch {
      // Ignore decryption errors
    }

    try {
      if (updatedSettings.resend_api_key_encrypted) {
        const decrypted = decrypt(updatedSettings.resend_api_key_encrypted)
        resendApiKeyMasked = maskString(decrypted)
      }
    } catch {
      // Ignore decryption errors
    }
  }

  // Return camelCase response matching frontend interface
  return c.json({
    id: updatedSettings.id,
    usePlatformSms: updatedSettings.use_platform_sms,
    usePlatformEmail: updatedSettings.use_platform_email,
    smsEnabled: updatedSettings.sms_enabled,
    emailEnabled: updatedSettings.email_enabled,
    twilioPhoneNumber: updatedSettings.twilio_phone_number,
    resendFromEmail: updatedSettings.resend_from_email,
    resendFromName: updatedSettings.resend_from_name,
    defaultLinkExpiryHours: updatedSettings.default_link_expiry_hours,
    defaultReminderEnabled: updatedSettings.default_reminder_enabled,
    defaultReminderIntervals: updatedSettings.default_reminder_intervals,
    hasTwilioCredentials: !!(updatedSettings.twilio_account_sid_encrypted && updatedSettings.twilio_auth_token_encrypted),
    hasResendCredentials: !!updatedSettings.resend_api_key_encrypted,
    twilioAccountSidMasked,
    resendApiKeyMasked
  })
})

/**
 * POST /api/v1/organizations/:id/notification-settings/test-sms
 * Test SMS with org or platform credentials
 */
orgNotificationSettingsRoutes.post('/:id/notification-settings/test-sms', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  if (!body.to) {
    return c.json({ error: 'Phone number (to) is required' }, 400)
  }

  // Get SMS credentials (will resolve org or platform)
  const credResult = await getSmsCredentials(organizationId)

  if (!credResult.configured || !credResult.credentials) {
    return c.json({
      success: false,
      error: credResult.error || 'SMS not configured',
      source: credResult.source
    })
  }

  const result = await testSmsWithCredentials(credResult.credentials, body.to)

  return c.json({
    ...result,
    source: credResult.source
  })
})

/**
 * POST /api/v1/organizations/:id/notification-settings/test-email
 * Test email with org or platform credentials
 */
orgNotificationSettingsRoutes.post('/:id/notification-settings/test-email', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  if (!body.to) {
    return c.json({ error: 'Email address (to) is required' }, 400)
  }

  // Get email credentials (will resolve org or platform)
  const credResult = await getEmailCredentials(organizationId)

  if (!credResult.configured || !credResult.credentials) {
    return c.json({
      success: false,
      error: credResult.error || 'Email not configured',
      source: credResult.source
    })
  }

  const result = await testEmailWithCredentials(credResult.credentials, body.to)

  return c.json({
    ...result,
    source: credResult.source
  })
})

/**
 * DELETE /api/v1/organizations/:id/notification-settings/sms-credentials
 * Remove custom SMS credentials (revert to platform)
 */
orgNotificationSettingsRoutes.delete('/:id/notification-settings/sms-credentials', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const { error } = await supabaseAdmin
    .from('organization_notification_settings')
    .update({
      twilio_account_sid_encrypted: null,
      twilio_auth_token_encrypted: null,
      twilio_phone_number: null,
      use_platform_sms: true,
      updated_at: new Date().toISOString()
    })
    .eq('organization_id', organizationId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ success: true })
})

/**
 * DELETE /api/v1/organizations/:id/notification-settings/email-credentials
 * Remove custom email credentials (revert to platform)
 */
orgNotificationSettingsRoutes.delete('/:id/notification-settings/email-credentials', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const { error } = await supabaseAdmin
    .from('organization_notification_settings')
    .update({
      resend_api_key_encrypted: null,
      resend_from_email: null,
      resend_from_name: null,
      use_platform_email: true,
      updated_at: new Date().toISOString()
    })
    .eq('organization_id', organizationId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ success: true })
})

export default orgNotificationSettingsRoutes
