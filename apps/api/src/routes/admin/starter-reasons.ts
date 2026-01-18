/**
 * Starter Reasons API Routes (Super Admin only)
 * Manages starter template reasons for new organizations
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'

const starterReasonsRoutes = new Hono()

// All routes require super admin authentication
starterReasonsRoutes.use('*', superAdminMiddleware)

interface StarterReasonStats {
  totalReasons: number
  markedAsStarter: number
  pendingReview: number
  byReasonType: Array<{
    reasonType: string
    displayName: string
    count: number
  }>
}

/**
 * GET /api/v1/admin/starter-reasons/stats
 * Get statistics about starter reasons for an organization
 */
starterReasonsRoutes.get('/stats', async (c) => {
  const { organization_id } = c.req.query()

  if (!organization_id) {
    return c.json({ error: 'organization_id is required' }, 400)
  }

  try {
    // Get total reasons
    const { count: totalReasons } = await supabaseAdmin
      .from('item_reasons')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization_id)
      .eq('is_active', true)

    // Get reasons marked as starter
    const { count: markedAsStarter } = await supabaseAdmin
      .from('item_reasons')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .eq('is_starter_template', true)

    // Get AI-reviewed but not yet marked as starter
    const { count: pendingReview } = await supabaseAdmin
      .from('item_reasons')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .eq('ai_reviewed', true)
      .eq('is_starter_template', false)

    // Get breakdown by reason_type
    const { data: byType } = await supabaseAdmin
      .from('item_reasons')
      .select('reason_type')
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .eq('is_starter_template', true)

    // Group by reason_type
    const typeGroups: Record<string, number> = {}
    for (const r of byType || []) {
      const type = r.reason_type || 'unique'
      typeGroups[type] = (typeGroups[type] || 0) + 1
    }

    const byReasonType = Object.entries(typeGroups).map(([type, count]) => ({
      reasonType: type,
      displayName: formatReasonType(type),
      count
    }))

    return c.json({
      totalReasons: totalReasons || 0,
      markedAsStarter: markedAsStarter || 0,
      pendingReview: pendingReview || 0,
      byReasonType
    } as StarterReasonStats)
  } catch (error) {
    console.error('Failed to get starter reason stats:', error)
    return c.json({ error: 'Failed to get stats' }, 500)
  }
})

/**
 * GET /api/v1/admin/starter-reasons
 * List all starter reasons for preview
 */
starterReasonsRoutes.get('/', async (c) => {
  const { organization_id } = c.req.query()

  if (!organization_id) {
    return c.json({ error: 'organization_id is required' }, 400)
  }

  try {
    const { data: reasons, error } = await supabaseAdmin
      .from('item_reasons')
      .select(`
        id,
        reason_text,
        reason_type,
        default_rag,
        customer_description,
        suggested_follow_up_days,
        ai_generated,
        ai_reviewed,
        is_starter_template,
        category:reason_categories(name, color),
        template_item:template_items(name)
      `)
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .eq('is_starter_template', true)
      .order('reason_type')
      .order('sort_order')

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Group by reason_type
    const grouped: Record<string, typeof reasons> = {}
    const unique: typeof reasons = []

    for (const r of reasons || []) {
      if (r.reason_type) {
        if (!grouped[r.reason_type]) {
          grouped[r.reason_type] = []
        }
        grouped[r.reason_type].push(r)
      } else {
        unique.push(r)
      }
    }

    return c.json({
      byReasonType: Object.entries(grouped).map(([type, items]) => ({
        reasonType: type,
        displayName: formatReasonType(type),
        reasons: items.map(formatReason)
      })),
      uniqueItems: unique.map(formatReason),
      total: reasons?.length || 0
    })
  } catch (error) {
    console.error('Failed to get starter reasons:', error)
    return c.json({ error: 'Failed to get reasons' }, 500)
  }
})

/**
 * POST /api/v1/admin/starter-reasons/mark-as-starter
 * Mark reasons as starter templates
 */
starterReasonsRoutes.post('/mark-as-starter', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()
  const { organization_id, reason_ids, mark_all_reviewed } = body

  if (!organization_id) {
    return c.json({ error: 'organization_id is required' }, 400)
  }

  try {
    let updateCount = 0

    if (mark_all_reviewed) {
      // Mark all AI-reviewed reasons as starter
      const { count, error } = await supabaseAdmin
        .from('item_reasons')
        .update({ is_starter_template: true })
        .eq('organization_id', organization_id)
        .eq('is_active', true)
        .eq('ai_reviewed', true)
        .eq('is_starter_template', false)

      if (error) throw error
      updateCount = count || 0
    } else if (reason_ids?.length > 0) {
      // Mark specific reasons as starter
      const { count, error } = await supabaseAdmin
        .from('item_reasons')
        .update({ is_starter_template: true })
        .eq('organization_id', organization_id)
        .in('id', reason_ids)

      if (error) throw error
      updateCount = count || 0
    } else {
      return c.json({ error: 'Either reason_ids or mark_all_reviewed is required' }, 400)
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'mark_starter_reasons',
      'item_reasons',
      organization_id,
      { count: updateCount, mark_all_reviewed: !!mark_all_reviewed },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      success: true,
      marked: updateCount
    })
  } catch (error) {
    console.error('Failed to mark as starter:', error)
    return c.json({ error: 'Failed to mark reasons as starter' }, 500)
  }
})

