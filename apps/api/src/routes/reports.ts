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

    // Get all health checks in the period
    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        created_at,
        sent_at,
        first_opened_at,
        closed_at,
        total_amount,
        total_labour,
        total_parts,
        green_count,
        amber_count,
        red_count,
        technician_id,
        advisor_id,
        technician:users!health_checks_technician_id_fkey(first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(first_name, last_name)
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

    const totalValueIdentified = healthChecks?.reduce((sum, hc) => sum + (hc.total_amount || 0), 0) || 0
    const totalValueAuthorized = healthChecks?.filter(hc => hc.status === 'authorized' || hc.status === 'completed')
      .reduce((sum, hc) => sum + (hc.total_amount || 0), 0) || 0
    const totalValueDeclined = healthChecks?.filter(hc => hc.status === 'declined')
      .reduce((sum, hc) => sum + (hc.total_amount || 0), 0) || 0

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
        total_amount,
        total_labour,
        total_parts,
        green_count,
        amber_count,
        red_count,
        mileage_in,
        vehicle:vehicles(registration, make, model, vin),
        customer:customers(first_name, last_name, email, phone),
        technician:users!health_checks_technician_id_fkey(first_name, last_name, email),
        advisor:users!health_checks_advisor_id_fkey(first_name, last_name, email),
        site:sites(name)
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
          hc.total_labour || 0,
          hc.total_parts || 0,
          hc.total_amount || 0
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
      grouped[periodKey].value += hc.total_amount || 0
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
      advisorMetrics[key].totalValue += hc.total_amount || 0
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

export default reports
