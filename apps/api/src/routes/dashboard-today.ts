import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const dashboardToday = new Hono()

dashboardToday.use('*', authMiddleware)

// GET / - Today's KPI dashboard data
dashboardToday.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id } = c.req.query()

    // Today midnight-to-midnight
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()
    const tomorrowISO = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()

    // ── Query 1: Health checks for today (by due_date OR created_at) ──
    const baseSelect = `
      id,
      status,
      created_at,
      updated_at,
      sent_at,
      first_opened_at,
      tech_started_at,
      tech_completed_at,
      arrived_at,
      due_date,
      customer_waiting,
      green_count,
      amber_count,
      red_count,
      technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
      advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name),
      vehicle:vehicles(registration)
    `

    let dueDateQuery = supabaseAdmin
      .from('health_checks')
      .select(baseSelect)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .gte('due_date', todayISO)
      .lt('due_date', tomorrowISO)

    let createdAtQuery = supabaseAdmin
      .from('health_checks')
      .select(baseSelect)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .is('due_date', null)
      .gte('created_at', todayISO)
      .lt('created_at', tomorrowISO)

    if (site_id) {
      dueDateQuery = dueDateQuery.eq('site_id', site_id)
      createdAtQuery = createdAtQuery.eq('site_id', site_id)
    }

    const [dueDateResult, createdAtResult] = await Promise.all([
      dueDateQuery,
      createdAtQuery
    ])

    if (dueDateResult.error) {
      console.error('Due date query error:', dueDateResult.error)
      return c.json({ error: dueDateResult.error.message }, 500)
    }
    if (createdAtResult.error) {
      console.error('Created at query error:', createdAtResult.error)
      return c.json({ error: createdAtResult.error.message }, 500)
    }

    // Deduplicate by ID
    const healthCheckMap = new Map<string, typeof dueDateResult.data[0]>()
    for (const hc of [...(dueDateResult.data || []), ...(createdAtResult.data || [])]) {
      if (!healthCheckMap.has(hc.id)) {
        healthCheckMap.set(hc.id, hc)
      }
    }
    const healthChecks = Array.from(healthCheckMap.values())
    const healthCheckIds = healthChecks.map(hc => hc.id)

    // ── Query 2: Repair items for today's HCs ──
    let repairData: Array<{
      id: string
      health_check_id: string
      labour_total: number | null
      parts_total: number | null
      total_inc_vat: number | null
      customer_approved: boolean | null
      outcome_status: string | null
      is_group: boolean | null
      parent_repair_item_id: string | null
      selected_option_id: string | null
      deleted_at: string | null
      check_results: Array<{ check_result: { rag_status: string } | { rag_status: string }[] | null }> | null
    }> = []

    if (healthCheckIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('repair_items')
        .select(`
          id,
          health_check_id,
          labour_total,
          parts_total,
          total_inc_vat,
          customer_approved,
          outcome_status,
          is_group,
          parent_repair_item_id,
          selected_option_id,
          deleted_at,
          check_results:repair_item_check_results(
            check_result:check_results(rag_status)
          )
        `)
        .in('health_check_id', healthCheckIds)

      if (error) {
        console.error('Repair items query error:', error)
      } else {
        repairData = data || []
      }
    }

    // Fetch selected option totals
    const selectedOptionIds = repairData
      .map(item => item.selected_option_id)
      .filter((id): id is string => !!id)

    let optionTotalsMap: Record<string, { labour_total: number | null; parts_total: number | null; total_inc_vat: number | null }> = {}
    if (selectedOptionIds.length > 0) {
      const { data: optionData } = await supabaseAdmin
        .from('repair_options')
        .select('id, labour_total, parts_total, total_inc_vat')
        .in('id', selectedOptionIds)

      if (optionData) {
        for (const opt of optionData) {
          optionTotalsMap[opt.id] = opt
        }
      }
    }

    // ── Query 3: Activity feed ──
    let recentActivity: Array<{
      timestamp: string
      vehicleReg: string
      fromStatus: string | null
      toStatus: string
      changedBy: string | null
    }> = []

    if (healthCheckIds.length > 0) {
      const { data: activityData } = await supabaseAdmin
        .from('health_check_status_history')
        .select(`
          from_status,
          to_status,
          changed_at,
          health_check:health_checks(
            vehicle:vehicles(registration)
          ),
          user:users!health_check_status_history_changed_by_fkey(first_name, last_name)
        `)
        .in('health_check_id', healthCheckIds)
        .gte('changed_at', todayISO)
        .lt('changed_at', tomorrowISO)
        .order('changed_at', { ascending: false })
        .limit(20)

      recentActivity = (activityData || []).map((a: Record<string, unknown>) => {
        const hc = a.health_check as { vehicle: { registration: string } | null } | null
        const u = a.user as { first_name: string; last_name: string } | null
        return {
          timestamp: a.changed_at as string,
          vehicleReg: hc?.vehicle?.registration || 'Unknown',
          fromStatus: a.from_status as string | null,
          toStatus: a.to_status as string,
          changedBy: u ? `${u.first_name} ${u.last_name}` : null
        }
      })
    }

    // ── Aggregate data ──

    const VAT_RATE = 0.20

    // Per-HC aggregation for financial and RAG breakdown
    let totalIdentified = 0
    let totalAuthorized = 0
    let totalDeclined = 0
    let totalPending = 0
    let deferredTodayCount = 0
    let deferredTodayValue = 0

    let redIdentifiedValue = 0
    let redAuthorizedValue = 0
    let redItemCount = 0
    let redAuthorizedCount = 0
    let amberIdentifiedValue = 0
    let amberAuthorizedValue = 0
    let amberItemCount = 0
    let amberAuthorizedCount = 0
    let greenIdentifiedValue = 0
    let greenAuthorizedValue = 0
    let greenItemCount = 0
    let greenAuthorizedCount = 0

    // Technician and advisor lookup maps
    const techMap = new Map<string, {
      name: string
      completedCount: number
      totalInspectionMinutes: number
      inspectionSampleCount: number
      redFound: number
      amberFound: number
      greenFound: number
    }>()

    const advisorMap = new Map<string, {
      name: string
      sentCount: number
      totalProcessingMinutes: number
      processingSampleCount: number
      totalValueSent: number
      totalValueAuthorized: number
      authorizedCount: number
    }>()

    // Process repair items following dashboard.ts pattern (lines 321-443)
    const repairValueByHc: Record<string, number> = {}
    const authorizedValueByHc: Record<string, number> = {}

    // Helper to check if an item is authorised
    const isItemAuthorised = (item: { customer_approved: boolean | null; outcome_status: string | null }) =>
      item.customer_approved === true || item.outcome_status === 'authorised'

    // Helper to calculate an item's totalIncVat
    const calcItemTotal = (item: typeof repairData[0]) => {
      const selectedOpt = item.selected_option_id ? optionTotalsMap[item.selected_option_id] : null
      const srcTotalIncVat = selectedOpt?.total_inc_vat ?? item.total_inc_vat
      const srcLabourTotal = selectedOpt?.labour_total ?? item.labour_total
      const srcPartsTotal = selectedOpt?.parts_total ?? item.parts_total
      let total = parseFloat(String(srcTotalIncVat ?? 0)) || 0
      if (total === 0) {
        const labourTotal = parseFloat(String(srcLabourTotal ?? 0)) || 0
        const partsTotal = parseFloat(String(srcPartsTotal ?? 0)) || 0
        if (labourTotal > 0 || partsTotal > 0) {
          const subtotal = labourTotal + partsTotal
          total = subtotal + subtotal * VAT_RATE
        }
      }
      return total
    }

    // Build children-by-parent map for group authorization
    const childrenByParent = new Map<string, typeof repairData>()
    repairData.forEach(item => {
      if (item.parent_repair_item_id) {
        const children = childrenByParent.get(item.parent_repair_item_id) || []
        children.push(item)
        childrenByParent.set(item.parent_repair_item_id, children)
      }
    })

    repairData.forEach(item => {
      const isChild = !!item.parent_repair_item_id
      const isDeleted = !!item.deleted_at

      // Only count top-level items to avoid double-counting
      if (isChild) return

      const totalIncVat = calcItemTotal(item)

      // Derive RAG from check_results junction
      let derivedRagStatus: string | null = null
      const checkResultLinks = item.check_results as unknown as Array<{ check_result: { rag_status: string } | { rag_status: string }[] | null }> | null
      if (checkResultLinks && Array.isArray(checkResultLinks)) {
        for (const link of checkResultLinks) {
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

      // Check authorization: direct check on item, or check children for groups
      let isAuthorised = isItemAuthorised(item)
      let authorizedValue = totalIncVat

      // For group parents, derive authorization from children if parent itself isn't marked
      if (item.is_group && !isAuthorised) {
        const children = childrenByParent.get(item.id) || []
        const authorizedChildren = children.filter(c => !c.deleted_at && isItemAuthorised(c))
        if (authorizedChildren.length > 0) {
          isAuthorised = true
          // Sum authorized children's values instead of using parent's total
          authorizedValue = authorizedChildren.reduce((sum, child) => sum + calcItemTotal(child), 0)
        }
      }

      if (!isDeleted) {
        totalIdentified += totalIncVat
        repairValueByHc[item.health_check_id] = (repairValueByHc[item.health_check_id] || 0) + totalIncVat

        if (derivedRagStatus === 'red') {
          redIdentifiedValue += totalIncVat
          redItemCount++
        } else if (derivedRagStatus === 'amber') {
          amberIdentifiedValue += totalIncVat
          amberItemCount++
        } else if (derivedRagStatus === 'green') {
          greenIdentifiedValue += totalIncVat
          greenItemCount++
        }
      }

      if (isAuthorised) {
        totalAuthorized += authorizedValue
        authorizedValueByHc[item.health_check_id] = (authorizedValueByHc[item.health_check_id] || 0) + authorizedValue

        if (derivedRagStatus === 'red') {
          redAuthorizedValue += authorizedValue
          redAuthorizedCount++
        } else if (derivedRagStatus === 'amber') {
          amberAuthorizedValue += authorizedValue
          amberAuthorizedCount++
        } else if (derivedRagStatus === 'green') {
          greenAuthorizedValue += authorizedValue
          greenAuthorizedCount++
        }
      } else if (!isDeleted && item.outcome_status === 'declined') {
        totalDeclined += totalIncVat
      } else if (!isDeleted && item.outcome_status === 'deferred') {
        deferredTodayCount++
        deferredTodayValue += totalIncVat
      } else if (!isDeleted && !isAuthorised && item.outcome_status !== 'declined') {
        totalPending += totalIncVat
      }
    })

    // ── Arrivals metrics ──
    const totalBookings = healthChecks.length
    const arrivedCount = healthChecks.filter(hc =>
      hc.arrived_at || !['awaiting_arrival', 'no_show'].includes(hc.status)
    ).length
    const noShowCount = healthChecks.filter(hc => hc.status === 'no_show').length
    const awaitingCount = healthChecks.filter(hc => hc.status === 'awaiting_arrival').length
    const customerWaitingCount = healthChecks.filter(hc => hc.customer_waiting).length

    // ── Speed metrics ──
    // Tech inspection: tech_started_at -> tech_completed_at
    const techTimes = healthChecks
      .filter(hc => hc.tech_started_at && hc.tech_completed_at)
      .map(hc => {
        const start = new Date(hc.tech_started_at!).getTime()
        const end = new Date(hc.tech_completed_at!).getTime()
        return (end - start) / (1000 * 60)
      })
      .filter(m => m > 0 && m < 480) // Filter out invalid durations (>8hrs)

    const avgTechInspectionMinutes = techTimes.length > 0
      ? Math.round(techTimes.reduce((a, b) => a + b, 0) / techTimes.length)
      : null

    // Advisor processing: tech_completed_at -> sent_at
    const advisorTimes = healthChecks
      .filter(hc => hc.tech_completed_at && hc.sent_at)
      .map(hc => {
        const start = new Date(hc.tech_completed_at!).getTime()
        const end = new Date(hc.sent_at!).getTime()
        return (end - start) / (1000 * 60)
      })
      .filter(m => m > 0 && m < 1440) // Filter out >24hrs

    const avgAdvisorProcessingMinutes = advisorTimes.length > 0
      ? Math.round(advisorTimes.reduce((a, b) => a + b, 0) / advisorTimes.length)
      : null

    // Authorization: sent_at -> first_opened_at (proxy for first response)
    const authTimes = healthChecks
      .filter(hc => hc.sent_at && hc.first_opened_at)
      .map(hc => {
        const start = new Date(hc.sent_at!).getTime()
        const end = new Date(hc.first_opened_at!).getTime()
        return (end - start) / (1000 * 60)
      })
      .filter(m => m > 0 && m < 1440)

    const avgAuthorizationMinutes = authTimes.length > 0
      ? Math.round(authTimes.reduce((a, b) => a + b, 0) / authTimes.length)
      : null

    // ── Technician leaderboard ──
    for (const hc of healthChecks) {
      // Supabase FK joins may return object or array; normalize to single object
      const techRaw = hc.technician
      const tech = (Array.isArray(techRaw) ? techRaw[0] : techRaw) as { id: string; first_name: string; last_name: string } | null
      if (!tech?.id) continue

      if (!techMap.has(tech.id)) {
        techMap.set(tech.id, {
          name: `${tech.first_name} ${tech.last_name}`,
          completedCount: 0,
          totalInspectionMinutes: 0,
          inspectionSampleCount: 0,
          redFound: 0,
          amberFound: 0,
          greenFound: 0
        })
      }

      const entry = techMap.get(tech.id)!

      // Count completed inspections
      if (hc.tech_completed_at) {
        entry.completedCount++

        if (hc.tech_started_at) {
          const mins = (new Date(hc.tech_completed_at).getTime() - new Date(hc.tech_started_at).getTime()) / (1000 * 60)
          if (mins > 0 && mins < 480) {
            entry.totalInspectionMinutes += mins
            entry.inspectionSampleCount++
          }
        }
      }

      // RAG counts
      entry.redFound += hc.red_count || 0
      entry.amberFound += hc.amber_count || 0
      entry.greenFound += hc.green_count || 0
    }

    const technicians = Array.from(techMap.values())
      .map(t => ({
        name: t.name,
        completedCount: t.completedCount,
        avgInspectionMinutes: t.inspectionSampleCount > 0
          ? Math.round(t.totalInspectionMinutes / t.inspectionSampleCount)
          : null,
        redFound: t.redFound,
        amberFound: t.amberFound,
        greenFound: t.greenFound
      }))
      .sort((a, b) => b.completedCount - a.completedCount)

    // ── Advisor performance ──
    for (const hc of healthChecks) {
      const advRaw = hc.advisor
      const adv = (Array.isArray(advRaw) ? advRaw[0] : advRaw) as { id: string; first_name: string; last_name: string } | null
      if (!adv?.id) continue

      if (!advisorMap.has(adv.id)) {
        advisorMap.set(adv.id, {
          name: `${adv.first_name} ${adv.last_name}`,
          sentCount: 0,
          totalProcessingMinutes: 0,
          processingSampleCount: 0,
          totalValueSent: 0,
          totalValueAuthorized: 0,
          authorizedCount: 0
        })
      }

      const entry = advisorMap.get(adv.id)!

      if (hc.sent_at) {
        entry.sentCount++
        entry.totalValueSent += repairValueByHc[hc.id] || 0

        // Processing time
        if (hc.tech_completed_at) {
          const mins = (new Date(hc.sent_at).getTime() - new Date(hc.tech_completed_at).getTime()) / (1000 * 60)
          if (mins > 0 && mins < 1440) {
            entry.totalProcessingMinutes += mins
            entry.processingSampleCount++
          }
        }
      }

      const authVal = authorizedValueByHc[hc.id] || 0
      if (authVal > 0) {
        entry.totalValueAuthorized += authVal
        entry.authorizedCount++
      }
    }

    const advisors = Array.from(advisorMap.values())
      .map(a => ({
        name: a.name,
        sentCount: a.sentCount,
        avgProcessingMinutes: a.processingSampleCount > 0
          ? Math.round(a.totalProcessingMinutes / a.processingSampleCount)
          : null,
        totalValueSent: Math.round(a.totalValueSent * 100) / 100,
        totalValueAuthorized: Math.round(a.totalValueAuthorized * 100) / 100,
        conversionRate: a.sentCount > 0
          ? Math.round((a.authorizedCount / a.sentCount) * 1000) / 10
          : 0
      }))
      .sort((a, b) => b.sentCount - a.sentCount)

    // ── Overdue deferred items (across org, not just today's HCs) ──
    let overdueCount = 0
    let overdueValue = 0
    {
      let overdueQuery = supabaseAdmin
        .from('repair_items')
        .select(`
          total_inc_vat,
          health_check:health_checks!inner(organization_id, site_id)
        `)
        .eq('outcome_status', 'deferred')
        .is('deleted_at', null)
        .lt('deferred_until', todayISO)
        .eq('health_check.organization_id', auth.orgId)

      if (site_id) {
        overdueQuery = overdueQuery.eq('health_check.site_id', site_id)
      }

      const { data: overdueItems, error: overdueError } = await overdueQuery

      if (!overdueError && overdueItems) {
        overdueCount = overdueItems.length
        overdueValue = overdueItems.reduce((sum, item) => sum + (Number(item.total_inc_vat) || 0), 0)
      }
    }

    // ── Financial conversion rate ──
    const conversionRate = totalIdentified > 0
      ? Math.round((totalAuthorized / totalIdentified) * 1000) / 10
      : 0

    return c.json({
      arrivals: {
        totalBookings,
        arrivedCount,
        awaitingCount,
        noShowCount,
        noShowRate: totalBookings > 0
          ? Math.round((noShowCount / totalBookings) * 1000) / 10
          : 0,
        customerWaitingCount
      },
      speed: {
        avgTechInspectionMinutes,
        techSampleSize: techTimes.length,
        avgAdvisorProcessingMinutes,
        advisorSampleSize: advisorTimes.length,
        avgAuthorizationMinutes,
        authSampleSize: authTimes.length
      },
      financial: {
        totalIdentified: Math.round(totalIdentified * 100) / 100,
        totalAuthorized: Math.round(totalAuthorized * 100) / 100,
        totalDeclined: Math.round(totalDeclined * 100) / 100,
        totalPending: Math.round(totalPending * 100) / 100,
        conversionRate
      },
      ragBreakdown: {
        red: {
          identifiedValue: Math.round(redIdentifiedValue * 100) / 100,
          authorizedValue: Math.round(redAuthorizedValue * 100) / 100,
          itemCount: redItemCount,
          authorizedCount: redAuthorizedCount
        },
        amber: {
          identifiedValue: Math.round(amberIdentifiedValue * 100) / 100,
          authorizedValue: Math.round(amberAuthorizedValue * 100) / 100,
          itemCount: amberItemCount,
          authorizedCount: amberAuthorizedCount
        },
        green: {
          identifiedValue: Math.round(greenIdentifiedValue * 100) / 100,
          authorizedValue: Math.round(greenAuthorizedValue * 100) / 100,
          itemCount: greenItemCount,
          authorizedCount: greenAuthorizedCount
        }
      },
      deferred: {
        todayCount: deferredTodayCount,
        todayValue: Math.round(deferredTodayValue * 100) / 100,
        overdueCount,
        overdueValue: Math.round(overdueValue * 100) / 100,
      },
      technicians,
      advisors,
      recentActivity
    })
  } catch (error) {
    console.error('Today KPI dashboard error:', error)
    return c.json({ error: 'Failed to fetch today KPI data' }, 500)
  }
})

export default dashboardToday
