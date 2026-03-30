import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'

const statuses = new Hono()

/**
 * GET /statuses — List all tcard statuses for org
 */
statuses.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const includeInactive = c.req.query('include_inactive') === 'true'

    let query = supabaseAdmin
      .from('tcard_statuses')
      .select('*')
      .eq('organization_id', auth.orgId)

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query.order('sort_order', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      statuses: (data || []).map(s => ({
        id: s.id,
        name: s.name,
        colour: s.colour,
        icon: s.icon,
        sortOrder: s.sort_order,
        isActive: s.is_active,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }))
    })
  } catch (error) {
    console.error('Get statuses error:', error)
    return c.json({ error: 'Failed to get statuses' }, 500)
  }
})

/**
 * POST /statuses — Create new status
 */
statuses.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    console.log('Create status request:', { orgId: auth.orgId, body })
    const { name, colour, icon } = body

    if (!name || !colour) {
      return c.json({ error: 'name and colour are required' }, 400)
    }

    // Get max sort order
    const { data: maxStatus, error: maxError } = await supabaseAdmin
      .from('tcard_statuses')
      .select('sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (maxError) {
      console.error('Max sort order query error:', maxError)
    }

    const nextOrder = (maxStatus?.sort_order ?? -1) + 1
    console.log('Inserting status with sort_order:', nextOrder)

    const { data: status, error } = await supabaseAdmin
      .from('tcard_statuses')
      .insert({
        organization_id: auth.orgId,
        name,
        colour,
        icon: icon || null,
        sort_order: nextOrder,
      })
      .select()
      .single()

    if (error) {
      console.error('Create status DB error:', { code: error.code, message: error.message, details: error.details, hint: error.hint })
      if (error.code === '23505') {
        return c.json({ error: 'A status with this name already exists' }, 409)
      }
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      status: {
        id: status.id,
        name: status.name,
        colour: status.colour,
        icon: status.icon,
        sortOrder: status.sort_order,
        isActive: status.is_active,
      }
    }, 201)
  } catch (error: any) {
    console.error('Create status CATCH:', error?.message || error, error?.stack)
    return c.json({ error: error?.message || 'Failed to create status' }, 500)
  }
})

/**
 * PATCH /statuses/reorder — Reorder statuses (MUST be before /:id)
 */
statuses.patch('/reorder', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { statusIds } = await c.req.json()

    if (!Array.isArray(statusIds)) {
      return c.json({ error: 'statusIds array is required' }, 400)
    }

    const updates = statusIds.map((id: string, index: number) =>
      supabaseAdmin
        .from('tcard_statuses')
        .update({ sort_order: index, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('organization_id', auth.orgId)
    )

    await Promise.all(updates)

    return c.json({ success: true })
  } catch (error) {
    console.error('Reorder statuses error:', error)
    return c.json({ error: 'Failed to reorder statuses' }, 500)
  }
})

/**
 * PATCH /statuses/:id — Update status
 */
statuses.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json()

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) updates.name = body.name
    if (body.colour !== undefined) updates.colour = body.colour
    if (body.icon !== undefined) updates.icon = body.icon
    if (body.isActive !== undefined) updates.is_active = body.isActive

    const { data: status, error } = await supabaseAdmin
      .from('tcard_statuses')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      status: {
        id: status.id,
        name: status.name,
        colour: status.colour,
        icon: status.icon,
        sortOrder: status.sort_order,
        isActive: status.is_active,
      }
    })
  } catch (error) {
    console.error('Update status error:', error)
    return c.json({ error: 'Failed to update status' }, 500)
  }
})

/**
 * DELETE /statuses/:id — Soft-delete (set is_active = false)
 */
statuses.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')

    const { error } = await supabaseAdmin
      .from('tcard_statuses')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete status error:', error)
    return c.json({ error: 'Failed to delete status' }, 500)
  }
})

export default statuses
