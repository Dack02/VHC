/**
 * Follow-Up routes — the deferred-work recovery worklist and case actions.
 * Mounted at /api/v1/follow-ups
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { runFollowUpSweep, findFutureBooking } from '../services/follow-up-engine.js'

const followUps = new Hono()
followUps.use('*', authMiddleware)

const OPEN_STATUSES = ['active', 'booking_found', 'engaged', 'manual']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function caseListSelect() {
  return `
    id, status, anchor_date, next_action_at, deferred_value_snapshot, item_count,
    last_contacted_at, manual_attempts, current_step_order, created_at, updated_at,
    outcome_id, outcome_notes, closed_at, linked_booking_id, health_check_id, timeline_id,
    customer:customers(id, first_name, last_name, mobile, email),
    vehicle:vehicles(id, registration, make, model),
    assignee:users!follow_up_cases_assigned_to_fkey(id, first_name, last_name),
    outcome:follow_up_outcomes!follow_up_cases_outcome_id_fkey(id, name, is_won)
  `
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapCaseRow(c: any) {
  return {
    id: c.id,
    status: c.status,
    anchorDate: c.anchor_date,
    nextActionAt: c.next_action_at,
    deferredValue: Number(c.deferred_value_snapshot) || 0,
    itemCount: c.item_count || 0,
    lastContactedAt: c.last_contacted_at,
    manualAttempts: c.manual_attempts || 0,
    currentStepOrder: c.current_step_order || 0,
    healthCheckId: c.health_check_id,
    linkedBookingId: c.linked_booking_id,
    outcome: c.outcome ? { id: c.outcome.id, name: c.outcome.name, isWon: c.outcome.is_won } : null,
    outcomeNotes: c.outcome_notes,
    closedAt: c.closed_at,
    customer: c.customer
      ? {
          id: c.customer.id,
          name: `${c.customer.first_name || ''} ${c.customer.last_name || ''}`.trim(),
          mobile: c.customer.mobile,
          email: c.customer.email,
        }
      : null,
    vehicle: c.vehicle
      ? { id: c.vehicle.id, registration: c.vehicle.registration, makeModel: [c.vehicle.make, c.vehicle.model].filter(Boolean).join(' ') }
      : null,
    assignee: c.assignee ? { id: c.assignee.id, name: `${c.assignee.first_name || ''} ${c.assignee.last_name || ''}`.trim() } : null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

async function getCaseForOrg(id: string, orgId: string) {
  const { data } = await supabaseAdmin.from('follow_up_cases').select('*').eq('id', id).eq('organization_id', orgId).maybeSingle()
  return data
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// STATIC routes first (so they aren't captured by /:id)
// ---------------------------------------------------------------------------

// GET /api/v1/follow-ups/summary — counts for the worklist header / action centre
followUps.get('/summary', async (c) => {
  const auth = c.get('auth')
  const org = auth.orgId
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999)

  const base = () => supabaseAdmin.from('follow_up_cases').select('id', { count: 'exact', head: true }).eq('organization_id', org)

  const [open, manual, overdue, dueToday, bookingFound, engaged] = await Promise.all([
    base().in('status', OPEN_STATUSES),
    base().eq('status', 'manual'),
    base().in('status', OPEN_STATUSES).lt('next_action_at', startToday.toISOString()),
    base().in('status', OPEN_STATUSES).lte('next_action_at', endToday.toISOString()),
    base().eq('status', 'booking_found'),
    base().eq('status', 'engaged'),
  ])

  return c.json({
    open: open.count || 0,
    manual: manual.count || 0,
    overdue: overdue.count || 0,
    dueToday: dueToday.count || 0,
    bookingFound: bookingFound.count || 0,
    engaged: engaged.count || 0,
  })
})

// POST /api/v1/follow-ups/run-sweep — manually trigger the sweep for this org
followUps.post('/run-sweep', authorize(['super_admin', 'org_admin']), async (c) => {
  const auth = c.get('auth')
  try {
    const result = await runFollowUpSweep(auth.orgId)
    return c.json({ success: true, ...result })
  } catch (err) {
    console.error('Manual follow-up sweep error:', err)
    return c.json({ error: 'Sweep failed' }, 500)
  }
})

// GET /api/v1/follow-ups/reports/pipeline — future deferred-work pipeline by due month
followUps.get('/reports/pipeline', async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id } = c.req.query()
    const { data, error } = await supabaseAdmin.rpc('follow_up_pipeline', { p_org: auth.orgId, p_site: site_id || null })
    if (error) {
      console.error('Pipeline report error:', error)
      return c.json({ error: error.message }, 500)
    }
    const rows = (data || []) as Array<{ bucket: string; item_count: number; total_value: number }>
    let totalCount = 0
    let totalValue = 0
    let undated = { count: 0, value: 0 }
    const months: Array<{ month: string; label: string; count: number; value: number }> = []
    for (const r of rows) {
      const count = Number(r.item_count) || 0
      const value = Number(r.total_value) || 0
      totalCount += count
      totalValue += value
      if (r.bucket === 'undated') { undated = { count, value }; continue }
      months.push({ month: r.bucket, label: monthLabel(r.bucket), count, value })
    }
    months.sort((a, b) => a.month.localeCompare(b.month))
    return c.json({ totalCount, totalValue, undated, months })
  } catch (err) {
    console.error('Pipeline report error:', err)
    return c.json({ error: 'Failed to load pipeline' }, 500)
  }
})

// GET /api/v1/follow-ups/reports/conversion — recovery performance by outcome
followUps.get('/reports/conversion', async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id } = c.req.query()
    const from = date_from || new Date(Date.now() - 30 * 86400000).toISOString()
    const to = date_to || new Date().toISOString()
    const { data, error } = await supabaseAdmin.rpc('follow_up_conversion', { p_org: auth.orgId, p_from: from, p_to: to, p_site: site_id || null })
    if (error) {
      console.error('Conversion report error:', error)
      return c.json({ error: error.message }, 500)
    }
    const rows = (data || []) as Array<{ outcome_name: string; is_won: boolean; case_count: number; total_value: number }>
    let totalClosed = 0
    let wonCount = 0
    let wonValue = 0
    const byOutcome = rows.map((r) => {
      const count = Number(r.case_count) || 0
      const value = Number(r.total_value) || 0
      totalClosed += count
      if (r.is_won) { wonCount += count; wonValue += value }
      return { name: r.outcome_name, isWon: r.is_won, count, value }
    })
    const conversionRate = totalClosed ? Math.round((wonCount / totalClosed) * 1000) / 10 : 0
    return c.json({ period: { from, to }, totalClosed, wonCount, wonValue, conversionRate, byOutcome })
  } catch (err) {
    console.error('Conversion report error:', err)
    return c.json({ error: 'Failed to load conversion report' }, 500)
  }
})

// GET /api/v1/follow-ups — worklist
followUps.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const { status, site_id, assigned_to, due, limit = '50', offset = '0' } = c.req.query()

    let query = supabaseAdmin
      .from('follow_up_cases')
      .select(caseListSelect(), { count: 'exact' })
      .eq('organization_id', auth.orgId)

    if (status) {
      query = query.in('status', status.split(',').map((s) => s.trim()).filter(Boolean))
    } else {
      query = query.in('status', OPEN_STATUSES)
    }
    if (site_id) query = query.eq('site_id', site_id)
    if (assigned_to) query = query.eq('assigned_to', assigned_to)

    if (due === 'overdue') {
      const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
      query = query.lt('next_action_at', startToday.toISOString())
    } else if (due === 'today') {
      const endToday = new Date(); endToday.setHours(23, 59, 59, 999)
      query = query.lte('next_action_at', endToday.toISOString())
    } else if (due === 'week') {
      query = query.lte('next_action_at', new Date(Date.now() + 7 * 86400000).toISOString())
    }

    const lim = Math.min(parseInt(limit, 10) || 50, 200)
    const off = parseInt(offset, 10) || 0

    query = query
      .order('next_action_at', { ascending: true, nullsFirst: false })
      .range(off, off + lim - 1)

    const { data, count, error } = await query
    if (error) {
      console.error('List follow-up cases error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      cases: (data || []).map(mapCaseRow),
      total: count || 0,
      limit: lim,
      offset: off,
    })
  } catch (err) {
    console.error('List follow-up cases error:', err)
    return c.json({ error: 'Failed to load follow-ups' }, 500)
  }
})

// GET /api/v1/follow-ups/:id — case detail
followUps.get('/:id', async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')

    const { data: caseRow, error } = await supabaseAdmin
      .from('follow_up_cases')
      .select(caseListSelect())
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (error || !caseRow) return c.json({ error: 'Follow-up case not found' }, 404)
    const cr = caseRow as any

    const [{ data: items }, { data: events }, { data: timelineSteps }] = await Promise.all([
      supabaseAdmin
        .from('follow_up_case_items')
        .select('id, repair_item_id, name_snapshot, value_snapshot, due_date_snapshot, rag_snapshot, item_outcome_id, item_outcome:follow_up_outcomes!follow_up_case_items_item_outcome_id_fkey(id, name), repair_item:repair_items(outcome_status, total_inc_vat)')
        .eq('case_id', id),
      supabaseAdmin
        .from('follow_up_events')
        .select('id, event_type, channel, step_order, body, metadata, created_at, disposition:follow_up_dispositions(name), actor:users!follow_up_events_created_by_fkey(first_name, last_name)')
        .eq('case_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      cr.timeline_id
        ? supabaseAdmin
            .from('follow_up_timeline_steps')
            .select('step_order, action, offset_days')
            .eq('timeline_id', cr.timeline_id)
            .order('step_order', { ascending: true })
        : Promise.resolve({ data: [] }),
    ])

    // Linked DMS booking (if any) or a live look-up for display
    let booking = null
    if (cr.linked_booking_id) {
      const { data: b } = await supabaseAdmin
        .from('health_checks')
        .select('id, due_date, promise_time, booked_repairs, jobsheet_number')
        .eq('id', cr.linked_booking_id)
        .maybeSingle()
      booking = b
    } else if (cr.customer?.id && cr.vehicle?.id) {
      booking = await findFutureBooking(auth.orgId, cr.customer.id, cr.vehicle.id)
    }

    return c.json({
      case: mapCaseRow(caseRow),
      items: (items || []).map((it: any) => ({
        id: it.id,
        repairItemId: it.repair_item_id,
        name: it.name_snapshot,
        value: Number(it.value_snapshot) || 0,
        dueDate: it.due_date_snapshot,
        rag: it.rag_snapshot,
        currentOutcomeStatus: it.repair_item?.outcome_status || null,
        itemOutcome: it.item_outcome ? { id: it.item_outcome.id, name: it.item_outcome.name } : null,
      })),
      events: (events || []).map((e: any) => ({
        id: e.id,
        type: e.event_type,
        channel: e.channel,
        stepOrder: e.step_order,
        body: e.body,
        metadata: e.metadata,
        disposition: e.disposition?.name || null,
        actor: e.actor ? `${e.actor.first_name || ''} ${e.actor.last_name || ''}`.trim() : null,
        createdAt: e.created_at,
      })),
      timelineSteps: timelineSteps || [],
      booking,
    })
  } catch (err) {
    console.error('Get follow-up case error:', err)
    return c.json({ error: 'Failed to load follow-up case' }, 500)
  }
})

// POST /api/v1/follow-ups/:id/log-call — record a manual call attempt
followUps.post('/:id/log-call', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { disposition_id, notes, callback_date } = body

    const caseRow = await getCaseForOrg(id, auth.orgId)
    if (!caseRow) return c.json({ error: 'Follow-up case not found' }, 404)

    // Resolve disposition + snooze
    let snoozeDays: number | null = null
    let dispositionName = ''
    if (disposition_id) {
      const { data: disp } = await supabaseAdmin
        .from('follow_up_dispositions')
        .select('id, name, snooze_days')
        .eq('id', disposition_id)
        .eq('organization_id', auth.orgId)
        .eq('is_active', true)
        .maybeSingle()
      if (!disp) return c.json({ error: 'Disposition not found' }, 404)
      snoozeDays = disp.snooze_days
      dispositionName = disp.name
    }

    const now = new Date()
    let nextActionAt: Date = now
    if (callback_date) {
      const cb = new Date(callback_date)
      if (!isNaN(cb.getTime())) nextActionAt = cb
    } else if (snoozeDays && snoozeDays > 0) {
      nextActionAt = new Date(now.getTime() + snoozeDays * 86400000)
    }

    await supabaseAdmin
      .from('follow_up_cases')
      .update({
        status: 'manual',
        manual_attempts: (caseRow.manual_attempts || 0) + 1,
        last_contacted_at: now.toISOString(),
        next_action_at: nextActionAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', id)

    await supabaseAdmin.from('follow_up_events').insert({
      case_id: id,
      organization_id: auth.orgId,
      event_type: 'call_logged',
      channel: 'phone',
      disposition_id: disposition_id || null,
      body: notes?.trim() || null,
      metadata: { disposition: dispositionName, callbackDate: callback_date || null },
      created_by: auth.user.id,
    })

    return c.json({ success: true, nextActionAt: nextActionAt.toISOString() })
  } catch (err) {
    console.error('Log call error:', err)
    return c.json({ error: 'Failed to log call' }, 500)
  }
})

// POST /api/v1/follow-ups/:id/close — close with an outcome
followUps.post('/:id/close', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { outcome_id, notes } = body

    if (!outcome_id) return c.json({ error: 'outcome_id is required' }, 400)

    const caseRow = await getCaseForOrg(id, auth.orgId)
    if (!caseRow) return c.json({ error: 'Follow-up case not found' }, 404)

    const { data: outcome } = await supabaseAdmin
      .from('follow_up_outcomes')
      .select('id, name, is_system')
      .eq('id', outcome_id)
      .eq('organization_id', auth.orgId)
      .eq('is_active', true)
      .maybeSingle()
    if (!outcome) return c.json({ error: 'Outcome not found' }, 404)

    if (outcome.is_system && outcome.name.toLowerCase() === 'other' && (!notes || !notes.trim())) {
      return c.json({ error: 'Notes are required when selecting "Other"' }, 400)
    }

    const now = new Date().toISOString()
    await supabaseAdmin
      .from('follow_up_cases')
      .update({
        status: 'closed',
        outcome_id,
        outcome_notes: notes?.trim() || null,
        closed_by: auth.user.id,
        closed_at: now,
        next_action_at: null,
        updated_at: now,
      })
      .eq('id', id)

    await supabaseAdmin.from('follow_up_events').insert({
      case_id: id,
      organization_id: auth.orgId,
      event_type: 'outcome_set',
      body: `Closed: ${outcome.name}${notes ? ` — ${notes.trim()}` : ''}`,
      metadata: { outcomeId: outcome_id, outcomeName: outcome.name },
      created_by: auth.user.id,
    })

    return c.json({ success: true })
  } catch (err) {
    console.error('Close follow-up error:', err)
    return c.json({ error: 'Failed to close follow-up' }, 500)
  }
})

// POST /api/v1/follow-ups/:id/items/:itemId/outcome — set a per-item outcome
followUps.post('/:id/items/:itemId/outcome', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const itemId = c.req.param('itemId')
    const { outcome_id } = await c.req.json()

    const caseRow = await getCaseForOrg(id, auth.orgId)
    if (!caseRow) return c.json({ error: 'Follow-up case not found' }, 404)

    const { data: item } = await supabaseAdmin
      .from('follow_up_case_items')
      .select('id, name_snapshot')
      .eq('id', itemId)
      .eq('case_id', id)
      .maybeSingle()
    if (!item) return c.json({ error: 'Item not found' }, 404)

    let outcomeName = ''
    if (outcome_id) {
      const { data: o } = await supabaseAdmin
        .from('follow_up_outcomes')
        .select('id, name')
        .eq('id', outcome_id)
        .eq('organization_id', auth.orgId)
        .eq('is_active', true)
        .maybeSingle()
      if (!o) return c.json({ error: 'Outcome not found' }, 404)
      outcomeName = o.name
    }

    await supabaseAdmin.from('follow_up_case_items').update({ item_outcome_id: outcome_id || null }).eq('id', itemId)

    await supabaseAdmin.from('follow_up_events').insert({
      case_id: id,
      organization_id: auth.orgId,
      event_type: 'note',
      body: outcome_id ? `Item "${item.name_snapshot}" → ${outcomeName}` : `Item "${item.name_snapshot}" outcome cleared`,
      metadata: { itemId, outcomeId: outcome_id || null },
      created_by: auth.user.id,
    })

    return c.json({ success: true })
  } catch (err) {
    console.error('Set item outcome error:', err)
    return c.json({ error: 'Failed to set item outcome' }, 500)
  }
})

// POST /api/v1/follow-ups/:id/resume — resume the automated cadence
followUps.post('/:id/resume', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const caseRow = await getCaseForOrg(id, auth.orgId)
    if (!caseRow) return c.json({ error: 'Follow-up case not found' }, 404)
    if (caseRow.status === 'closed') return c.json({ error: 'Cannot resume a closed case' }, 400)

    const now = new Date().toISOString()
    await supabaseAdmin
      .from('follow_up_cases')
      .update({ status: 'active', next_action_at: now, updated_at: now })
      .eq('id', id)

    await supabaseAdmin.from('follow_up_events').insert({
      case_id: id,
      organization_id: auth.orgId,
      event_type: 'status_change',
      body: 'Cadence resumed',
      metadata: { to: 'active' },
      created_by: auth.user.id,
    })

    return c.json({ success: true })
  } catch (err) {
    console.error('Resume follow-up error:', err)
    return c.json({ error: 'Failed to resume follow-up' }, 500)
  }
})

// POST /api/v1/follow-ups/:id/assign — reassign owner
followUps.post('/:id/assign', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { assigned_to } = body

    const caseRow = await getCaseForOrg(id, auth.orgId)
    if (!caseRow) return c.json({ error: 'Follow-up case not found' }, 404)

    if (assigned_to) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', assigned_to)
        .eq('organization_id', auth.orgId)
        .maybeSingle()
      if (!user) return c.json({ error: 'User not found' }, 404)
    }

    await supabaseAdmin
      .from('follow_up_cases')
      .update({ assigned_to: assigned_to || null, updated_at: new Date().toISOString() })
      .eq('id', id)

    return c.json({ success: true })
  } catch (err) {
    console.error('Assign follow-up error:', err)
    return c.json({ error: 'Failed to assign follow-up' }, 500)
  }
})

export default followUps
