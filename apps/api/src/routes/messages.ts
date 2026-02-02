/**
 * Messages API routes
 * Conversation-level endpoints for the Messages page.
 * Groups SMS threads by external phone number (not by health check).
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorizeMinRole } from '../middleware/auth.js'
import { sendSms } from '../services/sms.js'
import { emitToHealthCheck, emitToOrganization, WS_EVENTS } from '../services/websocket.js'
import { logger } from '../lib/logger.js'

const messages = new Hono()

messages.use('*', authMiddleware)
messages.use('*', authorizeMinRole('service_advisor'))

/**
 * Helper: derive the external party's phone number from an SMS row.
 * Inbound → from_number is the customer; Outbound → to_number is the customer.
 */
function externalNumber(row: { direction: string; from_number: string; to_number: string }): string {
  return row.direction === 'inbound' ? row.from_number : row.to_number
}

/**
 * Generate phone number variants for matching (same logic as inbound-sms.ts)
 */
function phoneVariants(e164: string): string[] {
  const variants = [e164]
  if (e164.startsWith('+')) variants.push(e164.substring(1))
  if (e164.startsWith('+44')) variants.push('0' + e164.substring(3))
  return variants
}

// ──────────────────────────────────────────────
// GET /conversations
// ──────────────────────────────────────────────
messages.get('/conversations', async (c) => {
  const auth = c.get('auth')
  const orgId = auth.orgId

  const search = c.req.query('search') || ''
  const filter = c.req.query('filter') || 'all' // all | unread | unlinked
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const offset = parseInt(c.req.query('offset') || '0')

  // Use a raw SQL query via rpc or build with supabase.
  // We need to group by external phone number — use a CTE approach.
  // Supabase JS SDK doesn't support GROUP BY, so we query all recent messages
  // and aggregate in JS. For large datasets this should be replaced with an rpc,
  // but this is fine for typical dealership volumes (< 10k messages per org).

  let query = supabaseAdmin
    .from('sms_messages')
    .select(`
      id,
      direction,
      from_number,
      to_number,
      body,
      is_read,
      created_at,
      health_check_id,
      customer_id
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(2000) // fetch enough to build conversation list

  const { data: allMessages, error } = await query

  if (error) {
    logger.error('Error fetching messages for conversations', { error: error.message })
    return c.json({ error: 'Failed to fetch conversations' }, 500)
  }

  if (!allMessages || allMessages.length === 0) {
    return c.json({ conversations: [], total: 0 })
  }

  // Group by external phone number
  const conversationMap = new Map<string, {
    phoneNumber: string
    messages: typeof allMessages
    latestMessage: (typeof allMessages)[0]
    unreadCount: number
    customerIds: Set<string>
    healthCheckIds: Set<string>
  }>()

  for (const msg of allMessages) {
    const phone = externalNumber(msg)
    if (!phone) continue

    let conv = conversationMap.get(phone)
    if (!conv) {
      conv = {
        phoneNumber: phone,
        messages: [],
        latestMessage: msg,
        unreadCount: 0,
        customerIds: new Set(),
        healthCheckIds: new Set()
      }
      conversationMap.set(phone, conv)
    }

    conv.messages.push(msg)

    // Latest message is always the first one we encounter (sorted desc)
    // so latestMessage is already set correctly on creation

    if (msg.direction === 'inbound' && !msg.is_read) {
      conv.unreadCount++
    }
    if (msg.customer_id) conv.customerIds.add(msg.customer_id)
    if (msg.health_check_id) conv.healthCheckIds.add(msg.health_check_id)
  }

  // Fetch customer info for all referenced customer IDs
  const allCustomerIds = new Set<string>()
  for (const conv of conversationMap.values()) {
    for (const cid of conv.customerIds) allCustomerIds.add(cid)
  }

  const customerMap = new Map<string, { id: string; firstName: string; lastName: string }>()
  if (allCustomerIds.size > 0) {
    const { data: customers } = await supabaseAdmin
      .from('customers')
      .select('id, first_name, last_name')
      .in('id', [...allCustomerIds])

    if (customers) {
      for (const cust of customers) {
        customerMap.set(cust.id, {
          id: cust.id,
          firstName: cust.first_name,
          lastName: cust.last_name
        })
      }
    }
  }

  // Fetch health check info for all referenced HC IDs
  const allHcIds = new Set<string>()
  for (const conv of conversationMap.values()) {
    for (const hid of conv.healthCheckIds) allHcIds.add(hid)
  }

  const hcMap = new Map<string, { id: string; vhcReference: string | null; status: string }>()
  if (allHcIds.size > 0) {
    const { data: hcs } = await supabaseAdmin
      .from('health_checks')
      .select('id, vhc_reference, status')
      .in('id', [...allHcIds])

    if (hcs) {
      for (const hc of hcs) {
        hcMap.set(hc.id, {
          id: hc.id,
          vhcReference: hc.vhc_reference,
          status: hc.status
        })
      }
    }
  }

  // Build conversation list
  let conversations = [...conversationMap.values()].map(conv => {
    // Pick the first customer found (most messages link to one customer)
    let customer: { id: string; firstName: string; lastName: string } | null = null
    for (const cid of conv.customerIds) {
      const c = customerMap.get(cid)
      if (c) { customer = c; break }
    }

    // Pick the most recent health check
    let latestHealthCheck: { id: string; vhcReference: string | null; status: string } | null = null
    for (const hid of conv.healthCheckIds) {
      const hc = hcMap.get(hid)
      if (hc) { latestHealthCheck = hc; break }
    }

    return {
      phoneNumber: conv.phoneNumber,
      customer,
      latestMessage: {
        body: conv.latestMessage.body,
        direction: conv.latestMessage.direction,
        createdAt: conv.latestMessage.created_at,
        isRead: conv.latestMessage.is_read
      },
      unreadCount: conv.unreadCount,
      latestHealthCheck
    }
  })

  // Sort by latest message time (most recent first)
  conversations.sort((a, b) =>
    new Date(b.latestMessage.createdAt).getTime() - new Date(a.latestMessage.createdAt).getTime()
  )

  // Apply filters
  if (filter === 'unread') {
    conversations = conversations.filter(c => c.unreadCount > 0)
  } else if (filter === 'unlinked') {
    conversations = conversations.filter(c => !c.latestHealthCheck)
  }

  // Apply search
  if (search) {
    const q = search.toLowerCase()
    conversations = conversations.filter(c => {
      const name = c.customer
        ? `${c.customer.firstName} ${c.customer.lastName}`.toLowerCase()
        : ''
      return (
        c.phoneNumber.includes(q) ||
        name.includes(q) ||
        c.latestMessage.body.toLowerCase().includes(q)
      )
    })
  }

  const total = conversations.length
  conversations = conversations.slice(offset, offset + limit)

  return c.json({ conversations, total })
})

// ──────────────────────────────────────────────
// GET /conversations/:phoneNumber
// ──────────────────────────────────────────────
messages.get('/conversations/:phoneNumber', async (c) => {
  const auth = c.get('auth')
  const orgId = auth.orgId
  const phoneNumber = decodeURIComponent(c.req.param('phoneNumber'))

  // Find all messages where this phone number is the external party
  const { data: allMessages, error } = await supabaseAdmin
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
      health_check_id,
      customer_id,
      sender:users!sms_messages_sent_by_fkey(id, first_name, last_name)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (error) {
    logger.error('Error fetching conversation messages', { error: error.message })
    return c.json({ error: 'Failed to fetch messages' }, 500)
  }

  // Filter to only messages involving this phone number
  const threadMessages = (allMessages || []).filter(msg => {
    const ext = externalNumber(msg)
    return ext === phoneNumber
  })

  // Get customer info
  let customer: { id: string; firstName: string; lastName: string } | null = null
  const customerIds = new Set(threadMessages.map(m => m.customer_id).filter(Boolean))
  if (customerIds.size > 0) {
    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('id, first_name, last_name')
      .in('id', [...customerIds])
      .limit(1)
      .single()

    if (cust) {
      customer = { id: cust.id, firstName: cust.first_name, lastName: cust.last_name }
    }
  }

  // Get linked health checks
  const hcIds = new Set(threadMessages.map(m => m.health_check_id).filter(Boolean))
  let healthChecks: { id: string; vhcReference: string | null; status: string }[] = []
  if (hcIds.size > 0) {
    const { data: hcs } = await supabaseAdmin
      .from('health_checks')
      .select('id, vhc_reference, status')
      .in('id', [...hcIds])

    if (hcs) {
      healthChecks = hcs.map(hc => ({
        id: hc.id,
        vhcReference: hc.vhc_reference,
        status: hc.status
      }))
    }
  }

  return c.json({
    phoneNumber,
    customer,
    healthChecks,
    messages: threadMessages
  })
})

// ──────────────────────────────────────────────
// POST /conversations/:phoneNumber/reply
// ──────────────────────────────────────────────
messages.post('/conversations/:phoneNumber/reply', async (c) => {
  const auth = c.get('auth')
  const orgId = auth.orgId
  const phoneNumber = decodeURIComponent(c.req.param('phoneNumber'))
  const { message } = await c.req.json<{ message: string }>()

  if (!message?.trim()) {
    return c.json({ error: 'Message body is required' }, 400)
  }

  // Look up customer by phone variants within org
  const variants = phoneVariants(phoneNumber)
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id, mobile, first_name, last_name')
    .eq('organization_id', orgId)
    .in('mobile', variants)
    .limit(1)
    .maybeSingle()

  // Look up most recent active HC for auto-linking
  let healthCheckId: string | null = null
  if (customer) {
    const terminalStatuses = ['completed', 'cancelled', 'no_show']

    // Check via vehicle path
    const { data: hcViaVehicle } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('organization_id', orgId)
      .eq('vehicles.customer_id', customer.id)
      .not('status', 'in', `(${terminalStatuses.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (hcViaVehicle) {
      healthCheckId = hcViaVehicle.id
    } else {
      // Check via direct customer_id
      const { data: hcDirect } = await supabaseAdmin
        .from('health_checks')
        .select('id')
        .eq('organization_id', orgId)
        .eq('customer_id', customer.id)
        .not('status', 'in', `(${terminalStatuses.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (hcDirect) {
        healthCheckId = hcDirect.id
      }
    }
  }

  // Send via Twilio
  const smsResult = await sendSms(phoneNumber, message.trim(), orgId)

  if (!smsResult.success) {
    logger.error('Failed to send SMS reply from messages page', { error: smsResult.error, phoneNumber })
    return c.json({ error: smsResult.error || 'Failed to send SMS' }, 500)
  }

  // Resolve FROM number
  let fromNumber = ''
  const { getSmsCredentials } = await import('../services/credentials.js')
  const creds = await getSmsCredentials(orgId)
  if (creds.credentials) {
    fromNumber = creds.credentials.phoneNumber
  }

  // Store in sms_messages
  const { data: storedMessage, error: insertError } = await supabaseAdmin
    .from('sms_messages')
    .insert({
      organization_id: orgId,
      health_check_id: healthCheckId,
      customer_id: customer?.id || null,
      direction: 'outbound',
      from_number: fromNumber,
      to_number: phoneNumber,
      body: message.trim(),
      twilio_sid: smsResult.messageId || null,
      twilio_status: 'sent',
      is_read: true,
      sent_by: auth.user.id,
      metadata: { source: smsResult.source, sentFrom: 'messages_page' }
    })
    .select()
    .single()

  if (insertError) {
    logger.error('Failed to store outbound SMS from messages page', { error: insertError.message })
  }

  // Emit to HC room if linked
  if (healthCheckId) {
    emitToHealthCheck(healthCheckId, WS_EVENTS.SMS_SENT, {
      message: {
        id: storedMessage?.id,
        direction: 'outbound',
        from_number: fromNumber,
        to_number: phoneNumber,
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
  }

  // Emit to org room for Messages page
  emitToOrganization(orgId, WS_EVENTS.SMS_SENT, {
    message: {
      id: storedMessage?.id,
      direction: 'outbound',
      from_number: fromNumber,
      to_number: phoneNumber,
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

// ──────────────────────────────────────────────
// PUT /conversations/:phoneNumber/mark-read
// ──────────────────────────────────────────────
messages.put('/conversations/:phoneNumber/mark-read', async (c) => {
  const auth = c.get('auth')
  const orgId = auth.orgId
  const phoneNumber = decodeURIComponent(c.req.param('phoneNumber'))

  const { error } = await supabaseAdmin
    .from('sms_messages')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
      read_by: auth.user.id
    })
    .eq('organization_id', orgId)
    .eq('direction', 'inbound')
    .eq('from_number', phoneNumber)
    .eq('is_read', false)

  if (error) {
    logger.error('Error marking conversation as read', { error: error.message, phoneNumber })
    return c.json({ error: 'Failed to mark as read' }, 500)
  }

  return c.json({ success: true })
})

export default messages
