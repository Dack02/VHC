import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import {
  statusGroups,
  getSummaryMetrics,
  getBoardState,
  getQueues,
  getTechnicianWorkload,
  getMonthlyKpis,
  getTodayRag,
  type DashboardFilters
} from '../services/dashboard-service.js'
import { chunkIds } from '../services/hc-period-service.js'

const dashboard = new Hono()

dashboard.use('*', authMiddleware)

function filtersFromQuery(orgId: string, query: Record<string, string | undefined>): DashboardFilters {
  return {
    orgId,
    siteId: query.site_id || undefined,
    technicianId: query.technician_id || undefined,
    advisorId: query.advisor_id || undefined
  }
}

function defaultPeriod(dateFrom?: string, dateTo?: string): { startDate: string; endDate: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return {
    startDate: dateFrom || today.toISOString(),
    endDate: dateTo || new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
  }
}

// Valid transitions for drag-drop
const validDragTransitions: Record<string, string[]> = {
  created: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['tech_completed', 'paused'],
  paused: ['in_progress'],
  tech_completed: ['awaiting_review', 'awaiting_pricing'],
  awaiting_review: ['awaiting_pricing', 'ready_to_send'],
  awaiting_pricing: ['awaiting_parts', 'ready_to_send'],
  awaiting_parts: ['ready_to_send'],
  ready_to_send: ['sent'],
  authorized: ['completed'],
  declined: ['completed']
}

// GET /api/v1/dashboard - Summary metrics
dashboard.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const query = c.req.query()
    const filters = filtersFromQuery(auth.orgId, query)
    const { startDate, endDate } = defaultPeriod(query.date_from, query.date_to)

    const [summary, boardState] = await Promise.all([
      getSummaryMetrics(filters, startDate, endDate),
      getBoardState(filters)
    ])

    return c.json({
      metrics: summary.metrics,
      statusCounts: summary.statusCounts,
      columnCounts: boardState.columnCounts,
      alerts: boardState.alerts,
      period: summary.period
    })
  } catch (error) {
    console.error('Dashboard metrics error:', error)
    return c.json({ error: 'Failed to fetch dashboard metrics' }, 500)
  }
})

// GET /api/v1/dashboard/overview - Everything the dashboard page needs in one round-trip
dashboard.get('/overview', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const query = c.req.query()
    const filters = filtersFromQuery(auth.orgId, query)
    const { startDate, endDate } = defaultPeriod(query.date_from, query.date_to)

    const [summary, boardState, queues, technicians, monthlyKpis, todayRag] = await Promise.all([
      getSummaryMetrics(filters, startDate, endDate),
      getBoardState(filters),
      getQueues(filters),
      getTechnicianWorkload(filters),
      getMonthlyKpis(filters),
      getTodayRag(filters)
    ])

    return c.json({
      metrics: summary.metrics,
      statusCounts: summary.statusCounts,
      period: summary.period,
      columnCounts: boardState.columnCounts,
      alerts: boardState.alerts,
      queues,
      technicians: technicians.technicians,
      techniciansSummary: technicians.summary,
      monthlyKpis,
      todayRag
    })
  } catch (error) {
    console.error('Dashboard overview error:', error)
    return c.json({ error: 'Failed to fetch dashboard overview' }, 500)
  }
})

