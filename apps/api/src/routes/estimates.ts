import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { applyServicePackageToRepairItem } from '../services/apply-service-package.js'
import { formatRepairItem } from './repair-items/helpers.js'
import { getEstimateSettings } from '../services/estimate-settings.js'
import { sendEstimateToCustomer } from '../services/estimate-send.js'
import { convertEstimateToJobsheet } from '../services/estimate-convert.js'
import { resolveBookingJobForParent, canBook } from '../services/resource-capacity.js'
import { buildDocumentSearchOr } from '../lib/list-search.js'

/**
 * Estimates (GMS) — a standalone, pre-booking priced quote. Mirrors the jobsheet
 * document (its own table + reference) but needs NO inspection: the advisor builds
 * priced work lines from reg + customer, sends it for the customer to accept, and on
 * acceptance it converts into a jobsheet ("Make Jobsheet").
 *
 * An estimate work line *is* a repair_item (source='estimate', estimate_id parent), so
 * the existing repair pricing engine (repair_labour / repair_parts / pricing triggers /
 * service_packages) is reused unchanged — same as the jobsheet's booked work.
 *
 * P1 scope: the document working end-to-end internally (list / detail / draft+commit /
 * priced work lines). Send-to-customer + Make-Jobsheet land in P2/P3.
 */
const estimates = new Hono()

estimates.use('*', authMiddleware)
estimates.use('*', requireModule('estimates'))

const SELECT = `
  *,
  customer:customers(id, first_name, last_name, mobile, email, phone, contact_name),
  vehicle:vehicles(id, registration, make, model, year, fuel_type),
  advisor:users!estimates_advisor_id_fkey(id, first_name, last_name),
  created_by_user:users!estimates_created_by_fkey(id, first_name, last_name),
  converted_jobsheet:jobsheets!estimates_converted_to_jobsheet_id_fkey(id, reference)
`

