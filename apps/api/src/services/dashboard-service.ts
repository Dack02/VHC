/**
 * Dashboard data services.
 *
 * Each function fetches + computes one dashboard zone so the individual
 * endpoints and the consolidated /dashboard/overview endpoint share one
 * implementation (and therefore one set of numbers).
 */
import { supabaseAdmin } from '../lib/supabase.js'
import {
  aggregateRepairItemsByHc,
  computeHcConversion,
  soldPct,
  type HcItemsAgg
} from '../lib/metrics.js'
import { fetchPeriodHcSet, fetchRepairItemsForHcs } from './hc-period-service.js'

// Status groups for board columns
// Note: 'awaiting_arrival' is handled separately in Dashboard (not part of main kanban flow)
export const statusGroups = {
  technician: ['created', 'assigned', 'in_progress', 'paused'],
  tech_done: ['tech_completed', 'awaiting_review', 'awaiting_pricing', 'awaiting_parts'],
  advisor: ['ready_to_send'],
  customer: ['sent', 'delivered', 'opened', 'partial_response'],
  actioned: ['authorized', 'declined', 'completed', 'expired', 'cancelled', 'no_show']
}

// Statuses where a promised-time breach is NOT actionable from the dashboard:
// vehicle never arrived (awaiting_arrival/no_show) or the HC reached a terminal state.
const OVERDUE_EXCLUDED_STATUSES = ['completed', 'cancelled', 'expired', 'no_show', 'awaiting_arrival']
// Link expiry only matters while the link is with the customer
const CUSTOMER_STATUSES = ['sent', 'delivered', 'opened', 'partial_response']

export interface DashboardFilters {
  orgId: string
  siteId?: string
  technicianId?: string
  advisorId?: string
}

interface PeriodHc {
  id: string
  status: string
  created_at: string
  sent_at: string | null
  first_opened_at: string | null
  technician_id: string | null
  advisor_id: string | null
  promised_at: string | null
}

// fetchPeriodHcSet + fetchRepairItemsForHcs now live in ./hc-period-service.ts
// (shared with the reports endpoints) and are imported at the top of this file.

export interface SummaryMetrics {
  metrics: {
    totalToday: number
    completedToday: number
    conversionRate: number
    presentedCount: number
    convertedCount: number
    avgResponseTimeMinutes: number
    totalValueSent: number
    totalValueAuthorized: number
    totalValueDeclined: number
  }
  statusCounts: Record<string, number>
  period: { from: string; to: string }
}

/** Period-scoped headline metrics (the top KPI cards). */
export async function getSummaryMetrics(
  filters: DashboardFilters,
  startDate: string,
  endDate: string
): Promise<SummaryMetrics> {
  const healthChecks = (await fetchPeriodHcSet(
    filters,
    startDate,
    endDate,
    'id, status, created_at, sent_at, first_opened_at, technician_id, advisor_id, promised_at'
  )) as unknown as PeriodHc[]

  const { items, optionTotalsMap } = await fetchRepairItemsForHcs(healthChecks.map(hc => hc.id))
  const aggByHc = aggregateRepairItemsByHc(items, optionTotalsMap)

  const totalToday = healthChecks.length
  const completedToday = healthChecks.filter(hc => ['completed', 'authorized', 'declined'].includes(hc.status)).length

  const statusCounts: Record<string, number> = {}
  for (const hc of healthChecks) {
    statusCounts[hc.status] = (statusCounts[hc.status] || 0) + 1
  }

  // Time from sending the link to the customer first opening it
  const responseTimes = healthChecks
    .filter(hc => hc.sent_at && hc.first_opened_at)
    .map(hc => new Date(hc.first_opened_at!).getTime() - new Date(hc.sent_at!).getTime())
  const avgResponseTimeMs = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : 0

  let totalValueSent = 0
  let totalValueAuthorized = 0
  let totalValueDeclined = 0
  for (const hc of healthChecks) {
    const agg = aggByHc.get(hc.id)
    if (!agg) continue
    if (hc.sent_at) totalValueSent += agg.identifiedTotal
    totalValueAuthorized += agg.authorisedTotal
    totalValueDeclined += agg.declinedTotal
  }

  const conversion = computeHcConversion(healthChecks, aggByHc)

  return {
    metrics: {
      totalToday,
      completedToday,
      conversionRate: conversion.conversionRate,
      presentedCount: conversion.presentedCount,
      convertedCount: conversion.convertedCount,
      avgResponseTimeMinutes: Math.round(avgResponseTimeMs / (1000 * 60)),
      totalValueSent,
      totalValueAuthorized,
      totalValueDeclined
    },
    statusCounts,
    period: { from: startDate, to: endDate }
  }
}

