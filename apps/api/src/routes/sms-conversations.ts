/**
 * SMS Conversations API routes
 * Staff endpoints for viewing SMS threads, sending replies, and marking messages read
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorizeMinRole } from '../middleware/auth.js'
import { sendSms } from '../services/sms.js'
import { emitToHealthCheck, emitToOrganization, WS_EVENTS } from '../services/websocket.js'
import { logger } from '../lib/logger.js'

const smsConversations = new Hono()

// Apply auth middleware to all routes
smsConversations.use('*', authMiddleware)

/**
 * GET /api/v1/health-checks/:id/sms-messages
 * Get SMS conversation thread for a health check
 */
smsConversations.get('/health-checks/:id/sms-messages', authorizeMinRole('service_advisor'), async (c) => {
  const auth = c.get('auth')
  const healthCheckId = c.req.param('id')

  // Verify health check belongs to the user's org
  const { data: hc, error: hcError } = await supabaseAdmin
    .from('health_checks')
    .select('id, organization_id')
    .eq('id', healthCheckId)
    .eq('organization_id', auth.orgId)
    .single()

  if (hcError || !hc) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  const { data: messages, error } = await supabaseAdmin
    .from('sms_messages')
    .select(`
      id,
      direction,
      from_number,
      to_number,
      body,
      twilio_sid,
      twilio_status,
      is_read,
      read_at,
      sent_by,
      created_at,
      sender:users!sms_messages_sent_by_fkey(id, first_name, last_name)
    `)
    .eq('health_check_id', healthCheckId)
    .order('created_at', { ascending: true })

  if (error) {
    logger.error('Error fetching SMS messages', { error: error.message, healthCheckId })
    return c.json({ error: 'Failed to fetch messages' }, 500)
  }

  return c.json({ messages: messages || [] })
})

/**
 * POST /api/v1/health-checks/:id/sms-reply
 * Send an SMS reply from staff
 */
