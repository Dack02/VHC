import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { applyServicePackageToRepairItem } from '../services/apply-service-package.js'
import { formatRepairItem } from './repair-items/helpers.js'

/**
 * Jobsheets (GMS) — the top-level booking document. A jobsheet is the parent; a
 * health check (VHC) is attached via health_checks.jobsheet_id. Creating a jobsheet
 * also creates the linked VHC (status awaiting_arrival → job_state due_in).
 *
 * "Work Status Code" / "Vehicle Status" is NOT stored on the jobsheet — it is the
 * linked VHC's job_state, surfaced read-through here.
 */
const jobsheets = new Hono()

jobsheets.use('*', authMiddleware)
jobsheets.use('*', requireModule('jobsheets'))

const SELECT = `
  *,
  customer:customers(id, first_name, last_name, mobile, email, phone, contact_name),
  vehicle:vehicles(id, registration, make, model, year, fuel_type),
  service_type:service_types(id, code, label, colour),
  advisor:users!jobsheets_advisor_id_fkey(id, first_name, last_name),
  created_by_user:users!jobsheets_created_by_fkey(id, first_name, last_name),
  linked_checks:health_checks!health_checks_jobsheet_id_fkey(id, status, job_state, vhc_reference, deleted_at),
  codes:jobsheet_booking_codes(booking_code:booking_codes(id, code, label, colour))
`

/* eslint-disable @typescript-eslint/no-explicit-any */
function shapeJobsheet(row: any) {
  const checks = Array.isArray(row.linked_checks) ? row.linked_checks.filter((h: any) => !h.deleted_at) : []
  const hc = checks[0] || null
  return {
    id: row.id,
    reference: row.reference,
    organizationId: row.organization_id,
    siteId: row.site_id,
    dueInDate: row.due_in_date,
    dueInTime: row.due_in_time ? String(row.due_in_time).slice(0, 5) : null, // 'HH:mm' (NULL = flexible)
    mileage: row.mileage,
    requestedDeliveryAt: row.requested_delivery_at,
    courtesyVehicleRequired: row.courtesy_vehicle_required,
    collectionAndDelivery: row.collection_and_delivery,
    vehicleOnSite: row.vehicle_on_site,
    customerContactNotes: row.customer_contact_notes,
    jobsheetComplete: row.jobsheet_complete,
    vhcRequired: row.vhc_required,
    bookingNotes: row.booking_notes,
    // Vehicle Status (Option 2): the jobsheet owns its workshop position. When a VHC
    // exists its live job_state is the effective value; otherwise the jobsheet's own.
    vehicleStatus: hc ? hc.job_state : row.job_state,
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
    serviceType: row.service_type
      ? { id: row.service_type.id, code: row.service_type.code, label: row.service_type.label ?? row.service_type.code, colour: row.service_type.colour }
      : null,
    advisor: row.advisor ? { id: row.advisor.id, firstName: row.advisor.first_name, lastName: row.advisor.last_name } : null,
    createdBy: row.created_by_user ? { id: row.created_by_user.id, firstName: row.created_by_user.first_name, lastName: row.created_by_user.last_name } : null,
    // Vehicle Status ("Work Status Code") is read through from the linked VHC
    healthCheck: hc ? { id: hc.id, status: hc.status, vehicleStatus: hc.job_state, vhcReference: hc.vhc_reference } : null,
    bookingCodes: Array.isArray(row.codes)
      ? row.codes
          .map((c: any) => c.booking_code)
          .filter(Boolean)
          .map((b: any) => ({ id: b.id, code: b.code, label: b.label ?? b.code, colour: b.colour }))
      : []
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// GET / - list jobsheets (forward calendar)
jobsheets.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { q, site_id, date_from, date_to, complete, limit = '50', offset = '0' } = c.req.query()

    let query = supabaseAdmin
      .from('jobsheets')
      .select(SELECT, { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .eq('is_draft', false)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (site_id) query = query.eq('site_id', site_id)
    if (complete === 'true') query = query.eq('jobsheet_complete', true)
    if (complete === 'false') query = query.eq('jobsheet_complete', false)
    if (date_from) query = query.gte('created_at', date_from)
    if (date_to) query = query.lte('created_at', date_to)
    if (q) query = query.ilike('reference', `%${q}%`)

    const { data, error, count } = await query
    if (error) return c.json({ error: error.message }, 500)

    return c.json({
      jobsheets: (data || []).map(shapeJobsheet),
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('List jobsheets error:', error)
    return c.json({ error: 'Failed to list jobsheets' }, 500)
  }
})

// GET /:id - detail
jobsheets.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data, error } = await supabaseAdmin
      .from('jobsheets')
      .select(SELECT)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .single()

    if (error || !data) return c.json({ error: 'Jobsheet not found' }, 404)
    return c.json(shapeJobsheet(data))
  } catch (error) {
    console.error('Get jobsheet error:', error)
    return c.json({ error: 'Failed to get jobsheet' }, 500)
  }
})

