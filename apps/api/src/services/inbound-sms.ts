/**
 * Inbound SMS Processing Service
 * Handles matching incoming SMS to organizations, customers, and health checks,
 * then stores the message and triggers notifications.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { formatPhoneNumber } from './sms.js'
import { createNotification, createRoleNotifications } from '../routes/notifications.js'
import { emitToHealthCheck, WS_EVENTS } from './websocket.js'

interface InboundSmsData {
  from: string
  to: string
  body: string
  messageSid: string
}

/**
 * Generate phone number variants for matching
 * Given a number like +447700900123, returns variants:
 * - +447700900123 (E.164)
 * - 07700900123 (UK local)
 * - 447700900123 (without +)
 */
function phoneVariants(e164: string): string[] {
  const variants = [e164]

  // Without +
  if (e164.startsWith('+')) {
    variants.push(e164.substring(1))
  }

  // UK: +44 -> 0
  if (e164.startsWith('+44')) {
    variants.push('0' + e164.substring(3))
  }

  return variants
}

/**
 * Match TO number to organization(s)
 */
async function matchOrganizations(toNumber: string): Promise<string[]> {
  const orgIds: string[] = []

  // Check org-level: organization_notification_settings.twilio_phone_number
  const { data: orgSettings } = await supabaseAdmin
    .from('organization_notification_settings')
    .select('organization_id')
    .eq('twilio_phone_number', toNumber)

  if (orgSettings?.length) {
    for (const s of orgSettings) {
      orgIds.push(s.organization_id)
    }
  }

  // Check platform-level: all orgs using platform SMS
  const { data: platformSettings } = await supabaseAdmin
    .from('platform_settings')
    .select('settings')
    .eq('id', 'notifications')
    .single()

  if (platformSettings?.settings) {
    const settings = platformSettings.settings as Record<string, unknown>
    if (settings.twilio_phone_number === toNumber) {
      // Find all orgs that use_platform_sms
      const { data: platformOrgs } = await supabaseAdmin
        .from('organization_notification_settings')
        .select('organization_id')
        .eq('use_platform_sms', true)

      if (platformOrgs?.length) {
        for (const o of platformOrgs) {
          if (!orgIds.includes(o.organization_id)) {
            orgIds.push(o.organization_id)
          }
        }
      }

      // Also include orgs without notification settings (they default to platform)
      const { data: allOrgs } = await supabaseAdmin
        .from('organizations')
        .select('id')

      if (allOrgs?.length) {
        const orgsWithSettings = new Set(
          (await supabaseAdmin
            .from('organization_notification_settings')
            .select('organization_id')
          ).data?.map(s => s.organization_id) || []
        )

        for (const org of allOrgs) {
          if (!orgsWithSettings.has(org.id) && !orgIds.includes(org.id)) {
            orgIds.push(org.id)
          }
        }
      }
    }
  }

  return orgIds
}

/**
 * Find customer by phone number within matched organizations
 */
async function findCustomer(
  fromNumber: string,
  orgIds: string[]
): Promise<{ customerId: string; organizationId: string } | null> {
  const variants = phoneVariants(fromNumber)

  for (const orgId of orgIds) {
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('id, organization_id')
      .eq('organization_id', orgId)
      .in('mobile', variants)
      .limit(1)
      .maybeSingle()

    if (customer) {
      return { customerId: customer.id, organizationId: customer.organization_id }
    }
  }

  return null
}

/**
 * Find most recent active health check for a customer
 */
