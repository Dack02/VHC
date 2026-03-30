import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { emitToSite } from '../../services/websocket.js'

const columns = new Hono()

/**
 * GET /columns?siteId= — List technician columns for site
 */
columns.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const siteId = c.req.query('siteId')

    if (!siteId) {
      return c.json({ error: 'siteId is required' }, 400)
    }

    const { data, error } = await supabaseAdmin
      .from('tcard_columns')
      .select(`
        id, technician_id, sort_order, available_hours, is_visible,
        technician:users(id, first_name, last_name)
      `)
      .eq('organization_id', auth.orgId)
      .eq('site_id', siteId)
      .order('sort_order', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      columns: (data || []).map(col => ({
        id: col.id,
        technicianId: col.technician_id,
        technician: col.technician ? {
          id: (col.technician as any).id,
          firstName: (col.technician as any).first_name,
          lastName: (col.technician as any).last_name,
        } : null,
        sortOrder: col.sort_order,
        availableHours: col.available_hours,
        isVisible: col.is_visible,
      }))
    })
  } catch (error) {
    console.error('Get columns error:', error)
    return c.json({ error: 'Failed to get columns' }, 500)
  }
})

/**
 * POST /columns — Add technician column
 */
columns.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { siteId, technicianId, availableHours } = await c.req.json()

    if (!siteId || !technicianId) {
      return c.json({ error: 'siteId and technicianId are required' }, 400)
    }

    if (auth.user.siteId && auth.user.role !== 'org_admin' && auth.user.role !== 'super_admin' && auth.user.siteId !== siteId) {
      return c.json({ error: 'Cannot add columns for a different site' }, 403)
    }

    const { data: technician, error: technicianError } = await supabaseAdmin
      .from('users')
      .select('id, role, site_id, is_active')
      .eq('organization_id', auth.orgId)
      .eq('id', technicianId)
      .maybeSingle()

    if (technicianError) {
      console.error('Create column technician lookup error:', {
        orgId: auth.orgId,
        siteId,
        technicianId,
        code: technicianError.code,
        message: technicianError.message,
        details: technicianError.details,
        hint: technicianError.hint,
      })
      return c.json({ error: `Technician lookup failed: ${technicianError.message}` }, 500)
    }

    if (!technician || technician.role !== 'technician' || !technician.is_active) {
      return c.json({ error: 'Technician not found' }, 404)
    }

    if (technician.site_id !== siteId) {
      return c.json({ error: 'Technician must belong to this site' }, 400)
    }

    let resolvedAvailableHours = availableHours

    if (resolvedAvailableHours === undefined) {
      const { data: config, error: configError } = await supabaseAdmin
        .from('tcard_board_config')
        .select('default_tech_hours')
        .eq('organization_id', auth.orgId)
        .eq('site_id', siteId)
        .maybeSingle()

      if (configError) {
        console.error('Create column config lookup error:', {
          orgId: auth.orgId,
          siteId,
          technicianId,
          code: configError.code,
          message: configError.message,
          details: configError.details,
          hint: configError.hint,
        })
        return c.json({ error: `Board config lookup failed: ${configError.message}` }, 500)
      }

      resolvedAvailableHours = config?.default_tech_hours ?? 8.0
    }

    // Get max sort order
    const { data: maxCol, error: maxColError } = await supabaseAdmin
      .from('tcard_columns')
      .select('sort_order')
      .eq('organization_id', auth.orgId)
      .eq('site_id', siteId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (maxColError) {
      console.error('Create column max-order lookup error:', {
        orgId: auth.orgId,
        siteId,
        technicianId,
        code: maxColError.code,
        message: maxColError.message,
        details: maxColError.details,
        hint: maxColError.hint,
      })
      return c.json({ error: `Column ordering lookup failed: ${maxColError.message}` }, 500)
    }

    const nextOrder = (maxCol?.sort_order ?? -1) + 1

    const { data: col, error } = await supabaseAdmin
      .from('tcard_columns')
      .insert({
        organization_id: auth.orgId,
        site_id: siteId,
        technician_id: technicianId,
        sort_order: nextOrder,
        available_hours: resolvedAvailableHours,
      })
      .select('id, technician_id, sort_order, available_hours, is_visible')
      .single()

    if (error) {
      console.error('Create column DB error:', { code: error.code, message: error.message, details: error.details, hint: error.hint })
      if (error.code === '23505') {
        return c.json({ error: 'Technician already has a column on this board' }, 409)
      }
      return c.json({ error: `Column insert failed: ${error.message}` }, 500)
    }

    // Fetch technician name separately
    const { data: tech, error: techError } = await supabaseAdmin
      .from('users')
      .select('id, first_name, last_name')
      .eq('organization_id', auth.orgId)
      .eq('id', technicianId)
      .single()

    if (techError) {
      console.error('Create column technician hydration error:', {
        orgId: auth.orgId,
        siteId,
        technicianId,
        columnId: col.id,
        code: techError.code,
        message: techError.message,
        details: techError.details,
        hint: techError.hint,
      })
      return c.json({ error: `Technician fetch after insert failed: ${techError.message}` }, 500)
    }

    // Emit socket event
    emitToSite(siteId, 'tcard:column_updated', { siteId, action: 'added' })

    return c.json({
      column: {
        id: col.id,
        technicianId: col.technician_id,
        technician: tech ? {
          id: tech.id,
          firstName: tech.first_name,
          lastName: tech.last_name,
        } : null,
        sortOrder: col.sort_order,
        availableHours: col.available_hours,
        isVisible: col.is_visible,
      }
    }, 201)
  } catch (error: any) {
    console.error('Create column CATCH error:', error?.message || error, error?.stack)
    return c.json({ error: error?.message || 'Failed to create column' }, 500)
  }
})

