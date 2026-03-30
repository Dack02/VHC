import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'

const board = new Hono()

// Default statuses to seed when an org first accesses the board
const DEFAULT_STATUSES = [
  { name: 'Awaiting Authorisation', colour: '#EF4444', icon: 'clock', sort_order: 0 },
  { name: 'Parts on Order', colour: '#F59E0B', icon: 'package', sort_order: 1 },
  { name: 'Parts on Back Order', colour: '#DC2626', icon: 'package-x', sort_order: 2 },
  { name: 'Awaiting Schedule', colour: '#6366F1', icon: 'calendar', sort_order: 3 },
  { name: 'Sublet Out', colour: '#8B5CF6', icon: 'external-link', sort_order: 4 },
  { name: 'Waiting for Customer', colour: '#3B82F6', icon: 'phone', sort_order: 5 },
  { name: 'Quality Check', colour: '#10B981', icon: 'check-circle', sort_order: 6 },
  { name: 'Ready for Wash', colour: '#06B6D4', icon: 'droplets', sort_order: 7 },
  { name: 'Ready for Collection', colour: '#16A34A', icon: 'car', sort_order: 8 },
]

/**
 * GET /board?siteId=&date= — Full board state
 */
board.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const siteId = c.req.query('siteId')
    const date = c.req.query('date') || new Date().toISOString().split('T')[0]

    if (!siteId) {
      return c.json({ error: 'siteId is required' }, 400)
    }

    // Fetch columns, assignments, and health check data in parallel
    const [columnsResult, assignmentsResult, dueInResult, statusesResult] = await Promise.all([
      // Technician columns for this site
      supabaseAdmin
        .from('tcard_columns')
        .select(`
          id, technician_id, sort_order, available_hours, is_visible,
          technician:users(id, first_name, last_name)
        `)
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .eq('is_visible', true)
        .order('sort_order', { ascending: true }),

      // Card assignments for this date
      supabaseAdmin
        .from('tcard_assignments')
        .select(`
          id, health_check_id, column_type, technician_id, sort_position,
          tcard_status_id, priority, board_date,
          status:tcard_statuses(id, name, colour, icon)
        `)
        .eq('organization_id', auth.orgId)
        .eq('board_date', date),

      // Due In: health checks due on this date that haven't been assigned
      supabaseAdmin
        .from('health_checks')
        .select(`
          id, status, jobsheet_number, promised_at, mileage_in, customer_waiting,
          loan_car_required, is_internal, arrived_at, due_date, booked_repairs,
          checked_in_at, advisor_id,
          vehicle:vehicles!health_checks_vehicle_id_fkey(id, registration, make, model, year),
          customer:customers!health_checks_customer_id_fkey(id, first_name, last_name),
          technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
          advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name)
        `)
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .is('deleted_at', null)
        .gte('due_date', `${date}T00:00:00`)
        .lt('due_date', `${date}T23:59:59.999`)
        .in('status', [
          'awaiting_arrival', 'awaiting_checkin', 'created', 'assigned',
          'in_progress', 'paused', 'tech_completed', 'awaiting_review',
          'awaiting_pricing', 'awaiting_parts', 'ready_to_send', 'sent',
          'delivered', 'opened', 'partial_response', 'authorized'
        ]),

      // Statuses for this org
      supabaseAdmin
        .from('tcard_statuses')
        .select('id, name, colour, icon, sort_order')
        .eq('organization_id', auth.orgId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ])

    if (columnsResult.error) {
      return c.json({ error: columnsResult.error.message }, 500)
    }
    if (assignmentsResult.error) {
      return c.json({ error: assignmentsResult.error.message }, 500)
    }
    if (dueInResult.error) {
      return c.json({ error: dueInResult.error.message }, 500)
    }

    // Build assignment map by health_check_id
    const assignmentMap = new Map<string, typeof assignmentsResult.data[0]>()
    for (const a of assignmentsResult.data || []) {
      assignmentMap.set(a.health_check_id, a)
    }

    // Build card objects from health checks
    const healthChecks = dueInResult.data || []
    const cards = healthChecks.map(hc => {
      const assignment = assignmentMap.get(hc.id)
      return {
        healthCheckId: hc.id,
        status: hc.status,
        jobsheetNumber: hc.jobsheet_number,
        promiseTime: hc.promised_at,
        arrivedAt: hc.arrived_at,
        dueDate: hc.due_date,
        customerWaiting: hc.customer_waiting,
        loanCarRequired: hc.loan_car_required,
        isInternal: hc.is_internal,
        bookedRepairs: hc.booked_repairs,
        checkedInAt: hc.checked_in_at,
        vehicle: hc.vehicle ? {
          id: (hc.vehicle as any).id,
          registration: (hc.vehicle as any).registration,
          make: (hc.vehicle as any).make,
          model: (hc.vehicle as any).model,
          year: (hc.vehicle as any).year,
        } : null,
        customer: hc.customer ? {
          id: (hc.customer as any).id,
          firstName: (hc.customer as any).first_name,
          lastName: (hc.customer as any).last_name,
        } : null,
        technician: hc.technician ? {
          id: (hc.technician as any).id,
          firstName: (hc.technician as any).first_name,
          lastName: (hc.technician as any).last_name,
        } : null,
        advisor: hc.advisor ? {
          id: (hc.advisor as any).id,
          firstName: (hc.advisor as any).first_name,
          lastName: (hc.advisor as any).last_name,
        } : null,
        // Assignment data
        columnType: assignment?.column_type || 'due_in',
        assignedTechnicianId: assignment?.technician_id || null,
        sortPosition: assignment?.sort_position || 0,
        tcardStatusId: assignment?.tcard_status_id || null,
        tcardStatus: assignment?.status || null,
        priority: assignment?.priority || 'normal',
      }
    })

    // Separate cards into columns
    const dueInCards = cards.filter(c => c.columnType === 'due_in')
    const completedCards = cards.filter(c => c.columnType === 'completed')

    // Build technician column data
    const techColumns = (columnsResult.data || []).map(col => {
      const techCards = cards.filter(c => c.columnType === 'technician' && c.assignedTechnicianId === col.technician_id)
      const allocatedHours = calculateAllocatedHours(techCards)
      return {
        id: col.id,
        technicianId: col.technician_id,
        technician: col.technician ? {
          id: (col.technician as any).id,
          firstName: (col.technician as any).first_name,
          lastName: (col.technician as any).last_name,
        } : null,
        sortOrder: col.sort_order,
        availableHours: col.available_hours,
        allocatedHours,
        cards: techCards.sort((a, b) => a.sortPosition - b.sortPosition),
      }
    })

    return c.json({
      date,
      siteId,
      columns: techColumns,
      dueIn: dueInCards.sort((a, b) => a.sortPosition - b.sortPosition),
      completed: completedCards.sort((a, b) => a.sortPosition - b.sortPosition),
      statuses: (statusesResult.data || []).map(s => ({
        id: s.id,
        name: s.name,
        colour: s.colour,
        icon: s.icon,
        sortOrder: s.sort_order,
      })),
    })
  } catch (error) {
    console.error('Get board error:', error)
    return c.json({ error: 'Failed to get board' }, 500)
  }
})