// Resolve a check template for the org: default first, else first active, else any.
async function resolveTemplateId(orgId: string, provided?: string): Promise<string | null> {
  if (provided) return provided
  const { data: def } = await supabaseAdmin
    .from('check_templates')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle()
  if (def?.id) return def.id
  const { data: anyActive } = await supabaseAdmin
    .from('check_templates')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return anyActive?.id || null
}

// Filter a list of booking-code ids down to those owned by the org.
async function validBookingCodeIds(orgId: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const { data } = await supabaseAdmin
    .from('booking_codes')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', ids as string[])
  return (data || []).map((r) => r.id)
}

// Combine the mandatory due-in date + optional time into an ISO timestamp for
// health_checks.due_date. A flexible (blank) time defaults to 08:00 so the booking
// still sorts into the correct day. Returns null only if the date is missing.
function combineDueIn(dueInDate?: string, dueInTime?: string | null): string | null {
  if (!dueInDate) return null
  const time = typeof dueInTime === 'string' && dueInTime.trim() ? dueInTime.trim().slice(0, 5) : '08:00'
  const d = new Date(`${dueInDate}T${time}`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// Today's date as YYYY-MM-DD — a placeholder due-in for drafts (due_in_date is NOT NULL;
// the real value is set on commit). Drafts are invisible so the placeholder never surfaces.
function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

// Create the linked VHC for a jobsheet (status awaiting_arrival → job_state due_in) plus
// its initial status-history row. Shared by direct create (POST /) and draft commit.
async function kickOffJobsheetVhc(params: {
  orgId: string; siteId: string | null; vehicleId: string; customerId: string
  templateId: string | null; advisorId: string; mileage: number | null
  dueInDate: string; dueInTime: string | null | undefined; userId: string
  jobsheetId: string; jobsheetReference: string
}): Promise<{ hc: { id: string; status: string; job_state: string; vhc_reference: string | null } | null; error: string | null }> {
  const { data: hcRow, error: hcError } = await supabaseAdmin
    .from('health_checks')
    .insert({
      organization_id: params.orgId,
      site_id: params.siteId,
      vehicle_id: params.vehicleId,
      customer_id: params.customerId,
      template_id: params.templateId,
      advisor_id: params.advisorId,
      mileage_in: params.mileage,
      status: 'awaiting_arrival',
      due_date: combineDueIn(params.dueInDate, params.dueInTime),
      jobsheet_id: params.jobsheetId
    })
    .select('id, status, job_state, vhc_reference')
    .single()
  if (hcError || !hcRow) return { hc: null, error: hcError?.message || 'VHC creation failed' }

  await supabaseAdmin.from('health_check_status_history').insert({
    health_check_id: hcRow.id,
    from_status: null,
    to_status: hcRow.status,
    changed_by: params.userId,
    change_source: 'user',
    notes: `Created from jobsheet ${params.jobsheetReference}`
  })
  return { hc: hcRow, error: null }
}

// POST / - create jobsheet + kick off the VHC
jobsheets.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const {
      vehicleId,
      dueInDate,
      dueInTime,
      serviceTypeId,
      advisorId,
      mileage,
      requestedDeliveryAt,
      courtesyVehicleRequired,
      collectionAndDelivery,
      vehicleOnSite,
      customerContactNotes,
      bookingCodeIds,
      templateId,
      siteId,
      vhcRequired,
      bookingNotes,
      servicePackageIds
    } = body

    if (!vehicleId) return c.json({ error: 'Vehicle is required' }, 400)
    if (!dueInDate) return c.json({ error: 'Due-in date is required' }, 400)

    // The VHC is created by default but can be opted out at booking ("Requires VHC").
    const wantVhc = vhcRequired !== false

    // Vehicle must belong to org and have a linked customer (same rule as VHC create)
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('id, customer_id')
      .eq('id', vehicleId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404)
    if (!vehicle.customer_id) {
      return c.json({ error: 'A customer must be linked to the vehicle before creating a jobsheet.' }, 400)
    }

    const resolvedSite = siteId || auth.user.siteId || null
    const resolvedAdvisor = advisorId || auth.user.id

    // When a VHC is wanted, resolve its template up front so we can fail fast
    // (before creating the jobsheet) if the org has no template configured.
    let templateIdResolved: string | null = null
    if (wantVhc) {
      templateIdResolved = await resolveTemplateId(auth.orgId, templateId)
      if (!templateIdResolved) {
        return c.json({ error: 'No check template configured for this organisation. Add a template, or untick "Requires VHC".' }, 400)
      }
    }

    // 1. Insert the jobsheet (reference auto-assigned by trigger)
    const { data: js, error: jsError } = await supabaseAdmin
      .from('jobsheets')
      .insert({
        organization_id: auth.orgId,
        site_id: resolvedSite,
        customer_id: vehicle.customer_id,
        vehicle_id: vehicleId,
        service_type_id: serviceTypeId || null,
        advisor_id: resolvedAdvisor,
        due_in_date: dueInDate,
        due_in_time: (typeof dueInTime === 'string' && dueInTime.trim()) ? dueInTime.trim() : null,
        mileage: mileage ?? null,
        requested_delivery_at: requestedDeliveryAt || null,
        courtesy_vehicle_required: !!courtesyVehicleRequired,
        collection_and_delivery: !!collectionAndDelivery,
        vehicle_on_site: !!vehicleOnSite,
        customer_contact_notes: customerContactNotes || null,
        booking_notes: bookingNotes || null,
        vhc_required: wantVhc,
        created_by: auth.user.id
      })
      .select()
      .single()

    if (jsError) return c.json({ error: jsError.message }, 500)

    // 2. Attach booking codes (org-validated)
    const codeIds = await validBookingCodeIds(auth.orgId, bookingCodeIds)
    if (codeIds.length) {
      await supabaseAdmin
        .from('jobsheet_booking_codes')
        .insert(codeIds.map((bid) => ({ jobsheet_id: js.id, booking_code_id: bid })))
    }

    // 3. Create the linked VHC — UNLESS the advisor opted out ("Requires VHC" off).
    //    Status awaiting_arrival → trigger sets job_state due_in. due_date is derived
    //    from the jobsheet's due-in date/time so the inspection flows into Upcoming /
    //    the workshop "Due In" column on the right day.
    let hc: { id: string; status: string; job_state: string; vhc_reference: string | null } | null = null
    if (wantVhc) {
      const { hc: hcRow, error: hcError } = await kickOffJobsheetVhc({
        orgId: auth.orgId, siteId: resolvedSite, vehicleId, customerId: vehicle.customer_id,
        templateId: templateIdResolved, advisorId: resolvedAdvisor, mileage: mileage ?? null,
        dueInDate, dueInTime, userId: auth.user.id, jobsheetId: js.id, jobsheetReference: js.reference
      })
      if (hcError) {
        console.error('Jobsheet VHC creation failed:', hcError)
        return c.json(
          { error: `Jobsheet ${js.reference} created, but starting its health check failed: ${hcError}`, jobsheetId: js.id },
          500
        )
      }
      hc = hcRow
    }

    // 4. Pre-load booked work from any selected packages (menu pricing at booking).
    if (Array.isArray(servicePackageIds)) {
      for (const pid of servicePackageIds) {
        if (typeof pid === 'string' && pid) {
          await createBookedLineFromPackage(js.id, auth.orgId, auth.user.id, pid)
        }
      }
    }

    return c.json(
      {
        id: js.id,
        reference: js.reference,
        healthCheckId: hc?.id ?? null,
        vehicleStatus: hc?.job_state ?? js.job_state ?? 'due_in',
        status: hc?.status ?? null,
        createdAt: js.created_at
      },
      201
    )
  } catch (error) {
    console.error('Create jobsheet error:', error)
    return c.json({ error: 'Failed to create jobsheet' }, 500)
  }
})

