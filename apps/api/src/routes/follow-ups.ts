/**
 * Follow-Up routes — the deferred-work recovery worklist and case actions.
 * Mounted at /api/v1/follow-ups
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { runFollowUpSweep, findFutureBooking, attributeBookingToFollowUp } from '../services/follow-up-engine.js'
import { getFollowUpSettings } from '../services/follow-up-settings.js'
import {
  scoreBookingRelatednessDeterministic,
  persistBookingVerdict,
  bookingMatchHash,
  type DeferredItemLite,
  type BookingLite,
} from '../services/booking-match.js'
import { DMS_BOOKING_DETAIL_SELECT, mapDmsBookingDetailRow } from '../services/dms-booking-detail.js'

const followUps = new Hono()
followUps.use('*', authMiddleware)
followUps.use('*', requireModule('follow_up'))

const OPEN_STATUSES = ['active', 'booking_found', 'engaged', 'manual']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function caseListSelect() {
  return `
    id, status, anchor_date, next_action_at, deferred_value_snapshot, item_count,
    last_contacted_at, manual_attempts, current_step_order, created_at, updated_at,
    outcome_id, outcome_notes, closed_at, linked_booking_id, health_check_id, timeline_id,
    health_check:health_checks!follow_up_cases_health_check_id_fkey(jobsheet_id),
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
    jobsheetId: c.health_check?.jobsheet_id ?? null,
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

  const [open, manual, overdue, dueToday, bookingFound, engaged, settings] = await Promise.all([
    base().in('status', OPEN_STATUSES),
    base().eq('status', 'manual'),
    base().in('status', OPEN_STATUSES).lt('next_action_at', startToday.toISOString()),
    base().in('status', OPEN_STATUSES).lte('next_action_at', endToday.toISOString()),
    base().eq('status', 'booking_found'),
    base().eq('status', 'engaged'),
    getFollowUpSettings(org),
  ])

  return c.json({
    open: open.count || 0,
    manual: manual.count || 0,
    overdue: overdue.count || 0,
    dueToday: dueToday.count || 0,
    bookingFound: bookingFound.count || 0,
    engaged: engaged.count || 0,
    // Automation state so the worklist can surface when follow-up is switched
    // off (or running in simulation mode) rather than just showing empty zeros.
    enabled: settings.enabled,
    autoSweepEnabled: settings.autoSweepEnabled,
    simulationMode: settings.simulationMode,
  })
})

// POST /api/v1/follow-ups/run-sweep — manually trigger the sweep for this org
followUps.post('/run-sweep', authorize(['super_admin', 'org_admin']), async (c) => {
  const auth = c.get('auth')
  try {
    const result = await runFollowUpSweep(auth.orgId, { trigger: 'manual' })
    if (result.disabled) {
      return c.json({ error: 'Follow-up automation is disabled for this organisation. Enable it in Follow-Up Settings first.' }, 400)
    }
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

// GET /api/v1/follow-ups/reports/outreach — bookings attributed to outreach,
// grouped by timeline | advisor | site | month (over an attribution-date window).
followUps.get('/reports/outreach', async (c) => {
  try {
    const auth = c.get('auth')
    const { date_from, date_to, site_id, group_by } = c.req.query()
    const from = date_from || new Date(Date.now() - 90 * 86400000).toISOString()
    const to = date_to || new Date().toISOString()
    const groupBy = ['timeline', 'advisor', 'site', 'month'].includes(group_by || '') ? group_by : 'timeline'
    const { data, error } = await supabaseAdmin.rpc('follow_up_outreach', {
      p_org: auth.orgId, p_from: from, p_to: to, p_site: site_id || null, p_group_by: groupBy
    })
    if (error) {
      console.error('Outreach report error:', error)
      return c.json({ error: error.message }, 500)
    }
    const rows = (data || []) as Array<{ group_key: string; group_label: string; bookings_attributed: number; est_recovered: number; avg_touches: number }>
    let totalBookings = 0
    let totalRecovered = 0
    const groups = rows.map((r) => {
      const bookings = Number(r.bookings_attributed) || 0
      const recovered = Number(r.est_recovered) || 0
      totalBookings += bookings
      totalRecovered += recovered
      return { key: r.group_key, label: r.group_label, bookings, recovered, avgTouches: Number(r.avg_touches) || 0 }
    })
    return c.json({ period: { from, to }, groupBy, totalBookings, totalRecovered, groups })
  } catch (err) {
    console.error('Outreach report error:', err)
    return c.json({ error: 'Failed to load outreach report' }, 500)
  }
})

// GET /api/v1/follow-ups — worklist
followUps.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const { status, site_id, assigned_to, due, q, limit = '50', offset = '0' } = c.req.query()

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

    // Free-text search across customer (name/mobile/email) and vehicle registration.
    // The searchable fields live on joined tables, so resolve matching customer/vehicle
    // ids first, then constrain the case list by them.
    if (q && q.trim()) {
      const like = `%${q.trim()}%`
      const [{ data: custRows }, { data: vehRows }] = await Promise.all([
        supabaseAdmin
          .from('customers')
          .select('id')
          .eq('organization_id', auth.orgId)
          .or(`first_name.ilike.${like},last_name.ilike.${like},mobile.ilike.${like},email.ilike.${like}`)
          .limit(1000),
        supabaseAdmin
          .from('vehicles')
          .select('id')
          .eq('organization_id', auth.orgId)
          .ilike('registration', like)
          .limit(1000),
      ])
      const custIds = (custRows || []).map((r) => r.id)
      const vehIds = (vehRows || []).map((r) => r.id)
      if (custIds.length === 0 && vehIds.length === 0) {
        const off0 = parseInt(offset, 10) || 0
        const lim0 = Math.min(parseInt(limit, 10) || 50, 200)
        return c.json({ cases: [], total: 0, limit: lim0, offset: off0 })
      }
      const ors: string[] = []
      if (custIds.length) ors.push(`customer_id.in.(${custIds.join(',')})`)
      if (vehIds.length) ors.push(`vehicle_id.in.(${vehIds.join(',')})`)
      query = query.or(ors.join(','))
    }

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

    const [{ data: items }, { data: events }, { data: timelineSteps }, { data: matchRow }] = await Promise.all([
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
      // Cached booking-match verdict + dismissed bookings (own query so the heavier
      // worklist select stays lean). Tolerates the columns not existing yet.
      supabaseAdmin
        .from('follow_up_cases')
        .select('booking_match_verdict, booking_match_booking_id, booking_match_hash, dismissed_booking_ids')
        .eq('id', id)
        .maybeSingle(),
    ])
    const cm = (matchRow || {}) as any

    // Linked DMS booking (if any) or a live look-up for display
    let booking: any = null
    if (cr.linked_booking_id) {
      const { data: b } = await supabaseAdmin
        .from('health_checks')
        .select('id, due_date, promise_time, booked_repairs, jobsheet_number, booked_service_type, is_mot_booking, notes, estimated_hours')
        .eq('id', cr.linked_booking_id)
        .maybeSingle()
      booking = b
    } else if (cr.customer?.id && cr.vehicle?.id) {
      booking = await findFutureBooking(auth.orgId, cr.customer.id, cr.vehicle.id, cm.dismissed_booking_ids || [])
    }

    // Attach a relatedness verdict: does the booking actually include the deferred
    // work? Prefer the cached verdict (which may be AI-refined from the sweep);
    // otherwise score deterministically inline (instant, no LLM on the hot path)
    // and, when the result is genuinely ambiguous, kick off the AI tier in the
    // background so a later open shows the refined verdict.
    if (booking) {
      const deferredItems: DeferredItemLite[] = (items || []).map((it: any) => ({
        name: it.name_snapshot, value: it.value_snapshot, rag: it.rag_snapshot,
      }))
      const bookingLite = booking as BookingLite
      const hash = bookingMatchHash(deferredItems, bookingLite)
      if (cm.booking_match_verdict && cm.booking_match_booking_id === booking.id && cm.booking_match_hash === hash) {
        booking.verdict = cm.booking_match_verdict
      } else {
        const det = scoreBookingRelatednessDeterministic(deferredItems, bookingLite)
        booking.verdict = det.verdict
        if (det.ambiguous) {
          // fire-and-forget — never block the modal on AI
          persistBookingVerdict(cr.id, auth.orgId, deferredItems, bookingLite, { userId: auth.user.id, allowAI: true })
            .catch(() => {})
        }
      }
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

// POST /api/v1/follow-ups/:id/log-call — log a manual contact, note, or defer.
//
// Two distinct behaviours, chosen by channel + whether a defer was requested:
//   • A plain NOTE (channel 'note', no call-back) is an internal annotation —
//     it records a 'note' event and leaves the case exactly where it is in the
//     cadence (no status change, no attempt count, no reschedule).
//   • A contact attempt (channel phone/sms/email) — or any save that carries a
//     call-back/snooze — takes the case over for manual follow-up and reschedules
//     next_action_at (e.g. "left a voicemail, chase again in 3 days").
// Closing with an outcome is the separate /close action.
followUps.post('/:id/log-call', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { channel, disposition_id, notes, callback_date, snooze_days } = body

    const channels = ['phone', 'sms', 'email', 'note']
    const ch = channels.includes(channel) ? channel : 'phone'
    const isNote = ch === 'note'

    const caseRow = await getCaseForOrg(id, auth.orgId)
    if (!caseRow) return c.json({ error: 'Follow-up case not found' }, 404)

    // Resolve disposition (may carry a configured snooze for contact attempts).
    let dispSnoozeDays: number | null = null
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
      dispSnoozeDays = disp.snooze_days
      dispositionName = disp.name
    }

    // Work out an optional defer target: explicit call-back date wins, then an
    // explicit snooze in days, then the disposition's configured snooze.
    const now = new Date()
    const explicitSnooze = Number(snooze_days)
    let deferTo: Date | null = null
    if (callback_date) {
      const cb = new Date(callback_date)
      if (!isNaN(cb.getTime())) deferTo = cb
    } else if (Number.isFinite(explicitSnooze) && explicitSnooze > 0) {
      deferTo = new Date(now.getTime() + explicitSnooze * 86400000)
    } else if (dispSnoozeDays && dispSnoozeDays > 0) {
      deferTo = new Date(now.getTime() + dispSnoozeDays * 86400000)
    }

    // Pure note: annotate and leave the cadence untouched.
    if (isNote && !deferTo) {
      await supabaseAdmin.from('follow_up_events').insert({
        case_id: id,
        organization_id: auth.orgId,
        event_type: 'note',
        channel: 'note',
        body: notes?.trim() || null,
        metadata: { channel: 'note' },
        created_by: auth.user.id,
      })
      return c.json({ success: true })
    }

    // Contact attempt and/or explicit defer: take the case over for manual
    // follow-up and reschedule. A note that also defers reschedules but is not
    // counted as a contact attempt.
    const nextActionAt = deferTo ?? now
    const update: Record<string, unknown> = {
      status: 'manual',
      next_action_at: nextActionAt.toISOString(),
      updated_at: now.toISOString(),
    }
    if (!isNote) {
      update.manual_attempts = (caseRow.manual_attempts || 0) + 1
      update.last_contacted_at = now.toISOString()
    }
    await supabaseAdmin.from('follow_up_cases').update(update).eq('id', id)

    await supabaseAdmin.from('follow_up_events').insert({
      case_id: id,
      organization_id: auth.orgId,
      event_type: isNote ? 'note' : 'contact_logged',
      channel: ch,
      disposition_id: disposition_id || null,
      body: notes?.trim() || null,
      metadata: {
        channel: ch,
        disposition: dispositionName || null,
        callbackDate: callback_date || null,
        snoozedTo: deferTo ? deferTo.toISOString() : null,
      },
      created_by: auth.user.id,
    })

    return c.json({ success: true, nextActionAt: nextActionAt.toISOString() })
  } catch (err) {
    console.error('Log contact error:', err)
    return c.json({ error: 'Failed to log contact' }, 500)
  }
})

// POST /api/v1/follow-ups/:id/close — close with an outcome
followUps.post('/:id/close', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { outcome_id, notes, booking_id } = body

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

    // Manual "Confirm as booked": booking_id is sent ONLY by that flow, so its
    // presence is the advisor explicitly marking this booking as covering the
    // deferred work. Credit it to outreach now (no-op if the matcher was already
    // confident and auto-attributed it; first-attribution-wins guards re-assignment).
    if (booking_id) {
      await attributeBookingToFollowUp(booking_id, id, auth.orgId, Number(caseRow.deferred_value_snapshot) || 0)
    }

    await supabaseAdmin.from('follow_up_events').insert({
      case_id: id,
      organization_id: auth.orgId,
      event_type: 'outcome_set',
      body: `Closed: ${outcome.name}${notes ? ` — ${notes.trim()}` : ''}`,
      metadata: {
        outcomeId: outcome_id,
        outcomeName: outcome.name,
        // Recorded only on a confirmed-booking close, so the conversion (closed-won)
        // and outreach (attributed booking) reports tie up to the same booking.
        bookingId: booking_id || null,
      },
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

// GET /api/v1/follow-ups/:id/booking — full DMS detail for the case's booking,
// so the advisor can open the future booking record from the Follow-Up modal
// without needing the Booking Diary module.
followUps.get('/:id/booking', async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const caseRow = await getCaseForOrg(id, auth.orgId)
    if (!caseRow) return c.json({ error: 'Follow-up case not found' }, 404)

    let bookingId: string | null = caseRow.linked_booking_id || null
    if (!bookingId && caseRow.customer_id && caseRow.vehicle_id) {
      const b = await findFutureBooking(auth.orgId, caseRow.customer_id, caseRow.vehicle_id, caseRow.dismissed_booking_ids || [])
      bookingId = b?.id || null
    }
    if (!bookingId) return c.json({ error: 'No booking linked to this case' }, 404)

    const { data, error } = await supabaseAdmin
      .from('health_checks')
      .select(DMS_BOOKING_DETAIL_SELECT)
      .eq('id', bookingId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (error) {
      console.error('Follow-up booking detail error:', error)
      return c.json({ error: 'Failed to load booking' }, 500)
    }
    if (!data) return c.json({ error: 'Booking not found' }, 404)
    return c.json(mapDmsBookingDetailRow(data))
  } catch (err) {
    console.error('Follow-up booking detail error:', err)
    return c.json({ error: 'Failed to load booking' }, 500)
  }
})

// POST /api/v1/follow-ups/:id/booking-unrelated — the advisor has reviewed the
// found booking and it is NOT related to the deferred work. Instead of resuming
// the automated cadence, drop the case straight onto the manual call list (with a
// clear reason) so the customer can be phoned to discuss the outstanding work.
// The booking is remembered as dismissed so the sweep won't re-pause on it.
followUps.post('/:id/booking-unrelated', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))

    const caseRow = await getCaseForOrg(id, auth.orgId)
    if (!caseRow) return c.json({ error: 'Follow-up case not found' }, 404)
    if (caseRow.status === 'closed') return c.json({ error: 'Cannot update a closed case' }, 400)

    // Resolve which booking is being dismissed.
    let bookingId: string | null = body.booking_id || caseRow.linked_booking_id || null
    if (!bookingId && caseRow.customer_id && caseRow.vehicle_id) {
      const b = await findFutureBooking(auth.orgId, caseRow.customer_id, caseRow.vehicle_id, caseRow.dismissed_booking_ids || [])
      bookingId = b?.id || null
    }
    if (!bookingId) return c.json({ error: 'No booking to mark as unrelated' }, 400)

    // Pull a little booking context for the activity note.
    const { data: bk } = await supabaseAdmin
      .from('health_checks')
      .select('due_date, jobsheet_number, follow_up_case_id')
      .eq('id', bookingId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    const dueLabel = bk?.due_date
      ? new Date(bk.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'an upcoming date'
    const jsLabel = bk?.jobsheet_number ? ` (jobsheet ${bk.jobsheet_number})` : ''

    const dismissed = Array.from(new Set([...(caseRow.dismissed_booking_ids || []), bookingId]))
    const now = new Date().toISOString()

    await supabaseAdmin
      .from('follow_up_cases')
      .update({
        status: 'manual',
        next_action_at: now,
        linked_booking_id: null,
        dismissed_booking_ids: dismissed,
        // Clear the stale verdict — it was for the now-dismissed booking.
        booking_match_verdict: null,
        booking_match_level: null,
        booking_match_source: null,
        booking_match_booking_id: null,
        booking_match_hash: null,
        updated_at: now,
      })
      .eq('id', id)

    // Reverse the outreach attribution we stamped on the booking when it was found
    // (only if it still points at this case) — that booking isn't ours.
    if (bk?.follow_up_case_id === id) {
      await supabaseAdmin
        .from('health_checks')
        .update({ origin_source: null, follow_up_case_id: null, follow_up_attributed_at: null, follow_up_attributed_value: null, updated_at: now })
        .eq('id', bookingId)
        .eq('follow_up_case_id', id)
    }

    await supabaseAdmin.from('follow_up_events').insert({
      case_id: id,
      organization_id: auth.orgId,
      event_type: 'status_change',
      body: `Future booking on ${dueLabel}${jsLabel} is NOT related to this deferred work — added to the call list to phone the customer and discuss.`,
      metadata: { to: 'manual', reason: 'booking_unrelated', bookingId, dueDate: bk?.due_date || null, jobsheetNumber: bk?.jobsheet_number || null },
      created_by: auth.user.id,
    })

    return c.json({ success: true })
  } catch (err) {
    console.error('Mark booking unrelated error:', err)
    return c.json({ error: 'Failed to update follow-up' }, 500)
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