/**
 * GET /board/config?siteId= — Board configuration for site
 */
board.get('/config', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const siteId = c.req.query('siteId')

    if (!siteId) {
      return c.json({ error: 'siteId is required' }, 400)
    }

    const { data: config, error } = await supabaseAdmin
      .from('tcard_board_config')
      .select('*')
      .eq('organization_id', auth.orgId)
      .eq('site_id', siteId)
      .maybeSingle()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Return defaults if no config exists
    if (!config) {
      return c.json({
        config: {
          defaultTechHours: 8.0,
          showCompletedColumn: true,
          autoCompleteStatuses: ['completed'],
        }
      })
    }

    return c.json({
      config: {
        id: config.id,
        defaultTechHours: config.default_tech_hours,
        showCompletedColumn: config.show_completed_column,
        autoCompleteStatuses: config.auto_complete_statuses,
      }
    })
  } catch (error) {
    console.error('Get board config error:', error)
    return c.json({ error: 'Failed to get board config' }, 500)
  }
})

/**
 * PATCH /board/config — Update board configuration
 */
board.patch('/config', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { siteId, defaultTechHours, showCompletedColumn, autoCompleteStatuses } = body

    if (!siteId) {
      return c.json({ error: 'siteId is required' }, 400)
    }

    const { data: config, error } = await supabaseAdmin
      .from('tcard_board_config')
      .upsert({
        organization_id: auth.orgId,
        site_id: siteId,
        default_tech_hours: defaultTechHours ?? 8.0,
        show_completed_column: showCompletedColumn ?? true,
        auto_complete_statuses: autoCompleteStatuses ?? ['completed'],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,site_id' })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      config: {
        id: config.id,
        defaultTechHours: config.default_tech_hours,
        showCompletedColumn: config.show_completed_column,
        autoCompleteStatuses: config.auto_complete_statuses,
      }
    })
  } catch (error) {
    console.error('Update board config error:', error)
    return c.json({ error: 'Failed to update board config' }, 500)
  }
})

/**
 * POST /board/seed-statuses — Seed default statuses for an org (idempotent)
 */
board.post('/seed-statuses', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')

    // Check if org already has statuses
    const { count } = await supabaseAdmin
      .from('tcard_statuses')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)

    if (count && count > 0) {
      return c.json({ message: 'Statuses already exist', seeded: false })
    }

    const rows = DEFAULT_STATUSES.map(s => ({
      organization_id: auth.orgId,
      ...s,
    }))

    const { error } = await supabaseAdmin
      .from('tcard_statuses')
      .insert(rows)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ message: 'Default statuses seeded', seeded: true })
  } catch (error) {
    console.error('Seed statuses error:', error)
    return c.json({ error: 'Failed to seed statuses' }, 500)
  }
})

function calculateAllocatedHours(cards: { bookedRepairs?: unknown }[]): number {
  let total = 0
  for (const card of cards) {
    if (card.bookedRepairs && Array.isArray(card.bookedRepairs)) {
      for (const repair of card.bookedRepairs) {
        if (repair && typeof repair === 'object' && 'labourHours' in repair) {
          total += Number((repair as any).labourHours) || 0
        } else if (repair && typeof repair === 'object' && 'hours' in repair) {
          total += Number((repair as any).hours) || 0
        }
      }
    }
  }
  return Math.round(total * 10) / 10
}

export default board
