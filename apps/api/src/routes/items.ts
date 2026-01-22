import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const items = new Hono()

items.use('*', authMiddleware)

// GET /api/v1/template-items/:id - Get single template item
items.get('/template-items/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Fetch the template item with its section and template to verify org ownership
    const { data: item, error } = await supabaseAdmin
      .from('template_items')
      .select(`
        id,
        name,
        description,
        item_type,
        reason_type,
        config,
        is_required,
        sort_order,
        section:template_sections(
          id,
          name,
          template:check_templates(
            id,
            name,
            organization_id
          )
        )
      `)
      .eq('id', id)
      .single()

    if (error || !item) {
      return c.json({ error: 'Template item not found' }, 404)
    }

    // Verify the item belongs to the user's organization
    const section = (item.section as { template: { organization_id: string }[] }[] | null)?.[0]
    const template = section?.template?.[0]
    if (!template || template.organization_id !== auth.orgId) {
      return c.json({ error: 'Template item not found' }, 404)
    }

    return c.json({
      id: item.id,
      name: item.name,
      description: item.description,
      itemType: item.item_type,
      reasonType: item.reason_type,
      config: item.config,
      isRequired: item.is_required,
      sortOrder: item.sort_order
    })
  } catch (error) {
    console.error('Get template item error:', error)
    return c.json({ error: 'Failed to get template item' }, 500)
  }
})

// POST /api/v1/sections/:sectionId/items - Add item to section
items.post('/sections/:sectionId/items', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { sectionId } = c.req.param()
    const body = await c.req.json()
    const { name, description, itemType, config, isRequired, reasonType } = body

    if (!name) {
      return c.json({ error: 'Item name is required' }, 400)
    }

    // Verify section belongs to a template in this org
    const { data: section } = await supabaseAdmin
      .from('template_sections')
      .select('id, template:check_templates(organization_id)')
      .eq('id', sectionId)
      .single()

    const sectionTemplate = (section?.template as { organization_id: string }[] | null)?.[0]
    if (!section || sectionTemplate?.organization_id !== auth.orgId) {
      return c.json({ error: 'Section not found' }, 404)
    }

    // Get max sort order
    const { data: maxOrderResult } = await supabaseAdmin
      .from('template_items')
      .select('sort_order')
      .eq('section_id', sectionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const sortOrder = (maxOrderResult?.sort_order || 0) + 1

    const { data: item, error } = await supabaseAdmin
      .from('template_items')
      .insert({
        section_id: sectionId,
        name,
        description,
        item_type: itemType || 'rag',
        config: config || {},
        is_required: isRequired ?? true,
        sort_order: sortOrder,
        reason_type: reasonType || null
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: item.id,
      name: item.name,
      description: item.description,
      itemType: item.item_type,
      config: item.config,
      isRequired: item.is_required,
      sortOrder: item.sort_order,
      reasonType: item.reason_type
    }, 201)
  } catch (error) {
    console.error('Add item error:', error)
    return c.json({ error: 'Failed to add item' }, 500)
  }
})

// PATCH /api/v1/items/:itemId - Update item
items.patch('/items/:itemId', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { itemId } = c.req.param()
    const body = await c.req.json()
    const { name, description, itemType, config, isRequired, reasonType } = body

    // Verify item belongs to a template in this org
    const { data: existingItem } = await supabaseAdmin
      .from('template_items')
      .select('id, section:template_sections(template:check_templates(organization_id))')
      .eq('id', itemId)
      .single()

    if (!existingItem) {
      return c.json({ error: 'Item not found' }, 404)
    }

    const existingSection = (existingItem.section as { template: { organization_id: string }[] }[] | null)?.[0]
    const existingTemplate = existingSection?.template?.[0]
    if (existingTemplate?.organization_id !== auth.orgId) {
      return c.json({ error: 'Item not found' }, 404)
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (itemType !== undefined) updateData.item_type = itemType
    if (config !== undefined) updateData.config = config
    if (isRequired !== undefined) updateData.is_required = isRequired
    if (reasonType !== undefined) updateData.reason_type = reasonType || null

    const { data: item, error } = await supabaseAdmin
      .from('template_items')
      .update(updateData)
      .eq('id', itemId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: item.id,
      name: item.name,
      description: item.description,
      itemType: item.item_type,
      config: item.config,
      isRequired: item.is_required,
      sortOrder: item.sort_order,
      reasonType: item.reason_type
    })
  } catch (error) {
    console.error('Update item error:', error)
    return c.json({ error: 'Failed to update item' }, 500)
  }
})

// DELETE /api/v1/items/:itemId - Delete item
items.delete('/items/:itemId', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { itemId } = c.req.param()

    // Verify item belongs to a template in this org
    const { data: existingItem } = await supabaseAdmin
      .from('template_items')
      .select('id, section:template_sections(template:check_templates(organization_id))')
      .eq('id', itemId)
      .single()

    if (!existingItem) {
      return c.json({ error: 'Item not found' }, 404)
    }

    const deleteSection = (existingItem.section as { template: { organization_id: string }[] }[] | null)?.[0]
    const deleteTemplate = deleteSection?.template?.[0]
    if (deleteTemplate?.organization_id !== auth.orgId) {
      return c.json({ error: 'Item not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('template_items')
      .delete()
      .eq('id', itemId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ message: 'Item deleted' })
  } catch (error) {
    console.error('Delete item error:', error)
    return c.json({ error: 'Failed to delete item' }, 500)
  }
})

// POST /api/v1/sections/:sectionId/items/reorder - Reorder items
items.post('/sections/:sectionId/items/reorder', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { sectionId } = c.req.param()
    const body = await c.req.json()
    const { itemIds } = body

    if (!itemIds || !Array.isArray(itemIds)) {
      return c.json({ error: 'itemIds array is required' }, 400)
    }

    // Verify section belongs to a template in this org
    const { data: section } = await supabaseAdmin
      .from('template_sections')
      .select('id, template:check_templates(organization_id)')
      .eq('id', sectionId)
      .single()

    const reorderTemplate = (section?.template as { organization_id: string }[] | null)?.[0]
    if (!section || reorderTemplate?.organization_id !== auth.orgId) {
      return c.json({ error: 'Section not found' }, 404)
    }

    // Update sort orders
    for (let i = 0; i < itemIds.length; i++) {
      await supabaseAdmin
        .from('template_items')
        .update({ sort_order: i + 1 })
        .eq('id', itemIds[i])
        .eq('section_id', sectionId)
    }

    return c.json({ message: 'Items reordered' })
  } catch (error) {
    console.error('Reorder items error:', error)
    return c.json({ error: 'Failed to reorder items' }, 500)
  }
})

export default items