/**
 * POST /api/v1/admin/starter-reasons/unmark
 * Remove starter template flag from reasons
 */
starterReasonsRoutes.post('/unmark', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()
  const { organization_id, reason_ids, unmark_all } = body

  if (!organization_id) {
    return c.json({ error: 'organization_id is required' }, 400)
  }

  try {
    let updateCount = 0

    if (unmark_all) {
      const { count, error } = await supabaseAdmin
        .from('item_reasons')
        .update({ is_starter_template: false })
        .eq('organization_id', organization_id)
        .eq('is_starter_template', true)

      if (error) throw error
      updateCount = count || 0
    } else if (reason_ids?.length > 0) {
      const { count, error } = await supabaseAdmin
        .from('item_reasons')
        .update({ is_starter_template: false })
        .eq('organization_id', organization_id)
        .in('id', reason_ids)

      if (error) throw error
      updateCount = count || 0
    } else {
      return c.json({ error: 'Either reason_ids or unmark_all is required' }, 400)
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'unmark_starter_reasons',
      'item_reasons',
      organization_id,
      { count: updateCount, unmark_all: !!unmark_all },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      success: true,
      unmarked: updateCount
    })
  } catch (error) {
    console.error('Failed to unmark starter reasons:', error)
    return c.json({ error: 'Failed to unmark reasons' }, 500)
  }
})

/**
 * POST /api/v1/admin/organizations/:id/copy-starter-reasons
 * Copy starter reasons to an organization
 */
starterReasonsRoutes.post('/organizations/:id/copy-starter-reasons', async (c) => {
  const superAdmin = c.get('superAdmin')
  const targetOrgId = c.req.param('id')
  const body = await c.req.json()
  const { source_organization_id } = body

  try {
    // Call the database function
    const { data, error } = await supabaseAdmin.rpc('copy_starter_reasons_to_org', {
      target_org_id: targetOrgId,
      source_org_id: source_organization_id || null
    })

    if (error) {
      console.error('Failed to copy starter reasons:', error)
      return c.json({ error: error.message }, 500)
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'copy_starter_reasons',
      'item_reasons',
      targetOrgId,
      { copied: data, source_org_id: source_organization_id },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      success: true,
      copied: data
    })
  } catch (error) {
    console.error('Failed to copy starter reasons:', error)
    return c.json({ error: 'Failed to copy reasons' }, 500)
  }
})

/**
 * GET /api/v1/admin/platform/starter-settings
 * Get global starter reason settings
 */
starterReasonsRoutes.get('/platform/starter-settings', async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'starter_reasons')
      .single()

    if (error && error.code !== 'PGRST116') { // Not found is OK
      return c.json({ error: error.message }, 500)
    }

    const settings = data?.settings as Record<string, unknown> || {}

    return c.json({
      sourceOrganizationId: settings.source_organization_id || null,
      autoCopyOnCreate: settings.auto_copy_on_create ?? true
    })
  } catch (error) {
    console.error('Failed to get starter settings:', error)
    return c.json({ error: 'Failed to get settings' }, 500)
  }
})

/**
 * PATCH /api/v1/admin/platform/starter-settings
 * Update global starter reason settings
 */
starterReasonsRoutes.patch('/platform/starter-settings', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()
  const { source_organization_id, auto_copy_on_create } = body

  try {
    const settings: Record<string, unknown> = {}
    if (source_organization_id !== undefined) {
      settings.source_organization_id = source_organization_id
    }
    if (auto_copy_on_create !== undefined) {
      settings.auto_copy_on_create = auto_copy_on_create
    }

    const { error } = await supabaseAdmin
      .from('platform_settings')
      .upsert({
        id: 'starter_reasons',
        settings,
        updated_at: new Date().toISOString()
      })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'update_starter_settings',
      'platform_settings',
      undefined,
      settings,
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to update starter settings:', error)
    return c.json({ error: 'Failed to update settings' }, 500)
  }
})

// Helper: Format reason type for display
function formatReasonType(type: string): string {
  if (type === 'unique') return 'Unique Items'
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Helper: Format reason for response
function formatReason(r: Record<string, unknown>) {
  const category = r.category as { name?: string; color?: string } | null
  const templateItem = r.template_item as { name?: string } | null
  return {
    id: r.id,
    reasonText: r.reason_text,
    reasonType: r.reason_type,
    defaultRag: r.default_rag,
    customerDescription: r.customer_description,
    followUpDays: r.suggested_follow_up_days,
    aiGenerated: r.ai_generated,
    aiReviewed: r.ai_reviewed,
    isStarter: r.is_starter_template,
    categoryName: category?.name,
    categoryColor: category?.color,
    itemName: templateItem?.name
  }
}

export default starterReasonsRoutes