export interface BoardState {
  columnCounts: {
    technician: number
    tech_done: number
    advisor: number
    customer: number
    actioned: number
  }
  alerts: {
    overdueCount: number
    expiringLinksCount: number
  }
}

/** Org-wide current workflow state (column counts) and alert counts. */
export async function getBoardState(filters: DashboardFilters): Promise<BoardState> {
  let activeQuery = supabaseAdmin
    .from('health_checks')
    .select('id, status, promised_at, token_expires_at')
    .eq('organization_id', filters.orgId)
    .is('deleted_at', null)
    .not('status', 'in', '(completed,cancelled,expired)')

  if (filters.siteId) activeQuery = activeQuery.eq('site_id', filters.siteId)
  if (filters.technicianId) activeQuery = activeQuery.eq('technician_id', filters.technicianId)
  if (filters.advisorId) activeQuery = activeQuery.eq('advisor_id', filters.advisorId)

  const { data: activeHealthChecks, error } = await activeQuery
  if (error) throw error

  const active = activeHealthChecks || []
  const now = new Date()
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const columnCounts = {
    technician: active.filter(hc => statusGroups.technician.includes(hc.status)).length,
    tech_done: active.filter(hc => statusGroups.tech_done.includes(hc.status)).length,
    advisor: active.filter(hc => statusGroups.advisor.includes(hc.status)).length,
    customer: active.filter(hc => statusGroups.customer.includes(hc.status)).length,
    actioned: active.filter(hc => statusGroups.actioned.includes(hc.status)).length
  }

  const overdueCount = active.filter(hc =>
    !OVERDUE_EXCLUDED_STATUSES.includes(hc.status) &&
    hc.promised_at && new Date(hc.promised_at) < now
  ).length

  const expiringLinksCount = active.filter(hc =>
    CUSTOMER_STATUSES.includes(hc.status) &&
    hc.token_expires_at &&
    new Date(hc.token_expires_at) < in24Hours &&
    new Date(hc.token_expires_at) > now
  ).length

  return { columnCounts, alerts: { overdueCount, expiringLinksCount } }
}

export interface QueueItemRow extends Record<string, unknown> {
  id: string
  status: string
  promised_at: string | null
  token_expires_at: string | null
}

export interface QueuesData {
  needsAttention: { items: Record<string, unknown>[]; total: number }
  technicianQueue: { items: Record<string, unknown>[]; total: number }
  advisorQueue: { items: Record<string, unknown>[]; total: number }
  customerQueue: { items: Record<string, unknown>[]; total: number }
}

