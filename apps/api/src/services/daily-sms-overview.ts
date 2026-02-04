/**
 * Daily SMS Overview Service
 * Calculates per-site VHC metrics and sends daily SMS summaries to configured recipients
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { sendSms } from './sms.js'

export interface SiteMetrics {
  jobsQty: number              // Total health checks
  noShows: number              // HCs with status='no_show'
  hcQty: number                // Completed HCs (tech_completed_at set)
  conversionRate: number       // hcQty / (jobsQty - noShows) * 100
  totalIdentified: number      // £ total of all repair items
  totalSold: number            // £ total of authorized repair items
  mriIdentified: number        // £ total of MRI scan items
  mriSold: number              // £ total of authorized MRI items
  redSoldPercent: number       // red sold / red identified * 100
  amberSoldPercent: number     // amber sold / amber identified * 100
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
    tech_completed_at,
    repair_items(id, rag_status, total_inc_vat, customer_approved, outcome_status, deleted_at, parent_repair_item_id, source, is_group, check_results:repair_item_check_results(check_result:check_results(rag_status)))
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

  // Query 3: Find HC IDs where items were authorized/actioned in the date range
  // This captures sales from HCs booked on previous days
  const outcomeDateQ = supabaseAdmin
    .from('repair_items')
    .select('health_check_id, health_check:health_checks!inner(organization_id, site_id)')
    .gte('outcome_set_at', startDate)
    .lt('outcome_set_at', endDate)
    .eq('health_check.organization_id', orgId)
    .eq('health_check.site_id', siteId)

  const [ddRes, caRes, outcomeRes] = await Promise.all([dueDateQ, createdAtQ, outcomeDateQ])

  if (ddRes.error) throw new Error(`Metrics query error: ${ddRes.error.message}`)
  if (caRes.error) throw new Error(`Metrics query error: ${caRes.error.message}`)
  if (outcomeRes.error) {
    console.error('SMS overview outcome_set_at query error:', outcomeRes.error)
    // Non-fatal: continue without these HCs
  }

  // Deduplicate
  const hcMap = new Map<string, (typeof ddRes.data)[0]>()
  for (const hc of [...(ddRes.data || []), ...(caRes.data || [])]) {
    if (!hcMap.has(hc.id)) hcMap.set(hc.id, hc)
  }

  // Fetch full HC data for any outcome-date HCs not already in the map
  const outcomeDateHcIds = [...new Set(
    (outcomeRes.data || []).map((r: { health_check_id: string }) => r.health_check_id)
  )].filter(id => !hcMap.has(id))

  if (outcomeDateHcIds.length > 0) {
    const { data: actionedHcs, error: actionedError } = await supabaseAdmin
      .from('health_checks')
      .select(mainSelect)
      .in('id', outcomeDateHcIds)
      .is('deleted_at', null)

    if (actionedError) {
      console.error('SMS overview actioned HC query error:', actionedError)
    } else if (actionedHcs) {
      for (const hc of actionedHcs) {
        if (!hcMap.has(hc.id)) hcMap.set(hc.id, hc)
      }
    }
  }

  const healthChecks = Array.from(hcMap.values())

  const jobsQty = healthChecks.length

  // No shows and completed HCs (using tech_completed_at, matching reports.ts)
  let noShows = 0
  let hcQty = 0
  for (const hc of healthChecks) {
    if (hc.status === 'no_show') {
      noShows++
    } else if (hc.tech_completed_at) {
      hcQty++
    }
  }

  const eligible = jobsQty - noShows
  const conversionRate = eligible > 0
    ? Math.round((hcQty / eligible) * 100 * 10) / 10
    : 0

  // Helper to derive effective rag_status (matches reports.ts pattern)
  function deriveRagStatus(item: any): 'red' | 'amber' | null {
    if (item.source === 'mri_scan' && item.rag_status) {
      return item.rag_status as 'red' | 'amber'
    }
    if (item.rag_status) {
      return item.rag_status as 'red' | 'amber'
    }
    let derived: 'red' | 'amber' | null = null
    for (const link of item.check_results || []) {
      const cr = link?.check_result as { rag_status?: string } | null
      if (cr?.rag_status === 'red') return 'red'
      if (cr?.rag_status === 'amber') derived = 'amber'
    }
    return derived
  }

  const isItemAuthorised = (item: any) =>
    item.customer_approved === true || item.outcome_status === 'authorised'

  let totalIdentified = 0
  let totalSold = 0
  let mriIdentified = 0
  let mriSold = 0
  let redIdentified = 0
  let redSold = 0
  let amberIdentified = 0
  let amberSold = 0

  for (const hc of healthChecks) {
    const items = hc.repair_items as any[] | null
    if (!items) continue

    // Build children-by-parent map for group authorization
    const childrenByParent = new Map<string, any[]>()
    for (const item of items) {
      if (item.parent_repair_item_id) {
        const children = childrenByParent.get(item.parent_repair_item_id) || []
        children.push(item)
        childrenByParent.set(item.parent_repair_item_id, children)
      }
    }

    for (const item of items) {
      if (item.deleted_at) continue
      if (item.parent_repair_item_id) continue // skip children

      const value = Number(item.total_inc_vat) || 0
      const rag = deriveRagStatus(item)

      // Totals (all items regardless of RAG)
      totalIdentified += value

      // Check authorization with group handling
      let authorised = isItemAuthorised(item)
      let authorisedValue = value

      if (item.is_group && !authorised) {
        const children = childrenByParent.get(item.id) || []
        const authorisedChildren = children.filter((c: any) => !c.deleted_at && isItemAuthorised(c))
        if (authorisedChildren.length > 0) {
          authorised = true
          authorisedValue = authorisedChildren.reduce((sum: number, child: any) => sum + (Number(child.total_inc_vat) || 0), 0)
        }
      }

      if (authorised) {
        totalSold += authorisedValue
      }

      // MRI tracking
      if (item.source === 'mri_scan') {
        mriIdentified += value
        if (authorised) {
          mriSold += authorisedValue
        }
      }

      // RAG-specific tracking
      if (rag === 'red') {
        redIdentified += value
        if (authorised) {
          redSold += authorisedValue
        }
      } else if (rag === 'amber') {
        amberIdentified += value
        if (authorised) {
          amberSold += authorisedValue
        }
      }
    }
  }

  const redSoldPercent = redIdentified > 0
    ? Math.round((redSold / redIdentified) * 100 * 10) / 10
    : 0
  const amberSoldPercent = amberIdentified > 0
    ? Math.round((amberSold / amberIdentified) * 100 * 10) / 10
    : 0

  return {
    jobsQty,
    noShows,
    hcQty,
    conversionRate,
    totalIdentified: Math.round(totalIdentified * 100) / 100,
    totalSold: Math.round(totalSold * 100) / 100,
    mriIdentified: Math.round(mriIdentified * 100) / 100,
    mriSold: Math.round(mriSold * 100) / 100,
    redSoldPercent,
    amberSoldPercent
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

  const fmt = (v: number) => `£${Math.round(v)}`

  const metricsBlock = (m: SiteMetrics) => [
    `Jobs: ${m.jobsQty} | NS: ${m.noShows} | HCs: ${m.hcQty}`,
    `Conv: ${m.conversionRate}%`,
    `Id: ${fmt(m.totalIdentified)} | Sold: ${fmt(m.totalSold)}`,
    `MRI Id: ${fmt(m.mriIdentified)} | Sold: ${fmt(m.mriSold)}`,
    `Red: ${m.redSoldPercent}% | Amber: ${m.amberSoldPercent}%`
  ]

  return [
    `VHC Daily - ${siteName}`,
    dateStr,
    '',
    'Today:',
    ...metricsBlock(todayMetrics),
    '',
    'MTD:',
    ...metricsBlock(mtdMetrics)
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
