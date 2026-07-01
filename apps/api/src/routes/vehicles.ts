import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { getEffectiveModulesCached } from '../services/modules.js'
import { lookupVehicleByRegistration, persistMotHistory } from '../services/mot-history.js'
import { lookupVehicleDetailsByRegistration, persistVehicleDetails, logVehicleDetailsUsage } from '../services/vehicle-details.js'
import { stampVehicleActivity } from '../services/vehicle-expiry.js'

const vehicles = new Hono()

vehicles.use('*', authMiddleware)

/**
 * Transfer the primary owner of a vehicle, preserving history. Closes the
 * current primary owner link, opens (or reactivates) an owner link for the new
 * customer as primary, and writes a vehicle_ownership_history audit row. The DB
 * trigger then syncs vehicles.customer_id from the new primary link. No-ops when
 * the owner is unchanged. Work history (HCs/jobsheets/MOT/expiries) stays with
 * the vehicle — those FK vehicle_id and never move.
 */
async function transferVehicleOwner(
  orgId: string,
  vehicleId: string,
  toCustomerId: string,
  changedBy: string,
  reason: string,
  notes: string | null
): Promise<{ changed: boolean; fromCustomerId: string | null }> {
  const today = new Date().toISOString().slice(0, 10)

  const { data: currentLink } = await supabaseAdmin
    .from('vehicle_customer_links')
    .select('id, customer_id')
    .eq('vehicle_id', vehicleId)
    .eq('organization_id', orgId)
    .eq('is_primary', true)
    .is('end_date', null)
    .maybeSingle()

  const fromCustomerId = (currentLink?.customer_id as string | undefined) ?? null
  if (fromCustomerId === toCustomerId) {
    return { changed: false, fromCustomerId }
  }

  // Close the outgoing primary link first (frees the partial unique indexes).
  if (currentLink) {
    await supabaseAdmin
      .from('vehicle_customer_links')
      .update({ is_primary: false, is_reminder_recipient: false, end_date: today })
      .eq('id', currentLink.id)
  }

  // Single reminder recipient per vehicle: clear every current reminder flag so
  // making the new owner the recipient can never collide with the partial unique
  // index. (Retail default — for a lease, staff re-point reminders to the driver.)
  await supabaseAdmin
    .from('vehicle_customer_links')
    .update({ is_reminder_recipient: false })
    .eq('vehicle_id', vehicleId)
    .eq('organization_id', orgId)
    .is('end_date', null)
    .eq('is_reminder_recipient', true)

  // Open or reactivate the owner link for the new customer (the unique
  // (vehicle, customer, role) index means a returning owner must be reactivated).
  const { data: existingOwner } = await supabaseAdmin
    .from('vehicle_customer_links')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('organization_id', orgId)
    .eq('customer_id', toCustomerId)
    .eq('role', 'owner')
    .maybeSingle()

  if (existingOwner) {
    await supabaseAdmin
      .from('vehicle_customer_links')
      .update({ is_primary: true, is_reminder_recipient: true, end_date: null, start_date: today })
      .eq('id', existingOwner.id)
  } else {
    await supabaseAdmin.from('vehicle_customer_links').insert({
      organization_id: orgId,
      vehicle_id: vehicleId,
      customer_id: toCustomerId,
      role: 'owner',
      is_primary: true,
      is_reminder_recipient: true,
      start_date: today,
      created_by: changedBy
    })
  }

  await supabaseAdmin.from('vehicle_ownership_history').insert({
    organization_id: orgId,
    vehicle_id: vehicleId,
    from_customer_id: fromCustomerId,
    to_customer_id: toCustomerId,
    changed_by: changedBy,
    reason,
    notes
  })

  return { changed: true, fromCustomerId }
}

