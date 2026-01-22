/**
 * Reason Types Management Routes
 *
 * Handles CRUD operations for reason types (system + org custom types).
 * Reason types allow sharing reasons across multiple template items.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { extractRelation, formatReasonTypeResponse } from './helpers.js'

const reasonTypes = new Hono()

// GET /api/v1/reason-types - List all reason types (system + org custom)
reasonTypes.get('/reason-types', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')

    // Get all reason types (system types + org custom types)
    const { data: types, error } = await supabaseAdmin
      .from('reason_types')
      .select('*')
      .or(`organization_id.is.null,organization_id.eq.${auth.orgId}`)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true })

    if (error) {
      console.error('Failed to fetch reason types:', error)
      return c.json({ error: error.message }, 500)
    }

    // Get item counts and reason counts for each type
    const typesWithCounts = await Promise.all(
      (types || []).map(async (rt) => {
        // Count items using this type (across all orgs for system types, or just this org)
        const { count: itemCount } = await supabaseAdmin
          .from('template_items')
          .select('*', { count: 'exact', head: true })
          .eq('reason_type', rt.id)

        // Count reasons for this type in the current org
        const { count: reasonCount } = await supabaseAdmin
          .from('item_reasons')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', auth.orgId)
          .eq('reason_type', rt.id)
          .eq('is_active', true)

        return formatReasonTypeResponse(rt, {
          itemCount: itemCount || 0,
          reasonCount: reasonCount || 0
        })
      })
    )

    return c.json({ reasonTypes: typesWithCounts })
  } catch (error) {
    console.error('Get reason types error:', error)
    return c.json({ error: 'Failed to get reason types' }, 500)
  }
})

// POST /api/v1/reason-types - Create a custom reason type
reasonTypes.post('/reason-types', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { name, description } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return c.json({ error: 'Name is required' }, 400)
    }

    // Generate slug from name (lowercase, underscores for spaces)
    const id = name.toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50)

    if (!id) {
      return c.json({ error: 'Invalid name - cannot generate valid ID' }, 400)
    }

    // Check if ID already exists (either as system type or for this org)
    const { data: existing } = await supabaseAdmin
      .from('reason_types')
      .select('id')
      .eq('id', id)
      .or(`organization_id.is.null,organization_id.eq.${auth.orgId}`)
      .single()

    if (existing) {
      return c.json({ error: 'A reason type with this name already exists' }, 409)
    }

    // Create the custom reason type
    const { data: reasonType, error } = await supabaseAdmin
      .from('reason_types')
      .insert({
        id,
        name: name.trim(),
        description: description?.trim() || null,
        organization_id: auth.orgId,
        is_system: false
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to create reason type:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json(formatReasonTypeResponse(reasonType, { itemCount: 0, reasonCount: 0 }), 201)
  } catch (error) {
    console.error('Create reason type error:', error)
    return c.json({ error: 'Failed to create reason type' }, 500)
  }
})

// GET /api/v1/reason-types/:id - Get a single reason type with items using it
reasonTypes.get('/reason-types/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get the reason type
    const { data: reasonType, error } = await supabaseAdmin
      .from('reason_types')
      .select('*')
      .eq('id', id)
      .or(`organization_id.is.null,organization_id.eq.${auth.orgId}`)
      .single()

    if (error || !reasonType) {
      return c.json({ error: 'Reason type not found' }, 404)
    }

    // Count items using this type
    const { count: itemCount } = await supabaseAdmin
      .from('template_items')
      .select('*', { count: 'exact', head: true })
      .eq('reason_type', id)

    // Count reasons for this type
    const { count: reasonCount } = await supabaseAdmin
      .from('item_reasons')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)
      .eq('reason_type', id)
      .eq('is_active', true)

    return c.json(formatReasonTypeResponse(reasonType, {
      itemCount: itemCount || 0,
      reasonCount: reasonCount || 0
    }))
  } catch (error) {
    console.error('Get reason type error:', error)
    return c.json({ error: 'Failed to get reason type' }, 500)
  }
})

// GET /api/v1/reason-types/:id/items - List items using this reason type
reasonTypes.get('/reason-types/:id/items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // First verify the reason type exists and is accessible
    const { data: reasonType } = await supabaseAdmin
      .from('reason_types')
      .select('id, name')
      .eq('id', id)
      .or(`organization_id.is.null,organization_id.eq.${auth.orgId}`)
      .single()

    if (!reasonType) {
      return c.json({ error: 'Reason type not found' }, 404)
    }

    // Get all template items using this reason type that belong to this org's templates
    const { data: items, error } = await supabaseAdmin
      .from('template_items')
      .select(`
        id,
        name,
        description,
        reason_type,
        section:template_sections!inner(
          id,
          name,
          template:check_templates!inner(
            id,
            name,
            organization_id
          )
        )
      `)
      .eq('reason_type', id)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Filter to items belonging to this org
    const orgItems = (items || []).filter(item => {
      const section = extractRelation(item.section)
      const template = section ? extractRelation((section as { template?: { organization_id?: string } }).template) : null
      return (template as { organization_id?: string })?.organization_id === auth.orgId
    }).map(item => {
      const section = extractRelation(item.section)
      const template = section ? extractRelation((section as { template?: { id?: string; name?: string } }).template) : null
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        sectionId: (section as { id?: string })?.id,
        sectionName: (section as { name?: string })?.name,
        templateId: (template as { id?: string })?.id,
        templateName: (template as { name?: string })?.name
      }
    })

    return c.json({
      reasonType: reasonType.name,
      items: orgItems,
      count: orgItems.length
    })
  } catch (error) {
    console.error('Get reason type items error:', error)
    return c.json({ error: 'Failed to get items' }, 500)
  }
})

// PATCH /api/v1/reason-types/:id - Update a custom reason type (name/description only)
reasonTypes.patch('/reason-types/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    // First get the reason type to check if it's editable
    const { data: existing } = await supabaseAdmin
      .from('reason_types')
      .select('*')
      .eq('id', id)
      .single()

    if (!existing) {
      return c.json({ error: 'Reason type not found' }, 404)
    }

    // System types can only be edited by super_admin
    if (existing.is_system && auth.user.role !== 'super_admin') {
      return c.json({ error: 'System reason types cannot be edited' }, 403)
    }

    // Custom types can only be edited by their org
    if (existing.organization_id && existing.organization_id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined && typeof body.name === 'string') {
      updateData.name = body.name.trim()
    }
    if (body.description !== undefined) {
      updateData.description = body.description?.trim() || null
    }

    if (Object.keys(updateData).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400)
    }

    const { data: reasonType, error } = await supabaseAdmin
      .from('reason_types')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: reasonType.id,
      name: reasonType.name,
      description: reasonType.description,
      organizationId: reasonType.organization_id,
      isSystem: reasonType.is_system,
      updatedAt: reasonType.updated_at
    })
  } catch (error) {
    console.error('Update reason type error:', error)
    return c.json({ error: 'Failed to update reason type' }, 500)
  }
})

// DELETE /api/v1/reason-types/:id - Delete a reason type (super admins can delete system types)
reasonTypes.delete('/reason-types/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const superAdmin = c.get('superAdmin') // Check for super admin context too
    const { id } = c.req.param()

    // Determine if this is a super admin (either via auth context or superAdmin context)
    const isSuperAdmin = auth?.user?.role === 'super_admin' || !!superAdmin

    // First get the reason type to check if it's deletable
    const { data: existing } = await supabaseAdmin
      .from('reason_types')
      .select('*')
      .eq('id', id)
      .single()

    if (!existing) {
      return c.json({ error: 'Reason type not found' }, 404)
    }

    // System types can only be deleted by super admins
    if (existing.is_system && !isSuperAdmin) {
      return c.json({ error: 'System reason types can only be deleted by super admins' }, 403)
    }

    // Custom types can only be deleted by their org (or super admin)
    if (existing.organization_id && existing.organization_id !== auth?.orgId && !isSuperAdmin) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Check if any items are using this type
    const { count: itemCount } = await supabaseAdmin
      .from('template_items')
      .select('*', { count: 'exact', head: true })
      .eq('reason_type', id)

    if (itemCount && itemCount > 0) {
      return c.json({
        error: `Cannot delete: ${itemCount} item(s) are using this reason type. Remove the type from all items first.`
      }, 409)
    }

    // Check if any reasons exist for this type
    const { count: reasonCount } = await supabaseAdmin
      .from('item_reasons')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)
      .eq('reason_type', id)
      .eq('is_active', true)

    if (reasonCount && reasonCount > 0) {
      return c.json({
        error: `Cannot delete: ${reasonCount} reason(s) exist for this type. Delete the reasons first.`
      }, 409)
    }

    // Delete the reason type
    let deleteQuery = supabaseAdmin
      .from('reason_types')
      .delete()
      .eq('id', id)

    // For system types (org_id is null), don't filter by org
    // For custom types, ensure it belongs to the org
    if (existing.organization_id) {
      deleteQuery = deleteQuery.eq('organization_id', existing.organization_id)
    } else {
      deleteQuery = deleteQuery.is('organization_id', null)
    }

    const { error } = await deleteQuery

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true, deletedId: id, wasSystem: existing.is_system })
  } catch (error) {
    console.error('Delete reason type error:', error)
    return c.json({ error: 'Failed to delete reason type' }, 500)
  }
})

export default reasonTypes
