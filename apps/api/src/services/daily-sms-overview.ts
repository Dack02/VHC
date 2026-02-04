/**
 * Daily SMS Overview Service
 * Calculates per-site VHC metrics and sends daily SMS summaries to configured recipients
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { sendSms } from './sms.js'

export interface SiteMetrics {
  totalHCs: number
  completedHCs: number
  completionRate: number
  sentToCustomer: number
  redIdentifiedValue: number   // £ total of all red repair items
  redSoldValue: number         // £ total of authorized red repair items
  redSoldPercent: number       // redSoldValue / redIdentifiedValue * 100
}

/**
 * Calculate site metrics for a date range
 * Uses dual-date pattern (due_date + created_at fallback) consistent with reports.ts
 */
export async function calculateSiteMetrics(
  orgId: string,
  siteId: string,
  startDate: string,
  endDate: string
): Promise<SiteMetrics> {
  const mainSelect = `
    id,
    status,
    created_at,
    due_date,
    sent_at,
    repair_items(id, rag_status, total_inc_vat, customer_approved, outcome_status, deleted_at, parent_repair_item_id)
  `

  // Dual-date query: HCs with due_date in range
  const dueDateQ = supabaseAdmin
    .from('health_checks')
    .select(mainSelect)
    .eq('organization_id', orgId)
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .gte('due_date', startDate)
    .lte('due_date', endDate)

  // HCs without due_date, using created_at
  const createdAtQ = supabaseAdmin
    .from('health_checks')
    .select(mainSelect)
    .eq('organization_id', orgId)
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .is('due_date', null)
    .gte('created_at', startDate)
    .lte('created_at', endDate)

  const [ddRes, caRes] = await Promise.all([dueDateQ, createdAtQ])

  if (ddRes.error) throw new Error(`Metrics query error: ${ddRes.error.message}`)
  if (caRes.error) throw new Error(`Metrics query error: ${caRes.error.message}`)

  // Deduplicate
  const hcMap = new Map<string, (typeof ddRes.data)[0]>()
  for (const hc of [...(ddRes.data || []), ...(caRes.data || [])]) {
    if (!hcMap.has(hc.id)) hcMap.set(hc.id, hc)
  }
  const healthChecks = Array.from(hcMap.values())

  const totalHCs = healthChecks.length

  // Completed = HCs past the inspection stage (sent, authorized, declined, closed, etc.)
  const completionStatuses = [
    'inspection_complete', 'pricing_pending', 'pricing_in_progress', 'pricing_complete',
    'advisor_review', 'customer_pending', 'customer_viewed',
    'customer_approved', 'customer_partial', 'customer_declined',
    'work_authorized', 'work_in_progress', 'work_complete',
    'closed', 'archived'
  ]
  const completedHCs = healthChecks.filter(hc => completionStatuses.includes(hc.status)).length
  const completionRate = totalHCs > 0 ? Math.round((completedHCs / totalHCs) * 100) : 0

  // Sent to customer
  const sentToCustomer = healthChecks.filter(hc => hc.sent_at !== null).length

  // Red identified £ - total value of all red repair items
  let redIdentifiedValue = 0
  // Red sold £ - total value of authorized red repair items
  let redSoldValue = 0

  for (const hc of healthChecks) {
    const items = hc.repair_items as any[] | null
    if (!items) continue
    for (const item of items) {
      if (item.deleted_at) continue
      if (item.parent_repair_item_id) continue // skip children
      if (item.rag_status !== 'red') continue

      const value = Number(item.total_inc_vat) || 0
      redIdentifiedValue += value

      if (item.customer_approved === true || item.outcome_status === 'authorised') {
        redSoldValue += value
      }
    }
  }

  const redSoldPercent = redIdentifiedValue > 0 ? Math.round((redSoldValue / redIdentifiedValue) * 100) : 0

  return {
    totalHCs,
    completedHCs,
    completionRate,
    sentToCustomer,
    redIdentifiedValue,
    redSoldValue,
    redSoldPercent
  }
}

/**
 * Compose the SMS message for a site
 */
