/**
 * Super Admin Usage & Communications API Routes
 * Cross-organization usage rollups (SMS / email / health checks / AI / storage)
 * and a communication-log browser. Aggregations go through service_role RPCs
 * (admin_usage_by_org / admin_usage_totals / admin_comms_delivery) so they never
 * trip the PostgREST ~1000-row cap; detail lists paginate with .range().
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'
import { logger } from '../../lib/logger.js'
import { phoneVariants, findCustomerMatches } from '../../services/inbound-sms.js'
import { formatPhoneNumber } from '../../services/sms.js'
import { emitToOrganization, WS_EVENTS } from '../../services/websocket.js'
import { getEffectiveModulesForOrgs } from '../../services/modules.js'
import type { ModuleKey } from '../../lib/modules.js'

const adminUsage = new Hono()

adminUsage.use('*', superAdminMiddleware)

const DEFAULT_SMS_UNIT_COST = 0.04 // GBP — overridden by platform_settings.billing (Phase 3)

/** Parse a period string to a [start, end] Date range. */
function getPeriodDates(period: string): { start: Date; end: Date } {
  const end = new Date()
  let start: Date
  switch (period) {
    case '7d':
      start = new Date(end); start.setDate(start.getDate() - 7); break
    case '90d':
      start = new Date(end); start.setDate(start.getDate() - 90); break
    case 'all':
      start = new Date('2020-01-01'); break
    case '30d':
    default:
      start = new Date(end); start.setDate(start.getDate() - 30); break
  }
  return { start, end }
}

const toDateStr = (d: Date) => d.toISOString().slice(0, 10)

/** Configurable per-SMS unit cost (GBP). Falls back to a default until Phase 3 sets it. */
async function getSmsUnitRate(): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'billing')
      .maybeSingle()
    const settings = (data?.settings as Record<string, unknown> | null) || null
    const raw = settings?.sms_unit_cost
    const rate = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
    return Number.isFinite(rate) ? rate : DEFAULT_SMS_UNIT_COST
  } catch {
    return DEFAULT_SMS_UNIT_COST
  }
}

/** Platform-wide AI chargeout margin (%). chargeout = cost × (1 + margin/100). */
async function getAiMarginPercent(): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value')
      .eq('key', 'ai_margin_percent')
      .maybeSingle()
    const rate = parseFloat(String(data?.value ?? ''))
    return Number.isFinite(rate) && rate >= 0 ? rate : 0
  } catch {
    return 0
  }
}

/** USD→GBP rate used to convert AI chargeout to the billing currency (GBP). */
async function getUsdToGbpRate(): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value')
      .eq('key', 'usd_to_gbp_rate')
      .maybeSingle()
    const rate = parseFloat(String(data?.value ?? ''))
    return Number.isFinite(rate) && rate > 0 ? rate : 0.79
  } catch {
    return 0.79
  }
}

