import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'

/**
 * Service Types — org-scoped, single-select lookup for the Jobsheet "Service Type"
 * field (MOT, Service, Repair…). Managed in Settings and addable inline from the
 * booking UI. Mirrors the tyre-manufacturers lookup CRUD pattern.
 */
const serviceTypes = new Hono()

serviceTypes.use('*', authMiddleware)
serviceTypes.use('*', requireModule('jobsheets'))

// UK garage defaults — lazy-seeded for an org that has none yet.
const DEFAULTS: Array<{ code: string; colour: string }> = [
  { code: 'MOT', colour: '#EF4444' },
  { code: 'Full Service', colour: '#16A34A' },
  { code: 'Interim Service', colour: '#22C55E' },
  { code: 'Repair', colour: '#F59E0B' },
  { code: 'Diagnostic', colour: '#6366F1' },
  { code: 'Tyres', colour: '#0EA5E9' },
  { code: 'Air Conditioning', colour: '#06B6D4' },
  { code: 'Warranty', colour: '#8B5CF6' }
]

type Row = { id: string; code: string; label: string | null; colour: string; sort_order: number; is_active: boolean }

const shape = (r: Row) => ({
  id: r.id,
  code: r.code,
  label: r.label ?? r.code,
  colour: r.colour,
  sortOrder: r.sort_order,
  isActive: r.is_active
})

// GET / - list service types for org (lazy-seeds defaults if empty)
serviceTypes.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { active_only } = c.req.query()

    const fetchAll = async () => {
      let query = supabaseAdmin
        .from('service_types')
        .select('*')
        .eq('organization_id', auth.orgId)
        .order('sort_order', { ascending: true })
        .order('code', { ascending: true })
      if (active_only === 'true') query = query.eq('is_active', true)
      return query
    }

    let { data, error } = await fetchAll()
    if (error) return c.json({ error: error.message }, 500)

    // Lazy-seed defaults for brand-new orgs
    if (!data || data.length === 0) {
      await supabaseAdmin.from('service_types').insert(
        DEFAULTS.map((d, i) => ({
          organization_id: auth.orgId,
          code: d.code,
          label: d.code,
          colour: d.colour,
          sort_order: (i + 1) * 10
        }))
      )
      ;({ data, error } = await fetchAll())
      if (error) return c.json({ error: error.message }, 500)
    }

    return c.json({ serviceTypes: (data || []).map(shape) })
  } catch (error) {
    console.error('List service types error:', error)
    return c.json({ error: 'Failed to list service types' }, 500)
  }
})

// POST / - create service type
serviceTypes.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const code: string | undefined = body.code?.trim()
    if (!code) return c.json({ error: 'Code is required' }, 400)

    const { data: maxOrder } = await supabaseAdmin
      .from('service_types')
      .select('sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data, error } = await supabaseAdmin
      .from('service_types')
      .insert({
        organization_id: auth.orgId,
        code,
        label: body.label?.trim() || code,
        colour: body.colour || '#6366F1',
        sort_order: (maxOrder?.sort_order || 0) + 10,
        is_active: true
      })
      .select()
      .single()

    if (error) {
      if (error.message.includes('duplicate')) return c.json({ error: 'Service type already exists' }, 400)
      return c.json({ error: error.message }, 500)
    }
    return c.json(shape(data), 201)
  } catch (error) {
    console.error('Create service type error:', error)
    return c.json({ error: 'Failed to create service type' }, 500)
  }
})

// PATCH /:id - update
serviceTypes.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const updateData: Record<string, unknown> = {}
    if (body.code !== undefined) updateData.code = body.code.trim()
    if (body.label !== undefined) updateData.label = body.label?.trim() || null
    if (body.colour !== undefined) updateData.colour = body.colour
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder
    if (body.isActive !== undefined) updateData.is_active = body.isActive

    const { data, error } = await supabaseAdmin
      .from('service_types')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    return c.json(shape(data))
  } catch (error) {
    console.error('Update service type error:', error)
    return c.json({ error: 'Failed to update service type' }, 500)
  }
})

// DELETE /:id
serviceTypes.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { error } = await supabaseAdmin
      .from('service_types')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ message: 'Service type deleted' })
  } catch (error) {
    console.error('Delete service type error:', error)
    return c.json({ error: 'Failed to delete service type' }, 500)
  }
})

export default serviceTypes
