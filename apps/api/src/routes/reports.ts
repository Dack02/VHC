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

// ============================================================================
// FINANCIAL REPORTS
// ============================================================================

reports.get('/financial', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id, group_by = 'day' } = c.req.query()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    // Get repair items with health check context
    let query = supabaseAdmin
      .from('repair_items')
      .select(`
        id,
        name,
        labour_total,
        parts_total,
        subtotal,
        vat_amount,
        total_inc_vat,
        price_override,
        price_override_reason,
        outcome_status,
        created_at,
        health_check:health_checks!inner(
          id,
          status,
          created_at,
          organization_id,
          site_id,
          advisor_id,
          advisor:users!health_checks_advisor_id_fkey(first_name, last_name)
        )
      `)
      .eq('health_check.organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .is('deleted_at', null)

    if (site_id) query = query.eq('health_check.site_id', site_id)

    const { data: items, error } = await query

    if (error) {
      console.error('Financial report error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Revenue overview
    let totalIdentified = 0
    let totalAuthorized = 0
    let totalDeclined = 0
    let totalDeferred = 0
    let totalLabour = 0
    let totalParts = 0

    // Top items tracking
    const itemAggregates: Record<string, { name: string; count: number; totalValue: number; authorizedCount: number }> = {}

    // Price overrides
    const priceOverrides: Array<{
      name: string
      originalTotal: number
      overrideAmount: number
      reason: string | null
      advisorName: string
    }> = []

    // Revenue over time
    const revenueByPeriod: Record<string, { period: string; identified: number; authorized: number; declined: number }> = {}

    for (const item of items || []) {
      const value = Number(item.total_inc_vat) || 0
      const labour = Number(item.labour_total) || 0
      const parts = Number(item.parts_total) || 0

      totalIdentified += value
      totalLabour += labour
      totalParts += parts

      if (item.outcome_status === 'authorised') {
        totalAuthorized += value
      } else if (item.outcome_status === 'declined') {
        totalDeclined += value
      } else if (item.outcome_status === 'deferred') {
        totalDeferred += value
      }

      // Aggregate by item name
      const name = item.name || 'Unknown'
      if (!itemAggregates[name]) {
        itemAggregates[name] = { name, count: 0, totalValue: 0, authorizedCount: 0 }
      }
      itemAggregates[name].count++
      itemAggregates[name].totalValue += value
      if (item.outcome_status === 'authorised') {
        itemAggregates[name].authorizedCount++
      }

      // Price overrides
      if (item.price_override != null) {
        const hc = item.health_check as any
        const advisor = hc?.advisor
        priceOverrides.push({
          name,
          originalTotal: value,
          overrideAmount: Number(item.price_override),
          reason: item.price_override_reason as string | null,
          advisorName: advisor ? `${advisor.first_name} ${advisor.last_name}` : 'Unknown',
        })
      }

      // Revenue by period
      const date = new Date(item.created_at as string)
      let periodKey: string
      if (group_by === 'week') {
        const weekStart = new Date(date)
        const day = weekStart.getDay()
        const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
        weekStart.setDate(diff)
        periodKey = weekStart.toISOString().split('T')[0]
      } else if (group_by === 'month') {
        periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      } else {
        periodKey = date.toISOString().split('T')[0]
      }

      if (!revenueByPeriod[periodKey]) {
        revenueByPeriod[periodKey] = { period: periodKey, identified: 0, authorized: 0, declined: 0 }
      }
      revenueByPeriod[periodKey].identified += value
      if (item.outcome_status === 'authorised') revenueByPeriod[periodKey].authorized += value
      if (item.outcome_status === 'declined') revenueByPeriod[periodKey].declined += value
    }

    const topItems = Object.values(itemAggregates)
      .map(i => ({
        ...i,
        avgValue: i.count > 0 ? Math.round(i.totalValue / i.count * 100) / 100 : 0,
        authRate: i.count > 0 ? Math.round((i.authorizedCount / i.count) * 100 * 10) / 10 : 0,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 20)

    const captureRate = totalIdentified > 0
      ? Math.round((totalAuthorized / totalIdentified) * 100 * 10) / 10
      : 0

    const revenueTimeline = Object.values(revenueByPeriod).sort((a, b) => a.period.localeCompare(b.period))

    return c.json({
      period: { from: startDate, to: endDate },
      overview: {
        totalIdentified: Math.round(totalIdentified * 100) / 100,
        totalAuthorized: Math.round(totalAuthorized * 100) / 100,
        totalDeclined: Math.round(totalDeclined * 100) / 100,
        totalDeferred: Math.round(totalDeferred * 100) / 100,
        captureRate,
        labourTotal: Math.round(totalLabour * 100) / 100,
        partsTotal: Math.round(totalParts * 100) / 100,
        labourPercent: (totalLabour + totalParts) > 0
          ? Math.round((totalLabour / (totalLabour + totalParts)) * 100 * 10) / 10
          : 0,
      },
      revenueTimeline,
      topItems,
      priceOverrides: priceOverrides.slice(0, 50),
    })
  } catch (error) {
    console.error('Financial report error:', error)
    return c.json({ error: 'Failed to fetch financial report' }, 500)
  }
})

// ============================================================================
// TECHNICIAN PERFORMANCE
// ============================================================================

reports.get('/technicians', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id, technician_id } = c.req.query()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        created_at,
        tech_started_at,
        tech_completed_at,
        technician_id,
        green_count,
        amber_count,
        red_count,
        technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
        repair_items(total_inc_vat, outcome_status)
      `)
      .eq('organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .not('technician_id', 'is', null)

    if (site_id) query = query.eq('site_id', site_id)
    if (technician_id) query = query.eq('technician_id', technician_id)

    const { data: healthChecks, error } = await query

    if (error) {
      console.error('Technician report error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Aggregate per technician
    const techData: Record<string, {
      id: string
      name: string
      assigned: number
      completed: number
      inspectionTimes: number[]
      redCount: number
      amberCount: number
      greenCount: number
      revenueIdentified: number
      totalInspectedItems: number
      libraryOnlyCount: number
      freeTextOnlyCount: number
      bothCount: number
      noReasonCount: number
    }> = {}

    // Time distribution buckets (minutes)
    const timeBuckets = { '0-15': 0, '15-30': 0, '30-45': 0, '45-60': 0, '60+': 0 }

    for (const hc of healthChecks || []) {
      if (!hc.technician_id || !hc.technician) continue
      const tech = hc.technician as unknown as { id: string; first_name: string; last_name: string }
      const key = hc.technician_id

      if (!techData[key]) {
        techData[key] = {
          id: key,
          name: `${tech.first_name} ${tech.last_name}`,
          assigned: 0,
          completed: 0,
          inspectionTimes: [],
          redCount: 0,
          amberCount: 0,
          greenCount: 0,
          revenueIdentified: 0,
          totalInspectedItems: 0,
          libraryOnlyCount: 0,
          freeTextOnlyCount: 0,
          bothCount: 0,
          noReasonCount: 0,
        }
      }

      techData[key].assigned++
      techData[key].redCount += hc.red_count || 0
      techData[key].amberCount += hc.amber_count || 0
      techData[key].greenCount += hc.green_count || 0

      // Revenue identified
      const items = hc.repair_items as Array<{ total_inc_vat?: number; outcome_status?: string }> | null
      techData[key].revenueIdentified += items?.reduce((s, i) => s + (Number(i.total_inc_vat) || 0), 0) || 0

      // Inspection time calculation
      if (hc.tech_started_at && hc.tech_completed_at) {
        techData[key].completed++
        const startTime = new Date(hc.tech_started_at).getTime()
        const endTime = new Date(hc.tech_completed_at).getTime()
        const minutes = (endTime - startTime) / 60000
        if (minutes > 0 && minutes < 480) { // Ignore unreasonable values (> 8 hours)
          techData[key].inspectionTimes.push(minutes)
          if (minutes <= 15) timeBuckets['0-15']++
          else if (minutes <= 30) timeBuckets['15-30']++
          else if (minutes <= 45) timeBuckets['30-45']++
          else if (minutes <= 60) timeBuckets['45-60']++
          else timeBuckets['60+']++
        }
      } else if (['tech_completed', 'awaiting_review', 'awaiting_pricing', 'awaiting_parts', 'ready_to_send', 'sent', 'completed', 'authorized', 'declined'].includes(hc.status)) {
        techData[key].completed++
      }
    }

    // --- Reason library vs free text usage ---
    const hcIds = (healthChecks || []).filter(hc => hc.technician_id).map(hc => hc.id)
    // Map health_check_id → technician_id for attribution
    const hcTechMap: Record<string, string> = {}
    for (const hc of healthChecks || []) {
      if (hc.technician_id) hcTechMap[hc.id] = hc.technician_id
    }

    if (hcIds.length > 0) {
      // Fetch in batches of 500 to avoid query-string limits
      const batchSize = 500
      for (let i = 0; i < hcIds.length; i += batchSize) {
        const batch = hcIds.slice(i, i + batchSize)
        const { data: checkResults } = await supabaseAdmin
          .from('check_results')
          .select('id, health_check_id, checked_by, notes, custom_reason_text, rag_status, check_result_reasons(id)')
          .in('health_check_id', batch)
          .not('rag_status', 'is', null)

        for (const cr of checkResults || []) {
          const techId = (cr.checked_by as string | null) || hcTechMap[cr.health_check_id]
          if (!techId || !techData[techId]) continue

          const hasLibrary = Array.isArray(cr.check_result_reasons) && cr.check_result_reasons.length > 0
          const hasFreeText = !!((cr.notes && (cr.notes as string).trim()) || (cr.custom_reason_text && (cr.custom_reason_text as string).trim()))

          techData[techId].totalInspectedItems++
          if (hasLibrary && hasFreeText) techData[techId].bothCount++
          else if (hasLibrary) techData[techId].libraryOnlyCount++
          else if (hasFreeText) techData[techId].freeTextOnlyCount++
          else techData[techId].noReasonCount++
        }
      }
    }

    // Build leaderboard
    const leaderboard = Object.values(techData)
      .map(t => ({
        id: t.id,
        name: t.name,
        assigned: t.assigned,
        completed: t.completed,
        completionRate: t.assigned > 0 ? Math.round((t.completed / t.assigned) * 100 * 10) / 10 : 0,
        avgInspectionTime: t.inspectionTimes.length > 0
          ? Math.round(t.inspectionTimes.reduce((a, b) => a + b, 0) / t.inspectionTimes.length * 10) / 10
          : 0,
        avgRedAmber: t.assigned > 0
          ? Math.round(((t.redCount + t.amberCount) / t.assigned) * 10) / 10
          : 0,
        revenueIdentified: Math.round(t.revenueIdentified * 100) / 100,
        totalInspectedItems: t.totalInspectedItems,
        libraryOnlyCount: t.libraryOnlyCount,
        freeTextOnlyCount: t.freeTextOnlyCount,
        bothCount: t.bothCount,
        noReasonCount: t.noReasonCount,
        libraryUsageRate: (() => {
          const denominator = t.libraryOnlyCount + t.freeTextOnlyCount + t.bothCount
          return denominator > 0
            ? Math.round(((t.libraryOnlyCount + t.bothCount) / denominator) * 1000) / 10
            : 0
        })(),
      }))
      .sort((a, b) => b.assigned - a.assigned)

    // Time by tech chart data
    const timeByTech = leaderboard
      .filter(t => t.avgInspectionTime > 0)
      .map(t => ({ name: t.name, avgTime: t.avgInspectionTime }))
      .sort((a, b) => b.avgTime - a.avgTime)

    // Time distribution
    const timeDistribution = Object.entries(timeBuckets).map(([bucket, count]) => ({
      bucket,
      count,
    }))

    // Reason usage chart data
    const reasonUsageByTech = leaderboard
      .filter(t => (t.libraryOnlyCount + t.freeTextOnlyCount + t.bothCount) > 0)
      .map(t => ({
        name: t.name,
        libraryOnly: t.libraryOnlyCount,
        freeTextOnly: t.freeTextOnlyCount,
        both: t.bothCount,
      }))
      .sort((a, b) => (b.libraryOnly + b.both + b.freeTextOnly) - (a.libraryOnly + a.both + a.freeTextOnly))

    return c.json({
      period: { from: startDate, to: endDate },
      leaderboard,
      timeByTech,
      timeDistribution,
      reasonUsageByTech,
    })
  } catch (error) {
    console.error('Technician report error:', error)
    return c.json({ error: 'Failed to fetch technician report' }, 500)
  }
})

// ============================================================================
// ADVISOR PERFORMANCE
// ============================================================================

reports.get('/advisors', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id, advisor_id } = c.req.query()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        created_at,
        sent_at,
        first_opened_at,
        tech_completed_at,
        advisor_id,
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name),
        repair_items(total_inc_vat, outcome_status, deleted_at),
        mri_scan_results(not_applicable, completed_by)
      `)
      .eq('organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .not('advisor_id', 'is', null)

    if (site_id) query = query.eq('site_id', site_id)
    if (advisor_id) query = query.eq('advisor_id', advisor_id)

    const { data: healthChecks, error } = await query

    if (error) {
      console.error('Advisor report error:', error)
      return c.json({ error: error.message }, 500)
    }

    const advisorData: Record<string, {
      id: string
      name: string
      managed: number
      sent: number
      authorized: number
      pricingTimes: number[]
      valueIdentified: number
      valueAuthorized: number
      valueDeclined: number
      responseTimes: number[]
      deferredCount: number
      deferredValue: number
      mriNaCount: number
      itemAuthorisedValue: number
    }> = {}

    // Aging checks (sent but not responded)
    const agingChecks: Array<{
      healthCheckId: string
      advisorName: string
      sentAt: string
      daysWaiting: number
    }> = []

    for (const hc of healthChecks || []) {
      if (!hc.advisor_id || !hc.advisor) continue
      const advisor = hc.advisor as unknown as { id: string; first_name: string; last_name: string }
      const key = hc.advisor_id

      if (!advisorData[key]) {
        advisorData[key] = {
          id: key,
          name: `${advisor.first_name} ${advisor.last_name}`,
          managed: 0,
          sent: 0,
          authorized: 0,
          pricingTimes: [],
          valueIdentified: 0,
          valueAuthorized: 0,
          valueDeclined: 0,
          responseTimes: [],
          deferredCount: 0,
          deferredValue: 0,
          mriNaCount: 0,
          itemAuthorisedValue: 0,
        }
      }

      advisorData[key].managed++
      const items = hc.repair_items as Array<{ total_inc_vat?: number; outcome_status?: string; deleted_at?: string | null }> | null
      const activeItems = items?.filter(i => !i.deleted_at) || []
      const hcValue = activeItems.reduce((s, i) => s + (Number(i.total_inc_vat) || 0), 0)
      advisorData[key].valueIdentified += hcValue

      // Deferred and authorised item-level tracking
      for (const item of activeItems) {
        if (item.outcome_status === 'deferred') {
          advisorData[key].deferredCount++
          advisorData[key].deferredValue += Number(item.total_inc_vat) || 0
        }
        if (item.outcome_status === 'authorised') {
          advisorData[key].itemAuthorisedValue += Number(item.total_inc_vat) || 0
        }
      }

      // MRI N/A count
      const mriResults = hc.mri_scan_results as Array<{ not_applicable?: boolean; completed_by?: string }> | null
      if (mriResults) {
        for (const mri of mriResults) {
          if (mri.not_applicable) advisorData[key].mriNaCount++
        }
      }

      if (hc.sent_at) {
        advisorData[key].sent++

        // Response time
        if (hc.first_opened_at) {
          const sentTime = new Date(hc.sent_at).getTime()
          const openedTime = new Date(hc.first_opened_at).getTime()
          const hours = (openedTime - sentTime) / 3600000
          if (hours >= 0) advisorData[key].responseTimes.push(hours)
        }

        // Aging checks
        const isResponded = ['authorized', 'completed', 'declined', 'customer_approved', 'customer_partial', 'customer_declined'].includes(hc.status)
        if (!isResponded && hc.sent_at) {
          const daysWaiting = (Date.now() - new Date(hc.sent_at).getTime()) / 86400000
          if (daysWaiting >= 1) {
            agingChecks.push({
              healthCheckId: hc.id,
              advisorName: `${advisor.first_name} ${advisor.last_name}`,
              sentAt: hc.sent_at,
              daysWaiting: Math.round(daysWaiting * 10) / 10,
            })
          }
        }
      }

      if (hc.status === 'authorized' || hc.status === 'completed') {
        advisorData[key].authorized++
        advisorData[key].valueAuthorized += hcValue
      } else if (hc.status === 'declined') {
        advisorData[key].valueDeclined += hcValue
      }

      // Pricing time
      if (hc.tech_completed_at && hc.sent_at) {
        const techDone = new Date(hc.tech_completed_at).getTime()
        const sentTime = new Date(hc.sent_at).getTime()
        const hours = (sentTime - techDone) / 3600000
        if (hours >= 0 && hours < 168) { // Max 1 week
          advisorData[key].pricingTimes.push(hours)
        }
      }
    }

    const leaderboard = Object.values(advisorData)
      .map(a => ({
        id: a.id,
        name: a.name,
        managed: a.managed,
        sent: a.sent,
        sendRate: a.managed > 0 ? Math.round((a.sent / a.managed) * 100 * 10) / 10 : 0,
        authorized: a.authorized,
        conversionRate: a.sent > 0 ? Math.round((a.authorized / a.sent) * 100 * 10) / 10 : 0,
        valueIdentified: Math.round(a.valueIdentified * 100) / 100,
        valueAuthorized: Math.round(a.valueAuthorized * 100) / 100,
        valueDeclined: Math.round(a.valueDeclined * 100) / 100,
        avgPricingHours: a.pricingTimes.length > 0
          ? Math.round(a.pricingTimes.reduce((x, y) => x + y, 0) / a.pricingTimes.length * 10) / 10
          : 0,
        avgResponseHours: a.responseTimes.length > 0
          ? Math.round(a.responseTimes.reduce((x, y) => x + y, 0) / a.responseTimes.length * 10) / 10
          : 0,
        mriNaCount: a.mriNaCount,
        deferredCount: a.deferredCount,
        deferredValue: Math.round(a.deferredValue * 100) / 100,
        avgIdentifiedValue: a.managed > 0 ? Math.round((a.valueIdentified / a.managed) * 100) / 100 : 0,
        avgSoldValue: a.managed > 0 ? Math.round((a.itemAuthorisedValue / a.managed) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.valueAuthorized - a.valueAuthorized)

    // Funnel comparison data
    const funnelComparison = leaderboard.map(a => ({
      name: a.name,
      managed: a.managed,
      sent: a.sent,
      authorized: a.authorized,
    }))

    return c.json({
      period: { from: startDate, to: endDate },
      leaderboard,
      funnelComparison,
      agingChecks: agingChecks.sort((a, b) => b.daysWaiting - a.daysWaiting).slice(0, 20),
    })
  } catch (error) {
    console.error('Advisor report error:', error)
    return c.json({ error: 'Failed to fetch advisor report' }, 500)
  }
})

// ============================================================================
// CUSTOMER INSIGHTS
// ============================================================================

reports.get('/customers', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id } = c.req.query()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        sent_at,
        first_opened_at,
        customer_id,
        customer:customers(id, first_name, last_name),
        repair_items(total_inc_vat, outcome_status, declined_reason:declined_reasons(reason))
      `)
      .eq('organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)

    if (site_id) query = query.eq('site_id', site_id)

    const { data: healthChecks, error } = await query

    if (error) {
      console.error('Customer report error:', error)
      return c.json({ error: error.message }, 500)
    }

    let reportsSent = 0
    let reportsOpened = 0
    const openTimes: number[] = []
    const declinedReasons: Record<string, { reason: string; count: number; value: number }> = {}
    const customerCounts: Record<string, number> = {}

    // Response by day of week
    const byDayOfWeek = [0, 0, 0, 0, 0, 0, 0] // Sun-Sat

    for (const hc of healthChecks || []) {
      if (hc.customer_id) {
        customerCounts[hc.customer_id] = (customerCounts[hc.customer_id] || 0) + 1
      }

      if (hc.sent_at) {
        reportsSent++
        if (hc.first_opened_at) {
          reportsOpened++
          const sentTime = new Date(hc.sent_at).getTime()
          const openTime = new Date(hc.first_opened_at).getTime()
          const hours = (openTime - sentTime) / 3600000
          if (hours >= 0) openTimes.push(hours)
        }
      }

      // Response time (sent to any status change beyond sent)
      if (hc.sent_at && ['authorized', 'completed', 'declined', 'customer_approved', 'customer_partial', 'customer_declined'].includes(hc.status)) {
        const day = new Date(hc.sent_at).getDay()
        byDayOfWeek[day]++
      }

      // Declined reasons from repair items
      const items = hc.repair_items as unknown as Array<{
        total_inc_vat?: number
        outcome_status?: string
        declined_reason?: { reason: string } | null
      }> | null

      for (const item of items || []) {
        if (item.outcome_status === 'declined' && item.declined_reason) {
          const reason = (item.declined_reason as any)?.reason || 'No reason given'
          if (!declinedReasons[reason]) {
            declinedReasons[reason] = { reason, count: 0, value: 0 }
          }
          declinedReasons[reason].count++
          declinedReasons[reason].value += Number(item.total_inc_vat) || 0
        }
      }
    }

    const openRate = reportsSent > 0 ? Math.round((reportsOpened / reportsSent) * 100 * 10) / 10 : 0
    const avgTimeToOpen = openTimes.length > 0
      ? Math.round(openTimes.reduce((a, b) => a + b, 0) / openTimes.length * 10) / 10
      : 0

    // Response time distribution
    const responseDistribution = [
      { bucket: '<1hr', count: openTimes.filter(t => t < 1).length },
      { bucket: '1-4hr', count: openTimes.filter(t => t >= 1 && t < 4).length },
      { bucket: '4-24hr', count: openTimes.filter(t => t >= 4 && t < 24).length },
      { bucket: '1-3d', count: openTimes.filter(t => t >= 24 && t < 72).length },
      { bucket: '3-7d', count: openTimes.filter(t => t >= 72 && t < 168).length },
      { bucket: '>7d', count: openTimes.filter(t => t >= 168).length },
    ]

    // Approval by day of week
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const approvalByDay = dayNames.map((name, i) => ({ day: name, count: byDayOfWeek[i] }))

    // Repeat customer stats
    const repeatCustomers = Object.values(customerCounts).filter(c => c > 1).length
    const totalCustomers = Object.keys(customerCounts).length

    const topDeclinedReasons = Object.values(declinedReasons)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
      .map(r => ({
        ...r,
        value: Math.round(r.value * 100) / 100,
      }))

    return c.json({
      period: { from: startDate, to: endDate },
      engagement: {
        reportsSent,
        reportsOpened,
        openRate,
        avgTimeToOpenHours: avgTimeToOpen,
      },
      responseDistribution,
      approvalByDay,
      topDeclinedReasons,
      repeatCustomers: {
        total: totalCustomers,
        repeat: repeatCustomers,
        repeatRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100 * 10) / 10 : 0,
      },
    })
  } catch (error) {
    console.error('Customer report error:', error)
    return c.json({ error: 'Failed to fetch customer report' }, 500)
  }
})

// ============================================================================
// OPERATIONAL EFFICIENCY
// ============================================================================

reports.get('/operations', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id, group_by = 'day' } = c.req.query()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        created_at,
        tech_started_at,
        tech_completed_at,
        sent_at,
        first_opened_at,
        closed_at,
        site_id,
        site:sites(name)
      `)
      .eq('organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)

    if (site_id) query = query.eq('site_id', site_id)

    const { data: healthChecks, error } = await query

    if (error) {
      console.error('Operations report error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Workflow timing aggregates
    const turnaroundTimes: number[] = []
    const inspectionTimes: number[] = []
    const pricingTimes: number[] = []
    const sendTimes: number[] = []
    const responseTimes: number[] = []

    // Status distribution
    const statusCounts: Record<string, number> = {}

    // Throughput by period
    const createdByPeriod: Record<string, number> = {}
    const completedByPeriod: Record<string, number> = {}

    // Stuck checks
    const stuckChecks: Array<{
      healthCheckId: string
      status: string
      daysInStatus: number
      siteName: string
    }> = []

    // Site comparison
    const siteData: Record<string, {
      name: string
      created: number
      turnaroundTimes: number[]
      authorizedCount: number
      sentCount: number
    }> = {}

    for (const hc of healthChecks || []) {
      // Status distribution
      statusCounts[hc.status] = (statusCounts[hc.status] || 0) + 1

      const site = hc.site as unknown as { name: string } | null
      const siteName = site?.name || 'Unknown'

      // Site comparison
      if (hc.site_id) {
        if (!siteData[hc.site_id]) {
          siteData[hc.site_id] = { name: siteName, created: 0, turnaroundTimes: [], authorizedCount: 0, sentCount: 0 }
        }
        siteData[hc.site_id].created++
        if (hc.sent_at) siteData[hc.site_id].sentCount++
        if (hc.status === 'authorized' || hc.status === 'completed') siteData[hc.site_id].authorizedCount++
      }

      // Total turnaround
      if (hc.created_at && hc.closed_at) {
        const hours = (new Date(hc.closed_at).getTime() - new Date(hc.created_at).getTime()) / 3600000
        if (hours >= 0 && hours < 720) {
          turnaroundTimes.push(hours)
          if (hc.site_id && siteData[hc.site_id]) siteData[hc.site_id].turnaroundTimes.push(hours)
        }
      }

      // Inspection time
      if (hc.tech_started_at && hc.tech_completed_at) {
        const minutes = (new Date(hc.tech_completed_at).getTime() - new Date(hc.tech_started_at).getTime()) / 60000
        if (minutes > 0 && minutes < 480) inspectionTimes.push(minutes)
      }

      // Pricing time (tech completed to sent)
      if (hc.tech_completed_at && hc.sent_at) {
        const hours = (new Date(hc.sent_at).getTime() - new Date(hc.tech_completed_at).getTime()) / 3600000
        if (hours >= 0 && hours < 168) pricingTimes.push(hours)
      }

      // Time to send (created to sent if no tech timestamps)
      if (hc.created_at && hc.sent_at) {
        const hours = (new Date(hc.sent_at).getTime() - new Date(hc.created_at).getTime()) / 3600000
        if (hours >= 0 && hours < 720) sendTimes.push(hours)
      }

      // Customer response time
      if (hc.sent_at && hc.first_opened_at) {
        const hours = (new Date(hc.first_opened_at).getTime() - new Date(hc.sent_at).getTime()) / 3600000
        if (hours >= 0) responseTimes.push(hours)
      }

      // Period tracking
      const date = new Date(hc.created_at)
      let periodKey: string
      if (group_by === 'week') {
        const weekStart = new Date(date)
        const day = weekStart.getDay()
        const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
        weekStart.setDate(diff)
        periodKey = weekStart.toISOString().split('T')[0]
      } else if (group_by === 'month') {
        periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      } else {
        periodKey = date.toISOString().split('T')[0]
      }
      createdByPeriod[periodKey] = (createdByPeriod[periodKey] || 0) + 1
      if (hc.closed_at) {
        const closedDate = new Date(hc.closed_at)
        let closedPeriod: string
        if (group_by === 'week') {
          const ws = new Date(closedDate)
          const d = ws.getDay()
          ws.setDate(ws.getDate() - d + (d === 0 ? -6 : 1))
          closedPeriod = ws.toISOString().split('T')[0]
        } else if (group_by === 'month') {
          closedPeriod = `${closedDate.getFullYear()}-${String(closedDate.getMonth() + 1).padStart(2, '0')}`
        } else {
          closedPeriod = closedDate.toISOString().split('T')[0]
        }
        completedByPeriod[closedPeriod] = (completedByPeriod[closedPeriod] || 0) + 1
      }

      // Stuck check detection (in active status for > 3 days)
      const activeStatuses = ['inspection_pending', 'inspection_in_progress', 'pricing_pending', 'pricing_in_progress', 'advisor_review', 'customer_pending']
      if (activeStatuses.includes(hc.status)) {
        const daysInStatus = (Date.now() - new Date(hc.created_at).getTime()) / 86400000
        if (daysInStatus >= 3) {
          stuckChecks.push({
            healthCheckId: hc.id,
            status: hc.status,
            daysInStatus: Math.round(daysInStatus * 10) / 10,
            siteName,
          })
        }
      }
    }

    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0

    // Throughput data
    const allPeriods = [...new Set([...Object.keys(createdByPeriod), ...Object.keys(completedByPeriod)])].sort()
    const throughput = allPeriods.map(p => ({
      period: p,
      created: createdByPeriod[p] || 0,
      completed: completedByPeriod[p] || 0,
    }))

    // Status distribution for pie chart
    const statusDistribution = Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)

    // Site comparison
    const siteComparison = Object.values(siteData)
      .map(s => ({
        name: s.name,
        created: s.created,
        avgTurnaround: avg(s.turnaroundTimes),
        conversionRate: s.sentCount > 0 ? Math.round((s.authorizedCount / s.sentCount) * 100 * 10) / 10 : 0,
      }))
      .sort((a, b) => b.created - a.created)

    return c.json({
      period: { from: startDate, to: endDate },
      timing: {
        avgTurnaroundHours: avg(turnaroundTimes),
        avgInspectionMinutes: avg(inspectionTimes),
        avgPricingHours: avg(pricingTimes),
        avgTimeToSendHours: avg(sendTimes),
        avgResponseHours: avg(responseTimes),
      },
      throughput,
      statusDistribution,
      stuckChecks: stuckChecks.sort((a, b) => b.daysInStatus - a.daysInStatus).slice(0, 20),
      siteComparison,
    })
  } catch (error) {
    console.error('Operations report error:', error)
    return c.json({ error: 'Failed to fetch operations report' }, 500)
  }
})

