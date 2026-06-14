/**
 * Time Tracking Settings & Categories API
 *
 * Per-organization clocking config: the indirect-time master toggle, auto-close
 * behaviour, and the configurable time categories. Mounted under
 * /api/v1/organizations. See docs/technician-job-clocking-spec.md §7.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, requireOrgAdmin } from '../middleware/auth.js'

const timeTrackingSettings = new Hono()
timeTrackingSettings.use('*', authMiddleware)

function mapCategory(cat: Record<string, any>) {
  return {
    id: cat.id,
    key: cat.key,
    label: cat.label,
    kind: cat.kind,
    isHealthCheck: cat.is_health_check === true,
    countsTowardJob: cat.counts_toward_job === true,
    colour: cat.colour,
    sortOrder: cat.sort_order,
    isActive: cat.is_active === true,
    isSystem: cat.is_system === true
  }
}

// GET /:orgId/time-tracking-settings — flags + categories
timeTrackingSettings.get('/:orgId/time-tracking-settings', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (auth.orgId !== orgId) return c.json({ error: 'Access denied' }, 403)

  const { data: settings } = await supabaseAdmin
    .from('organization_settings')
    .select('indirect_time_enabled, open_segment_stale_minutes, auto_close_at_eod')
    .eq('organization_id', orgId)
    .maybeSingle()

  const { data: categories } = await supabaseAdmin
    .from('time_entry_categories')
    .select('*')
    .eq('organization_id', orgId)
    .order('sort_order')

  return c.json({
    indirectTimeEnabled: settings?.indirect_time_enabled === true,
    openSegmentStaleMinutes: settings?.open_segment_stale_minutes ?? 600,
    autoCloseAtEod: settings?.auto_close_at_eod !== false,
    categories: (categories || []).map(mapCategory)
  })
})

// PATCH /:orgId/time-tracking-settings — update flags (org admin)
timeTrackingSettings.patch('/:orgId/time-tracking-settings', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (auth.orgId !== orgId) return c.json({ error: 'Access denied' }, 403)
  const body = await c.req.json()

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.indirectTimeEnabled !== undefined) updateData.indirect_time_enabled = body.indirectTimeEnabled === true
  if (body.openSegmentStaleMinutes !== undefined) updateData.open_segment_stale_minutes = Math.max(1, Number(body.openSegmentStaleMinutes) || 600)
  if (body.autoCloseAtEod !== undefined) updateData.auto_close_at_eod = body.autoCloseAtEod === true

  const { data: existing } = await supabaseAdmin
    .from('organization_settings')
    .select('id')
    .eq('organization_id', orgId)
    .maybeSingle()

  const selectCols = 'indirect_time_enabled, open_segment_stale_minutes, auto_close_at_eod'
  const result = existing
    ? await supabaseAdmin.from('organization_settings').update(updateData).eq('organization_id', orgId).select(selectCols).single()
    : await supabaseAdmin.from('organization_settings').insert({ organization_id: orgId, ...updateData }).select(selectCols).single()

  if (result.error) return c.json({ error: result.error.message }, 500)
  return c.json({
    indirectTimeEnabled: result.data.indirect_time_enabled === true,
    openSegmentStaleMinutes: result.data.open_segment_stale_minutes ?? 600,
    autoCloseAtEod: result.data.auto_close_at_eod !== false
  })
})

// POST /:orgId/time-entry-categories — create a custom category (org admin)
timeTrackingSettings.post('/:orgId/time-entry-categories', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (auth.orgId !== orgId) return c.json({ error: 'Access denied' }, 403)
  const body = await c.req.json()

  if (!body.label || typeof body.label !== 'string') return c.json({ error: 'label is required' }, 400)
  const kind = body.kind === 'indirect' ? 'indirect' : 'productive'
  const key = String(body.key || body.label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50)
  if (!key) return c.json({ error: 'Could not derive a key from the label' }, 400)

  const { data: maxSort } = await supabaseAdmin
    .from('time_entry_categories')
    .select('sort_order')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSort = ((maxSort?.sort_order as number) || 0) + 10

  const { data: category, error } = await supabaseAdmin
    .from('time_entry_categories')
    .insert({
      organization_id: orgId,
      key,
      label: body.label,
      kind,
      is_health_check: false,                       // custom categories are never the HC carve-out
      counts_toward_job: kind === 'productive',
      colour: body.colour || (kind === 'indirect' ? '#64748B' : '#0D9488'),
      sort_order: body.sortOrder ?? nextSort,
      is_active: body.isActive !== false,
      is_system: false
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return c.json({ error: 'A category with that name already exists' }, 409)
    return c.json({ error: error.message }, 500)
  }
  return c.json(mapCategory(category), 201)
})

// PATCH /:orgId/time-entry-categories/:categoryId — update (org admin)
timeTrackingSettings.patch('/:orgId/time-entry-categories/:categoryId', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const categoryId = c.req.param('categoryId')
  if (auth.orgId !== orgId) return c.json({ error: 'Access denied' }, 403)
  const body = await c.req.json()

  const { data: existing } = await supabaseAdmin
    .from('time_entry_categories')
    .select('id, is_system')
    .eq('id', categoryId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Category not found' }, 404)

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.label !== undefined) updateData.label = body.label
  if (body.colour !== undefined) updateData.colour = body.colour
  if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder
  if (body.isActive !== undefined) updateData.is_active = body.isActive === true
  // System rows (Inspection/Repair) are renamable + recolourable but their kind,
  // key and health-check role are fixed.
  if (!existing.is_system && (body.kind === 'productive' || body.kind === 'indirect')) {
    updateData.kind = body.kind
    updateData.counts_toward_job = body.kind === 'productive'
  }

  const { data: category, error } = await supabaseAdmin
    .from('time_entry_categories')
    .update(updateData)
    .eq('id', categoryId)
    .select()
    .single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(mapCategory(category))
})

// DELETE /:orgId/time-entry-categories/:categoryId — delete a custom, unused category (org admin)
timeTrackingSettings.delete('/:orgId/time-entry-categories/:categoryId', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const categoryId = c.req.param('categoryId')
  if (auth.orgId !== orgId) return c.json({ error: 'Access denied' }, 403)

  const { data: existing } = await supabaseAdmin
    .from('time_entry_categories')
    .select('id, is_system')
    .eq('id', categoryId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Category not found' }, 404)
  if (existing.is_system) return c.json({ error: 'System categories cannot be deleted. Disable them instead.' }, 400)

  // Never orphan historical segments — block delete if the category is in use.
  const { count } = await supabaseAdmin
    .from('technician_time_entries')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', categoryId)
  if ((count || 0) > 0) {
    return c.json({ error: 'Category is in use by existing time entries. Disable it instead.' }, 400)
  }

  const { error } = await supabaseAdmin.from('time_entry_categories').delete().eq('id', categoryId)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

export default timeTrackingSettings
