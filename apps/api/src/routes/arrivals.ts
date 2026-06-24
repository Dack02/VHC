import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

/**
 * Arrivals — a UNIFIED view of vehicles due in, across BOTH DMS-imported bookings and GMS
 * jobsheet bookings. Both are health_checks rows in awaiting_arrival / awaiting_checkin; the
 * only thing that used to hide jobsheet bookings from the dashboard "Awaiting arrival" widget
 * was the DMS-only `external_id IS NOT NULL` filter on /dms-settings/unactioned. This endpoint
 * drops that filter and joins the parent jobsheet, so every row carries its origin
 * (dms | jobsheet | manual) and JS reference, and a single queue serves the Arrivals hub, the
 * dashboard widget and the Jobsheets "due today" section.
 *
 * Deliberately NOT gated by the jobsheets module — it serves DMS-only orgs too; jobsheet rows
 * simply appear when that module is in use. (Jobsheet embeds resolve to null for non-jobsheet
 * rows.)
 *
 * No-VHC jobsheets (the "Requires VHC" opt-out) have no health_checks row, so they are folded
 * in via a second query as synthetic awaiting_arrival items flagged hasVhc=false — their action
 * is "Mark on site" (PATCH /jobsheets/:id) rather than the full check-in.
 */
const arrivals = new Hono()

arrivals.use('*', authMiddleware)

const VIEW_ROLES = ['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician'] as const

// Note: we deliberately do NOT PostgREST-embed jobsheets here. The reference is resolved via a
// separate, error-guarded lookup so this endpoint still works (degrading to DMS + manual rows)
// if the jobsheets table/FK isn't present in a given environment.
const ARRIVAL_SELECT = `
  id, status, job_state, external_id, external_source, created_at, promise_time, due_date,
  arrived_at, checked_in_at, customer_waiting, loan_car_required, booked_repairs, jobsheet_id,
  vehicle:vehicles(id, registration, make, model),
  customer:customers(id, first_name, last_name, mobile)
`

/* eslint-disable @typescript-eslint/no-explicit-any */
function originOf(row: any): 'dms' | 'jobsheet' | 'manual' {
  if (row.jobsheet_id) return 'jobsheet'
  if (row.external_id) return 'dms'
  return 'manual'
}

function shapeArrival(row: any, refMap: Map<string, string>) {
  const v = row.vehicle
  const cust = row.customer
  return {
    id: row.id, // health_check id — the subject of mark-arrived / check-in
    healthCheckId: row.id,
    hasVhc: true,
    status: row.status,
    jobState: row.job_state,
    origin: originOf(row),
    jobsheetId: row.jobsheet_id ?? null,
    jobsheetReference: row.jobsheet_id ? refMap.get(row.jobsheet_id) ?? null : null,
    registration: v?.registration || '',
    make: v?.make || '',
    model: v?.model || '',
    customerName: cust ? `${cust.first_name} ${cust.last_name}`.trim() : '',
    customerMobile: cust?.mobile || null,
    vehicleId: v?.id || null,
    customerId: cust?.id || null,
    dueDate: row.due_date,
    promiseTime: row.promise_time,
    arrivedAt: row.arrived_at,
    checkedInAt: row.checked_in_at,
    customerWaiting: row.customer_waiting || false,
    loanCarRequired: row.loan_car_required || false,
    bookedRepairs: row.booked_repairs || [],
    importedAt: row.created_at
  }
}