/* eslint-disable @typescript-eslint/no-explicit-any */
function shapeEstimate(row: any) {
  return {
    id: row.id,
    reference: row.reference,
    organizationId: row.organization_id,
    siteId: row.site_id,
    status: row.status,
    validUntil: row.valid_until,
    mileage: row.mileage,
    customerNotes: row.customer_notes,
    internalNotes: row.internal_notes,
    isDraft: row.is_draft,
    sentAt: row.sent_at,
    firstOpenedAt: row.first_opened_at,
    respondedAt: row.responded_at,
    responseFinalisedAt: row.response_finalised_at,
    authorisedAt: row.authorised_at,
    authorisedTotal: row.authorised_total != null ? parseFloat(row.authorised_total) : null,
    convertedToJobsheetId: row.converted_to_jobsheet_id,
    convertedToJobsheetReference: row.converted_jobsheet?.reference ?? null,
    convertedAt: row.converted_at,
    createdAt: row.created_at, // Document Date
    updatedAt: row.updated_at,
    customer: row.customer
      ? {
          id: row.customer.id,
          firstName: row.customer.first_name,
          lastName: row.customer.last_name,
          mobile: row.customer.mobile,
          email: row.customer.email,
          phone: row.customer.phone,
          contactName: row.customer.contact_name
        }
      : null,
    vehicle: row.vehicle
      ? {
          id: row.vehicle.id,
          registration: row.vehicle.registration,
          make: row.vehicle.make,
          model: row.vehicle.model,
          year: row.vehicle.year,
          fuelType: row.vehicle.fuel_type
        }
      : null,
    advisor: row.advisor ? { id: row.advisor.id, firstName: row.advisor.first_name, lastName: row.advisor.last_name } : null,
    createdBy: row.created_by_user ? { id: row.created_by_user.id, firstName: row.created_by_user.first_name, lastName: row.created_by_user.last_name } : null
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Batched quote value for the list. Sums top-level non-deleted repair_items
 * (price_override wins) per estimate in one query — far cheaper than the per-row
 * /work-lines call, and well under the PostgREST 1000-row cap at a 50-row page.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function attachEstimateTotals(orgId: string, shaped: any[]) {
  const ids = shaped.map((r) => r.id)
  if (!ids.length) return
  const { data } = await supabaseAdmin
    .from('repair_items')
    .select('estimate_id, total_inc_vat, price_override, outcome_status')
    .eq('organization_id', orgId)
    .in('estimate_id', ids)
    .is('parent_repair_item_id', null)
    .is('deleted_at', null)
  const totals = new Map<string, number>()
  for (const ri of (data || []) as any[]) {
    if (ri.outcome_status === 'deleted' || !ri.estimate_id) continue
    const v = Number(ri.price_override ?? ri.total_inc_vat ?? 0)
    totals.set(ri.estimate_id, (totals.get(ri.estimate_id) || 0) + v)
  }
  for (const r of shaped) r.total = totals.get(r.id) || 0
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// GET / - list estimates
estimates.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { q, site_id, status, limit = '50', offset = '0' } = c.req.query()

    let query = supabaseAdmin
      .from('estimates')
      .select(SELECT, { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .eq('is_draft', false)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (site_id) query = query.eq('site_id', site_id)
    // status accepts a single value or a comma list (drives the status tabs).
    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean)
      query = statuses.length > 1 ? query.in('status', statuses) : query.eq('status', statuses[0])
    }
    // Universal search: reference + customer name + vehicle reg.
    if (q && q.trim()) {
      const orFilter = await buildDocumentSearchOr(auth.orgId, q)
      if (orFilter) query = query.or(orFilter)
    }

    const { data, error, count } = await query
    if (error) return c.json({ error: error.message }, 500)

    const shaped = (data || []).map(shapeEstimate)
    await attachEstimateTotals(auth.orgId, shaped)

    return c.json({
      estimates: shaped,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('List estimates error:', error)
    return c.json({ error: 'Failed to list estimates' }, 500)
  }
})

// GET /stats - status counts for the estimate tabs/tiles (org-scoped, non-draft, live)
estimates.get('/stats', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id } = c.req.query()
    const base = () => {
      let qb = supabaseAdmin
        .from('estimates')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', auth.orgId)
        .eq('is_draft', false)
        .is('deleted_at', null)
      if (site_id) qb = qb.eq('site_id', site_id)
      return qb
    }
    const countOf = async (statuses: string[] | null) => {
      let qb = base()
      if (statuses) qb = qb.in('status', statuses)
      const { count } = await qb
      return count || 0
    }
    // "Expiring soon" = still-open quotes whose valid_until lands within the next 7 days.
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const soon = new Date(today.getTime() + 7 * 86400000)
    const expiringSoonQuery = base()
      .in('status', ['sent', 'opened', 'partial'])
      .gte('valid_until', iso(today))
      .lte('valid_until', iso(soon))

    // Tab groups mirror the customer-response lifecycle.
    const OPEN = ['draft', 'sent', 'opened', 'partial']
    const [all, open, sent, opened, accepted, declined, draft, expiringSoonRes] = await Promise.all([
      countOf(null),
      countOf(OPEN),
      countOf(['sent']),
      countOf(['opened', 'partial']),
      countOf(['accepted', 'converted']),
      countOf(['declined']),
      countOf(['draft']),
      expiringSoonQuery
    ])
    return c.json({ all, open, sent, opened, accepted, declined, draft, expiringSoon: expiringSoonRes.count || 0 })
  } catch (error) {
    console.error('Estimate stats error:', error)
    return c.json({ error: 'Failed to load estimate stats' }, 500)
  }
})

// GET /:id - detail
estimates.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data, error } = await supabaseAdmin
      .from('estimates')
      .select(SELECT)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .single()

    if (error || !data) return c.json({ error: 'Estimate not found' }, 404)
    return c.json(shapeEstimate(data))
  } catch (error) {
    console.error('Get estimate error:', error)
    return c.json({ error: 'Failed to get estimate' }, 500)
  }
})

// Validate that a vehicle belongs to the org and has a linked customer (same rule as
// jobsheet/VHC create). Returns the customer_id or an error message.
async function resolveVehicleCustomer(vehicleId: string, orgId: string): Promise<{ customerId: string | null; error: string | null }> {
  const { data: vehicle } = await supabaseAdmin
    .from('vehicles')
    .select('id, customer_id')
    .eq('id', vehicleId)
    .eq('organization_id', orgId)
    .single()
  if (!vehicle) return { customerId: null, error: 'Vehicle not found' }
  if (!vehicle.customer_id) return { customerId: null, error: 'A customer must be linked to the vehicle before creating an estimate.' }
  return { customerId: vehicle.customer_id, error: null }
}