// POST /draft - create a DRAFT jobsheet so the one-screen New page can attach work
// lines (repair_items need a parent id). A draft has no reference and no VHC; both are
// created on commit. Requires only a vehicle with a linked customer.
jobsheets.post('/draft', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json().catch(() => ({}))
    const { vehicleId, dueInDate, siteId, advisorId } = body

    if (!vehicleId) return c.json({ error: 'Vehicle is required' }, 400)

    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('id, customer_id')
      .eq('id', vehicleId)
      .eq('organization_id', auth.orgId)
      .single()
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404)
    if (!vehicle.customer_id) {
      return c.json({ error: 'A customer must be linked to the vehicle before creating a jobsheet.' }, 400)
    }

    const { data: js, error } = await supabaseAdmin
      .from('jobsheets')
      .insert({
        organization_id: auth.orgId,
        site_id: siteId || auth.user.siteId || null,
        customer_id: vehicle.customer_id,
        vehicle_id: vehicleId,
        advisor_id: advisorId || auth.user.id,
        // Placeholder; the real due-in is set on commit (due_in_date is NOT NULL).
        due_in_date: (typeof dueInDate === 'string' && dueInDate) ? dueInDate : todayDate(),
        is_draft: true,
        created_by: auth.user.id
      })
      .select('id')
      .single()
    if (error) return c.json({ error: error.message }, 500)

    return c.json({ id: js.id }, 201)
  } catch (error) {
    console.error('Create jobsheet draft error:', error)
    return c.json({ error: 'Failed to create jobsheet draft' }, 500)
  }
})

