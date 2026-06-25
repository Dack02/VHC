import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { lookupVehicleByRegistration, persistMotHistory } from '../services/mot-history.js'

const vehicles = new Hono()

vehicles.use('*', authMiddleware)

// GET /api/v1/vehicles - List vehicles with filters
vehicles.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { customer_id, search, limit = '50', offset = '0' } = c.req.query()

    let query = supabaseAdmin
      .from('vehicles')
      .select('*, customer:customers(id, first_name, last_name, email, mobile)', { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (customer_id) {
      query = query.eq('customer_id', customer_id)
    }

    if (search) {
      query = query.or(`registration.ilike.%${search}%,vin.ilike.%${search}%,make.ilike.%${search}%,model.ilike.%${search}%`)
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      vehicles: data?.map(vehicle => ({
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
      })),
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
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

// POST /api/v1/vehicles - Create vehicle
vehicles.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const {
      customerId, registration, vin, make, model, year,
      color, fuelType, engineSize, syncMotHistory
    } = body

    if (!registration) {
      return c.json({ error: 'Registration is required' }, 400)
    }

    // Customer is optional — a registration may be looked up for a walk-in
    // before a customer record exists. Validate only when provided.
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
    }

    const { data: vehicle, error } = await supabaseAdmin
      .from('vehicles')
      .insert({
        organization_id: auth.orgId,
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

    return c.json({
      id: vehicle.id,
      customer_id: vehicle.customer_id,
      customer: vehicle.customer ? {
        id: vehicle.customer.id,
        first_name: vehicle.customer.first_name,
        last_name: vehicle.customer.last_name,
        email: vehicle.customer.email,
        mobile: vehicle.customer.mobile,
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

    // Allow (re)linking a customer to the vehicle. Validate ownership when provided;
    // null/empty is ignored so this endpoint never silently unlinks a customer.
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
      updateData.customer_id = customerId
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

export default vehicles
