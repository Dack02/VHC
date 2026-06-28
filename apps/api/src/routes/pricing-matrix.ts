import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

/**
 * Pricing-matrix config (GMS/PARTS.md §5.12, P3). The banded-markup engine is a pricing
 * feature available to ALL orgs (Simple + Full), so this is NOT gated by parts_stock —
 * only by role. The master switch is organization_settings.pricing_matrix_enabled
 * (default off); bands are seeded but inert until the org turns it on.
 */
const pricingMatrix = new Hono()
pricingMatrix.use('*', authMiddleware)

const ADMIN_ROLES = ['super_admin', 'org_admin', 'site_admin'] as const
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : d
}

interface BandRow {
  id: string
  cost_from: number | string
  cost_to: number | string | null
  markup_pct: number | string | null
  multiplier: number | string | null
  sort_order: number
}

// GET / — the toggle + every matrix with its bands
pricingMatrix.get('/', authorize([...ADMIN_ROLES, 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { data: settings } = await supabaseAdmin
      .from('organization_settings')
      .select('pricing_matrix_enabled, default_margin_percent')
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    // Seed-on-read: if the org has no matrix yet, create the default bands so the page is never empty.
    const { count } = await supabaseAdmin
      .from('pricing_matrix')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)
    if (!count) {
      await supabaseAdmin.rpc('seed_default_pricing_matrix_for_org', { p_organization_id: auth.orgId })
    }

    const { data: matrices } = await supabaseAdmin
      .from('pricing_matrix')
      .select('id, name, category_id, category:part_categories(name), is_default, is_active, bands:pricing_matrix_bands(id, cost_from, cost_to, markup_pct, multiplier, sort_order)')
      .eq('organization_id', auth.orgId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true })

    return c.json({
      enabled: !!settings?.pricing_matrix_enabled,
      defaultMarginPercent: num(settings?.default_margin_percent, 40),
      matrices: (matrices ?? []).map((m) => {
        const cat = m.category as unknown as { name?: string } | null
        const bands = (m.bands as unknown as BandRow[] | null) ?? []
        return {
          id: m.id,
          name: m.name,
          categoryId: m.category_id,
          categoryName: cat?.name ?? null,
          isDefault: m.is_default,
          isActive: m.is_active,
          bands: bands
            .slice()
            .sort((a, b) => (a.sort_order - b.sort_order) || (num(a.cost_from) - num(b.cost_from)))
            .map((bd) => ({
              id: bd.id,
              costFrom: num(bd.cost_from),
              costTo: bd.cost_to == null ? null : num(bd.cost_to),
              markupPct: bd.markup_pct == null ? null : num(bd.markup_pct),
              multiplier: bd.multiplier == null ? null : num(bd.multiplier),
              sortOrder: bd.sort_order,
            })),
        }
      }),
    })
  } catch (err) {
    console.error('Pricing matrix list error:', err)
    return c.json({ error: 'Failed to load pricing matrix' }, 500)
  }
})

// PATCH /settings — flip the master switch
pricingMatrix.patch('/settings', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    if (typeof b.enabled !== 'boolean') return c.json({ error: 'enabled (boolean) is required' }, 400)
    const { error } = await supabaseAdmin
      .from('organization_settings')
      .update({ pricing_matrix_enabled: b.enabled, updated_at: new Date().toISOString() })
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true, enabled: b.enabled })
  } catch (err) {
    console.error('Pricing matrix settings error:', err)
    return c.json({ error: 'Failed to update setting' }, 500)
  }
})