// GET /api/v1/vehicles - List vehicles with filters
vehicles.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { customer_id, search, make, lifecycle_status, mot_due, limit = '50', offset = '0' } = c.req.query()

    // The org-wide vehicle list (no customer_id) is the standalone Vehicles module
    // surface — gate it behind the module. The customer-scoped call (the Customers
    // tab) stays ungated so vehicles still render on customer detail for tenants
    // without the module.
    if (!customer_id) {
      const mods = await getEffectiveModulesCached(c, auth.orgId)
      if (!mods.vehicles) {
        return c.json({ error: 'Vehicles module is not enabled' }, 403)
      }
    }

    const lim = Math.min(parseInt(limit) || 50, 200)
    const off = parseInt(offset) || 0

    let query = supabaseAdmin
      .from('vehicles')
      .select('*, customer:customers(id, first_name, last_name, email, mobile, company_name)', { count: 'exact' })
      .eq('organization_id', auth.orgId)

    if (customer_id) query = query.eq('customer_id', customer_id)
    if (make) query = query.ilike('make', make)
    if (lifecycle_status) query = query.eq('lifecycle_status', lifecycle_status)

    if (search) {
      query = query.or(`registration.ilike.%${search}%,vin.ilike.%${search}%,make.ilike.%${search}%,model.ilike.%${search}%`)
    }

    // MOT-due window filter (computed against mot_expiry_date).
    const today = new Date().toISOString().slice(0, 10)
    if (mot_due === 'expired') {
      query = query.lt('mot_expiry_date', today)
    } else if (mot_due === '30' || mot_due === '60' || mot_due === '90') {
      const end = new Date()
      end.setDate(end.getDate() + parseInt(mot_due))
      query = query.gte('mot_expiry_date', today).lte('mot_expiry_date', end.toISOString().slice(0, 10))
    }

    // Order by soonest MOT when MOT-filtering, else newest first. Always paginate
    // in-DB (.range) to avoid the PostgREST 1000-row truncation cap.
    query = mot_due
      ? query.order('mot_expiry_date', { ascending: true, nullsFirst: false })
      : query.order('created_at', { ascending: false })
    query = query.range(off, off + lim - 1)

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      vehicles: (data || []).map(vehicle => ({
        id: vehicle.id,
        customer_id: vehicle.customer_id,
        customer: vehicle.customer ? {
          id: vehicle.customer.id,
          first_name: vehicle.customer.first_name,
          last_name: vehicle.customer.last_name,
          email: vehicle.customer.email,
          mobile: vehicle.customer.mobile,
          company_name: vehicle.customer.company_name
        } : null,
        registration: vehicle.registration,
        vin: vehicle.vin,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        fuel_type: vehicle.fuel_type,
        engine_size: vehicle.engine_size,
        derivative: vehicle.derivative,
        body_type: vehicle.body_type,
        mot_status: vehicle.mot_status,
        mot_expiry_date: vehicle.mot_expiry_date,
        lifecycle_status: vehicle.lifecycle_status,
        number_of_previous_keepers: vehicle.number_of_previous_keepers,
        last_activity_at: vehicle.last_activity_at,
        created_at: vehicle.created_at
      })),
      total: count,
      limit: lim,
      offset: off
    })
  } catch (error) {
    console.error('List vehicles error:', error)
    return c.json({ error: 'Failed to list vehicles' }, 500)
  }
})

// GET /api/v1/vehicles/lookup/:registration - Find by registration
vehicles.get('/lookup/:registration', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { registration } = c.req.param()

    const { data: vehicle, error } = await supabaseAdmin
      .from('vehicles')
      .select('*, customer:customers(id, first_name, last_name, email, mobile)')
      .eq('organization_id', auth.orgId)
      .ilike('registration', registration)
      .single()

    if (error || !vehicle) {
      return c.json({ error: 'Vehicle not found' }, 404)
    }

    return c.json({
      id: vehicle.id,
      customer_id: vehicle.customer_id,
      customer: vehicle.customer ? {
        id: vehicle.customer.id,
        first_name: vehicle.customer.first_name,
        last_name: vehicle.customer.last_name,
        email: vehicle.customer.email,
        mobile: vehicle.customer.mobile
      } : null,
      registration: vehicle.registration,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      fuel_type: vehicle.fuel_type,
      engine_size: vehicle.engine_size,
      created_at: vehicle.created_at
    })
  } catch (error) {
    console.error('Lookup vehicle error:', error)
    return c.json({ error: 'Failed to lookup vehicle' }, 500)
  }
})

// GET /api/v1/vehicles/:id/mot-history - Stored DVSA MOT history for a vehicle
vehicles.get('/:id/mot-history', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from('vehicles')
      .select('id, mot_status, mot_expiry_date, mot_last_synced_at, first_used_date')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (vehicleError || !vehicle) {
      return c.json({ error: 'Vehicle not found' }, 404)
    }

    const { data: tests } = await supabaseAdmin
      .from('vehicle_mot_tests')
      .select('*')
      .eq('vehicle_id', id)
      .eq('organization_id', auth.orgId)
      .order('completed_date', { ascending: false })

    return c.json({
      motStatus: vehicle.mot_status,
      motExpiryDate: vehicle.mot_expiry_date,
      lastSyncedAt: vehicle.mot_last_synced_at,
      firstUsedDate: vehicle.first_used_date,
      tests: (tests || []).map((t) => ({
        id: t.id,
        motTestNumber: t.mot_test_number,
        completedDate: t.completed_date,
        testResult: t.test_result,
        expiryDate: t.expiry_date,
        odometerValue: t.odometer_value,
        odometerUnit: t.odometer_unit,
        odometerResult: t.odometer_result,
        defects: t.defects || []
      }))
    })
  } catch (error) {
    console.error('Get MOT history error:', error)
    return c.json({ error: 'Failed to get MOT history' }, 500)
  }
})

// POST /api/v1/vehicles/:id/mot-sync - On-demand DVSA lookup + persist for an
// existing vehicle (e.g. a DMS-imported booking never looked up at create time).
// Technicians can trigger this from the mobile inspection screen, since DMS
// vehicles are often not pre-synced at booking time.
vehicles.post('/:id/mot-sync', requireModule('vehicle_lookup'), authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from('vehicles')
      .select('id, registration')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (vehicleError || !vehicle) {
      return c.json({ error: 'Vehicle not found' }, 404)
    }

    const result = await lookupVehicleByRegistration(vehicle.registration)
    if (!result.success) {
      const status =
        result.errorCode === 'RATE_LIMITED' ? 429 :
        result.errorCode === 'AUTH_FAILED' || result.errorCode === 'API_ERROR' || result.errorCode === 'EXCEPTION' ? 502 :
        503 // NOT_CONFIGURED / DISABLED
      return c.json({ error: result.error || 'MOT lookup failed', code: result.errorCode }, status)
    }

    await persistMotHistory(auth.orgId, vehicle.id, result)

    return c.json({
      success: true,
      found: result.found,
      motStatus: result.motStatus,
      testCount: result.motTests.length
    })
  } catch (error) {
    console.error('MOT sync error:', error)
    return c.json({ error: 'Failed to sync MOT history' }, 500)
  }
})

