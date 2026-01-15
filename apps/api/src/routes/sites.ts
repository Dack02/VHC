import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const sites = new Hono()

// Apply auth middleware to all routes
sites.use('*', authMiddleware)

// GET /api/v1/sites - List sites for org
sites.get('/', async (c) => {
  try {
    const auth = c.get('auth')

    let query = supabaseAdmin
      .from('sites')
      .select('*')
      .eq('organization_id', auth.orgId)
      .order('name')

    // Site-level users can only see their own site
    if (['site_admin', 'service_advisor', 'technician'].includes(auth.user.role) && auth.user.siteId) {
      query = query.eq('id', auth.user.siteId)
    }

    const { data, error } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      sites: data?.map(site => ({
        id: site.id,
        name: site.name,
        address: site.address,
        phone: site.phone,
        email: site.email,
        settings: site.settings,
        createdAt: site.created_at
      }))
    })
  } catch (error) {
    console.error('List sites error:', error)
    return c.json({ error: 'Failed to list sites' }, 500)
  }
})

// POST /api/v1/sites - Create site
sites.post('/', authorize(['super_admin', 'org_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { name, address, phone, email, settings } = body

    if (!name) {
      return c.json({ error: 'Name is required' }, 400)
    }

    const { data: site, error } = await supabaseAdmin
      .from('sites')
      .insert({
        organization_id: auth.orgId,
        name,
        address,
        phone,
        email,
        settings: settings || {}
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: site.id,
      name: site.name,
      address: site.address,
      phone: site.phone,
      email: site.email,
      settings: site.settings,
      createdAt: site.created_at
    }, 201)
  } catch (error) {
    console.error('Create site error:', error)
    return c.json({ error: 'Failed to create site' }, 500)
  }
})

// GET /api/v1/sites/:id - Get single site
sites.get('/:id', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: site, error } = await supabaseAdmin
      .from('sites')
      .select('*')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !site) {
      return c.json({ error: 'Site not found' }, 404)
    }

    // Site-level users can only view their own site
    if (['site_admin', 'service_advisor', 'technician'].includes(auth.user.role) &&
        auth.user.siteId && site.id !== auth.user.siteId) {
      return c.json({ error: 'Site not found' }, 404)
    }

    return c.json({
      id: site.id,
      name: site.name,
      address: site.address,
      phone: site.phone,
      email: site.email,
      settings: site.settings,
      createdAt: site.created_at,
      updatedAt: site.updated_at
    })
  } catch (error) {
    console.error('Get site error:', error)
    return c.json({ error: 'Failed to get site' }, 500)
  }
})

// PATCH /api/v1/sites/:id - Update site
sites.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, address, phone, email, settings } = body

    // Site admins can only update their own site
    if (auth.user.role === 'site_admin' && id !== auth.user.siteId) {
      return c.json({ error: 'Site not found' }, 404)
    }

    // First verify site belongs to org
    const { data: existingSite, error: fetchError } = await supabaseAdmin
      .from('sites')
      .select('*')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !existingSite) {
      return c.json({ error: 'Site not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name
    if (address !== undefined) updateData.address = address
    if (phone !== undefined) updateData.phone = phone
    if (email !== undefined) updateData.email = email
    if (settings !== undefined) updateData.settings = settings

    const { data: site, error } = await supabaseAdmin
      .from('sites')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: site.id,
      name: site.name,
      address: site.address,
      phone: site.phone,
      email: site.email,
      settings: site.settings,
      updatedAt: site.updated_at
    })
  } catch (error) {
    console.error('Update site error:', error)
    return c.json({ error: 'Failed to update site' }, 500)
  }
})

export default sites