// ============================================================================
// DEFERRED WORK
// ============================================================================

reports.get('/deferred', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id, advisor_id, group_by = 'day' } = c.req.query()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    // Query repair items where outcome_status = 'deferred'
    let query = supabaseAdmin
      .from('repair_items')
      .select(`
        id,
        name,
        total_inc_vat,
        outcome_status,
        outcome_set_at,
        deferred_until,
        deferred_notes,
        created_at,
        health_check:health_checks!inner(
          id,
          organization_id,
          site_id,
          advisor_id,
          vehicle:vehicles(registration),
          customer:customers(first_name, last_name),
          advisor:users!health_checks_advisor_id_fkey(first_name, last_name)
        )
      `)
      .eq('outcome_status', 'deferred')
      .eq('health_check.organization_id', auth.orgId)
      .is('deleted_at', null)

    // Filter by outcome_set_at date range
    if (date_from) {
      query = query.gte('outcome_set_at', startDate)
    }
    if (date_to) {
      query = query.lte('outcome_set_at', endDate)
    }

    if (site_id) query = query.eq('health_check.site_id', site_id)
    if (advisor_id) query = query.eq('health_check.advisor_id', advisor_id)

    const { data: items, error } = await query

    if (error) {
      console.error('Deferred work report error:', error)
      return c.json({ error: error.message }, 500)
    }

    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    // Summary
    let totalCount = 0
    let totalValue = 0
    let overdueCount = 0
    let overdueValue = 0
    let totalDeferralDays = 0
    let deferralDaysSamples = 0

    // Due breakdown buckets
    const dueBuckets: Record<string, { count: number; value: number }> = {
      'Overdue': { count: 0, value: 0 },
      'This Week': { count: 0, value: 0 },
      'This Month': { count: 0, value: 0 },
      '1-3 Months': { count: 0, value: 0 },
      '3-6 Months': { count: 0, value: 0 },
      '6+ Months': { count: 0, value: 0 },
      'No Due Date': { count: 0, value: 0 },
    }

    // Timeline
    const timelineMap: Record<string, { count: number; value: number }> = {}

    // Top items
    const itemAggregates: Record<string, { name: string; count: number; totalValue: number }> = {}

    // Detailed items
    const detailedItems: Array<{
      id: string
      itemName: string
      vehicleReg: string
      customerName: string
      advisorName: string
      value: number
      deferredAt: string
      deferredUntil: string | null
      deferredNotes: string | null
      isOverdue: boolean
      healthCheckId: string
    }> = []

    // Calculate week and month boundaries
    const weekEnd = new Date(todayStart)
    weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()))
    const monthEnd = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0)
    const threeMonths = new Date(todayStart)
    threeMonths.setMonth(threeMonths.getMonth() + 3)
    const sixMonths = new Date(todayStart)
    sixMonths.setMonth(sixMonths.getMonth() + 6)

    for (const item of items || []) {
      const value = Number(item.total_inc_vat) || 0
      const hc = item.health_check as unknown as {
        id: string
        advisor_id: string
        vehicle: { registration: string } | null
        customer: { first_name: string; last_name: string } | null
        advisor: { first_name: string; last_name: string } | null
      }

      totalCount++
      totalValue += value

      const deferredUntil = item.deferred_until ? new Date(item.deferred_until as string) : null
      const isOverdue = deferredUntil ? deferredUntil < todayStart : false

      if (isOverdue) {
        overdueCount++
        overdueValue += value
      }

      // Deferral days calculation
      if (item.outcome_set_at && deferredUntil) {
        const setAt = new Date(item.outcome_set_at as string)
        const days = (deferredUntil.getTime() - setAt.getTime()) / 86400000
        if (days >= 0) {
          totalDeferralDays += days
          deferralDaysSamples++
        }
      }

      // Due breakdown
      if (!deferredUntil) {
        dueBuckets['No Due Date'].count++
        dueBuckets['No Due Date'].value += value
      } else if (deferredUntil < todayStart) {
        dueBuckets['Overdue'].count++
        dueBuckets['Overdue'].value += value
      } else if (deferredUntil <= weekEnd) {
        dueBuckets['This Week'].count++
        dueBuckets['This Week'].value += value
      } else if (deferredUntil <= monthEnd) {
        dueBuckets['This Month'].count++
        dueBuckets['This Month'].value += value
      } else if (deferredUntil <= threeMonths) {
        dueBuckets['1-3 Months'].count++
        dueBuckets['1-3 Months'].value += value
      } else if (deferredUntil <= sixMonths) {
        dueBuckets['3-6 Months'].count++
        dueBuckets['3-6 Months'].value += value
      } else {
        dueBuckets['6+ Months'].count++
        dueBuckets['6+ Months'].value += value
      }

      // Timeline grouping (by outcome_set_at)
      if (item.outcome_set_at) {
        const date = new Date(item.outcome_set_at as string)
        let periodKey: string
        if (group_by === 'week') {
          const weekStart = new Date(date)
          const day = weekStart.getDay()
          const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
          weekStart.setDate(diff)
          periodKey = weekStart.toISOString().split('T')[0]
        } else if (group_by === 'month') {
          periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        } else {
          periodKey = date.toISOString().split('T')[0]
        }

        if (!timelineMap[periodKey]) {
          timelineMap[periodKey] = { count: 0, value: 0 }
        }
        timelineMap[periodKey].count++
        timelineMap[periodKey].value += value
      }

      // Top items aggregation
      const name = item.name || 'Unknown'
      if (!itemAggregates[name]) {
        itemAggregates[name] = { name, count: 0, totalValue: 0 }
      }
      itemAggregates[name].count++
      itemAggregates[name].totalValue += value

      // Detailed item
      detailedItems.push({
        id: item.id,
        itemName: name,
        vehicleReg: hc?.vehicle?.registration || 'Unknown',
        customerName: hc?.customer
          ? `${hc.customer.first_name} ${hc.customer.last_name}`
          : 'Unknown',
        advisorName: hc?.advisor
          ? `${hc.advisor.first_name} ${hc.advisor.last_name}`
          : 'Unknown',
        value,
        deferredAt: (item.outcome_set_at as string) || (item.created_at as string),
        deferredUntil: item.deferred_until as string | null,
        deferredNotes: item.deferred_notes as string | null,
        isOverdue,
        healthCheckId: hc?.id || '',
      })
    }

    const dueBreakdown = Object.entries(dueBuckets)
      .map(([label, data]) => ({ label, count: data.count, value: Math.round(data.value * 100) / 100 }))
      .filter(d => d.count > 0)

    const timeline = Object.entries(timelineMap)
      .map(([period, data]) => ({ period, count: data.count, value: Math.round(data.value * 100) / 100 }))
      .sort((a, b) => a.period.localeCompare(b.period))

    const topItems = Object.values(itemAggregates)
      .map(i => ({
        name: i.name,
        count: i.count,
        totalValue: Math.round(i.totalValue * 100) / 100,
        avgValue: i.count > 0 ? Math.round((i.totalValue / i.count) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 20)

    return c.json({
      period: { from: startDate, to: endDate },
      summary: {
        totalCount,
        totalValue: Math.round(totalValue * 100) / 100,
        overdueCount,
        overdueValue: Math.round(overdueValue * 100) / 100,
        avgDeferralDays: deferralDaysSamples > 0
          ? Math.round((totalDeferralDays / deferralDaysSamples) * 10) / 10
          : 0,
      },
      dueBreakdown,
      timeline,
      topItems,
      items: detailedItems.map(i => ({
        ...i,
        value: Math.round(i.value * 100) / 100,
      })),
    })
  } catch (error) {
    console.error('Deferred work report error:', error)
    return c.json({ error: 'Failed to fetch deferred work report' }, 500)
  }
})