// GET /api/v1/dashboard/board - Kanban board data
dashboard.get('/board', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, technician_id, advisor_id, site_id } = c.req.query()

    // No default date filter - show all active health checks
    // Only apply date filter if explicitly provided
    const buildBoardQuery = () => {
      let q = supabaseAdmin
        .from('health_checks')
        .select(`
        id,
        status,
        promised_at,
        created_at,
        updated_at,
        sent_at,
        token_expires_at,
        green_count,
        amber_count,
        red_count,
        customer_waiting,
        loan_car_required,
        booked_repairs,
        tech_started_at,
        tech_completed_at,
        vehicle:vehicles(id, registration, make, model),
        customer:customers(id, first_name, last_name),
        technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name)
      `)
        .eq('organization_id', auth.orgId)
        .is('deleted_at', null) // Exclude soft-deleted records
        // Exclude no-inspection "visit" shells (no-VHC jobsheet check-ins) — they don't belong
        // on the inspection kanban; they're managed from the jobsheet + Arrivals.
        .eq('inspection_required', true)
        // Exclude terminal states AND DMS pre-arrival states (awaiting_arrival has its own UI section)
        .not('status', 'in', '(completed,cancelled,expired,awaiting_arrival,no_show)')
      if (date_from) q = q.gte('created_at', date_from)
      if (date_to) q = q.lte('created_at', date_to)
      if (site_id) q = q.eq('site_id', site_id)
      if (technician_id) q = q.eq('technician_id', technician_id)
      if (advisor_id) q = q.eq('advisor_id', advisor_id)
      return q.order('created_at', { ascending: false })
    }

    // Drain every page: an org's active-HC set can exceed PostgREST's ~1000-row
    // cap. A truncated board would hide cards AND (via healthCheckIds below) make
    // the downstream repair-item / MRI / SMS .in() lookups overflow and error out.
    let healthChecks: NonNullable<Awaited<ReturnType<typeof buildBoardQuery>>['data']> = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await buildBoardQuery().range(from, from + 999)
      if (error) {
        return c.json({ error: error.message }, 500)
      }
      healthChecks = healthChecks.concat(data || [])
      if (!data || data.length < 1000) break
    }

    // Group by column
    const columns: Record<string, typeof healthChecks> = {
      technician: [],
      tech_done: [],
      advisor: [],
      customer: [],
      actioned: []
    }

    const now = new Date()
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    // Fetch total amounts, workflow status data, and outcome aggregations from repair_items for each health check
    const healthCheckIds = healthChecks?.map(hc => hc.id) || []
    let repairTotals: Record<string, number> = {}
    // For labour/parts status: use non-group items (standalone + children) - groups don't have their own L/P status
    let repairItemsByHc: Record<string, Array<{ labour_status: string; parts_status: string }>> = {}
    // For authorisation status: use top-level items (groups + standalone, NOT children) - matches frontend logic
    let authItemsByHc: Record<string, Array<{ outcome_status: string | null; customer_approved: boolean | null }>> = {}

    // Outcome aggregation data per health check
    interface OutcomeAggregation {
      identified_total: number
      authorised_total: number
      red_identified: number
      red_authorised: number
      amber_identified: number
      amber_authorised: number
      green_identified: number
      green_authorised: number
    }
    let outcomesByHc: Record<string, OutcomeAggregation> = {}

    // MRI (Manufacturer Recommended Items) aggregation maps
    let mriCountByHc: Record<string, number> = {}
    let mriTotalByHc: Record<string, number> = {}

    // Unread inbound SMS count per health check
    let unreadSmsByHc: Record<string, number> = {}

    if (healthCheckIds.length > 0) {
      // Query ALL repair items - use stored totals directly (labour_total, parts_total, total_inc_vat)
      // When a selected_option_id exists, use the option's totals instead (price options feature)
      // Chunk by HC id: a busy org's active-HC list overflows a single .in() URL.
      const repairData = (await Promise.all(
        chunkIds(healthCheckIds, 100).map(async chunk => {
          const { data, error: repairError } = await supabaseAdmin
            .from('repair_items')
            .select(`
              health_check_id,
              labour_total,
              parts_total,
              total_inc_vat,
              labour_status,
              parts_status,
              quote_status,
              outcome_status,
              deleted_at,
              customer_approved,
              is_group,
              parent_repair_item_id,
              selected_option_id,
              mri_result_id,
              rag_status,
              check_results:repair_item_check_results(
                check_result:check_results(rag_status)
              )
            `)
            .in('health_check_id', chunk)
          if (repairError) console.error('Error fetching repair items for workflow:', repairError)
          return data || []
        })
      )).flat()

      // Fetch selected option totals separately to avoid FK join issues
      const selectedOptionIds = (repairData || [])
        .map(item => item.selected_option_id)
        .filter((id): id is string => !!id)

      let optionTotalsMap: Record<string, { labour_total: any; parts_total: any; total_inc_vat: any }> = {}
      if (selectedOptionIds.length > 0) {
        for (const optChunk of chunkIds(selectedOptionIds)) {
          const { data: optionData } = await supabaseAdmin
            .from('repair_options')
            .select('id, labour_total, parts_total, total_inc_vat')
            .in('id', optChunk)
          for (const opt of optionData || []) optionTotalsMap[opt.id] = opt
        }
      }

      // Query MRI scan results (red/amber items that need attention)
      await Promise.all(chunkIds(healthCheckIds, 100).map(async chunk => {
        const { data: mriData } = await supabaseAdmin
          .from('mri_scan_results')
          .select('health_check_id, rag_status')
          .in('health_check_id', chunk)
          .in('rag_status', ['red', 'amber'])
        mriData?.forEach(r => {
          mriCountByHc[r.health_check_id] = (mriCountByHc[r.health_check_id] || 0) + 1
        })
      }))

      // Unread inbound SMS messages
      await Promise.all(chunkIds(healthCheckIds, 100).map(async chunk => {
        const { data: unreadSmsData } = await supabaseAdmin
          .from('sms_messages')
          .select('health_check_id')
          .eq('organization_id', auth.orgId)
          .in('health_check_id', chunk)
          .eq('direction', 'inbound')
          .eq('is_read', false)
        unreadSmsData?.forEach(row => {
          unreadSmsByHc[row.health_check_id] = (unreadSmsByHc[row.health_check_id] || 0) + 1
        })
      }))

      // Default VAT rate for calculating total when total_inc_vat is 0 but labour/parts exist
      const VAT_RATE = 0.20

      repairData?.forEach(item => {
        // When a selected option exists, use its totals instead of the repair item's own totals
        // (price options feature: labour/parts are added to the option, not the item directly)
        const selectedOpt = item.selected_option_id ? optionTotalsMap[item.selected_option_id] : null

        const srcTotalIncVat = selectedOpt?.total_inc_vat ?? item.total_inc_vat
        const srcLabourTotal = selectedOpt?.labour_total ?? item.labour_total
        const srcPartsTotal = selectedOpt?.parts_total ?? item.parts_total

        let totalIncVat = parseFloat(String(srcTotalIncVat ?? 0)) || 0

        // If total_inc_vat is 0 but labour_total/parts_total exist, calculate total
        if (totalIncVat === 0) {
          const labourTotal = parseFloat(String(srcLabourTotal ?? 0)) || 0
          const partsTotal = parseFloat(String(srcPartsTotal ?? 0)) || 0

          if (labourTotal > 0 || partsTotal > 0) {
            const subtotal = labourTotal + partsTotal
            const vatAmount = subtotal * VAT_RATE
            totalIncVat = subtotal + vatAmount
          }
        }
        // deleted_at being truthy (any non-null/undefined value) means item is deleted
        const isDeleted = !!item.deleted_at
        // Check customer_approved for authorisation (customer approved this item)
        const isAuthorised = item.customer_approved === true
        // Check if this is a child item (has a parent) or a group (is_group=true)
        const isChild = !!item.parent_repair_item_id
        const isGroup = item.is_group === true

        // Derive RAG status: the item's own rag_status (MRI / manual items) wins,
        // then fall back to linked check_results (inspection items). red > amber > green.
        let derivedRagStatus: string | null =
          ['red', 'amber', 'green'].includes((item as { rag_status?: string }).rag_status || '')
            ? (item as { rag_status?: string }).rag_status!
            : null
        const checkResultLinks = item.check_results as unknown as Array<{ check_result: { rag_status: string } | { rag_status: string }[] | null }> | null
        if (!derivedRagStatus && checkResultLinks && Array.isArray(checkResultLinks)) {
          for (const link of checkResultLinks) {
            // Handle both single object and array returns from Supabase
            const checkResult = Array.isArray(link?.check_result) ? link.check_result[0] : link?.check_result
            const ragStatus = checkResult?.rag_status
            if (ragStatus === 'red') {
              derivedRagStatus = 'red'
              break
            } else if (ragStatus === 'amber' && derivedRagStatus !== 'red') {
              derivedRagStatus = 'amber'
            } else if (ragStatus === 'green' && !derivedRagStatus) {
              derivedRagStatus = 'green'
            }
          }
        }

        // For totals and outcome aggregations: only count top-level items (not children) to avoid double-counting
        // Children's pricing rolls up to parent groups
        if (!isChild) {
          // Initialize totals if needed
          repairTotals[item.health_check_id] = (repairTotals[item.health_check_id] || 0) + totalIncVat

          // Accumulate MRI-sourced repair item totals (non-deleted, top-level items with mri_result_id)
          if ((item as any).mri_result_id && !isDeleted) {
            mriTotalByHc[item.health_check_id] = (mriTotalByHc[item.health_check_id] || 0) + totalIncVat
          }

          // Initialize outcome aggregation if needed
          if (!outcomesByHc[item.health_check_id]) {
            outcomesByHc[item.health_check_id] = {
              identified_total: 0,
              authorised_total: 0,
              red_identified: 0,
              red_authorised: 0,
              amber_identified: 0,
              amber_authorised: 0,
              green_identified: 0,
              green_authorised: 0
            }
          }

          const outcomes = outcomesByHc[item.health_check_id]

          // Identified = non-deleted items
          if (!isDeleted) {
            outcomes.identified_total += totalIncVat

            if (derivedRagStatus === 'red') {
              outcomes.red_identified++
            } else if (derivedRagStatus === 'amber') {
              outcomes.amber_identified++
            } else if (derivedRagStatus === 'green') {
              outcomes.green_identified++
            }
          }

          // Authorised = items with outcome_status = 'authorised'
          if (isAuthorised) {
            outcomes.authorised_total += totalIncVat

            if (derivedRagStatus === 'red') {
              outcomes.red_authorised++
            } else if (derivedRagStatus === 'amber') {
              outcomes.amber_authorised++
            } else if (derivedRagStatus === 'green') {
              outcomes.green_authorised++
            }
          }
        }

        // For labour/parts workflow status: include non-group items (standalone items and children)
        // Groups don't track their own labour/parts status - their children do
        if (!isGroup) {
          if (!repairItemsByHc[item.health_check_id]) {
            repairItemsByHc[item.health_check_id] = []
          }
          repairItemsByHc[item.health_check_id].push({
            labour_status: item.labour_status || 'pending',
            parts_status: item.parts_status || 'pending'
          })
        }

        // For authorisation status: include top-level items (groups + standalone, NOT children)
        // This matches the frontend logic which counts all items returned by the repair-items endpoint
        if (!isChild) {
          if (!authItemsByHc[item.health_check_id]) {
            authItemsByHc[item.health_check_id] = []
          }
          authItemsByHc[item.health_check_id].push({
            outcome_status: item.outcome_status || null,
            customer_approved: item.customer_approved ?? null
          })
        }
      })
    }

    // Fetch timer data for in_progress health checks
    interface TimerData {
      total_closed_minutes: number
      active_clock_in_at: string | null
    }
    const timerDataByHc: Record<string, TimerData> = {}

    const inProgressIds = healthChecks
      ?.filter(hc => hc.status === 'in_progress')
      .map(hc => hc.id) || []

    if (inProgressIds.length > 0) {
      // Query time entries for in_progress health checks (chunked — set can be large)
      const timeEntries = (await Promise.all(
        chunkIds(inProgressIds, 100).map(async chunk => {
          const { data, error: timeError } = await supabaseAdmin
            .from('technician_time_entries')
            .select('health_check_id, clock_in_at, clock_out_at, duration_minutes')
            .in('health_check_id', chunk)
          if (timeError) console.error('Error fetching time entries for timer:', timeError)
          return data || []
        })
      )).flat()

      // Process time entries for each health check
      timeEntries?.forEach(entry => {
        if (!timerDataByHc[entry.health_check_id]) {
          timerDataByHc[entry.health_check_id] = {
            total_closed_minutes: 0,
            active_clock_in_at: null
          }
        }

        if (entry.clock_out_at) {
          // Closed entry - add to total
          timerDataByHc[entry.health_check_id].total_closed_minutes += entry.duration_minutes || 0
        } else {
          // Open entry - this is the active session
          timerDataByHc[entry.health_check_id].active_clock_in_at = entry.clock_in_at
        }
      })
    }

    // Helper function to calculate workflow status
    function calculateWorkflowStatus(
      // repairItems: non-group items for labour/parts calculation
      repairItems: Array<{ labour_status: string; parts_status: string }>,
      // authItems: top-level items for authorisation calculation (matches frontend)
      authItems: Array<{ outcome_status: string | null; customer_approved: boolean | null }>,
      sentAt: string | null | undefined,
      techStartedAt: string | null | undefined,
      techCompletedAt: string | null | undefined
    ) {
      // Calculate technician status from timestamps
      let technicianStatus: 'pending' | 'in_progress' | 'complete' = 'pending'
      if (techCompletedAt) {
        technicianStatus = 'complete'
      } else if (techStartedAt) {
        technicianStatus = 'in_progress'
      }

      // Labour/Parts: based on non-group items
      let labourStatus: 'pending' | 'in_progress' | 'complete' | 'na' = 'na'
      let partsStatus: 'pending' | 'in_progress' | 'complete' | 'na' = 'na'

      if (repairItems.length > 0) {
        const labourComplete = repairItems.every(i => i.labour_status === 'complete')
        const labourStarted = repairItems.some(i =>
          i.labour_status === 'in_progress' || i.labour_status === 'complete'
        )
        labourStatus = labourComplete ? 'complete' : labourStarted ? 'in_progress' : 'pending'

        const partsComplete = repairItems.every(i => i.parts_status === 'complete')
        const partsStarted = repairItems.some(i =>
          i.parts_status === 'in_progress' || i.parts_status === 'complete'
        )
        partsStatus = partsComplete ? 'complete' : partsStarted ? 'in_progress' : 'pending'
      }

      const isSent = !!sentAt

      // Check if item is authorised (outcome_status = 'authorised' OR customer_approved = true)
      const isItemAuthorised = (item: { outcome_status: string | null; customer_approved: boolean | null }) =>
        item.outcome_status === 'authorised' || item.customer_approved === true

      // Authorisation: based on top-level items (matches frontend logic)
      // Filter to only actionable items (not deleted)
      const actionableItems = authItems.filter(i => i.outcome_status !== 'deleted')
      let authorisedStatus: 'pending' | 'in_progress' | 'complete' | 'na' = 'na'
      if (actionableItems.length > 0) {
        const authorisedCount = actionableItems.filter(i => isItemAuthorised(i)).length
        if (authorisedCount === actionableItems.length) {
          authorisedStatus = 'complete'
        } else if (authorisedCount > 0) {
          authorisedStatus = 'in_progress'
        } else {
          authorisedStatus = 'pending'
        }
      }

      return {
        technician: technicianStatus,
        labour: labourStatus,
        parts: partsStatus,
        sent: isSent ? 'complete' as const : 'na' as const,
        authorised: authorisedStatus
      }
    }

    healthChecks?.forEach(hc => {
      // Determine column
      let column = 'technician'
      if (statusGroups.tech_done.includes(hc.status)) column = 'tech_done'
      else if (statusGroups.advisor.includes(hc.status)) column = 'advisor'
      else if (statusGroups.customer.includes(hc.status)) column = 'customer'
      else if (statusGroups.actioned.includes(hc.status)) column = 'actioned'

      // Add SLA warnings and computed fields
      const workflowStatus = calculateWorkflowStatus(
        repairItemsByHc[hc.id] || [],
        authItemsByHc[hc.id] || [],
        hc.sent_at,
        hc.tech_started_at,
        hc.tech_completed_at
      )

      // Get outcome aggregations for this health check
      const outcomes = outcomesByHc[hc.id] || {
        identified_total: 0,
        authorised_total: 0,
        red_identified: 0,
        red_authorised: 0,
        amber_identified: 0,
        amber_authorised: 0,
        green_identified: 0,
        green_authorised: 0
      }

      // Calculate authorisation counts for tooltip (same logic as calculateWorkflowStatus)
      const authItems = authItemsByHc[hc.id] || []
      const actionableAuthItems = authItems.filter(i => i.outcome_status !== 'deleted')
      const authorisedCount = actionableAuthItems.filter(i =>
        i.outcome_status === 'authorised' || i.customer_approved === true
      ).length
      const totalAuthItems = actionableAuthItems.length

      const card = {
        ...hc,
        promise_time: hc.promised_at, // Map for frontend compatibility
        total_amount: repairTotals[hc.id] || 0,
        isOverdue: hc.promised_at && new Date(hc.promised_at) < now,
        isExpiringSoon: hc.token_expires_at && new Date(hc.token_expires_at) < in24Hours && new Date(hc.token_expires_at) > now,
        validTransitions: validDragTransitions[hc.status] || [],
        workflowStatus,
        // Authorisation info for tooltip
        authorisationInfo: {
          status: workflowStatus.authorised,
          totalItems: totalAuthItems,
          authorisedCount: authorisedCount,
          authorisedBy: [] // Empty array - dashboard doesn't have detailed entry info
        },
        // Outcome aggregations for identified vs authorised
        identified_total: outcomes.identified_total,
        authorised_total: outcomes.authorised_total,
        red_identified: outcomes.red_identified,
        red_authorised: outcomes.red_authorised,
        amber_identified: outcomes.amber_identified,
        amber_authorised: outcomes.amber_authorised,
        green_identified: outcomes.green_identified,
        green_authorised: outcomes.green_authorised,
        // MRI (Manufacturer Recommended Items) data
        mri_count: mriCountByHc[hc.id] || 0,
        mri_total: mriTotalByHc[hc.id] || 0,
        // Timer data for in_progress inspections
        timer_data: timerDataByHc[hc.id] || null,
        // Unread inbound SMS count
        unread_sms_count: unreadSmsByHc[hc.id] || 0
      }

      columns[column]?.push(card)
    })

    // Sort tech_done by most recently completed first
    columns.tech_done?.sort((a, b) => {
      const aTime = a.tech_completed_at ? new Date(a.tech_completed_at).getTime() : 0
      const bTime = b.tech_completed_at ? new Date(b.tech_completed_at).getTime() : 0
      return bTime - aTime
    })

    return c.json({
      columns: {
        technician: {
          id: 'technician',
          title: 'Technician Queue',
          statuses: statusGroups.technician,
          cards: columns.technician
        },
        tech_done: {
          id: 'tech_done',
          title: 'Tech Done / Review',
          statuses: statusGroups.tech_done,
          cards: columns.tech_done
        },
        advisor: {
          id: 'advisor',
          title: 'Ready to Send',
          statuses: statusGroups.advisor,
          cards: columns.advisor
        },
        customer: {
          id: 'customer',
          title: 'With Customer',
          statuses: statusGroups.customer,
          cards: columns.customer
        },
        actioned: {
          id: 'actioned',
          title: 'Actioned',
          statuses: statusGroups.actioned,
          cards: columns.actioned
        }
      },
      totalCount: healthChecks?.length || 0
    })
  } catch (error) {
    console.error('Dashboard board error:', error)
    return c.json({ error: 'Failed to fetch board data' }, 500)
  }
})

