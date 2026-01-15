import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const customers = new Hono()

customers.use('*', authMiddleware)

// GET /api/v1/customers - List customers with search/pagination
customers.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { search, site_id, limit = '50', offset = '0' } = c.req.query()

    let query = supabaseAdmin
      .from('customers')
      .select('*, vehicles:vehicles(id, registration, make, model)', { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (site_id) {
      query = query.eq('site_id', site_id)
    }

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,mobile.ilike.%${search}%`)
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      customers: data?.map(customer => ({
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        mobile: customer.mobile,
        address: customer.address,
        externalId: customer.external_id,
        vehicles: customer.vehicles,
        createdAt: customer.created_at
      })),
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('List customers error:', error)
    return c.json({ error: 'Failed to list customers' }, 500)
  }
})

// GET /api/v1/customers/search - Quick search
customers.get('/search', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { q } = c.req.query()

    if (!q || q.length < 2) {
      return c.json({ customers: [] })
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .select('id, first_name, last_name, email, mobile')
      .eq('organization_id', auth.orgId)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,mobile.ilike.%${q}%`)
      .limit(10)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      customers: data?.map(c => ({
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        email: c.email,
        mobile: c.mobile
      }))
    })
  } catch (error) {
    console.error('Search customers error:', error)
    return c.json({ error: 'Failed to search customers' }, 500)
  }
})

// POST /api/v1/customers - Create customer
customers.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { firstName, lastName, email, mobile, address, externalId, siteId } = body

    if (!firstName || !lastName) {
      return c.json({ error: 'First name and last name are required' }, 400)
    }

    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .insert({
        organization_id: auth.orgId,
        site_id: siteId || auth.user.siteId,
        first_name: firstName,
        last_name: lastName,
        email,
        mobile,
        address,
        external_id: externalId
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: customer.id,
      firstName: customer.first_name,
      lastName: customer.last_name,
      email: customer.email,
      mobile: customer.mobile,
      address: customer.address,
      externalId: customer.external_id,
      createdAt: customer.created_at
    }, 201)
  } catch (error) {
    console.error('Create customer error:', error)
    return c.json({ error: 'Failed to create customer' }, 500)
  }
})

// GET /api/v1/customers/:id - Get customer with vehicles
customers.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .select('*, vehicles:vehicles(*)')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !customer) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    return c.json({
      id: customer.id,
      firstName: customer.first_name,
      lastName: customer.last_name,
      email: customer.email,
      mobile: customer.mobile,
      address: customer.address,
      externalId: customer.external_id,
      vehicles: customer.vehicles?.map((v: Record<string, unknown>) => ({
        id: v.id,
        registration: v.registration,
        vin: v.vin,
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color,
        fuelType: v.fuel_type,
        engineSize: v.engine_size
      })),
      createdAt: customer.created_at,
      updatedAt: customer.updated_at
    })
  } catch (error) {
    console.error('Get customer error:', error)
    return c.json({ error: 'Failed to get customer' }, 500)
  }
})

// PATCH /api/v1/customers/:id - Update customer
customers.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { firstName, lastName, email, mobile, address, externalId } = body

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (firstName !== undefined) updateData.first_name = firstName
    if (lastName !== undefined) updateData.last_name = lastName
    if (email !== undefined) updateData.email = email
    if (mobile !== undefined) updateData.mobile = mobile
    if (address !== undefined) updateData.address = address
    if (externalId !== undefined) updateData.external_id = externalId

    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: customer.id,
      firstName: customer.first_name,
      lastName: customer.last_name,
      email: customer.email,
      mobile: customer.mobile,
      address: customer.address,
      externalId: customer.external_id,
      updatedAt: customer.updated_at
    })
  } catch (error) {
    console.error('Update customer error:', error)
    return c.json({ error: 'Failed to update customer' }, 500)
  }
})

export default customers