// POST /:id/commit - finalise a draft: set the booking fields, flip is_draft -> false
// (the trigger assigns the JS reference), attach booking codes, and kick off the VHC.
jobsheets.post('/:id/commit', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const {
      dueInDate, dueInTime, serviceTypeId, advisorId, mileage, requestedDeliveryAt,
      courtesyVehicleRequired, collectionAndDelivery, vehicleOnSite, customerContactNotes,
      bookingCodeIds, templateId, siteId, vhcRequired, bookingNotes
    } = body

    if (!dueInDate) return c.json({ error: 'Due-in date is required' }, 400)

    const { data: draft } = await supabaseAdmin
      .from('jobsheets')
      .select('id, vehicle_id, customer_id, site_id, advisor_id, is_draft')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .single()
    if (!draft) return c.json({ error: 'Jobsheet not found' }, 404)
    if (!draft.is_draft) return c.json({ error: 'This jobsheet has already been created', id }, 400)

    const wantVhc = vhcRequired !== false
    const resolvedSite = siteId || draft.site_id || auth.user.siteId || null
    const resolvedAdvisor = advisorId || draft.advisor_id || auth.user.id

    // Resolve the VHC template up front so we fail before committing if none exists.
    let templateIdResolved: string | null = null
    if (wantVhc) {
      templateIdResolved = await resolveTemplateId(auth.orgId, templateId)
      if (!templateIdResolved) {
        return c.json({ error: 'No check template configured for this organisation. Add a template, or untick "Requires VHC".' }, 400)
      }
    }

    // 1. Update booking fields + commit (is_draft -> false triggers reference assignment).
    //    booking_notes is only touched when provided — the Work Details panel may have
    //    already saved it on the draft.
    const updateData: Record<string, unknown> = {
      site_id: resolvedSite,
      service_type_id: serviceTypeId || null,
      advisor_id: resolvedAdvisor,
      due_in_date: dueInDate,
      due_in_time: (typeof dueInTime === 'string' && dueInTime.trim()) ? dueInTime.trim() : null,
      mileage: mileage ?? null,
      requested_delivery_at: requestedDeliveryAt || null,
      courtesy_vehicle_required: !!courtesyVehicleRequired,
      collection_and_delivery: !!collectionAndDelivery,
      vehicle_on_site: !!vehicleOnSite,
      customer_contact_notes: customerContactNotes || null,
      vhc_required: wantVhc,
      is_draft: false
    }
    if (bookingNotes !== undefined) updateData.booking_notes = bookingNotes || null

    const { data: js, error: updError } = await supabaseAdmin
      .from('jobsheets')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()
    if (updError || !js) return c.json({ error: updError?.message || 'Failed to commit jobsheet' }, 500)

    // 2. Attach booking codes (org-validated)
    const codeIds = await validBookingCodeIds(auth.orgId, bookingCodeIds)
    if (codeIds.length) {
      await supabaseAdmin
        .from('jobsheet_booking_codes')
        .insert(codeIds.map((bid) => ({ jobsheet_id: id, booking_code_id: bid })))
    }

    // 3. Kick off the linked VHC (unless opted out).
    let hc: { id: string; status: string; job_state: string; vhc_reference: string | null } | null = null
    if (wantVhc) {
      const { hc: hcRow, error: hcError } = await kickOffJobsheetVhc({
        orgId: auth.orgId, siteId: resolvedSite, vehicleId: draft.vehicle_id, customerId: draft.customer_id,
        templateId: templateIdResolved, advisorId: resolvedAdvisor, mileage: mileage ?? null,
        dueInDate, dueInTime, userId: auth.user.id, jobsheetId: id, jobsheetReference: js.reference
      })
      if (hcError) {
        console.error('Jobsheet VHC creation failed:', hcError)
        return c.json(
          { error: `Jobsheet ${js.reference} created, but starting its health check failed: ${hcError}`, jobsheetId: id },
          500
        )
      }
      hc = hcRow
    }

    return c.json(
      {
        id: js.id,
        reference: js.reference,
        healthCheckId: hc?.id ?? null,
        vehicleStatus: hc?.job_state ?? js.job_state ?? 'due_in',
        status: hc?.status ?? null,
        createdAt: js.created_at
      },
      200
    )
  } catch (error) {
    console.error('Commit jobsheet error:', error)
    return c.json({ error: 'Failed to commit jobsheet' }, 500)
  }
})