// POST / — create a matrix (org default if categoryId omitted; else per-category)
pricingMatrix.post('/', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    if (!b.name || typeof b.name !== 'string') return c.json({ error: 'name is required' }, 400)
    const isDefault = !b.categoryId && b.isDefault !== false
    if (isDefault) {
      // Only one default per org — clear any existing default first (partial unique index).
      await supabaseAdmin.from('pricing_matrix').update({ is_default: false }).eq('organization_id', auth.orgId).eq('is_default', true)
    }
    const { data, error } = await supabaseAdmin
      .from('pricing_matrix')
      .insert({
        organization_id: auth.orgId,
        name: b.name.trim(),
        category_id: b.categoryId ?? null,
        is_default: isDefault,
        is_active: true,
        created_by: auth.user.id,
      })
      .select('id')
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true, id: data?.id })
  } catch (err) {
    console.error('Pricing matrix create error:', err)
    return c.json({ error: 'Failed to create matrix' }, 500)
  }
})

// PUT /:id — rename / toggle active / set default
pricingMatrix.put('/:id', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof b.name === 'string' && b.name.trim()) update.name = b.name.trim()
    if (typeof b.isActive === 'boolean') update.is_active = b.isActive
    if (b.isDefault === true) {
      await supabaseAdmin.from('pricing_matrix').update({ is_default: false }).eq('organization_id', auth.orgId).eq('is_default', true)
      update.is_default = true
    }
    const { error } = await supabaseAdmin
      .from('pricing_matrix')
      .update(update)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true })
  } catch (err) {
    console.error('Pricing matrix update error:', err)
    return c.json({ error: 'Failed to update matrix' }, 500)
  }
})

// DELETE /:id — remove a matrix (cannot delete the org default)
pricingMatrix.delete('/:id', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data: m } = await supabaseAdmin
      .from('pricing_matrix')
      .select('id, is_default')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (!m) return c.json({ error: 'Matrix not found' }, 404)
    if (m.is_default) return c.json({ error: 'Cannot delete the default matrix' }, 400)
    const { error } = await supabaseAdmin.from('pricing_matrix').delete().eq('id', id).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true })
  } catch (err) {
    console.error('Pricing matrix delete error:', err)
    return c.json({ error: 'Failed to delete matrix' }, 500)
  }
})

// PUT /:id/bands — replace the full band set for a matrix
pricingMatrix.put('/:id/bands', authorize([...ADMIN_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const bands: Array<{ costFrom: number; costTo: number | null; markupPct: number | null; multiplier: number | null }> = Array.isArray(b.bands) ? b.bands : []

    const { data: m } = await supabaseAdmin
      .from('pricing_matrix')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (!m) return c.json({ error: 'Matrix not found' }, 404)

    // Validate: each band needs exactly one of markupPct / multiplier, and a sane range.
    for (const bd of bands) {
      const hasMarkup = bd.markupPct != null && Number.isFinite(num(bd.markupPct))
      const hasMult = bd.multiplier != null && Number.isFinite(num(bd.multiplier))
      if (hasMarkup === hasMult) return c.json({ error: 'Each band must set exactly one of markup % or multiplier' }, 400)
      if (bd.costTo != null && num(bd.costTo) <= num(bd.costFrom)) return c.json({ error: 'Band "cost to" must be greater than "cost from"' }, 400)
    }

    await supabaseAdmin.from('pricing_matrix_bands').delete().eq('pricing_matrix_id', id).eq('organization_id', auth.orgId)
    if (bands.length > 0) {
      const rows = bands
        .slice()
        .sort((x, y) => num(x.costFrom) - num(y.costFrom))
        .map((bd, i) => ({
          organization_id: auth.orgId,
          pricing_matrix_id: id,
          cost_from: num(bd.costFrom),
          cost_to: bd.costTo == null ? null : num(bd.costTo),
          markup_pct: bd.markupPct == null ? null : num(bd.markupPct),
          multiplier: bd.multiplier == null ? null : num(bd.multiplier),
          sort_order: i + 1,
        }))
      const { error } = await supabaseAdmin.from('pricing_matrix_bands').insert(rows)
      if (error) return c.json({ error: error.message }, 500)
    }
    return c.json({ ok: true })
  } catch (err) {
    console.error('Pricing matrix bands error:', err)
    return c.json({ error: 'Failed to save bands' }, 500)
  }
})

export default pricingMatrix