smsConversations.post('/health-checks/:id/sms-reply', authorizeMinRole('service_advisor'), async (c) => {
  const auth = c.get('auth')
  const healthCheckId = c.req.param('id')
  const { message } = await c.req.json<{ message: string }>()

  if (!message?.trim()) {
    return c.json({ error: 'Message body is required' }, 400)
  }

  // Verify health check belongs to the user's org and get customer mobile
  const { data: hc, error: hcError } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      organization_id,
      site_id,
      vehicle:vehicles(
        customer:customers(id, mobile, first_name, last_name)
      )
    `)
    .eq('id', healthCheckId)
    .eq('organization_id', auth.orgId)
    .single()

  if (hcError || !hc) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  const customer = (hc.vehicle as any)?.customer
  if (!customer?.mobile) {
    return c.json({ error: 'Customer has no mobile number' }, 400)
  }

  // Send SMS via Twilio
  const smsResult = await sendSms(customer.mobile, message.trim(), auth.orgId)

  if (!smsResult.success) {
    logger.error('Failed to send SMS reply', { error: smsResult.error, healthCheckId })
    return c.json({ error: smsResult.error || 'Failed to send SMS' }, 500)
  }

  // Resolve the FROM number used (org or platform phone number)
  let fromNumber = ''
  const { getSmsCredentials } = await import('../services/credentials.js')
  const creds = await getSmsCredentials(auth.orgId)
  if (creds.credentials) {
    fromNumber = creds.credentials.phoneNumber
  }

  // Store in sms_messages
  const { data: storedMessage, error: insertError } = await supabaseAdmin
    .from('sms_messages')
    .insert({
      organization_id: auth.orgId,
      health_check_id: healthCheckId,
      customer_id: customer.id,
      direction: 'outbound',
      from_number: fromNumber,
      to_number: customer.mobile,
      body: message.trim(),
      twilio_sid: smsResult.messageId || null,
      twilio_status: 'sent',
      is_read: true,
      sent_by: auth.user.id,
      metadata: { source: smsResult.source }
    })
    .select()
    .single()

  if (insertError) {
    logger.error('Failed to store outbound SMS', { error: insertError.message })
    // SMS was already sent, don't return error — just log it
  }

  // Log in communication_logs for consistency with existing system
  await supabaseAdmin.from('communication_logs').insert({
    health_check_id: healthCheckId,
    channel: 'sms',
    recipient: customer.mobile,
    message_body: message.trim(),
    status: 'sent',
    external_id: smsResult.messageId
  })

  // Emit real-time event to HC room
  emitToHealthCheck(healthCheckId, WS_EVENTS.SMS_SENT, {
    message: {
      id: storedMessage?.id,
      direction: 'outbound',
      from_number: fromNumber,
      to_number: customer.mobile,
      body: message.trim(),
      twilio_sid: smsResult.messageId,
      twilio_status: 'sent',
      is_read: true,
      sent_by: auth.user.id,
      sender: {
        id: auth.user.id,
        first_name: auth.user.firstName,
        last_name: auth.user.lastName
      },
      created_at: storedMessage?.created_at || new Date().toISOString()
    }
  })

  // Emit to org room for Messages page
  emitToOrganization(auth.orgId, WS_EVENTS.SMS_SENT, {
    message: {
      id: storedMessage?.id,
      direction: 'outbound',
      from_number: fromNumber,
      to_number: customer.mobile,
      body: message.trim(),
      twilio_sid: smsResult.messageId,
      twilio_status: 'sent',
      is_read: true,
      sent_by: auth.user.id,
      sender: {
        id: auth.user.id,
        first_name: auth.user.firstName,
        last_name: auth.user.lastName
      },
      created_at: storedMessage?.created_at || new Date().toISOString()
    }
  })

  return c.json({
    success: true,
    message: storedMessage,
    messageId: smsResult.messageId
  })
})

/**
 * PUT /api/v1/health-checks/:id/sms-messages/mark-read
 * Mark all inbound messages as read for a health check
 */
smsConversations.put('/health-checks/:id/sms-messages/mark-read', authorizeMinRole('service_advisor'), async (c) => {
  const auth = c.get('auth')
  const healthCheckId = c.req.param('id')

  // Verify health check belongs to org
  const { data: hc } = await supabaseAdmin
    .from('health_checks')
    .select('id')
    .eq('id', healthCheckId)
    .eq('organization_id', auth.orgId)
    .single()

  if (!hc) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  const { error } = await supabaseAdmin
    .from('sms_messages')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
      read_by: auth.user.id
    })
    .eq('health_check_id', healthCheckId)
    .eq('direction', 'inbound')
    .eq('is_read', false)

  if (error) {
    logger.error('Error marking SMS messages read', { error: error.message })
    return c.json({ error: 'Failed to mark messages as read' }, 500)
  }

  return c.json({ success: true })
})

/**
 * GET /api/v1/sms-messages/unread-count
 * Get global unread SMS count for the current user's organization
 */
smsConversations.get('/sms-messages/unread-count', async (c) => {
  const auth = c.get('auth')

  const { count, error } = await supabaseAdmin
    .from('sms_messages')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', auth.orgId)
    .eq('direction', 'inbound')
    .eq('is_read', false)

  if (error) {
    return c.json({ error: 'Failed to get unread count' }, 500)
  }

  return c.json({ count: count || 0 })
})

/**
 * GET /api/v1/health-checks/:id/sms-messages/unread-count
 * Get unread SMS count for a specific health check
 */
smsConversations.get('/health-checks/:id/sms-messages/unread-count', async (c) => {
  const auth = c.get('auth')
  const healthCheckId = c.req.param('id')

  const { count, error } = await supabaseAdmin
    .from('sms_messages')
    .select('*', { count: 'exact', head: true })
    .eq('health_check_id', healthCheckId)
    .eq('organization_id', auth.orgId)
    .eq('direction', 'inbound')
    .eq('is_read', false)

  if (error) {
    return c.json({ error: 'Failed to get unread count' }, 500)
  }

  return c.json({ count: count || 0 })
})

export default smsConversations
