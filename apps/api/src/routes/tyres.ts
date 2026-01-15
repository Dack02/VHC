import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const tyres = new Hono()

tyres.use('*', authMiddleware)

// ==================== TYRE MANUFACTURERS ====================

// GET /api/v1/tyre-manufacturers - List all manufacturers for org
tyres.get('/tyre-manufacturers', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { active_only } = c.req.query()

    let query = supabaseAdmin
      .from('tyre_manufacturers')
      .select('*')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: true })

    if (active_only === 'true') {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      manufacturers: data?.map(m => ({
        id: m.id,
        name: m.name,
        isActive: m.is_active,
        sortOrder: m.sort_order
      }))
    })
  } catch (error) {
    console.error('List tyre manufacturers error:', error)
    return c.json({ error: 'Failed to list tyre manufacturers' }, 500)
  }
})

// POST /api/v1/tyre-manufacturers - Create manufacturer
tyres.post('/tyre-manufacturers', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { name } = body

    if (!name) {
      return c.json({ error: 'Name is required' }, 400)
    }

    // Get max sort order
    const { data: maxOrder } = await supabaseAdmin
      .from('tyre_manufacturers')
      .select('sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const { data: manufacturer, error } = await supabaseAdmin
      .from('tyre_manufacturers')
      .insert({
        organization_id: auth.orgId,
        name,
        sort_order: (maxOrder?.sort_order || 0) + 1,
        is_active: true
      })
      .select()
      .single()

    if (error) {
      if (error.message.includes('duplicate')) {
        return c.json({ error: 'Manufacturer already exists' }, 400)
      }
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: manufacturer.id,
      name: manufacturer.name,
      isActive: manufacturer.is_active,
      sortOrder: manufacturer.sort_order
    }, 201)
  } catch (error) {
    console.error('Create tyre manufacturer error:', error)
    return c.json({ error: 'Failed to create tyre manufacturer' }, 500)
  }
})

// PATCH /api/v1/tyre-manufacturers/:id - Update manufacturer
tyres.patch('/tyre-manufacturers/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, isActive } = body

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (isActive !== undefined) updateData.is_active = isActive

    const { data: manufacturer, error } = await supabaseAdmin
      .from('tyre_manufacturers')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: manufacturer.id,
      name: manufacturer.name,
      isActive: manufacturer.is_active,
      sortOrder: manufacturer.sort_order
    })
  } catch (error) {
    console.error('Update tyre manufacturer error:', error)
    return c.json({ error: 'Failed to update tyre manufacturer' }, 500)
  }
})

// DELETE /api/v1/tyre-manufacturers/:id - Delete manufacturer
tyres.delete('/tyre-manufacturers/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { error } = await supabaseAdmin
      .from('tyre_manufacturers')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ message: 'Manufacturer deleted' })
  } catch (error) {
    console.error('Delete tyre manufacturer error:', error)
    return c.json({ error: 'Failed to delete tyre manufacturer' }, 500)
  }
})

// ==================== TYRE SIZES ====================

// GET /api/v1/tyre-sizes - List all sizes for org
tyres.get('/tyre-sizes', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { active_only, rim_size } = c.req.query()

    let query = supabaseAdmin
      .from('tyre_sizes')
      .select('*')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: true })

    if (active_only === 'true') {
      query = query.eq('is_active', true)
    }

    if (rim_size) {
      query = query.eq('rim_size', parseInt(rim_size))
    }

    const { data, error } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      sizes: data?.map(s => ({
        id: s.id,
        size: s.size,
        width: s.width,
        profile: s.profile,
        rimSize: s.rim_size,
        isActive: s.is_active,
        sortOrder: s.sort_order
      }))
    })
  } catch (error) {
    console.error('List tyre sizes error:', error)
    return c.json({ error: 'Failed to list tyre sizes' }, 500)
  }
})

// POST /api/v1/tyre-sizes - Create size
tyres.post('/tyre-sizes', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { size, width, profile, rimSize } = body

    if (!size) {
      return c.json({ error: 'Size is required' }, 400)
    }

    // Get max sort order
    const { data: maxOrder } = await supabaseAdmin
      .from('tyre_sizes')
      .select('sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const { data: tyreSize, error } = await supabaseAdmin
      .from('tyre_sizes')
      .insert({
        organization_id: auth.orgId,
        size,
        width,
        profile,
        rim_size: rimSize,
        sort_order: (maxOrder?.sort_order || 0) + 1,
        is_active: true
      })
      .select()
      .single()

    if (error) {
      if (error.message.includes('duplicate')) {
        return c.json({ error: 'Size already exists' }, 400)
      }
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: tyreSize.id,
      size: tyreSize.size,
      width: tyreSize.width,
      profile: tyreSize.profile,
      rimSize: tyreSize.rim_size,
      isActive: tyreSize.is_active,
      sortOrder: tyreSize.sort_order
    }, 201)
  } catch (error) {
    console.error('Create tyre size error:', error)
    return c.json({ error: 'Failed to create tyre size' }, 500)
  }
})

// PATCH /api/v1/tyre-sizes/:id - Update size
tyres.patch('/tyre-sizes/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { size, width, profile, rimSize, isActive } = body

    const updateData: Record<string, unknown> = {}
    if (size !== undefined) updateData.size = size
    if (width !== undefined) updateData.width = width
    if (profile !== undefined) updateData.profile = profile
    if (rimSize !== undefined) updateData.rim_size = rimSize
    if (isActive !== undefined) updateData.is_active = isActive

    const { data: tyreSize, error } = await supabaseAdmin
      .from('tyre_sizes')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: tyreSize.id,
      size: tyreSize.size,
      width: tyreSize.width,
      profile: tyreSize.profile,
      rimSize: tyreSize.rim_size,
      isActive: tyreSize.is_active,
      sortOrder: tyreSize.sort_order
    })
  } catch (error) {
    console.error('Update tyre size error:', error)
    return c.json({ error: 'Failed to update tyre size' }, 500)
  }
})

// DELETE /api/v1/tyre-sizes/:id - Delete size
tyres.delete('/tyre-sizes/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { error } = await supabaseAdmin
      .from('tyre_sizes')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ message: 'Size deleted' })
  } catch (error) {
    console.error('Delete tyre size error:', error)
    return c.json({ error: 'Failed to delete tyre size' }, 500)
  }
})

// ==================== SPEED RATINGS (Read-only) ====================

// GET /api/v1/speed-ratings - List all speed ratings
tyres.get('/speed-ratings', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('speed_ratings')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      speedRatings: data?.map(r => ({
        id: r.id,
        code: r.code,
        maxSpeedKmh: r.max_speed_kmh,
        maxSpeedMph: r.max_speed_mph,
        description: r.description
      }))
    })
  } catch (error) {
    console.error('List speed ratings error:', error)
    return c.json({ error: 'Failed to list speed ratings' }, 500)
  }
})

// ==================== LOAD RATINGS (Read-only) ====================

// GET /api/v1/load-ratings - List all load ratings
tyres.get('/load-ratings', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('load_ratings')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      loadRatings: data?.map(r => ({
        id: r.id,
        code: r.code,
        maxLoadKg: r.max_load_kg
      }))
    })
  } catch (error) {
    console.error('List load ratings error:', error)
    return c.json({ error: 'Failed to list load ratings' }, 500)
  }
})

export default tyres
