/**
 * Super Admin AI Settings API Routes
 * Platform-wide AI configuration management
 */

import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'
import { encrypt, decrypt, isEncryptionConfigured } from '../../lib/encryption.js'
import { logger } from '../../lib/logger.js'
import { clearSettingsCache } from '../../services/ai-reasons.js'

const aiSettings = new Hono()

// All routes require super admin authentication
aiSettings.use('*', superAdminMiddleware)

// Valid models
const VALID_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001'
]

/**
 * GET /api/v1/admin/ai-settings
 * Get all platform AI settings (API key is masked)
 */
aiSettings.get('/', async (c) => {
  const superAdmin = c.get('superAdmin')

  try {
    // Get all AI settings
    const { data: settings, error } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('key, value, is_encrypted')

    if (error) {
      logger.error('Failed to fetch AI settings', { error: error.message })
      return c.json({ error: 'Failed to fetch AI settings' }, 500)
    }

    // Build response object
    const settingsMap: Record<string, { value: string | null; isEncrypted: boolean }> = {}
    for (const setting of settings || []) {
      settingsMap[setting.key] = {
        value: setting.value,
        isEncrypted: setting.is_encrypted
      }
    }

    // Get API key info (masked)
    let apiKeyConfigured = false
    let apiKeyLast4: string | null = null

    const apiKeySetting = settingsMap['anthropic_api_key']
    if (apiKeySetting?.value) {
      apiKeyConfigured = true
      try {
        // Decrypt to get last 4 chars
        const decryptedKey = apiKeySetting.isEncrypted
          ? decrypt(apiKeySetting.value)
          : apiKeySetting.value
        apiKeyLast4 = decryptedKey.slice(-4)
      } catch (err) {
        logger.warn('Failed to decrypt API key for masking', { error: err })
        apiKeyLast4 = null
      }
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'view_ai_settings',
      'platform_ai_settings',
      undefined,
      {},
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      isConnected: apiKeyConfigured,
      apiKeyMasked: apiKeyLast4 ? `sk-****${apiKeyLast4}` : null,
      aiEnabled: settingsMap['ai_enabled']?.value === 'true',
      defaultMonthlyLimit: parseInt(settingsMap['default_monthly_ai_limit']?.value || '100'),
      costAlertThreshold: parseFloat(settingsMap['ai_cost_alert_threshold_usd']?.value || '50'),
      model: settingsMap['ai_model']?.value || 'claude-sonnet-4-20250514',
      encryptionConfigured: isEncryptionConfigured()
    })
  } catch (error) {
    logger.error('Error fetching AI settings', { error })
    return c.json({ error: 'Failed to fetch AI settings' }, 500)
  }
})

/**
 * PATCH /api/v1/admin/ai-settings
 * Update platform AI settings
 */
