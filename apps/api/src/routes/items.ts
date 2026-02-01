import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const items = new Hono()

items.use('*', authMiddleware)

// GET /api/v1/template-items/search?q=<term>&all=1 - Search existing items across org templates
items.get('/template-items/search', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const q = c.req.query('q')?.trim() || ''
    const showAll = c.req.query('all') === '1'

    if (!showAll && q.length < 2) {
      return c.json({ items: [] })
    }

    let query = supabaseAdmin
      .from('template_items')
      .select(`
        id,
        name,
        item_type,
        reason_type,
        config,
        is_required,
        description,
        section:template_sections(
          template:check_templates(
            name,
            organization_id
          )
        )
      `)

    if (q.length >= 2) {
      query = query.ilike('name', `%${q}%`)
    }

    const { data: results, error } = await query
      .order('name', { ascending: true })
      .limit(showAll ? 500 : 50)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Filter to this org and deduplicate by lowercase name
    const seen = new Set<string>()
    const itemList: Array<{
      sourceItemId: string
      name: string
      itemType: string
      reasonType: string | null
      config: Record<string, unknown>
      isRequired: boolean
      description: string | null
      sourceTemplateName: string | null
    }> = []

    for (const row of results || []) {
      const sectionRaw = row.section
      const section = Array.isArray(sectionRaw) ? sectionRaw[0] : sectionRaw
      const templateRaw = (section as { template: unknown })?.template
      const template = Array.isArray(templateRaw) ? templateRaw[0] : templateRaw
      const orgId = (template as { organization_id: string })?.organization_id
      const templateName = (template as { name: string })?.name || null

      if (orgId !== auth.orgId) continue

      const key = row.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      itemList.push({
        sourceItemId: row.id,
        name: row.name,
        itemType: row.item_type,
        reasonType: row.reason_type,
        config: row.config as Record<string, unknown>,
        isRequired: row.is_required,
        description: row.description,
        sourceTemplateName: templateName
      })
    }

    // Sort alphabetically
    itemList.sort((a, b) => a.name.localeCompare(b.name))

    return c.json({ items: itemList })
  } catch (error) {
    console.error('Search template items error:', error)
    return c.json({ error: 'Failed to search template items' }, 500)
  }
})

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
        requires_location,
        exclude_from_ai,
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
    // Handle Supabase nested relation - can be array or single object
    const sectionRaw = item.section
    const section = Array.isArray(sectionRaw) ? sectionRaw[0] : sectionRaw
    const templateRaw = (section as { template: unknown })?.template
    const template = Array.isArray(templateRaw) ? templateRaw[0] : templateRaw
    if (!template || (template as { organization_id: string }).organization_id !== auth.orgId) {
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
      requiresLocation: item.requires_location,
      excludeFromAi: item.exclude_from_ai,
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
    const { name, description, itemType, config, isRequired, reasonType, sourceItemId, requiresLocation, excludeFromAi } = body

    if (!name) {
      return c.json({ error: 'Item name is required' }, 400)
    }

    // Verify section belongs to a template in this org
    const { data: section } = await supabaseAdmin
      .from('template_sections')
      .select('id, template:check_templates(organization_id)')
      .eq('id', sectionId)
      .single()

    // Handle Supabase nested relation - can be array or single object
    const templateRaw = section?.template
    const sectionTemplate = Array.isArray(templateRaw) ? templateRaw[0] : templateRaw
    if (!section || (sectionTemplate as { organization_id: string })?.organization_id !== auth.orgId) {
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
        is_required: isRequired ?? false,
        requires_location: requiresLocation ?? false,
        exclude_from_ai: excludeFromAi ?? false,
        sort_order: sortOrder,
        reason_type: reasonType || null
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Copy item-specific reasons from source item (only for items without a reason_type)
    if (sourceItemId && !reasonType) {
      const { data: sourceReasons } = await supabaseAdmin
        .from('item_reasons')
        .select('*')
        .eq('template_item_id', sourceItemId)
        .eq('organization_id', auth.orgId)

      if (sourceReasons && sourceReasons.length > 0) {
        const reasonCopies = sourceReasons.map((r: Record<string, unknown>) => ({
          organization_id: auth.orgId,
          template_item_id: item.id,
          reason_text: r.reason_text,
          technical_description: r.technical_description,
          customer_description: r.customer_description,
          default_rag: r.default_rag,
          category_id: r.category_id,
          suggested_follow_up_days: r.suggested_follow_up_days,
          suggested_follow_up_text: r.suggested_follow_up_text,
          is_active: r.is_active,
          sort_order: r.sort_order,
          ai_generated: r.ai_generated,
          ai_reviewed: r.ai_reviewed
        }))

        await supabaseAdmin
          .from('item_reasons')
          .insert(reasonCopies)
      }
    }

    return c.json({
      id: item.id,
      name: item.name,
      description: item.description,
      itemType: item.item_type,
      config: item.config,
      isRequired: item.is_required,
      requiresLocation: item.requires_location,
      excludeFromAi: item.exclude_from_ai,
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
    const { name, description, itemType, config, isRequired, reasonType, requiresLocation, excludeFromAi } = body

    // Verify item belongs to a template in this org
    const { data: existingItem } = await supabaseAdmin
      .from('template_items')
      .select('id, section:template_sections(template:check_templates(organization_id))')
      .eq('id', itemId)
      .single()

    if (!existingItem) {
      return c.json({ error: 'Item not found' }, 404)
    }

    // Handle Supabase nested relation - can be array or single object
    const sectionRaw = existingItem.section
    const existingSection = Array.isArray(sectionRaw) ? sectionRaw[0] : sectionRaw
    const templateRaw = (existingSection as { template: unknown })?.template
    const existingTemplate = Array.isArray(templateRaw) ? templateRaw[0] : templateRaw
    if ((existingTemplate as { organization_id: string })?.organization_id !== auth.orgId) {
      return c.json({ error: 'Item not found' }, 404)
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (itemType !== undefined) updateData.item_type = itemType
    if (config !== undefined) updateData.config = config
    if (isRequired !== undefined) updateData.is_required = isRequired
    if (requiresLocation !== undefined) updateData.requires_location = requiresLocation
    if (excludeFromAi !== undefined) updateData.exclude_from_ai = excludeFromAi
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
      requiresLocation: item.requires_location,
      excludeFromAi: item.exclude_from_ai,
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

    // Handle Supabase nested relation - can be array or single object
    const sectionRaw = existingItem.section
    const deleteSection = Array.isArray(sectionRaw) ? sectionRaw[0] : sectionRaw
    const templateRaw = (deleteSection as { template: unknown })?.template
    const deleteTemplate = Array.isArray(templateRaw) ? templateRaw[0] : templateRaw
    if ((deleteTemplate as { organization_id: string })?.organization_id !== auth.orgId) {
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

    // Handle Supabase nested relation - can be array or single object
    const templateRaw = section?.template
    const reorderTemplate = Array.isArray(templateRaw) ? templateRaw[0] : templateRaw
    if (!section || (reorderTemplate as { organization_id: string })?.organization_id !== auth.orgId) {
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