// GET /api/v1/dashboard/technicians - Technician workload view
dashboard.get('/technicians', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id } = c.req.query()

    const workload = await getTechnicianWorkload({ orgId: auth.orgId, siteId: site_id || undefined })
    return c.json(workload)
  } catch (error) {
    console.error('Technician workload error:', error)
    return c.json({ error: 'Failed to fetch technician workload' }, 500)
  }
})

// GET /api/v1/dashboard/activity - Recent activity feed
dashboard.get('/activity', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { limit = '20', offset = '0' } = c.req.query()

    // Get recent status changes, scoped to the org via an inner join
    // (avoids fetching every HC id in the org first)
    const { data: activities, error, count } = await supabaseAdmin
      .from('health_check_status_history')
      .select(`
        id,
        from_status,
        to_status,
        changed_at,
        changed_by,
        health_check:health_checks!inner(
          id,
          organization_id,
          vehicle:vehicles(registration, make, model),
          technician:users!health_checks_technician_id_fkey(first_name, last_name),
          advisor:users!health_checks_advisor_id_fkey(first_name, last_name)
        ),
        user:users!health_check_status_history_changed_by_fkey(first_name, last_name, role)
      `, { count: 'exact' })
      .eq('health_check.organization_id', auth.orgId)
      .order('changed_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      activities: activities?.map(a => ({
        id: a.id,
        type: 'status_change',
        fromStatus: a.from_status,
        toStatus: a.to_status,
        changedAt: a.changed_at,
        healthCheck: a.health_check,
        changedBy: a.user
      })),
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('Activity feed error:', error)
    return c.json({ error: 'Failed to fetch activity feed' }, 500)
  }
})