// POST /:id/discard - hard-delete a draft (and its work lines, via cascade). Advisor-
// accessible so the person building the booking can cancel it. Only drafts; committed
// jobsheets use DELETE /:id (soft delete, higher role).
jobsheets.post('/:id/discard', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: existing } = await supabaseAdmin
      .from('jobsheets')
      .select('id, is_draft')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()
    if (!existing) return c.json({ error: 'Jobsheet not found' }, 404)
    if (!existing.is_draft) return c.json({ error: 'Only draft jobsheets can be discarded' }, 400)

    // Hard delete — repair_items (work lines) cascade off jobsheet_id, and
    // repair_labour / repair_parts cascade off repair_items. A draft has no VHC.
    const { error } = await supabaseAdmin
      .from('jobsheets')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)

    return c.json({ message: 'Draft discarded' })
  } catch (error) {
    console.error('Discard jobsheet draft error:', error)
    return c.json({ error: 'Failed to discard draft' }, 500)
  }
})

// PATCH /:id - update jobsheet fields + booking codes
jobsheets.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    // Ensure the jobsheet belongs to the org (and load current due-in for re-sync)
    const { data: existing } = await supabaseAdmin
      .from('jobsheets')
      .select('id, due_in_date, due_in_time')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .single()
    if (!existing) return c.json({ error: 'Jobsheet not found' }, 404)

    // Due-in date is mandatory — allow changing it, but not clearing it
    if (body.dueInDate !== undefined && !body.dueInDate) {
      return c.json({ error: 'Due-in date is required' }, 400)
    }

    const updateData: Record<string, unknown> = {}
    if (body.dueInDate !== undefined && body.dueInDate) updateData.due_in_date = body.dueInDate
    if (body.dueInTime !== undefined) updateData.due_in_time = (typeof body.dueInTime === 'string' && body.dueInTime.trim()) ? body.dueInTime.trim() : null
    if (body.serviceTypeId !== undefined) updateData.service_type_id = body.serviceTypeId || null
    if (body.advisorId !== undefined) updateData.advisor_id = body.advisorId || null
    if (body.mileage !== undefined) updateData.mileage = body.mileage ?? null
    if (body.requestedDeliveryAt !== undefined) updateData.requested_delivery_at = body.requestedDeliveryAt || null
    if (body.courtesyVehicleRequired !== undefined) updateData.courtesy_vehicle_required = !!body.courtesyVehicleRequired
    if (body.collectionAndDelivery !== undefined) updateData.collection_and_delivery = !!body.collectionAndDelivery
    if (body.vehicleOnSite !== undefined) updateData.vehicle_on_site = !!body.vehicleOnSite
    if (body.customerContactNotes !== undefined) updateData.customer_contact_notes = body.customerContactNotes || null
    if (body.jobsheetComplete !== undefined) updateData.jobsheet_complete = !!body.jobsheetComplete
    if (body.bookingNotes !== undefined) updateData.booking_notes = body.bookingNotes || null
    if (body.vhcRequired !== undefined) updateData.vhc_required = !!body.vhcRequired
    if (body.jobState !== undefined && typeof body.jobState === 'string' && body.jobState) updateData.job_state = body.jobState

    if (Object.keys(updateData).length) {
      const { error } = await supabaseAdmin
        .from('jobsheets')
        .update(updateData)
        .eq('id', id)
        .eq('organization_id', auth.orgId)
      if (error) return c.json({ error: error.message }, 500)
    }

    // Replace booking codes if provided
    if (body.bookingCodeIds !== undefined) {
      await supabaseAdmin.from('jobsheet_booking_codes').delete().eq('jobsheet_id', id)
      const codeIds = await validBookingCodeIds(auth.orgId, body.bookingCodeIds)
      if (codeIds.length) {
        await supabaseAdmin
          .from('jobsheet_booking_codes')
          .insert(codeIds.map((bid) => ({ jobsheet_id: id, booking_code_id: bid })))
      }
    }

    // Keep the linked (non-deleted) VHC in sync on advisor/mileage/due_date
    const hcUpdate: Record<string, unknown> = {}
    if (body.advisorId !== undefined) hcUpdate.advisor_id = body.advisorId || null
    if (body.mileage !== undefined) hcUpdate.mileage_in = body.mileage ?? null
    // Keep the linked VHC's workshop status in step with the jobsheet's Vehicle Status
    // (the workshop board still reads health_checks.job_state until Phase 3).
    if (body.jobState !== undefined && typeof body.jobState === 'string' && body.jobState) hcUpdate.job_state = body.jobState
    if (body.dueInDate !== undefined || body.dueInTime !== undefined) {
      const effDate = (body.dueInDate !== undefined && body.dueInDate) ? body.dueInDate : existing.due_in_date
      const effTime = body.dueInTime !== undefined ? body.dueInTime : existing.due_in_time
      hcUpdate.due_date = combineDueIn(typeof effDate === 'string' ? effDate : String(effDate), effTime)
    }
    if (Object.keys(hcUpdate).length) {
      await supabaseAdmin
        .from('health_checks')
        .update(hcUpdate)
        .eq('jobsheet_id', id)
        .is('deleted_at', null)
    }

    const { data: fresh } = await supabaseAdmin
      .from('jobsheets')
      .select(SELECT)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    return c.json(fresh ? shapeJobsheet(fresh) : { id })
  } catch (error) {
    console.error('Update jobsheet error:', error)
    return c.json({ error: 'Failed to update jobsheet' }, 500)
  }
})