// POST /api/v1/vehicles/:id/vehicle-details-refresh - On-demand paid DVLA spec
// enrichment + persist for an existing vehicle. Also runs "customer sold the
// vehicle" detection (keeper change vs the baseline captured at first enrich).
vehicles.post('/:id/vehicle-details-refresh', requireModule('vehicle_details'), authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from('vehicles')
      .select('id, registration')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (vehicleError || !vehicle) {
      return c.json({ error: 'Vehicle not found' }, 404)
    }

    const result = await lookupVehicleDetailsByRegistration(vehicle.registration)
    if (result.success) await logVehicleDetailsUsage(auth.orgId, auth.user.id, vehicle.registration, 'refresh', result)
    if (!result.success) {
      const status =
        result.errorCode === 'RATE_LIMITED' ? 429 :
        result.errorCode === 'AUTH_FAILED' || result.errorCode === 'API_ERROR' || result.errorCode === 'EXCEPTION' ? 502 :
        503 // NOT_CONFIGURED / DISABLED / INVALID
      return c.json({ error: result.error || 'Vehicle details lookup failed', code: result.errorCode }, status)
    }

    if (!result.found) {
      return c.json({ success: true, found: false, message: 'No vehicle details held for that registration' })
    }

    const { lifecycleStatus } = await persistVehicleDetails(auth.orgId, vehicle.id, result, { overwriteIdentity: true })

    return c.json({
      success: true,
      found: true,
      lifecycleStatus,
      derivative: result.derivative,
      keeperStartDate: result.keeperStartDate,
      numberOfPreviousKeepers: result.numberOfPreviousKeepers
    })
  } catch (error) {
    console.error('Vehicle details refresh error:', error)
    return c.json({ error: 'Failed to refresh vehicle details' }, 500)
  }
})

// POST /api/v1/vehicles - Create vehicle
vehicles.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const {
      customerId, registration, vin, make, model, year,
      color, fuelType, engineSize, syncMotHistory, enrichVehicleDetails,
      vehicleDetails: passedDetails
    } = body

    if (!registration) {
      return c.json({ error: 'Registration is required' }, 400)
    }

    // Customer is optional — a registration may be looked up for a walk-in
    // before a customer record exists. Validate only when provided.
    // A vehicle follows its owner's site (§4.5, decision B); fall back to the
    // actor's site for ownerless walk-in lookups.
    let vehicleSiteId: string | null = auth.user.siteId
    if (customerId) {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('id, site_id')
        .eq('id', customerId)
        .eq('organization_id', auth.orgId)
        .single()

      if (!customer) {
        return c.json({ error: 'Customer not found' }, 404)
      }
      vehicleSiteId = customer.site_id ?? auth.user.siteId
    }

    const { data: vehicle, error } = await supabaseAdmin
      .from('vehicles')
      .insert({
        organization_id: auth.orgId,
        site_id: vehicleSiteId,
        customer_id: customerId || null,
        registration: registration.toUpperCase().replace(/\s/g, ''),
        vin: vin?.toUpperCase(),
        make,
        model,
        year,
        color,
        fuel_type: fuelType,
        engine_size: engineSize
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'Vehicle with this registration already exists' }, 409)
      }
      return c.json({ error: error.message }, 500)
    }

    // Seed the owner link (the authoritative owner/driver model). The DB trigger
    // keeps vehicles.customer_id in sync; this makes the owner appear in links[]
    // and lets the transfer/refresh flows work consistently for new vehicles.
    if (vehicle && customerId) {
      try {
        await supabaseAdmin.from('vehicle_customer_links').insert({
          organization_id: auth.orgId,
          vehicle_id: vehicle.id,
          customer_id: customerId,
          role: 'owner',
          is_primary: true,
          is_reminder_recipient: true,
          start_date: new Date().toISOString().slice(0, 10),
          created_by: auth.user.id
        })
      } catch (linkErr) {
        console.error('Owner link creation on vehicle create failed:', linkErr)
      }
    }

    // Best-effort DVSA MOT history sync for the new vehicle. Non-fatal — the
    // vehicle is created regardless; the lookup service no-ops when the
    // vehicle_lookup credentials aren't configured/enabled.
    if (syncMotHistory && vehicle) {
      try {
        const motResult = await lookupVehicleByRegistration(vehicle.registration)
        if (motResult.success) {
          await persistMotHistory(auth.orgId, vehicle.id, motResult)
        }
      } catch (motErr) {
        console.error('MOT sync on vehicle create failed:', motErr)
      }
    }

    // Best-effort paid DVLA spec enrichment. Gated by the per-org vehicle_details
    // module so an org without the (paid) module never incurs a lookup; the
    // service also no-ops when no key is configured. Identity fields (make/model/
    // colour/fuel) are overwritten — DVLA is the authoritative source.
    if ((enrichVehicleDetails || passedDetails) && vehicle) {
      try {
        const mods = await getEffectiveModulesCached(c, auth.orgId)
        if (mods.vehicle_details) {
          // Reuse the result the lookup already paid for, if the client passed it
          // back; only fetch fresh when it wasn't supplied.
          let detailsResult = passedDetails && passedDetails.found ? passedDetails : null
          if (!detailsResult) {
            const fetched = await lookupVehicleDetailsByRegistration(vehicle.registration)
            // Only this fetch path bills — the passedDetails reuse path must not log.
            if (fetched.success) await logVehicleDetailsUsage(auth.orgId, auth.user.id, vehicle.registration, 'create', fetched)
            if (fetched.success && fetched.found) detailsResult = fetched
          }
          if (detailsResult) {
            await persistVehicleDetails(auth.orgId, vehicle.id, detailsResult, { overwriteIdentity: true })
          }
        }
      } catch (detailsErr) {
        console.error('Vehicle details enrichment on create failed:', detailsErr)
      }
    }

    return c.json({
      id: vehicle.id,
      customer_id: vehicle.customer_id,
      registration: vehicle.registration,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      fuel_type: vehicle.fuel_type,
      engine_size: vehicle.engine_size,
      created_at: vehicle.created_at
    }, 201)
  } catch (error) {
    console.error('Create vehicle error:', error)
    return c.json({ error: 'Failed to create vehicle' }, 500)
  }
})

