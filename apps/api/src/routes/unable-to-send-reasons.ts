import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const unableToSendReasons = new Hono()

// Apply auth middleware to all routes
unableToSendReasons.use('*', authMiddleware)

// GET /api/v1/organizations/:orgId/unable-to-send-reasons - List org's reasons
unableToSendReasons.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data: reasons, error } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('reason', { ascending: true })

    if (error) {
      console.error('Get unable to send reasons error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      reasons: (reasons || []).map(reason => ({
        id: reason.id,
        reason: reason.reason,
        description: reason.description,
        isActive: reason.is_active,
        isSystem: reason.is_system,
        sortOrder: reason.sort_order,
        createdAt: reason.created_at,
        updatedAt: reason.updated_at
      }))
    })
  } catch (error) {
    console.error('Get unable to send reasons error:', error)
    return c.json({ error: 'Failed to get unable to send reasons' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/unable-to-send-reasons - Create reason
unableToSendReasons.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { reason, description } = body

    if (!reason || !reason.trim()) {
      return c.json({ error: 'Reason is required' }, 400)
    }

    // Get next sort order
    const { data: maxSort } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .select('sort_order')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const nextSortOrder = (maxSort?.sort_order || 0) + 1

    const { data: newReason, error } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .insert({
        organization_id: orgId,
        reason: reason.trim(),
        description: description?.trim() || null,
        sort_order: nextSortOrder,
        is_system: false
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A reason with this text already exists' }, 409)
      }
      console.error('Create unable to send reason error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: newReason.id,
      reason: newReason.reason,
      description: newReason.description,
      isActive: newReason.is_active,
      isSystem: newReason.is_system,
      sortOrder: newReason.sort_order,
      createdAt: newReason.created_at
    }, 201)
  } catch (error) {
    console.error('Create unable to send reason error:', error)
    return c.json({ error: 'Failed to create unable to send reason' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/unable-to-send-reasons/seed-defaults - Seed default reasons
unableToSendReasons.post('/seed-defaults', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Check if any reasons already exist
    const { data: existingReasons, error: checkError } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .select('reason')
      .eq('organization_id', orgId)
      .eq('is_active', true)

    if (checkError) {
      console.error('Check existing reasons error:', checkError)
      return c.json({ error: checkError.message }, 500)
    }

    if (existingReasons && existingReasons.length > 0) {
      return c.json({ created: [] })
    }

    const defaultReasons = [
      { reason: 'Lease Vehicle', sort_order: 1, is_system: false },
      { reason: 'Fleet Vehicle', sort_order: 2, is_system: false },
      { reason: 'No Contact Information', sort_order: 3, is_system: false },
      { reason: 'Customer Present in Dealership', sort_order: 4, is_system: false },
      { reason: 'Other', sort_order: 99, is_system: true }
    ]

    const { data: insertedReasons, error: insertError } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .insert(defaultReasons.map(r => ({
        ...r,
        organization_id: orgId
      })))
      .select()

    if (insertError) {
      console.error('Seed unable to send reasons error:', insertError)
      return c.json({ error: insertError.message }, 500)
    }

    return c.json({
      created: (insertedReasons || []).map(r => r.reason)
    }, 201)
  } catch (error) {
    console.error('Seed unable to send reasons error:', error)
    return c.json({ error: 'Failed to seed unable to send reasons' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/unable-to-send-reasons/:id - Update reason
unableToSendReasons.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const reasonId = c.req.param('id')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { reason, description, sort_order } = body

    const { data: existing, error: existError } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .select('*')
      .eq('id', reasonId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Unable to send reason not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (reason !== undefined) updateData.reason = reason.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data: updated, error } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .update(updateData)
      .eq('id', reasonId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A reason with this text already exists' }, 409)
      }
      console.error('Update unable to send reason error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      reason: updated.reason,
      description: updated.description,
      isActive: updated.is_active,
      isSystem: updated.is_system,
      sortOrder: updated.sort_order,
      updatedAt: updated.updated_at
    })
  } catch (error) {
    console.error('Update unable to send reason error:', error)
    return c.json({ error: 'Failed to update unable to send reason' }, 500)
  }
})

// DELETE /api/v1/organizations/:orgId/unable-to-send-reasons/:id - Soft delete reason
unableToSendReasons.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const reasonId = c.req.param('id')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data: existing, error: existError } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .select('id, is_system')
      .eq('id', reasonId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Unable to send reason not found' }, 404)
    }

    if (existing.is_system) {
      return c.json({ error: 'System reasons cannot be deleted' }, 403)
    }

    const { error } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', reasonId)

    if (error) {
      console.error('Delete unable to send reason error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete unable to send reason error:', error)
    return c.json({ error: 'Failed to delete unable to send reason' }, 500)
  }
})

export default unableToSendReasons