// GET /api/v1/dashboard/timeline/:id - Health check timeline
dashboard.get('/timeline/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const healthCheckId = c.req.param('id')

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, created_at')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get all status history for this health check
    const { data: statusHistory, error } = await supabaseAdmin
      .from('health_check_status_history')
      .select(`
        id,
        from_status,
        to_status,
        changed_at,
        user:users!health_check_status_history_changed_by_fkey(first_name, last_name, role)
      `)
      .eq('health_check_id', healthCheckId)
      .order('changed_at', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Build timeline with durations
    const timeline = statusHistory?.map((entry, index) => {
      const prevEntry = index > 0 ? statusHistory[index - 1] : null
      const prevTime = prevEntry ? new Date(prevEntry.changed_at).getTime() : new Date(healthCheck.created_at).getTime()
      const currentTime = new Date(entry.changed_at).getTime()
      const durationMinutes = Math.round((currentTime - prevTime) / (1000 * 60))

      return {
        id: entry.id,
        fromStatus: entry.from_status,
        toStatus: entry.to_status,
        changedAt: entry.changed_at,
        changedBy: entry.user,
        durationMinutes,
        durationFormatted: formatDuration(durationMinutes)
      }
    }) || []

    // Add initial entry
    if (timeline.length > 0) {
      timeline.unshift({
        id: 'created',
        fromStatus: null as unknown as string,
        toStatus: 'created',
        changedAt: healthCheck.created_at,
        changedBy: null as unknown as typeof timeline[0]['changedBy'],
        durationMinutes: 0,
        durationFormatted: ''
      })
    }

    return c.json({
      healthCheckId,
      timeline,
      totalDurationMinutes: timeline.length > 1
        ? Math.round((new Date(timeline[timeline.length - 1].changedAt).getTime() - new Date(healthCheck.created_at).getTime()) / (1000 * 60))
        : 0
    })
  } catch (error) {
    console.error('Timeline error:', error)
    return c.json({ error: 'Failed to fetch timeline' }, 500)
  }
})

// GET /api/v1/dashboard/queues - Queue summaries for dashboard cards
dashboard.get('/queues', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id } = c.req.query()

    const queues = await getQueues({ orgId: auth.orgId, siteId: site_id || undefined })
    return c.json(queues)
  } catch (error) {
    console.error('Queues error:', error)
    return c.json({ error: 'Failed to fetch queues' }, 500)
  }
})

// GET /api/v1/dashboard/monthly-kpis - Monthly performance KPIs with previous month deltas
dashboard.get('/monthly-kpis', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id } = c.req.query()

    const monthlyKpis = await getMonthlyKpis({ orgId: auth.orgId, siteId: site_id || undefined })
    return c.json(monthlyKpis)
  } catch (error) {
    console.error('Monthly KPIs error:', error)
    return c.json({ error: 'Failed to fetch monthly KPIs' }, 500)
  }
})

// Helper function to format duration
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

export default dashboard
