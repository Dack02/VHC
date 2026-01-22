import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'

type DmsContext = {
  Variables: {
    orgId: string
    orgName: string
  }
}

const dms = new Hono<DmsContext>()

// DMS API Key authentication middleware
async function dmsAuth(c: any, next: any) {
  const apiKey = c.req.header('X-API-Key') || c.req.header('Authorization')?.replace('Bearer ', '')

  if (!apiKey) {
    return c.json({ error: 'API key required' }, 401)
  }

  // Look up API key in organizations table (stored in settings.dms_api_key)
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, settings')
    .filter('settings->dms_api_key', 'eq', apiKey)
    .single()

  if (error || !org) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  c.set('orgId', org.id)
  c.set('orgName', org.name)
  await next()
}

dms.use('*', dmsAuth)

// POST /api/v1/dms/customers - Upsert customer from DMS
dms.post('/customers', async (c) => {
  try {
    const orgId = c.get('orgId')
    const body = await c.req.json()
    const { externalId, firstName, lastName, email, mobile, address, siteExternalId } = body

    if (!externalId || !firstName || !lastName) {
      return c.json({ error: 'externalId, firstName, and lastName are required' }, 400)
    }

    // Find site by external ID if provided
    let siteId = null
    if (siteExternalId) {
      const { data: site } = await supabaseAdmin
        .from('sites')
        .select('id')
        .eq('organization_id', orgId)
        .filter('settings->external_id', 'eq', siteExternalId)
        .single()
      siteId = site?.id
    }

    // Check if customer exists by external_id
    const { data: existing } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .eq('external_id', externalId)
      .single()

    let customer
    if (existing) {
      // Update existing customer
      const { data, error } = await supabaseAdmin
        .from('customers')
        .update({
          first_name: firstName,
          last_name: lastName,
          email,
          mobile,
          address,
          site_id: siteId,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      customer = data
    } else {
      // Create new customer
      const { data, error } = await supabaseAdmin
        .from('customers')
        .insert({
          organization_id: orgId,
          site_id: siteId,
          external_id: externalId,
          first_name: firstName,
          last_name: lastName,
          email,
          mobile,
          address
        })
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      customer = data
    }

    return c.json({
      id: customer.id,
      externalId: customer.external_id,
      firstName: customer.first_name,
      lastName: customer.last_name,
      email: customer.email,
      mobile: customer.mobile,
      created: !existing
    }, existing ? 200 : 201)
  } catch (error) {
    console.error('DMS customer upsert error:', error)
    return c.json({ error: 'Failed to process customer' }, 500)
  }
})

// POST /api/v1/dms/vehicles - Upsert vehicle from DMS
dms.post('/vehicles', async (c) => {
  try {
    const orgId = c.get('orgId')
    const body = await c.req.json()
    const {
      registration,
      vin,
      customerExternalId,
      make,
      model,
      year,
      color,
      fuelType,
      engineSize,
      mileage,
      motDue,
      serviceDue,
      siteExternalId
    } = body

    if (!registration) {
      return c.json({ error: 'registration is required' }, 400)
    }

    // Find customer by external ID
    let customerId = null
    if (customerExternalId) {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('organization_id', orgId)
        .eq('external_id', customerExternalId)
        .single()

      if (!customer) {
        return c.json({ error: `Customer with externalId '${customerExternalId}' not found` }, 404)
      }
      customerId = customer.id
    }

    // Find site by external ID if provided
    let siteId = null
    if (siteExternalId) {
      const { data: site } = await supabaseAdmin
        .from('sites')
        .select('id')
        .eq('organization_id', orgId)
        .filter('settings->external_id', 'eq', siteExternalId)
        .single()
      siteId = site?.id
    }

    // Normalize registration
    const normalizedReg = registration.toUpperCase().replace(/\s/g, '')

    // Check if vehicle exists by registration
    const { data: existing } = await supabaseAdmin
      .from('vehicles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('registration', normalizedReg)
      .single()

    let vehicle
    if (existing) {
      // Update existing vehicle
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString()
      }
      if (customerId) updateData.customer_id = customerId
      if (siteId) updateData.site_id = siteId
      if (vin) updateData.vin = vin.toUpperCase()
      if (make) updateData.make = make
      if (model) updateData.model = model
      if (year) updateData.year = year
      if (color) updateData.color = color
      if (fuelType) updateData.fuel_type = fuelType
      if (engineSize) updateData.engine_size = engineSize
      if (mileage) updateData.mileage = mileage
      if (motDue) updateData.mot_due = motDue
      if (serviceDue) updateData.service_due = serviceDue

      const { data, error } = await supabaseAdmin
        .from('vehicles')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      vehicle = data
    } else {
      // Create new vehicle
      if (!customerId) {
        return c.json({ error: 'customerExternalId is required for new vehicles' }, 400)
      }

      const { data, error } = await supabaseAdmin
        .from('vehicles')
        .insert({
          organization_id: orgId,
          site_id: siteId,
          customer_id: customerId,
          registration: normalizedReg,
          vin: vin?.toUpperCase(),
          make,
          model,
          year,
          color,
          fuel_type: fuelType,
          engine_size: engineSize,
          mileage,
          mot_due: motDue,
          service_due: serviceDue
        })
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      vehicle = data
    }

    return c.json({
      id: vehicle.id,
      registration: vehicle.registration,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      customerId: vehicle.customer_id,
      created: !existing
    }, existing ? 200 : 201)
  } catch (error) {
    console.error('DMS vehicle upsert error:', error)
    return c.json({ error: 'Failed to process vehicle' }, 500)
  }
})

// POST /api/v1/dms/batch - Batch upsert customers and vehicles
dms.post('/batch', async (c) => {
  try {
    const orgId = c.get('orgId')
    const body = await c.req.json()
    const { customers = [], vehicles = [] } = body

    const results = {
      customers: { created: 0, updated: 0, errors: [] as string[] },
      vehicles: { created: 0, updated: 0, errors: [] as string[] }
    }

    // Process customers first
    for (const cust of customers) {
      try {
        const { data: existing } = await supabaseAdmin
          .from('customers')
          .select('id')
          .eq('organization_id', orgId)
          .eq('external_id', cust.externalId)
          .single()

        if (existing) {
          await supabaseAdmin
            .from('customers')
            .update({
              first_name: cust.firstName,
              last_name: cust.lastName,
              email: cust.email,
              mobile: cust.mobile,
              address: cust.address,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id)
          results.customers.updated++
        } else {
          await supabaseAdmin
            .from('customers')
            .insert({
              organization_id: orgId,
              external_id: cust.externalId,
              first_name: cust.firstName,
              last_name: cust.lastName,
              email: cust.email,
              mobile: cust.mobile,
              address: cust.address
            })
          results.customers.created++
        }
      } catch (err) {
        results.customers.errors.push(`${cust.externalId}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Process vehicles
    for (const veh of vehicles) {
      try {
        const normalizedReg = veh.registration.toUpperCase().replace(/\s/g, '')

        // Find customer
        let customerId = null
        if (veh.customerExternalId) {
          const { data: customer } = await supabaseAdmin
            .from('customers')
            .select('id')
            .eq('organization_id', orgId)
            .eq('external_id', veh.customerExternalId)
            .single()
          customerId = customer?.id
        }

        const { data: existing } = await supabaseAdmin
          .from('vehicles')
          .select('id')
          .eq('organization_id', orgId)
          .eq('registration', normalizedReg)
          .single()

        if (existing) {
          await supabaseAdmin
            .from('vehicles')
            .update({
              customer_id: customerId || undefined,
              vin: veh.vin?.toUpperCase(),
              make: veh.make,
              model: veh.model,
              year: veh.year,
              color: veh.color,
              fuel_type: veh.fuelType,
              mileage: veh.mileage,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id)
          results.vehicles.updated++
        } else {
          if (!customerId) {
            results.vehicles.errors.push(`${normalizedReg}: Customer not found`)
            continue
          }
          await supabaseAdmin
            .from('vehicles')
            .insert({
              organization_id: orgId,
              customer_id: customerId,
              registration: normalizedReg,
              vin: veh.vin?.toUpperCase(),
              make: veh.make,
              model: veh.model,
              year: veh.year,
              color: veh.color,
              fuel_type: veh.fuelType,
              mileage: veh.mileage
            })
          results.vehicles.created++
        }
      } catch (err) {
        results.vehicles.errors.push(`${veh.registration}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return c.json(results)
  } catch (error) {
    console.error('DMS batch upsert error:', error)
    return c.json({ error: 'Failed to process batch' }, 500)
  }
})

// GET /api/v1/dms/health-checks - Get health checks for DMS sync back
dms.get('/health-checks', async (c) => {
  try {
    const orgId = c.get('orgId')
    const { status, since, customerExternalId, registration } = c.req.query()

    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        created_at,
        updated_at,
        mileage_in,
        mileage_out,
        total_labour,
        total_parts,
        total_amount,
        green_count,
        amber_count,
        red_count,
        vehicle:vehicles(
          registration,
          vin,
          make,
          model,
          customer:customers(external_id, first_name, last_name)
        )
      `)
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(100)

    if (status) {
      query = query.eq('status', status)
    }
    if (since) {
      query = query.gte('updated_at', since)
    }

    const { data, error } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Filter by customer or registration if specified
    let filtered = data || []
    if (customerExternalId) {
      filtered = filtered.filter((hc: any) =>
        hc.vehicle?.customer?.external_id === customerExternalId
      )
    }
    if (registration) {
      const normalizedReg = registration.toUpperCase().replace(/\s/g, '')
      filtered = filtered.filter((hc: any) =>
        hc.vehicle?.registration === normalizedReg
      )
    }

    return c.json({
      healthChecks: filtered.map((hc: any) => ({
        id: hc.id,
        status: hc.status,
        createdAt: hc.created_at,
        updatedAt: hc.updated_at,
        mileageIn: hc.mileage_in,
        mileageOut: hc.mileage_out,
        totalLabour: hc.total_labour,
        totalParts: hc.total_parts,
        totalAmount: hc.total_amount,
        greenCount: hc.green_count,
        amberCount: hc.amber_count,
        redCount: hc.red_count,
        vehicle: hc.vehicle ? {
          registration: hc.vehicle.registration,
          vin: hc.vehicle.vin,
          make: hc.vehicle.make,
          model: hc.vehicle.model
        } : null,
        customerExternalId: hc.vehicle?.customer?.external_id,
        customerName: hc.vehicle?.customer
          ? `${hc.vehicle.customer.first_name} ${hc.vehicle.customer.last_name}`
          : null
      }))
    })
  } catch (error) {
    console.error('DMS get health checks error:', error)
    return c.json({ error: 'Failed to get health checks' }, 500)
  }
})

export default dms
