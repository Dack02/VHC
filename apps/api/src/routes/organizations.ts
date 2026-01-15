import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const organizations = new Hono()

// Apply auth middleware to all routes
organizations.use('*', authMiddleware)

// GET /api/v1/organizations/:id - Get organization
organizations.get('/:id', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Users can only access their own organization
    if (id !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !org) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    return c.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      settings: org.settings,
      createdAt: org.created_at,
      updatedAt: org.updated_at
    })
  } catch (error) {
    console.error('Get organization error:', error)
    return c.json({ error: 'Failed to get organization' }, 500)
  }
})

// PATCH /api/v1/organizations/:id - Update organization
organizations.patch('/:id', authorize(['super_admin', 'org_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, settings } = body

    // Users can only update their own organization
    if (id !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name
    if (settings !== undefined) updateData.settings = settings

    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      settings: org.settings,
      updatedAt: org.updated_at
    })
  } catch (error) {
    console.error('Update organization error:', error)
    return c.json({ error: 'Failed to update organization' }, 500)
  }
})

export default organizations
