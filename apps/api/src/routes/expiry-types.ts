/**
 * Org expiry-type configuration (MOT / Service / Road Tax seeded as system types;
 * tenants add their own — cambelt, air-con, warranty, etc.). These typed rows
 * drive per-vehicle expiry tracking and reminder campaigns.
 *
 * Gated by the `vehicles` module. See routes/vehicles.ts (per-vehicle expiries),
 * routes/expiry-campaigns.ts, services/vehicle-expiry.ts.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { ensureExpiryTypesSeeded } from '../services/vehicle-expiry.js'

const expiryTypes = new Hono()

expiryTypes.use('*', authMiddleware)
expiryTypes.use('*', requireModule('vehicles'))

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'custom'
}

// GET / — list (lazy-seeds the system types for orgs predating the backfill)
expiryTypes.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    await ensureExpiryTypesSeeded(auth.orgId)
    const { data, error } = await supabaseAdmin
      .from('expiry_types')
      .select('*')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ types: data || [] })
  } catch (error) {
    console.error('List expiry types error:', error)
    return c.json({ error: 'Failed to list expiry types' }, 500)
  }
})

// POST / — create a custom expiry type
expiryTypes.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { label, isMileageBased = false, defaultIntervalMonths, defaultIntervalMiles, defaultChannel = 'sms', defaultLeadDays = 30 } = body
    if (!label || !String(label).trim()) return c.json({ error: 'Label is required' }, 400)

    const code = slugify(String(label))
    const { data, error } = await supabaseAdmin
      .from('expiry_types')
      .insert({
        organization_id: auth.orgId,
        code,
        label: String(label).trim(),
        is_system: false,
        is_mileage_based: !!isMileageBased,
        default_interval_months: defaultIntervalMonths ?? null,
        default_interval_miles: defaultIntervalMiles ?? null,
        default_channel: defaultChannel,
        default_lead_days: defaultLeadDays
      })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') return c.json({ error: 'An expiry type with that name already exists' }, 409)
      return c.json({ error: error.message }, 500)
    }
    return c.json(data, 201)
  } catch (error) {
    console.error('Create expiry type error:', error)
    return c.json({ error: 'Failed to create expiry type' }, 500)
  }
})

// PATCH /:id — edit (system types: label/lead/channel/active only; code is fixed)
expiryTypes.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const update: Record<string, unknown> = {}
    if (body.label !== undefined) update.label = String(body.label).trim()
    if (body.isMileageBased !== undefined) update.is_mileage_based = !!body.isMileageBased
    if (body.defaultIntervalMonths !== undefined) update.default_interval_months = body.defaultIntervalMonths ?? null
    if (body.defaultIntervalMiles !== undefined) update.default_interval_miles = body.defaultIntervalMiles ?? null
    if (body.defaultChannel !== undefined) update.default_channel = body.defaultChannel
    if (body.defaultLeadDays !== undefined) update.default_lead_days = body.defaultLeadDays
    if (body.isActive !== undefined) update.is_active = !!body.isActive
    if (body.sortOrder !== undefined) update.sort_order = body.sortOrder
    if (Object.keys(update).length === 0) return c.json({ error: 'Nothing to update' }, 400)

    const { data, error } = await supabaseAdmin
      .from('expiry_types')
      .update(update)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select('*')
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  } catch (error) {
    console.error('Update expiry type error:', error)
    return c.json({ error: 'Failed to update expiry type' }, 500)
  }
})

// DELETE /:id — delete a custom (non-system) type
expiryTypes.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data: type } = await supabaseAdmin
      .from('expiry_types').select('id, is_system').eq('id', id).eq('organization_id', auth.orgId).maybeSingle()
    if (!type) return c.json({ error: 'Expiry type not found' }, 404)
    if (type.is_system) return c.json({ error: 'System expiry types cannot be deleted (you can deactivate them)' }, 400)
    const { error } = await supabaseAdmin
      .from('expiry_types').delete().eq('id', id).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ success: true })
  } catch (error) {
    console.error('Delete expiry type error:', error)
    return c.json({ error: 'Failed to delete expiry type' }, 500)
  }
})

export default expiryTypes