// POST / - create an estimate directly (no draft dance; no work lines pre-attached)
estimates.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { vehicleId, advisorId, mileage, validUntil, customerNotes, internalNotes, siteId } = body

    if (!vehicleId) return c.json({ error: 'Vehicle is required' }, 400)

    const { customerId, error: vErr } = await resolveVehicleCustomer(vehicleId, auth.orgId)
    if (vErr) return c.json({ error: vErr }, vErr === 'Vehicle not found' ? 404 : 400)

    const { data: est, error } = await supabaseAdmin
      .from('estimates')
      .insert({
        organization_id: auth.orgId,
        site_id: siteId || auth.user.siteId || null,
        customer_id: customerId,
        vehicle_id: vehicleId,
        advisor_id: advisorId || auth.user.id,
        mileage: mileage ?? null,
        valid_until: (typeof validUntil === 'string' && validUntil) ? validUntil : null,
        customer_notes: customerNotes || null,
        internal_notes: internalNotes || null,
        status: 'draft',
        is_draft: false,
        created_by: auth.user.id
      })
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    return c.json({ id: est.id, reference: est.reference, status: est.status, createdAt: est.created_at }, 201)
  } catch (error) {
    console.error('Create estimate error:', error)
    return c.json({ error: 'Failed to create estimate' }, 500)
  }
})

// POST /draft - create a DRAFT estimate so the one-screen New page can attach work lines
// (repair_items need a parent id). A draft has no reference. Requires a vehicle with a
// linked customer. Mirrors the jobsheet draft flow.
estimates.post('/draft', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json().catch(() => ({}))
    const { vehicleId, siteId, advisorId } = body

    if (!vehicleId) return c.json({ error: 'Vehicle is required' }, 400)

    const { customerId, error: vErr } = await resolveVehicleCustomer(vehicleId, auth.orgId)
    if (vErr) return c.json({ error: vErr }, vErr === 'Vehicle not found' ? 404 : 400)

    const { data: est, error } = await supabaseAdmin
      .from('estimates')
      .insert({
        organization_id: auth.orgId,
        site_id: siteId || auth.user.siteId || null,
        customer_id: customerId,
        vehicle_id: vehicleId,
        advisor_id: advisorId || auth.user.id,
        is_draft: true,
        status: 'draft',
        created_by: auth.user.id
      })
      .select('id')
      .single()
    if (error) return c.json({ error: error.message }, 500)

    return c.json({ id: est.id }, 201)
  } catch (error) {
    console.error('Create estimate draft error:', error)
    return c.json({ error: 'Failed to create estimate draft' }, 500)
  }
})

// POST /:id/commit - finalise a draft: set fields, flip is_draft -> false (trigger
// assigns the EST reference). Work lines were attached to the draft already.
estimates.post('/:id/commit', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { advisorId, mileage, validUntil, customerNotes, internalNotes, siteId } = body

    const { data: draft } = await supabaseAdmin
      .from('estimates')
      .select('id, advisor_id, site_id, is_draft')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .single()
    if (!draft) return c.json({ error: 'Estimate not found' }, 404)
    if (!draft.is_draft) return c.json({ error: 'This estimate has already been created', id }, 400)

    const { data: est, error } = await supabaseAdmin
      .from('estimates')
      .update({
        site_id: siteId || draft.site_id || auth.user.siteId || null,
        advisor_id: advisorId || draft.advisor_id || auth.user.id,
        mileage: mileage ?? null,
        valid_until: (typeof validUntil === 'string' && validUntil) ? validUntil : null,
        customer_notes: customerNotes || null,
        internal_notes: internalNotes || null,
        is_draft: false
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()
    if (error || !est) return c.json({ error: error?.message || 'Failed to commit estimate' }, 500)

    return c.json({ id: est.id, reference: est.reference, status: est.status, createdAt: est.created_at }, 200)
  } catch (error) {
    console.error('Commit estimate error:', error)
    return c.json({ error: 'Failed to commit estimate' }, 500)
  }
})

// POST /:id/discard - hard-delete a draft (and its work lines, via cascade). Advisor-
// accessible so the person building it can cancel. Only drafts; committed estimates use
// DELETE /:id (soft delete, higher role).
estimates.post('/:id/discard', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: existing } = await supabaseAdmin
      .from('estimates')
      .select('id, is_draft')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()
    if (!existing) return c.json({ error: 'Estimate not found' }, 404)
    if (!existing.is_draft) return c.json({ error: 'Only draft estimates can be discarded' }, 400)

    // Hard delete — repair_items (work lines) cascade off estimate_id, and
    // repair_labour / repair_parts cascade off repair_items.
    const { error } = await supabaseAdmin
      .from('estimates')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)

    return c.json({ message: 'Draft discarded' })
  } catch (error) {
    console.error('Discard estimate draft error:', error)
    return c.json({ error: 'Failed to discard draft' }, 500)
  }
})

