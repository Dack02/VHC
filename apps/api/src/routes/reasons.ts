/**
 * VHC Reasons API Routes
 *
 * This module provides endpoints for managing predefined inspection reasons.
 * The reasons system supports:
 * - Item-specific reasons (tied to a template_item_id)
 * - Type-based reasons (tied to a reason_type, shared across all items of that type)
 * - AI generation of reasons using Claude
 * - Reason submissions from technicians for manager review
 * - Usage tracking and approval rate analytics
 *
 * Key concepts:
 * - Reasons are grouped by category (safety, wear, maintenance, advisory, positive)
 * - Each reason has a default RAG status (red, amber, green)
 * - Customer descriptions are shown in the customer portal
 * - Technical descriptions are for internal use
 *
 * @module routes/reasons
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import {
  generateAndSaveReasonsForItem,
  generateAndSaveReasonsForType,
  generateAllReasonsForTemplate,
  regenerateDescriptions,
  getAIUsageSummary
} from '../services/ai-reasons.js'

const reasons = new Hono()

reasons.use('*', authMiddleware)

// =============================================================================
// REASON CATEGORIES
// =============================================================================

// GET /api/v1/reason-categories - Get all reason categories
reasons.get('/reason-categories', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('reason_categories')
      .select('*')
      .order('display_order', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      categories: data?.map(cat => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        displayOrder: cat.display_order,
        color: cat.color,
        typicalRag: cat.typical_rag
      }))
    })
  } catch (error) {
    console.error('Get reason categories error:', error)
    return c.json({ error: 'Failed to get reason categories' }, 500)
  }
})

// =============================================================================
// ITEM REASONS - BY TEMPLATE ITEM
// =============================================================================

// GET /api/v1/template-items/:id/reasons - Get reasons for a template item
reasons.get('/template-items/:id/reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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
    filteredReasons.sort((a, b) => {
      const ragOrder: Record<string, number> = { red: 0, amber: 1, green: 2 }
      const ragDiff = (ragOrder[a.default_rag as string] || 2) - (ragOrder[b.default_rag as string] || 2)
      if (ragDiff !== 0) return ragDiff
      return ((b.usage_count as number) || 0) - ((a.usage_count as number) || 0)
    })

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
      reasons: filteredReasons.map((r) => ({
        id: r.id,
        reasonText: r.reason_text,
        technicalDescription: r.technical_description,
        customerDescription: r.customer_description,
        defaultRag: r.default_rag,
        categoryId: r.category_id,
        categoryName: (r.category as { name?: string } | null)?.name || null,
        categoryColor: (r.category as { color?: string } | null)?.color || null,
        suggestedFollowUpDays: r.suggested_follow_up_days,
        suggestedFollowUpText: r.suggested_follow_up_text,
        usageCount: r.usage_count || 0,
        timesApproved: r.times_approved || 0,
        timesDeclined: r.times_declined || 0,
        aiGenerated: r.ai_generated || false,
        aiReviewed: r.ai_reviewed || false,
        isActive: r.is_active,
        sortOrder: r.sort_order || 0,
        source: r.source
      })),
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
reasons.post('/template-items/:id/reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

    return c.json({
      id: reason.id,
      reasonText: reason.reason_text,
      technicalDescription: reason.technical_description,
      customerDescription: reason.customer_description,
      defaultRag: reason.default_rag,
      categoryId: reason.category_id,
      categoryName: reason.category?.name,
      categoryColor: reason.category?.color,
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
reasons.get('/reasons/by-type/:reasonType', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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
    allReasons.sort((a, b) => {
      const ragOrder: Record<string, number> = { red: 0, amber: 1, green: 2 }
      const ragDiff = (ragOrder[a.default_rag as string] || 2) - (ragOrder[b.default_rag as string] || 2)
      if (ragDiff !== 0) return ragDiff
      return ((b.usage_count as number) || 0) - ((a.usage_count as number) || 0)
    })

    console.log('[reasons/by-type] Returning', allReasons.length, 'total reasons')

    return c.json({
      reasons: allReasons.map(r => ({
        id: r.id,
        reasonText: r.reason_text,
        technicalDescription: r.technical_description,
        customerDescription: r.customer_description,
        defaultRag: r.default_rag,
        categoryId: r.category_id,
        categoryName: (r.category as { name?: string } | null)?.name || null,
        categoryColor: (r.category as { color?: string } | null)?.color || null,
        suggestedFollowUpDays: r.suggested_follow_up_days,
        suggestedFollowUpText: r.suggested_follow_up_text,
        usageCount: r.usage_count || 0,
        timesApproved: r.times_approved || 0,
        timesDeclined: r.times_declined || 0,
        aiGenerated: r.ai_generated || false,
        aiReviewed: r.ai_reviewed || false,
        isActive: r.is_active,
        sortOrder: r.sort_order || 0
      }))
    })
  } catch (error) {
    console.error('Get reasons by type error:', error)
    return c.json({ error: 'Failed to get reasons' }, 500)
  }
})

// POST /api/v1/reasons/by-type/:reasonType - Create reason for reason type
reasons.post('/reasons/by-type/:reasonType', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

    return c.json({
      id: reason.id,
      reasonType: reason.reason_type,
      reasonText: reason.reason_text,
      technicalDescription: reason.technical_description,
      customerDescription: reason.customer_description,
      defaultRag: reason.default_rag,
      categoryId: reason.category_id,
      categoryName: reason.category?.name,
      categoryColor: reason.category?.color,
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
reasons.get('/item-reasons/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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

    return c.json({
      id: reason.id,
      templateItemId: reason.template_item_id,
      reasonType: reason.reason_type,
      reasonText: reason.reason_text,
      technicalDescription: reason.technical_description,
      customerDescription: reason.customer_description,
      defaultRag: reason.default_rag,
      categoryId: reason.category_id,
      categoryName: reason.category?.name,
      categoryColor: reason.category?.color,
      suggestedFollowUpDays: reason.suggested_follow_up_days,
      suggestedFollowUpText: reason.suggested_follow_up_text,
      aiGenerated: reason.ai_generated,
      aiReviewed: reason.ai_reviewed,
      reviewedBy: reason.reviewed_by_user ? `${reason.reviewed_by_user.first_name} ${reason.reviewed_by_user.last_name}` : null,
      reviewedAt: reason.reviewed_at,
      usageCount: reason.usage_count,
      lastUsedAt: reason.last_used_at,
      timesApproved: reason.times_approved,
      timesDeclined: reason.times_declined,
      isStarterTemplate: reason.is_starter_template,
      isActive: reason.is_active,
      sortOrder: reason.sort_order,
      createdAt: reason.created_at,
      createdBy: reason.created_by_user ? `${reason.created_by_user.first_name} ${reason.created_by_user.last_name}` : null
    })
  } catch (error) {
    console.error('Get reason error:', error)
    return c.json({ error: 'Failed to get reason' }, 500)
  }
})

// PATCH /api/v1/item-reasons/:id - Update reason
reasons.patch('/item-reasons/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

    return c.json({
      id: reason.id,
      reasonText: reason.reason_text,
      technicalDescription: reason.technical_description,
      customerDescription: reason.customer_description,
      defaultRag: reason.default_rag,
      categoryId: reason.category_id,
      categoryName: reason.category?.name,
      categoryColor: reason.category?.color,
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
reasons.delete('/item-reasons/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
reasons.post('/item-reasons/:id/mark-reviewed', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
reasons.put('/template-items/:id/reasons/reorder', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// =============================================================================
// RECENTLY USED REASONS
// =============================================================================

// GET /api/v1/reasons/recently-used - Get recently used reasons for current user
reasons.get('/reasons/recently-used', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { limit = '10' } = c.req.query()

    const { data, error } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        item_reason_id,
        created_at,
        reason:item_reasons(
          id,
          reason_text,
          technical_description,
          customer_description,
          default_rag,
          category_id,
          suggested_follow_up_days,
          suggested_follow_up_text,
          category:reason_categories(id, name, color)
        )
      `)
      .eq('user_id', auth.user.id)
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Deduplicate by reason id
    const seen = new Set()
    const uniqueReasons = data?.filter(r => {
      if (seen.has(r.item_reason_id)) return false
      seen.add(r.item_reason_id)
      return true
    }).map(r => {
      const reason = Array.isArray(r.reason) ? r.reason[0] : r.reason
      const category = reason?.category
      const cat = Array.isArray(category) ? category[0] : category
      return {
        id: reason?.id,
        reasonText: reason?.reason_text,
        technicalDescription: reason?.technical_description,
        customerDescription: reason?.customer_description,
        defaultRag: reason?.default_rag,
        categoryId: reason?.category_id,
        categoryName: cat?.name,
        categoryColor: cat?.color,
        suggestedFollowUpDays: reason?.suggested_follow_up_days,
        suggestedFollowUpText: reason?.suggested_follow_up_text,
        lastUsedAt: r.created_at
      }
    })

    return c.json({ reasons: uniqueReasons })
  } catch (error) {
    console.error('Get recently used reasons error:', error)
    return c.json({ error: 'Failed to get recently used reasons' }, 500)
  }
})

// =============================================================================
// REASON SUBMISSIONS
// =============================================================================

// POST /api/v1/reason-submissions - Submit custom reason for manager review
reasons.post('/reason-submissions', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const {
      templateItemId,
      reasonType,
      reasonText,
      notes,
      healthCheckId,
      checkResultId
    } = body

    if (!reasonText) {
      return c.json({ error: 'Reason text is required' }, 400)
    }

    if (!templateItemId && !reasonType) {
      return c.json({ error: 'Either templateItemId or reasonType is required' }, 400)
    }

    const { data: submission, error } = await supabaseAdmin
      .from('reason_submissions')
      .insert({
        organization_id: auth.orgId,
        template_item_id: templateItemId,
        reason_type: reasonType,
        submitted_reason_text: reasonText,
        submitted_notes: notes,
        health_check_id: healthCheckId,
        check_result_id: checkResultId,
        submitted_by: auth.user.id
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: submission.id,
      reasonText: submission.submitted_reason_text,
      status: submission.status,
      submittedAt: submission.submitted_at
    }, 201)
  } catch (error) {
    console.error('Submit reason error:', error)
    return c.json({ error: 'Failed to submit reason' }, 500)
  }
})

// GET /api/v1/organizations/:id/reason-submissions - List submissions
reasons.get('/organizations/:id/reason-submissions', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { status } = c.req.query()

    // Verify org access
    if (id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    let query = supabaseAdmin
      .from('reason_submissions')
      .select(`
        *,
        submitter:users!reason_submissions_submitted_by_fkey(first_name, last_name),
        reviewer:users!reason_submissions_reviewed_by_fkey(first_name, last_name),
        template_item:template_items(id, name),
        health_check:health_checks(id, job_number, vehicle:vehicles(registration))
      `, { count: 'exact' })
      .eq('organization_id', id)
      .order('submitted_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      submissions: data?.map(s => ({
        id: s.id,
        templateItemId: s.template_item_id,
        templateItemName: s.template_item?.name,
        reasonType: s.reason_type,
        reasonText: s.submitted_reason_text,
        notes: s.submitted_notes,
        status: s.status,
        submittedBy: s.submitter ? `${s.submitter.first_name} ${s.submitter.last_name}` : null,
        submittedAt: s.submitted_at,
        reviewedBy: s.reviewer ? `${s.reviewer.first_name} ${s.reviewer.last_name}` : null,
        reviewedAt: s.reviewed_at,
        reviewNotes: s.review_notes,
        context: s.health_check ? {
          healthCheckId: s.health_check.id,
          jobNumber: s.health_check.job_number,
          registration: s.health_check.vehicle?.registration
        } : null
      })),
      count
    })
  } catch (error) {
    console.error('Get submissions error:', error)
    return c.json({ error: 'Failed to get submissions' }, 500)
  }
})

// GET /api/v1/organizations/:id/reason-submissions/count - Get pending count
reasons.get('/organizations/:id/reason-submissions/count', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { status = 'pending' } = c.req.query()

    if (id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const { count, error } = await supabaseAdmin
      .from('reason_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', id)
      .eq('status', status)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ count: count || 0 })
  } catch (error) {
    console.error('Get submission count error:', error)
    return c.json({ error: 'Failed to get count' }, 500)
  }
})

// POST /api/v1/reason-submissions/:id/approve - Approve submission
reasons.post('/reason-submissions/:id/approve', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const {
      technicalDescription,
      customerDescription,
      defaultRag,
      categoryId,
      suggestedFollowUpDays,
      suggestedFollowUpText,
      applyToType  // If true, create as type-based reason instead of item-specific
    } = body

    // Get the submission
    const { data: submission, error: fetchError } = await supabaseAdmin
      .from('reason_submissions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .eq('status', 'pending')
      .single()

    if (fetchError || !submission) {
      return c.json({ error: 'Submission not found or already processed' }, 404)
    }

    // Create the new reason
    const reasonData: Record<string, unknown> = {
      organization_id: auth.orgId,
      reason_text: submission.submitted_reason_text,
      technical_description: technicalDescription,
      customer_description: customerDescription,
      default_rag: defaultRag || 'amber',
      category_id: categoryId,
      suggested_follow_up_days: suggestedFollowUpDays,
      suggested_follow_up_text: suggestedFollowUpText,
      ai_reviewed: true,
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
      created_by: auth.user.id
    }

    // Determine if creating for type or specific item
    if (applyToType && submission.reason_type) {
      reasonData.reason_type = submission.reason_type
    } else if (submission.template_item_id) {
      reasonData.template_item_id = submission.template_item_id
    } else if (submission.reason_type) {
      reasonData.reason_type = submission.reason_type
    }

    const { data: reason, error: createError } = await supabaseAdmin
      .from('item_reasons')
      .insert(reasonData)
      .select()
      .single()

    if (createError) {
      return c.json({ error: createError.message }, 500)
    }

    // Update submission status
    const { data: updatedSubmission, error: updateError } = await supabaseAdmin
      .from('reason_submissions')
      .update({
        status: 'approved',
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
        approved_reason_id: reason.id
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    return c.json({
      submission: {
        id: updatedSubmission.id,
        status: updatedSubmission.status,
        reviewedAt: updatedSubmission.reviewed_at
      },
      reason: {
        id: reason.id,
        reasonText: reason.reason_text,
        templateItemId: reason.template_item_id,
        reasonType: reason.reason_type
      }
    })
  } catch (error) {
    console.error('Approve submission error:', error)
    return c.json({ error: 'Failed to approve submission' }, 500)
  }
})

// POST /api/v1/reason-submissions/:id/reject - Reject submission
reasons.post('/reason-submissions/:id/reject', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { reviewNotes } = body

    const { data: submission, error } = await supabaseAdmin
      .from('reason_submissions')
      .update({
        status: 'rejected',
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .eq('status', 'pending')
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    if (!submission) {
      return c.json({ error: 'Submission not found or already processed' }, 404)
    }

    return c.json({
      id: submission.id,
      status: submission.status,
      reviewedAt: submission.reviewed_at,
      reviewNotes: submission.review_notes
    })
  } catch (error) {
    console.error('Reject submission error:', error)
    return c.json({ error: 'Failed to reject submission' }, 500)
  }
})

// =============================================================================
// CHECK RESULT REASONS
// =============================================================================

// POST /api/v1/check-results/batch-reasons - Get reasons for multiple check results at once
// This is more efficient than making individual requests for each check result
reasons.post('/check-results/batch-reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { checkResultIds } = body

    if (!checkResultIds || !Array.isArray(checkResultIds) || checkResultIds.length === 0) {
      return c.json({ error: 'checkResultIds array is required' }, 400)
    }

    // Limit batch size to prevent abuse
    if (checkResultIds.length > 100) {
      return c.json({ error: 'Maximum 100 check results per batch' }, 400)
    }

    // Verify all check results belong to the organization
    const { data: checkResults, error: crError } = await supabaseAdmin
      .from('check_results')
      .select(`
        id,
        health_check:health_checks!inner(organization_id)
      `)
      .in('id', checkResultIds)

    if (crError) {
      return c.json({ error: crError.message }, 500)
    }

    // Filter to only check results that belong to this org
    const validIds = checkResults
      ?.filter(cr => {
        const healthCheckOrg = Array.isArray(cr.health_check)
          ? cr.health_check[0]?.organization_id
          : (cr.health_check as { organization_id: string })?.organization_id
        return healthCheckOrg === auth.orgId
      })
      .map(cr => cr.id) || []

    if (validIds.length === 0) {
      return c.json({ reasonsByCheckResult: {} })
    }

    // Get selected reasons for all valid check results in one query
    const { data: allSelectedReasons, error: selError } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        check_result_id,
        id,
        item_reason_id,
        technical_description_override,
        customer_description_override,
        follow_up_days,
        follow_up_text,
        rag_overridden,
        customer_approved,
        approved_at,
        reason:item_reasons(
          id,
          reason_text,
          technical_description,
          customer_description,
          default_rag,
          category_id,
          suggested_follow_up_days,
          suggested_follow_up_text,
          category:reason_categories(id, name, color)
        )
      `)
      .in('check_result_id', validIds)

    if (selError) {
      return c.json({ error: selError.message }, 500)
    }

    // Group reasons by check result ID
    const reasonsByCheckResult: Record<string, Array<{
      id: string
      itemReasonId: string
      reasonText: string
      technicalDescription: string | null
      customerDescription: string | null
      defaultRag: string
      categoryId: string | null
      categoryName: string | null
      categoryColor: string | null
      followUpDays: number | null
      followUpText: string | null
      ragOverridden: boolean
      customerApproved: boolean | null
      approvedAt: string | null
      hasOverrides: boolean
    }>> = {}

    // Initialize all requested IDs with empty arrays
    validIds.forEach(id => {
      reasonsByCheckResult[id] = []
    })

    // Populate with actual reasons
    // Type assertion needed because Supabase returns nested relations with unpredictable array/object types
    allSelectedReasons?.forEach((sr: {
      check_result_id: string
      id: string
      item_reason_id: string
      technical_description_override: string | null
      customer_description_override: string | null
      follow_up_days: number | null
      follow_up_text: string | null
      rag_overridden: boolean
      customer_approved: boolean | null
      approved_at: string | null
      reason: {
        reason_text: string
        technical_description: string | null
        customer_description: string | null
        default_rag: string
        category_id: string | null
        category: { name: string | null; color: string | null } | null
      } | null
    }) => {
      if (!reasonsByCheckResult[sr.check_result_id]) {
        reasonsByCheckResult[sr.check_result_id] = []
      }
      reasonsByCheckResult[sr.check_result_id].push({
        id: sr.id,
        itemReasonId: sr.item_reason_id,
        reasonText: sr.reason?.reason_text || '',
        technicalDescription: sr.technical_description_override || sr.reason?.technical_description || null,
        customerDescription: sr.customer_description_override || sr.reason?.customer_description || null,
        defaultRag: sr.reason?.default_rag || 'green',
        categoryId: sr.reason?.category_id || null,
        categoryName: sr.reason?.category?.name || null,
        categoryColor: sr.reason?.category?.color || null,
        followUpDays: sr.follow_up_days,
        followUpText: sr.follow_up_text,
        ragOverridden: sr.rag_overridden,
        customerApproved: sr.customer_approved,
        approvedAt: sr.approved_at,
        hasOverrides: !!(sr.technical_description_override || sr.customer_description_override)
      })
    })

    return c.json({ reasonsByCheckResult })
  } catch (error) {
    console.error('Batch get check result reasons error:', error)
    return c.json({ error: 'Failed to get reasons' }, 500)
  }
})

// GET /api/v1/check-results/:id/reasons - Get reasons for a check result
reasons.get('/check-results/:id/reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get check result with template item
    const { data: checkResult, error: crError } = await supabaseAdmin
      .from('check_results')
      .select(`
        id,
        template_item_id,
        health_check:health_checks!inner(organization_id)
      `)
      .eq('id', id)
      .single()

    if (crError || !checkResult) {
      return c.json({ error: 'Check result not found' }, 404)
    }

    const healthCheckOrg = Array.isArray(checkResult.health_check)
      ? checkResult.health_check[0]?.organization_id
      : (checkResult.health_check as { organization_id: string })?.organization_id
    if (healthCheckOrg !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Get selected reasons
    const { data: selectedReasons, error: selError } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        *,
        reason:item_reasons(
          id,
          reason_text,
          technical_description,
          customer_description,
          default_rag,
          category_id,
          suggested_follow_up_days,
          suggested_follow_up_text,
          category:reason_categories(id, name, color)
        )
      `)
      .eq('check_result_id', id)

    if (selError) {
      return c.json({ error: selError.message }, 500)
    }

    // Get available reasons
    const { data: availableReasons } = await supabaseAdmin
      .rpc('get_reasons_for_item', {
        p_template_item_id: checkResult.template_item_id,
        p_organization_id: auth.orgId
      })

    return c.json({
      selectedReasons: selectedReasons?.map(sr => ({
        id: sr.id,
        itemReasonId: sr.item_reason_id,
        reasonText: sr.reason?.reason_text,
        technicalDescription: sr.technical_description_override || sr.reason?.technical_description,
        customerDescription: sr.customer_description_override || sr.reason?.customer_description,
        defaultRag: sr.reason?.default_rag,
        categoryId: sr.reason?.category_id,
        categoryName: sr.reason?.category?.name,
        categoryColor: sr.reason?.category?.color,
        followUpDays: sr.follow_up_days,
        followUpText: sr.follow_up_text,
        ragOverridden: sr.rag_overridden,
        customerApproved: sr.customer_approved,
        approvedAt: sr.approved_at,
        hasOverrides: !!(sr.technical_description_override || sr.customer_description_override)
      })),
      availableReasons: availableReasons?.map((r: Record<string, unknown>) => ({
        id: r.id,
        reasonText: r.reason_text,
        technicalDescription: r.technical_description,
        customerDescription: r.customer_description,
        defaultRag: r.default_rag,
        categoryId: r.category_id,
        categoryName: r.category_name,
        categoryColor: r.category_color,
        suggestedFollowUpDays: r.suggested_follow_up_days,
        suggestedFollowUpText: r.suggested_follow_up_text,
        source: r.source
      }))
    })
  } catch (error) {
    console.error('Get check result reasons error:', error)
    return c.json({ error: 'Failed to get reasons' }, 500)
  }
})

// PUT /api/v1/check-results/:id/reasons - Set selected reasons for check result
reasons.put('/check-results/:id/reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { reasonIds, followUpDays, followUpText, notes } = body

    if (!reasonIds || !Array.isArray(reasonIds)) {
      return c.json({ error: 'reasonIds array is required' }, 400)
    }

    // Verify check result belongs to org
    const { data: checkResult, error: crError } = await supabaseAdmin
      .from('check_results')
      .select(`
        id,
        health_check:health_checks!inner(organization_id)
      `)
      .eq('id', id)
      .single()

    if (crError || !checkResult) {
      return c.json({ error: 'Check result not found' }, 404)
    }

    const healthCheckOrg2 = Array.isArray(checkResult.health_check)
      ? checkResult.health_check[0]?.organization_id
      : (checkResult.health_check as { organization_id: string })?.organization_id
    if (healthCheckOrg2 !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Update check_result notes if provided
    if (notes !== undefined) {
      await supabaseAdmin
        .from('check_results')
        .update({ notes })
        .eq('id', id)
    }

    // Delete existing selections
    await supabaseAdmin
      .from('check_result_reasons')
      .delete()
      .eq('check_result_id', id)

    // Insert new selections
    if (reasonIds.length > 0) {
      const inserts = reasonIds.map((reasonId: string) => ({
        check_result_id: id,
        item_reason_id: reasonId,
        organization_id: auth.orgId,
        user_id: auth.user.id,
        follow_up_days: followUpDays,
        follow_up_text: followUpText
      }))

      const { error: insertError } = await supabaseAdmin
        .from('check_result_reasons')
        .insert(inserts)

      if (insertError) {
        return c.json({ error: insertError.message }, 500)
      }
    }

    // Get updated selections
    const { data: selectedReasons } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        *,
        reason:item_reasons(
          id,
          reason_text,
          default_rag,
          category:reason_categories(id, name, color)
        )
      `)
      .eq('check_result_id', id)

    return c.json({
      selectedReasons: selectedReasons?.map(sr => ({
        id: sr.id,
        itemReasonId: sr.item_reason_id,
        reasonText: sr.reason?.reason_text,
        defaultRag: sr.reason?.default_rag,
        followUpDays: sr.follow_up_days,
        followUpText: sr.follow_up_text
      }))
    })
  } catch (error) {
    console.error('Set check result reasons error:', error)
    return c.json({ error: 'Failed to set reasons' }, 500)
  }
})

// PATCH /api/v1/check-result-reasons/:id - Update description override
reasons.patch('/check-result-reasons/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const updateData: Record<string, unknown> = {}

    if (body.technicalDescriptionOverride !== undefined) {
      updateData.technical_description_override = body.technicalDescriptionOverride
    }
    if (body.customerDescriptionOverride !== undefined) {
      updateData.customer_description_override = body.customerDescriptionOverride
    }
    if (body.followUpDays !== undefined) {
      updateData.follow_up_days = body.followUpDays
    }
    if (body.followUpText !== undefined) {
      updateData.follow_up_text = body.followUpText
    }

    const { data, error } = await supabaseAdmin
      .from('check_result_reasons')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: data.id,
      technicalDescriptionOverride: data.technical_description_override,
      customerDescriptionOverride: data.customer_description_override,
      followUpDays: data.follow_up_days,
      followUpText: data.follow_up_text
    })
  } catch (error) {
    console.error('Update check result reason error:', error)
    return c.json({ error: 'Failed to update' }, 500)
  }
})

// PATCH /api/v1/check-result-reasons/:id/approval - Record customer approval
reasons.patch('/check-result-reasons/:id/approval', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { approved } = body

    if (typeof approved !== 'boolean') {
      return c.json({ error: 'approved boolean is required' }, 400)
    }

    const { data, error } = await supabaseAdmin
      .from('check_result_reasons')
      .update({
        customer_approved: approved,
        approved_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: data.id,
      customerApproved: data.customer_approved,
      approvedAt: data.approved_at
    })
  } catch (error) {
    console.error('Update approval error:', error)
    return c.json({ error: 'Failed to update approval' }, 500)
  }
})

// =============================================================================
// ORGANIZATION TONE SETTING
// =============================================================================

// GET /api/v1/organizations/:id/settings/reason-tone - Get tone setting
reasons.get('/organizations/:id/settings/reason-tone', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    if (id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const { data, error } = await supabaseAdmin
      .from('organization_settings')
      .select('reason_tone')
      .eq('organization_id', id)
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ tone: data?.reason_tone || 'friendly' })
  } catch (error) {
    console.error('Get tone error:', error)
    return c.json({ error: 'Failed to get tone setting' }, 500)
  }
})

// PATCH /api/v1/organizations/:id/settings/reason-tone - Update tone setting
reasons.patch('/organizations/:id/settings/reason-tone', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { tone } = body

    if (id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    if (!['premium', 'friendly'].includes(tone)) {
      return c.json({ error: 'Tone must be "premium" or "friendly"' }, 400)
    }

    const { data, error } = await supabaseAdmin
      .from('organization_settings')
      .update({ reason_tone: tone, updated_at: new Date().toISOString() })
      .eq('organization_id', id)
      .select('reason_tone')
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ tone: data?.reason_tone })
  } catch (error) {
    console.error('Update tone error:', error)
    return c.json({ error: 'Failed to update tone setting' }, 500)
  }
})

// =============================================================================
// TEMPLATE REASONS SUMMARY (for Admin UI)
// =============================================================================

// GET /api/v1/templates/:id/reasons-summary - Get reasons summary grouped by type and items
reasons.get('/templates/:id/reasons-summary', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { search } = c.req.query()

    // Verify template belongs to org
    const { data: template, error: templateError } = await supabaseAdmin
      .from('check_templates')
      .select('id, name, organization_id')
      .eq('id', id)
      .single()

    if (templateError || !template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    if (template.organization_id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Get all template items with their reason types
    const { data: items } = await supabaseAdmin
      .from('template_items')
      .select(`
        id,
        name,
        reason_type,
        section:template_sections!inner(
          id,
          name,
          template_id
        )
      `)
      .eq('section.template_id', id)
      .order('name')

    if (!items) {
      return c.json({ reasonTypes: [], uniqueItems: [] })
    }

    // Group items by reason_type
    const typeMap: Record<string, { items: typeof items; itemNames: string[] }> = {}
    const uniqueItems: typeof items = []

    for (const item of items) {
      if (item.reason_type) {
        if (!typeMap[item.reason_type]) {
          typeMap[item.reason_type] = { items: [], itemNames: [] }
        }
        typeMap[item.reason_type].items.push(item)
        typeMap[item.reason_type].itemNames.push(item.name)
      } else {
        uniqueItems.push(item)
      }
    }

    // Get reason stats for each type
    // Note: Reasons can be stored EITHER with reason_type OR with template_item_id
    // We need to count both: reasons with reason_type=X AND reasons with template_item_id in items of type X
    const reasonTypes = await Promise.all(
      Object.entries(typeMap).map(async ([type, data]) => {
        // Get item IDs for this type
        const itemIds = data.items.map(item => item.id)

        // Get reasons by reason_type OR by template_item_id
        const { data: reasons } = await supabaseAdmin
          .from('item_reasons')
          .select('id, usage_count, times_approved, times_declined, ai_reviewed, reason_type, template_item_id')
          .eq('organization_id', auth.orgId)
          .eq('is_active', true)
          .or(`reason_type.eq.${type},template_item_id.in.(${itemIds.join(',')})`)

        // Deduplicate (in case same reason matches both criteria)
        const uniqueReasons = reasons ? [...new Map(reasons.map(r => [r.id, r])).values()] : []

        const reasonCount = uniqueReasons.length
        const totalUsage = uniqueReasons.reduce((sum, r) => sum + (r.usage_count || 0), 0)
        const totalApproved = uniqueReasons.reduce((sum, r) => sum + (r.times_approved || 0), 0)
        const totalDeclined = uniqueReasons.reduce((sum, r) => sum + (r.times_declined || 0), 0)
        const approvalRate = (totalApproved + totalDeclined) > 0
          ? Math.round((totalApproved / (totalApproved + totalDeclined)) * 100)
          : null
        const unreviewedCount = uniqueReasons.filter(r => !r.ai_reviewed).length

        // Apply search filter
        if (search && !type.toLowerCase().includes(search.toLowerCase()) &&
            !data.itemNames.some(n => n.toLowerCase().includes(search.toLowerCase()))) {
          return null
        }

        return {
          reasonType: type,
          displayName: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          itemCount: data.items.length,
          itemNames: data.itemNames,
          reasonCount,
          totalUsage,
          approvalRate,
          unreviewedCount
        }
      })
    )

    // Get reason stats for unique items
    const uniqueItemsWithStats = await Promise.all(
      uniqueItems.map(async (item) => {
        const { data: reasons } = await supabaseAdmin
          .from('item_reasons')
          .select('id, usage_count, times_approved, times_declined, ai_reviewed')
          .eq('organization_id', auth.orgId)
          .eq('template_item_id', item.id)
          .eq('is_active', true)

        const reasonCount = reasons?.length || 0
        const totalUsage = reasons?.reduce((sum, r) => sum + (r.usage_count || 0), 0) || 0
        const totalApproved = reasons?.reduce((sum, r) => sum + (r.times_approved || 0), 0) || 0
        const totalDeclined = reasons?.reduce((sum, r) => sum + (r.times_declined || 0), 0) || 0
        const approvalRate = (totalApproved + totalDeclined) > 0
          ? Math.round((totalApproved / (totalApproved + totalDeclined)) * 100)
          : null
        const unreviewedCount = reasons?.filter(r => !r.ai_reviewed).length || 0

        // Apply search filter
        if (search && !item.name.toLowerCase().includes(search.toLowerCase())) {
          return null
        }

        return {
          templateItemId: item.id,
          name: item.name,
          reasonCount,
          totalUsage,
          approvalRate,
          unreviewedCount
        }
      })
    )

    return c.json({
      templateId: id,
      templateName: template.name,
      reasonTypes: reasonTypes.filter(Boolean),
      uniqueItems: uniqueItemsWithStats.filter(Boolean)
    })
  } catch (error) {
    console.error('Get template reasons summary error:', error)
    return c.json({ error: 'Failed to get reasons summary' }, 500)
  }
})

// GET /api/v1/templates/:id/item-reason-counts - Get reason counts for all items in a template
reasons.get('/templates/:id/item-reason-counts', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get all template items with their reason types
    const { data: items } = await supabaseAdmin
      .from('template_items')
      .select(`
        id,
        name,
        reason_type,
        section:template_sections!inner(
          template:check_templates!inner(
            organization_id
          )
        )
      `)
      .eq('section.template.id', id)

    if (!items) {
      return c.json({ itemReasonCounts: {} })
    }

    // Filter to items belonging to this org's template
    const orgItems = items.filter(item => {
      const section = Array.isArray(item.section) ? item.section[0] : item.section
      const template = section?.template
      const templateOrg = Array.isArray(template) ? template[0] : template
      return templateOrg?.organization_id === auth.orgId
    })

    // Get reason counts for each item
    const itemReasonCounts: Record<string, { reasonCount: number; reasonType: string | null }> = {}
    const processedTypes = new Set<string>()
    const typeReasonCounts: Record<string, number> = {}

    // First, get counts for all reason_types
    for (const item of orgItems) {
      if (item.reason_type && !processedTypes.has(item.reason_type)) {
        processedTypes.add(item.reason_type)
        const { count } = await supabaseAdmin
          .from('item_reasons')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', auth.orgId)
          .eq('reason_type', item.reason_type)
          .eq('is_active', true)
        typeReasonCounts[item.reason_type] = count || 0
      }
    }

    // Now get counts for each item
    for (const item of orgItems) {
      if (item.reason_type) {
        // Use the type-based count
        itemReasonCounts[item.id] = {
          reasonCount: typeReasonCounts[item.reason_type] || 0,
          reasonType: item.reason_type
        }
      } else {
        // Get item-specific count
        const { count } = await supabaseAdmin
          .from('item_reasons')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', auth.orgId)
          .eq('template_item_id', item.id)
          .eq('is_active', true)
        itemReasonCounts[item.id] = {
          reasonCount: count || 0,
          reasonType: null
        }
      }
    }

    return c.json({ itemReasonCounts })
  } catch (error) {
    console.error('Get item reason counts error:', error)
    return c.json({ error: 'Failed to get reason counts' }, 500)
  }
})

// PUT /api/v1/reasons/by-type/:reasonType/reorder - Reorder reasons by type
reasons.put('/reasons/by-type/:reasonType/reorder', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// =============================================================================
// REASON STATS
// =============================================================================

// GET /api/v1/organizations/:id/reason-stats - Get reason usage and approval statistics
reasons.get('/organizations/:id/reason-stats', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const period = c.req.query('period') || 'all' // 7d, 30d, 90d, all

    if (id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Calculate date filter based on period
    let periodStartDate: Date | null = null
    if (period !== 'all') {
      const days = parseInt(period.replace('d', ''))
      if (!isNaN(days)) {
        periodStartDate = new Date()
        periodStartDate.setDate(periodStartDate.getDate() - days)
      }
    }

    // Get all active reasons with stats
    const { data: allReasons } = await supabaseAdmin
      .from('item_reasons')
      .select(`
        id,
        reason_text,
        reason_type,
        default_rag,
        usage_count,
        times_approved,
        times_declined,
        created_at,
        template_item_id,
        category:reason_categories(name, color),
        template_item:template_items(name)
      `)
      .eq('organization_id', id)
      .eq('is_active', true)

    // Get top used reasons (sorted by usage)
    const sortedByUsage = [...(allReasons || [])].sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
    const topReasons = sortedByUsage.slice(0, 20)

    // Get unused reasons
    const unusedReasons = allReasons?.filter(r => r.usage_count === 0) || []

    // Get low approval rate reasons (< 50% and has been used)
    const lowApprovalReasons = allReasons?.filter(r => {
      const total = (r.times_approved || 0) + (r.times_declined || 0)
      if (total < 3) return false // Need at least 3 uses to be meaningful
      const rate = r.times_approved / total
      return rate < 0.5
    }).sort((a, b) => {
      const rateA = a.times_approved / ((a.times_approved || 0) + (a.times_declined || 0))
      const rateB = b.times_approved / ((b.times_approved || 0) + (b.times_declined || 0))
      return rateA - rateB
    }).slice(0, 10) || []

    // Calculate summary stats
    const totalReasons = allReasons?.length || 0
    const totalUsage = allReasons?.reduce((sum, r) => sum + (r.usage_count || 0), 0) || 0
    const totalApproved = allReasons?.reduce((sum, r) => sum + (r.times_approved || 0), 0) || 0
    const totalDeclined = allReasons?.reduce((sum, r) => sum + (r.times_declined || 0), 0) || 0
    const avgApprovalRate = (totalApproved + totalDeclined) > 0
      ? Math.round((totalApproved / (totalApproved + totalDeclined)) * 100)
      : null

    // Get pending submissions count
    const { count: pendingSubmissions } = await supabaseAdmin
      .from('reason_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', id)
      .eq('status', 'pending')

    // Format response
    const formatReason = (r: typeof allReasons extends (infer T)[] | null ? T : never) => {
      const cat = Array.isArray(r.category) ? r.category[0] : r.category
      const item = Array.isArray(r.template_item) ? r.template_item[0] : r.template_item
      const total = (r.times_approved || 0) + (r.times_declined || 0)
      return {
        id: r.id,
        reasonText: r.reason_text,
        reasonType: r.reason_type,
        defaultRag: r.default_rag,
        usageCount: r.usage_count,
        approvalRate: total > 0
          ? Math.round((r.times_approved / total) * 100)
          : null,
        timesApproved: r.times_approved,
        timesDeclined: r.times_declined,
        categoryName: cat?.name,
        categoryColor: cat?.color,
        itemName: item?.name,
        createdAt: r.created_at
      }
    }

    return c.json({
      summary: {
        totalReasons,
        totalUsage,
        avgApprovalRate,
        pendingSubmissions: pendingSubmissions || 0,
        unusedCount: unusedReasons.length
      },
      topReasons: topReasons.map(formatReason),
      unusedReasons: unusedReasons.slice(0, 20).map(formatReason),
      lowApprovalReasons: lowApprovalReasons.map(formatReason),
      period
    })
  } catch (error) {
    console.error('Get reason stats error:', error)
    return c.json({ error: 'Failed to get stats' }, 500)
  }
})

// =============================================================================
// AI GENERATION
// =============================================================================

// POST /api/v1/template-items/:id/reasons/generate - Generate reasons for single item
reasons.post('/template-items/:id/reasons/generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify template item exists and get its info
    const { data: item, error: itemError } = await supabaseAdmin
      .from('template_items')
      .select(`
        id,
        name,
        reason_type,
        section:template_sections(
          template:check_templates(organization_id)
        )
      `)
      .eq('id', id)
      .single()

    if (itemError || !item) {
      return c.json({ error: 'Template item not found' }, 404)
    }

    // Verify organization access
    const section = Array.isArray(item.section) ? item.section[0] : item.section
    const template = section?.template
    const templateOrg = Array.isArray(template) ? template[0] : template
    if (templateOrg?.organization_id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // If item has a reason_type, suggest generating for the type instead
    if (item.reason_type) {
      return c.json({
        warning: `This item has reason_type '${item.reason_type}'. Consider using /api/v1/reasons/by-type/${item.reason_type}/generate instead to generate shared reasons.`,
        reasonType: item.reason_type
      }, 200)
    }

    const result = await generateAndSaveReasonsForItem(id, auth.orgId, auth.user.id)

    return c.json({
      success: true,
      itemId: id,
      itemName: item.name,
      generated: result.reasons.length,
      saved: result.saved,
      skipped: result.skipped,
      reasons: result.reasons.map(r => ({
        reasonText: r.reason_text,
        defaultRag: r.default_rag,
        category: r.category
      }))
    })
  } catch (error) {
    console.error('Generate reasons for item error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: 'Failed to generate reasons: ' + message }, 500)
  }
})

// POST /api/v1/reasons/by-type/:reasonType/generate - Generate reasons for a reason type
reasons.post('/reasons/by-type/:reasonType/generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { reasonType } = c.req.param()

    // Validate reason type exists in the organization's items
    const { data: items } = await supabaseAdmin
      .from('template_items')
      .select(`
        id,
        name,
        section:template_sections(
          template:check_templates(organization_id)
        )
      `)
      .eq('reason_type', reasonType)
      .limit(5)

    // Check if at least one item with this type belongs to the org
    const orgItems = items?.filter(item => {
      const section = Array.isArray(item.section) ? item.section[0] : item.section
      const template = section?.template
      const templateOrg = Array.isArray(template) ? template[0] : template
      return templateOrg?.organization_id === auth.orgId
    })

    if (!orgItems || orgItems.length === 0) {
      return c.json({ error: `No items with reason_type '${reasonType}' found in your organization` }, 404)
    }

    const result = await generateAndSaveReasonsForType(reasonType, auth.orgId, auth.user.id)

    return c.json({
      success: true,
      reasonType,
      appliesTo: orgItems.map(i => i.name),
      generated: result.reasons.length,
      saved: result.saved,
      skipped: result.skipped,
      reasons: result.reasons.map(r => ({
        reasonText: r.reason_text,
        defaultRag: r.default_rag,
        category: r.category
      }))
    })
  } catch (error) {
    console.error('Generate reasons for type error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: 'Failed to generate reasons: ' + message }, 500)
  }
})

// POST /api/v1/templates/:id/generate-all-reasons - Bulk generate for all items in template
reasons.post('/templates/:id/generate-all-reasons', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify template belongs to org
    const { data: template, error: templateError } = await supabaseAdmin
      .from('check_templates')
      .select('id, name, organization_id')
      .eq('id', id)
      .single()

    if (templateError || !template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    if (template.organization_id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const result = await generateAllReasonsForTemplate(id, auth.orgId, auth.user.id)

    return c.json({
      success: true,
      templateId: id,
      templateName: template.name,
      itemsProcessed: result.itemsProcessed,
      typesProcessed: result.typesProcessed,
      reasonsCreated: result.reasonsCreated,
      errors: result.errors.length > 0 ? result.errors : undefined
    })
  } catch (error) {
    console.error('Generate all reasons error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: 'Failed to generate reasons: ' + message }, 500)
  }
})

// POST /api/v1/item-reasons/:id/regenerate-descriptions - Regenerate descriptions for a reason
reasons.post('/item-reasons/:id/regenerate-descriptions', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify reason belongs to org
    const { data: reason } = await supabaseAdmin
      .from('item_reasons')
      .select('id, reason_text')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!reason) {
      return c.json({ error: 'Reason not found' }, 404)
    }

    const result = await regenerateDescriptions(id, auth.orgId, auth.user.id)

    return c.json({
      success: true,
      id,
      reasonText: reason.reason_text,
      technicalDescription: result.technical_description,
      customerDescription: result.customer_description
    })
  } catch (error) {
    console.error('Regenerate descriptions error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: 'Failed to regenerate descriptions: ' + message }, 500)
  }
})

// =============================================================================
// AI USAGE
// =============================================================================

// GET /api/v1/organizations/:id/ai-usage - Get AI usage summary for an organization
reasons.get('/organizations/:id/ai-usage', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const period = c.req.query('period') || '30d'

    // Verify org access (super admin can view any org)
    if (id !== auth.orgId && auth.user.role !== 'super_admin') {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const usage = await getAIUsageSummary(id)

    // Calculate period dates
    const end = new Date()
    let start: Date
    switch (period) {
      case '7d':
        start = new Date(end)
        start.setDate(start.getDate() - 7)
        break
      case '90d':
        start = new Date(end)
        start.setDate(start.getDate() - 90)
        break
      case '30d':
      default:
        start = new Date(end)
        start.setDate(start.getDate() - 30)
        break
    }

    // Get recent generations
    const { data: recentLogs } = await supabaseAdmin
      .from('ai_usage_logs')
      .select(`
        id,
        action,
        items_generated,
        created_at,
        users(first_name, last_name, email)
      `)
      .eq('organization_id', id)
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: false })
      .limit(10)

    const recentGenerations = (recentLogs || []).map(log => {
      const user = log.users as { first_name: string | null; last_name: string | null; email: string } | null
      return {
        date: log.created_at,
        user: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email : 'System',
        action: log.action,
        itemsCount: log.items_generated || 0
      }
    })

    return c.json({
      limit: usage.monthlyLimit,
      used: usage.currentGenerations,
      remaining: usage.monthlyLimit - usage.currentGenerations,
      percentageUsed: usage.percentageUsed,
      period: {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      },
      costUsd: usage.currentCostUsd,
      isAiEnabled: usage.isAiEnabled,
      recentGenerations
    })
  } catch (error) {
    console.error('Get AI usage error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: 'Failed to get AI usage: ' + message }, 500)
  }
})

// GET /api/v1/organizations/:id/ai-usage/can-generate - Check if org can generate AI content
reasons.get('/organizations/:id/ai-usage/can-generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify org access
    if (id !== auth.orgId && auth.user.role !== 'super_admin') {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Call the database function
    const { data, error } = await supabaseAdmin.rpc('can_org_generate_ai', {
      p_organization_id: id
    })

    if (error) {
      console.error('Failed to check AI generation limits', { error: error.message })
      return c.json({ error: 'Failed to verify AI generation limits' }, 500)
    }

    const result = data?.[0]
    if (!result) {
      // No record - assume allowed with default limit
      return c.json({
        allowed: true,
        reason: null,
        currentUsage: 0,
        limit: 100,
        percentageUsed: 0
      })
    }

    return c.json({
      allowed: result.allowed,
      reason: result.reason || null,
      currentUsage: result.current_usage || 0,
      limit: result.limit_value || 100,
      percentageUsed: result.percentage_used || 0
    })
  } catch (error) {
    console.error('Can generate check error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: 'Failed to check generation limits: ' + message }, 500)
  }
})

// GET /api/v1/organizations/:id/ai-usage/history - Get AI usage history for an organization
reasons.get('/organizations/:id/ai-usage/history', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const page = parseInt(c.req.query('page') || '1')
    const limit = Math.min(50, parseInt(c.req.query('limit') || '20'))

    // Verify org access
    if (id !== auth.orgId && auth.user.role !== 'super_admin') {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const offset = (page - 1) * limit

    // Get logs with pagination
    const { data: logs, error, count } = await supabaseAdmin
      .from('ai_usage_logs')
      .select(`
        id,
        action,
        items_generated,
        reason_type,
        created_at,
        template_item_id,
        users(first_name, last_name, email),
        template_items(name)
      `, { count: 'exact' })
      .eq('organization_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw new Error(`Failed to fetch history: ${error.message}`)
    }

    const transformedLogs = (logs || []).map(log => {
      const user = log.users as { first_name: string | null; last_name: string | null; email: string } | null
      const templateItem = log.template_items as { name: string } | null

      return {
        id: log.id,
        createdAt: log.created_at,
        userName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email : 'System',
        action: log.action,
        itemsGenerated: log.items_generated,
        templateItemName: templateItem?.name || null,
        reasonType: log.reason_type
      }
    })

    const total = count || 0
    const pages = Math.ceil(total / limit)

    return c.json({
      logs: transformedLogs,
      pagination: {
        page,
        limit,
        total,
        pages
      }
    })
  } catch (error) {
    console.error('Get AI usage history error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: 'Failed to get usage history: ' + message }, 500)
  }
})

// =============================================================================
// REASON TYPES MANAGEMENT
// =============================================================================

// GET /api/v1/reason-types - List all reason types (system + org custom)
reasons.get('/reason-types', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')

    // Get all reason types (system types + org custom types)
    const { data: reasonTypes, error } = await supabaseAdmin
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
      (reasonTypes || []).map(async (rt) => {
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

        return {
          id: rt.id,
          name: rt.name,
          description: rt.description,
          organizationId: rt.organization_id,
          isSystem: rt.is_system,
          isCustom: rt.organization_id !== null,
          itemCount: itemCount || 0,
          reasonCount: reasonCount || 0,
          createdAt: rt.created_at,
          updatedAt: rt.updated_at
        }
      })
    )

    return c.json({ reasonTypes: typesWithCounts })
  } catch (error) {
    console.error('Get reason types error:', error)
    return c.json({ error: 'Failed to get reason types' }, 500)
  }
})

// POST /api/v1/reason-types - Create a custom reason type
reasons.post('/reason-types', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
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

    return c.json({
      id: reasonType.id,
      name: reasonType.name,
      description: reasonType.description,
      organizationId: reasonType.organization_id,
      isSystem: reasonType.is_system,
      isCustom: true,
      itemCount: 0,
      reasonCount: 0,
      createdAt: reasonType.created_at
    }, 201)
  } catch (error) {
    console.error('Create reason type error:', error)
    return c.json({ error: 'Failed to create reason type' }, 500)
  }
})

// GET /api/v1/reason-types/:id - Get a single reason type with items using it
reasons.get('/reason-types/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

    return c.json({
      id: reasonType.id,
      name: reasonType.name,
      description: reasonType.description,
      organizationId: reasonType.organization_id,
      isSystem: reasonType.is_system,
      isCustom: reasonType.organization_id !== null,
      itemCount: itemCount || 0,
      reasonCount: reasonCount || 0,
      createdAt: reasonType.created_at,
      updatedAt: reasonType.updated_at
    })
  } catch (error) {
    console.error('Get reason type error:', error)
    return c.json({ error: 'Failed to get reason type' }, 500)
  }
})

// GET /api/v1/reason-types/:id/items - List items using this reason type
reasons.get('/reason-types/:id/items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
      const section = Array.isArray(item.section) ? item.section[0] : item.section
      const template = section?.template
      const templateData = Array.isArray(template) ? template[0] : template
      return templateData?.organization_id === auth.orgId
    }).map(item => {
      const section = Array.isArray(item.section) ? item.section[0] : item.section
      const template = section?.template
      const templateData = Array.isArray(template) ? template[0] : template
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        sectionId: section?.id,
        sectionName: section?.name,
        templateId: templateData?.id,
        templateName: templateData?.name
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
reasons.patch('/reason-types/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
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
reasons.delete('/reason-types/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
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

export default reasons