const ipUa = (c: { req: { header: (k: string) => string | undefined } }) =>
  [c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'), c.req.header('User-Agent')] as const

// =============================================================================
// USAGE
// =============================================================================

/**
 * GET /api/v1/admin/usage/summary?period=30d
 * Platform-wide usage totals for the period.
 */
adminUsage.get('/usage/summary', async (c) => {
  const superAdmin = c.get('superAdmin')
  const period = c.req.query('period') || '30d'

  try {
    const { start, end } = getPeriodDates(period)
    const p_from = toDateStr(start)
    const p_to = toDateStr(end)

    const [{ data, error }, marginPercent, usdToGbpRate] = await Promise.all([
      supabaseAdmin.rpc('admin_usage_totals', { p_from, p_to }),
      getAiMarginPercent(),
      getUsdToGbpRate()
    ])
    if (error) throw new Error(`Failed to fetch usage totals: ${error.message}`)

    const t = (data?.[0] as Record<string, unknown>) || {}
    const aiCostUsd = Number(t.ai_cost_usd || 0)
    const aiChargeoutGbp = aiCostUsd * (1 + marginPercent / 100) * usdToGbpRate
    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'view_usage_summary', 'organization_usage', undefined, { period }, ip, ua)

    return c.json({
      period: { start: p_from, end: p_to },
      marginPercent,
      usdToGbpRate,
      totals: {
        smsSent: Number(t.sms_sent || 0),
        emailsSent: Number(t.emails_sent || 0),
        healthChecksCreated: Number(t.health_checks_created || 0),
        healthChecksCompleted: Number(t.health_checks_completed || 0),
        aiGenerations: Number(t.ai_generations || 0),
        aiCostUsd: Math.round(aiCostUsd * 100) / 100,
        aiChargeoutGbp: Math.round(aiChargeoutGbp * 100) / 100,
        activeOrgs: Number(t.active_orgs || 0)
      }
    })
  } catch (error) {
    logger.error('Error fetching usage summary', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch usage summary'
    return c.json({ error: message }, 500)
  }
})

interface UsageByOrgRow {
  organization_id: string
  organization_name: string
  status: string
  sms_sent: number | string
  emails_sent: number | string
  health_checks_created: number | string
  health_checks_completed: number | string
  storage_used_bytes: number | string
  ai_generations: number | string
  ai_cost_usd: number | string
}

async function fetchUsageByOrg(period: string) {
  const { start, end } = getPeriodDates(period)
  const p_from = toDateStr(start)
  const p_to = toDateStr(end)
  const [{ data, error }, smsRate, marginPercent, usdToGbpRate] = await Promise.all([
    supabaseAdmin.rpc('admin_usage_by_org', { p_from, p_to }),
    getSmsUnitRate(),
    getAiMarginPercent(),
    getUsdToGbpRate()
  ])
  if (error) throw new Error(`Failed to fetch usage by org: ${error.message}`)

  // chargeout (GBP) = cost (USD) × (1 + margin%) × USD→GBP rate
  const chargeoutFactor = (1 + marginPercent / 100) * usdToGbpRate
  const rows = (data as UsageByOrgRow[] | null) || []
  const organizations = rows.map((r) => {
    const smsSent = Number(r.sms_sent || 0)
    const aiCostUsd = Number(r.ai_cost_usd || 0)
    return {
      id: r.organization_id,
      name: r.organization_name,
      status: r.status,
      smsSent,
      emailsSent: Number(r.emails_sent || 0),
      healthChecksCreated: Number(r.health_checks_created || 0),
      healthChecksCompleted: Number(r.health_checks_completed || 0),
      storageUsedBytes: Number(r.storage_used_bytes || 0),
      aiGenerations: Number(r.ai_generations || 0),
      aiCostUsd: Math.round(aiCostUsd * 100) / 100,
      aiChargeoutGbp: Math.round(aiCostUsd * chargeoutFactor * 100) / 100,
      estimatedSmsCost: Math.round(smsSent * smsRate * 100) / 100
    }
  })
  return { period: { start: p_from, end: p_to }, organizations, smsRate, marginPercent, usdToGbpRate }
}

function sortOrgs<T extends { name: string; smsSent: number; emailsSent: number; healthChecksCreated: number; aiCostUsd: number; storageUsedBytes: number }>(orgs: T[], sort: string): T[] {
  const sorted = [...orgs]
  switch (sort) {
    case 'emails_desc': sorted.sort((a, b) => b.emailsSent - a.emailsSent); break
    case 'health_checks_desc': sorted.sort((a, b) => b.healthChecksCreated - a.healthChecksCreated); break
    case 'ai_cost_desc': sorted.sort((a, b) => b.aiCostUsd - a.aiCostUsd); break
    case 'storage_desc': sorted.sort((a, b) => b.storageUsedBytes - a.storageUsedBytes); break
    case 'name_asc': sorted.sort((a, b) => a.name.localeCompare(b.name)); break
    case 'sms_desc':
    default: sorted.sort((a, b) => b.smsSent - a.smsSent); break
  }
  return sorted
}

/**
 * GET /api/v1/admin/usage/by-organization?period=30d&sort=sms_desc
 * Per-org usage leaderboard.
 */
adminUsage.get('/usage/by-organization', async (c) => {
  const superAdmin = c.get('superAdmin')
  const period = c.req.query('period') || '30d'
  const sort = c.req.query('sort') || 'sms_desc'

  try {
    const { period: range, organizations, marginPercent, usdToGbpRate } = await fetchUsageByOrg(period)
    const sorted = sortOrgs(organizations, sort)

    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'view_usage_by_org', 'organization_usage', undefined, { period, sort }, ip, ua)

    return c.json({ period: range, marginPercent, usdToGbpRate, organizations: sorted })
  } catch (error) {
    logger.error('Error fetching usage by organization', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch usage by organization'
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /api/v1/admin/usage/export?period=30d&format=csv
 */
adminUsage.get('/usage/export', async (c) => {
  const superAdmin = c.get('superAdmin')
  const period = c.req.query('period') || '30d'
  const format = c.req.query('format') || 'csv'
  if (format !== 'csv') return c.json({ error: 'Only CSV format is currently supported' }, 400)

  try {
    const { organizations } = await fetchUsageByOrg(period)
    const headers = ['organization', 'status', 'sms_sent', 'emails_sent', 'health_checks_created', 'health_checks_completed', 'storage_gb', 'ai_generations', 'ai_cost_usd', 'ai_chargeout_gbp', 'est_sms_cost_gbp']
    const rows = organizations.map((o) => [
      `"${o.name.replace(/"/g, '""')}"`,
      o.status,
      o.smsSent,
      o.emailsSent,
      o.healthChecksCreated,
      o.healthChecksCompleted,
      (o.storageUsedBytes / (1024 * 1024 * 1024)).toFixed(2),
      o.aiGenerations,
      o.aiCostUsd.toFixed(2),
      o.aiChargeoutGbp.toFixed(2),
      o.estimatedSmsCost.toFixed(2)
    ].join(','))
    const csv = [headers.join(','), ...rows].join('\n')

    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'export_usage', 'organization_usage', undefined, { period, rowCount: rows.length }, ip, ua)

    const filename = `usage-${period}-${toDateStr(new Date())}.csv`
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` }
    })
  } catch (error) {
    logger.error('Error exporting usage', { error })
    const message = error instanceof Error ? error.message : 'Failed to export usage'
    return c.json({ error: message }, 500)
  }
})

interface FeatureAdoptionRow {
  organization_id: string
  organization_name: string
  status: string
  follow_up_count: number | string
  workshop_count: number | string
  reports_count: number | string
  parts_count: number | string
}

// Columns of the feature-adoption matrix. moduleKey gates the off/idle/active
// state — null means always-on functionality (Parts & Packages isn't a module),
// so it is never "off". count() pulls that feature's per-org signal from the RPC.
const ADOPTION_FEATURES: Array<{
  key: string
  label: string
  moduleKey: ModuleKey | null
  count: (r: FeatureAdoptionRow) => number
}> = [
  { key: 'follow_up',      label: 'Follow-Up',        moduleKey: 'follow_up',      count: (r) => Number(r.follow_up_count || 0) },
  { key: 'workshop_board', label: 'Workshop',         moduleKey: 'workshop_board', count: (r) => Number(r.workshop_count || 0) },
  { key: 'reports',        label: 'Reporting',        moduleKey: 'reports',        count: (r) => Number(r.reports_count || 0) },
  { key: 'parts',          label: 'Parts & Packages', moduleKey: null,             count: (r) => Number(r.parts_count || 0) }
]

/**
 * GET /api/v1/admin/usage/feature-adoption?period=30d
 * Per-org feature-adoption matrix for the four headline modules. Each cell is
 * active (used in the window) / idle (module enabled but unused — the onboarding
 * & churn signal) / off (module disabled). Pairs the admin_feature_adoption RPC
 * counts with each org's effective module enablement.
 */
adminUsage.get('/usage/feature-adoption', async (c) => {
  const superAdmin = c.get('superAdmin')
  const period = c.req.query('period') || '30d'

  try {
    const { start, end } = getPeriodDates(period)
    const p_from = toDateStr(start)
    const p_to = toDateStr(end)

    const { data, error } = await supabaseAdmin.rpc('admin_feature_adoption', { p_from, p_to })
    if (error) throw new Error(`Failed to fetch feature adoption: ${error.message}`)
    const rows = (data as FeatureAdoptionRow[] | null) || []

    const moduleMap = await getEffectiveModulesForOrgs(rows.map((r) => r.organization_id))

    const organizations = rows.map((r) => {
      const modules = moduleMap.get(r.organization_id)
      const features = ADOPTION_FEATURES.map((f) => {
        const count = f.count(r)
        const enabled = f.moduleKey ? (modules ? modules[f.moduleKey] : true) : true
        const state = (!enabled ? 'off' : count > 0 ? 'active' : 'idle') as 'off' | 'idle' | 'active'
        return { key: f.key, state, count }
      })
      return { id: r.organization_id, name: r.organization_name, status: r.status, features }
    })

    // Most-engaged first (active feature count desc, then name) — the "who's adopting" view.
    organizations.sort((a, b) => {
      const av = a.features.filter((f) => f.state === 'active').length
      const bv = b.features.filter((f) => f.state === 'active').length
      return bv - av || a.name.localeCompare(b.name)
    })

    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'view_feature_adoption', 'organization_usage', undefined, { period }, ip, ua)

    return c.json({
      period: { start: p_from, end: p_to },
      features: ADOPTION_FEATURES.map((f) => ({ key: f.key, label: f.label, gated: f.moduleKey !== null })),
      organizations
    })
  } catch (error) {
    logger.error('Error fetching feature adoption', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch feature adoption'
    return c.json({ error: message }, 500)
  }
})

// =============================================================================
// COMMUNICATIONS
// =============================================================================

interface CommLogRow {
  id: string
  organization_id: string
  health_check_id: string | null
  channel: string
  recipient: string
  subject: string | null
  status: string
  external_id: string | null
  error_message: string | null
  created_at: string
  organizations: { name: string }[] | { name: string } | null
}

const orgName = (rel: CommLogRow['organizations']): string => {
  if (!rel) return 'Unattributed'
  return Array.isArray(rel) ? (rel[0]?.name || 'Unattributed') : (rel.name || 'Unattributed')
}

/**
 * GET /api/v1/admin/communications/logs
 * Paginated, filterable communication-log browser.
 */
adminUsage.get('/communications/logs', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { organization_id, channel, status, from, to, page = '1', limit = '50' } = c.req.query()

  try {
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    let query = supabaseAdmin
      .from('communication_logs')
      .select(`
        id, organization_id, health_check_id, channel, recipient, subject,
        status, external_id, error_message, created_at,
        organizations(name)
      `, { count: 'exact' })

    if (organization_id) query = query.eq('organization_id', organization_id)
    if (channel) query = query.eq('channel', channel)
    if (status) query = query.eq('status', status)
    if (from) query = query.gte('created_at', new Date(from).toISOString())
    if (to) query = query.lte('created_at', new Date(to).toISOString())

    query = query.order('created_at', { ascending: false }).range(offset, offset + limitNum - 1)

    const { data, error, count } = await query
    if (error) throw new Error(`Failed to fetch communication logs: ${error.message}`)

    const logs = ((data as CommLogRow[] | null) || []).map((l) => ({
      id: l.id,
      organizationId: l.organization_id,
      organizationName: orgName(l.organizations),
      healthCheckId: l.health_check_id,
      channel: l.channel,
      recipient: l.recipient,
      subject: l.subject,
      status: l.status,
      providerId: l.external_id,
      errorMessage: l.error_message,
      createdAt: l.created_at
    }))

    const total = count || 0
    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'view_communications_logs', 'communication_logs', undefined, { filters: { organization_id, channel, status, from, to }, page: pageNum }, ip, ua)

    return c.json({ logs, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
  } catch (error) {
    logger.error('Error fetching communication logs', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch communication logs'
    return c.json({ error: message }, 500)
  }
})

interface CommsDeliveryRow {
  organization_id: string | null
  organization_name: string
  channel: string
  total: number | string
  delivered: number | string
  sent: number | string
  failed: number | string
  bounced: number | string
  pending: number | string
}

/**
 * GET /api/v1/admin/communications/stats?period=30d
 * Per-org/per-channel delivery quality + platform rollup.
 */
adminUsage.get('/communications/stats', async (c) => {
  const superAdmin = c.get('superAdmin')
  const period = c.req.query('period') || '30d'

  try {
    const { start, end } = getPeriodDates(period)
    const { data, error } = await supabaseAdmin.rpc('admin_comms_delivery', {
      p_from: start.toISOString(),
      p_to: end.toISOString()
    })
    if (error) throw new Error(`Failed to fetch communication stats: ${error.message}`)

    const rows = (data as CommsDeliveryRow[] | null) || []
    const byOrg = rows.map((r) => {
      const total = Number(r.total || 0)
      const delivered = Number(r.delivered || 0)
      const sent = Number(r.sent || 0)
      const failed = Number(r.failed || 0)
      const bounced = Number(r.bounced || 0)
      const pending = Number(r.pending || 0)
      // "Dispatched" = handed to the provider OK. Without a delivery-receipt
      // webhook, messages stay at 'sent' and never reach 'delivered', so both
      // count toward success (otherwise everything reads as 0% delivered).
      const dispatched = delivered + sent
      return {
        organizationId: r.organization_id,
        organizationName: r.organization_name,
        channel: r.channel,
        total, delivered, sent, failed, bounced, pending,
        successRate: total > 0 ? Math.round((dispatched / total) * 1000) / 10 : 0,
        bounceRate: total > 0 ? Math.round((bounced / total) * 1000) / 10 : 0
      }
    })

    // Platform rollup by channel
    const channelTotals = new Map<string, { total: number; delivered: number; sent: number; failed: number; bounced: number; pending: number }>()
    for (const r of byOrg) {
      const ex = channelTotals.get(r.channel) || { total: 0, delivered: 0, sent: 0, failed: 0, bounced: 0, pending: 0 }
      channelTotals.set(r.channel, {
        total: ex.total + r.total,
        delivered: ex.delivered + r.delivered,
        sent: ex.sent + r.sent,
        failed: ex.failed + r.failed,
        bounced: ex.bounced + r.bounced,
        pending: ex.pending + r.pending
      })
    }
    const byChannel = Array.from(channelTotals.entries()).map(([channel, t]) => ({
      channel, ...t,
      successRate: t.total > 0 ? Math.round(((t.delivered + t.sent) / t.total) * 1000) / 10 : 0,
      bounceRate: t.total > 0 ? Math.round((t.bounced / t.total) * 1000) / 10 : 0
    }))

    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'view_communications_stats', 'communication_logs', undefined, { period }, ip, ua)

    return c.json({ period: { start: toDateStr(start), end: toDateStr(end) }, byChannel, byOrganization: byOrg })
  } catch (error) {
    logger.error('Error fetching communication stats', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch communication stats'
    return c.json({ error: message }, 500)
  }
})

interface SmsThreadRow {
  id: string
  organization_id: string
  health_check_id: string | null
  customer_id: string | null
  direction: string
  from_number: string
  to_number: string
  body: string
  twilio_status: string | null
  is_read: boolean
  created_at: string
  organizations: { name: string }[] | { name: string } | null
}

/**
 * GET /api/v1/admin/communications/sms-threads
 * Paginated two-way SMS message view.
 */
adminUsage.get('/communications/sms-threads', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { organization_id, direction, from, to, page = '1', limit = '50' } = c.req.query()

  try {
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    let query = supabaseAdmin
      .from('sms_messages')
      .select(`
        id, organization_id, health_check_id, customer_id, direction,
        from_number, to_number, body, twilio_status, is_read, created_at,
        organizations!inner(name)
      `, { count: 'exact' })

    if (organization_id) query = query.eq('organization_id', organization_id)
    if (direction) query = query.eq('direction', direction)
    if (from) query = query.gte('created_at', new Date(from).toISOString())
    if (to) query = query.lte('created_at', new Date(to).toISOString())

    query = query.order('created_at', { ascending: false }).range(offset, offset + limitNum - 1)

    const { data, error, count } = await query
    if (error) throw new Error(`Failed to fetch SMS threads: ${error.message}`)

    const messages = ((data as SmsThreadRow[] | null) || []).map((m) => ({
      id: m.id,
      organizationId: m.organization_id,
      organizationName: orgName(m.organizations),
      healthCheckId: m.health_check_id,
      customerId: m.customer_id,
      direction: m.direction,
      fromNumber: m.from_number,
      toNumber: m.to_number,
      body: m.body,
      status: m.twilio_status,
      isRead: m.is_read,
      createdAt: m.created_at
    }))

    const total = count || 0
    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'view_sms_threads', 'sms_messages', undefined, { filters: { organization_id, direction }, page: pageNum }, ip, ua)

    return c.json({ messages, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
  } catch (error) {
    logger.error('Error fetching SMS threads', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch SMS threads'
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /api/v1/admin/communications/export?format=csv
 * CSV of communication_logs (filters as per /logs), paged internally to avoid
 * the PostgREST row cap.
 */
adminUsage.get('/communications/export', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { organization_id, channel, status, from, to } = c.req.query()
  const format = c.req.query('format') || 'csv'
  if (format !== 'csv') return c.json({ error: 'Only CSV format is currently supported' }, 400)

  try {
    const batchSize = 1000
    let offset = 0
    const all: CommLogRow[] = []
    // Page internally until a short batch is returned (never assumes < 1000 rows).
    for (;;) {
      let query = supabaseAdmin
        .from('communication_logs')
        .select(`
          id, organization_id, channel, recipient, status, external_id,
          error_message, created_at, organizations(name)
        `)
      if (organization_id) query = query.eq('organization_id', organization_id)
      if (channel) query = query.eq('channel', channel)
      if (status) query = query.eq('status', status)
      if (from) query = query.gte('created_at', new Date(from).toISOString())
      if (to) query = query.lte('created_at', new Date(to).toISOString())
      query = query.order('created_at', { ascending: false }).range(offset, offset + batchSize - 1)

      const { data, error } = await query
      if (error) throw new Error(`Failed to fetch communication logs: ${error.message}`)
      const batch = (data as CommLogRow[] | null) || []
      all.push(...batch)
      if (batch.length < batchSize || all.length >= 50000) break
      offset += batchSize
    }

    const headers = ['date', 'organization', 'channel', 'recipient', 'status', 'provider_id', 'error']
    const rows = all.map((l) => [
      new Date(l.created_at).toISOString(),
      `"${orgName(l.organizations).replace(/"/g, '""')}"`,
      l.channel,
      `"${(l.recipient || '').replace(/"/g, '""')}"`,
      l.status,
      `"${(l.external_id || '').replace(/"/g, '""')}"`,
      `"${(l.error_message || '').replace(/"/g, '""')}"`
    ].join(','))
    const csv = [headers.join(','), ...rows].join('\n')

    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'export_communications', 'communication_logs', undefined, { filters: { organization_id, channel, status, from, to }, rowCount: rows.length }, ip, ua)

    const filename = `communications-${toDateStr(new Date())}.csv`
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` }
    })
  } catch (error) {
    logger.error('Error exporting communications', { error })
    const message = error instanceof Error ? error.message : 'Failed to export communications'
    return c.json({ error: message }, 500)
  }
})

// =============================================================================
// UNROUTED INBOUND SMS (shared-number quarantine queue)
// =============================================================================

interface UnroutedRow {
  id: string
  health_check_id: string | null
  customer_id: string | null
  from_number: string
  to_number: string
  body: string
  twilio_status: string | null
  is_read: boolean
  created_at: string
  metadata: { routing?: { status?: string; candidate_org_ids?: string[] } } | null
}

/**
 * GET /api/v1/admin/communications/unrouted
 * Inbound SMS that could not be confidently attributed to a tenant (organization_id IS NULL).
 * These arrive on the shared platform number when recency + customer-phone matching is
 * ambiguous or the sender is unknown. Surfaced here for manual reassignment.
 */
adminUsage.get('/communications/unrouted', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { page = '1', limit = '50' } = c.req.query()

  try {
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    const { data, error, count } = await supabaseAdmin
      .from('sms_messages')
      .select(`
        id, health_check_id, customer_id, from_number, to_number,
        body, twilio_status, is_read, created_at, metadata
      `, { count: 'exact' })
      .eq('direction', 'inbound')
      .is('organization_id', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1)

    if (error) throw new Error(`Failed to fetch unrouted messages: ${error.message}`)

    const messages = ((data as UnroutedRow[] | null) || []).map((m) => ({
      id: m.id,
      fromNumber: m.from_number,
      toNumber: m.to_number,
      body: m.body,
      status: m.twilio_status,
      isRead: m.is_read,
      createdAt: m.created_at,
      routingStatus: m.metadata?.routing?.status || 'unrouted_unknown',
      candidateOrgIds: m.metadata?.routing?.candidate_org_ids || []
    }))

    const total = count || 0
    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'view_unrouted_sms', 'sms_messages', undefined, { page: pageNum }, ip, ua)

    return c.json({ messages, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
  } catch (error) {
    logger.error('Error fetching unrouted messages', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch unrouted messages'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/v1/admin/communications/unrouted/:id/reassign
 * Manually attribute a quarantined inbound SMS to an organization. Resolves the customer
 * by the sender number within that org when possible, clears the quarantine flag, and emits
 * to the org so it appears live on their Messages page.
 */
adminUsage.post('/communications/unrouted/:id/reassign', async (c) => {
  const superAdmin = c.get('superAdmin')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { organization_id?: string }
  const organizationId = body.organization_id

  if (!organizationId) return c.json({ error: 'organization_id is required' }, 400)

  try {
    const { data: msg } = await supabaseAdmin
      .from('sms_messages')
      .select('id, from_number, to_number, body, twilio_sid, twilio_status, is_read, created_at, metadata, organization_id, direction')
      .eq('id', id)
      .maybeSingle()

    if (!msg) return c.json({ error: 'Message not found' }, 404)
    if (msg.organization_id) return c.json({ error: 'Message is already routed to an organization' }, 409)

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('id', organizationId)
      .maybeSingle()
    if (!org) return c.json({ error: 'Organization not found' }, 404)

    // Best-effort: resolve the customer by the sender number within the target org
    // (reuses the same matcher the live inbound-routing path uses).
    const customerMatches = await findCustomerMatches(phoneVariants(formatPhoneNumber(msg.from_number)), [organizationId])
    const customerId: string | null = customerMatches[0]?.customerId ?? null

    const existingMeta = (msg.metadata || {}) as Record<string, unknown>
    const existingRouting = (existingMeta.routing || {}) as Record<string, unknown>
    const newMeta = {
      ...existingMeta,
      routing: {
        ...existingRouting,
        status: 'manually_routed',
        reassigned_by: superAdmin.id,
        reassigned_at: new Date().toISOString()
      }
    }

    const { error: updateErr } = await supabaseAdmin
      .from('sms_messages')
      .update({ organization_id: organizationId, customer_id: customerId, metadata: newMeta })
      .eq('id', id)

    if (updateErr) throw new Error(`Failed to reassign message: ${updateErr.message}`)

    // Surface it live on the org's Messages page.
    emitToOrganization(organizationId, WS_EVENTS.SMS_RECEIVED, {
      message: {
        id: msg.id,
        direction: 'inbound',
        from_number: msg.from_number,
        to_number: msg.to_number,
        body: msg.body,
        twilio_sid: msg.twilio_sid,
        twilio_status: msg.twilio_status,
        is_read: false,
        created_at: msg.created_at,
        health_check_id: null,
        customer_id: customerId
      }
    })

    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'reassign_unrouted_sms', 'sms_messages', id, { organizationId, customerMatched: !!customerId }, ip, ua)

    return c.json({ success: true, organizationId, customerId })
  } catch (error) {
    logger.error('Error reassigning unrouted message', { error })
    const message = error instanceof Error ? error.message : 'Failed to reassign message'
    return c.json({ error: message }, 500)
  }
})

export default adminUsage
