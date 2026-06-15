/**
 * Inbound SMS Processing Service
 * Handles matching incoming SMS to organizations, customers, and health checks,
 * then stores the message and triggers notifications.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { formatPhoneNumber } from './sms.js'
import { createNotification, createRoleNotifications } from '../routes/notifications.js'
import { emitToHealthCheck, emitToOrganization, WS_EVENTS } from './websocket.js'
import { handleInboundSmsForFollowUps } from './follow-up-engine.js'

interface InboundSmsData {
  from: string
  to: string
  body: string
  messageSid: string
}

// Health check statuses that are no longer "active" and therefore not a valid target
// for threading an inbound reply.
const TERMINAL_STATUSES = ['completed', 'cancelled', 'no_show']

/**
 * Generate phone number variants for matching
 * Given a number like +447700900123, returns variants:
 * - +447700900123 (E.164)
 * - 07700900123 (UK local)
 * - 447700900123 (without +)
 */
export function phoneVariants(e164: string): string[] {
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
 * Find every customer matching this phone number across the candidate organizations.
 * A phone number can legitimately exist in more than one org (no global uniqueness),
 * so we return all matches and let the caller decide whether routing is unambiguous.
 */
export async function findCustomerMatches(
  fromVariants: string[],
  orgIds: string[]
): Promise<Array<{ customerId: string; organizationId: string }>> {
  if (orgIds.length === 0) return []

  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select('id, organization_id')
    .in('organization_id', orgIds)
    .in('mobile', fromVariants)

  if (!customers?.length) return []

  return customers.map(c => ({ customerId: c.id, organizationId: c.organization_id }))
}

/**
 * Find the single most recent OUTBOUND SMS sent to this phone number across the candidate
 * organizations. This is the strongest signal for which tenant an inbound reply belongs to:
 * the dominant flow is "org texts customer -> customer replies minutes later".
 *
 * Unions the two outbound logs and takes the newest by created_at:
 *   - sms_messages       (two-way conversation; carries org + health_check + customer directly)
 *   - communication_logs (worker quote/reminder sends; org resolved via the health check, since
 *                         communication_logs.organization_id is not reliably populated)
 */
async function findMostRecentOutbound(
  fromVariants: string[],
  orgIds: string[]
): Promise<{ organizationId: string; healthCheckId: string | null; customerId: string | null; sentAt: string } | null> {
  if (orgIds.length === 0) return null

  const candidates: Array<{ organizationId: string; healthCheckId: string | null; customerId: string | null; sentAt: string }> = []

  // The two source queries are independent — run them concurrently.
  const [smsRes, logRes] = await Promise.all([
    // Source 1: sms_messages (outbound)
    supabaseAdmin
      .from('sms_messages')
      .select('organization_id, health_check_id, customer_id, created_at')
      .eq('direction', 'outbound')
      .in('to_number', fromVariants)
      .in('organization_id', orgIds)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Source 2: communication_logs (worker quote/reminder sends) — org via the health check
    supabaseAdmin
      .from('communication_logs')
      .select('health_check_id, created_at, health_checks!inner(organization_id)')
      .eq('channel', 'sms')
      .in('recipient', fromVariants)
      .in('health_checks.organization_id', orgIds)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ])

  const smsRow = smsRes.data
  const logRow = logRes.data

  if (smsRow?.organization_id) {
    candidates.push({
      organizationId: smsRow.organization_id,
      healthCheckId: smsRow.health_check_id,
      customerId: smsRow.customer_id,
      sentAt: smsRow.created_at,
    })
  }

  if (logRow?.health_check_id) {
    const hc = Array.isArray(logRow.health_checks) ? logRow.health_checks[0] : logRow.health_checks
    if (hc?.organization_id) {
      candidates.push({
        organizationId: hc.organization_id,
        healthCheckId: logRow.health_check_id,
        customerId: null,
        sentAt: logRow.created_at,
      })
    }
  }

  if (candidates.length === 0) return null

  candidates.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
  return candidates[0]
}

/**
 * Find most recent active health check for a customer
 */
async function findActiveHealthCheck(
  customerId: string,
  organizationId: string
): Promise<{ id: string; advisorId: string | null; siteId: string | null } | null> {
  const notTerminal = `(${TERMINAL_STATUSES.join(',')})`
  const mapHc = (h: { id: string; advisor_id: string | null; site_id: string | null }) =>
    ({ id: h.id, advisorId: h.advisor_id, siteId: h.site_id })

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
    .not('status', 'in', notTerminal)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (vehicleError) {
    logger.error('Error finding HC via vehicle path', { error: vehicleError.message, customerId })
  }

  if (hcViaVehicle) {
    logger.info('Found active HC via vehicle path', { healthCheckId: hcViaVehicle.id, status: hcViaVehicle.status })
    return mapHc(hcViaVehicle)
  }

  // Path 2: find via direct customer_id on health_checks
  const { data: hcDirect, error: directError } = await supabaseAdmin
    .from('health_checks')
    .select('id, advisor_id, site_id, status')
    .eq('organization_id', organizationId)
    .eq('customer_id', customerId)
    .not('status', 'in', notTerminal)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (directError) {
    logger.error('Error finding HC via direct customer_id', { error: directError.message, customerId })
  }

  if (hcDirect) {
    logger.info('Found active HC via direct customer_id', { healthCheckId: hcDirect.id, status: hcDirect.status })
    return mapHc(hcDirect)
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
      .not('status', 'in', notTerminal)
      .single()

    if (hcFromSms) {
      logger.info('Found active HC via previous outbound SMS', { healthCheckId: hcFromSms.id, status: hcFromSms.status })
      return mapHc(hcFromSms)
    }
  }

  logger.warn('No active health check found for customer', { customerId, organizationId })
  return null
}

interface RoutingResult {
  organizationId: string | null
  customerId: string | null
  healthCheckHint: string | null
  routingStatus: 'routed' | 'unrouted_ambiguous' | 'unrouted_unknown'
  candidateOrgIds: string[] // populated only when ambiguous, for the quarantine metadata
}

/**
 * Decide which tenant an inbound SMS belongs to. Best-effort and ordered by confidence —
 * an inbound SMS carries only From/To/Body, and on a SHARED number To cannot identify the
 * tenant, so we route by the strongest available signal and refuse to guess otherwise:
 *
 *   1. Dedicated number (exactly one candidate org)  -> route directly (unambiguous).
 *   2. Shared number -> most recent outbound to this phone wins (deterministic).
 *   3. No prior outbound -> customer-phone match, but only if it resolves to exactly ONE org.
 *   4. Otherwise -> quarantine (organizationId = null). Never assign an arbitrary tenant.
 *
 * Reads only — no writes or notifications — so the decision can be reasoned about and tested
 * independently of the persistence/notification side effects in processInboundSms.
 */
async function resolveInboundRouting(toNumber: string, fromVariants: string[]): Promise<RoutingResult> {
  const unknown: RoutingResult = {
    organizationId: null, customerId: null, healthCheckHint: null,
    routingStatus: 'unrouted_unknown', candidateOrgIds: []
  }
  const routed = (
    organizationId: string,
    customerId: string | null = null,
    healthCheckHint: string | null = null
  ): RoutingResult => ({ organizationId, customerId, healthCheckHint, routingStatus: 'routed', candidateOrgIds: [] })

  const candidateOrgIds = await matchOrganizations(toNumber)
  logger.info('Matched organizations for inbound SMS', { to: toNumber, orgCount: candidateOrgIds.length })

  // No tenant owns this number.
  if (candidateOrgIds.length === 0) {
    logger.warn('Inbound SMS to unrecognised number', { to: toNumber })
    return unknown
  }

  // Dedicated number, or a single-tenant deployment — unambiguous.
  if (candidateOrgIds.length === 1) return routed(candidateOrgIds[0])

  // Shared number. Prefer the most recent outbound to this phone (strongest signal).
  const recent = await findMostRecentOutbound(fromVariants, candidateOrgIds)
  if (recent) {
    logger.info('Inbound SMS routed via most-recent outbound', { organizationId: recent.organizationId, healthCheckHint: recent.healthCheckId })
    return routed(recent.organizationId, recent.customerId, recent.healthCheckId)
  }

  // Cold inbound (no prior outbound) — fall back to a customer-phone match, only if unambiguous.
  const matches = await findCustomerMatches(fromVariants, candidateOrgIds)
  const distinctOrgs = [...new Set(matches.map(m => m.organizationId))]
  if (distinctOrgs.length === 1) {
    logger.info('Inbound SMS routed via unique customer match', { organizationId: distinctOrgs[0] })
    return routed(distinctOrgs[0], matches[0].customerId)
  }
  if (distinctOrgs.length > 1) {
    logger.warn('Inbound SMS ambiguous — phone exists in multiple orgs on shared number', { orgCount: distinctOrgs.length })
    return {
      organizationId: null, customerId: null, healthCheckHint: null,
      routingStatus: 'unrouted_ambiguous', candidateOrgIds: distinctOrgs
    }
  }
  logger.warn('Inbound SMS from unknown sender on shared number', { from: fromVariants[0] })
  return unknown
}

/**
 * Process an inbound SMS message: resolve the tenant (see resolveInboundRouting), persist the
 * message, and — only when confidently routed — emit realtime events and notify staff.
 * Quarantined (unrouted) messages are stored with organization_id = NULL and never reach a tenant.
 */
export async function processInboundSms(data: InboundSmsData): Promise<void> {
  const { from, to, body, messageSid } = data

  logger.info('Processing inbound SMS', { from, to, messageSid })

  const fromVariants = phoneVariants(formatPhoneNumber(from))

  const routing = await resolveInboundRouting(to, fromVariants)
  const { organizationId, healthCheckHint, routingStatus } = routing
  const metaCandidateOrgIds = routing.candidateOrgIds
  let customerId = routing.customerId

  // Resolve the customer within the routed org if not already known (e.g. routed via comms log).
  if (organizationId && !customerId) {
    const matches = await findCustomerMatches(fromVariants, [organizationId])
    if (matches.length) customerId = matches[0].customerId
  }

  // Resolve the active health check: prefer the recency hint, else search within the org.
  let healthCheck: { id: string; advisorId: string | null; siteId: string | null } | null = null
  if (organizationId) {
    if (healthCheckHint) {
      const { data: hintHc } = await supabaseAdmin
        .from('health_checks')
        .select('id, advisor_id, site_id, status')
        .eq('id', healthCheckHint)
        .eq('organization_id', organizationId)
        .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
        .maybeSingle()
      if (hintHc) {
        healthCheck = { id: hintHc.id, advisorId: hintHc.advisor_id, siteId: hintHc.site_id }
      }
    }
    if (!healthCheck && customerId) {
      healthCheck = await findActiveHealthCheck(customerId, organizationId)
    }
  }

  const isRouted = routingStatus === 'routed' && !!organizationId

  // Store the message. Unrouted messages are kept with organization_id = NULL plus routing
  // metadata so they appear in the super-admin "unrouted" queue for manual reassignment.
  const { data: message, error: insertError } = await supabaseAdmin
    .from('sms_messages')
    .insert({
      organization_id: organizationId,
      health_check_id: healthCheck?.id || null,
      customer_id: customerId || null,
      direction: 'inbound',
      from_number: from,
      to_number: to,
      body,
      twilio_sid: messageSid,
      twilio_status: 'received',
      is_read: false,
      metadata: isRouted ? {} : { routing: { status: routingStatus, candidate_org_ids: metaCandidateOrgIds } },
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
    customerId,
    healthCheckId: healthCheck?.id,
    routingStatus,
  })

  // Quarantined messages are stored only. Never emit into a tenant room or notify a tenant —
  // that would leak a customer's reply to an organisation we are not confident about.
  if (!isRouted || !organizationId) {
    logger.info('Inbound SMS quarantined — not routed to any tenant', { from, messageSid, routingStatus })
    return
  }

  const messagePayload = {
    id: message.id,
    direction: 'inbound' as const,
    from_number: from,
    to_number: to,
    body,
    twilio_sid: messageSid,
    twilio_status: 'received',
    is_read: false,
    created_at: message.created_at,
    health_check_id: healthCheck?.id || null,
    customer_id: customerId || null,
  }

  // Emit to the health check room (if matched) and always to the org room (Messages page).
  if (healthCheck?.id) {
    emitToHealthCheck(healthCheck.id, WS_EVENTS.SMS_RECEIVED, { message: messagePayload })
  }
  emitToOrganization(organizationId, WS_EVENTS.SMS_RECEIVED, { message: messagePayload })

  // Pause any active follow-up cadences for this customer (and honour STOP opt-out).
  try {
    await handleInboundSmsForFollowUps({
      organizationId,
      customerId: customerId || null,
      healthCheckId: healthCheck?.id || null,
      body,
      messageId: message.id,
    })
  } catch (err) {
    logger.error('Follow-up inbound hook failed', { error: String(err), messageSid })
  }

  // Notifications require an associated health check (advisor / site context).
  if (!healthCheck) {
    logger.info('Inbound SMS routed but no active health check to notify on', { organizationId, from, messageSid })
    return
  }

  // Get customer name for notification
  let customerName = 'Unknown'
  if (customerId) {
    const { data: cust } = await supabaseAdmin
      .from('customers')
      .select('first_name, last_name')
      .eq('id', customerId)
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