aiSettings.patch('/', async (c) => {
  const superAdmin = c.get('superAdmin')

  try {
    const body = await c.req.json()
    const {
      anthropic_api_key,
      ai_enabled,
      default_monthly_ai_limit,
      ai_cost_alert_threshold_usd,
      ai_model
    } = body

    const updated: string[] = []
    const now = new Date().toISOString()

    // Update API key (encrypt it)
    if (anthropic_api_key !== undefined) {
      if (!anthropic_api_key) {
        // Clear API key
        const { error } = await supabaseAdmin
          .from('platform_ai_settings')
          .update({
            value: null,
            updated_at: now,
            updated_by: superAdmin.id
          })
          .eq('key', 'anthropic_api_key')

        if (error) throw new Error(`Failed to clear API key: ${error.message}`)
        updated.push('anthropic_api_key')
      } else {
        // Validate API key format (Anthropic keys start with sk-ant- or sk-)
        if (!anthropic_api_key.startsWith('sk-')) {
          return c.json({ error: 'Invalid API key format. Anthropic API keys start with sk-' }, 400)
        }

        // Encrypt and store
        if (!isEncryptionConfigured()) {
          return c.json({ error: 'Encryption not configured. Please set ENCRYPTION_KEY environment variable.' }, 500)
        }

        const encryptedKey = encrypt(anthropic_api_key)

        const { error } = await supabaseAdmin
          .from('platform_ai_settings')
          .update({
            value: encryptedKey,
            is_encrypted: true,
            updated_at: now,
            updated_by: superAdmin.id
          })
          .eq('key', 'anthropic_api_key')

        if (error) throw new Error(`Failed to update API key: ${error.message}`)
        updated.push('anthropic_api_key')
      }
    }

    // Update AI enabled toggle
    if (ai_enabled !== undefined) {
      const { error } = await supabaseAdmin
        .from('platform_ai_settings')
        .update({
          value: String(ai_enabled),
          updated_at: now,
          updated_by: superAdmin.id
        })
        .eq('key', 'ai_enabled')

      if (error) throw new Error(`Failed to update ai_enabled: ${error.message}`)
      updated.push('ai_enabled')
    }

    // Update default monthly limit
    if (default_monthly_ai_limit !== undefined) {
      const limit = parseInt(default_monthly_ai_limit)
      if (isNaN(limit) || limit < 0) {
        return c.json({ error: 'default_monthly_ai_limit must be a non-negative integer' }, 400)
      }

      const { error } = await supabaseAdmin
        .from('platform_ai_settings')
        .update({
          value: String(limit),
          updated_at: now,
          updated_by: superAdmin.id
        })
        .eq('key', 'default_monthly_ai_limit')

      if (error) throw new Error(`Failed to update default_monthly_ai_limit: ${error.message}`)
      updated.push('default_monthly_ai_limit')
    }

    // Update cost alert threshold
    if (ai_cost_alert_threshold_usd !== undefined) {
      const threshold = parseFloat(ai_cost_alert_threshold_usd)
      if (isNaN(threshold) || threshold < 0) {
        return c.json({ error: 'ai_cost_alert_threshold_usd must be a non-negative number' }, 400)
      }

      const { error } = await supabaseAdmin
        .from('platform_ai_settings')
        .update({
          value: String(threshold),
          updated_at: now,
          updated_by: superAdmin.id
        })
        .eq('key', 'ai_cost_alert_threshold_usd')

      if (error) throw new Error(`Failed to update ai_cost_alert_threshold_usd: ${error.message}`)
      updated.push('ai_cost_alert_threshold_usd')
    }

    // Update AI model
    if (ai_model !== undefined) {
      if (!VALID_MODELS.includes(ai_model)) {
        return c.json({
          error: `Invalid AI model. Valid options: ${VALID_MODELS.join(', ')}`
        }, 400)
      }

      const { error } = await supabaseAdmin
        .from('platform_ai_settings')
        .update({
          value: ai_model,
          updated_at: now,
          updated_by: superAdmin.id
        })
        .eq('key', 'ai_model')

      if (error) throw new Error(`Failed to update ai_model: ${error.message}`)
      updated.push('ai_model')
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'update_ai_settings',
      'platform_ai_settings',
      undefined,
      { updated },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    // Clear settings cache so changes take effect immediately
    clearSettingsCache()

    return c.json({
      success: true,
      updated
    })
  } catch (error) {
    logger.error('Error updating AI settings', { error })
    const message = error instanceof Error ? error.message : 'Failed to update AI settings'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/v1/admin/ai-settings/test
 * Test the API key connection
 */
aiSettings.post('/test', async (c) => {
  const superAdmin = c.get('superAdmin')

  try {
    // Get API key from database
    const { data: apiKeySetting, error: fetchError } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value, is_encrypted')
      .eq('key', 'anthropic_api_key')
      .single()

    if (fetchError || !apiKeySetting?.value) {
      return c.json({
        success: false,
        error: 'API key not configured. Please add an API key first.'
      })
    }

    // Decrypt if needed
    let apiKey: string
    try {
      apiKey = apiKeySetting.is_encrypted
        ? decrypt(apiKeySetting.value)
        : apiKeySetting.value
    } catch (err) {
      logger.error('Failed to decrypt API key for test', { error: err })
      return c.json({
        success: false,
        error: 'Failed to decrypt API key. Encryption configuration may have changed.'
      })
    }

    // Get current model setting
    const { data: modelSetting } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value')
      .eq('key', 'ai_model')
      .single()

    const model = modelSetting?.value || 'claude-sonnet-4-20250514'

    // Test the connection with a simple request
    const anthropic = new Anthropic({ apiKey })

    const startTime = Date.now()
    const response = await anthropic.messages.create({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }]
    })
    const duration = Date.now() - startTime

    // Check response
    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Unexpected response type')
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'test_ai_connection',
      'platform_ai_settings',
      undefined,
      { success: true, model, duration },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      success: true,
      model,
      responseTime: duration,
      message: 'API connection successful'
    })
  } catch (error) {
    logger.error('AI connection test failed', { error })

    let errorMessage = 'Connection test failed'
    let errorCode: string | undefined

    if (error instanceof Anthropic.APIError) {
      errorCode = error.status?.toString()

      switch (error.status) {
        case 401:
          errorMessage = 'Invalid API key. Please check your Anthropic API key.'
          break
        case 403:
          errorMessage = 'API key does not have permission. Check your Anthropic account.'
          break
        case 429:
          errorMessage = 'Rate limit exceeded. Please try again later.'
          break
        case 500:
        case 502:
        case 503:
          errorMessage = 'Anthropic API is temporarily unavailable. Please try again later.'
          break
        default:
          errorMessage = error.message || 'API request failed'
      }
    } else if (error instanceof Error) {
      if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Network error. Could not connect to Anthropic API.'
      } else {
        errorMessage = error.message
      }
    }

    // Log failed test
    await logSuperAdminActivity(
      c.get('superAdmin').id,
      'test_ai_connection',
      'platform_ai_settings',
      undefined,
      { success: false, error: errorMessage, errorCode },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      success: false,
      error: errorMessage,
      errorCode
    })
  }
})

/**
 * GET /api/v1/admin/ai-settings/models
 * Get available AI models
 */
aiSettings.get('/models', async (c) => {
  try {
    const { data: pricing, error } = await supabaseAdmin
      .from('ai_model_pricing')
      .select('model, input_cost_per_1m_tokens, output_cost_per_1m_tokens, notes')
      .is('effective_to', null)
      .order('model')

    if (error) {
      return c.json({ error: 'Failed to fetch models' }, 500)
    }

    return c.json({
      models: pricing?.map(p => ({
        id: p.model,
        name: p.notes || p.model,
        inputCostPer1M: parseFloat(String(p.input_cost_per_1m_tokens)),
        outputCostPer1M: parseFloat(String(p.output_cost_per_1m_tokens))
      })) || []
    })
  } catch (error) {
    logger.error('Error fetching AI models', { error })
    return c.json({ error: 'Failed to fetch models' }, 500)
  }
})

export default aiSettings