// DELETE /:id - soft delete jobsheet + its linked VHC(s)
jobsheets.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: existing } = await supabaseAdmin
      .from('jobsheets')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()
    if (!existing) return c.json({ error: 'Jobsheet not found' }, 404)

    const now = new Date().toISOString()
    const { error } = await supabaseAdmin
      .from('jobsheets')
      .update({ deleted_at: now, deleted_by: auth.user.id })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)

    // Soft-delete the linked VHC(s)
    await supabaseAdmin
      .from('health_checks')
      .update({ deleted_at: now, deleted_by: auth.user.id, deletion_reason: 'other', deletion_notes: 'Jobsheet deleted' })
      .eq('jobsheet_id', id)
      .is('deleted_at', null)

    return c.json({ message: 'Jobsheet deleted' })
  } catch (error) {
    console.error('Delete jobsheet error:', error)
    return c.json({ error: 'Failed to delete jobsheet' }, 500)
  }
})

// ============================================================================
// Work Details — booked work lines on the jobsheet (+ the linked VHC's findings)
//
// A jobsheet work line IS a repair_item. Booked lines hang off jobsheet_id and are
// pre-authorised; inspection findings hang off the linked health_check_id. We reuse
// the existing repair_labour / repair_parts pricing engine and the apply-package
// service unchanged (their labour/parts/outcome endpoints already guard health_check_id),
// so editing a line's labour/parts goes through the existing /repair-items/:id/* routes.
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
    origin: item.jobsheet_id ? 'booking' : 'inspection',
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

