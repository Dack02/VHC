/**
 * Public estimate portal API (no auth — token-gated). The customer opens an estimate by
 * its public_token, reviews the priced quote lines, and approves/declines (optionally with
 * a signature). Mirrors the VHC public portal (routes/public.ts) but for the simpler
 * estimate document: estimate lines ARE repair_items (estimate_id parent), so the same
 * customer_approved / outcome_status decision columns and the same org branding are reused.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { getOrganizationBranding } from '../services/email.js'
import { getEstimateSettings } from '../services/estimate-settings.js'
import { loadSiteConfig } from '../services/resource-config.js'
import { canBook, loanCarAvailableOn } from '../services/resource-capacity.js'

const publicEstimate = new Hono()

const TERMINAL = ['converted', 'cancelled']

/* eslint-disable @typescript-eslint/no-explicit-any */
// Extract the client IP from proxy headers (null if absent/invalid).
function clientIp(c: any): string | null {
  const fwd = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const ip = String(fwd).split(',')[0].trim()
  return /^[\d.:a-fA-F]+$/.test(ip) ? ip : null
}
function deviceType(c: any): string {
  const ua = (c.req.header('user-agent') || '').toLowerCase()
  if (/mobile/.test(ua)) return 'mobile'
  if (/tablet|ipad/.test(ua)) return 'tablet'
  return 'desktop'
}
async function trackEstimateActivity(estimateId: string, activityType: string, repairItemId: string | null, c: any, metadata?: Record<string, unknown>) {
  await supabaseAdmin.from('customer_activities').insert({
    estimate_id: estimateId,
    activity_type: activityType,
    repair_item_id: repairItemId,
    metadata: metadata || {},
    ip_address: clientIp(c),
    user_agent: c.req.header('user-agent') || null,
    device_type: deviceType(c)
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Resolve an estimate by public token; returns null if not found.
async function loadByToken(token: string) {
  const { data } = await supabaseAdmin
    .from('estimates')
    .select(`
      id, organization_id, site_id, reference, status, valid_until, token_expires_at, first_opened_at,
      customer_notes, responded_at, response_finalised_at,
      requested_date, requested_time, requested_slot_minutes, courtesy_car_requested, online_booked_at,
      customer:customers(first_name, last_name),
      vehicle:vehicles(registration, make, model, year)
    `)
    .eq('public_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  return data
}

async function loadLines(estimateId: string) {
  const { data } = await supabaseAdmin
    .from('repair_items')
    .select('id, name, description, subtotal, vat_amount, total_inc_vat, customer_approved, customer_declined_reason, customer_notes')
    .eq('estimate_id', estimateId)
    .is('parent_repair_item_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  return data || []
}

// Recompute the estimate status from its lines' decisions, set responded_at on first
// response. When `finalise` is set, also stamp response_finalised_at — the customer has
// confirmed their final answer, which locks the portal. Returns the new status.
async function recomputeStatus(estimateId: string, orgId: string, opts: { finalise?: boolean } = {}): Promise<string> {
  const lines = await loadLines(estimateId)
  const decided = lines.filter((l) => l.customer_approved !== null)
  const approved = lines.filter((l) => l.customer_approved === true)
  const declined = lines.filter((l) => l.customer_approved === false)

  let status: string
  if (decided.length === 0) status = 'opened'
  else if (approved.length === lines.length) status = 'accepted'
  else if (declined.length === lines.length) status = 'declined'
  else status = 'partial'

  const update: Record<string, unknown> = { status }
  if (decided.length > 0) update.responded_at = new Date().toISOString()
  if (opts.finalise) {
    const now = new Date().toISOString()
    update.response_finalised_at = now
    // Lock in WHAT the customer authorised, AT THIS MOMENT — an immutable audit
    // snapshot (inc-VAT sum of the approved lines). Never recomputed afterwards, so
    // later edits to the estimate can't change the agreed figure on record.
    const authorisedTotal = approved.reduce((sum, l) => sum + (parseFloat(l.total_inc_vat) || 0), 0)
    if (approved.length > 0) {
      update.authorised_at = now
      update.authorised_total = authorisedTotal
    }
  }

  await supabaseAdmin.from('estimates').update(update).eq('id', estimateId).eq('organization_id', orgId)
  return status
}

// GET /estimate/:token — the customer-facing estimate view.
publicEstimate.get('/estimate/:token', async (c) => {
  const token = c.req.param('token')
  const est = await loadByToken(token)
  if (!est) return c.json({ error: 'Estimate not found' }, 404)

  if (est.token_expires_at && new Date(est.token_expires_at) < new Date()) {
    return c.json({ error: 'This estimate link has expired', expired: true }, 410)
  }

  // First view → mark opened.
  if (!est.first_opened_at && !TERMINAL.includes(est.status)) {
    await supabaseAdmin
      .from('estimates')
      .update({ first_opened_at: new Date().toISOString(), status: est.status === 'sent' ? 'opened' : est.status })
      .eq('id', est.id)
    trackEstimateActivity(est.id, 'viewed', null, c).catch(() => {})
  }

  const [lines, branding, settings] = await Promise.all([
    loadLines(est.id),
    getOrganizationBranding(est.organization_id),
    getEstimateSettings(est.organization_id)
  ])

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const customer = est.customer as any
  const vehicle = est.vehicle as any
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const totals = lines.reduce(
    (acc, l) => {
      acc.subtotal += parseFloat(l.subtotal) || 0
      acc.vatAmount += parseFloat(l.vat_amount) || 0
      acc.totalIncVat += parseFloat(l.total_inc_vat) || 0
      return acc
    },
    { subtotal: 0, vatAmount: 0, totalIncVat: 0 }
  )

  return c.json({
    estimate: {
      id: est.id,
      reference: est.reference,
      status: est.status,
      validUntil: est.valid_until,
      customerNotes: est.customer_notes,
      termsText: settings.termsText,
      requireSignature: settings.requireSignature,
      responseFinalised: !!est.response_finalised_at
    },
    organization: {
      name: branding.organizationName,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      phone: branding.phone,
      usps: settings.usps
    },
    customer: customer ? { firstName: customer.first_name, lastName: customer.last_name } : null,
    vehicle: vehicle ? { registration: vehicle.registration, make: vehicle.make, model: vehicle.model, year: vehicle.year } : null,
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      subtotal: parseFloat(l.subtotal) || 0,
      vatAmount: parseFloat(l.vat_amount) || 0,
      totalIncVat: parseFloat(l.total_inc_vat) || 0,
      customerApproved: l.customer_approved,
      customerDeclinedReason: l.customer_declined_reason
    })),
    totals,
    booking: { enabled: settings.onlineBookingEnabled }
  })
})

// Guard: load estimate by token + verify it's live, returning {est} or an error response.
async function liveEstimate(c: { req: { param: (k: string) => string } }) {
  const token = c.req.param('token')
  const est = await loadByToken(token)
  if (!est) return { est: null, error: { msg: 'Estimate not found', code: 404 as const } }
  if (est.token_expires_at && new Date(est.token_expires_at) < new Date()) {
    return { est: null, error: { msg: 'This estimate link has expired', code: 410 as const } }
  }
  if (TERMINAL.includes(est.status)) return { est: null, error: { msg: 'This estimate is no longer open', code: 400 as const } }
  if (est.response_finalised_at) return { est: null, error: { msg: 'This estimate response has already been submitted', code: 400 as const } }
  return { est, error: null }
}

// Write a single line decision.
async function decideLine(estimateId: string, lineId: string, approved: boolean, c: { req: { header: (k: string) => string | undefined } }, opts: { notes?: string; reason?: string; signatureData?: string }) {
  const { data: line } = await supabaseAdmin
    .from('repair_items')
    .select('id, estimate_id')
    .eq('id', lineId)
    .eq('estimate_id', estimateId)
    .maybeSingle()
  if (!line) return false

  const update: Record<string, unknown> = {
    customer_approved: approved,
    customer_approved_at: new Date().toISOString(),
    customer_notes: opts.notes || null,
    customer_declined_reason: approved ? null : (opts.reason || null),
    outcome_status: approved ? 'authorised' : 'declined',
    outcome_source: 'online',
    outcome_set_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  if (approved && opts.signatureData) {
    update.customer_signature_data = opts.signatureData
    update.customer_signature_ip = clientIp(c)
    update.customer_signature_user_agent = c.req.header('user-agent') || null
  }
  await supabaseAdmin.from('repair_items').update(update).eq('id', lineId)
  return true
}

// POST /estimate/:token/lines/:lineId/approve
publicEstimate.post('/estimate/:token/lines/:lineId/approve', async (c) => {
  const { est, error } = await liveEstimate(c)
  if (error) return c.json({ error: error.msg, expired: error.code === 410 }, error.code)
  const lineId = c.req.param('lineId')
  const body = await c.req.json().catch(() => ({}))
  const ok = await decideLine(est!.id, lineId, true, c, { notes: body.notes, signatureData: body.signatureData })
  if (!ok) return c.json({ error: 'Line not found' }, 404)
  await trackEstimateActivity(est!.id, 'repair_item_approved', lineId, c, { notes: body.notes })
  const status = await recomputeStatus(est!.id, est!.organization_id)
  return c.json({ success: true, status })
})

// POST /estimate/:token/lines/:lineId/decline
publicEstimate.post('/estimate/:token/lines/:lineId/decline', async (c) => {
  const { est, error } = await liveEstimate(c)
  if (error) return c.json({ error: error.msg, expired: error.code === 410 }, error.code)
  const lineId = c.req.param('lineId')
  const body = await c.req.json().catch(() => ({}))
  const ok = await decideLine(est!.id, lineId, false, c, { reason: body.reason, notes: body.notes })
  if (!ok) return c.json({ error: 'Line not found' }, 404)
  await trackEstimateActivity(est!.id, 'repair_item_declined', lineId, c, { reason: body.reason })
  const status = await recomputeStatus(est!.id, est!.organization_id)
  return c.json({ success: true, status })
})

// POST /estimate/:token/approve-all — approve every line (optional signature).
publicEstimate.post('/estimate/:token/approve-all', async (c) => {
  const { est, error } = await liveEstimate(c)
  if (error) return c.json({ error: error.msg, expired: error.code === 410 }, error.code)
  const body = await c.req.json().catch(() => ({}))
  const lines = await loadLines(est!.id)
  for (const l of lines) await decideLine(est!.id, l.id, true, c, { signatureData: body.signatureData })
  await trackEstimateActivity(est!.id, 'approve_all', null, c, { count: lines.length, hasSigned: !!body.signatureData })
  const status = await recomputeStatus(est!.id, est!.organization_id, { finalise: true })
  return c.json({ success: true, status })
})

// POST /estimate/:token/decline-all
publicEstimate.post('/estimate/:token/decline-all', async (c) => {
  const { est, error } = await liveEstimate(c)
  if (error) return c.json({ error: error.msg, expired: error.code === 410 }, error.code)
  const body = await c.req.json().catch(() => ({}))
  const lines = await loadLines(est!.id)
  for (const l of lines) await decideLine(est!.id, l.id, false, c, { reason: body.reason })
  await trackEstimateActivity(est!.id, 'decline_all', null, c, { count: lines.length })
  const status = await recomputeStatus(est!.id, est!.organization_id, { finalise: true })
  return c.json({ success: true, status })
})

// POST /estimate/:token/submit — finalise a per-line response. The customer has decided
// some/all lines individually and is confirming their answer. Requires at least one
// decision; any line left undecided simply isn't approved (won't be booked). Locks the portal.
publicEstimate.post('/estimate/:token/submit', async (c) => {
  const { est, error } = await liveEstimate(c)
  if (error) return c.json({ error: error.msg, expired: error.code === 410 }, error.code)
  const lines = await loadLines(est!.id)
  const decided = lines.filter((l) => l.customer_approved !== null)
  if (decided.length === 0) return c.json({ error: 'Please approve or decline at least one item before submitting' }, 400)
  await trackEstimateActivity(est!.id, 'response_submitted', null, c, {
    approved: lines.filter((l) => l.customer_approved === true).length,
    declined: lines.filter((l) => l.customer_approved === false).length,
    total: lines.length
  })
  const status = await recomputeStatus(est!.id, est!.organization_id, { finalise: true })
  return c.json({ success: true, status })
})

// POST /estimate/:token/sign — attach a signature to all approved lines (when the org
// requires a signature to accept). Records the activity; status is already derived.
publicEstimate.post('/estimate/:token/sign', async (c) => {
  const { est, error } = await liveEstimate(c)
  if (error) return c.json({ error: error.msg, expired: error.code === 410 }, error.code)
  const body = await c.req.json().catch(() => ({}))
  if (!body.signatureData) return c.json({ error: 'Signature is required' }, 400)
  await supabaseAdmin
    .from('repair_items')
    .update({
      customer_signature_data: body.signatureData,
      customer_signature_ip: clientIp(c),
      customer_signature_user_agent: c.req.header('user-agent') || null,
      updated_at: new Date().toISOString()
    })
    .eq('estimate_id', est!.id)
    .eq('customer_approved', true)
  await trackEstimateActivity(est!.id, 'signed', null, c)
  const status = await recomputeStatus(est!.id, est!.organization_id)
  return c.json({ success: true, status })
})

// ---------------------------------------------------------------------------
// Online booking (Resource Manager P3). The customer picks a slot AFTER approving;
// availability + the final book both run through the capacity engine (canBook), so
// online bookings respect the same loading target + category quotas as everything
// else. Drop-off types offer a morning drop-off time; timed types offer slots.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }
function addDays(s: string, n: number): string { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d) }
function isoDow(s: string): number { const d = new Date(`${s}T12:00:00`).getDay(); return ((d + 6) % 7) + 1 }
function toMin(t: string): number { const [h, m] = t.split(':').map(Number); return h * 60 + m }
function fmtMin(m: number): string { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
function buildTimes(start: string, endInclusive: string, stepMin: number): string[] {
  const out: string[] = []
  for (let m = toMin(start); m <= toMin(endInclusive); m += stepMin) out.push(fmtMin(m))
  return out
}

async function defaultSiteId(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('sites').select('id').eq('organization_id', orgId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return data?.id ?? null
}

interface BookingJob { siteId: string; repairTypeId: string; hours: number; bookingMode: 'drop_off' | 'timed_slot'; slotMinutes: number }

// Resolve the estimate's category, hours, and booking mode (its first priced line's
// repair type). Returns null when there's no site or no categorisable line.
async function resolveBookingJob(est: any): Promise<BookingJob | null> {
  const siteId = est.site_id || await defaultSiteId(est.organization_id)
  if (!siteId) return null

  const { data: items } = await supabaseAdmin
    .from('repair_items')
    .select('id, parent_repair_item_id, repair_type_id, created_at')
    .eq('estimate_id', est.id)
    .order('created_at', { ascending: true })
  const top = (items || []).filter((i: any) => !i.parent_repair_item_id && i.repair_type_id)
  const primary = top[0] || (items || []).find((i: any) => i.repair_type_id)
  if (!primary?.repair_type_id) return null
  const repairTypeId = primary.repair_type_id as string

  const itemIds = (items || []).map((i: any) => i.id)
  let hours = 0
  if (itemIds.length) {
    const { data: lab } = await supabaseAdmin.from('repair_labour').select('hours').in('repair_item_id', itemIds)
    hours = (lab || []).reduce((s: number, l: any) => s + (Number(l.hours) || 0), 0)
  }
  const { data: rt } = await supabaseAdmin
    .from('repair_types')
    .select('booking_mode, slot_minutes, default_estimated_hours')
    .eq('id', repairTypeId).eq('organization_id', est.organization_id).maybeSingle()
  if (hours <= 0) hours = Number(rt?.default_estimated_hours) || 1
  const bookingMode = rt?.booking_mode === 'timed_slot' ? 'timed_slot' : 'drop_off'
  const slotMinutes = bookingMode === 'timed_slot'
    ? (Number(rt?.slot_minutes) || Math.max(15, Math.round(hours * 60)))
    : Math.max(15, Math.round(hours * 60))
  return { siteId, repairTypeId, hours, bookingMode, slotMinutes }
}

interface DayWindow { operatingDays: number[]; dayStart: string; dayEnd: string }
async function dayWindow(orgId: string, siteId: string): Promise<DayWindow> {
  const { data } = await supabaseAdmin
    .from('workshop_board_config')
    .select('operating_days, day_start_time, day_end_time')
    .eq('organization_id', orgId).eq('site_id', siteId).maybeSingle()
  const od = data?.operating_days as number[] | null | undefined
  return {
    operatingDays: od && od.length ? od : [1, 2, 3, 4, 5, 6, 7],
    dayStart: (data?.day_start_time || '08:00').slice(0, 5),
    dayEnd: (data?.day_end_time || '17:00').slice(0, 5)
  }
}

// The bookable times for one day, by mode. On the earliest date, times before the
// lead-time cutoff are dropped.
function slotTimesFor(job: BookingJob, cfg: any, win: DayWindow, date: string, earliestDate: string, earliestHHMM: string): string[] {
  let times: string[]
  if (job.bookingMode === 'timed_slot') {
    const lastStart = Math.max(toMin(win.dayStart), toMin(win.dayEnd) - job.slotMinutes)
    times = buildTimes(win.dayStart, fmtMin(lastStart), job.slotMinutes)
  } else {
    times = buildTimes(cfg.dropoffWindowStart, cfg.dropoffWindowEnd, cfg.dropoffSlotIntervalMinutes)
  }
  if (date === earliestDate) times = times.filter(t => t >= earliestHHMM)
  return times
}

const EMPTY_AVAIL = { enabled: false, bookable: false, courtesyCar: false, slotMinutes: 0, days: [] as any[] }

// GET /estimate/:token/availability  → day strip + slots (drop-off or timed)
publicEstimate.get('/estimate/:token/availability', async (c) => {
  const est = await loadByToken(c.req.param('token'))
  if (!est) return c.json({ error: 'Estimate not found' }, 404)

  const settings = await getEstimateSettings(est.organization_id)
  if (!settings.onlineBookingEnabled) return c.json(EMPTY_AVAIL)

  // Already booked → bounce the customer straight to their confirmation.
  if (est.online_booked_at && est.requested_date) {
    return c.json({
      ...EMPTY_AVAIL, enabled: true,
      existingBooking: {
        requested_date: est.requested_date,
        requested_time: (est.requested_time || '').slice(0, 5),
        slot_minutes: est.requested_slot_minutes || 0,
        courtesy_car_requested: !!est.courtesy_car_requested
      }
    })
  }

  const job = await resolveBookingJob(est)
  if (!job) return c.json(EMPTY_AVAIL)

  const [cfg, win] = await Promise.all([loadSiteConfig(est.organization_id, job.siteId), dayWindow(est.organization_id, job.siteId)])
  const now = new Date()
  const earliest = new Date(now.getTime() + cfg.onlineLeadTimeHours * 3600_000)
  const earliestDate = ymd(earliest)
  const earliestHHMM = `${String(earliest.getHours()).padStart(2, '0')}:${String(earliest.getMinutes()).padStart(2, '0')}`

  const days: any[] = []
  for (let i = 0; i <= cfg.bookingMaxDays && days.length < 14; i++) {
    const d = addDays(earliestDate, i)
    if (!win.operatingDays.includes(isoDow(d))) continue
    const verdict = await canBook(est.organization_id, job.siteId, d, job.repairTypeId, job.hours)
    const dayOpen = verdict.status === 'OK'
    const times = slotTimesFor(job, cfg, win, d, earliestDate, earliestHHMM)
    const slots = times.map(t => ({ time: t, label: t, available: dayOpen }))
    const dd = new Date(`${d}T12:00:00`)
    days.push({
      date: d,
      weekday: dd.toLocaleDateString('en-GB', { weekday: 'short' }),
      dayNum: dd.toLocaleDateString('en-GB', { day: 'numeric' }),
      monthShort: dd.toLocaleDateString('en-GB', { month: 'short' }),
      full: !slots.some(s => s.available),
      slots
    })
  }

  return c.json({
    enabled: true,
    bookable: days.some(d => !d.full),
    courtesyCar: true,
    slotMinutes: job.slotMinutes,
    mode: job.bookingMode,
    days
  })
})

// POST /estimate/:token/book  → persist the chosen slot (re-validated via canBook)
publicEstimate.post('/estimate/:token/book', async (c) => {
  const est = await loadByToken(c.req.param('token'))
  if (!est) return c.json({ error: 'Estimate not found' }, 404)
  if (est.token_expires_at && new Date(est.token_expires_at) < new Date()) {
    return c.json({ error: 'This estimate link has expired' }, 410)
  }
  const settings = await getEstimateSettings(est.organization_id)
  if (!settings.onlineBookingEnabled) return c.json({ error: 'Online booking is not available' }, 400)
  if (est.online_booked_at) return c.json({ error: 'A slot has already been booked for this estimate' }, 400)

  const body = await c.req.json().catch(() => ({}))
  const date = String(body.date || '')
  const time = String(body.time || '')
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return c.json({ error: 'A valid date and time are required' }, 400)

  const job = await resolveBookingJob(est)
  if (!job) return c.json({ error: 'Online booking is not available for this estimate' }, 400)

  const [cfg, win] = await Promise.all([loadSiteConfig(est.organization_id, job.siteId), dayWindow(est.organization_id, job.siteId)])
  const now = new Date()
  const earliest = new Date(now.getTime() + cfg.onlineLeadTimeHours * 3600_000)
  const earliestDate = ymd(earliest)
  const earliestHHMM = `${String(earliest.getHours()).padStart(2, '0')}:${String(earliest.getMinutes()).padStart(2, '0')}`

  // Validate the slot is still genuinely on offer (operating day, lead time,
  // a real slot for the mode, and capacity still OK).
  if (date < earliestDate || date > addDays(earliestDate, cfg.bookingMaxDays)) return c.json({ error: 'That date is not available' }, 400)
  if (!win.operatingDays.includes(isoDow(date))) return c.json({ error: 'That date is not available' }, 400)
  const validTimes = slotTimesFor(job, cfg, win, date, earliestDate, earliestHHMM)
  if (!validTimes.includes(time)) return c.json({ error: 'That time is not available' }, 400)
  const verdict = await canBook(est.organization_id, job.siteId, date, job.repairTypeId, job.hours)
  if (verdict.status !== 'OK') return c.json({ error: 'That slot has just been taken — please pick another.' }, 409)

  // Loan car is a separate physical resource (P4): only enforce when requested.
  if (body.courtesyCar && !(await loanCarAvailableOn(est.organization_id, job.siteId, date))) {
    return c.json({ error: 'No courtesy car is available on that day — pick another day or uncheck the courtesy car.' }, 409)
  }

  const { error } = await supabaseAdmin
    .from('estimates')
    .update({
      requested_date: date,
      requested_time: time,
      requested_slot_minutes: job.slotMinutes,
      courtesy_car_requested: !!body.courtesyCar,
      online_booked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', est.id)
    .eq('organization_id', est.organization_id)
  if (error) {
    console.error('estimate online book error:', error)
    return c.json({ error: 'Could not book that slot.' }, 500)
  }

  await trackEstimateActivity(est.id, 'online_booked', null, c, { date, time }).catch(() => {})

  return c.json({
    booking: {
      requested_date: date,
      requested_time: time,
      slot_minutes: job.slotMinutes,
      courtesy_car_requested: !!body.courtesyCar
    }
  })
})

export default publicEstimate
