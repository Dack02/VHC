/**
 * Public estimate BOOKING routes (no auth — token-gated), companion to public-estimate.ts.
 *
 * After a customer approves an estimate online, these endpoints let them book the work in:
 *   GET  /estimate/:token/availability  → bookable days/slots (from Booking Diary capacity)
 *   POST /estimate/:token/book          → record the chosen slot (+ optional courtesy car)
 *
 * Kept as a separate router so it mounts alongside publicEstimate under /api/public without
 * touching the existing file (see README §7 for the one-line mount). Self-contained token
 * guard mirrors liveEstimate() in public-estimate.ts.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { getEstimateSettings } from '../services/estimate-settings.js'
import { getAvailability, createEstimateBooking, getEstimateBooking } from '../services/estimate-booking.js'

const publicEstimateBooking = new Hono()

const TERMINAL = ['converted', 'cancelled']

/* eslint-disable @typescript-eslint/no-explicit-any */
function clientIp(c: any): string | null {
  const fwd = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || ''
  const ip = String(fwd).split(',')[0].trim()
  return /^[\d.:a-fA-F]+$/.test(ip) ? ip : null
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function loadByToken(token: string) {
  const { data } = await supabaseAdmin
    .from('estimates')
    .select(`
      id, organization_id, site_id, status, token_expires_at, response_finalised_at,
      customer:customers(first_name, last_name)
    `)
    .eq('public_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  return data
}

// Booking is only offered once the customer has finalised an approval (accepted / partial).
const APPROVED_STATES = ['accepted', 'partial']

// GET /estimate/:token/availability
publicEstimateBooking.get('/estimate/:token/availability', async (c) => {
  const est = await loadByToken(c.req.param('token'))
  if (!est) return c.json({ error: 'Estimate not found' }, 404)
  if (est.token_expires_at && new Date(est.token_expires_at) < new Date()) {
    return c.json({ error: 'This estimate link has expired', expired: true }, 410)
  }

  const settings = await getEstimateSettings(est.organization_id)
  const existing = await getEstimateBooking(est.id)
  const availability = await getAvailability(est.organization_id, est.site_id, settings)

  return c.json({
    ...availability,
    // Booking is only actionable on an approved + still-open estimate, but we always return
    // capacity so the portal can show "what happens next" context.
    bookable: availability.enabled && APPROVED_STATES.includes(est.status) && !TERMINAL.includes(est.status),
    existingBooking: existing
  })
})

// POST /estimate/:token/book  { date, time, courtesyCar }
publicEstimateBooking.post('/estimate/:token/book', async (c) => {
  const est = await loadByToken(c.req.param('token'))
  if (!est) return c.json({ error: 'Estimate not found' }, 404)
  if (est.token_expires_at && new Date(est.token_expires_at) < new Date()) {
    return c.json({ error: 'This estimate link has expired', expired: true }, 410)
  }
  if (TERMINAL.includes(est.status)) return c.json({ error: 'This estimate is no longer open' }, 400)
  if (!APPROVED_STATES.includes(est.status)) {
    return c.json({ error: 'Please approve the work before booking a slot' }, 400)
  }

  const body = await c.req.json().catch(() => ({}))
  const settings = await getEstimateSettings(est.organization_id)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const customer = est.customer as any
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const customerName = customer ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() : null

  try {
    const booking = await createEstimateBooking(
      est.organization_id,
      est.id,
      est.site_id,
      settings,
      {
        date: body.date,
        time: body.time,
        courtesyCar: !!body.courtesyCar,
        customerName,
        ip: clientIp(c),
        userAgent: c.req.header('user-agent') || null
      }
    )

    // Audit trail, consistent with the portal's other actions.
    await supabaseAdmin.from('customer_activities').insert({
      estimate_id: est.id,
      activity_type: 'booking_requested',
      metadata: { date: body.date, time: body.time, courtesyCar: !!body.courtesyCar },
      ip_address: clientIp(c),
      user_agent: c.req.header('user-agent') || null
    }).then(() => {}, () => {})

    return c.json({ success: true, booking })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Could not book that slot' }, 400)
  }
})

export default publicEstimateBooking