/**
 * PATCH /columns/reorder — Reorder columns (MUST be before /:id)
 */
columns.patch('/reorder', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { siteId, columnIds } = await c.req.json()

    if (!siteId || !Array.isArray(columnIds)) {
      return c.json({ error: 'siteId and columnIds array are required' }, 400)
    }

    const updates = columnIds.map((id: string, index: number) =>
      supabaseAdmin
        .from('tcard_columns')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('organization_id', auth.orgId)
    )

    await Promise.all(updates)

    emitToSite(siteId, 'tcard:column_updated', { siteId, action: 'reordered', columnIds })

    return c.json({ success: true })
  } catch (error) {
    console.error('Reorder columns error:', error)
    return c.json({ error: 'Failed to reorder columns' }, 500)
  }
})

/**
 * PATCH /columns/:id — Update column (hours, visibility)
 */
columns.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = await c.req.json()

    const updates: Record<string, unknown> = {}
    if (body.availableHours !== undefined) updates.available_hours = body.availableHours
    if (body.isVisible !== undefined) updates.is_visible = body.isVisible

    const { data: col, error } = await supabaseAdmin
      .from('tcard_columns')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select('id, site_id, technician_id, sort_order, available_hours, is_visible')
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    emitToSite(col.site_id, 'tcard:column_updated', { siteId: col.site_id, action: 'updated', column: col })

    return c.json({ column: col })
  } catch (error) {
    console.error('Update column error:', error)
    return c.json({ error: 'Failed to update column' }, 500)
  }
})

/**
 * DELETE /columns/:id — Remove column (cards return to Due In)
 */
columns.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const id = c.req.param('id')

    // Get column details first
    const { data: col } = await supabaseAdmin
      .from('tcard_columns')
      .select('id, site_id, technician_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!col) {
      return c.json({ error: 'Column not found' }, 404)
    }

    // Move cards assigned to this technician back to due_in
    await supabaseAdmin
      .from('tcard_assignments')
      .update({
        column_type: 'due_in',
        technician_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', auth.orgId)
      .eq('technician_id', col.technician_id)
      .eq('column_type', 'technician')

    // Delete the column
    const { error } = await supabaseAdmin
      .from('tcard_columns')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    emitToSite(col.site_id, 'tcard:column_updated', { siteId: col.site_id, action: 'removed', columnId: id })

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete column error:', error)
    return c.json({ error: 'Failed to delete column' }, 500)
  }
})

export default columns