// PATCH /:id - update estimate fields
estimates.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const { data: existing } = await supabaseAdmin
      .from('estimates')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .single()
    if (!existing) return c.json({ error: 'Estimate not found' }, 404)

    const updateData: Record<string, unknown> = {}
    if (body.advisorId !== undefined) updateData.advisor_id = body.advisorId || null
    if (body.mileage !== undefined) updateData.mileage = body.mileage ?? null
    if (body.validUntil !== undefined) updateData.valid_until = (typeof body.validUntil === 'string' && body.validUntil) ? body.validUntil : null
    if (body.customerNotes !== undefined) updateData.customer_notes = body.customerNotes || null
    if (body.internalNotes !== undefined) updateData.internal_notes = body.internalNotes || null
    if (body.status !== undefined && typeof body.status === 'string' && body.status) updateData.status = body.status

    if (Object.keys(updateData).length) {
      const { error } = await supabaseAdmin
        .from('estimates')
        .update(updateData)
        .eq('id', id)
        .eq('organization_id', auth.orgId)
      if (error) return c.json({ error: error.message }, 500)
    }

    const { data: fresh } = await supabaseAdmin
      .from('estimates')
      .select(SELECT)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    return c.json(fresh ? shapeEstimate(fresh) : { id })
  } catch (error) {
    console.error('Update estimate error:', error)
    return c.json({ error: 'Failed to update estimate' }, 500)
  }
})

// DELETE /:id - soft delete estimate (+ cascade its work lines via hard FK on hard delete
// only; here we soft-delete the document and leave lines, mirroring jobsheet soft delete).
estimates.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: existing } = await supabaseAdmin
      .from('estimates')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()
    if (!existing) return c.json({ error: 'Estimate not found' }, 404)

    const now = new Date().toISOString()
    const { error } = await supabaseAdmin
      .from('estimates')
      .update({ deleted_at: now, deleted_by: auth.user.id })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)

    return c.json({ message: 'Estimate deleted' })
  } catch (error) {
    console.error('Delete estimate error:', error)
    return c.json({ error: 'Failed to delete estimate' }, 500)
  }
})

// POST /:id/send - mint a public customer link + dispatch the estimate (SMS/email)
estimates.post('/:id/send', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const wantEmail = body.sendEmail !== false
    const wantSms = body.sendSms === true
    const customMessage = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : undefined

    const { data: est } = await supabaseAdmin
      .from('estimates')
      .select('id, status, is_draft, valid_until, public_token')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .single()
    if (!est) return c.json({ error: 'Estimate not found' }, 404)
    if (est.is_draft) return c.json({ error: 'Finish creating the estimate before sending' }, 400)
    if (['converted', 'cancelled'].includes(est.status)) return c.json({ error: `Cannot send a ${est.status} estimate` }, 400)

    const settings = await getEstimateSettings(auth.orgId)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + settings.linkExpiryDays)
    // Reuse the existing token on re-send so old links stay valid; mint one otherwise.
    const publicToken = est.public_token || Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const validUntil = est.valid_until || expiresAt.toISOString().slice(0, 10)

    const { error: updErr } = await supabaseAdmin
      .from('estimates')
      .update({
        public_token: publicToken,
        token_expires_at: expiresAt.toISOString(),
        valid_until: validUntil,
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (updErr) return c.json({ error: updErr.message }, 500)

    const sent = await sendEstimateToCustomer({ estimateId: id, orgId: auth.orgId, sendEmail: wantEmail, sendSms: wantSms, customMessage })

    const publicUrl = `${process.env.PUBLIC_APP_URL || 'http://localhost:5183'}/estimate/${publicToken}`
    return c.json({ id, status: 'sent', publicToken, publicUrl, validUntil, expiresAt: expiresAt.toISOString(), sent })
  } catch (error) {
    console.error('Send estimate error:', error)
    return c.json({ error: 'Failed to send estimate' }, 500)
  }
})

