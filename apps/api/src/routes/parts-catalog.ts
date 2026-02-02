import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const partsCatalog = new Hono()

partsCatalog.use('*', authMiddleware)

// GET /api/v1/organizations/:orgId/parts-catalog - List all parts (paginated)
partsCatalog.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '25', 10)))
    const q = c.req.query('q')?.trim() || ''
    const includeInactive = c.req.query('include_inactive') === 'true'
    const sort = c.req.query('sort') || 'part_number'
    const order = c.req.query('order') === 'desc' ? false : true
    const offset = (page - 1) * limit

    const allowedSortColumns = ['part_number', 'description', 'cost_price', 'created_at', 'updated_at']
    const sortColumn = allowedSortColumns.includes(sort) ? sort : 'part_number'

    let query = supabaseAdmin
      .from('parts_catalog')
      .select('*', { count: 'exact' })
      .eq('organization_id', orgId)
      .order(sortColumn, { ascending: order })
      .range(offset, offset + limit - 1)

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    if (q) {
      query = query.or(`part_number.ilike.%${q}%,description.ilike.%${q}%`)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('List parts catalog error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      parts: (data || []).map(p => ({
        id: p.id,
        partNumber: p.part_number,
        description: p.description,
        costPrice: parseFloat(p.cost_price),
        isActive: p.is_active,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      })),
      total: count || 0,
      page,
      limit
    })
  } catch (error) {
    console.error('List parts catalog error:', error)
    return c.json({ error: 'Failed to list parts catalog' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/parts-catalog - Upsert part to catalog
partsCatalog.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { part_number, description, cost_price } = body

    if (!part_number || !part_number.trim()) {
      return c.json({ error: 'Part number is required' }, 400)
    }
    if (!description || !description.trim()) {
      return c.json({ error: 'Description is required' }, 400)
    }
    if (cost_price === undefined || cost_price === null || isNaN(parseFloat(cost_price))) {
      return c.json({ error: 'Cost price is required' }, 400)
    }

    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .upsert({
        organization_id: orgId,
        part_number: part_number.trim(),
        description: description.trim(),
        cost_price: parseFloat(cost_price),
        created_by: auth.user.id,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'organization_id,part_number'
      })
      .select()
      .single()

    if (error) {
      console.error('Upsert parts catalog error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: data.id,
      partNumber: data.part_number,
      description: data.description,
      costPrice: parseFloat(data.cost_price),
      isActive: data.is_active
    }, 201)
  } catch (error) {
    console.error('Upsert parts catalog error:', error)
    return c.json({ error: 'Failed to save part to catalog' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/parts-catalog/:id/toggle-active - Toggle active status
partsCatalog.patch('/:id/toggle-active', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const id = c.req.param('id')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Fetch current state
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('parts_catalog')
      .select('id, is_active')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single()

    if (fetchError || !existing) {
      return c.json({ error: 'Part not found' }, 404)
    }

    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .update({
        is_active: !existing.is_active,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single()

    if (error) {
      console.error('Toggle part active error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: data.id,
      partNumber: data.part_number,
      description: data.description,
      costPrice: parseFloat(data.cost_price),
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    })
  } catch (error) {
    console.error('Toggle part active error:', error)
    return c.json({ error: 'Failed to toggle part status' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/parts-catalog/:id - Update a part
partsCatalog.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const id = c.req.param('id')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const body = await c.req.json()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (body.description !== undefined) {
      if (!body.description || !body.description.trim()) {
        return c.json({ error: 'Description cannot be empty' }, 400)
      }
      updates.description = body.description.trim()
    }

    if (body.cost_price !== undefined) {
      if (body.cost_price === null || isNaN(parseFloat(body.cost_price))) {
        return c.json({ error: 'Invalid cost price' }, 400)
      }
      updates.cost_price = parseFloat(body.cost_price)
    }

    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single()

    if (error) {
      console.error('Update part error:', error)
      return c.json({ error: error.message }, 500)
    }

    if (!data) {
      return c.json({ error: 'Part not found' }, 404)
    }

    return c.json({
      id: data.id,
      partNumber: data.part_number,
      description: data.description,
      costPrice: parseFloat(data.cost_price),
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    })
  } catch (error) {
    console.error('Update part error:', error)
    return c.json({ error: 'Failed to update part' }, 500)
  }
})

// GET /api/v1/organizations/:orgId/parts-catalog/search?q= - Search catalog
partsCatalog.get('/search', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const q = c.req.query('q')?.trim() || ''

    let query = supabaseAdmin
      .from('parts_catalog')
      .select('id, part_number, description, cost_price, is_active')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('part_number', { ascending: true })
      .limit(10)

    if (q) {
      query = query.or(`part_number.ilike.%${q}%,description.ilike.%${q}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Search parts catalog error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      parts: (data || []).map(p => ({
        id: p.id,
        partNumber: p.part_number,
        description: p.description,
        costPrice: parseFloat(p.cost_price),
        isActive: p.is_active
      }))
    })
  } catch (error) {
    console.error('Search parts catalog error:', error)
    return c.json({ error: 'Failed to search parts catalog' }, 500)
  }
})

// GET /api/v1/organizations/:orgId/parts-catalog/part-numbers - Get all active part numbers
partsCatalog.get('/part-numbers', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .select('part_number')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('part_number', { ascending: true })

    if (error) {
      console.error('Get part numbers error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      partNumbers: (data || []).map(p => p.part_number)
    })
  } catch (error) {
    console.error('Get part numbers error:', error)
    return c.json({ error: 'Failed to get part numbers' }, 500)
  }
})

export default partsCatalog