/** Queue summaries for the dashboard panels. */
export async function getQueues(filters: DashboardFilters): Promise<QueuesData> {
  let baseQuery = supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      jobsheet_id,
      status,
      promised_at,
      token_expires_at,
      created_at,
      vehicle:vehicles(registration, make, model),
      customer:customers(first_name, last_name),
      technician:users!health_checks_technician_id_fkey(first_name, last_name),
      advisor:users!health_checks_advisor_id_fkey(first_name, last_name)
    `)
    .eq('organization_id', filters.orgId)
    .is('deleted_at', null)
    .not('status', 'in', '(completed,cancelled,expired)')

  if (filters.siteId) baseQuery = baseQuery.eq('site_id', filters.siteId)

  const { data: healthChecks, error } = await baseQuery
  if (error) throw error

  const all = (healthChecks || []) as unknown as QueueItemRow[]
  const now = new Date()
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const needsAttention = all
    .filter(hc => {
      const isOverdue =
        !OVERDUE_EXCLUDED_STATUSES.includes(hc.status) &&
        hc.promised_at && new Date(hc.promised_at) < now
      const isExpiring =
        CUSTOMER_STATUSES.includes(hc.status) &&
        hc.token_expires_at &&
        new Date(hc.token_expires_at) < in24Hours &&
        new Date(hc.token_expires_at) > now
      return isOverdue || isExpiring
    })
    .map(hc => ({
      ...hc,
      alertType:
        !OVERDUE_EXCLUDED_STATUSES.includes(hc.status) && hc.promised_at && new Date(hc.promised_at) < now
          ? 'overdue'
          : 'expiring'
    }))

  const technicianQueue = all.filter(hc => statusGroups.technician.includes(hc.status))
  const advisorQueue = all.filter(hc =>
    statusGroups.tech_done.includes(hc.status) || statusGroups.advisor.includes(hc.status)
  )
  const customerQueue = all.filter(hc => statusGroups.customer.includes(hc.status))

  return {
    needsAttention: { items: needsAttention.slice(0, 10), total: needsAttention.length },
    technicianQueue: { items: technicianQueue.slice(0, 10), total: technicianQueue.length },
    advisorQueue: { items: advisorQueue.slice(0, 10), total: advisorQueue.length },
    customerQueue: { items: customerQueue.slice(0, 10), total: customerQueue.length }
  }
}

export interface TechnicianWorkloadData {
  technicians: Array<{
    id: string
    firstName: string
    lastName: string
    siteId: string | null
    status: 'working' | 'available' | 'idle'
    currentJob: { id: string; jobsheetId: string | null; vehicle: unknown; timeElapsedMinutes: number } | null
    queueCount: number
    completedToday: number
    isClockedIn: boolean
  }>
  summary: { total: number; working: number; available: number; idle: number }
}

/**
 * Technician workload, batched: 5 queries total instead of 4 per technician.
 * "Completed today" counts inspections by tech_completed_at (not updated_at,
 * which re-counted old jobs whenever any field changed).
 */
export async function getTechnicianWorkload(filters: DashboardFilters): Promise<TechnicianWorkloadData> {
  let techQuery = supabaseAdmin
    .from('users')
    .select('id, first_name, last_name, site_id')
    .eq('organization_id', filters.orgId)
    .eq('role', 'technician')
    .eq('is_active', true)

  if (filters.siteId) techQuery = techQuery.eq('site_id', filters.siteId)

  const { data: technicians, error: techError } = await techQuery
  if (techError) throw techError

  const techs = technicians || []
  if (techs.length === 0) {
    return { technicians: [], summary: { total: 0, working: 0, available: 0, idle: 0 } }
  }
  const techIds = techs.map(t => t.id)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayISO = today.toISOString()

  const [currentJobsRes, openEntriesRes, queueRes, completedRes] = await Promise.all([
    supabaseAdmin
      .from('health_checks')
      .select('id, jobsheet_id, technician_id, created_at, vehicle:vehicles(registration, make, model)')
      .eq('organization_id', filters.orgId)
      .in('technician_id', techIds)
      .eq('status', 'in_progress')
      .is('deleted_at', null),
    supabaseAdmin
      .from('technician_time_entries')
      .select('id, technician_id, clock_in_at')
      .in('technician_id', techIds)
      .is('clock_out_at', null),
    supabaseAdmin
      .from('health_checks')
      .select('id, technician_id')
      .eq('organization_id', filters.orgId)
      .in('technician_id', techIds)
      .eq('status', 'assigned')
      .is('deleted_at', null),
    supabaseAdmin
      .from('health_checks')
      .select('id, technician_id')
      .eq('organization_id', filters.orgId)
      .in('technician_id', techIds)
      .is('deleted_at', null)
      .gte('tech_completed_at', todayISO)
  ])

  const currentJobByTech = new Map<string, { id: string; jobsheetId: string | null; vehicle: unknown }>()
  for (const job of currentJobsRes.data || []) {
    if (job.technician_id && !currentJobByTech.has(job.technician_id)) {
      currentJobByTech.set(job.technician_id, { id: job.id, jobsheetId: job.jobsheet_id ?? null, vehicle: job.vehicle })
    }
  }

  const openEntryByTech = new Map<string, { clock_in_at: string }>()
  for (const entry of openEntriesRes.data || []) {
    if (entry.technician_id && !openEntryByTech.has(entry.technician_id)) {
      openEntryByTech.set(entry.technician_id, { clock_in_at: entry.clock_in_at })
    }
  }

  const queueCountByTech = new Map<string, number>()
  for (const hc of queueRes.data || []) {
    if (hc.technician_id) {
      queueCountByTech.set(hc.technician_id, (queueCountByTech.get(hc.technician_id) || 0) + 1)
    }
  }

  const completedByTech = new Map<string, number>()
  for (const hc of completedRes.data || []) {
    if (hc.technician_id) {
      completedByTech.set(hc.technician_id, (completedByTech.get(hc.technician_id) || 0) + 1)
    }
  }

  const workloadData = techs.map(tech => {
    const currentJob = currentJobByTech.get(tech.id) || null
    const openEntry = openEntryByTech.get(tech.id) || null
    const timeElapsedMinutes = openEntry
      ? Math.round((Date.now() - new Date(openEntry.clock_in_at).getTime()) / (1000 * 60))
      : 0

    return {
      id: tech.id,
      firstName: tech.first_name,
      lastName: tech.last_name,
      siteId: tech.site_id,
      status: (currentJob ? 'working' : openEntry ? 'available' : 'idle') as 'working' | 'available' | 'idle',
      currentJob: currentJob ? { ...currentJob, timeElapsedMinutes } : null,
      queueCount: queueCountByTech.get(tech.id) || 0,
      completedToday: completedByTech.get(tech.id) || 0,
      isClockedIn: !!openEntry
    }
  })

  return {
    technicians: workloadData,
    summary: {
      total: workloadData.length,
      working: workloadData.filter(t => t.status === 'working').length,
      available: workloadData.filter(t => t.status === 'available').length,
      idle: workloadData.filter(t => t.status === 'idle').length
    }
  }
}

export interface MonthlyKpiMonth {
  label: string
  hcCount: number
  completedCount: number
  /** Inspection (technician-flagged) red sold %, count-based */
  redSoldPct: number | null
  /** Inspection (technician-flagged) amber sold %, count-based */
  amberSoldPct: number | null
  /** Manufacturer-recommended items sold %, count-based, all RAG levels */
  mriSoldPct: number | null
  /** MRI identified/authorised item counts (subtext for the MRI Sold card) */
  mriIdentifiedCount: number
  mriAuthorisedCount: number
  avgIdentified: number | null
  avgSold: number | null
  avgPerDay: number
  topAdvisor: { advisorId: string; name?: string; redSoldPct: number; totalSold: number; score: number } | null
}

export interface MonthlyKpisData {
  currentMonth: MonthlyKpiMonth
  previousMonth: MonthlyKpiMonth
  deltas: {
    redSoldPct: number | null
    amberSoldPct: number | null
    mriSoldPct: number | null
    avgIdentified: number | null
    avgSold: number | null
    avgPerDay: number | null
  }
}

interface MonthHc {
  id: string
  status: string
  advisor_id: string | null
  sent_at: string | null
}

/** Monthly performance KPIs with previous-month deltas. */
export async function getMonthlyKpis(filters: DashboardFilters): Promise<MonthlyKpisData> {
  const now = new Date()
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

  const currentDaysElapsed = Math.max(1, now.getDate())
  const previousMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate()

  // Post-inspection statuses ("the tech finished the check")
  const completedStatuses = [
    'tech_completed', 'awaiting_review', 'awaiting_pricing', 'awaiting_parts',
    'ready_to_send', 'sent', 'delivered', 'opened', 'partial_response',
    'authorized', 'declined', 'completed', 'expired', 'cancelled'
  ]

  const monthFilters: DashboardFilters = { orgId: filters.orgId, siteId: filters.siteId }
  const hcSelect = 'id, status, advisor_id, sent_at, created_at'

  const [currentHcs, previousHcs] = (await Promise.all([
    fetchPeriodHcSet(monthFilters, currentMonthStart.toISOString(), now.toISOString(), hcSelect),
    fetchPeriodHcSet(monthFilters, previousMonthStart.toISOString(), previousMonthEnd.toISOString(), hcSelect)
  ])) as unknown as [MonthHc[], MonthHc[]]

  const allHcIds = [...currentHcs.map(h => h.id), ...previousHcs.map(h => h.id)]
  const { items, optionTotalsMap } = await fetchRepairItemsForHcs(allHcIds, { withRag: true })
  const aggByHc = aggregateRepairItemsByHc(items, optionTotalsMap)

  function computeKpis(hcs: MonthHc[], daysInPeriod: number) {
    const hcCount = hcs.length
    const completedCount = hcs.filter(h => completedStatuses.includes(h.status)).length

    // Red/amber sold % are INSPECTION-only (technician-flagged); MRI tracked separately.
    // Avg identified/sold £ stay combined (inspection + MRI), matching the SMS totals.
    const totals = {
      redIdentified: 0,
      redAuthorised: 0,
      amberIdentified: 0,
      amberAuthorised: 0,
      mriIdentified: 0,
      mriAuthorised: 0,
      identifiedValue: 0,
      authorisedValue: 0
    }

    for (const hc of hcs) {
      const agg = aggByHc.get(hc.id)
      if (!agg) continue
      totals.redIdentified += agg.inspection.red.identifiedCount
      totals.redAuthorised += agg.inspection.red.authorisedCount
      totals.amberIdentified += agg.inspection.amber.identifiedCount
      totals.amberAuthorised += agg.inspection.amber.authorisedCount
      totals.mriIdentified += agg.mri.red.identifiedCount + agg.mri.amber.identifiedCount + agg.mri.green.identifiedCount
      totals.mriAuthorised += agg.mri.red.authorisedCount + agg.mri.amber.authorisedCount + agg.mri.green.authorisedCount
      totals.identifiedValue += agg.identifiedTotal
      totals.authorisedValue += agg.authorisedTotal
    }

    const redSoldPct = totals.redIdentified > 0
      ? Math.round((totals.redAuthorised / totals.redIdentified) * 1000) / 10
      : null
    const amberSoldPct = totals.amberIdentified > 0
      ? Math.round((totals.amberAuthorised / totals.amberIdentified) * 1000) / 10
      : null
    const mriSoldPct = totals.mriIdentified > 0
      ? Math.round((totals.mriAuthorised / totals.mriIdentified) * 1000) / 10
      : null
    const avgIdentified = hcCount > 0 ? Math.round((totals.identifiedValue / hcCount) * 100) / 100 : null
    const avgSold = hcCount > 0 ? Math.round((totals.authorisedValue / hcCount) * 100) / 100 : null
    const avgPerDay = Math.round((completedCount / daysInPeriod) * 10) / 10

    // Advisor of the month: 60% red-sold %, 40% normalized total sold (min 5 HCs)
    const advisorStats: Record<string, {
      advisorId: string
      hcCount: number
      redIdentified: number
      redAuthorised: number
      totalAuthorised: number
    }> = {}
    for (const hc of hcs) {
      if (!hc.advisor_id) continue
      if (!advisorStats[hc.advisor_id]) {
        advisorStats[hc.advisor_id] = {
          advisorId: hc.advisor_id,
          hcCount: 0,
          redIdentified: 0,
          redAuthorised: 0,
          totalAuthorised: 0
        }
      }
      const stat = advisorStats[hc.advisor_id]
      stat.hcCount++
      const agg = aggByHc.get(hc.id)
      if (agg) {
        // Advisor scoring uses inspection red (technician-flagged), consistent with the Red Sold card
        stat.redIdentified += agg.inspection.red.identifiedCount
        stat.redAuthorised += agg.inspection.red.authorisedCount
        stat.totalAuthorised += agg.authorisedTotal
      }
    }

    let topAdvisor: { advisorId: string; redSoldPct: number; totalSold: number; score: number } | null = null
    const qualifiedAdvisors = Object.values(advisorStats).filter(a => a.hcCount >= 5)
    if (qualifiedAdvisors.length > 0) {
      const maxTotalAuthorised = Math.max(...qualifiedAdvisors.map(a => a.totalAuthorised), 1)
      for (const a of qualifiedAdvisors) {
        const rsPct = a.redIdentified > 0 ? (a.redAuthorised / a.redIdentified) * 100 : 0
        const normalizedSold = a.totalAuthorised / maxTotalAuthorised
        const score = rsPct * 0.6 + normalizedSold * 100 * 0.4
        if (!topAdvisor || score > topAdvisor.score) {
          topAdvisor = { advisorId: a.advisorId, redSoldPct: rsPct, totalSold: a.totalAuthorised, score }
        }
      }
    }

    return {
      hcCount, completedCount, redSoldPct, amberSoldPct,
      mriSoldPct, mriIdentifiedCount: totals.mriIdentified, mriAuthorisedCount: totals.mriAuthorised,
      avgIdentified, avgSold, avgPerDay, topAdvisor
    }
  }

  const currentKpis = computeKpis(currentHcs, currentDaysElapsed)
  const previousKpis = computeKpis(previousHcs, previousMonthDays)

  const advisorIds = [currentKpis.topAdvisor?.advisorId, previousKpis.topAdvisor?.advisorId]
    .filter((id): id is string => !!id)
  const advisorNames: Record<string, string> = {}
  if (advisorIds.length > 0) {
    const { data: advisors } = await supabaseAdmin
      .from('users')
      .select('id, first_name, last_name')
      .in('id', advisorIds)
    for (const a of advisors || []) {
      advisorNames[a.id] = `${a.first_name} ${a.last_name}`
    }
  }

  const delta = (curr: number | null, prev: number | null) => {
    if (curr === null || prev === null) return null
    return Math.round((curr - prev) * 10) / 10
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  return {
    currentMonth: {
      label: `${monthNames[now.getMonth()]} ${now.getFullYear()}`,
      ...currentKpis,
      topAdvisor: currentKpis.topAdvisor
        ? { ...currentKpis.topAdvisor, name: advisorNames[currentKpis.topAdvisor.advisorId] || 'Unknown' }
        : null
    },
    previousMonth: {
      label: `${monthNames[previousMonthStart.getMonth()]} ${previousMonthStart.getFullYear()}`,
      ...previousKpis,
      topAdvisor: previousKpis.topAdvisor
        ? { ...previousKpis.topAdvisor, name: advisorNames[previousKpis.topAdvisor.advisorId] || 'Unknown' }
        : null
    },
    deltas: {
      redSoldPct: delta(currentKpis.redSoldPct, previousKpis.redSoldPct),
      amberSoldPct: delta(currentKpis.amberSoldPct, previousKpis.amberSoldPct),
      mriSoldPct: delta(currentKpis.mriSoldPct, previousKpis.mriSoldPct),
      avgIdentified: delta(currentKpis.avgIdentified, previousKpis.avgIdentified),
      avgSold: delta(currentKpis.avgSold, previousKpis.avgSold),
      avgPerDay: delta(currentKpis.avgPerDay, previousKpis.avgPerDay)
    }
  }
}

interface RagSum {
  identifiedValue: number
  authorizedValue: number
  itemCount: number
  authorizedCount: number
}

export interface TodayRagData {
  ragBreakdown: {
    /** Technician-flagged inspection items (source != 'mri_scan'), split by RAG */
    inspection: { red: RagSum; amber: RagSum; green: RagSum }
    /** Manufacturer-recommended items (source = 'mri_scan'), combined across RAG levels */
    mri: RagSum
  }
}

/**
 * Today's RAG breakdown, split by sales motion:
 *  - inspection: red/amber/green for technician-flagged items
 *  - mri: combined identified-vs-authorised for manufacturer-recommended items
 * Note: £ totals and overall conversion (getSummaryMetrics) stay combined; only
 * the RAG conversion percentages are split, per the dashboard design.
 */
export async function getTodayRag(filters: DashboardFilters): Promise<TodayRagData> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayISO = today.toISOString()
  const tomorrowISO = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()

  const healthChecks = (await fetchPeriodHcSet(
    { orgId: filters.orgId, siteId: filters.siteId },
    todayISO,
    tomorrowISO,
    'id, status'
  )) as unknown as Array<{ id: string }>

  const { items, optionTotalsMap } = await fetchRepairItemsForHcs(healthChecks.map(hc => hc.id), { withRag: true })
  const aggByHc = aggregateRepairItemsByHc(items, optionTotalsMap)

  const inspection = { red: emptyRagSum(), amber: emptyRagSum(), green: emptyRagSum() }
  const mri = emptyRagSum()

  const addBucket = (target: RagSum, b: { identifiedValue: number; authorisedValue: number; identifiedCount: number; authorisedCount: number }) => {
    target.identifiedValue += b.identifiedValue
    target.authorizedValue += b.authorisedValue
    target.itemCount += b.identifiedCount
    target.authorizedCount += b.authorisedCount
  }

  for (const agg of aggByHc.values()) {
    for (const rag of ['red', 'amber', 'green'] as const) {
      addBucket(inspection[rag], agg.inspection[rag])
      addBucket(mri, agg.mri[rag]) // MRI combined across all RAG levels
    }
  }

  const round2 = (s: RagSum) => {
    s.identifiedValue = Math.round(s.identifiedValue * 100) / 100
    s.authorizedValue = Math.round(s.authorizedValue * 100) / 100
  }
  round2(inspection.red); round2(inspection.amber); round2(inspection.green); round2(mri)

  return { ragBreakdown: { inspection, mri } }
}

function emptyRagSum(): RagSum {
  return { identifiedValue: 0, authorizedValue: 0, itemCount: 0, authorizedCount: 0 }
}

export { soldPct, type HcItemsAgg }