// ============================================================================
// COMPLIANCE / AUDIT TRAIL
// ============================================================================

reports.get('/compliance/audit-trail', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id } = c.req.query()

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    sevenDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || sevenDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    // Get recent status changes
    let query = supabaseAdmin
      .from('health_check_status_history')
      .select(`
        id,
        from_status,
        to_status,
        notes,
        created_at,
        user:users(first_name, last_name),
        health_check:health_checks!inner(
          id,
          organization_id,
          site_id,
          vehicle:vehicles(registration)
        )
      `)
      .eq('health_check.organization_id', auth.orgId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })
      .limit(100)

    if (site_id) query = query.eq('health_check.site_id', site_id)

    const { data: statusChanges, error } = await query

    if (error) {
      console.error('Audit trail error:', error)
      return c.json({ error: error.message }, 500)
    }

    const auditEntries = (statusChanges || []).map(sc => {
      const user = sc.user as unknown as { first_name: string; last_name: string } | null
      const hc = sc.health_check as unknown as { id: string; vehicle?: { registration: string } | null }
      return {
        id: sc.id,
        healthCheckId: hc?.id,
        vehicleReg: (hc?.vehicle as any)?.registration || 'Unknown',
        fromStatus: sc.from_status,
        toStatus: sc.to_status,
        notes: sc.notes,
        userName: user ? `${user.first_name} ${user.last_name}` : 'System',
        timestamp: sc.created_at,
      }
    })

    return c.json({
      period: { from: startDate, to: endDate },
      entries: auditEntries,
    })
  } catch (error) {
    console.error('Audit trail error:', error)
    return c.json({ error: 'Failed to fetch audit trail' }, 500)
  }
})

