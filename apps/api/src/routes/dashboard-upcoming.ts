import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { getNextWorkingDays } from '../lib/date-utils.js'

const dashboardUpcoming = new Hono()

dashboardUpcoming.use('*', authMiddleware)

// GET / - Upcoming bookings (next 2 working days) with MRI status
dashboardUpcoming.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id } = c.req.query()

    // Compute date range: next 2 working days (not today)
    const now = new Date()
    const futureDays = getNextWorkingDays(now, 2)
    // futureDays = ["2026-02-03", "2026-02-04"] for example

    if (futureDays.length === 0) {
      return c.json({ dates: [] })
    }

    const startDate = futureDays[0]
    const endDate = futureDays[futureDays.length - 1]

    // Query health checks with due_date in the future working days range
    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        due_date,
        customer_waiting,
        loan_car_required,
        booked_repairs,
        notes,
        customer:customers!health_checks_customer_id_fkey(id, first_name, last_name),
        vehicle:vehicles(id, registration, make, model)
      `)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .gte('due_date', `${startDate}T00:00:00`)
      .lte('due_date', `${endDate}T23:59:59`)

    if (site_id) {
      query = query.eq('site_id', site_id)
    }

    const { data: healthChecks, error: hcError } = await query.order('due_date', { ascending: true })

    if (hcError) {
      console.error('Upcoming bookings query error:', hcError)
      return c.json({ error: hcError.message }, 500)
    }

    if (!healthChecks || healthChecks.length === 0) {
      return c.json({ dates: [] })
    }

    const healthCheckIds = healthChecks.map(hc => hc.id)

    // Query MRI scan results for these health checks
    const { data: mriResults } = await supabaseAdmin
      .from('mri_scan_results')
      .select('health_check_id, completed_at')
      .in('health_check_id', healthCheckIds)

    // Query MRI items count for the org (total expected per HC)
    const { count: totalMriItems } = await supabaseAdmin
      .from('mri_items')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)
      .eq('enabled', true)

    const mriTotal = totalMriItems || 0

    // Aggregate MRI results per health check
    const mriByHc: Record<string, { completed: number; total: number }> = {}
    if (mriResults) {
      for (const r of mriResults) {
        if (!mriByHc[r.health_check_id]) {
          mriByHc[r.health_check_id] = { completed: 0, total: mriTotal }
        }
        if (r.completed_at) {
          mriByHc[r.health_check_id].completed++
        }
      }
    }

    // Group health checks by date
    const dateGroups: Record<string, typeof healthChecks> = {}
    for (const hc of healthChecks) {
      const dateStr = hc.due_date ? hc.due_date.split('T')[0] : startDate
      if (!dateGroups[dateStr]) {
        dateGroups[dateStr] = []
      }
      dateGroups[dateStr].push(hc)
    }

    // Build response grouped by date
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    const dates = futureDays.map(dateStr => {
      const hcs = dateGroups[dateStr] || []

      // Format day label
      const d = new Date(dateStr + 'T12:00:00')
      let dayLabel: string
      if (dateStr === tomorrowStr) {
        dayLabel = `Tomorrow - ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
      } else {
        dayLabel = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      }

      const healthChecksList = hcs.map(hc => {
        const customer = (Array.isArray(hc.customer) ? hc.customer[0] : hc.customer) as { id: string; first_name: string; last_name: string } | null
        const vehicle = (Array.isArray(hc.vehicle) ? hc.vehicle[0] : hc.vehicle) as { id: string; registration: string; make: string | null; model: string | null } | null

        const mriProgress = mriByHc[hc.id] || { completed: 0, total: mriTotal }
        let mriStatus: 'not_started' | 'in_progress' | 'complete'
        if (mriProgress.total === 0) {
          mriStatus = 'not_started'
        } else if (mriProgress.completed >= mriProgress.total) {
          mriStatus = 'complete'
        } else if (mriProgress.completed > 0) {
          mriStatus = 'in_progress'
        } else {
          mriStatus = 'not_started'
        }

        // Extract booking time from due_date
        let bookingTime: string | null = null
        if (hc.due_date) {
          const dt = new Date(hc.due_date)
          const hours = dt.getUTCHours()
          const mins = dt.getUTCMinutes()
          if (hours > 0 || mins > 0) {
            bookingTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
          }
        }

        return {
          id: hc.id,
          status: hc.status,
          dueDate: hc.due_date,
          bookingTime,
          customerName: customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown',
          vehicleReg: vehicle?.registration || 'Unknown',
          vehicleMake: vehicle?.make || null,
          vehicleModel: vehicle?.model || null,
          customerWaiting: hc.customer_waiting || false,
          loanCarRequired: hc.loan_car_required || false,
          bookedRepairs: hc.booked_repairs || [],
          mriStatus,
          mriProgress
        }
      })

      // Sort by booking time
      healthChecksList.sort((a, b) => {
        if (a.bookingTime && b.bookingTime) return a.bookingTime.localeCompare(b.bookingTime)
        if (a.bookingTime) return -1
        if (b.bookingTime) return 1
        return 0
      })

      return {
        date: dateStr,
        dayLabel,
        healthChecks: healthChecksList
      }
    })

    return c.json({ dates })
  } catch (error) {
    console.error('Upcoming bookings dashboard error:', error)
    return c.json({ error: 'Failed to fetch upcoming bookings data' }, 500)
  }
})

export default dashboardUpcoming
