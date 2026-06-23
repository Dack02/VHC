import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'

/**
 * Booking Codes — org-scoped, MULTI-select lookup for the Jobsheet "Booking Codes"
 * field (the renamed Garage-Hive "Extended Status Code"). Managed in Settings and
 * addable inline from the booking UI. Mirrors the service-types lookup CRUD pattern.
 */
const bookingCodes = new Hono()

bookingCodes.use('*', authMiddleware)
bookingCodes.use('*', requireModule('jobsheets'))

const DEFAULTS: Array<{ code: string; colour: string }> = [
  { code: 'Waiting', colour: '#EF4444' },
  { code: 'Drop Off', colour: '#6366F1' },
  { code: 'Courtesy Car', colour: '#16A34A' },
  { code: 'Collection & Delivery', colour: '#0EA5E9' },
  { code: 'Fleet', colour: '#F59E0B' },
  { code: 'Warranty Work', colour: '#8B5CF6' },
  { code: 'Internal', colour: '#64748B' }
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

// GET / - list booking codes for org (lazy-seeds defaults if empty)
bookingCodes.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { active_only } = c.req.query()

    const fetchAll = async () => {
      let query = supabaseAdmin
        .from('booking_codes')
        .select('*')
        .eq('organization_id', auth.orgId)
        .order('sort_order', { ascending: true })
        .order('code', { ascending: true })
      if (active_only === 'true') query = query.eq('is_active', true)
      return query
    }

    let { data, error } = await fetchAll()
    if (error) return c.json({ error: error.message }, 500)

    if (!data || data.length === 0) {
      await supabaseAdmin.from('booking_codes').insert(
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

    return c.json({ bookingCodes: (data || []).map(shape) })
  } catch (error) {
    console.error('List booking codes error:', error)
    return c.json({ error: 'Failed to list booking codes' }, 500)
  }
})

// POST / - create booking code
bookingCodes.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const code: string | undefined = body.code?.trim()
    if (!code) return c.json({ error: 'Code is required' }, 400)

    const { data: maxOrder } = await supabaseAdmin
      .from('booking_codes')
      .select('sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data, error } = await supabaseAdmin
      .from('booking_codes')
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
      if (error.message.includes('duplicate')) return c.json({ error: 'Booking code already exists' }, 400)
      return c.json({ error: error.message }, 500)
    }
    return c.json(shape(data), 201)
  } catch (error) {
    console.error('Create booking code error:', error)
    return c.json({ error: 'Failed to create booking code' }, 500)
  }
})

// PATCH /:id - update
bookingCodes.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
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
      .from('booking_codes')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    return c.json(shape(data))
  } catch (error) {
    console.error('Update booking code error:', error)
    return c.json({ error: 'Failed to update booking code' }, 500)
  }
})

// DELETE /:id
bookingCodes.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { error } = await supabaseAdmin
      .from('booking_codes')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ message: 'Booking code deleted' })
  } catch (error) {
    console.error('Delete booking code error:', error)
    return c.json({ error: 'Failed to delete booking code' }, 500)
  }
})

export default bookingCodes
