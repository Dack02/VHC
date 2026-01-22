/**
 * AI Generation & Usage Routes
 *
 * Handles AI-powered reason generation and usage tracking/limits.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import {
  generateAndSaveReasonsForItem,
  generateAndSaveReasonsForType,
  generateAllReasonsForTemplate,
  regenerateDescriptions,
  getAIUsageSummary
} from '../../services/ai-reasons.js'
import { extractRelation, verifyReasonAccess } from './helpers.js'

const ai = new Hono()

// =============================================================================
// AI GENERATION
// =============================================================================

// POST /api/v1/template-items/:id/reasons/generate - Generate reasons for single item
ai.post('/template-items/:id/reasons/generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
    const section = extractRelation(item.section)
    const template = section ? extractRelation((section as { template?: { organization_id?: string } }).template) : null
    if ((template as { organization_id?: string })?.organization_id !== auth.orgId) {
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
ai.post('/reasons/by-type/:reasonType/generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
      const section = extractRelation(item.section)
      const template = section ? extractRelation((section as { template?: { organization_id?: string } }).template) : null
      return (template as { organization_id?: string })?.organization_id === auth.orgId
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
ai.post('/templates/:id/generate-all-reasons', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
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
ai.post('/item-reasons/:id/regenerate-descriptions', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify reason belongs to org
    const reason = await verifyReasonAccess(id, auth.orgId)

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
ai.get('/organizations/:id/ai-usage', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
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
      const user = extractRelation(log.users) as { first_name: string | null; last_name: string | null; email: string } | null
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
ai.get('/organizations/:id/ai-usage/can-generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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
ai.get('/organizations/:id/ai-usage/history', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
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
      const user = extractRelation(log.users) as { first_name: string | null; last_name: string | null; email: string } | null
      const templateItem = extractRelation(log.template_items) as { name: string } | null

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

export default ai
