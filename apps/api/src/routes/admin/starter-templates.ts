/**
 * Starter Inspection Template API Routes (Super Admin only)
 * Designates a platform "starter" inspection template that is deep-copied into
 * each new organization on creation, so a freshly-onboarded org can immediately
 * create a health check. Mirrors the starter-reasons mechanism.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity, getClientIp } from '../../middleware/auth.js'

const starterTemplatesRoutes = new Hono()

// All routes require super admin authentication
starterTemplatesRoutes.use('*', superAdminMiddleware)

/**
 * GET /api/v1/admin/starter-templates?organization_id=...
 * List an organisation's inspection templates with their starter flag and a
 * section/item count, so a super admin can choose which to mark as the starter.
 */
starterTemplatesRoutes.get('/', async (c) => {
  const { organization_id } = c.req.query()

  if (!organization_id) {
    return c.json({ error: 'organization_id is required' }, 400)
  }

  try {
    const { data: templates, error } = await supabaseAdmin
      .from('check_templates')
      .select(`
        id,
        name,
        description,
        is_active,
        is_default,
        is_starter_template,
        sections:template_sections(id, items:template_items(id))
      `)
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .order('name')

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    const result = (templates || []).map((t) => {
      const sections = (t.sections as Array<{ id: string; items?: Array<{ id: string }> }>) || []
      const itemCount = sections.reduce((sum, s) => sum + (s.items?.length || 0), 0)
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        isDefault: t.is_default,
        isStarter: t.is_starter_template,
        sectionCount: sections.length,
        itemCount
      }
    })

    return c.json({
      templates: result,
      total: result.length,
      markedAsStarter: result.filter((t) => t.isStarter).length
    })
  } catch (error) {
    console.error('Failed to list templates:', error)
    return c.json({ error: 'Failed to list templates' }, 500)
  }
})

/**
 * POST /api/v1/admin/starter-templates/mark-as-starter
 * Flag template(s) as starter. Body: { organization_id, template_ids: string[] }
 */
starterTemplatesRoutes.post('/mark-as-starter', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()
  const { organization_id, template_ids } = body

  if (!organization_id || !Array.isArray(template_ids) || template_ids.length === 0) {
    return c.json({ error: 'organization_id and template_ids are required' }, 400)
  }

  try {
    const { error, count } = await supabaseAdmin
      .from('check_templates')
      .update({ is_starter_template: true, updated_at: new Date().toISOString() })
      .eq('organization_id', organization_id)
      .in('id', template_ids)

    if (error) throw error

    await logSuperAdminActivity(
      superAdmin.id,
      'mark_starter_template',
      'check_templates',
      organization_id,
      { count: count || template_ids.length, template_ids },
      getClientIp(c),
      c.req.header('User-Agent')
    )

    return c.json({ success: true, marked: count || template_ids.length })
  } catch (error) {
    console.error('Failed to mark starter template:', error)
    return c.json({ error: 'Failed to mark template as starter' }, 500)
  }
})

/**
 * POST /api/v1/admin/starter-templates/unmark
 * Remove the starter flag. Body: { organization_id, template_ids: string[] }
 */
starterTemplatesRoutes.post('/unmark', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()
  const { organization_id, template_ids } = body

  if (!organization_id || !Array.isArray(template_ids) || template_ids.length === 0) {
    return c.json({ error: 'organization_id and template_ids are required' }, 400)
  }

  try {
    const { error, count } = await supabaseAdmin
      .from('check_templates')
      .update({ is_starter_template: false, updated_at: new Date().toISOString() })
      .eq('organization_id', organization_id)
      .in('id', template_ids)

    if (error) throw error

    await logSuperAdminActivity(
      superAdmin.id,
      'unmark_starter_template',
      'check_templates',
      organization_id,
      { count: count || template_ids.length, template_ids },
      getClientIp(c),
      c.req.header('User-Agent')
    )

    return c.json({ success: true, unmarked: count || template_ids.length })
  } catch (error) {
    console.error('Failed to unmark starter template:', error)
    return c.json({ error: 'Failed to unmark template' }, 500)
  }
})

/**
 * POST /api/v1/admin/starter-templates/organizations/:id/copy
 * Manually copy starter template(s) into an organisation.
 * Body: { source_organization_id?: string }
 */
starterTemplatesRoutes.post('/organizations/:id/copy', async (c) => {
  const superAdmin = c.get('superAdmin')
  const targetOrgId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const { source_organization_id } = body

  try {
    const { data, error } = await supabaseAdmin.rpc('copy_starter_template_to_org', {
      target_org_id: targetOrgId,
      source_org_id: source_organization_id || null
    })

    if (error) {
      console.error('Failed to copy starter template:', error)
      return c.json({ error: error.message }, 500)
    }

    await logSuperAdminActivity(
      superAdmin.id,
      'copy_starter_template',
      'check_templates',
      targetOrgId,
      { copied: data, source_org_id: source_organization_id },
      getClientIp(c),
      c.req.header('User-Agent')
    )

    return c.json({ success: true, copied: data })
  } catch (error) {
    console.error('Failed to copy starter template:', error)
    return c.json({ error: 'Failed to copy template' }, 500)
  }
})

/**
 * GET /api/v1/admin/starter-templates/platform/starter-settings
 * Get global starter-template settings.
 */
starterTemplatesRoutes.get('/platform/starter-settings', async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'starter_template')
      .single()

    if (error && error.code !== 'PGRST116') {
      return c.json({ error: error.message }, 500)
    }

    const settings = (data?.settings as Record<string, unknown>) || {}

    return c.json({
      sourceOrganizationId: settings.source_organization_id || null,
      autoCopyOnCreate: settings.auto_copy_on_create ?? true
    })
  } catch (error) {
    console.error('Failed to get starter template settings:', error)
    return c.json({ error: 'Failed to get settings' }, 500)
  }
})

/**
 * PATCH /api/v1/admin/starter-templates/platform/starter-settings
 * Update global starter-template settings.
 */
starterTemplatesRoutes.patch('/platform/starter-settings', async (c) => {
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
        id: 'starter_template',
        settings,
        updated_at: new Date().toISOString()
      })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    await logSuperAdminActivity(
      superAdmin.id,
      'update_starter_template_settings',
      'platform_settings',
      undefined,
      settings,
      getClientIp(c),
      c.req.header('User-Agent')
    )

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to update starter template settings:', error)
    return c.json({ error: 'Failed to update settings' }, 500)
  }
})

export default starterTemplatesRoutes