export function composeSmsMessage(
  siteName: string,
  date: Date,
  todayMetrics: SiteMetrics,
  mtdMetrics: SiteMetrics
): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  const dateStr = `${dd}/${mm}/${yyyy}`

  const fmt = (v: number) => `£${v.toFixed(2)}`

  return [
    `VHC Daily - ${siteName}`,
    dateStr,
    '',
    'Today:',
    `Completion: ${todayMetrics.completionRate}% (${todayMetrics.completedHCs}/${todayMetrics.totalHCs})`,
    `Sent: ${todayMetrics.sentToCustomer} | Red: ${fmt(todayMetrics.redIdentifiedValue)}`,
    `Red Sold: ${fmt(todayMetrics.redSoldValue)} (${todayMetrics.redSoldPercent}%)`,
    '',
    'MTD:',
    `Completion: ${mtdMetrics.completionRate}% (${mtdMetrics.completedHCs}/${mtdMetrics.totalHCs})`,
    `Sent: ${mtdMetrics.sentToCustomer} | Red: ${fmt(mtdMetrics.redIdentifiedValue)}`,
    `Red Sold: ${fmt(mtdMetrics.redSoldValue)} (${mtdMetrics.redSoldPercent}%)`
  ].join('\n')
}

/**
 * Send the daily SMS overview for an organization
 */
export async function sendDailySmsOverview(organizationId: string): Promise<void> {
  console.log(`[Daily SMS Overview] Starting for org ${organizationId}`)

  // 1. Fetch active recipients
  const { data: recipients, error: recipError } = await supabaseAdmin
    .from('daily_sms_overview_recipients')
    .select('id, name, phone_number, site_id')
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  if (recipError) {
    console.error('[Daily SMS Overview] Error fetching recipients:', recipError)
    return
  }

  if (!recipients || recipients.length === 0) {
    console.log('[Daily SMS Overview] No active recipients, skipping')
    return
  }

  // 2. Fetch org's sites
  const { data: sites, error: sitesError } = await supabaseAdmin
    .from('sites')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  if (sitesError || !sites || sites.length === 0) {
    console.error('[Daily SMS Overview] Error fetching sites:', sitesError)
    return
  }

  // 3. Group recipients by site_id
  const recipientsBySite = new Map<string | null, typeof recipients>()
  for (const r of recipients) {
    const key = r.site_id
    if (!recipientsBySite.has(key)) {
      recipientsBySite.set(key, [])
    }
    recipientsBySite.get(key)!.push(r)
  }

  // 4. Calculate date ranges
  const now = new Date()
  // Today: start of day to end of day (in London time)
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now)
  todayEnd.setHours(23, 59, 59, 999)

  // MTD: first of current month to now
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1)
  mtdStart.setHours(0, 0, 0, 0)

  const todayStartStr = todayStart.toISOString()
  const todayEndStr = todayEnd.toISOString()
  const mtdStartStr = mtdStart.toISOString()

  // 5. For each site, calculate metrics and send to relevant recipients
  for (const site of sites) {
    // Determine recipients for this site
    const siteRecipients = [
      ...(recipientsBySite.get(site.id) || []),    // Recipients assigned to this site
      ...(recipientsBySite.get(null) || [])          // Recipients for all sites
    ]

    if (siteRecipients.length === 0) continue

    try {
      const [todayMetrics, mtdMetrics] = await Promise.all([
        calculateSiteMetrics(organizationId, site.id, todayStartStr, todayEndStr),
        calculateSiteMetrics(organizationId, site.id, mtdStartStr, todayEndStr)
      ])

      const message = composeSmsMessage(site.name, now, todayMetrics, mtdMetrics)

      // Send to each recipient
      for (const recipient of siteRecipients) {
        try {
          const result = await sendSms(recipient.phone_number, message, organizationId)
          if (result.success) {
            console.log(`[Daily SMS Overview] Sent to ${recipient.name} (${recipient.phone_number}) for site ${site.name}`)
          } else {
            console.error(`[Daily SMS Overview] Failed to send to ${recipient.name}: ${result.error}`)
          }
        } catch (err) {
          console.error(`[Daily SMS Overview] Error sending to ${recipient.name}:`, err)
        }
      }
    } catch (err) {
      console.error(`[Daily SMS Overview] Error calculating metrics for site ${site.name}:`, err)
    }
  }

  console.log(`[Daily SMS Overview] Completed for org ${organizationId}`)
}
