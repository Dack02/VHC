import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const templates = new Hono()

templates.use('*', authMiddleware)

// GET /api/v1/templates - List templates
templates.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id, is_active } = c.req.query()

    let query = supabaseAdmin
      .from('check_templates')
      .select('*', { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .order('name', { ascending: true })

    if (site_id) {
      query = query.or(`site_id.eq.${site_id},site_id.is.null`)
    }

    if (is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true')
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      templates: data?.map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
                isActive: template.is_active,
        isDefault: template.is_default,
        createdAt: template.created_at,
        updatedAt: template.updated_at
      })),
      total: count
    })
  } catch (error) {
    console.error('List templates error:', error)
    return c.json({ error: 'Failed to list templates' }, 500)
  }
})

// POST /api/v1/templates - Create template
templates.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { name, description, siteId, isDefault } = body

    if (!name) {
      return c.json({ error: 'Template name is required' }, 400)
    }

    const { data: template, error } = await supabaseAdmin
      .from('check_templates')
      .insert({
        organization_id: auth.orgId,
        site_id: siteId,
        name,
        description,
        is_default: isDefault || false,
        is_active: true
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: template.id,
      name: template.name,
      description: template.description,
            isActive: template.is_active,
      isDefault: template.is_default,
      createdAt: template.created_at
    }, 201)
  } catch (error) {
    console.error('Create template error:', error)
    return c.json({ error: 'Failed to create template' }, 500)
  }
})

// GET /api/v1/templates/:id - Get template with sections and items
templates.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: template, error } = await supabaseAdmin
      .from('check_templates')
      .select(`
        *,
        sections:template_sections(
          *,
          items:template_items(*)
        )
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    // Sort sections and items by sort_order
    const sortedSections = (template.sections || [])
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.sort_order as number) - (b.sort_order as number))
      .map((section: Record<string, unknown>) => ({
        id: section.id,
        name: section.name,
        description: section.description,
        sortOrder: section.sort_order,
        items: ((section.items as Record<string, unknown>[]) || [])
          .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.sort_order as number) - (b.sort_order as number))
          .map((item: Record<string, unknown>) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            itemType: item.item_type,
            config: item.config,
            isRequired: item.is_required,
            requiresLocation: item.requires_location,
            sortOrder: item.sort_order,
            reasonType: item.reason_type
          }))
      }))

    return c.json({
      id: template.id,
      name: template.name,
      description: template.description,
            isActive: template.is_active,
      isDefault: template.is_default,
      sections: sortedSections,
      createdAt: template.created_at,
      updatedAt: template.updated_at
    })
  } catch (error) {
    console.error('Get template error:', error)
    return c.json({ error: 'Failed to get template' }, 500)
  }
})

// PATCH /api/v1/templates/:id - Update template
templates.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, description, isActive, isDefault } = body

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (isActive !== undefined) updateData.is_active = isActive
    if (isDefault !== undefined) updateData.is_default = isDefault

    const { data: template, error } = await supabaseAdmin
      .from('check_templates')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: template.id,
      name: template.name,
      description: template.description,
            isActive: template.is_active,
      isDefault: template.is_default,
      updatedAt: template.updated_at
    })
  } catch (error) {
    console.error('Update template error:', error)
    return c.json({ error: 'Failed to update template' }, 500)
  }
})

// DELETE /api/v1/templates/:id - Delete template (soft by default, hard with ?hard=true)
templates.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const hard = c.req.query('hard') === 'true'

    if (hard) {
      // Check if any health checks reference this template
      const { count } = await supabaseAdmin
        .from('health_checks')
        .select('id', { count: 'exact', head: true })
        .eq('template_id', id)

      if (count && count > 0) {
        return c.json({ error: `Cannot hard delete: ${count} health check(s) reference this template. Use soft delete instead.` }, 409)
      }

      // Hard delete — cascades to sections → items → reasons
      const { error } = await supabaseAdmin
        .from('check_templates')
        .delete()
        .eq('id', id)
        .eq('organization_id', auth.orgId)

      if (error) {
        return c.json({ error: error.message }, 500)
      }

      return c.json({ message: 'Template permanently deleted' })
    }

    // Soft delete (existing behavior)
    const { error } = await supabaseAdmin
      .from('check_templates')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ message: 'Template deactivated' })
  } catch (error) {
    console.error('Delete template error:', error)
    return c.json({ error: 'Failed to delete template' }, 500)
  }
})

// POST /api/v1/templates/:id/duplicate - Clone template
templates.post('/:id/duplicate', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name } = body

    // Get original template with sections and items
    const { data: original, error: fetchError } = await supabaseAdmin
      .from('check_templates')
      .select(`
        *,
        sections:template_sections(
          *,
          items:template_items(*)
        )
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !original) {
      return c.json({ error: 'Template not found' }, 404)
    }

    // Create new template
    const { data: newTemplate, error: createError } = await supabaseAdmin
      .from('check_templates')
      .insert({
        organization_id: auth.orgId,
        site_id: original.site_id,
        name: name || `${original.name} (Copy)`,
        description: original.description,
        is_default: false,
        is_active: true
      })
      .select()
      .single()

    if (createError) {
      return c.json({ error: createError.message }, 500)
    }

    // Clone sections
    for (const section of original.sections || []) {
      const { data: newSection, error: sectionError } = await supabaseAdmin
        .from('template_sections')
        .insert({
          template_id: newTemplate.id,
          name: section.name,
          description: section.description,
          sort_order: section.sort_order
        })
        .select()
        .single()

      if (sectionError) continue

      // Clone items for this section
      const items = section.items || []
      for (const item of items) {
        await supabaseAdmin
          .from('template_items')
          .insert({
            section_id: newSection.id,
            name: item.name,
            description: item.description,
            item_type: item.item_type,
            config: item.config,
            is_required: item.is_required,
            requires_location: item.requires_location,
            sort_order: item.sort_order,
            reason_type: item.reason_type
          })
      }
    }

    return c.json({
      id: newTemplate.id,
      name: newTemplate.name,
      description: newTemplate.description,
      isActive: newTemplate.is_active,
      isDefault: newTemplate.is_default,
      createdAt: newTemplate.created_at
    }, 201)
  } catch (error) {
    console.error('Duplicate template error:', error)
    return c.json({ error: 'Failed to duplicate template' }, 500)
  }
})

