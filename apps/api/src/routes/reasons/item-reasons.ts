/**
 * Item Reasons Routes
 *
 * Core CRUD operations for item reasons, including:
 * - Reasons by template item
 * - Reasons by reason type
 * - Individual reason CRUD
 * - Mark reviewed, reorder
 * - Recently used reasons
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import {
  formatReasonResponse,
  formatReasonDetailResponse,
  extractRelation,
  sortReasonsByRagAndUsage
} from './helpers.js'

const itemReasons = new Hono()

// =============================================================================
// ITEM REASONS - BY TEMPLATE ITEM
// =============================================================================

// GET /api/v1/template-items/:id/reasons - Get reasons for a template item
itemReasons.get('/template-items/:id/reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { rag } = c.req.query()

    console.log('[template-items/:id/reasons] Fetching for itemId:', id, 'orgId:', auth.orgId)

    // Get template item to check reason_type
    const { data: templateItem } = await supabaseAdmin
      .from('template_items')
      .select('id, name, reason_type')
      .eq('id', id)
      .single()

    if (!templateItem) {
      return c.json({ error: 'Template item not found' }, 404)
    }

    console.log('[template-items/:id/reasons] Item:', templateItem.name, 'reason_type:', templateItem.reason_type)

    // Query reasons directly - first by template_item_id, then by reason_type
    // This is more reliable than the RPC function which may not exist
    let allReasons: Record<string, unknown>[] = []

    // Get item-specific reasons
    const { data: specificReasons, error: specificError } = await supabaseAdmin
      .from('item_reasons')
      .select(`
        *,
        category:reason_categories(id, name, color)
      `)
      .eq('organization_id', auth.orgId)
      .eq('template_item_id', id)
      .eq('is_active', true)

    if (specificError) {
      console.error('[template-items/:id/reasons] Error fetching specific reasons:', specificError)
    } else {
      console.log('[template-items/:id/reasons] Found', specificReasons?.length || 0, 'item-specific reasons')
      allReasons = (specificReasons || []).map(r => ({ ...r, source: 'specific' }))
    }

    // Get type-based reasons if the item has a reason_type
    if (templateItem.reason_type) {
      const { data: typeReasons, error: typeError } = await supabaseAdmin
        .from('item_reasons')
        .select(`
          *,
          category:reason_categories(id, name, color)
        `)
        .eq('organization_id', auth.orgId)
        .eq('reason_type', templateItem.reason_type)
        .eq('is_active', true)

      if (typeError) {
        console.error('[template-items/:id/reasons] Error fetching type reasons:', typeError)
      } else {
        console.log('[template-items/:id/reasons] Found', typeReasons?.length || 0, 'type-based reasons')
        // Add type reasons that don't conflict with specific reasons
        const specificTexts = new Set(allReasons.map(r => r.reason_text))
        const newTypeReasons = (typeReasons || [])
          .filter(r => !specificTexts.has(r.reason_text))
          .map(r => ({ ...r, source: 'type' }))
        allReasons = [...allReasons, ...newTypeReasons]
      }
    }

    // Filter by RAG if specified
    let filteredReasons = allReasons
    if (rag) {
      filteredReasons = filteredReasons.filter((r) => r.default_rag === rag)
    }

    // Sort: red first, then amber, then green; then by usage_count desc
    filteredReasons = sortReasonsByRagAndUsage(filteredReasons as { default_rag?: string; usage_count?: number | null }[])

    // Get categories for the response
    const { data: categories } = await supabaseAdmin
      .from('reason_categories')
      .select('*')
      .order('display_order', { ascending: true })

    // Determine reason source
    const hasSpecific = filteredReasons.some((r) => r.source === 'specific')
    const hasType = filteredReasons.some((r) => r.source === 'type')
    const reasonSource = hasSpecific && hasType ? 'mixed' : hasSpecific ? 'specific' : 'type'

    console.log('[template-items/:id/reasons] Returning', filteredReasons.length, 'total reasons')

    return c.json({
      reasons: filteredReasons.map((r) => formatReasonResponse(r as Parameters<typeof formatReasonResponse>[0])),
      categories: categories?.map(cat => ({
        id: cat.id,
        name: cat.name,
        color: cat.color,
        typicalRag: cat.typical_rag
      })),
      reasonType: templateItem.reason_type,
      reasonSource
    })
  } catch (error) {
    console.error('Get reasons for item error:', error)
    return c.json({ error: 'Failed to get reasons' }, 500)
  }
})

// POST /api/v1/template-items/:id/reasons - Create reason for specific item
itemReasons.post('/template-items/:id/reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const {
      reasonText,
      technicalDescription,
      customerDescription,
      defaultRag,
      categoryId,
      suggestedFollowUpDays,
      suggestedFollowUpText
    } = body

    if (!reasonText) {
      return c.json({ error: 'Reason text is required' }, 400)
    }

    // Verify template item exists
    const { data: templateItem } = await supabaseAdmin
      .from('template_items')
      .select('id')
      .eq('id', id)
      .single()

    if (!templateItem) {
      return c.json({ error: 'Template item not found' }, 404)
    }

    const { data: reason, error } = await supabaseAdmin
      .from('item_reasons')
      .insert({
        organization_id: auth.orgId,
        template_item_id: id,
        reason_text: reasonText,
        technical_description: technicalDescription,
        customer_description: customerDescription,
        default_rag: defaultRag || 'amber',
        category_id: categoryId,
        suggested_follow_up_days: suggestedFollowUpDays,
        suggested_follow_up_text: suggestedFollowUpText,
        created_by: auth.user.id
      })
      .select(`
        *,
        category:reason_categories(id, name, color)
      `)
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'This reason already exists for this item' }, 409)
      }
      return c.json({ error: error.message }, 500)
    }

    const category = extractRelation(reason.category)
    return c.json({
      id: reason.id,
      reasonText: reason.reason_text,
      technicalDescription: reason.technical_description,
      customerDescription: reason.customer_description,
      defaultRag: reason.default_rag,
      categoryId: reason.category_id,
      categoryName: (category as { name?: string })?.name,
      categoryColor: (category as { color?: string })?.color,
      suggestedFollowUpDays: reason.suggested_follow_up_days,
      suggestedFollowUpText: reason.suggested_follow_up_text,
      createdAt: reason.created_at
    }, 201)
  } catch (error) {
    console.error('Create reason error:', error)
    return c.json({ error: 'Failed to create reason' }, 500)
  }
})

// =============================================================================
// ITEM REASONS - BY REASON TYPE
// =============================================================================

// GET /api/v1/reasons/by-type/:reasonType - Get reasons by reason type
itemReasons.get('/reasons/by-type/:reasonType', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { reasonType } = c.req.param()

    console.log('[reasons/by-type] Querying for orgId:', auth.orgId, 'reasonType:', reasonType)

    // First, get all template_item IDs that have this reason_type
    const { data: itemsWithType } = await supabaseAdmin
      .from('template_items')
      .select('id')
      .eq('reason_type', reasonType)

    const itemIds = itemsWithType?.map(i => i.id) || []
    console.log('[reasons/by-type] Found', itemIds.length, 'items with this reason_type')

    // Query reasons by EITHER reason_type OR template_item_id
    // This handles both cases: reasons stored by type AND reasons stored by item
    let allReasons: Record<string, unknown>[] = []

    // Get reasons by reason_type
    const { data: typeReasons, error: typeError } = await supabaseAdmin
      .from('item_reasons')
      .select(`
        *,
        category:reason_categories(id, name, color)
      `)
      .eq('organization_id', auth.orgId)
      .eq('reason_type', reasonType)
      .eq('is_active', true)

    if (typeError) {
      console.error('[reasons/by-type] Error fetching type reasons:', typeError)
    } else {
      console.log('[reasons/by-type] Found', typeReasons?.length || 0, 'reasons by reason_type')
      allReasons = typeReasons || []
    }

    // Get reasons by template_item_id (for items that have this reason_type)
    if (itemIds.length > 0) {
      const { data: itemReasons, error: itemError } = await supabaseAdmin
        .from('item_reasons')
        .select(`
          *,
          category:reason_categories(id, name, color)
        `)
        .eq('organization_id', auth.orgId)
        .in('template_item_id', itemIds)
        .eq('is_active', true)

      if (itemError) {
        console.error('[reasons/by-type] Error fetching item reasons:', itemError)
      } else {
        console.log('[reasons/by-type] Found', itemReasons?.length || 0, 'reasons by template_item_id')
        // Add only new reasons (avoid duplicates)
        const existingIds = new Set(allReasons.map(r => r.id))
        for (const r of itemReasons || []) {
          if (!existingIds.has(r.id)) {
            allReasons.push(r)
          }
        }
      }
    }

    // Sort: red first, then by usage
    allReasons = sortReasonsByRagAndUsage(allReasons as { default_rag?: string; usage_count?: number | null }[])

    console.log('[reasons/by-type] Returning', allReasons.length, 'total reasons')

    return c.json({
      reasons: allReasons.map(r => formatReasonResponse(r as Parameters<typeof formatReasonResponse>[0]))
    })
  } catch (error) {
    console.error('Get reasons by type error:', error)
    return c.json({ error: 'Failed to get reasons' }, 500)
  }
})

// POST /api/v1/reasons/by-type/:reasonType - Create reason for reason type
itemReasons.post('/reasons/by-type/:reasonType', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { reasonType } = c.req.param()
    const body = await c.req.json()
    const {
      reasonText,
      technicalDescription,
      customerDescription,
      defaultRag,
      categoryId,
      suggestedFollowUpDays,
      suggestedFollowUpText
    } = body

    if (!reasonText) {
      return c.json({ error: 'Reason text is required' }, 400)
    }

    const { data: reason, error } = await supabaseAdmin
      .from('item_reasons')
      .insert({
        organization_id: auth.orgId,
        reason_type: reasonType,
        reason_text: reasonText,
        technical_description: technicalDescription,
        customer_description: customerDescription,
        default_rag: defaultRag || 'amber',
        category_id: categoryId,
        suggested_follow_up_days: suggestedFollowUpDays,
        suggested_follow_up_text: suggestedFollowUpText,
        created_by: auth.user.id
      })
      .select(`
        *,
        category:reason_categories(id, name, color)
      `)
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'This reason already exists for this type' }, 409)
      }
      return c.json({ error: error.message }, 500)
    }

    const category = extractRelation(reason.category)
    return c.json({
      id: reason.id,
      reasonType: reason.reason_type,
      reasonText: reason.reason_text,
      technicalDescription: reason.technical_description,
      customerDescription: reason.customer_description,
      defaultRag: reason.default_rag,
      categoryId: reason.category_id,
      categoryName: (category as { name?: string })?.name,
      categoryColor: (category as { color?: string })?.color,
      suggestedFollowUpDays: reason.suggested_follow_up_days,
      suggestedFollowUpText: reason.suggested_follow_up_text,
      createdAt: reason.created_at
    }, 201)
  } catch (error) {
    console.error('Create reason by type error:', error)
    return c.json({ error: 'Failed to create reason' }, 500)
  }
})

// =============================================================================
// ITEM REASONS - CRUD
// =============================================================================

// GET /api/v1/item-reasons/:id - Get a single reason
itemReasons.get('/item-reasons/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: reason, error } = await supabaseAdmin
      .from('item_reasons')
      .select(`
        *,
        category:reason_categories(id, name, color),
        created_by_user:users!item_reasons_created_by_fkey(first_name, last_name),
        reviewed_by_user:users!item_reasons_reviewed_by_fkey(first_name, last_name)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !reason) {
      return c.json({ error: 'Reason not found' }, 404)
    }

    return c.json(formatReasonDetailResponse(reason))
  } catch (error) {
    console.error('Get reason error:', error)
    return c.json({ error: 'Failed to get reason' }, 500)
  }
})

// PATCH /api/v1/item-reasons/:id - Update reason
itemReasons.patch('/item-reasons/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const updateData: Record<string, unknown> = {}

    if (body.reasonText !== undefined) updateData.reason_text = body.reasonText
    if (body.technicalDescription !== undefined) updateData.technical_description = body.technicalDescription
    if (body.customerDescription !== undefined) updateData.customer_description = body.customerDescription
    if (body.defaultRag !== undefined) updateData.default_rag = body.defaultRag
    if (body.categoryId !== undefined) updateData.category_id = body.categoryId
    if (body.suggestedFollowUpDays !== undefined) updateData.suggested_follow_up_days = body.suggestedFollowUpDays
    if (body.suggestedFollowUpText !== undefined) updateData.suggested_follow_up_text = body.suggestedFollowUpText
    if (body.isActive !== undefined) updateData.is_active = body.isActive
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder

    const { data: reason, error } = await supabaseAdmin
      .from('item_reasons')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select(`
        *,
        category:reason_categories(id, name, color)
      `)
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    if (!reason) {
      return c.json({ error: 'Reason not found' }, 404)
    }

    const category = extractRelation(reason.category)
    return c.json({
      id: reason.id,
      reasonText: reason.reason_text,
      technicalDescription: reason.technical_description,
      customerDescription: reason.customer_description,
      defaultRag: reason.default_rag,
      categoryId: reason.category_id,
      categoryName: (category as { name?: string })?.name,
      categoryColor: (category as { color?: string })?.color,
      suggestedFollowUpDays: reason.suggested_follow_up_days,
      suggestedFollowUpText: reason.suggested_follow_up_text,
      isActive: reason.is_active,
      updatedAt: reason.updated_at
    })
  } catch (error) {
    console.error('Update reason error:', error)
    return c.json({ error: 'Failed to update reason' }, 500)
  }
})

// DELETE /api/v1/item-reasons/:id - Soft delete reason
itemReasons.delete('/item-reasons/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { error } = await supabaseAdmin
      .from('item_reasons')
      .update({ is_active: false })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete reason error:', error)
    return c.json({ error: 'Failed to delete reason' }, 500)
  }
})

// POST /api/v1/item-reasons/:id/mark-reviewed - Mark AI reason as reviewed
itemReasons.post('/item-reasons/:id/mark-reviewed', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: reason, error } = await supabaseAdmin
      .from('item_reasons')
      .update({
        ai_reviewed: true,
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: reason.id,
      aiReviewed: reason.ai_reviewed,
      reviewedAt: reason.reviewed_at
    })
  } catch (error) {
    console.error('Mark reviewed error:', error)
    return c.json({ error: 'Failed to mark as reviewed' }, 500)
  }
})

// PUT /api/v1/template-items/:id/reasons/reorder - Reorder reasons
itemReasons.put('/template-items/:id/reasons/reorder', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id: _templateItemId } = c.req.param()
    const body = await c.req.json()
    const { reasonIds } = body

    if (!reasonIds || !Array.isArray(reasonIds)) {
      return c.json({ error: 'reasonIds array is required' }, 400)
    }

    // Update sort orders (reasonIds array contains the item_reason IDs in new order)
    for (let i = 0; i < reasonIds.length; i++) {
      await supabaseAdmin
        .from('item_reasons')
        .update({ sort_order: i + 1 })
        .eq('id', reasonIds[i])
        .eq('organization_id', auth.orgId)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Reorder reasons error:', error)
    return c.json({ error: 'Failed to reorder reasons' }, 500)
  }
})

// PUT /api/v1/reasons/by-type/:reasonType/reorder - Reorder reasons by type
itemReasons.put('/reasons/by-type/:reasonType/reorder', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { reasonType } = c.req.param()
    const body = await c.req.json()
    const { reasonIds } = body

    if (!reasonIds || !Array.isArray(reasonIds)) {
      return c.json({ error: 'reasonIds array is required' }, 400)
    }

    // Update sort orders
    for (let i = 0; i < reasonIds.length; i++) {
      await supabaseAdmin
        .from('item_reasons')
        .update({ sort_order: i + 1 })
        .eq('id', reasonIds[i])
        .eq('organization_id', auth.orgId)
        .eq('reason_type', reasonType)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Reorder reasons by type error:', error)
    return c.json({ error: 'Failed to reorder reasons' }, 500)
  }
})

export default itemReasons
