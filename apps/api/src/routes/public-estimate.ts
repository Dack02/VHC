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
      id, organization_id, reference, status, valid_until, token_expires_at, first_opened_at,
      customer_notes, responded_at,
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
// response. Returns the new status.
async function recomputeStatus(estimateId: string, orgId: string): Promise<string> {
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
      requireSignature: settings.requireSignature
    },
    organization: {
      name: branding.organizationName,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      phone: branding.phone
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
    totals
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
  const status = await recomputeStatus(est!.id, est!.organization_id)
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
  const status = await recomputeStatus(est!.id, est!.organization_id)
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

export default publicEstimate
