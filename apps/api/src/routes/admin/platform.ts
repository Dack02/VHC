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
import { testMotConnection, isMotManagedByEnv } from '../../services/mot-history.js'
import {
  getPlatformSmsCredentials,
  getPlatformEmailCredentials,
  isPlatformSmsManagedByEnv,
  isPlatformEmailManagedByEnv
} from '../../services/credentials.js'

const platformRoutes = new Hono()

// All routes require super admin authentication
platformRoutes.use('*', superAdminMiddleware)

/**
 * GET /api/v1/admin/platform/settings
 * Get all platform settings combined (for admin UI)
 */
platformRoutes.get('/settings', async (c) => {
  try {
    const motManagedByEnv = isMotManagedByEnv()
    const smsManagedByEnv = isPlatformSmsManagedByEnv()
    const emailManagedByEnv = isPlatformEmailManagedByEnv()
    // Fetch all platform settings
    const { data: allSettings, error } = await supabaseAdmin
      .from('platform_settings')
      .select('*')

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // AI chargeout margin lives in platform_ai_settings (key-value store)
    const { data: aiMarginRow } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value')
      .eq('key', 'ai_margin_percent')
      .maybeSingle()

    // Build combined settings object
    const combined: Record<string, unknown> = {
      general: {
        platformName: 'VHC Platform',
        supportEmail: '',
        termsUrl: '',
        privacyUrl: ''
      },
      defaults: {
        defaultPlanId: '',
        trialDays: 14,
        requireEmailVerification: true
      },
      features: {
        allowSelfSignup: true,
        enableDmsIntegration: true,
        enableNotifications: true
      },
      credentials: {
        resendApiKey: '',
        resendFromEmail: '',
        resendFromName: '',
        twilioAccountSid: '',
        twilioAuthToken: '',
        twilioFromNumber: '',
        smsManagedByEnv,
        emailManagedByEnv
      },
      vehicleLookup: {
        enabled: motManagedByEnv,
        managedByEnv: motManagedByEnv,
        motClientId: '',
        motTenantId: '',
        motClientSecret: '',
        motApiKey: ''
      },
      billing: {
        smsUnitCost: 0.04,
        emailUnitCost: 0,
        aiMarginPercent: aiMarginRow?.value ? parseFloat(aiMarginRow.value) : 0,
        currency: 'GBP'
      }
    }

    // Merge in stored settings
    for (const row of allSettings || []) {
      const settings = row.settings as Record<string, unknown>

      if (row.id === 'general') {
        combined.general = { ...combined.general as Record<string, unknown>, ...settings }
      } else if (row.id === 'defaults') {
        combined.defaults = { ...combined.defaults as Record<string, unknown>, ...settings }
      } else if (row.id === 'features') {
        combined.features = { ...combined.features as Record<string, unknown>, ...settings }
      } else if (row.id === 'notifications') {
        // Map notification settings to credentials. When env vars supply the
        // platform creds for a channel they win — don't surface the DB row.
        const creds = combined.credentials as Record<string, unknown>
        if (!smsManagedByEnv) {
          if (settings.twilio_account_sid) creds.twilioAccountSid = settings.twilio_account_sid
          if (settings.twilio_phone_number) creds.twilioFromNumber = settings.twilio_phone_number
          if (settings.twilio_auth_token_encrypted) {
            try {
              creds.twilioAuthToken = maskString(decrypt(settings.twilio_auth_token_encrypted as string))
            } catch {
              creds.twilioAuthToken = '••••••••'
            }
          }
        }
        if (!emailManagedByEnv) {
          if (settings.resend_from_email) creds.resendFromEmail = settings.resend_from_email
          if (settings.resend_from_name) creds.resendFromName = settings.resend_from_name
          if (settings.resend_api_key_encrypted) {
            try {
              creds.resendApiKey = maskString(decrypt(settings.resend_api_key_encrypted as string))
            } catch {
              creds.resendApiKey = '••••••••'
            }
          }
        }
      } else if (row.id === 'billing') {
        const b = combined.billing as Record<string, unknown>
        if (settings.sms_unit_cost != null) b.smsUnitCost = Number(settings.sms_unit_cost)
        if (settings.email_unit_cost != null) b.emailUnitCost = Number(settings.email_unit_cost)
        if (settings.currency) b.currency = settings.currency
      } else if (row.id === 'vehicle_lookup') {
        // When env vars supply the creds they win — don't surface the DB row.
        if (!motManagedByEnv) {
          const vl = combined.vehicleLookup as Record<string, unknown>
          vl.enabled = settings.enabled === true
          if (settings.mot_client_id) vl.motClientId = settings.mot_client_id
          if (settings.mot_tenant_id) vl.motTenantId = settings.mot_tenant_id
          // Mask encrypted secrets for display
          if (settings.mot_client_secret_encrypted) {
            try {
              vl.motClientSecret = maskString(decrypt(settings.mot_client_secret_encrypted as string))
            } catch {
              vl.motClientSecret = '••••••••'
            }
          }
          if (settings.mot_api_key_encrypted) {
            try {
              vl.motApiKey = maskString(decrypt(settings.mot_api_key_encrypted as string))
            } catch {
              vl.motApiKey = '••••••••'
            }
          }
        }
      }
    }

    return c.json(combined)
  } catch (err) {
    return c.json({ error: 'Failed to fetch platform settings' }, 500)
  }
})