// GET /api/v1/vehicles/:id - Get vehicle with customer
vehicles.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: vehicle, error } = await supabaseAdmin
      .from('vehicles')
      .select('*, customer:customers(*)')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !vehicle) {
      return c.json({ error: 'Vehicle not found' }, 404)
    }

    // Owner/driver links (current only), notes (pinned first), typed expiries.
    const [{ data: links }, { data: notes }, { data: expiries }] = await Promise.all([
      supabaseAdmin
        .from('vehicle_customer_links')
        .select('id, customer_id, role, is_primary, is_reminder_recipient, start_date, end_date, notes, customer:customers(id, first_name, last_name, email, mobile, company_name)')
        .eq('vehicle_id', id)
        .eq('organization_id', auth.orgId)
        .is('end_date', null)
        .order('is_primary', { ascending: false }),
      supabaseAdmin
        .from('vehicle_notes')
        .select('id, body, category, is_pinned, author_id, created_at, updated_at, author:users(id, first_name, last_name)')
        .eq('vehicle_id', id)
        .eq('organization_id', auth.orgId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('vehicle_expiry_dates')
        .select('id, type_code, due_date, due_mileage, source, is_active, snoozed_until, last_notified_at, notes, expiry_type:expiry_types(id, code, label, is_mileage_based)')
        .eq('vehicle_id', id)
        .eq('organization_id', auth.orgId)
        .order('due_date', { ascending: true, nullsFirst: false })
    ])

    return c.json({
      id: vehicle.id,
      customer_id: vehicle.customer_id,
      customer: vehicle.customer ? {
        id: vehicle.customer.id,
        first_name: vehicle.customer.first_name,
        last_name: vehicle.customer.last_name,
        email: vehicle.customer.email,
        mobile: vehicle.customer.mobile,
        company_name: vehicle.customer.company_name,
        address: vehicle.customer.address
      } : null,
      registration: vehicle.registration,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      fuel_type: vehicle.fuel_type,
      engine_size: vehicle.engine_size,
      mileage: vehicle.mileage,
      // DVSA MOT (summary; full per-test history via GET /:id/mot-history)
      mot_status: vehicle.mot_status,
      mot_expiry_date: vehicle.mot_expiry_date,
      mot_last_synced_at: vehicle.mot_last_synced_at,
      first_used_date: vehicle.first_used_date,
      // DVLA spec/provenance enrichment (Vehicle Data Global)
      derivative: vehicle.derivative,
      body_type: vehicle.body_type,
      transmission: vehicle.transmission,
      drive_type: vehicle.drive_type,
      power_bhp: vehicle.power_bhp,
      co2_gkm: vehicle.co2_gkm,
      euro_status: vehicle.euro_status,
      powertrain_type: vehicle.powertrain_type,
      taxation_class: vehicle.taxation_class,
      vehicle_class: vehicle.vehicle_class,
      date_first_registered: vehicle.date_first_registered,
      lifecycle_status: vehicle.lifecycle_status,
      lifecycle_changed_at: vehicle.lifecycle_changed_at,
      keeper_start_date: vehicle.keeper_start_date,
      number_of_previous_keepers: vehicle.number_of_previous_keepers,
      previous_keeper_disposal_date: vehicle.previous_keeper_disposal_date,
      latest_v5c_issue_date: vehicle.latest_v5c_issue_date,
      vehicle_data_synced_at: vehicle.vehicle_data_synced_at,
      vehicle_spec: vehicle.vehicle_spec,
      last_activity_at: vehicle.last_activity_at,
      // Relations (Vehicles module)
      links: links || [],
      notes: notes || [],
      expiries: expiries || [],
      created_at: vehicle.created_at,
      updated_at: vehicle.updated_at
    })
  } catch (error) {
    console.error('Get vehicle error:', error)
    return c.json({ error: 'Failed to get vehicle' }, 500)
  }
})