// Deep-copy an estimate quote line (repair_item + its labour + parts) onto a jobsheet as
// a pre-authorised BOOKED work line. The pricing triggers recompute the new item's totals
// from the copied labour/parts inputs. Returns the new repair_item id (or null).
// POST /:id/make-jobsheet - convert an estimate into a new jobsheet (Garage-Hive style).
// Copies the approved lines (or all lines) onto a new jobsheet as pre-authorised booked
// work, links the estimate to the jobsheet, and marks it converted. Requires the jobsheets
// module too (you can't convert into a document you can't open). Shared logic lives in
// services/estimate-convert (the customer online-booking path converts the same way).
estimates.post('/:id/make-jobsheet', requireModule('jobsheets'), authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { dueInDate, dueInTime, serviceTypeId, advisorId, bookingNotes, lineSelection } = body
    if (!dueInDate) return c.json({ error: 'Due-in date is required' }, 400)

    // Capacity guard — a manual conversion is a new booking too, so book to the loading
    // target. Resolve the estimate's category + hours and check the due-in date: OK →
    // proceed; over-target (WARN/soft) → require an override + reason; physically full /
    // hard-capped (DENY_HARD) → block. Skipped when no category resolves.
    let capacityOverride = false
    let capacityOverrideReason: string | null = null
    const job = await resolveBookingJobForParent(auth.orgId, { kind: 'estimate', id })
    if (job) {
      const verdict = await canBook(auth.orgId, job.siteId, dueInDate, job.repairTypeId, job.hours)
      if (verdict.status === 'DENY_HARD') {
        return c.json({ error: verdict.reason, code: 'CAPACITY_BLOCKED' }, 409)
      }
      if (verdict.status === 'WARN' || verdict.status === 'DENY_SOFT') {
        const reason = typeof body.capacityOverrideReason === 'string' ? body.capacityOverrideReason.trim() : ''
        if (!body.capacityOverride || !reason) {
          return c.json(
            { error: 'This day is over your loading target — add an override reason to book anyway.', code: 'CAPACITY_OVERRIDE_REQUIRED', details: { reason: verdict.reason } },
            409
          )
        }
        capacityOverride = true
        capacityOverrideReason = reason
      }
    }

    const res = await convertEstimateToJobsheet({
      orgId: auth.orgId, estimateId: id, userId: auth.user.id,
      dueInDate, dueInTime, serviceTypeId, advisorId, bookingNotes,
      approvedOnly: lineSelection !== 'all', source: 'advisor',
      primaryRepairTypeId: job?.repairTypeId ?? null,
      capacityOverride, capacityOverrideReason
    })
    if (!res.ok) {
      return c.json(res.jobsheetId ? { error: res.error, jobsheetId: res.jobsheetId } : { error: res.error }, res.status as 400 | 404 | 500)
    }
    return c.json({ jobsheetId: res.jobsheetId, jobsheetReference: res.reference, linesCopied: res.linesCopied }, 201)
  } catch (error) {
    console.error('Make jobsheet from estimate error:', error)
    return c.json({ error: 'Failed to convert estimate' }, 500)
  }
})

// ============================================================================
// Work lines — the priced quote lines on the estimate.
//
// An estimate work line IS a repair_item (estimate_id parent, source='estimate'). We
// reuse the existing repair_labour / repair_parts pricing engine and the apply-package
// service unchanged — editing a line's labour/parts goes through the existing
// /repair-items/:id/* routes (they guard by repair_item ownership, parent-agnostic).
//
// Unlike jobsheet BOOKED work (pre-authorised), estimate lines are NOT pre-authorised —
// they are the quote the customer will authorise per line when they respond (P2).
// ============================================================================

const WORK_LINE_SELECT = `
  *,
  labour:repair_labour!repair_labour_repair_item_id_fkey(
    id, labour_code_id, hours, rate, total, is_vat_exempt, notes,
    labour_code:labour_codes(id, code, description)
  ),
  parts:repair_parts!repair_parts_repair_item_id_fkey(
    id, part_number, description, quantity, supplier_id, supplier_name,
    cost_price, sell_price, line_total, margin_percent, markup_percent, notes
  )
`

