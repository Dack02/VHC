import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

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

// POST /api/v1/vehicles - Create vehicle
vehicles.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const {
      customerId, registration, vin, make, model, year,
      color, fuelType, engineSize
    } = body

    if (!customerId || !registration) {
      return c.json({ error: 'Customer ID and registration are required' }, 400)
    }

    // Verify customer belongs to org
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    const { data: vehicle, error } = await supabaseAdmin
      .from('vehicles')
      .insert({
        organization_id: auth.orgId,
        customer_id: customerId,
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
      color, fuelType, engineSize
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