// PATCH /api/v1/vehicles/:id - Update vehicle
vehicles.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const {
      registration, vin, make, model, year,
      color, fuelType, engineSize, customerId
    } = body

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (registration !== undefined) updateData.registration = registration.toUpperCase().replace(/\s/g, '')
    if (vin !== undefined) updateData.vin = vin?.toUpperCase()
    if (make !== undefined) updateData.make = make
    if (model !== undefined) updateData.model = model
    if (year !== undefined) updateData.year = year
    if (color !== undefined) updateData.color = color
    if (fuelType !== undefined) updateData.fuel_type = fuelType
    if (engineSize !== undefined) updateData.engine_size = engineSize

    // Re-linking a customer goes through the audited transfer path (writes
    // ownership history + updates the owner link, trigger syncs customer_id) —
    // never a silent overwrite. Acts only when the owner actually changes.
    if (customerId) {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('id', customerId)
        .eq('organization_id', auth.orgId)
        .single()

      if (!customer) {
        return c.json({ error: 'Customer not found' }, 404)
      }

      const { data: current } = await supabaseAdmin
        .from('vehicles')
        .select('customer_id')
        .eq('id', id)
        .eq('organization_id', auth.orgId)
        .single()

      if (current && current.customer_id !== customerId) {
        await transferVehicleOwner(auth.orgId, id, customerId, auth.user.id, 'data_correction', null)
      }
    }

    const { data: vehicle, error } = await supabaseAdmin
      .from('vehicles')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'Vehicle with this registration already exists' }, 409)
      }
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: vehicle.id,
      customer_id: vehicle.customer_id,
      registration: vehicle.registration,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      fuel_type: vehicle.fuel_type,
      engine_size: vehicle.engine_size,
      updated_at: vehicle.updated_at
    })
  } catch (error) {
    console.error('Update vehicle error:', error)
    return c.json({ error: 'Failed to update vehicle' }, 500)
  }
})

// ============================================================================
// VEHICLES MODULE SUB-RESOURCES (gated by the `vehicles` module)
// Owner/driver links, notes, ownership history + transfer, typed expiries,
// and the unified refresh-by-VRM action.
// ============================================================================

const ROLES_WRITE = ['super_admin', 'org_admin', 'site_admin', 'service_advisor'] as const
const ROLES_READ = ['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician'] as const

/** Confirm a vehicle exists in the caller's org; returns true/false. */
async function vehicleInOrg(vehicleId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('vehicles').select('id').eq('id', vehicleId).eq('organization_id', orgId).maybeSingle()
  return !!data
}

// ---- Owner / Driver links ----

// GET /:id/links — current (non-ended) owner/driver/keeper/fleet links
vehicles.get('/:id/links', requireModule('vehicles'), authorize([...ROLES_READ]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data, error } = await supabaseAdmin
      .from('vehicle_customer_links')
      .select('id, customer_id, role, is_primary, is_reminder_recipient, start_date, end_date, notes, customer:customers(id, first_name, last_name, email, mobile, company_name)')
      .eq('vehicle_id', id)
      .eq('organization_id', auth.orgId)
      .is('end_date', null)
      .order('is_primary', { ascending: false })
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ links: data || [] })
  } catch (error) {
    console.error('List vehicle links error:', error)
    return c.json({ error: 'Failed to list vehicle links' }, 500)
  }
})

// POST /:id/links — add a non-primary link (driver/keeper/fleet_account)
vehicles.post('/:id/links', requireModule('vehicles'), authorize([...ROLES_WRITE]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { customerId, role = 'driver', isReminderRecipient = false, notes } = await c.req.json()

    if (!customerId) return c.json({ error: 'customerId is required' }, 400)
    if (!['driver', 'keeper', 'fleet_account'].includes(role)) {
      return c.json({ error: 'Use the transfer-owner action to set the primary owner' }, 400)
    }
    if (!(await vehicleInOrg(id, auth.orgId))) return c.json({ error: 'Vehicle not found' }, 404)

    const { data: customer } = await supabaseAdmin
      .from('customers').select('id').eq('id', customerId).eq('organization_id', auth.orgId).maybeSingle()
    if (!customer) return c.json({ error: 'Customer not found' }, 404)

    // Only one current reminder recipient per vehicle — clear others first.
    if (isReminderRecipient) {
      await supabaseAdmin
        .from('vehicle_customer_links')
        .update({ is_reminder_recipient: false })
        .eq('vehicle_id', id).eq('organization_id', auth.orgId)
        .eq('is_reminder_recipient', true).is('end_date', null)
    }

    const { data, error } = await supabaseAdmin
      .from('vehicle_customer_links')
      .insert({
        organization_id: auth.orgId,
        vehicle_id: id,
        customer_id: customerId,
        role,
        is_primary: false,
        is_reminder_recipient: !!isReminderRecipient,
        start_date: new Date().toISOString().slice(0, 10),
        notes: notes || null,
        created_by: auth.user.id
      })
      .select('id, customer_id, role, is_primary, is_reminder_recipient')
      .single()

    if (error) {
      if (error.code === '23505') return c.json({ error: 'That customer already holds this role on the vehicle' }, 409)
      return c.json({ error: error.message }, 500)
    }
    return c.json(data, 201)
  } catch (error) {
    console.error('Add vehicle link error:', error)
    return c.json({ error: 'Failed to add link' }, 500)
  }
})