/* eslint-disable @typescript-eslint/no-explicit-any */
function shapeWorkLine(item: any) {
  const base = formatRepairItem(item)
  return {
    ...base,
    origin: 'estimate',
    labour: (item.labour || []).map((lab: any) => ({
      id: lab.id,
      labourCodeId: lab.labour_code_id,
      labourCode: lab.labour_code,
      hours: parseFloat(lab.hours),
      rate: parseFloat(lab.rate),
      total: parseFloat(lab.total),
      isVatExempt: lab.is_vat_exempt,
      notes: lab.notes
    })),
    parts: (item.parts || []).map((p: any) => ({
      id: p.id,
      partNumber: p.part_number,
      description: p.description,
      quantity: parseFloat(p.quantity),
      supplierId: p.supplier_id,
      supplierName: p.supplier_name,
      costPrice: parseFloat(p.cost_price),
      sellPrice: parseFloat(p.sell_price),
      lineTotal: parseFloat(p.line_total),
      marginPercent: p.margin_percent != null ? parseFloat(p.margin_percent) : null,
      notes: p.notes
    }))
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Resolve an estimate (org-scoped). Returns null if not found / not owned.
async function loadEstimate(estimateId: string, orgId: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from('estimates')
    .select('id')
    .eq('id', estimateId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()
  return data || null
}

// Create an estimate work line from a service package and apply it. Returns the new
// repair_item id, or null if the package isn't found for the org.
async function createEstimateLineFromPackage(
  estimateId: string,
  orgId: string,
  userId: string,
  servicePackageId: string
): Promise<string | null> {
  const { data: pkg } = await supabaseAdmin
    .from('service_packages')
    .select('id, name')
    .eq('id', servicePackageId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!pkg) return null

  const { data: item, error } = await supabaseAdmin
    .from('repair_items')
    .insert({
      estimate_id: estimateId,
      organization_id: orgId,
      name: pkg.name,
      source: 'estimate',
      created_by: userId
    })
    .select('id')
    .single()
  if (error || !item) return null

  await applyServicePackageToRepairItem(item.id, servicePackageId, orgId, userId)
  return item.id
}

// GET /:id/work-lines — the estimate's quote lines + totals
estimates.get('/:id/work-lines', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const est = await loadEstimate(id, auth.orgId)
    if (!est) return c.json({ error: 'Estimate not found' }, 404)

    const { data, error } = await supabaseAdmin
      .from('repair_items')
      .select(WORK_LINE_SELECT)
      .eq('organization_id', auth.orgId)
      .eq('estimate_id', id)
      .is('parent_repair_item_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (error) return c.json({ error: error.message }, 500)

    const workLines = (data || []).map(shapeWorkLine)
    const totals = workLines.reduce(
      (acc, w) => {
        acc.labourTotal += w.labourTotal || 0
        acc.partsTotal += w.partsTotal || 0
        acc.subtotal += w.subtotal || 0
        acc.vatAmount += w.vatAmount || 0
        acc.totalIncVat += w.totalIncVat || 0
        return acc
      },
      { labourTotal: 0, partsTotal: 0, subtotal: 0, vatAmount: 0, totalIncVat: 0 }
    )

    return c.json({ workLines, totals })
  } catch (error) {
    console.error('List estimate work lines error:', error)
    return c.json({ error: 'Failed to list work lines' }, 500)
  }
})

// POST /:id/work-lines — add an empty quote line
estimates.post('/:id/work-lines', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return c.json({ error: 'Name is required' }, 400)

    const est = await loadEstimate(id, auth.orgId)
    if (!est) return c.json({ error: 'Estimate not found' }, 404)

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .insert({
        estimate_id: id,
        organization_id: auth.orgId,
        name,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        source: 'estimate',
        created_by: auth.user.id
      })
      .select(WORK_LINE_SELECT)
      .single()
    if (error) return c.json({ error: error.message }, 500)

    return c.json(shapeWorkLine(item), 201)
  } catch (error) {
    console.error('Create estimate work line error:', error)
    return c.json({ error: 'Failed to create work line' }, 500)
  }
})

// POST /:id/work-lines/from-package — add a quote line pre-filled from a package
estimates.post('/:id/work-lines/from-package', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const servicePackageId = body.servicePackageId || body.service_package_id
    if (!servicePackageId) return c.json({ error: 'servicePackageId is required' }, 400)

    const est = await loadEstimate(id, auth.orgId)
    if (!est) return c.json({ error: 'Estimate not found' }, 404)

    const itemId = await createEstimateLineFromPackage(id, auth.orgId, auth.user.id, servicePackageId)
    if (!itemId) return c.json({ error: 'Service package not found' }, 404)

    const { data: item } = await supabaseAdmin
      .from('repair_items')
      .select(WORK_LINE_SELECT)
      .eq('id', itemId)
      .single()

    return c.json(item ? shapeWorkLine(item) : { id: itemId }, 201)
  } catch (error) {
    console.error('Create estimate work line from package error:', error)
    return c.json({ error: 'Failed to add package' }, 500)
  }
})

export default estimates
