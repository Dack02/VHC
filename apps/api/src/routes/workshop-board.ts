/**
 * Workshop Management Board API
 *
 * Kanban board: Due In → Checked In → technician columns → custom queue
 * columns → Work Complete.
 *
 * Position model ("auto with manual override"):
 * - Due In / Checked In / technician columns are derived live from
 *   health_checks (status, technician_id), so cards move themselves as the
 *   VHC pipeline progresses.
 * - workshop_cards stores board metadata (workshop status, priority,
 *   estimated hours) and manual placements ('queue' / 'work_complete').
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { emitToSite, WS_EVENTS } from '../services/websocket.js'
import { createNotification } from './notifications.js'

const workshopBoard = new Hono()

workshopBoard.use('*', authMiddleware)

const ADMIN_ROLES = ['super_admin', 'org_admin', 'site_admin'] as const
const ADVISOR_ROLES = [...ADMIN_ROLES, 'service_advisor'] as const
const ALL_ROLES = [...ADVISOR_ROLES, 'technician'] as const

// Health check statuses that keep a card on the active board (vehicle on site,
// work not finished). awaiting_arrival = Due In; completed = Work Complete.
const WIP_STATUSES = [
  'awaiting_checkin', 'created', 'assigned', 'in_progress', 'paused',
  'tech_completed', 'awaiting_review', 'awaiting_pricing', 'awaiting_parts',
  'ready_to_send', 'sent', 'delivered', 'opened', 'partial_response',
  'authorized', 'declined', 'expired'
]

const HC_CARD_SELECT = `
  id, status, site_id, technician_id, advisor_id,
  promise_time, due_date, arrived_at, completed_at, created_at,
  customer_waiting, loan_car_required, is_internal,
  jobsheet_number, jobsheet_status, job_number, booked_repairs,
  mileage_in, key_location, checkin_notes, advisor_notes,
  red_count, amber_count, green_count, tech_started_at, tech_completed_at,
  total_tech_time_minutes,
  vehicle:vehicles(id, registration, make, model, year, color),
  customer:customers(id, first_name, last_name, mobile),
  technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
  advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name)
`

const DEFAULT_STATUSES = [
  { name: 'Awaiting Authorisation', colour: '#EF4444', icon: 'clock', sort_order: 10, sms_message: null },
  { name: 'Authorised', colour: '#16A34A', icon: 'check-circle', sort_order: 20, sms_message: null },
  { name: 'Awaiting Parts', colour: '#F59E0B', icon: 'package', sort_order: 30, sms_message: null },
  { name: 'Parts Arrived', colour: '#14B8A6', icon: 'package-check', sort_order: 40, sms_message: null },
  { name: 'On Road Test', colour: '#6366F1', icon: 'route', sort_order: 50, sms_message: null },
  { name: 'Quality Check', colour: '#8B5CF6', icon: 'shield-check', sort_order: 60, sms_message: null },
  { name: 'Ready for Wash', colour: '#06B6D4', icon: 'droplets', sort_order: 70, sms_message: null },
  { name: 'Sublet Out', colour: '#A855F7', icon: 'external-link', sort_order: 80, sms_message: null },
  {
    name: 'Ready for Collection', colour: '#10B981', icon: 'key', sort_order: 90,
    sms_message: 'Hi {customer_name}, your vehicle {registration} is now ready for collection. Thank you, {site_name}'
  }
]

function emitBoardUpdated(siteId: string | null, reason: string, healthCheckId?: string) {
  if (siteId) {
    emitToSite(siteId, WS_EVENTS.WORKSHOP_BOARD_UPDATED, {
      reason,
      healthCheckId,
      timestamp: new Date().toISOString()
    })
  }
}

// Resolve the site the request operates on. Explicit ?siteId= must belong to
// the user's organization; falls back to the user's own site.
async function resolveSiteId(c: any): Promise<string | null> {
  const auth = c.get('auth')
  const requested = c.req.query('siteId')

  if (requested) {
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', requested)
      .eq('organization_id', auth.orgId)
      .single()
    return site ? site.id : null
  }
  return auth.user.siteId
}

// Sum labour hours from DMS booked repairs ([{labourItems: [{units}]}])
function bookedRepairsHours(bookedRepairs: unknown): number | null {
  if (!Array.isArray(bookedRepairs)) return null
  let total = 0
  let found = false
  for (const repair of bookedRepairs) {
    const items = (repair as { labourItems?: Array<{ units?: number }> })?.labourItems
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const units = Number(item?.units)
      if (!Number.isNaN(units) && units > 0) {
        total += units
        found = true
      }
    }
  }
  return found ? Math.round(total * 100) / 100 : null
}

async function ensureStatusesSeeded(orgId: string) {
  const { count } = await supabaseAdmin
    .from('workshop_statuses')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  if (!count) {
    await supabaseAdmin
      .from('workshop_statuses')
      .upsert(
        DEFAULT_STATUSES.map(s => ({ ...s, organization_id: orgId })),
        { onConflict: 'organization_id,name', ignoreDuplicates: true }
      )
  }
}

// ============================================================================
// GET / - Full board state for a site + date
// ============================================================================
workshopBoard.get('/', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const siteId = await resolveSiteId(c)
    if (!siteId) {
      return c.json({ error: 'No site available - pass ?siteId= or assign a site to your user' }, 400)
    }

    const date = c.req.query('date') || new Date().toISOString().split('T')[0]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: 'Invalid date - expected YYYY-MM-DD' }, 400)
    }
    const dayStart = `${date}T00:00:00`
    const dayEnd = `${date}T23:59:59`

    await ensureStatusesSeeded(auth.orgId)

    const [columnsRes, configRes, statusesRes, dueInRes, wipRes, completedRes] = await Promise.all([
      supabaseAdmin
        .from('workshop_columns')
        .select(`
          id, column_type, technician_id, name, colour, available_hours, sort_order, is_visible,
          technician:users!workshop_columns_technician_id_fkey(id, first_name, last_name, is_active)
        `)
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('workshop_board_config')
        .select('*')
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .maybeSingle(),
      supabaseAdmin
        .from('workshop_statuses')
        .select('id, name, colour, icon, sms_message, sort_order, is_active')
        .eq('organization_id', auth.orgId)
        .order('sort_order', { ascending: true }),
      // Due In: expected on/before the selected date, not yet arrived
      supabaseAdmin
        .from('health_checks')
        .select(HC_CARD_SELECT)
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .eq('status', 'awaiting_arrival')
        .lte('due_date', dayEnd)
        .is('deleted_at', null),
      // Active WIP: everything on site that isn't finished
      supabaseAdmin
        .from('health_checks')
        .select(HC_CARD_SELECT)
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .in('status', WIP_STATUSES)
        .is('deleted_at', null),
      // Completed on the selected date
      supabaseAdmin
        .from('health_checks')
        .select(HC_CARD_SELECT)
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .eq('status', 'completed')
        .gte('completed_at', dayStart)
        .lte('completed_at', dayEnd)
        .is('deleted_at', null),
    ])

    const queryError = dueInRes.error || wipRes.error || completedRes.error || columnsRes.error
    if (queryError) {
      console.error('Workshop board query error:', queryError)
      return c.json({ error: queryError.message }, 500)
    }

    const healthChecks = [
      ...(dueInRes.data || []),
      ...(wipRes.data || []),
      ...(completedRes.data || [])
    ]
    const hcIds = healthChecks.map(hc => hc.id)

    // Card metadata, latest notes, live clocked-on state
    const [cardsRes, notesRes, timeEntriesRes] = hcIds.length
      ? await Promise.all([
          supabaseAdmin
            .from('workshop_cards')
            .select('*')
            .eq('organization_id', auth.orgId)
            .in('health_check_id', hcIds),
          supabaseAdmin
            .from('workshop_notes')
            .select('id, health_check_id, content, created_at, user:users(id, first_name, last_name)')
            .eq('organization_id', auth.orgId)
            .in('health_check_id', hcIds)
            .order('created_at', { ascending: false })
            .limit(300),
          supabaseAdmin
            .from('technician_time_entries')
            .select('health_check_id, technician_id, clock_in_at')
            .in('health_check_id', hcIds)
            .is('clock_out_at', null),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }]

    const cardMetaByHc = new Map<string, Record<string, unknown>>()
    for (const card of cardsRes.data || []) {
      cardMetaByHc.set(card.health_check_id as string, card)
    }

    const latestNoteByHc = new Map<string, Record<string, unknown>>()
    const noteCountByHc = new Map<string, number>()
    for (const note of notesRes.data || []) {
      const hcId = note.health_check_id as string
      if (!latestNoteByHc.has(hcId)) latestNoteByHc.set(hcId, note)
      noteCountByHc.set(hcId, (noteCountByHc.get(hcId) || 0) + 1)
    }

    const clockedOnByHc = new Map<string, Record<string, unknown>>()
    for (const entry of timeEntriesRes.data || []) {
      clockedOnByHc.set(entry.health_check_id as string, entry)
    }

    const columns = (columnsRes.data || []).filter(col =>
      col.column_type === 'queue' ||
      (col.technician as { is_active?: boolean } | null)?.is_active !== false
    )
    const techColumnByUserId = new Map<string, string>()
    const queueColumnIds = new Set<string>()
    for (const col of columns) {
      if (col.column_type === 'technician' && col.technician_id) {
        techColumnByUserId.set(col.technician_id as string, col.id as string)
      }
      if (col.column_type === 'queue') queueColumnIds.add(col.id as string)
    }

    const cards = healthChecks.map(hc => {
      const meta = cardMetaByHc.get(hc.id) || null
      const latestNote = latestNoteByHc.get(hc.id) || null

      // Resolve board position: manual placement first, then derive
      let position: string = 'checked_in'
      let columnId: string | null = null
      if (meta?.placement === 'work_complete' || hc.status === 'completed') {
        position = 'work_complete'
      } else if (
        meta?.placement === 'queue' &&
        meta.queue_column_id &&
        queueColumnIds.has(meta.queue_column_id as string)
      ) {
        position = 'column'
        columnId = meta.queue_column_id as string
      } else if (hc.status === 'awaiting_arrival') {
        position = 'due_in'
      } else if (hc.technician_id && techColumnByUserId.has(hc.technician_id)) {
        position = 'column'
        columnId = techColumnByUserId.get(hc.technician_id)!
      }

      const estimatedHours =
        meta?.estimated_hours != null
          ? Number(meta.estimated_hours)
          : bookedRepairsHours(hc.booked_repairs)

      const clockEntry = clockedOnByHc.get(hc.id)

      return {
        healthCheckId: hc.id,
        position,
        columnId,
        status: hc.status,
        sortPosition: (meta?.sort_position as number) ?? 0,
        workshopStatusId: (meta?.workshop_status_id as string) ?? null,
        priority: (meta?.priority as string) ?? 'normal',
        estimatedHours,
        plannedStartAt: (meta?.planned_start_at as string) ?? null,
        totalTechTimeMinutes: (hc.total_tech_time_minutes as number) ?? 0,
        workCompletedAt: (meta?.work_completed_at as string) ?? hc.completed_at ?? null,
        promiseTime: hc.promise_time,
        dueDate: hc.due_date,
        arrivedAt: hc.arrived_at,
        createdAt: hc.created_at,
        customerWaiting: hc.customer_waiting === true,
        loanCarRequired: hc.loan_car_required === true,
        isInternal: hc.is_internal === true,
        jobsheetNumber: hc.jobsheet_number,
        jobNumber: hc.job_number,
        mileageIn: hc.mileage_in,
        keyLocation: hc.key_location,
        checkinNotes: hc.checkin_notes,
        advisorNotes: hc.advisor_notes,
        bookedRepairs: hc.booked_repairs || [],
        ragCounts: { red: hc.red_count, amber: hc.amber_count, green: hc.green_count },
        techStartedAt: hc.tech_started_at,
        techCompletedAt: hc.tech_completed_at,
        isClockedOn: !!clockEntry,
        clockedOnSince: (clockEntry?.clock_in_at as string) ?? null,
        vehicle: hc.vehicle,
        customer: hc.customer,
        technician: hc.technician,
        advisor: hc.advisor,
        latestNote: latestNote
          ? {
              content: latestNote.content,
              createdAt: latestNote.created_at,
              user: latestNote.user
            }
          : null,
        notesCount: noteCountByHc.get(hc.id) || 0
      }
    })

    return c.json({
      siteId,
      date,
      config: {
        defaultTechHours: configRes.data ? Number(configRes.data.default_tech_hours) : 8.0,
        dayStartTime: (configRes.data?.day_start_time as string)?.slice(0, 5) || '08:00',
        dayEndTime: (configRes.data?.day_end_time as string)?.slice(0, 5) || '17:30',
        lunchStartTime: (configRes.data?.lunch_start_time as string)?.slice(0, 5) || null,
        lunchEndTime: (configRes.data?.lunch_end_time as string)?.slice(0, 5) || null
      },
      statuses: (statusesRes.data || []).map(s => ({
        id: s.id,
        name: s.name,
        colour: s.colour,
        icon: s.icon,
        smsMessage: s.sms_message,
        sortOrder: s.sort_order,
        isActive: s.is_active
      })),
      columns: columns.map(col => ({
        id: col.id,
        columnType: col.column_type,
        technicianId: col.technician_id,
        technician: col.technician,
        name: col.column_type === 'technician'
          ? `${(col.technician as { first_name?: string } | null)?.first_name || ''} ${(col.technician as { last_name?: string } | null)?.last_name || ''}`.trim()
          : col.name,
        colour: col.colour,
        availableHours: Number(col.available_hours),
        sortOrder: col.sort_order,
        isVisible: col.is_visible
      })),
      cards
    })
  } catch (error) {
    console.error('Get workshop board error:', error)
    return c.json({ error: 'Failed to load workshop board' }, 500)
  }
})

// ============================================================================
// Card moves and metadata
// ============================================================================

async function getHealthCheckForBoard(healthCheckId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, site_id, technician_id, organization_id')
    .eq('id', healthCheckId)
    .eq('organization_id', orgId)
    .single()
  return data
}

async function upsertWorkshopCard(
  orgId: string,
  healthCheckId: string,
  fields: Record<string, unknown>
) {
  const { data, error } = await supabaseAdmin
    .from('workshop_cards')
    .upsert(
      {
        organization_id: orgId,
        health_check_id: healthCheckId,
        ...fields,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'health_check_id' }
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// POST /cards/:healthCheckId/move - Drag a card to a new column
workshopBoard.post('/cards/:healthCheckId/move', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId } = c.req.param()
    const body = await c.req.json()
    const { target, columnId, sortPosition } = body as {
      // 'workshop' = clear manual placement, return to derived position
      // (tech column / checked in) WITHOUT changing the assigned technician
      target: 'checked_in' | 'technician' | 'queue' | 'work_complete' | 'workshop'
      columnId?: string
      sortPosition?: number
    }

    if (!['checked_in', 'technician', 'queue', 'work_complete', 'workshop'].includes(target)) {
      return c.json({ error: 'Invalid move target' }, 400)
    }

    const hc = await getHealthCheckForBoard(healthCheckId, auth.orgId)
    if (!hc) return c.json({ error: 'Health check not found' }, 404)

    const isTechnician = auth.user.role === 'technician'

    // Resolve target column when needed
    let targetColumn: { id: string; column_type: string; technician_id: string | null; site_id: string } | null = null
    if (target === 'technician' || target === 'queue') {
      if (!columnId) return c.json({ error: 'columnId is required for this target' }, 400)
      const { data: col } = await supabaseAdmin
        .from('workshop_columns')
        .select('id, column_type, technician_id, site_id')
        .eq('id', columnId)
        .eq('organization_id', auth.orgId)
        .single()
      if (!col) return c.json({ error: 'Column not found' }, 404)
      const expectedType = target === 'technician' ? 'technician' : 'queue'
      if (col.column_type !== expectedType) {
        return c.json({ error: `Column is not a ${expectedType} column` }, 400)
      }
      targetColumn = col
    }

    // Technicians may only move their own jobs, and may only assign themselves
    if (isTechnician) {
      const movingOwnJob = hc.technician_id === auth.user.id
      const claimingForSelf = target === 'technician' && targetColumn?.technician_id === auth.user.id
      if (!movingOwnJob && !claimingForSelf) {
        return c.json({ error: 'Technicians can only move their own jobs' }, 403)
      }
      if (target === 'technician' && targetColumn?.technician_id !== auth.user.id) {
        return c.json({ error: 'Technicians cannot assign jobs to other technicians' }, 403)
      }
      if (target === 'checked_in') {
        return c.json({ error: 'Technicians cannot unassign jobs' }, 403)
      }
    }

    if (target === 'workshop') {
      await upsertWorkshopCard(auth.orgId, healthCheckId, {
        placed_by: auth.user.id,
        ...(typeof sortPosition === 'number' ? { sort_position: sortPosition } : {}),
        placement: 'auto',
        queue_column_id: null,
        work_completed_at: null,
        work_completed_by: null
      })
      emitBoardUpdated(hc.site_id, 'card_moved', healthCheckId)
      return c.json({ success: true })
    }

    const now = new Date().toISOString()
    const cardFields: Record<string, unknown> = { placed_by: auth.user.id }
    if (typeof sortPosition === 'number') cardFields.sort_position = sortPosition

    if (target === 'technician') {
      if (hc.status === 'awaiting_checkin') {
        return c.json({ error: 'Vehicle must complete check-in before assignment', code: 'CHECKIN_REQUIRED' }, 400)
      }

      const technicianId = targetColumn!.technician_id!

      // Forward planning: a not-yet-arrived booking can be pre-allocated to a
      // technician (timeline planning for tomorrow) without changing status -
      // it stays in Due In until it is marked arrived.
      const isPreAllocation = hc.status === 'awaiting_arrival'
      const newStatus = isPreAllocation ? hc.status : hc.status === 'created' ? 'assigned' : hc.status

      const { error: updateError } = await supabaseAdmin
        .from('health_checks')
        .update({
          technician_id: technicianId,
          status: newStatus,
          ...(newStatus === 'assigned' && hc.status === 'created' ? { assigned_at: now } : {}),
          updated_at: now
        })
        .eq('id', healthCheckId)
        .eq('organization_id', auth.orgId)
      if (updateError) return c.json({ error: updateError.message }, 500)

      if (newStatus !== hc.status) {
        await supabaseAdmin.from('health_check_status_history').insert({
          health_check_id: healthCheckId,
          from_status: hc.status,
          to_status: newStatus,
          changed_by: auth.user.id,
          change_source: 'user',
          notes: 'Assigned via workshop board'
        })
      }

      // Manual placements no longer apply once the card belongs to a tech column
      cardFields.placement = 'auto'
      cardFields.queue_column_id = null
      cardFields.work_completed_at = null
      cardFields.work_completed_by = null
      await upsertWorkshopCard(auth.orgId, healthCheckId, cardFields)

      if (technicianId !== auth.user.id && hc.technician_id !== technicianId) {
        const { data: vehicleData } = await supabaseAdmin
          .from('health_checks')
          .select('vehicle:vehicles(registration)')
          .eq('id', healthCheckId)
          .single()
        const reg = (vehicleData?.vehicle as { registration?: string } | null)?.registration || 'a vehicle'
        await createNotification(
          technicianId,
          'health_check_assigned',
          'New Job Assigned',
          `You have been assigned to ${reg} from the workshop board`,
          { healthCheckId, priority: 'normal', actionUrl: `/health-checks/${healthCheckId}` }
        )
      }
    } else if (target === 'queue') {
      await upsertWorkshopCard(auth.orgId, healthCheckId, {
        ...cardFields,
        placement: 'queue',
        queue_column_id: targetColumn!.id,
        work_completed_at: null,
        work_completed_by: null
      })
    } else if (target === 'work_complete') {
      await upsertWorkshopCard(auth.orgId, healthCheckId, {
        ...cardFields,
        placement: 'work_complete',
        queue_column_id: null,
        work_completed_at: now,
        work_completed_by: auth.user.id
      })
    } else if (target === 'checked_in') {
      // Only unstarted jobs can be unassigned back to Checked In
      if (!['created', 'assigned', 'awaiting_checkin'].includes(hc.status)) {
        return c.json({ error: `Cannot return a job with status '${hc.status}' to Checked In` }, 400)
      }
      if (hc.technician_id) {
        const newStatus = hc.status === 'assigned' ? 'created' : hc.status
        const { error: updateError } = await supabaseAdmin
          .from('health_checks')
          .update({ technician_id: null, status: newStatus, updated_at: now })
          .eq('id', healthCheckId)
          .eq('organization_id', auth.orgId)
        if (updateError) return c.json({ error: updateError.message }, 500)

        if (newStatus !== hc.status) {
          await supabaseAdmin.from('health_check_status_history').insert({
            health_check_id: healthCheckId,
            from_status: hc.status,
            to_status: newStatus,
            changed_by: auth.user.id,
            change_source: 'user',
            notes: 'Unassigned via workshop board'
          })
        }
      }
      await upsertWorkshopCard(auth.orgId, healthCheckId, {
        ...cardFields,
        placement: 'auto',
        queue_column_id: null,
        work_completed_at: null,
        work_completed_by: null
      })
    }

    emitBoardUpdated(hc.site_id, 'card_moved', healthCheckId)
    return c.json({ success: true })
  } catch (error) {
    console.error('Move workshop card error:', error)
    return c.json({ error: 'Failed to move card' }, 500)
  }
})

// PATCH /cards/:healthCheckId - Update card metadata (status, priority, hours)
workshopBoard.patch('/cards/:healthCheckId', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId } = c.req.param()
    const body = await c.req.json()

    const hc = await getHealthCheckForBoard(healthCheckId, auth.orgId)
    if (!hc) return c.json({ error: 'Health check not found' }, 404)

    if (auth.user.role === 'technician' && hc.technician_id !== auth.user.id) {
      return c.json({ error: 'Technicians can only update their own jobs' }, 403)
    }

    const fields: Record<string, unknown> = {}

    if ('workshopStatusId' in body) {
      if (body.workshopStatusId !== null) {
        const { data: status } = await supabaseAdmin
          .from('workshop_statuses')
          .select('id')
          .eq('id', body.workshopStatusId)
          .eq('organization_id', auth.orgId)
          .single()
        if (!status) return c.json({ error: 'Workshop status not found' }, 404)
      }
      fields.workshop_status_id = body.workshopStatusId
    }
    if ('priority' in body) {
      if (!['normal', 'high', 'urgent'].includes(body.priority)) {
        return c.json({ error: 'Invalid priority' }, 400)
      }
      fields.priority = body.priority
    }
    if ('estimatedHours' in body) {
      const hours = body.estimatedHours
      if (hours !== null && (typeof hours !== 'number' || hours < 0 || hours > 999)) {
        return c.json({ error: 'Invalid estimated hours' }, 400)
      }
      fields.estimated_hours = hours
    }
    if ('sortPosition' in body && typeof body.sortPosition === 'number') {
      fields.sort_position = body.sortPosition
    }
    if ('plannedStartAt' in body) {
      // Re-planning the day is a controller action, not a technician one
      if (auth.user.role === 'technician') {
        return c.json({ error: 'Technicians cannot change planned times' }, 403)
      }
      if (body.plannedStartAt !== null) {
        const planned = new Date(body.plannedStartAt)
        if (Number.isNaN(planned.getTime())) {
          return c.json({ error: 'Invalid plannedStartAt' }, 400)
        }
        fields.planned_start_at = planned.toISOString()
      } else {
        fields.planned_start_at = null
      }
    }

    if (Object.keys(fields).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400)
    }

    const card = await upsertWorkshopCard(auth.orgId, healthCheckId, fields)
    emitBoardUpdated(hc.site_id, 'card_updated', healthCheckId)

    return c.json({
      success: true,
      card: {
        healthCheckId,
        workshopStatusId: card.workshop_status_id,
        priority: card.priority,
        estimatedHours: card.estimated_hours != null ? Number(card.estimated_hours) : null,
        sortPosition: card.sort_position,
        plannedStartAt: card.planned_start_at ?? null
      }
    })
  } catch (error) {
    console.error('Update workshop card error:', error)
    return c.json({ error: 'Failed to update card' }, 500)
  }
})

// POST /cards/reorder - Persist new sort positions within a column
workshopBoard.post('/cards/reorder', authorize([...ADVISOR_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const positions = body.positions as Array<{ healthCheckId: string; sortPosition: number }>

    if (!Array.isArray(positions) || positions.length === 0 || positions.length > 200) {
      return c.json({ error: 'positions must be a non-empty array' }, 400)
    }

    let siteId: string | null = null
    for (const pos of positions) {
      const hc = await getHealthCheckForBoard(pos.healthCheckId, auth.orgId)
      if (!hc) continue
      siteId = hc.site_id
      await upsertWorkshopCard(auth.orgId, pos.healthCheckId, { sort_position: pos.sortPosition })
    }

    emitBoardUpdated(siteId, 'cards_reordered')
    return c.json({ success: true })
  } catch (error) {
    console.error('Reorder workshop cards error:', error)
    return c.json({ error: 'Failed to reorder cards' }, 500)
  }
})

// ============================================================================
// Notes
// ============================================================================

workshopBoard.get('/cards/:healthCheckId/notes', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId } = c.req.param()

    const hc = await getHealthCheckForBoard(healthCheckId, auth.orgId)
    if (!hc) return c.json({ error: 'Health check not found' }, 404)

    const { data: notes, error } = await supabaseAdmin
      .from('workshop_notes')
      .select('id, content, is_pinned, created_at, user:users(id, first_name, last_name, role)')
      .eq('organization_id', auth.orgId)
      .eq('health_check_id', healthCheckId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) return c.json({ error: error.message }, 500)

    return c.json({
      notes: (notes || []).map(n => ({
        id: n.id,
        content: n.content,
        isPinned: n.is_pinned === true,
        createdAt: n.created_at,
        user: n.user
      }))
    })
  } catch (error) {
    console.error('Get workshop notes error:', error)
    return c.json({ error: 'Failed to load notes' }, 500)
  }
})

workshopBoard.post('/cards/:healthCheckId/notes', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId } = c.req.param()
    const body = await c.req.json()
    const content = (body.content || '').trim()

    if (!content) return c.json({ error: 'Note content is required' }, 400)
    if (content.length > 500) return c.json({ error: 'Notes are limited to 500 characters' }, 400)

    const hc = await getHealthCheckForBoard(healthCheckId, auth.orgId)
    if (!hc) return c.json({ error: 'Health check not found' }, 404)

    const { data: note, error } = await supabaseAdmin
      .from('workshop_notes')
      .insert({
        organization_id: auth.orgId,
        health_check_id: healthCheckId,
        user_id: auth.user.id,
        content
      })
      .select('id, content, is_pinned, created_at')
      .single()

    if (error) return c.json({ error: error.message }, 500)

    emitBoardUpdated(hc.site_id, 'note_added', healthCheckId)

    return c.json({
      note: {
        id: note.id,
        content: note.content,
        isPinned: note.is_pinned === true,
        createdAt: note.created_at,
        user: {
          id: auth.user.id,
          first_name: auth.user.firstName,
          last_name: auth.user.lastName,
          role: auth.user.role
        }
      }
    }, 201)
  } catch (error) {
    console.error('Add workshop note error:', error)
    return c.json({ error: 'Failed to add note' }, 500)
  }
})

// PATCH /cards/:healthCheckId/notes/:noteId - Pin or unpin a note
workshopBoard.patch('/cards/:healthCheckId/notes/:noteId', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, noteId } = c.req.param()
    const body = await c.req.json()

    if (typeof body.isPinned !== 'boolean') {
      return c.json({ error: 'isPinned must be a boolean' }, 400)
    }

    const hc = await getHealthCheckForBoard(healthCheckId, auth.orgId)
    if (!hc) return c.json({ error: 'Health check not found' }, 404)

    const { data: note, error } = await supabaseAdmin
      .from('workshop_notes')
      .update({ is_pinned: body.isPinned })
      .eq('id', noteId)
      .eq('organization_id', auth.orgId)
      .eq('health_check_id', healthCheckId)
      .select('id, is_pinned')
      .single()

    if (error || !note) return c.json({ error: 'Note not found' }, 404)

    emitBoardUpdated(hc.site_id, 'note_updated', healthCheckId)
    return c.json({ success: true, note: { id: note.id, isPinned: note.is_pinned === true } })
  } catch (error) {
    console.error('Pin workshop note error:', error)
    return c.json({ error: 'Failed to update note' }, 500)
  }
})

// DELETE /cards/:healthCheckId/notes/:noteId - Author removes own note; admins any
workshopBoard.delete('/cards/:healthCheckId/notes/:noteId', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, noteId } = c.req.param()

    const hc = await getHealthCheckForBoard(healthCheckId, auth.orgId)
    if (!hc) return c.json({ error: 'Health check not found' }, 404)

    const { data: note } = await supabaseAdmin
      .from('workshop_notes')
      .select('id, user_id')
      .eq('id', noteId)
      .eq('organization_id', auth.orgId)
      .eq('health_check_id', healthCheckId)
      .single()
    if (!note) return c.json({ error: 'Note not found' }, 404)

    const isAdmin = (ADMIN_ROLES as readonly string[]).includes(auth.user.role)
    if (note.user_id !== auth.user.id && !isAdmin) {
      return c.json({ error: 'You can only delete your own notes' }, 403)
    }

    const { error } = await supabaseAdmin
      .from('workshop_notes')
      .delete()
      .eq('id', noteId)
      .eq('organization_id', auth.orgId)

    if (error) return c.json({ error: error.message }, 500)

    emitBoardUpdated(hc.site_id, 'note_deleted', healthCheckId)
    return c.json({ success: true })
  } catch (error) {
    console.error('Delete workshop note error:', error)
    return c.json({ error: 'Failed to delete note' }, 500)
  }
})

// ============================================================================
// Columns (technician + queue)
// ============================================================================

workshopBoard.post('/columns', authorize([...ADVISOR_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const siteId = await resolveSiteId(c)
    if (!siteId) return c.json({ error: 'No site available' }, 400)

    const body = await c.req.json()
    const columnType = body.columnType as string

    if (!['technician', 'queue'].includes(columnType)) {
      return c.json({ error: 'columnType must be technician or queue' }, 400)
    }

    // Next sort_order at end of board
    const { data: lastCol } = await supabaseAdmin
      .from('workshop_columns')
      .select('sort_order')
      .eq('site_id', siteId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const sortOrder = body.sortOrder ?? ((lastCol?.sort_order ?? 0) + 10)

    const insert: Record<string, unknown> = {
      organization_id: auth.orgId,
      site_id: siteId,
      column_type: columnType,
      sort_order: sortOrder
    }

    if (columnType === 'technician') {
      if (!body.technicianId) return c.json({ error: 'technicianId is required' }, 400)
      const { data: tech } = await supabaseAdmin
        .from('users')
        .select('id, role, is_active')
        .eq('id', body.technicianId)
        .eq('organization_id', auth.orgId)
        .single()
      if (!tech) return c.json({ error: 'Technician not found' }, 404)

      const { data: config } = await supabaseAdmin
        .from('workshop_board_config')
        .select('default_tech_hours')
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .maybeSingle()

      insert.technician_id = body.technicianId
      insert.available_hours = body.availableHours ?? Number(config?.default_tech_hours ?? 8.0)
    } else {
      const name = (body.name || '').trim()
      if (!name) return c.json({ error: 'name is required for queue columns' }, 400)
      insert.name = name.slice(0, 60)
      insert.colour = body.colour || '#6B7280'
    }

    const { data: column, error } = await supabaseAdmin
      .from('workshop_columns')
      .insert(insert)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'This technician already has a column on the board' }, 409)
      }
      return c.json({ error: error.message }, 500)
    }

    emitBoardUpdated(siteId, 'column_added')
    return c.json({ column }, 201)
  } catch (error) {
    console.error('Create workshop column error:', error)
    return c.json({ error: 'Failed to create column' }, 500)
  }
})

workshopBoard.patch('/columns/:id', authorize([...ADVISOR_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const { data: existing } = await supabaseAdmin
      .from('workshop_columns')
      .select('id, site_id, column_type')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()
    if (!existing) return c.json({ error: 'Column not found' }, 404)

    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in body && existing.column_type === 'queue') {
      const name = (body.name || '').trim()
      if (!name) return c.json({ error: 'name cannot be empty' }, 400)
      fields.name = name.slice(0, 60)
    }
    if ('colour' in body) fields.colour = body.colour
    if ('availableHours' in body) {
      const hours = Number(body.availableHours)
      if (Number.isNaN(hours) || hours < 0 || hours > 24) {
        return c.json({ error: 'availableHours must be between 0 and 24' }, 400)
      }
      fields.available_hours = hours
    }
    if ('sortOrder' in body && typeof body.sortOrder === 'number') fields.sort_order = body.sortOrder
    if ('isVisible' in body) fields.is_visible = body.isVisible === true

    const { data: column, error } = await supabaseAdmin
      .from('workshop_columns')
      .update(fields)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)

    emitBoardUpdated(existing.site_id, 'column_updated')
    return c.json({ column })
  } catch (error) {
    console.error('Update workshop column error:', error)
    return c.json({ error: 'Failed to update column' }, 500)
  }
})

workshopBoard.post('/columns/reorder', authorize([...ADVISOR_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const ids = body.columnIds as string[]

    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'columnIds must be a non-empty array' }, 400)
    }

    let siteId: string | null = null
    for (let i = 0; i < ids.length; i++) {
      const { data } = await supabaseAdmin
        .from('workshop_columns')
        .update({ sort_order: (i + 1) * 10, updated_at: new Date().toISOString() })
        .eq('id', ids[i])
        .eq('organization_id', auth.orgId)
        .select('site_id')
        .single()
      if (data) siteId = data.site_id
    }

    emitBoardUpdated(siteId, 'columns_reordered')
    return c.json({ success: true })
  } catch (error) {
    console.error('Reorder workshop columns error:', error)
    return c.json({ error: 'Failed to reorder columns' }, 500)
  }
})

workshopBoard.delete('/columns/:id', authorize([...ADVISOR_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: existing } = await supabaseAdmin
      .from('workshop_columns')
      .select('id, site_id, column_type')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()
    if (!existing) return c.json({ error: 'Column not found' }, 404)

    // Cards sitting in a deleted queue column fall back to derived placement
    if (existing.column_type === 'queue') {
      await supabaseAdmin
        .from('workshop_cards')
        .update({ placement: 'auto', queue_column_id: null, updated_at: new Date().toISOString() })
        .eq('organization_id', auth.orgId)
        .eq('queue_column_id', id)
    }

    const { error } = await supabaseAdmin
      .from('workshop_columns')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) return c.json({ error: error.message }, 500)

    emitBoardUpdated(existing.site_id, 'column_removed')
    return c.json({ success: true })
  } catch (error) {
    console.error('Delete workshop column error:', error)
    return c.json({ error: 'Failed to delete column' }, 500)
  }
})

// ============================================================================
// Workshop statuses (org-level settings)
// ============================================================================

workshopBoard.get('/statuses', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    await ensureStatusesSeeded(auth.orgId)

    const { data: statuses, error } = await supabaseAdmin
      .from('workshop_statuses')
      .select('*')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: true })

    if (error) return c.json({ error: error.message }, 500)

    return c.json({
      statuses: (statuses || []).map(s => ({
        id: s.id,
        name: s.name,
        colour: s.colour,
        icon: s.icon,
        smsMessage: s.sms_message,
        sortOrder: s.sort_order,
        isActive: s.is_active
      }))
    })
  } catch (error) {
    console.error('Get workshop statuses error:', error)
    return c.json({ error: 'Failed to load statuses' }, 500)
  }
})

workshopBoard.post('/statuses', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const name = (body.name || '').trim()

    if (!name) return c.json({ error: 'Name is required' }, 400)
    if (name.length > 50) return c.json({ error: 'Name is limited to 50 characters' }, 400)

    const { data: lastStatus } = await supabaseAdmin
      .from('workshop_statuses')
      .select('sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: status, error } = await supabaseAdmin
      .from('workshop_statuses')
      .insert({
        organization_id: auth.orgId,
        name,
        colour: body.colour || '#6366F1',
        icon: body.icon || null,
        sms_message: body.smsMessage?.trim() || null,
        sort_order: body.sortOrder ?? ((lastStatus?.sort_order ?? 0) + 10)
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return c.json({ error: 'A status with this name already exists' }, 409)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ status }, 201)
  } catch (error) {
    console.error('Create workshop status error:', error)
    return c.json({ error: 'Failed to create status' }, 500)
  }
})

workshopBoard.patch('/statuses/:id', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in body) {
      const name = (body.name || '').trim()
      if (!name) return c.json({ error: 'Name cannot be empty' }, 400)
      fields.name = name.slice(0, 50)
    }
    if ('colour' in body) fields.colour = body.colour
    if ('icon' in body) fields.icon = body.icon
    if ('smsMessage' in body) fields.sms_message = body.smsMessage?.trim() || null
    if ('sortOrder' in body && typeof body.sortOrder === 'number') fields.sort_order = body.sortOrder
    if ('isActive' in body) fields.is_active = body.isActive === true

    const { data: status, error } = await supabaseAdmin
      .from('workshop_statuses')
      .update(fields)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return c.json({ error: 'A status with this name already exists' }, 409)
      return c.json({ error: error.message }, 500)
    }
    if (!status) return c.json({ error: 'Status not found' }, 404)

    return c.json({ status })
  } catch (error) {
    console.error('Update workshop status error:', error)
    return c.json({ error: 'Failed to update status' }, 500)
  }
})

workshopBoard.delete('/statuses/:id', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Soft delete - clears it from cards but keeps history intact
    const { error } = await supabaseAdmin
      .from('workshop_statuses')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) return c.json({ error: error.message }, 500)

    await supabaseAdmin
      .from('workshop_cards')
      .update({ workshop_status_id: null, updated_at: new Date().toISOString() })
      .eq('organization_id', auth.orgId)
      .eq('workshop_status_id', id)

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete workshop status error:', error)
    return c.json({ error: 'Failed to delete status' }, 500)
  }
})

// ============================================================================
// Board config
// ============================================================================

workshopBoard.patch('/config', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const siteId = await resolveSiteId(c)
    if (!siteId) return c.json({ error: 'No site available' }, 400)

    const body = await c.req.json()
    const upsertFields: Record<string, unknown> = {
      organization_id: auth.orgId,
      site_id: siteId,
      updated_at: new Date().toISOString()
    }

    if ('defaultTechHours' in body) {
      const hours = Number(body.defaultTechHours)
      if (Number.isNaN(hours) || hours <= 0 || hours > 24) {
        return c.json({ error: 'defaultTechHours must be between 0 and 24' }, 400)
      }
      upsertFields.default_tech_hours = hours
    }

    const isHHMM = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
    if ('dayStartTime' in body) {
      if (!isHHMM(body.dayStartTime)) return c.json({ error: 'dayStartTime must be HH:MM' }, 400)
      upsertFields.day_start_time = body.dayStartTime
    }
    if ('dayEndTime' in body) {
      if (!isHHMM(body.dayEndTime)) return c.json({ error: 'dayEndTime must be HH:MM' }, 400)
      upsertFields.day_end_time = body.dayEndTime
    }
    if ('lunchStartTime' in body) {
      if (body.lunchStartTime !== null && !isHHMM(body.lunchStartTime)) {
        return c.json({ error: 'lunchStartTime must be HH:MM or null' }, 400)
      }
      upsertFields.lunch_start_time = body.lunchStartTime
    }
    if ('lunchEndTime' in body) {
      if (body.lunchEndTime !== null && !isHHMM(body.lunchEndTime)) {
        return c.json({ error: 'lunchEndTime must be HH:MM or null' }, 400)
      }
      upsertFields.lunch_end_time = body.lunchEndTime
    }

    const dayStart = (upsertFields.day_start_time as string) ?? undefined
    const dayEnd = (upsertFields.day_end_time as string) ?? undefined
    if (dayStart && dayEnd && dayStart >= dayEnd) {
      return c.json({ error: 'Day start must be before day end' }, 400)
    }

    const { data: config, error } = await supabaseAdmin
      .from('workshop_board_config')
      .upsert(upsertFields, { onConflict: 'organization_id,site_id' })
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)

    emitBoardUpdated(siteId, 'config_updated')
    return c.json({
      config: {
        defaultTechHours: Number(config.default_tech_hours),
        dayStartTime: (config.day_start_time as string)?.slice(0, 5) || '08:00',
        dayEndTime: (config.day_end_time as string)?.slice(0, 5) || '17:30',
        lunchStartTime: (config.lunch_start_time as string)?.slice(0, 5) || null,
        lunchEndTime: (config.lunch_end_time as string)?.slice(0, 5) || null
      }
    })
  } catch (error) {
    console.error('Update workshop board config error:', error)
    return c.json({ error: 'Failed to update board config' }, 500)
  }
})

export default workshopBoard