// PATCH /:id/links/:linkId — edit role / reminder flag / notes (not is_primary)
vehicles.patch('/:id/links/:linkId', requireModule('vehicles'), authorize([...ROLES_WRITE]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, linkId } = c.req.param()
    const { role, isReminderRecipient, notes } = await c.req.json()

    if (role !== undefined && !['driver', 'keeper', 'fleet_account', 'owner'].includes(role)) {
      return c.json({ error: 'Invalid role' }, 400)
    }

    if (isReminderRecipient === true) {
      await supabaseAdmin
        .from('vehicle_customer_links')
        .update({ is_reminder_recipient: false })
        .eq('vehicle_id', id).eq('organization_id', auth.orgId)
        .eq('is_reminder_recipient', true).is('end_date', null)
        .neq('id', linkId)
    }

    const update: Record<string, unknown> = {}
    if (role !== undefined) update.role = role
    if (isReminderRecipient !== undefined) update.is_reminder_recipient = !!isReminderRecipient
    if (notes !== undefined) update.notes = notes

    const { data, error } = await supabaseAdmin
      .from('vehicle_customer_links')
      .update(update)
      .eq('id', linkId).eq('vehicle_id', id).eq('organization_id', auth.orgId)
      .select('id, customer_id, role, is_primary, is_reminder_recipient, notes')
      .single()

    if (error) {
      if (error.code === '23505') return c.json({ error: 'That customer already holds this role on the vehicle' }, 409)
      return c.json({ error: error.message }, 500)
    }
    return c.json(data)
  } catch (error) {
    console.error('Update vehicle link error:', error)
    return c.json({ error: 'Failed to update link' }, 500)
  }
})

// DELETE /:id/links/:linkId — remove a non-primary link
vehicles.delete('/:id/links/:linkId', requireModule('vehicles'), authorize([...ROLES_WRITE]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, linkId } = c.req.param()
    const { data: link } = await supabaseAdmin
      .from('vehicle_customer_links').select('id, is_primary')
      .eq('id', linkId).eq('vehicle_id', id).eq('organization_id', auth.orgId).maybeSingle()
    if (!link) return c.json({ error: 'Link not found' }, 404)
    if (link.is_primary) {
      return c.json({ error: 'Cannot remove the primary owner — use the transfer-owner action' }, 400)
    }
    const { error } = await supabaseAdmin
      .from('vehicle_customer_links').delete().eq('id', linkId).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ success: true })
  } catch (error) {
    console.error('Delete vehicle link error:', error)
    return c.json({ error: 'Failed to delete link' }, 500)
  }
})

// ---- Ownership history + transfer ----

// GET /:id/ownership-history
vehicles.get('/:id/ownership-history', requireModule('vehicles'), authorize([...ROLES_READ]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data, error } = await supabaseAdmin
      .from('vehicle_ownership_history')
      .select('id, from_customer_id, to_customer_id, reason, notes, changed_at, changed_by, from_customer:customers!from_customer_id(id, first_name, last_name, company_name), to_customer:customers!to_customer_id(id, first_name, last_name, company_name), changed_by_user:users!changed_by(id, first_name, last_name)')
      .eq('vehicle_id', id).eq('organization_id', auth.orgId)
      .order('changed_at', { ascending: false })
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ history: data || [] })
  } catch (error) {
    console.error('Ownership history error:', error)
    return c.json({ error: 'Failed to load ownership history' }, 500)
  }
})

// POST /:id/transfer-owner { toCustomerId, reason, notes }
vehicles.post('/:id/transfer-owner', requireModule('vehicles'), authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { toCustomerId, reason = 'other', notes } = await c.req.json()

    if (!toCustomerId) return c.json({ error: 'toCustomerId is required' }, 400)
    if (!(await vehicleInOrg(id, auth.orgId))) return c.json({ error: 'Vehicle not found' }, 404)

    const { data: customer } = await supabaseAdmin
      .from('customers').select('id').eq('id', toCustomerId).eq('organization_id', auth.orgId).maybeSingle()
    if (!customer) return c.json({ error: 'Customer not found' }, 404)

    const { changed, fromCustomerId } = await transferVehicleOwner(
      auth.orgId, id, toCustomerId, auth.user.id, reason, notes || null
    )

    // Marking a vehicle sold flips its lifecycle (suppresses reminders/marketing).
    if (changed && reason === 'sold') {
      await supabaseAdmin
        .from('vehicles')
        .update({ lifecycle_status: 'sold', lifecycle_changed_at: new Date().toISOString() })
        .eq('id', id).eq('organization_id', auth.orgId)
    }

    return c.json({ success: true, changed, fromCustomerId, toCustomerId })
  } catch (error) {
    console.error('Transfer owner error:', error)
    return c.json({ error: 'Failed to transfer owner' }, 500)
  }
})

// ---- Vehicle notes ----

// GET /:id/notes — pinned first; technicians don't see 'internal' notes
vehicles.get('/:id/notes', requireModule('vehicles'), authorize([...ROLES_READ]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    let query = supabaseAdmin
      .from('vehicle_notes')
      .select('id, body, category, is_pinned, author_id, created_at, updated_at, author:users(id, first_name, last_name)')
      .eq('vehicle_id', id).eq('organization_id', auth.orgId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
    if (auth.user.role === 'technician') query = query.neq('category', 'internal')
    const { data, error } = await query
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ notes: data || [] })
  } catch (error) {
    console.error('List vehicle notes error:', error)
    return c.json({ error: 'Failed to list notes' }, 500)
  }
})