// POST /api/v1/templates/:id/sections - Add section
templates.post('/:id/sections', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, description } = body

    if (!name) {
      return c.json({ error: 'Section name is required' }, 400)
    }

    // Verify template belongs to org
    const { data: template } = await supabaseAdmin
      .from('check_templates')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    // Get max sort order
    const { data: maxOrderResult } = await supabaseAdmin
      .from('template_sections')
      .select('sort_order')
      .eq('template_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const sortOrder = (maxOrderResult?.sort_order || 0) + 1

    const { data: section, error } = await supabaseAdmin
      .from('template_sections')
      .insert({
        template_id: id,
        name,
        description,
        sort_order: sortOrder
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: section.id,
      name: section.name,
      description: section.description,
      sortOrder: section.sort_order
    }, 201)
  } catch (error) {
    console.error('Add section error:', error)
    return c.json({ error: 'Failed to add section' }, 500)
  }
})

// PATCH /api/v1/templates/:templateId/sections/:sectionId - Update section
templates.patch('/:templateId/sections/:sectionId', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { templateId, sectionId } = c.req.param()
    const body = await c.req.json()
    const { name, description } = body

    // Verify template belongs to org
    const { data: template } = await supabaseAdmin
      .from('check_templates')
      .select('id')
      .eq('id', templateId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description

    const { data: section, error } = await supabaseAdmin
      .from('template_sections')
      .update(updateData)
      .eq('id', sectionId)
      .eq('template_id', templateId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: section.id,
      name: section.name,
      description: section.description,
      sortOrder: section.sort_order
    })
  } catch (error) {
    console.error('Update section error:', error)
    return c.json({ error: 'Failed to update section' }, 500)
  }
})

// DELETE /api/v1/templates/:templateId/sections/:sectionId - Delete section
templates.delete('/:templateId/sections/:sectionId', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { templateId, sectionId } = c.req.param()

    // Verify template belongs to org
    const { data: template } = await supabaseAdmin
      .from('check_templates')
      .select('id')
      .eq('id', templateId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('template_sections')
      .delete()
      .eq('id', sectionId)
      .eq('template_id', templateId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ message: 'Section deleted' })
  } catch (error) {
    console.error('Delete section error:', error)
    return c.json({ error: 'Failed to delete section' }, 500)
  }
})

// POST /api/v1/templates/:id/sections/reorder - Reorder sections
templates.post('/:id/sections/reorder', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { sectionIds } = body

    if (!sectionIds || !Array.isArray(sectionIds)) {
      return c.json({ error: 'sectionIds array is required' }, 400)
    }

    // Verify template belongs to org
    const { data: template } = await supabaseAdmin
      .from('check_templates')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    // Update sort orders
    for (let i = 0; i < sectionIds.length; i++) {
      await supabaseAdmin
        .from('template_sections')
        .update({ sort_order: i + 1 })
        .eq('id', sectionIds[i])
        .eq('template_id', id)
    }

    return c.json({ message: 'Sections reordered' })
  } catch (error) {
    console.error('Reorder sections error:', error)
    return c.json({ error: 'Failed to reorder sections' }, 500)
  }
})

export default templates
