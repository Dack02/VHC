import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const vehicleLocations = new Hono()

// Apply auth middleware to all routes
vehicleLocations.use('*', authMiddleware)

// GET /api/v1/organizations/:orgId/vehicle-locations - List org's vehicle locations
vehicleLocations.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const includeInactive = c.req.query('include_inactive') === 'true'

    let query = supabaseAdmin
      .from('vehicle_locations')
      .select('*')
      .eq('organization_id', orgId)

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data: locations, error } = await query
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Get vehicle locations error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      locations: (locations || []).map(loc => ({
        id: loc.id,
        name: loc.name,
        shortName: loc.short_name,
        sortOrder: loc.sort_order,
        isActive: loc.is_active,
        createdAt: loc.created_at,
        updatedAt: loc.updated_at
      }))
    })
  } catch (error) {
    console.error('Get vehicle locations error:', error)
    return c.json({ error: 'Failed to get vehicle locations' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/vehicle-locations - Create location
vehicleLocations.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { name, short_name } = body

    if (!name || !name.trim()) {
      return c.json({ error: 'Location name is required' }, 400)
    }

    if (!short_name || !short_name.trim()) {
      return c.json({ error: 'Short name is required' }, 400)
    }

    // Get max sort order
    const { data: maxResult } = await supabaseAdmin
      .from('vehicle_locations')
      .select('sort_order')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const sortOrder = (maxResult?.sort_order || 0) + 1

    const { data: newLocation, error } = await supabaseAdmin
      .from('vehicle_locations')
      .insert({
        organization_id: orgId,
        name: name.trim(),
        short_name: short_name.trim().toUpperCase(),
        sort_order: sortOrder
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A location with this name already exists' }, 409)
      }
      console.error('Create vehicle location error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: newLocation.id,
      name: newLocation.name,
      shortName: newLocation.short_name,
      sortOrder: newLocation.sort_order,
      isActive: newLocation.is_active,
      createdAt: newLocation.created_at
    }, 201)
  } catch (error) {
    console.error('Create vehicle location error:', error)
    return c.json({ error: 'Failed to create vehicle location' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/vehicle-locations/:id - Update location
vehicleLocations.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const locationId = c.req.param('id')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { name, short_name, sort_order } = body

    // Check if the location exists and belongs to this org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('vehicle_locations')
      .select('*')
      .eq('id', locationId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Vehicle location not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name.trim()
    if (short_name !== undefined) updateData.short_name = short_name.trim().toUpperCase()
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data: updated, error } = await supabaseAdmin
      .from('vehicle_locations')
      .update(updateData)
      .eq('id', locationId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A location with this name already exists' }, 409)
      }
      console.error('Update vehicle location error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      name: updated.name,
      shortName: updated.short_name,
      sortOrder: updated.sort_order,
      isActive: updated.is_active,
      updatedAt: updated.updated_at
    })
  } catch (error) {
    console.error('Update vehicle location error:', error)
    return c.json({ error: 'Failed to update vehicle location' }, 500)
  }
})

// DELETE /api/v1/organizations/:orgId/vehicle-locations/:id - Soft delete location
vehicleLocations.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const locationId = c.req.param('id')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data: existing, error: existError } = await supabaseAdmin
      .from('vehicle_locations')
      .select('id')
      .eq('id', locationId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Vehicle location not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('vehicle_locations')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', locationId)

    if (error) {
      console.error('Delete vehicle location error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete vehicle location error:', error)
    return c.json({ error: 'Failed to delete vehicle location' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/vehicle-locations/reorder - Bulk reorder
vehicleLocations.post('/reorder', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()
    const { locationIds } = body

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    if (!locationIds || !Array.isArray(locationIds)) {
      return c.json({ error: 'locationIds array is required' }, 400)
    }

    for (let i = 0; i < locationIds.length; i++) {
      await supabaseAdmin
        .from('vehicle_locations')
        .update({ sort_order: i + 1, updated_at: new Date().toISOString() })
        .eq('id', locationIds[i])
        .eq('organization_id', orgId)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Reorder vehicle locations error:', error)
    return c.json({ error: 'Failed to reorder vehicle locations' }, 500)
  }
})

export default vehicleLocations