// POST /:id/notes { body, category?, isPinned? }
vehicles.post('/:id/notes', requireModule('vehicles'), authorize([...ROLES_WRITE]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { body, category = 'general', isPinned = false } = await c.req.json()
    if (!body || !String(body).trim()) return c.json({ error: 'Note body is required' }, 400)
    if (!['general', 'warning', 'blocked', 'internal'].includes(category)) {
      return c.json({ error: 'Invalid category' }, 400)
    }
    if (!(await vehicleInOrg(id, auth.orgId))) return c.json({ error: 'Vehicle not found' }, 404)

    const { data, error } = await supabaseAdmin
      .from('vehicle_notes')
      .insert({
        organization_id: auth.orgId,
        vehicle_id: id,
        body: String(body).trim(),
        category,
        is_pinned: !!isPinned,
        author_id: auth.user.id
      })
      .select('id, body, category, is_pinned, author_id, created_at, updated_at, author:users(id, first_name, last_name)')
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data, 201)
  } catch (error) {
    console.error('Add vehicle note error:', error)
    return c.json({ error: 'Failed to add note' }, 500)
  }
})

// PATCH /:id/notes/:noteId { body?, category?, isPinned? }
vehicles.patch('/:id/notes/:noteId', requireModule('vehicles'), authorize([...ROLES_WRITE]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, noteId } = c.req.param()
    const { body, category, isPinned } = await c.req.json()
    const update: Record<string, unknown> = {}
    if (body !== undefined) update.body = String(body).trim()
    if (category !== undefined) {
      if (!['general', 'warning', 'blocked', 'internal'].includes(category)) {
        return c.json({ error: 'Invalid category' }, 400)
      }
      update.category = category
    }
    if (isPinned !== undefined) update.is_pinned = !!isPinned
    if (Object.keys(update).length === 0) return c.json({ error: 'Nothing to update' }, 400)

    const { data, error } = await supabaseAdmin
      .from('vehicle_notes')
      .update(update)
      .eq('id', noteId).eq('vehicle_id', id).eq('organization_id', auth.orgId)
      .select('id, body, category, is_pinned, author_id, created_at, updated_at, author:users(id, first_name, last_name)')
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  } catch (error) {
    console.error('Update vehicle note error:', error)
    return c.json({ error: 'Failed to update note' }, 500)
  }
})

// DELETE /:id/notes/:noteId — site_admin+ only
vehicles.delete('/:id/notes/:noteId', requireModule('vehicles'), authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, noteId } = c.req.param()
    const { error } = await supabaseAdmin
      .from('vehicle_notes').delete()
      .eq('id', noteId).eq('vehicle_id', id).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ success: true })
  } catch (error) {
    console.error('Delete vehicle note error:', error)
    return c.json({ error: 'Failed to delete note' }, 500)
  }
})

// ---- Typed expiry dates ----

// GET /:id/expiries
vehicles.get('/:id/expiries', requireModule('vehicles'), authorize([...ROLES_READ]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data, error } = await supabaseAdmin
      .from('vehicle_expiry_dates')
      .select('id, type_code, due_date, due_mileage, source, is_active, snoozed_until, last_notified_at, notes, expiry_type:expiry_types(id, code, label, is_mileage_based)')
      .eq('vehicle_id', id).eq('organization_id', auth.orgId)
      .order('due_date', { ascending: true, nullsFirst: false })
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ expiries: data || [] })
  } catch (error) {
    console.error('List expiries error:', error)
    return c.json({ error: 'Failed to list expiries' }, 500)
  }
})

// PUT /:id/expiries — upsert a typed expiry for the vehicle (manual entry / snooze / dismiss)
vehicles.put('/:id/expiries', requireModule('vehicles'), authorize([...ROLES_WRITE]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { typeCode, dueDate, dueMileage, notes, isActive, snoozedUntil } = await c.req.json()
    if (!typeCode) return c.json({ error: 'typeCode is required' }, 400)
    if (!(await vehicleInOrg(id, auth.orgId))) return c.json({ error: 'Vehicle not found' }, 404)

    const { data: type } = await supabaseAdmin
      .from('expiry_types').select('id').eq('organization_id', auth.orgId).eq('code', typeCode).maybeSingle()

    const { data: existing } = await supabaseAdmin
      .from('vehicle_expiry_dates').select('id, source')
      .eq('vehicle_id', id).eq('type_code', typeCode).eq('organization_id', auth.orgId).maybeSingle()

    // MOT is DVSA-sourced — only allow snooze/dismiss, never a manual due-date edit.
    const isMot = typeCode === 'mot'
    const fields: Record<string, unknown> = {}
    if (!isMot) {
      if (dueDate !== undefined) fields.due_date = dueDate || null
      if (dueMileage !== undefined) fields.due_mileage = dueMileage ?? null
      if (notes !== undefined) fields.notes = notes || null
    }
    if (isActive !== undefined) fields.is_active = !!isActive
    if (snoozedUntil !== undefined) fields.snoozed_until = snoozedUntil || null

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('vehicle_expiry_dates').update(fields).eq('id', existing.id)
        .select('id, type_code, due_date, due_mileage, source, is_active, snoozed_until, notes').single()
      if (error) return c.json({ error: error.message }, 500)
      return c.json(data)
    }
    if (isMot) return c.json({ error: 'MOT expiry is sourced from DVSA — sync the vehicle to populate it' }, 400)

    const { data, error } = await supabaseAdmin
      .from('vehicle_expiry_dates')
      .insert({
        organization_id: auth.orgId,
        vehicle_id: id,
        type_code: typeCode,
        expiry_type_id: type?.id ?? null,
        due_date: dueDate || null,
        due_mileage: dueMileage ?? null,
        notes: notes || null,
        source: 'manual',
        is_active: isActive === undefined ? true : !!isActive,
        snoozed_until: snoozedUntil || null,
        created_by: auth.user.id
      })
      .select('id, type_code, due_date, due_mileage, source, is_active, snoozed_until, notes').single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data, 201)
  } catch (error) {
    console.error('Upsert expiry error:', error)
    return c.json({ error: 'Failed to save expiry' }, 500)
  }
})

