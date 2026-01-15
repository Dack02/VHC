/**
 * Platform Settings API Routes (Super Admin only)
 * Manages platform-wide settings and notification credentials
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'
import { encrypt, decrypt, maskString, isEncryptionConfigured } from '../../lib/encryption.js'
import { testSmsWithCredentials } from '../../services/sms.js'
import { testEmailWithCredentials } from '../../services/email.js'

const platformRoutes = new Hono()

// All routes require super admin authentication
platformRoutes.use('*', superAdminMiddleware)

/**
 * GET /api/v1/admin/platform/settings/:id
 * Get platform settings by key
 */
platformRoutes.get('/settings/:id', async (c) => {
  const id = c.req.param('id')

  const { data: settings, error } = await supabaseAdmin
    .from('platform_settings')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !settings) {
    return c.json({ error: 'Settings not found' }, 404)
  }

  return c.json(settings)
})

/**
 * PATCH /api/v1/admin/platform/settings/:id
 * Update platform settings by key
 */
platformRoutes.patch('/settings/:id', async (c) => {
  const id = c.req.param('id')
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()

  const { data: existingSettings, error: fetchError } = await supabaseAdmin
    .from('platform_settings')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !existingSettings) {
    return c.json({ error: 'Settings not found' }, 404)
  }

  // Merge new settings with existing
  const updatedSettings = {
    ...(existingSettings.settings as Record<string, unknown>),
    ...body.settings
  }

  const { data: settings, error } = await supabaseAdmin
    .from('platform_settings')
    .update({
      settings: updatedSettings,
      updated_at: new Date().toISOString(),
      updated_by: superAdmin.id
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'update_platform_settings',
    'platform_settings',
    id,
    { setting_key: id },
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
    c.req.header('User-Agent')
  )

  return c.json(settings)
})

/**
 * GET /api/v1/admin/platform/notifications
 * Get platform notification settings (with masked credentials)
 */
platformRoutes.get('/notifications', async (c) => {
  const { data: settings, error } = await supabaseAdmin
    .from('platform_settings')
    .select('*')
    .eq('id', 'notifications')
    .single()

  if (error || !settings) {
    return c.json({ error: 'Notification settings not found' }, 404)
  }

  const notificationSettings = settings.settings as Record<string, unknown>

  // Mask sensitive credentials for display
  const maskedSettings = {
    ...notificationSettings,
    twilio_auth_token_encrypted: notificationSettings.twilio_auth_token_encrypted
      ? maskString(notificationSettings.twilio_auth_token_encrypted as string)
      : null,
    resend_api_key_encrypted: notificationSettings.resend_api_key_encrypted
      ? maskString(notificationSettings.resend_api_key_encrypted as string)
      : null,
    // Show masked actual values if they can be decrypted
    twilio_auth_token_masked: null as string | null,
    resend_api_key_masked: null as string | null
  }

  // Try to show masked actual values
  if (isEncryptionConfigured()) {
    try {
      if (notificationSettings.twilio_auth_token_encrypted) {
        const decrypted = decrypt(notificationSettings.twilio_auth_token_encrypted as string)
        maskedSettings.twilio_auth_token_masked = maskString(decrypted)
      }
    } catch {
      // Ignore decryption errors
    }

    try {
      if (notificationSettings.resend_api_key_encrypted) {
        const decrypted = decrypt(notificationSettings.resend_api_key_encrypted as string)
        maskedSettings.resend_api_key_masked = maskString(decrypted)
      }
    } catch {
      // Ignore decryption errors
    }
  }

  return c.json({
    id: settings.id,
    settings: maskedSettings,
    updated_at: settings.updated_at,
    encryption_configured: isEncryptionConfigured()
  })
})

/**
 * PATCH /api/v1/admin/platform/notifications
 * Update platform notification settings (encrypts credentials)
 */
