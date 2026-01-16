import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const dashboard = new Hono()

dashboard.use('*', authMiddleware)

// Status groups for board columns
const statusGroups = {
  technician: ['created', 'assigned', 'in_progress', 'paused'],
  tech_done: ['tech_completed', 'awaiting_review', 'awaiting_pricing', 'awaiting_parts'],
  advisor: ['ready_to_send'],
  customer: ['sent', 'delivered', 'opened', 'partial_response'],
  actioned: ['authorized', 'declined', 'completed', 'expired', 'cancelled']
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
    const { date_from, date_to, technician_id, advisor_id, site_id } = c.req.query()

    // Build base filters
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()
    const tomorrowISO = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()

    // Date range filter (default: today)
    const startDate = date_from || todayISO
    const endDate = date_to || tomorrowISO

    // Get all health checks for the period
    let query = supabaseAdmin
      .from('health_checks')
      .select('id, status, created_at, sent_at, first_opened_at, technician_id, advisor_id, promised_at')
      .eq('organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lt('created_at', endDate)

    // Apply optional filters
    if (site_id) query = query.eq('site_id', site_id)
    if (technician_id) query = query.eq('technician_id', technician_id)
    if (advisor_id) query = query.eq('advisor_id', advisor_id)

    const { data: healthChecks, error } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Calculate metrics
    const totalToday = healthChecks?.length || 0
    const completedToday = healthChecks?.filter(hc => ['completed', 'authorized', 'declined'].includes(hc.status)).length || 0

    // Status counts (for period)
    const statusCounts: Record<string, number> = {}
    healthChecks?.forEach(hc => {
      statusCounts[hc.status] = (statusCounts[hc.status] || 0) + 1
    })

    // Column counts for board - get ALL active health checks regardless of date
    // This shows current workflow state, not just today's created items
    let activeQuery = supabaseAdmin
      .from('health_checks')
      .select('id, status')
      .eq('organization_id', auth.orgId)
      .not('status', 'in', '(completed,cancelled,expired)')

    if (site_id) activeQuery = activeQuery.eq('site_id', site_id)
    if (technician_id) activeQuery = activeQuery.eq('technician_id', technician_id)
    if (advisor_id) activeQuery = activeQuery.eq('advisor_id', advisor_id)

    const { data: activeHealthChecks } = await activeQuery

    const columnCounts = {
      technician: activeHealthChecks?.filter(hc => statusGroups.technician.includes(hc.status)).length || 0,
      tech_done: activeHealthChecks?.filter(hc => statusGroups.tech_done.includes(hc.status)).length || 0,
      advisor: activeHealthChecks?.filter(hc => statusGroups.advisor.includes(hc.status)).length || 0,
      customer: activeHealthChecks?.filter(hc => statusGroups.customer.includes(hc.status)).length || 0,
      actioned: activeHealthChecks?.filter(hc => statusGroups.actioned.includes(hc.status)).length || 0
    }

    // Calculate average response time (sent to first_opened)
    const responseTimes = healthChecks?.filter(hc => hc.sent_at && hc.first_opened_at)
      .map(hc => new Date(hc.first_opened_at).getTime() - new Date(hc.sent_at).getTime()) || []
    const avgResponseTimeMs = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0

    // Fetch repair item totals for value metrics
    const healthCheckIds = healthChecks?.map(hc => hc.id) || []
    let repairTotals: Record<string, number> = {}

    if (healthCheckIds.length > 0) {
      const { data: repairData } = await supabaseAdmin
        .from('repair_items')
        .select('health_check_id, total_price')
        .in('health_check_id', healthCheckIds)

      repairData?.forEach(item => {
        repairTotals[item.health_check_id] = (repairTotals[item.health_check_id] || 0) + (item.total_price || 0)
      })
    }

    // Value metrics
    const totalValueSent = healthChecks?.filter(hc => hc.sent_at).reduce((sum, hc) => sum + (repairTotals[hc.id] || 0), 0) || 0
    const totalValueAuthorized = healthChecks?.filter(hc => hc.status === 'authorized' || hc.status === 'completed')
      .reduce((sum, hc) => sum + (repairTotals[hc.id] || 0), 0) || 0
    const totalValueDeclined = healthChecks?.filter(hc => hc.status === 'declined')
      .reduce((sum, hc) => sum + (repairTotals[hc.id] || 0), 0) || 0

    // Conversion rate
    const sentCount = healthChecks?.filter(hc => hc.sent_at).length || 0
    const authorizedCount = healthChecks?.filter(hc => hc.status === 'authorized' || hc.status === 'completed').length || 0
    const conversionRate = sentCount > 0 ? (authorizedCount / sentCount) * 100 : 0

    // Get overdue items (past promise time and not completed)
    const now = new Date().toISOString()
    const { data: overdueItems } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('organization_id', auth.orgId)
      .not('status', 'in', '(completed,cancelled,expired)')
      .lt('promised_at', now)
      .not('promised_at', 'is', null)

    // Get items with expiring links (within 24 hours)
    const in24Hours = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const { data: expiringLinks } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('organization_id', auth.orgId)
      .in('status', ['sent', 'delivered', 'opened', 'partial_response'])
      .lt('token_expires_at', in24Hours)
      .gt('token_expires_at', now)

    return c.json({
      metrics: {
        totalToday,
        completedToday,
        conversionRate: Math.round(conversionRate * 10) / 10,
        avgResponseTimeMinutes: Math.round(avgResponseTimeMs / (1000 * 60)),
        totalValueSent,
        totalValueAuthorized,
        totalValueDeclined
      },
      statusCounts,
      columnCounts,
      alerts: {
        overdueCount: overdueItems?.length || 0,
        expiringLinksCount: expiringLinks?.length || 0
      },
      period: {
        from: startDate,
        to: endDate
      }
    })
  } catch (error) {
    console.error('Dashboard metrics error:', error)
    return c.json({ error: 'Failed to fetch dashboard metrics' }, 500)
  }
})

