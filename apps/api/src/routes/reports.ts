import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const reports = new Hono()

reports.use('*', authMiddleware)

// GET /api/v1/reports - Reporting data with metrics
reports.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, technician_id, advisor_id, site_id, group_by = 'day' } = c.req.query()

    // Default to last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    // Get all health checks in the period with repair items for totals
    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        created_at,
        sent_at,
        first_opened_at,
        closed_at,
        green_count,
        amber_count,
        red_count,
        technician_id,
        advisor_id,
        technician:users!health_checks_technician_id_fkey(first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(first_name, last_name),
        repair_items(total_inc_vat, labour_total, parts_total)
      `)
      .eq('organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: true })

    if (site_id) query = query.eq('site_id', site_id)
    if (technician_id) query = query.eq('technician_id', technician_id)
    if (advisor_id) query = query.eq('advisor_id', advisor_id)

    const { data: healthChecks, error } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Calculate summary metrics
    const total = healthChecks?.length || 0
    const completed = healthChecks?.filter(hc => ['completed', 'authorized', 'declined'].includes(hc.status)).length || 0
    const sent = healthChecks?.filter(hc => hc.sent_at).length || 0
    const authorized = healthChecks?.filter(hc => hc.status === 'authorized' || hc.status === 'completed').length || 0
    const declined = healthChecks?.filter(hc => hc.status === 'declined').length || 0

    // Helper to calculate total from repair_items
    const getHealthCheckTotal = (hc: any) => {
      const repairItems = hc.repair_items as Array<{ total_inc_vat?: number }> | null
      return repairItems?.reduce((sum, item) => sum + (Number(item.total_inc_vat) || 0), 0) || 0
    }

    const totalValueIdentified = healthChecks?.reduce((sum, hc) => sum + getHealthCheckTotal(hc), 0) || 0
    const totalValueAuthorized = healthChecks?.filter(hc => hc.status === 'authorized' || hc.status === 'completed')
      .reduce((sum, hc) => sum + getHealthCheckTotal(hc), 0) || 0
    const totalValueDeclined = healthChecks?.filter(hc => hc.status === 'declined')
      .reduce((sum, hc) => sum + getHealthCheckTotal(hc), 0) || 0

    const conversionRate = sent > 0 ? (authorized / sent) * 100 : 0

    // Group data for chart
    const groupedData = groupByPeriod(healthChecks || [], group_by as 'day' | 'week' | 'month')

    // Calculate per-technician metrics
    const technicianMetrics = calculateTechnicianMetrics(healthChecks || [])

    // Calculate per-advisor metrics
    const advisorMetrics = calculateAdvisorMetrics(healthChecks || [])

    return c.json({
      period: {
        from: startDate,
        to: endDate
      },
      summary: {
        total,
        completed,
        sent,
        authorized,
        declined,
        pending: total - completed,
        conversionRate: Math.round(conversionRate * 10) / 10,
        totalValueIdentified,
        totalValueAuthorized,
        totalValueDeclined
      },
      chartData: groupedData,
      technicianMetrics,
      advisorMetrics
    })
  } catch (error) {
    console.error('Reports error:', error)
    return c.json({ error: 'Failed to fetch report data' }, 500)
  }
})

// GET /api/v1/reports/export - Export to CSV
reports.get('/export', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, technician_id, advisor_id, site_id, format = 'csv' } = c.req.query()

    // Default to last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    // Get all health checks in the period with full details
    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        created_at,
        sent_at,
        first_opened_at,
        closed_at,
        green_count,
        amber_count,
        red_count,
        mileage_in,
        vehicle:vehicles(registration, make, model, vin),
        customer:customers(first_name, last_name, email, phone),
        technician:users!health_checks_technician_id_fkey(first_name, last_name, email),
        advisor:users!health_checks_advisor_id_fkey(first_name, last_name, email),
        site:sites(name),
        repair_items(total_inc_vat, labour_total, parts_total)
      `)
      .eq('organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })

    if (site_id) query = query.eq('site_id', site_id)
    if (technician_id) query = query.eq('technician_id', technician_id)
    if (advisor_id) query = query.eq('advisor_id', advisor_id)

    const { data: healthChecks, error } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    if (format === 'csv') {
      // Generate CSV
      const csvHeaders = [
        'ID',
        'Status',
        'Created Date',
        'Sent Date',
        'Opened Date',
        'Closed Date',
        'Registration',
        'Make',
        'Model',
        'VIN',
        'Mileage',
        'Customer Name',
        'Customer Email',
        'Customer Phone',
        'Technician',
        'Advisor',
        'Site',
        'Green Count',
        'Amber Count',
        'Red Count',
        'Labour Total',
        'Parts Total',
        'Total Amount'
      ]

      const csvRows = healthChecks?.map(hc => {
        // Type assertion for joined relations (Supabase returns single objects for these joins)
        const vehicle = hc.vehicle as { registration?: string; make?: string; model?: string; vin?: string } | null
        const customer = hc.customer as { first_name?: string; last_name?: string; email?: string; phone?: string } | null
        const technician = hc.technician as { first_name?: string; last_name?: string; email?: string } | null
        const advisor = hc.advisor as { first_name?: string; last_name?: string; email?: string } | null
        const site = hc.site as { name?: string } | null
        const repairItems = hc.repair_items as Array<{ total_inc_vat?: number; labour_total?: number; parts_total?: number }> | null

        // Calculate totals from repair items
        const totalLabour = repairItems?.reduce((sum, item) => sum + (Number(item.labour_total) || 0), 0) || 0
        const totalParts = repairItems?.reduce((sum, item) => sum + (Number(item.parts_total) || 0), 0) || 0
        const totalAmount = repairItems?.reduce((sum, item) => sum + (Number(item.total_inc_vat) || 0), 0) || 0

        return [
          hc.id,
          hc.status,
          formatDate(hc.created_at),
          formatDate(hc.sent_at),
          formatDate(hc.first_opened_at),
          formatDate(hc.closed_at),
          vehicle?.registration || '',
          vehicle?.make || '',
          vehicle?.model || '',
          vehicle?.vin || '',
          hc.mileage_in || '',
          customer ? `${customer.first_name} ${customer.last_name}` : '',
          customer?.email || '',
          customer?.phone || '',
          technician ? `${technician.first_name} ${technician.last_name}` : '',
          advisor ? `${advisor.first_name} ${advisor.last_name}` : '',
          site?.name || '',
          hc.green_count || 0,
          hc.amber_count || 0,
          hc.red_count || 0,
          totalLabour,
          totalParts,
          totalAmount
        ]
      }) || []

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n')

      // Return CSV file
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="health-checks-report-${new Date().toISOString().split('T')[0]}.csv"`
        }
      })
    }

    // Return JSON if not CSV
    return c.json({
      healthChecks,
      total: healthChecks?.length || 0,
      period: { from: startDate, to: endDate }
    })
  } catch (error) {
    console.error('Export error:', error)
    return c.json({ error: 'Failed to export report' }, 500)
  }
})

// Helper: Group data by period
function groupByPeriod(healthChecks: any[], groupBy: 'day' | 'week' | 'month') {
  const grouped: Record<string, {
    period: string,
    total: number,
    completed: number,
    authorized: number,
    declined: number,
    value: number
  }> = {}

  healthChecks.forEach(hc => {
    const date = new Date(hc.created_at)
    let periodKey: string

    if (groupBy === 'day') {
      periodKey = date.toISOString().split('T')[0]
    } else if (groupBy === 'week') {
      // Get start of week (Monday)
      const weekStart = new Date(date)
      const day = weekStart.getDay()
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
      weekStart.setDate(diff)
      periodKey = weekStart.toISOString().split('T')[0]
    } else {
      // Month
      periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    }

    if (!grouped[periodKey]) {
      grouped[periodKey] = {
        period: periodKey,
        total: 0,
        completed: 0,
        authorized: 0,
        declined: 0,
        value: 0
      }
    }

    grouped[periodKey].total++

    if (['completed', 'authorized', 'declined'].includes(hc.status)) {
      grouped[periodKey].completed++
    }
    if (hc.status === 'authorized' || hc.status === 'completed') {
      grouped[periodKey].authorized++
      const repairItems = hc.repair_items as Array<{ total_inc_vat?: number }> | null
      grouped[periodKey].value += repairItems?.reduce((sum: number, item: any) => sum + (Number(item.total_inc_vat) || 0), 0) || 0
    }
    if (hc.status === 'declined') {
      grouped[periodKey].declined++
    }
  })

  // Sort by period and return array
  return Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period))
}

// Helper: Calculate per-technician metrics
function calculateTechnicianMetrics(healthChecks: any[]) {
  const techMetrics: Record<string, {
    id: string,
    name: string,
    total: number,
    completed: number,
    avgTimeMinutes: number
  }> = {}

  healthChecks.forEach(hc => {
    if (!hc.technician_id || !hc.technician) return

    const key = hc.technician_id
    if (!techMetrics[key]) {
      techMetrics[key] = {
        id: hc.technician_id,
        name: `${hc.technician.first_name} ${hc.technician.last_name}`,
        total: 0,
        completed: 0,
        avgTimeMinutes: 0
      }
    }

    techMetrics[key].total++
    if (['completed', 'authorized', 'declined', 'tech_completed', 'awaiting_review', 'awaiting_pricing', 'awaiting_parts', 'ready_to_send', 'sent'].includes(hc.status)) {
      techMetrics[key].completed++
    }
  })

  return Object.values(techMetrics).sort((a, b) => b.total - a.total)
}

// Helper: Calculate per-advisor metrics
function calculateAdvisorMetrics(healthChecks: any[]) {
  const advisorMetrics: Record<string, {
    id: string,
    name: string,
    total: number,
    sent: number,
    authorized: number,
    conversionRate: number,
    totalValue: number
  }> = {}

  healthChecks.forEach(hc => {
    if (!hc.advisor_id || !hc.advisor) return

    const key = hc.advisor_id
    if (!advisorMetrics[key]) {
      advisorMetrics[key] = {
        id: hc.advisor_id,
        name: `${hc.advisor.first_name} ${hc.advisor.last_name}`,
        total: 0,
        sent: 0,
        authorized: 0,
        conversionRate: 0,
        totalValue: 0
      }
    }

    advisorMetrics[key].total++
    if (hc.sent_at) advisorMetrics[key].sent++
    if (hc.status === 'authorized' || hc.status === 'completed') {
      advisorMetrics[key].authorized++
      const repairItems = hc.repair_items as Array<{ total_inc_vat?: number }> | null
      advisorMetrics[key].totalValue += repairItems?.reduce((sum: number, item: any) => sum + (Number(item.total_inc_vat) || 0), 0) || 0
    }
  })

  // Calculate conversion rates
  Object.values(advisorMetrics).forEach(m => {
    m.conversionRate = m.sent > 0 ? Math.round((m.authorized / m.sent) * 100 * 10) / 10 : 0
  })

  return Object.values(advisorMetrics).sort((a, b) => b.totalValue - a.totalValue)
}

// Helper: Format date for CSV
function formatDate(dateString: string | null): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toISOString().replace('T', ' ').substring(0, 19)
}

// GET /api/v1/reports/brake-disc-access - Report on "unable to access" brake disc usage
reports.get('/brake-disc-access', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { startDate: startDateParam, endDate: endDateParam, siteId, technicianId } = c.req.query()

    // Default to last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = startDateParam || thirtyDaysAgo.toISOString()
    const endDate = endDateParam || new Date().toISOString()

    // Query check_results with brake_measurement item type
    let query = supabaseAdmin
      .from('check_results')
      .select(`
        id,
        value,
        created_at,
        health_check:health_checks!inner(
          id,
          site_id,
          technician_id,
          organization_id,
          created_at,
          technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
          vehicle:vehicles(registration)
        ),
        template_item:template_items!inner(
          item_type,
          name
        )
      `)
      .eq('health_check.organization_id', auth.orgId)
      .eq('template_item.item_type', 'brake_measurement')
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })

    if (siteId) {
      query = query.eq('health_check.site_id', siteId)
    }
    if (technicianId) {
      query = query.eq('health_check.technician_id', technicianId)
    }

    const { data: results, error } = await query

    if (error) {
      console.error('Brake disc access report error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Process results to find unable_to_access instances
    const unableToAccessInstances: Array<{
      healthCheckId: string
      vehicleReg: string
      technicianId: string
      technicianName: string
      itemName: string
      side: string
      createdAt: string
    }> = []

    const byTechnician: Record<string, { id: string; name: string; unableToAccess: number; notMeasured: number; healthCheckIds: Set<string> }> = {}
    const byAxle = {
      front: { nearside: 0, offside: 0 },
      rear: { nearside: 0, offside: 0 }
    }

    let totalHealthChecks = 0
    let unableToAccessCount = 0
    let notMeasuredCount = 0
    const seenHealthChecks = new Set<string>()

    for (const result of results || []) {
      // Supabase returns arrays for joins, but with !inner it's a single object
      const healthCheckData = result.health_check as unknown as {
        id: string
        technician_id: string
        technician: { id: string; first_name: string; last_name: string } | null
        vehicle: { registration: string } | null
      }
      const templateItemData = result.template_item as unknown as { item_type: string; name: string }
      const healthCheck = healthCheckData
      const templateItem = templateItemData
      const value = result.value as Record<string, unknown> | null

      if (!value) continue

      // Track unique health checks
      if (!seenHealthChecks.has(healthCheck.id)) {
        seenHealthChecks.add(healthCheck.id)
        totalHealthChecks++
      }

      // Check for nearside unable_to_access
      const nearside = value.nearside as Record<string, unknown> | undefined
      const offside = value.offside as Record<string, unknown> | undefined

      // Determine axle from item name
      const itemName = templateItem.name?.toLowerCase() || ''
      const axleKey = itemName.includes('front') ? 'front' : itemName.includes('rear') ? 'rear' : null

      const technicianName = healthCheck.technician
        ? `${healthCheck.technician.first_name} ${healthCheck.technician.last_name}`
        : 'Unknown'

      // Initialize technician tracking if needed
      if (healthCheck.technician_id && !byTechnician[healthCheck.technician_id]) {
        byTechnician[healthCheck.technician_id] = {
          id: healthCheck.technician_id,
          name: technicianName,
          unableToAccess: 0,
          notMeasured: 0,
          healthCheckIds: new Set<string>()
        }
      }

      // Track health check for this technician
      if (healthCheck.technician_id) {
        byTechnician[healthCheck.technician_id].healthCheckIds.add(healthCheck.id)
      }

      // Check nearside disc
      if (nearside?.disc_unable_to_access) {
        unableToAccessCount++
        if (axleKey) byAxle[axleKey].nearside++

        if (healthCheck.technician_id) {
          byTechnician[healthCheck.technician_id].unableToAccess++
        }

        unableToAccessInstances.push({
          healthCheckId: healthCheck.id,
          vehicleReg: healthCheck.vehicle?.registration || 'Unknown',
          technicianId: healthCheck.technician_id,
          technicianName,
          itemName: templateItem.name,
          side: `${axleKey || 'unknown'}-nearside`,
          createdAt: result.created_at as string
        })
      } else if (nearside?.disc === null || nearside?.disc === undefined) {
        // Not measured: disc is null/undefined AND not marked as unable to access
        notMeasuredCount++
        if (healthCheck.technician_id) {
          byTechnician[healthCheck.technician_id].notMeasured++
        }
      }

      // Check offside disc
      if (offside?.disc_unable_to_access) {
        unableToAccessCount++
        if (axleKey) byAxle[axleKey].offside++

        if (healthCheck.technician_id) {
          byTechnician[healthCheck.technician_id].unableToAccess++
        }

        unableToAccessInstances.push({
          healthCheckId: healthCheck.id,
          vehicleReg: healthCheck.vehicle?.registration || 'Unknown',
          technicianId: healthCheck.technician_id,
          technicianName,
          itemName: templateItem.name,
          side: `${axleKey || 'unknown'}-offside`,
          createdAt: result.created_at as string
        })
      } else if (offside?.disc === null || offside?.disc === undefined) {
        // Not measured: disc is null/undefined AND not marked as unable to access
        notMeasuredCount++
        if (healthCheck.technician_id) {
          byTechnician[healthCheck.technician_id].notMeasured++
        }
      }
    }

    // Calculate percentages for technicians (including both metrics)
    const byTechnicianArray = Object.values(byTechnician)
      .map(tech => ({
        technicianId: tech.id,
        technicianName: tech.name,
        unableToAccessCount: tech.unableToAccess,
        notMeasuredCount: tech.notMeasured,
        totalHealthChecks: tech.healthCheckIds.size,
        // Legacy 'total' field for backwards compatibility
        total: tech.unableToAccess
      }))
      .sort((a, b) => (b.unableToAccessCount + b.notMeasuredCount) - (a.unableToAccessCount + a.notMeasuredCount))

    return c.json({
      period: {
        from: startDate,
        to: endDate
      },
      totalHealthChecks,
      unableToAccessCount,
      notMeasuredCount,
      byTechnician: byTechnicianArray,
      byAxle,
      recentInstances: unableToAccessInstances.slice(0, 20)
    })
  } catch (error) {
    console.error('Brake disc access report error:', error)
    return c.json({ error: 'Failed to fetch brake disc access report' }, 500)
  }
})

// GET /api/v1/reports/mri-bypass - Report on MRI scan bypass during check-in
reports.get('/mri-bypass', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { startDate: startDateParam, endDate: endDateParam, siteId, advisorId } = c.req.query()

    // Default to last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = startDateParam || thirtyDaysAgo.toISOString()
    const endDate = endDateParam || new Date().toISOString()

    // Query health checks that have been checked in (have checked_in_at)
    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        checked_in_at,
        checked_in_by,
        mri_items_total,
        mri_items_completed,
        mri_bypassed,
        site_id,
        advisor:users!health_checks_checked_in_by_fkey(id, first_name, last_name),
        vehicle:vehicles(registration),
        site:sites(name)
      `)
      .eq('organization_id', auth.orgId)
      .not('checked_in_at', 'is', null)
      .gte('checked_in_at', startDate)
      .lte('checked_in_at', endDate)
      .order('checked_in_at', { ascending: false })

    if (siteId) {
      query = query.eq('site_id', siteId)
    }
    if (advisorId) {
      query = query.eq('checked_in_by', advisorId)
    }

    const { data: healthChecks, error } = await query

    if (error) {
      console.error('MRI bypass report error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Calculate summary statistics
    const totalCheckins = healthChecks?.length || 0
    const bypassedCheckins = healthChecks?.filter(hc => hc.mri_bypassed).length || 0
    const completedMri = totalCheckins - bypassedCheckins
    const bypassRate = totalCheckins > 0 ? Math.round((bypassedCheckins / totalCheckins) * 100 * 10) / 10 : 0

    // Group by advisor
    const byAdvisor: Record<string, {
      id: string
      name: string
      totalCheckins: number
      bypassed: number
      bypassRate: number
      avgCompletionRate: number
    }> = {}

    for (const hc of healthChecks || []) {
      if (!hc.checked_in_by) continue

      const advisor = hc.advisor as unknown as { id: string; first_name: string; last_name: string } | null
      const advisorKey = hc.checked_in_by

      if (!byAdvisor[advisorKey]) {
        byAdvisor[advisorKey] = {
          id: advisorKey,
          name: advisor ? `${advisor.first_name} ${advisor.last_name}` : 'Unknown',
          totalCheckins: 0,
          bypassed: 0,
          bypassRate: 0,
          avgCompletionRate: 0
        }
      }

      byAdvisor[advisorKey].totalCheckins++
      if (hc.mri_bypassed) {
        byAdvisor[advisorKey].bypassed++
      }

      // Track completion rate
      if (hc.mri_items_total && hc.mri_items_total > 0) {
        const completionRate = (hc.mri_items_completed || 0) / hc.mri_items_total
        byAdvisor[advisorKey].avgCompletionRate += completionRate
      }
    }

    // Calculate final rates for each advisor
    const advisorStats = Object.values(byAdvisor).map(a => ({
      ...a,
      bypassRate: a.totalCheckins > 0 ? Math.round((a.bypassed / a.totalCheckins) * 100 * 10) / 10 : 0,
      avgCompletionRate: a.totalCheckins > 0 ? Math.round((a.avgCompletionRate / a.totalCheckins) * 100 * 10) / 10 : 0
    })).sort((a, b) => b.bypassed - a.bypassed)

    // Recent bypassed instances for detail view
    const recentBypassed = (healthChecks || [])
      .filter(hc => hc.mri_bypassed)
      .slice(0, 20)
      .map(hc => {
        const advisor = hc.advisor as unknown as { id: string; first_name: string; last_name: string } | null
        const vehicle = hc.vehicle as unknown as { registration: string } | null
        const site = hc.site as unknown as { name: string } | null
        return {
          healthCheckId: hc.id,
          vehicleReg: vehicle?.registration || 'Unknown',
          advisorId: hc.checked_in_by,
          advisorName: advisor ? `${advisor.first_name} ${advisor.last_name}` : 'Unknown',
          siteName: site?.name || 'Unknown',
          checkedInAt: hc.checked_in_at,
          mriItemsTotal: hc.mri_items_total || 0,
          mriItemsCompleted: hc.mri_items_completed || 0,
          completionRate: hc.mri_items_total && hc.mri_items_total > 0
            ? Math.round(((hc.mri_items_completed || 0) / hc.mri_items_total) * 100)
            : 0
        }
      })

    return c.json({
      period: {
        from: startDate,
        to: endDate
      },
      summary: {
        totalCheckins,
        completedMri,
        bypassedCheckins,
        bypassRate
      },
      byAdvisor: advisorStats,
      recentBypassed
    })
  } catch (error) {
    console.error('MRI bypass report error:', error)
    return c.json({ error: 'Failed to fetch MRI bypass report' }, 500)
  }
})

export default reports