// A no-VHC jobsheet rendered as a synthetic "awaiting_arrival" item.
function shapeJobsheetArrival(row: any) {
  const v = row.vehicle
  const cust = row.customer
  const time = row.due_in_time ? String(row.due_in_time).slice(0, 5) : '08:00'
  const due = new Date(`${row.due_in_date}T${time}`)
  return {
    id: row.id, // jobsheet id (no health check exists)
    healthCheckId: null,
    hasVhc: false,
    status: 'awaiting_arrival',
    jobState: row.job_state || 'due_in',
    origin: 'jobsheet' as const,
    jobsheetId: row.id,
    jobsheetReference: row.reference ?? null,
    registration: v?.registration || '',
    make: v?.make || '',
    model: v?.model || '',
    customerName: cust ? `${cust.first_name} ${cust.last_name}`.trim() : '',
    customerMobile: cust?.mobile || null,
    vehicleId: v?.id || null,
    customerId: cust?.id || null,
    dueDate: isNaN(due.getTime()) ? null : due.toISOString(),
    promiseTime: null,
    arrivedAt: null,
    checkedInAt: null,
    customerWaiting: false,
    loanCarRequired: false,
    bookedRepairs: [],
    importedAt: null
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * GET / — unified arrivals queue.
 * Query params:
 *   status  CSV of statuses (default "awaiting_arrival,awaiting_checkin")
 *   window  "soon" (default — overdue + today + tomorrow, by due_date) | "all" (no date bound)
 *   site_id filter to a site
 *   q       free-text on reg / customer / JS reference
 */
arrivals.get('/', authorize([...VIEW_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id, q, status, window = 'soon' } = c.req.query()

    const statuses = status
      ? status.split(',').map((s) => s.trim()).filter(Boolean)
      : ['awaiting_arrival', 'awaiting_checkin']

    // "soon" window: show anything due before the day after tomorrow (i.e. overdue, today,
    // tomorrow), plus rows with no due date (safety — never hide an unknown booking).
    let dueBeforeISO: string | null = null
    let dueBeforeDate: string | null = null
    if (window !== 'all') {
      const dayAfterTomorrow = new Date()
      dayAfterTomorrow.setHours(0, 0, 0, 0)
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
      dueBeforeISO = dayAfterTomorrow.toISOString()
      dueBeforeDate = dueBeforeISO.slice(0, 10)
    }

    // 1. VHC-backed arrivals (DMS + jobsheet-with-VHC) — the common case.
    let query = supabaseAdmin
      .from('health_checks')
      .select(ARRIVAL_SELECT, { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .in('status', statuses)
      .is('deleted_at', null)
    if (dueBeforeISO) query = query.or(`due_date.is.null,due_date.lt.${dueBeforeISO}`)
    if (site_id) query = query.eq('site_id', site_id)

    const { data, error } = await query
    if (error) return c.json({ error: error.message }, 500)
    const rows = data || []

    // Resolve jobsheet references for the rows that have one (error-guarded — if the jobsheets
    // table isn't present we simply omit the references rather than failing the whole endpoint).
    const refMap = new Map<string, string>()
    const jsIds = [...new Set(rows.map((r) => r.jobsheet_id).filter(Boolean) as string[])]
    if (jsIds.length) {
      const { data: refs } = await supabaseAdmin.from('jobsheets').select('id, reference').in('id', jsIds)
      for (const r of refs || []) if (r.reference) refMap.set(r.id, r.reference)
    }

    let items = rows.map((r) => shapeArrival(r, refMap))

    // 2. No-VHC jobsheets still due in (only relevant when asking for awaiting_arrival).
    //    Error-guarded so a missing jobsheets table degrades to DMS/manual rows only.
    if (statuses.includes('awaiting_arrival')) {
      let jq = supabaseAdmin
        .from('jobsheets')
        .select(
          'id, reference, due_in_date, due_in_time, job_state, vehicle_on_site, customer:customers(id, first_name, last_name, mobile), vehicle:vehicles(id, registration, make, model)'
        )
        .eq('organization_id', auth.orgId)
        .eq('is_draft', false)
        .eq('vhc_required', false)
        .eq('job_state', 'due_in')
        .is('deleted_at', null)
      if (dueBeforeDate) jq = jq.lt('due_in_date', dueBeforeDate)
      if (site_id) jq = jq.eq('site_id', site_id)
      const { data: jsRows, error: jsErr } = await jq
      if (!jsErr && jsRows) items = items.concat(jsRows.map(shapeJobsheetArrival))
    }

    // Free-text filter (reg / customer / JS ref).
    if (q) {
      const needle = q.toLowerCase()
      items = items.filter(
        (it) =>
          it.registration.toLowerCase().includes(needle) ||
          it.customerName.toLowerCase().includes(needle) ||
          (it.jobsheetReference || '').toLowerCase().includes(needle)
      )
    }

    // Sort: waiting customers first, then earliest due, then earliest created.
    items.sort((a, b) => {
      if (a.customerWaiting !== b.customerWaiting) return a.customerWaiting ? -1 : 1
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER
      return ad - bd
    })

    return c.json({
      arrivals: items,
      counts: {
        awaitingArrival: items.filter((i) => i.status === 'awaiting_arrival').length,
        awaitingCheckin: items.filter((i) => i.status === 'awaiting_checkin').length,
        total: items.length
      }
    })
  } catch (err) {
    console.error('List arrivals error:', err)
    return c.json({ error: 'Failed to list arrivals' }, 500)
  }
})

export default arrivals