async function findActiveHealthCheck(
  customerId: string,
  organizationId: string
): Promise<{ id: string; advisorId: string | null; siteId: string | null } | null> {
  const terminalStatuses = ['completed', 'cancelled', 'no_show']

  // Path 1: find via vehicle -> customer relationship
  const { data: hcViaVehicle, error: vehicleError } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      advisor_id,
      site_id,
      status,
      vehicle:vehicles!inner(customer_id)
    `)
    .eq('organization_id', organizationId)
    .eq('vehicles.customer_id', customerId)
    .not('status', 'in', `(${terminalStatuses.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (vehicleError) {
    logger.error('Error finding HC via vehicle path', { error: vehicleError.message, customerId })
  }

  if (hcViaVehicle) {
    logger.info('Found active HC via vehicle path', { healthCheckId: hcViaVehicle.id, status: hcViaVehicle.status })
    return {
      id: hcViaVehicle.id,
      advisorId: hcViaVehicle.advisor_id,
      siteId: hcViaVehicle.site_id
    }
  }

  // Path 2: find via direct customer_id on health_checks
  const { data: hcDirect, error: directError } = await supabaseAdmin
    .from('health_checks')
    .select('id, advisor_id, site_id, status')
    .eq('organization_id', organizationId)
    .eq('customer_id', customerId)
    .not('status', 'in', `(${terminalStatuses.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (directError) {
    logger.error('Error finding HC via direct customer_id', { error: directError.message, customerId })
  }

  if (hcDirect) {
    logger.info('Found active HC via direct customer_id', { healthCheckId: hcDirect.id, status: hcDirect.status })
    return {
      id: hcDirect.id,
      advisorId: hcDirect.advisor_id,
      siteId: hcDirect.site_id
    }
  }

  // Path 3: match via existing outbound SMS — if we previously sent an SMS for a health check
  // to this customer, the reply should go back to that health check
  const { data: existingSms } = await supabaseAdmin
    .from('sms_messages')
    .select('health_check_id')
    .eq('customer_id', customerId)
    .eq('organization_id', organizationId)
    .eq('direction', 'outbound')
    .not('health_check_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingSms?.health_check_id) {
    // Verify the health check is still active
    const { data: hcFromSms } = await supabaseAdmin
      .from('health_checks')
      .select('id, advisor_id, site_id, status')
      .eq('id', existingSms.health_check_id)
      .not('status', 'in', `(${terminalStatuses.join(',')})`)
      .single()

    if (hcFromSms) {
      logger.info('Found active HC via previous outbound SMS', { healthCheckId: hcFromSms.id, status: hcFromSms.status })
      return {
        id: hcFromSms.id,
        advisorId: hcFromSms.advisor_id,
        siteId: hcFromSms.site_id
      }
    }
  }

  logger.warn('No active health check found for customer', { customerId, organizationId })
  return null
}

/**
 * Process an inbound SMS message
 */
export async function processInboundSms(data: InboundSmsData): Promise<void> {
  const { from, to, body, messageSid } = data

  logger.info('Processing inbound SMS', { from, to, messageSid })

  // Normalize FROM number
  const normalizedFrom = formatPhoneNumber(from)

  // 1. Match TO number to organization(s)
  const orgIds = await matchOrganizations(to)
  logger.info('Matched organizations for inbound SMS', { to, orgCount: orgIds.length })

  // 2. Find customer by phone number
  const customerMatch = orgIds.length > 0
    ? await findCustomer(normalizedFrom, orgIds)
    : null

  // 3. Find active health check
  let healthCheck: { id: string; advisorId: string | null; siteId: string | null } | null = null
  if (customerMatch) {
    healthCheck = await findActiveHealthCheck(customerMatch.customerId, customerMatch.organizationId)
  }

  // Determine organization_id (from customer match, or first matched org, or null)
  const organizationId = customerMatch?.organizationId || orgIds[0] || null

  // 4. Store message in sms_messages
  const { data: message, error: insertError } = await supabaseAdmin
    .from('sms_messages')
    .insert({
      organization_id: organizationId,
      health_check_id: healthCheck?.id || null,
      customer_id: customerMatch?.customerId || null,
      direction: 'inbound',
      from_number: from,
      to_number: to,
      body,
      twilio_sid: messageSid,
      twilio_status: 'received',
      is_read: false,
      metadata: {}
    })
    .select()
    .single()

  if (insertError) {
    logger.error('Failed to store inbound SMS', { error: insertError.message, messageSid })
    return
  }

  logger.info('Stored inbound SMS', {
    messageId: message.id,
    organizationId,
    customerId: customerMatch?.customerId,
    healthCheckId: healthCheck?.id
  })

  // 5. Emit real-time event to health check room
  if (healthCheck?.id) {
    emitToHealthCheck(healthCheck.id, WS_EVENTS.SMS_RECEIVED, {
      message: {
        id: message.id,
        direction: 'inbound',
        from_number: from,
        to_number: to,
        body,
        twilio_sid: messageSid,
        twilio_status: 'received',
        is_read: false,
        created_at: message.created_at
      }
    })
  }

  // 6. Trigger notifications
  if (!healthCheck || !organizationId) {
    logger.info('Inbound SMS unmatched — no health check or org found', { from, messageSid })
    return
  }

  // Get customer name for notification
  let customerName = 'Unknown'
  if (customerMatch?.customerId) {
    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('first_name, last_name')
      .eq('id', customerMatch.customerId)
      .single()
    if (cust) {
      customerName = `${cust.first_name} ${cust.last_name}`
    }
  }

  const truncatedBody = body.length > 100 ? body.substring(0, 97) + '...' : body
  const actionUrl = `/health-checks/${healthCheck.id}?tab=sms`

  if (healthCheck.advisorId) {
    // Notify the assigned advisor
    await createNotification(
      healthCheck.advisorId,
      'sms_received',
      `New SMS from ${customerName}`,
      truncatedBody,
      {
        healthCheckId: healthCheck.id,
        priority: 'high',
        actionUrl,
        metadata: { smsMessageId: message.id }
      }
    )
  } else if (healthCheck.siteId) {
    // No advisor assigned — notify all service_advisors + site_admins at the site
    await createRoleNotifications(
      healthCheck.siteId,
      ['service_advisor', 'site_admin'],
      'sms_received',
      `New SMS from ${customerName}`,
      truncatedBody,
      {
        healthCheckId: healthCheck.id,
        priority: 'high',
        actionUrl,
        organizationId
      }
    )
  }
}