// ============================================================================
// MRI PERFORMANCE
// ============================================================================

reports.get('/mri-performance', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id, group_by = 'day' } = c.req.query()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    thirtyDaysAgo.setHours(0, 0, 0, 0)
    const startDate = date_from || thirtyDaysAgo.toISOString()
    const endDate = date_to || new Date().toISOString()

    // Three parallel queries
    const [scanResultsRes, repairItemsRes, healthChecksRes] = await Promise.all([
      // 1. MRI scan results with item info and health check for date filtering
      supabaseAdmin
        .from('mri_scan_results')
        .select(`
          id,
          rag_status,
          not_applicable,
          not_due_yet,
          recommended_this_visit,
          already_booked_this_visit,
          repair_item_id,
          completed_by,
          mri_item:mri_items!inner(id, name, category, item_type),
          health_check:health_checks!inner(
            id,
            checked_in_at,
            checked_in_by,
            organization_id,
            site_id
          )
        `)
        .eq('health_check.organization_id', auth.orgId)
        .gte('health_check.checked_in_at', startDate)
        .lte('health_check.checked_in_at', endDate)
        .then(res => {
          // Apply site filter in JS since nested filter on inner join can be unreliable
          if (site_id && res.data) {
            res.data = res.data.filter((r: any) => {
              const hc = r.health_check as any
              return hc?.site_id === site_id
            })
          }
          return res
        }),

      // 2. MRI-sourced repair items
      (() => {
        let q = supabaseAdmin
          .from('repair_items')
          .select(`
            id,
            mri_result_id,
            total_inc_vat,
            outcome_status,
            health_check:health_checks!inner(
              id,
              organization_id,
              site_id,
              checked_in_at
            )
          `)
          .eq('source', 'mri_scan')
          .eq('health_check.organization_id', auth.orgId)
          .gte('health_check.checked_in_at', startDate)
          .lte('health_check.checked_in_at', endDate)
          .is('deleted_at', null)
        return q.then(res => {
          if (site_id && res.data) {
            res.data = res.data.filter((r: any) => {
              const hc = r.health_check as any
              return hc?.site_id === site_id
            })
          }
          return res
        })
      })(),

      // 3. Health checks with MRI info for advisor-level tracking
      (() => {
        let q = supabaseAdmin
          .from('health_checks')
          .select(`
            id,
            checked_in_by,
            checked_in_at,
            mri_bypassed,
            mri_items_total,
            mri_items_completed,
            advisor:users!health_checks_checked_in_by_fkey(id, first_name, last_name)
          `)
          .eq('organization_id', auth.orgId)
          .not('checked_in_at', 'is', null)
          .gte('checked_in_at', startDate)
          .lte('checked_in_at', endDate)
        if (site_id) q = q.eq('site_id', site_id)
        return q
      })(),
    ])

    if (scanResultsRes.error) {
      console.error('MRI scan results query error:', scanResultsRes.error)
      return c.json({ error: scanResultsRes.error.message }, 500)
    }
    if (repairItemsRes.error) {
      console.error('MRI repair items query error:', repairItemsRes.error)
      return c.json({ error: repairItemsRes.error.message }, 500)
    }
    if (healthChecksRes.error) {
      console.error('MRI health checks query error:', healthChecksRes.error)
      return c.json({ error: healthChecksRes.error.message }, 500)
    }

    const scanResults = scanResultsRes.data || []
    const repairItems = repairItemsRes.data || []
    const healthChecks = healthChecksRes.data || []

    // Build a map of repair items by mri_result_id for quick lookup
    const repairByMriResult: Record<string, { total_inc_vat: number; outcome_status: string }> = {}
    for (const ri of repairItems) {
      if (ri.mri_result_id) {
        repairByMriResult[ri.mri_result_id] = {
          total_inc_vat: Number(ri.total_inc_vat) || 0,
          outcome_status: ri.outcome_status as string || 'incomplete',
        }
      }
    }

    // ---- Summary KPIs ----
    const totalScans = new Set(scanResults.map(r => (r.health_check as any).id)).size
    const totalItemsScanned = scanResults.length
    let totalFlagged = 0
    let totalRecommended = 0
    let notApplicableCount = 0
    let alreadyBookedCount = 0
    let notDueYetCount = 0
    let repairItemsCreated = 0
    let revenueIdentified = 0
    let revenueAuthorized = 0

    // RAG distribution
    const ragDist = { red: 0, amber: 0, green: 0, notDueYet: 0, notApplicable: 0 }

    // Per-item breakdown
    const itemMap: Record<string, {
      mriItemId: string
      name: string
      category: string
      itemType: string
      timesScanned: number
      flaggedRed: number
      flaggedAmber: number
      flaggedGreen: number
      notApplicable: number
      recommended: number
      repairItems: number
      revenueIdentified: number
      revenueAuthorized: number
    }> = {}

    // Per-advisor metrics
    const advisorMap: Record<string, {
      id: string
      name: string
      scans: Set<string>
      itemsScanned: number
      flagged: number
      naCount: number
      revenueIdentified: number
      revenueAuthorized: number
    }> = {}

    // Conversion funnel
    const funnel = { scanned: 0, flagged: 0, repairCreated: 0, authorised: 0, declined: 0, deferred: 0 }

    // Timeline data
    const timelineMap: Record<string, { scans: Set<string>; flagged: number; revenueIdentified: number; revenueAuthorized: number }> = {}

    // Top flagged items
    const flaggedItemMap: Record<string, { name: string; flagCount: number; revenueIdentified: number }> = {}

    for (const result of scanResults) {
      const hc = result.health_check as unknown as { id: string; checked_in_at: string; checked_in_by: string; site_id: string }
      const mriItem = result.mri_item as unknown as { id: string; name: string; category: string; item_type: string }
      const isFlagged = result.rag_status === 'red' || result.rag_status === 'amber'
      // Look up repair by scan result's own ID (map is keyed by mri_result_id which equals scan result id)
      const repair = repairByMriResult[result.id as string] || null
      const hasRepair = !!repair
      const repairValue = repair?.total_inc_vat || 0

      // Summary
      if (isFlagged) totalFlagged++
      if (result.recommended_this_visit) totalRecommended++
      if (result.not_applicable) notApplicableCount++
      if (result.already_booked_this_visit) alreadyBookedCount++
      if (result.not_due_yet) notDueYetCount++
      if (hasRepair) {
        repairItemsCreated++
        revenueIdentified += repairValue
        if (repair?.outcome_status === 'authorised') {
          revenueAuthorized += repairValue
        }
      }

      // RAG distribution
      if (result.not_applicable) {
        ragDist.notApplicable++
      } else if (result.not_due_yet) {
        ragDist.notDueYet++
      } else if (result.rag_status === 'red') {
        ragDist.red++
      } else if (result.rag_status === 'amber') {
        ragDist.amber++
      } else if (result.rag_status === 'green') {
        ragDist.green++
      }

      // Per-item breakdown
      const itemKey = mriItem.id
      if (!itemMap[itemKey]) {
        itemMap[itemKey] = {
          mriItemId: mriItem.id,
          name: mriItem.name,
          category: mriItem.category || '',
          itemType: mriItem.item_type || '',
          timesScanned: 0,
          flaggedRed: 0,
          flaggedAmber: 0,
          flaggedGreen: 0,
          notApplicable: 0,
          recommended: 0,
          repairItems: 0,
          revenueIdentified: 0,
          revenueAuthorized: 0,
        }
      }
      itemMap[itemKey].timesScanned++
      if (result.rag_status === 'red') itemMap[itemKey].flaggedRed++
      if (result.rag_status === 'amber') itemMap[itemKey].flaggedAmber++
      if (result.rag_status === 'green') itemMap[itemKey].flaggedGreen++
      if (result.not_applicable) itemMap[itemKey].notApplicable++
      if (result.recommended_this_visit) itemMap[itemKey].recommended++
      if (hasRepair) {
        itemMap[itemKey].repairItems++
        itemMap[itemKey].revenueIdentified += repairValue
        if (repair?.outcome_status === 'authorised') {
          itemMap[itemKey].revenueAuthorized += repairValue
        }
      }

      // Per-advisor metrics (keyed by checked_in_by)
      if (hc.checked_in_by) {
        if (!advisorMap[hc.checked_in_by]) {
          advisorMap[hc.checked_in_by] = {
            id: hc.checked_in_by,
            name: '',
            scans: new Set(),
            itemsScanned: 0,
            flagged: 0,
            naCount: 0,
            revenueIdentified: 0,
            revenueAuthorized: 0,
          }
        }
        advisorMap[hc.checked_in_by].scans.add(hc.id)
        advisorMap[hc.checked_in_by].itemsScanned++
        if (isFlagged) advisorMap[hc.checked_in_by].flagged++
        if (result.not_applicable) advisorMap[hc.checked_in_by].naCount++
        if (hasRepair) {
          advisorMap[hc.checked_in_by].revenueIdentified += repairValue
          if (repair?.outcome_status === 'authorised') {
            advisorMap[hc.checked_in_by].revenueAuthorized += repairValue
          }
        }
      }

      // Conversion funnel
      funnel.scanned++
      if (isFlagged) {
        funnel.flagged++
        if (hasRepair) {
          funnel.repairCreated++
          if (repair?.outcome_status === 'authorised') funnel.authorised++
          if (repair?.outcome_status === 'declined') funnel.declined++
          if (repair?.outcome_status === 'deferred') funnel.deferred++
        }
      }

      // Timeline
      if (hc.checked_in_at) {
        const date = new Date(hc.checked_in_at)
        let periodKey: string
        if (group_by === 'week') {
          const weekStart = new Date(date)
          const day = weekStart.getDay()
          const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
          weekStart.setDate(diff)
          periodKey = weekStart.toISOString().split('T')[0]
        } else if (group_by === 'month') {
          periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        } else {
          periodKey = date.toISOString().split('T')[0]
        }
        if (!timelineMap[periodKey]) {
          timelineMap[periodKey] = { scans: new Set(), flagged: 0, revenueIdentified: 0, revenueAuthorized: 0 }
        }
        timelineMap[periodKey].scans.add(hc.id)
        if (isFlagged) timelineMap[periodKey].flagged++
        if (hasRepair) {
          timelineMap[periodKey].revenueIdentified += repairValue
          if (repair?.outcome_status === 'authorised') {
            timelineMap[periodKey].revenueAuthorized += repairValue
          }
        }
      }

      // Top flagged items
      if (isFlagged) {
        if (!flaggedItemMap[itemKey]) {
          flaggedItemMap[itemKey] = { name: mriItem.name, flagCount: 0, revenueIdentified: 0 }
        }
        flaggedItemMap[itemKey].flagCount++
        if (hasRepair) {
          flaggedItemMap[itemKey].revenueIdentified += repairValue
        }
      }
    }

    // Enrich advisor metrics with names + bypass data from healthChecks query
    const advisorBypassMap: Record<string, { bypassed: number; total: number }> = {}
    for (const hc of healthChecks) {
      if (!hc.checked_in_by) continue
      const advisor = hc.advisor as unknown as { id: string; first_name: string; last_name: string } | null
      if (advisorMap[hc.checked_in_by] && advisor) {
        advisorMap[hc.checked_in_by].name = `${advisor.first_name} ${advisor.last_name}`
      }
      if (!advisorBypassMap[hc.checked_in_by]) {
        advisorBypassMap[hc.checked_in_by] = { bypassed: 0, total: 0 }
      }
      advisorBypassMap[hc.checked_in_by].total++
      if (hc.mri_bypassed) advisorBypassMap[hc.checked_in_by].bypassed++
    }

    const flagRate = totalItemsScanned > 0 ? Math.round((totalFlagged / totalItemsScanned) * 100 * 10) / 10 : 0
    const conversionToRepairRate = totalFlagged > 0 ? Math.round((repairItemsCreated / totalFlagged) * 100 * 10) / 10 : 0
    const captureRate = revenueIdentified > 0 ? Math.round((revenueAuthorized / revenueIdentified) * 100 * 10) / 10 : 0
    const avgItemsPerScan = totalScans > 0 ? Math.round((totalItemsScanned / totalScans) * 10) / 10 : 0

    // Build item breakdown
    const itemBreakdown = Object.values(itemMap)
      .map(i => ({
        ...i,
        flagRate: i.timesScanned > 0
          ? Math.round(((i.flaggedRed + i.flaggedAmber) / i.timesScanned) * 100 * 10) / 10
          : 0,
        authRate: i.revenueIdentified > 0
          ? Math.round((i.revenueAuthorized / i.revenueIdentified) * 100 * 10) / 10
          : 0,
        revenueIdentified: Math.round(i.revenueIdentified * 100) / 100,
        revenueAuthorized: Math.round(i.revenueAuthorized * 100) / 100,
      }))
      .sort((a, b) => b.timesScanned - a.timesScanned)

    // Build advisor metrics
    const advisorMetrics = Object.values(advisorMap)
      .map(a => {
        const bypass = advisorBypassMap[a.id]
        return {
          id: a.id,
          name: a.name || 'Unknown',
          scans: a.scans.size,
          itemsScanned: a.itemsScanned,
          flagged: a.flagged,
          flagRate: a.itemsScanned > 0 ? Math.round((a.flagged / a.itemsScanned) * 100 * 10) / 10 : 0,
          naCount: a.naCount,
          naRate: a.itemsScanned > 0 ? Math.round((a.naCount / a.itemsScanned) * 100 * 10) / 10 : 0,
          revenueIdentified: Math.round(a.revenueIdentified * 100) / 100,
          revenueAuthorized: Math.round(a.revenueAuthorized * 100) / 100,
          bypassed: bypass?.bypassed || 0,
          bypassRate: bypass && bypass.total > 0 ? Math.round((bypass.bypassed / bypass.total) * 100 * 10) / 10 : 0,
        }
      })
      .sort((a, b) => b.scans - a.scans)

    // Build timeline
    const timeline = Object.entries(timelineMap)
      .map(([period, d]) => {
        const scanCount = d.scans.size
        return {
          period,
          scans: scanCount,
          flagged: d.flagged,
          flagRate: scanCount > 0 ? Math.round((d.flagged / (scanCount * avgItemsPerScan || 1)) * 100 * 10) / 10 : 0,
          revenueIdentified: Math.round(d.revenueIdentified * 100) / 100,
          revenueAuthorized: Math.round(d.revenueAuthorized * 100) / 100,
        }
      })
      .sort((a, b) => a.period.localeCompare(b.period))

    // Top 10 flagged items
    const topFlaggedItems = Object.values(flaggedItemMap)
      .map(i => ({
        name: i.name,
        flagCount: i.flagCount,
        revenueIdentified: Math.round(i.revenueIdentified * 100) / 100,
      }))
      .sort((a, b) => b.flagCount - a.flagCount)
      .slice(0, 10)

    return c.json({
      period: { from: startDate, to: endDate },
      summary: {
        totalScans,
        totalItemsScanned,
        totalFlagged,
        flagRate,
        totalRecommended,
        repairItemsCreated,
        conversionToRepairRate,
        revenueIdentified: Math.round(revenueIdentified * 100) / 100,
        revenueAuthorized: Math.round(revenueAuthorized * 100) / 100,
        captureRate,
        avgItemsPerScan,
        notApplicableCount,
        alreadyBookedCount,
        notDueYetCount,
      },
      ragDistribution: ragDist,
      itemBreakdown,
      advisorMetrics,
      conversionFunnel: funnel,
      timeline,
      topFlaggedItems,
    })
  } catch (error) {
    console.error('MRI performance report error:', error)
    return c.json({ error: 'Failed to fetch MRI performance report' }, 500)
  }
})

export default reports