// Resolve a jobsheet (org-scoped) and the id of its linked, non-deleted VHC (if any).
async function loadJobsheetWithHc(jobsheetId: string, orgId: string): Promise<{ healthCheckId: string | null } | null> {
  const { data: js } = await supabaseAdmin
    .from('jobsheets')
    .select('id')
    .eq('id', jobsheetId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!js) return null
  const { data: hc } = await supabaseAdmin
    .from('health_checks')
    .select('id')
    .eq('jobsheet_id', jobsheetId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return { healthCheckId: hc?.id ?? null }
}

// Create a pre-authorised booked work line from a service package and apply it.
// Returns the new repair_item id, or null if the package isn't found for the org.
async function createBookedLineFromPackage(
  jobsheetId: string,
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

  const now = new Date().toISOString()
  const { data: item, error } = await supabaseAdmin
    .from('repair_items')
    .insert({
      jobsheet_id: jobsheetId,
      organization_id: orgId,
      name: pkg.name,
      source: 'booking',
      // Booked work is pre-authorised (the customer agreed it at booking).
      outcome_status: 'authorised',
      outcome_source: 'manual',
      outcome_set_by: userId,
      outcome_set_at: now,
      created_by: userId
    })
    .select('id')
    .single()
  if (error || !item) return null

  await applyServicePackageToRepairItem(item.id, servicePackageId, orgId, userId)
  return item.id
}

// GET /:id/work-lines — booked lines (jobsheet) ∪ the linked VHC's findings
jobsheets.get('/:id/work-lines', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const ctx = await loadJobsheetWithHc(id, auth.orgId)
    if (!ctx) return c.json({ error: 'Jobsheet not found' }, 404)

    let query = supabaseAdmin
      .from('repair_items')
      .select(WORK_LINE_SELECT)
      .eq('organization_id', auth.orgId)
      .is('parent_repair_item_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    query = ctx.healthCheckId
      ? query.or(`jobsheet_id.eq.${id},health_check_id.eq.${ctx.healthCheckId}`)
      : query.eq('jobsheet_id', id)

    const { data, error } = await query
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

    return c.json({ workLines, totals, healthCheckId: ctx.healthCheckId })
  } catch (error) {
    console.error('List work lines error:', error)
    return c.json({ error: 'Failed to list work lines' }, 500)
  }
})

// POST /:id/work-lines — add an empty booked (pre-authorised) work line
jobsheets.post('/:id/work-lines', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return c.json({ error: 'Name is required' }, 400)

    const ctx = await loadJobsheetWithHc(id, auth.orgId)
    if (!ctx) return c.json({ error: 'Jobsheet not found' }, 404)

    const now = new Date().toISOString()
    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .insert({
        jobsheet_id: id,
        organization_id: auth.orgId,
        name,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        source: 'booking',
        outcome_status: 'authorised',
        outcome_source: 'manual',
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        created_by: auth.user.id
      })
      .select(WORK_LINE_SELECT)
      .single()
    if (error) return c.json({ error: error.message }, 500)

    return c.json(shapeWorkLine(item), 201)
  } catch (error) {
    console.error('Create work line error:', error)
    return c.json({ error: 'Failed to create work line' }, 500)
  }
})

// POST /:id/work-lines/from-package — add a booked line pre-filled from a package
jobsheets.post('/:id/work-lines/from-package', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const servicePackageId = body.servicePackageId || body.service_package_id
    if (!servicePackageId) return c.json({ error: 'servicePackageId is required' }, 400)

    const ctx = await loadJobsheetWithHc(id, auth.orgId)
    if (!ctx) return c.json({ error: 'Jobsheet not found' }, 404)

    const itemId = await createBookedLineFromPackage(id, auth.orgId, auth.user.id, servicePackageId)
    if (!itemId) return c.json({ error: 'Service package not found' }, 404)

    const { data: item } = await supabaseAdmin
      .from('repair_items')
      .select(WORK_LINE_SELECT)
      .eq('id', itemId)
      .single()

    return c.json(item ? shapeWorkLine(item) : { id: itemId }, 201)
  } catch (error) {
    console.error('Create work line from package error:', error)
    return c.json({ error: 'Failed to add package' }, 500)
  }
})

export default jobsheets
