/**
 * Follow-Up Outcomes — configurable close reasons (Booked, Declined, ...).
 * Mounted at /api/v1/organizations/:orgId/follow-up-outcomes
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const outcomes = new Hono()
outcomes.use('*', authMiddleware)

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapOutcome = (o: any) => ({
  id: o.id,
  name: o.name,
  description: o.description,
  isWon: o.is_won,
  isActive: o.is_active,
  isSystem: o.is_system,
  sortOrder: o.sort_order,
  createdAt: o.created_at,
  updatedAt: o.updated_at,
})

// GET /
outcomes.get('/', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('follow_up_outcomes')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ outcomes: (data || []).map(mapOutcome) })
})

// POST /seed-defaults — seed outcomes, dispositions and the default timeline
outcomes.post('/seed-defaults', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { error } = await supabaseAdmin.rpc('seed_follow_up_config_for_org', { p_organization_id: orgId })
  if (error) {
    console.error('Seed follow-up config error:', error)
    return c.json({ error: error.message }, 500)
  }
  const { data } = await supabaseAdmin
    .from('follow_up_outcomes')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  return c.json({ outcomes: (data || []).map(mapOutcome) }, 201)
})

// POST /
outcomes.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { name, description, is_won } = await c.req.json()
  if (!name || !name.trim()) return c.json({ error: 'Name is required' }, 400)

  const { data: maxSort } = await supabaseAdmin
    .from('follow_up_outcomes')
    .select('sort_order')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabaseAdmin
    .from('follow_up_outcomes')
    .insert({
      organization_id: orgId,
      name: name.trim(),
      description: description?.trim() || null,
      is_won: !!is_won,
      sort_order: (maxSort?.sort_order || 0) + 1,
      is_system: false,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return c.json({ error: 'An outcome with this name already exists' }, 409)
    return c.json({ error: error.message }, 500)
  }
  return c.json(mapOutcome(data), 201)
})

// PATCH /:id
outcomes.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { name, description, is_won, sort_order } = await c.req.json()
  const { data: existing } = await supabaseAdmin
    .from('follow_up_outcomes')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Outcome not found' }, 404)

  const update: Record<string, unknown> = {}
  if (name !== undefined) update.name = name.trim()
  if (description !== undefined) update.description = description?.trim() || null
  if (is_won !== undefined) update.is_won = !!is_won
  if (sort_order !== undefined) update.sort_order = sort_order

  const { data, error } = await supabaseAdmin.from('follow_up_outcomes').update(update).eq('id', id).select().single()
  if (error) {
    if (error.code === '23505') return c.json({ error: 'An outcome with this name already exists' }, 409)
    return c.json({ error: error.message }, 500)
  }
  return c.json(mapOutcome(data))
})

// DELETE /:id — soft delete
outcomes.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data: existing } = await supabaseAdmin
    .from('follow_up_outcomes')
    .select('id, is_system')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Outcome not found' }, 404)
  if (existing.is_system) return c.json({ error: 'System outcomes cannot be deleted' }, 403)

  const { error } = await supabaseAdmin
    .from('follow_up_outcomes')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

export default outcomes