// GET /api/v1/dashboard/board - Kanban board data
dashboard.get('/board', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, technician_id, advisor_id, site_id } = c.req.query()

    // Default to last 7 days for board
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const startDate = date_from || sevenDaysAgo

    let query = supabaseAdmin
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
        vehicle:vehicles(id, registration, make, model),
        customer:customers(id, first_name, last_name),
        technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name)
      `)
      .eq('organization_id', auth.orgId)
      .not('status', 'in', '(completed,cancelled,expired)')
      .gte('created_at', startDate)
      .order('created_at', { ascending: false })

    if (site_id) query = query.eq('site_id', site_id)
    if (technician_id) query = query.eq('technician_id', technician_id)
    if (advisor_id) query = query.eq('advisor_id', advisor_id)
    if (date_to) query = query.lte('created_at', date_to)

    const { data: healthChecks, error } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
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

    // Fetch total amounts from repair_items for each health check
    const healthCheckIds = healthChecks?.map(hc => hc.id) || []
    let repairTotals: Record<string, number> = {}

    if (healthCheckIds.length > 0) {
      const { data: repairData } = await supabaseAdmin
        .from('repair_items')
        .select('health_check_id, total_price')
        .in('health_check_id', healthCheckIds)

      repairData?.forEach(item => {
        repairTotals[item.health_check_id] = (repairTotals[item.health_check_id] || 0) + (item.total_price || 0)
      })
    }

    healthChecks?.forEach(hc => {
      // Determine column
      let column = 'technician'
      if (statusGroups.tech_done.includes(hc.status)) column = 'tech_done'
      else if (statusGroups.advisor.includes(hc.status)) column = 'advisor'
      else if (statusGroups.customer.includes(hc.status)) column = 'customer'
      else if (statusGroups.actioned.includes(hc.status)) column = 'actioned'

      // Add SLA warnings and computed fields
      const card = {
        ...hc,
        promise_time: hc.promised_at, // Map for frontend compatibility
        total_amount: repairTotals[hc.id] || 0,
        isOverdue: hc.promised_at && new Date(hc.promised_at) < now,
        isExpiringSoon: hc.token_expires_at && new Date(hc.token_expires_at) < in24Hours && new Date(hc.token_expires_at) > now,
        validTransitions: validDragTransitions[hc.status] || []
      }

      columns[column]?.push(card)
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

    // Get all technicians in the org
    let techQuery = supabaseAdmin
      .from('users')
      .select('id, first_name, last_name, site_id')
      .eq('organization_id', auth.orgId)
      .eq('role', 'technician')
      .eq('is_active', true)

    if (site_id) techQuery = techQuery.eq('site_id', site_id)

    const { data: technicians, error: techError } = await techQuery

    if (techError) {
      return c.json({ error: techError.message }, 500)
    }

    // Get today's date range
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    // Get workload data for each technician
    const workloadData = await Promise.all(technicians?.map(async (tech) => {
      // Get current job (in_progress status)
      const { data: currentJob } = await supabaseAdmin
        .from('health_checks')
        .select(`
          id,
          status,
          created_at,
          vehicle:vehicles(registration, make, model)
        `)
        .eq('organization_id', auth.orgId)
        .eq('technician_id', tech.id)
        .eq('status', 'in_progress')
        .single()

      // Get current time entry (clocked in)
      const { data: currentTimeEntry } = await supabaseAdmin
        .from('technician_time_entries')
        .select('id, clock_in_at')
        .eq('technician_id', tech.id)
        .is('clock_out_at', null)
        .single()

      // Get queue count (assigned but not started)
      const { count: queueCount } = await supabaseAdmin
        .from('health_checks')
        .select('id', { count: 'exact' })
        .eq('organization_id', auth.orgId)
        .eq('technician_id', tech.id)
        .eq('status', 'assigned')

      // Get today's completed count
      const { count: completedToday } = await supabaseAdmin
        .from('health_checks')
        .select('id', { count: 'exact' })
        .eq('organization_id', auth.orgId)
        .eq('technician_id', tech.id)
        .in('status', ['tech_completed', 'awaiting_review', 'awaiting_pricing', 'awaiting_parts', 'ready_to_send', 'sent', 'delivered', 'opened', 'partial_response', 'authorized', 'declined', 'completed'])
        .gte('updated_at', todayISO)

      // Calculate time elapsed on current job
      let timeElapsedMinutes = 0
      if (currentTimeEntry?.clock_in_at) {
        timeElapsedMinutes = Math.round((Date.now() - new Date(currentTimeEntry.clock_in_at).getTime()) / (1000 * 60))
      }

      return {
        id: tech.id,
        firstName: tech.first_name,
        lastName: tech.last_name,
        siteId: tech.site_id,
        status: currentJob ? 'working' : (currentTimeEntry ? 'available' : 'idle'),
        currentJob: currentJob ? {
          id: currentJob.id,
          vehicle: currentJob.vehicle,
          timeElapsedMinutes
        } : null,
        queueCount: queueCount || 0,
        completedToday: completedToday || 0,
        isClockedIn: !!currentTimeEntry
      }
    }) || [])

    return c.json({
      technicians: workloadData,
      summary: {
        total: workloadData.length,
        working: workloadData.filter(t => t.status === 'working').length,
        available: workloadData.filter(t => t.status === 'available').length,
        idle: workloadData.filter(t => t.status === 'idle').length
      }
    })
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

    // Get recent status changes from health_check_status_history
    // First get health check IDs for this org
    const { data: orgHealthChecks } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('organization_id', auth.orgId)

    const healthCheckIds = orgHealthChecks?.map(hc => hc.id) || []

    if (healthCheckIds.length === 0) {
      return c.json({ activities: [], total: 0, limit: parseInt(limit), offset: parseInt(offset) })
    }

    const { data: activities, error, count } = await supabaseAdmin
      .from('health_check_status_history')
      .select(`
        id,
        from_status,
        to_status,
        changed_at,
        changed_by,
        health_check:health_checks(
          id,
          vehicle:vehicles(registration, make, model),
          technician:users!health_checks_technician_id_fkey(first_name, last_name),
          advisor:users!health_checks_advisor_id_fkey(first_name, last_name)
        ),
        user:users!health_check_status_history_changed_by_fkey(first_name, last_name, role)
      `, { count: 'exact' })
      .in('health_check_id', healthCheckIds)
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

    let baseQuery = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        promised_at,
        token_expires_at,
        created_at,
        vehicle:vehicles(registration, make, model),
        customer:customers(first_name, last_name),
        technician:users!health_checks_technician_id_fkey(first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(first_name, last_name)
      `)
      .eq('organization_id', auth.orgId)
      .not('status', 'in', '(completed,cancelled,expired)')

    if (site_id) baseQuery = baseQuery.eq('site_id', site_id)

    const { data: healthChecks, error } = await baseQuery

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    const now = new Date()
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    // Categorize into queues
    const needsAttention = healthChecks?.filter(hc => {
      const isOverdue = hc.promised_at && new Date(hc.promised_at) < now
      const isExpiring = hc.token_expires_at && new Date(hc.token_expires_at) < in24Hours && new Date(hc.token_expires_at) > now
      return isOverdue || isExpiring
    }).map(hc => ({
      ...hc,
      alertType: hc.promised_at && new Date(hc.promised_at) < now ? 'overdue' : 'expiring'
    })) || []

    const technicianQueue = healthChecks?.filter(hc =>
      statusGroups.technician.includes(hc.status)
    ) || []

    const advisorQueue = healthChecks?.filter(hc =>
      statusGroups.tech_done.includes(hc.status) || statusGroups.advisor.includes(hc.status)
    ) || []

    const customerQueue = healthChecks?.filter(hc =>
      statusGroups.customer.includes(hc.status)
    ) || []

    return c.json({
      needsAttention: {
        items: needsAttention.slice(0, 10),
        total: needsAttention.length
      },
      technicianQueue: {
        items: technicianQueue.slice(0, 10),
        total: technicianQueue.length
      },
      advisorQueue: {
        items: advisorQueue.slice(0, 10),
        total: advisorQueue.length
      },
      customerQueue: {
        items: customerQueue.slice(0, 10),
        total: customerQueue.length
      }
    })
  } catch (error) {
    console.error('Queues error:', error)
    return c.json({ error: 'Failed to fetch queues' }, 500)
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
