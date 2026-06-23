import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'

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
    mileage: row.mileage,
    requestedDeliveryAt: row.requested_delivery_at,
    courtesyVehicleRequired: row.courtesy_vehicle_required,
    collectionAndDelivery: row.collection_and_delivery,
    vehicleOnSite: row.vehicle_on_site,
    customerContactNotes: row.customer_contact_notes,
    jobsheetComplete: row.jobsheet_complete,
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

// POST / - create jobsheet + kick off the VHC
jobsheets.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const {
      vehicleId,
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
      siteId
    } = body

    if (!vehicleId) return c.json({ error: 'Vehicle is required' }, 400)

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

    const templateIdResolved = await resolveTemplateId(auth.orgId, templateId)
    if (!templateIdResolved) {
      return c.json({ error: 'No check template configured for this organisation.' }, 400)
    }

    const resolvedSite = siteId || auth.user.siteId || null
    const resolvedAdvisor = advisorId || auth.user.id

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
        mileage: mileage ?? null,
        requested_delivery_at: requestedDeliveryAt || null,
        courtesy_vehicle_required: !!courtesyVehicleRequired,
        collection_and_delivery: !!collectionAndDelivery,
        vehicle_on_site: !!vehicleOnSite,
        customer_contact_notes: customerContactNotes || null,
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

    // 3. Create the linked VHC — status awaiting_arrival → trigger sets job_state due_in
    const { data: hc, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .insert({
        organization_id: auth.orgId,
        site_id: resolvedSite,
        vehicle_id: vehicleId,
        customer_id: vehicle.customer_id,
        template_id: templateIdResolved,
        advisor_id: resolvedAdvisor,
        mileage_in: mileage ?? null,
        status: 'awaiting_arrival',
        jobsheet_id: js.id
      })
      .select('id, status, job_state, vhc_reference')
      .single()

    if (hcError) {
      console.error('Jobsheet VHC creation failed:', hcError)
      return c.json(
        { error: `Jobsheet ${js.reference} created, but starting its health check failed: ${hcError.message}`, jobsheetId: js.id },
        500
      )
    }

    // Initial status history for the VHC
    await supabaseAdmin.from('health_check_status_history').insert({
      health_check_id: hc.id,
      from_status: null,
      to_status: hc.status,
      changed_by: auth.user.id,
      change_source: 'user',
      notes: `Created from jobsheet ${js.reference}`
    })

    return c.json(
      {
        id: js.id,
        reference: js.reference,
        healthCheckId: hc.id,
        vehicleStatus: hc.job_state,
        status: hc.status,
        createdAt: js.created_at
      },
      201
    )
  } catch (error) {
    console.error('Create jobsheet error:', error)
    return c.json({ error: 'Failed to create jobsheet' }, 500)
  }
})

// PATCH /:id - update jobsheet fields + booking codes
jobsheets.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    // Ensure the jobsheet belongs to the org
    const { data: existing } = await supabaseAdmin
      .from('jobsheets')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .single()
    if (!existing) return c.json({ error: 'Jobsheet not found' }, 404)

    const updateData: Record<string, unknown> = {}
    if (body.serviceTypeId !== undefined) updateData.service_type_id = body.serviceTypeId || null
    if (body.advisorId !== undefined) updateData.advisor_id = body.advisorId || null
    if (body.mileage !== undefined) updateData.mileage = body.mileage ?? null
    if (body.requestedDeliveryAt !== undefined) updateData.requested_delivery_at = body.requestedDeliveryAt || null
    if (body.courtesyVehicleRequired !== undefined) updateData.courtesy_vehicle_required = !!body.courtesyVehicleRequired
    if (body.collectionAndDelivery !== undefined) updateData.collection_and_delivery = !!body.collectionAndDelivery
    if (body.vehicleOnSite !== undefined) updateData.vehicle_on_site = !!body.vehicleOnSite
    if (body.customerContactNotes !== undefined) updateData.customer_contact_notes = body.customerContactNotes || null
    if (body.jobsheetComplete !== undefined) updateData.jobsheet_complete = !!body.jobsheetComplete

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

    // Keep the linked (non-deleted) VHC in sync on advisor/mileage
    const hcUpdate: Record<string, unknown> = {}
    if (body.advisorId !== undefined) hcUpdate.advisor_id = body.advisorId || null
    if (body.mileage !== undefined) hcUpdate.mileage_in = body.mileage ?? null
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

export default jobsheets
