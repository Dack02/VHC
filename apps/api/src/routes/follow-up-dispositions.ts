/**
 * Follow-Up Dispositions — configurable interim call results (No Answer, ...).
 * Mounted at /api/v1/organizations/:orgId/follow-up-dispositions
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const dispositions = new Hono()
dispositions.use('*', authMiddleware)

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapDisposition = (d: any) => ({
  id: d.id,
  name: d.name,
  description: d.description,
  snoozeDays: d.snooze_days,
  isActive: d.is_active,
  isSystem: d.is_system,
  sortOrder: d.sort_order,
  createdAt: d.created_at,
  updatedAt: d.updated_at,
})

// GET /
dispositions.get('/', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('follow_up_dispositions')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ dispositions: (data || []).map(mapDisposition) })
})

// POST /
dispositions.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { name, description, snooze_days } = await c.req.json()
  if (!name || !name.trim()) return c.json({ error: 'Name is required' }, 400)

  const { data: maxSort } = await supabaseAdmin
    .from('follow_up_dispositions')
    .select('sort_order')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabaseAdmin
    .from('follow_up_dispositions')
    .insert({
      organization_id: orgId,
      name: name.trim(),
      description: description?.trim() || null,
      snooze_days: snooze_days === undefined || snooze_days === null || snooze_days === '' ? null : Number(snooze_days),
      sort_order: (maxSort?.sort_order || 0) + 1,
      is_system: false,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return c.json({ error: 'A disposition with this name already exists' }, 409)
    return c.json({ error: error.message }, 500)
  }
  return c.json(mapDisposition(data), 201)
})

// PATCH /:id
dispositions.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { name, description, snooze_days, sort_order } = await c.req.json()
  const { data: existing } = await supabaseAdmin
    .from('follow_up_dispositions')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Disposition not found' }, 404)

  const update: Record<string, unknown> = {}
  if (name !== undefined) update.name = name.trim()
  if (description !== undefined) update.description = description?.trim() || null
  if (snooze_days !== undefined) update.snooze_days = snooze_days === null || snooze_days === '' ? null : Number(snooze_days)
  if (sort_order !== undefined) update.sort_order = sort_order

  const { data, error } = await supabaseAdmin.from('follow_up_dispositions').update(update).eq('id', id).select().single()
  if (error) {
    if (error.code === '23505') return c.json({ error: 'A disposition with this name already exists' }, 409)
    return c.json({ error: error.message }, 500)
  }
  return c.json(mapDisposition(data))
})

// DELETE /:id — soft delete
dispositions.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data: existing } = await supabaseAdmin
    .from('follow_up_dispositions')
    .select('id, is_system')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Disposition not found' }, 404)
  if (existing.is_system) return c.json({ error: 'System dispositions cannot be deleted' }, 403)

  const { error } = await supabaseAdmin
    .from('follow_up_dispositions')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

export default dispositions
