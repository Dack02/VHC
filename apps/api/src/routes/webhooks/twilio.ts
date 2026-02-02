/**
 * Twilio Inbound SMS Webhook
 * Receives incoming SMS messages from Twilio and processes them
 */

import { Hono } from 'hono'
import twilio from 'twilio'
import { supabaseAdmin } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import { processInboundSms } from '../../services/inbound-sms.js'

const twilioWebhookRoutes = new Hono()

/**
 * Resolve the Twilio auth token for a given TO phone number
 * Checks org-level credentials first, then platform-level
 */
async function resolveAuthToken(toNumber: string): Promise<{ authToken: string; organizationId?: string } | null> {
  // 1. Check organization_notification_settings for matching phone number
  const { data: orgSettings } = await supabaseAdmin
    .from('organization_notification_settings')
    .select('organization_id, twilio_auth_token_encrypted, twilio_phone_number')
    .eq('twilio_phone_number', toNumber)
    .limit(1)
    .maybeSingle()

  if (orgSettings?.twilio_auth_token_encrypted) {
    try {
      const { decrypt } = await import('../../lib/encryption.js')
      const authToken = decrypt(orgSettings.twilio_auth_token_encrypted)
      return { authToken, organizationId: orgSettings.organization_id }
    } catch {
      logger.error('Failed to decrypt org Twilio auth token for webhook validation')
    }
  }

  // 2. Fall back to platform settings
  const { data: platformSettings } = await supabaseAdmin
    .from('platform_settings')
    .select('settings')
    .eq('id', 'notifications')
    .single()

  if (platformSettings?.settings) {
    const settings = platformSettings.settings as Record<string, unknown>
    if (settings.twilio_auth_token_encrypted) {
      try {
        const { decrypt } = await import('../../lib/encryption.js')
        const authToken = decrypt(settings.twilio_auth_token_encrypted as string)
        return { authToken }
      } catch {
        logger.error('Failed to decrypt platform Twilio auth token for webhook validation')
      }
    }
  }

  return null
}

/**
 * POST /api/webhooks/twilio/sms
 * Twilio sends inbound SMS messages here
 * Unauthenticated — validated via X-Twilio-Signature
 */
twilioWebhookRoutes.post('/sms', async (c) => {
  try {
    // Parse form body (Twilio sends application/x-www-form-urlencoded)
    const body = await c.req.parseBody()

    const from = body.From as string
    const to = body.To as string
    const messageBody = body.Body as string
    const messageSid = body.MessageSid as string

    if (!from || !to || !messageSid) {
      logger.warn('Twilio webhook: Missing required fields', { from, to, messageSid })
      // Return TwiML anyway — Twilio expects XML response
      return c.text('<Response></Response>', 200, { 'Content-Type': 'text/xml' })
    }

    // Resolve auth token for the TO number to validate signature
    const credentials = await resolveAuthToken(to)

    if (credentials?.authToken) {
      const twilioSignature = c.req.header('X-Twilio-Signature')

      if (twilioSignature) {
        // Build the full webhook URL
        // Use X-Forwarded-Proto and X-Forwarded-Host if behind a proxy
        const proto = c.req.header('x-forwarded-proto') || 'https'
        const host = c.req.header('x-forwarded-host') || c.req.header('host') || ''
        const path = c.req.path
        const webhookUrl = `${proto}://${host}${path}`

        const isValid = twilio.validateRequest(
          credentials.authToken,
          twilioSignature,
          webhookUrl,
          body as Record<string, string>
        )

        if (!isValid) {
          logger.warn('Twilio webhook: Invalid signature', { from, to })
          return c.text('<Response></Response>', 403, { 'Content-Type': 'text/xml' })
        }
      }
    } else {
      logger.warn('Twilio webhook: Could not resolve auth token for TO number', { to })
      // Still process — don't reject messages if credentials aren't found
      // (could be a misconfiguration, better to receive than lose messages)
    }

    // Process the inbound SMS asynchronously (don't block Twilio's response)
    processInboundSms({
      from,
      to,
      body: messageBody || '',
      messageSid
    }).catch(err => {
      logger.error('Error processing inbound SMS', { error: String(err), messageSid })
    })

    // Return empty TwiML response (no auto-reply)
    return c.text('<Response></Response>', 200, { 'Content-Type': 'text/xml' })
  } catch (err) {
    logger.error('Twilio webhook error', { error: String(err) })
    return c.text('<Response></Response>', 500, { 'Content-Type': 'text/xml' })
  }
})

export default twilioWebhookRoutes