// DELETE /:id/expiries/:typeCode — dismiss (soft) a typed expiry
vehicles.delete('/:id/expiries/:typeCode', requireModule('vehicles'), authorize([...ROLES_WRITE]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, typeCode } = c.req.param()
    const { error } = await supabaseAdmin
      .from('vehicle_expiry_dates').update({ is_active: false })
      .eq('vehicle_id', id).eq('type_code', typeCode).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ success: true })
  } catch (error) {
    console.error('Dismiss expiry error:', error)
    return c.json({ error: 'Failed to dismiss expiry' }, 500)
  }
})

// ---- Unified refresh-by-VRM ----

// POST /:id/refresh { newRegistration?, includePaidDetails? }
// Always runs the FREE DVSA MOT sync. The PAID DVLA VehicleDetails lookup fires
// only when includePaidDetails is set AND the vehicle_details module is on (a
// server-side re-check, so the default refresh never re-bills DVLA). Correcting
// the registration resets the keeper baseline so sold-detection re-baselines.
vehicles.post('/:id/refresh', requireModule('vehicles'), authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { newRegistration, includePaidDetails } = await c.req.json().catch(() => ({}))

    const { data: vehicle } = await supabaseAdmin
      .from('vehicles').select('id, registration').eq('id', id).eq('organization_id', auth.orgId).maybeSingle()
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404)

    let registration = vehicle.registration
    const corrected = newRegistration ? String(newRegistration).toUpperCase().replace(/\s/g, '') : null

    // Registration correction: rewrite the reg and reset the keeper baseline so a
    // different vehicle's history doesn't trip a false "sold" lifecycle flip.
    if (corrected && corrected !== vehicle.registration) {
      const { error: regErr } = await supabaseAdmin
        .from('vehicles')
        .update({
          registration: corrected,
          keeper_baseline_start_date: null,
          keeper_baseline_count: null,
          lifecycle_status: 'active',
          lifecycle_changed_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id).eq('organization_id', auth.orgId)
      if (regErr) {
        if (regErr.code === '23505') return c.json({ error: 'Another vehicle already uses that registration' }, 409)
        return c.json({ error: regErr.message }, 500)
      }
      registration = corrected
    }

    // 1) Free DVSA MOT sync (persist also projects the MOT expiry + recomputes).
    let mot: { found: boolean; status: string | null } | null = null
    try {
      const motResult = await lookupVehicleByRegistration(registration)
      if (motResult.success) {
        await persistMotHistory(auth.orgId, id, motResult)
        mot = { found: motResult.found, status: motResult.motStatus }
      } else {
        mot = { found: false, status: null }
      }
    } catch (motErr) {
      console.error('Refresh MOT sync failed:', motErr)
    }

    // 2) Paid DVLA spec refresh — opt-in per call + server-side module re-check.
    let details: { found: boolean; lifecycleStatus: string | null } | null = null
    if (includePaidDetails) {
      const mods = await getEffectiveModulesCached(c, auth.orgId)
      if (!mods.vehicle_details) {
        return c.json({ error: 'Vehicle Data (DVLA spec) module is not enabled' }, 403)
      }
      const result = await lookupVehicleDetailsByRegistration(registration)
      if (result.success) await logVehicleDetailsUsage(auth.orgId, auth.user.id, registration, 'refresh', result)
      if (!result.success) {
        const status =
          result.errorCode === 'RATE_LIMITED' ? 429 :
          result.errorCode === 'AUTH_FAILED' || result.errorCode === 'API_ERROR' || result.errorCode === 'EXCEPTION' ? 502 : 503
        return c.json({ error: result.error || 'Vehicle details lookup failed', code: result.errorCode, mot }, status)
      }
      if (result.found) {
        const { lifecycleStatus } = await persistVehicleDetails(auth.orgId, id, result, { overwriteIdentity: true })
        details = { found: true, lifecycleStatus }
      } else {
        details = { found: false, lifecycleStatus: null }
      }
    }

    await stampVehicleActivity(auth.orgId, id)

    return c.json({ success: true, registration, mot, details })
  } catch (error) {
    console.error('Vehicle refresh error:', error)
    return c.json({ error: 'Failed to refresh vehicle' }, 500)
  }
})

export default vehicles
