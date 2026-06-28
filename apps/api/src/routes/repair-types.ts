import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

/**
 * Repair Types — org-scoped, single-select lookup chosen PER WORK GROUP when
 * pricing (Clutch, Suspension, Service, MOT, Diagnostic…). Each type points at a
 * default labour code (the labour-rate feed) and powers repair-type reporting.
 *
 * NOT gated behind the jobsheets module: VHC repair items need it too, and they
 * exist without GMS. It is a core pricing primitive (like labour_codes). Plan:
 * GMS/REPAIR_TYPES.md. Soft-delete (is_active) so historical reports stay resolvable.
 */
const repairTypes = new Hono()

repairTypes.use('*', authMiddleware)

// UK garage defaults — lazy-seeded for an org that has none yet. Each maps to a
// labour code (resolved per org at seed time; NULL if the code is absent).
const DEFAULTS: Array<{ code: string; colour: string; labourCode: string; isMot?: boolean }> = [
  { code: 'Service', colour: '#16A34A', labourCode: 'LAB' },
  { code: 'MOT', colour: '#EF4444', labourCode: 'MOT', isMot: true },
  { code: 'Diagnostic', colour: '#6366F1', labourCode: 'DIAG' },
  { code: 'Tyres', colour: '#0EA5E9', labourCode: 'LAB' },
  { code: 'Brakes', colour: '#F97316', labourCode: 'LAB' },
  { code: 'Suspension', colour: '#8B5CF6', labourCode: 'LAB' },
  { code: 'Clutch', colour: '#0D9488', labourCode: 'LAB' },
  { code: 'Air Conditioning', colour: '#06B6D4', labourCode: 'LAB' }
]

type Row = {
  id: string
  code: string
  label: string | null
  colour: string
  default_labour_code_id: string | null
  default_discount_percent: number | string | null
  sort_order: number
  is_active: boolean
  is_mot: boolean | null
}

const shape = (r: Row) => ({
  id: r.id,
  code: r.code,
  label: r.label ?? r.code,
  colour: r.colour,
  defaultLabourCodeId: r.default_labour_code_id,
  defaultDiscountPercent: Number(r.default_discount_percent) || 0,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  isMot: r.is_mot ?? false
})

// Clamp a user-supplied percentage to 0–100 (mirrors the DB CHECK constraint).
const clampPercent = (v: unknown): number => {
  const n = parseFloat(v as string)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

// GET / - list repair types for org (lazy-seeds defaults if empty)
repairTypes.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { active_only } = c.req.query()

    const fetchAll = async () => {
      let query = supabaseAdmin
        .from('repair_types')
        .select('*')
        .eq('organization_id', auth.orgId)
        .order('sort_order', { ascending: true })
        .order('code', { ascending: true })
      if (active_only === 'true') query = query.eq('is_active', true)
      return query
    }

    let { data, error } = await fetchAll()
    if (error) return c.json({ error: error.message }, 500)

    // Lazy-seed defaults for brand-new orgs, mapping each to the org's labour code.
    if (!data || data.length === 0) {
      const { data: codes } = await supabaseAdmin
        .from('labour_codes')
        .select('id, code')
        .eq('organization_id', auth.orgId)
        .eq('is_active', true)
      const codeMap = new Map((codes || []).map((lc) => [lc.code, lc.id]))

      await supabaseAdmin.from('repair_types').insert(
        DEFAULTS.map((d, i) => ({
          organization_id: auth.orgId,
          code: d.code,
          label: d.code,
          colour: d.colour,
          default_labour_code_id: codeMap.get(d.labourCode) ?? null,
          is_mot: d.isMot ?? false,
          sort_order: (i + 1) * 10
        }))
      )
      ;({ data, error } = await fetchAll())
      if (error) return c.json({ error: error.message }, 500)
    }

    return c.json({ repairTypes: (data || []).map(shape) })
  } catch (error) {
    console.error('List repair types error:', error)
    return c.json({ error: 'Failed to list repair types' }, 500)
  }
})

// POST / - create repair type
repairTypes.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const code: string | undefined = body.code?.trim()
    if (!code) return c.json({ error: 'Code is required' }, 400)

    const { data: maxOrder } = await supabaseAdmin
      .from('repair_types')
      .select('sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data, error } = await supabaseAdmin
      .from('repair_types')
      .insert({
        organization_id: auth.orgId,
        code,
        label: body.label?.trim() || code,
        colour: body.colour || '#6366F1',
        default_labour_code_id: body.defaultLabourCodeId || null,
        default_discount_percent: clampPercent(body.defaultDiscountPercent),
        is_mot: Boolean(body.isMot),
        sort_order: (maxOrder?.sort_order || 0) + 10,
        is_active: true
      })
      .select()
      .single()

    if (error) {
      if (error.message.includes('duplicate')) return c.json({ error: 'Repair type already exists' }, 400)
      return c.json({ error: error.message }, 500)
    }
    return c.json(shape(data), 201)
  } catch (error) {
    console.error('Create repair type error:', error)
    return c.json({ error: 'Failed to create repair type' }, 500)
  }
})

// PATCH /:id - update
repairTypes.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const updateData: Record<string, unknown> = {}
    if (body.code !== undefined) updateData.code = body.code.trim()
    if (body.label !== undefined) updateData.label = body.label?.trim() || null
    if (body.colour !== undefined) updateData.colour = body.colour
    if (body.defaultLabourCodeId !== undefined) updateData.default_labour_code_id = body.defaultLabourCodeId || null
    if (body.defaultDiscountPercent !== undefined) updateData.default_discount_percent = clampPercent(body.defaultDiscountPercent)
    if (body.isMot !== undefined) updateData.is_mot = Boolean(body.isMot)
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder
    if (body.isActive !== undefined) updateData.is_active = body.isActive

    const { data, error } = await supabaseAdmin
      .from('repair_types')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    return c.json(shape(data))
  } catch (error) {
    console.error('Update repair type error:', error)
    return c.json({ error: 'Failed to update repair type' }, 500)
  }
})

// DELETE /:id - SOFT delete (is_active=false) so historical reports keep a resolvable type
repairTypes.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { error } = await supabaseAdmin
      .from('repair_types')
      .update({ is_active: false })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ message: 'Repair type deactivated' })
  } catch (error) {
    console.error('Delete repair type error:', error)
    return c.json({ error: 'Failed to delete repair type' }, 500)
  }
})

export default repairTypes