/**
 * PATCH /api/v1/admin/platform/settings
 * Update all platform settings (for admin UI)
 */
platformRoutes.patch('/settings', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()

  try {
    // Update general settings
    if (body.general) {
      await supabaseAdmin
        .from('platform_settings')
        .upsert({
          id: 'general',
          settings: body.general,
          updated_at: new Date().toISOString(),
          updated_by: superAdmin.id
        })
    }

    // Update defaults
    if (body.defaults) {
      await supabaseAdmin
        .from('platform_settings')
        .upsert({
          id: 'defaults',
          settings: body.defaults,
          updated_at: new Date().toISOString(),
          updated_by: superAdmin.id
        })
    }

    // Update features
    if (body.features) {
      await supabaseAdmin
        .from('platform_settings')
        .upsert({
          id: 'features',
          settings: body.features,
          updated_at: new Date().toISOString(),
          updated_by: superAdmin.id
        })
    }

    // Update billing (SMS/email unit cost in platform_settings; AI margin in
    // platform_ai_settings where getAiMarginPercent reads it). Snake_case keys
    // so getSmsUnitRate (settings.sms_unit_cost) resolves correctly.
    if (body.billing) {
      await supabaseAdmin
        .from('platform_settings')
        .upsert({
          id: 'billing',
          settings: {
            sms_unit_cost: Number(body.billing.smsUnitCost ?? 0.04),
            email_unit_cost: Number(body.billing.emailUnitCost ?? 0),
            currency: body.billing.currency || 'GBP'
          },
          updated_at: new Date().toISOString(),
          updated_by: superAdmin.id
        })
      if (body.billing.aiMarginPercent !== undefined && body.billing.aiMarginPercent !== null) {
        await supabaseAdmin
          .from('platform_ai_settings')
          .upsert({
            key: 'ai_margin_percent',
            value: String(body.billing.aiMarginPercent),
            updated_at: new Date().toISOString(),
            updated_by: superAdmin.id
          })
      }
    }

    // Update credentials (notifications)
    if (body.credentials) {
      const { data: existingNotifications } = await supabaseAdmin
        .from('platform_settings')
        .select('settings')
        .eq('id', 'notifications')
        .single()

      const notificationSettings: Record<string, unknown> =
        (existingNotifications?.settings as Record<string, unknown>) || {}

      // Map credentials to notification settings
      if (body.credentials.twilioAccountSid) {
        notificationSettings.twilio_account_sid = body.credentials.twilioAccountSid
      }
      if (body.credentials.twilioAuthToken && !body.credentials.twilioAuthToken.includes('•')) {
        // Only update if not masked
        if (isEncryptionConfigured()) {
          notificationSettings.twilio_auth_token_encrypted = encrypt(body.credentials.twilioAuthToken)
        }
      }
      if (body.credentials.twilioFromNumber) {
        notificationSettings.twilio_phone_number = body.credentials.twilioFromNumber
      }
      if (body.credentials.resendApiKey && !body.credentials.resendApiKey.includes('•')) {
        // Only update if not masked
        if (isEncryptionConfigured()) {
          notificationSettings.resend_api_key_encrypted = encrypt(body.credentials.resendApiKey)
        }
      }
      if (body.credentials.resendFromEmail) {
        notificationSettings.resend_from_email = body.credentials.resendFromEmail
      }
      if (body.credentials.resendFromName) {
        notificationSettings.resend_from_name = body.credentials.resendFromName
      }

      // Auto-enable SMS if all Twilio credentials are provided
      if (
        notificationSettings.twilio_account_sid &&
        notificationSettings.twilio_auth_token_encrypted &&
        notificationSettings.twilio_phone_number
      ) {
        notificationSettings.sms_enabled = true
      }

      // Auto-enable Email if all Resend credentials are provided
      if (
        notificationSettings.resend_api_key_encrypted &&
        notificationSettings.resend_from_email
      ) {
        notificationSettings.email_enabled = true
      }

      await supabaseAdmin
        .from('platform_settings')
        .upsert({
          id: 'notifications',
          settings: notificationSettings,
          updated_at: new Date().toISOString(),
          updated_by: superAdmin.id
        })
    }

    // Update vehicle lookup (DVSA MOT History) credentials
    if (body.vehicleLookup) {
      const { data: existingVl } = await supabaseAdmin
        .from('platform_settings')
        .select('settings')
        .eq('id', 'vehicle_lookup')
        .single()

      const vlSettings: Record<string, unknown> =
        (existingVl?.settings as Record<string, unknown>) || { provider: 'dvsa_mot_history' }

      const vl = body.vehicleLookup
      if (vl.enabled !== undefined) vlSettings.enabled = !!vl.enabled
      if (vl.motClientId !== undefined) vlSettings.mot_client_id = vl.motClientId
      if (vl.motTenantId !== undefined) vlSettings.mot_tenant_id = vl.motTenantId
      // Only update secrets when a new (non-masked) value is provided
      if (vl.motClientSecret && !String(vl.motClientSecret).includes('•') && isEncryptionConfigured()) {
        vlSettings.mot_client_secret_encrypted = encrypt(vl.motClientSecret)
      }
      if (vl.motApiKey && !String(vl.motApiKey).includes('•') && isEncryptionConfigured()) {
        vlSettings.mot_api_key_encrypted = encrypt(vl.motApiKey)
      }

      await supabaseAdmin
        .from('platform_settings')
        .upsert({
          id: 'vehicle_lookup',
          settings: vlSettings,
          updated_at: new Date().toISOString(),
          updated_by: superAdmin.id
        })
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'update_platform_settings',
      'platform_settings',
      'all',
      { sections: Object.keys(body) },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({ success: true })
  } catch (err) {
    return c.json({ error: 'Failed to save platform settings' }, 500)
  }
})

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

  // Resolve platform SMS credentials (env vars first, then encrypted DB row)
  const credResult = await getPlatformSmsCredentials()
  if (!credResult.configured || !credResult.credentials) {
    return c.json({ error: credResult.error || 'Platform SMS credentials not configured' }, 400)
  }

  try {
    const result = await testSmsWithCredentials(credResult.credentials, body.to)

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

  // Resolve platform email credentials (env vars first, then encrypted DB row)
  const credResult = await getPlatformEmailCredentials()
  if (!credResult.configured || !credResult.credentials) {
    return c.json({ error: credResult.error || 'Platform email credentials not configured' }, 400)
  }

  try {
    const result = await testEmailWithCredentials(credResult.credentials, body.to)

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

/**
 * POST /api/v1/admin/platform/vehicle-lookup/test
 * Test the DVSA MOT History credentials (token + optional sample registration)
 */
platformRoutes.post('/vehicle-lookup/test', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))
  const sampleReg = typeof body.registration === 'string' ? body.registration : undefined

  try {
    const result = await testMotConnection(sampleReg)

    await logSuperAdminActivity(
      superAdmin.id,
      'test_vehicle_lookup',
      'platform_settings',
      'vehicle_lookup',
      { success: result.success, sampleReg: sampleReg || null },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json(result)
  } catch (error) {
    return c.json({
      success: false,
      message: error instanceof Error ? error.message : 'Vehicle lookup test failed'
    })
  }
})

export default platformRoutes
