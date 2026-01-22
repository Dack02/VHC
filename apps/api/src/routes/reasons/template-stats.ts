/**
 * Template Stats & Settings Routes
 *
 * Handles reason categories, organization tone settings,
 * template reason summaries, and reason usage statistics.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { formatCategoryResponse, extractRelation } from './helpers.js'

const templateStats = new Hono()

// =============================================================================
// REASON CATEGORIES
// =============================================================================

// GET /api/v1/reason-categories - Get all reason categories
templateStats.get('/reason-categories', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('reason_categories')
      .select('*')
      .order('display_order', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      categories: data?.map(formatCategoryResponse)
    })
  } catch (error) {
    console.error('Get reason categories error:', error)
    return c.json({ error: 'Failed to get reason categories' }, 500)
  }
})

// =============================================================================
// ORGANIZATION TONE SETTING
// =============================================================================

// GET /api/v1/organizations/:id/settings/reason-tone - Get tone setting
templateStats.get('/organizations/:id/settings/reason-tone', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
templateStats.patch('/organizations/:id/settings/reason-tone', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
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
// TEMPLATE REASONS SUMMARY
// =============================================================================

// GET /api/v1/templates/:id/reasons-summary - Get reasons summary grouped by type and items
templateStats.get('/templates/:id/reasons-summary', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
templateStats.get('/templates/:id/item-reason-counts', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
      const section = extractRelation(item.section)
      const template = section ? extractRelation((section as { template?: { organization_id?: string } }).template) : null
      return (template as { organization_id?: string })?.organization_id === auth.orgId
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

// =============================================================================
// REASON STATS
// =============================================================================

// GET /api/v1/organizations/:id/reason-stats - Get reason usage and approval statistics
templateStats.get('/organizations/:id/reason-stats', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
      const cat = extractRelation(r.category)
      const item = extractRelation(r.template_item)
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
        categoryName: (cat as { name?: string })?.name,
        categoryColor: (cat as { color?: string })?.color,
        itemName: (item as { name?: string })?.name,
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

export default templateStats