platformRoutes.patch('/notifications', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()

  if (!isEncryptionConfigured()) {
    return c.json({ error: 'Encryption not configured. Set ENCRYPTION_KEY environment variable.' }, 500)
  }

  const { data: existingSettings, error: fetchError } = await supabaseAdmin
    .from('platform_settings')
    .select('*')
    .eq('id', 'notifications')
    .single()

  if (fetchError || !existingSettings) {
    return c.json({ error: 'Notification settings not found' }, 404)
  }

  const currentSettings = existingSettings.settings as Record<string, unknown>
  const updatedSettings: Record<string, unknown> = { ...currentSettings }

  // Update SMS settings
  if (body.sms_enabled !== undefined) {
    updatedSettings.sms_enabled = body.sms_enabled
  }
  if (body.twilio_account_sid !== undefined) {
    updatedSettings.twilio_account_sid = body.twilio_account_sid
  }
  if (body.twilio_auth_token) {
    // Encrypt the auth token
    updatedSettings.twilio_auth_token_encrypted = encrypt(body.twilio_auth_token)
  }
  if (body.twilio_phone_number !== undefined) {
    updatedSettings.twilio_phone_number = body.twilio_phone_number
  }

  // Update Email settings
  if (body.email_enabled !== undefined) {
    updatedSettings.email_enabled = body.email_enabled
  }
  if (body.resend_api_key) {
    // Encrypt the API key
    updatedSettings.resend_api_key_encrypted = encrypt(body.resend_api_key)
  }
  if (body.resend_from_email !== undefined) {
    updatedSettings.resend_from_email = body.resend_from_email
  }
  if (body.resend_from_name !== undefined) {
    updatedSettings.resend_from_name = body.resend_from_name
  }

  const { data: settings, error } = await supabaseAdmin
    .from('platform_settings')
    .update({
      settings: updatedSettings,
      updated_at: new Date().toISOString(),
      updated_by: superAdmin.id
    })
    .eq('id', 'notifications')
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'update_platform_notifications',
    'platform_settings',
    'notifications',
    {
      sms_enabled: updatedSettings.sms_enabled,
      email_enabled: updatedSettings.email_enabled,
      twilio_updated: !!body.twilio_auth_token,
      resend_updated: !!body.resend_api_key
    },
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
    c.req.header('User-Agent')
  )

  return c.json({ success: true, updated_at: settings.updated_at })
})

/**
 * POST /api/v1/admin/platform/notifications/test-sms
 * Test SMS with platform credentials
 */
platformRoutes.post('/notifications/test-sms', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()

  if (!body.to) {
    return c.json({ error: 'Phone number (to) is required' }, 400)
  }

  if (!isEncryptionConfigured()) {
    return c.json({ error: 'Encryption not configured' }, 500)
  }

  const { data: settings } = await supabaseAdmin
    .from('platform_settings')
    .select('settings')
    .eq('id', 'notifications')
    .single()

  if (!settings?.settings) {
    return c.json({ error: 'Platform notification settings not found' }, 404)
  }

  const notificationSettings = settings.settings as Record<string, unknown>

  if (!notificationSettings.twilio_account_sid || !notificationSettings.twilio_auth_token_encrypted || !notificationSettings.twilio_phone_number) {
    return c.json({ error: 'Platform SMS credentials not configured' }, 400)
  }

  try {
    const authToken = decrypt(notificationSettings.twilio_auth_token_encrypted as string)

    const result = await testSmsWithCredentials(
      {
        accountSid: notificationSettings.twilio_account_sid as string,
        authToken,
        phoneNumber: notificationSettings.twilio_phone_number as string
      },
      body.to
    )

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'test_platform_sms',
      'platform_settings',
      'notifications',
      { success: result.success, to: body.to },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json(result)
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test SMS'
    })
  }
})

/**
 * POST /api/v1/admin/platform/notifications/test-email
 * Test email with platform credentials
 */
platformRoutes.post('/notifications/test-email', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()

  if (!body.to) {
    return c.json({ error: 'Email address (to) is required' }, 400)
  }

  if (!isEncryptionConfigured()) {
    return c.json({ error: 'Encryption not configured' }, 500)
  }

  const { data: settings } = await supabaseAdmin
    .from('platform_settings')
    .select('settings')
    .eq('id', 'notifications')
    .single()

  if (!settings?.settings) {
    return c.json({ error: 'Platform notification settings not found' }, 404)
  }

  const notificationSettings = settings.settings as Record<string, unknown>

  if (!notificationSettings.resend_api_key_encrypted || !notificationSettings.resend_from_email) {
    return c.json({ error: 'Platform email credentials not configured' }, 400)
  }

  try {
    const apiKey = decrypt(notificationSettings.resend_api_key_encrypted as string)

    const result = await testEmailWithCredentials(
      {
        apiKey,
        fromEmail: notificationSettings.resend_from_email as string,
        fromName: (notificationSettings.resend_from_name as string) || 'VHC Platform'
      },
      body.to
    )

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'test_platform_email',
      'platform_settings',
      'notifications',
      { success: result.success, to: body.to },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json(result)
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test email'
    })
  }
})

export default platformRoutes
