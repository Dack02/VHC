import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'

/**
 * Parts & Stock — Full-mode stock management (GMS/PARTS.md §5.2/§5.4, P0).
 * Gated behind the `parts_stock` module. Stock items are parts_catalog rows with
 * is_stocked = true; qty_on_hand / average_cost are DERIVED (only stock_movements
 * may change them — never written directly here).
 */
const partsStock = new Hono()
partsStock.use('*', authMiddleware)
partsStock.use('*', requireModule('parts_stock'))

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function stockStatus(qty: number, min: number | null): 'out' | 'low' | 'in_stock' {
  if (qty <= 0) return 'out'
  if (min != null && qty <= min) return 'low'
  return 'in_stock'
}

// GET /stock-items — list stock items (is_stocked) with status + value
partsStock.get('/stock-items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { q, category_id, include_all, page = '1', limit = '50' } = c.req.query()
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
    const from = (pageNum - 1) * lim

    let query = supabaseAdmin
      .from('parts_catalog')
      .select('id, part_number, description, category_id, is_stocked, qty_on_hand, average_cost, min_qty, max_qty, bin_location, sell_price, sell_price_override, preferred_supplier_id, is_active', { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .order('part_number', { ascending: true })
      .range(from, from + lim - 1)

    if (include_all !== 'true') query = query.eq('is_stocked', true)
    if (category_id) query = query.eq('category_id', category_id)
    if (q) query = query.or(`part_number.ilike.%${q}%,description.ilike.%${q}%`)

    const { data, count, error } = await query
    if (error) return c.json({ error: error.message }, 500)

    const items = (data ?? []).map((it) => {
      const qty = Number(it.qty_on_hand) || 0
      const avg = Number(it.average_cost) || 0
      return {
        ...it,
        qty_on_hand: qty,
        average_cost: avg,
        stock_value: round2(qty * avg),
        stock_status: stockStatus(qty, it.min_qty != null ? Number(it.min_qty) : null),
      }
    })
    return c.json({ items, total: count ?? items.length, page: pageNum, limit: lim })
  } catch (error) {
    console.error('List stock items error:', error)
    return c.json({ error: 'Failed to list stock items' }, 500)
  }
})

// POST /stock-items — create a stock item (or promote an existing catalog row)
partsStock.post('/stock-items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    if (!b.part_number || !b.description) {
      return c.json({ error: 'part_number and description are required' }, 400)
    }
    const row = {
      organization_id: auth.orgId,
      part_number: b.part_number,
      description: b.description,
      cost_price: b.cost_price ?? 0,
      category_id: b.category_id ?? null,
      is_stocked: b.is_stocked ?? true,
      unit_of_measure: b.unit_of_measure ?? 'each',
      sell_price: b.sell_price ?? null,
      sell_price_override: b.sell_price_override ?? null,
      min_qty: b.min_qty ?? null,
      max_qty: b.max_qty ?? null,
      bin_location: b.bin_location ?? null,
      preferred_supplier_id: b.preferred_supplier_id ?? null,
      vat_code: b.vat_code ?? 'STD_20',
      tyre_size: b.tyre_size ?? null,
      barcode: b.barcode ?? null,
      created_by: auth.user.id,
    }
    // Upsert on (organization_id, part_number) — promotes an existing catalog row to stocked.
    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .upsert(row, { onConflict: 'organization_id,part_number' })
      .select('id')
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ id: data.id })
  } catch (error) {
    console.error('Create stock item error:', error)
    return c.json({ error: 'Failed to create stock item' }, 500)
  }
})

// PATCH /stock-items/:id — update stock fields (NEVER qty_on_hand/average_cost — those are derived)
partsStock.patch('/stock-items/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const allowed = ['description', 'category_id', 'is_stocked', 'unit_of_measure', 'sell_price', 'sell_price_override', 'min_qty', 'max_qty', 'bin_location', 'preferred_supplier_id', 'vat_code', 'tyre_size', 'barcode', 'cost_price', 'is_active']
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of allowed) if (b[k] !== undefined) update[k] = b[k]

    const { error } = await supabaseAdmin
      .from('parts_catalog')
      .update(update)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true })
  } catch (error) {
    console.error('Update stock item error:', error)
    return c.json({ error: 'Failed to update stock item' }, 500)
  }
})

// POST /stock-items/:id/adjust — manual stock adjustment (writes a stock_movements row; the trigger updates qty)
partsStock.post('/stock-items/:id/adjust', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const qtyDelta = Number(b.qty_delta)
    if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
      return c.json({ error: 'qty_delta must be a non-zero number' }, 400)
    }
    if (!b.reason_code) return c.json({ error: 'reason_code is required for an adjustment' }, 400)

    const { data: item, error: itemErr } = await supabaseAdmin
      .from('parts_catalog')
      .select('id, average_cost, is_stocked')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (itemErr || !item) return c.json({ error: 'Stock item not found' }, 404)

    const unitCost = b.unit_cost != null ? Number(b.unit_cost) : Number(item.average_cost) || 0
    const totalCost = round2(qtyDelta * unitCost)

    const { error } = await supabaseAdmin.from('stock_movements').insert({
      organization_id: auth.orgId,
      stock_item_id: id,
      location_id: b.location_id ?? null,
      movement_type: 'adjustment',
      qty_delta: qtyDelta,
      unit_cost: unitCost,
      total_cost: totalCost,
      reference_type: 'stocktake',
      reason_code: b.reason_code,
      document_date: b.document_date ?? new Date().toISOString().slice(0, 10),
      created_by: auth.user.id,
    })
    if (error) return c.json({ error: error.message }, 500)

    const { data: updated } = await supabaseAdmin
      .from('parts_catalog')
      .select('qty_on_hand, average_cost')
      .eq('id', id)
      .maybeSingle()
    return c.json({ ok: true, qty_on_hand: Number(updated?.qty_on_hand) || 0, average_cost: Number(updated?.average_cost) || 0 })
  } catch (error) {
    console.error('Stock adjustment error:', error)
    return c.json({ error: 'Failed to adjust stock' }, 500)
  }
})

// GET /stock-items/:id/movements — movement history for an item
partsStock.get('/stock-items/:id/movements', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data, error } = await supabaseAdmin
      .from('stock_movements')
      .select('id, movement_type, qty_delta, unit_cost, total_cost, reference_type, reason_code, document_date, movement_at')
      .eq('organization_id', auth.orgId)
      .eq('stock_item_id', id)
      .order('movement_at', { ascending: false })
      .limit(500)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ movements: data ?? [] })
  } catch (error) {
    console.error('List stock movements error:', error)
    return c.json({ error: 'Failed to list movements' }, 500)
  }
})

// ===========================================================================
// Part Categories (lookup) — GMS/PARTS.md §5.1
// ===========================================================================
partsStock.get('/part-categories', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { data, error } = await supabaseAdmin
      .from('part_categories')
      .select('id, name, description, parent_id, is_active, is_system, sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ categories: data ?? [] })
  } catch (error) {
    console.error('List part categories error:', error)
    return c.json({ error: 'Failed to list part categories' }, 500)
  }
})

partsStock.post('/part-categories', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    if (!b.name) return c.json({ error: 'name is required' }, 400)
    const { data, error } = await supabaseAdmin
      .from('part_categories')
      .insert({ organization_id: auth.orgId, name: b.name, description: b.description ?? null, parent_id: b.parent_id ?? null, sort_order: b.sort_order ?? 0 })
      .select('id')
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ id: data.id })
  } catch (error) {
    console.error('Create part category error:', error)
    return c.json({ error: 'Failed to create part category' }, 500)
  }
})

partsStock.patch('/part-categories/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of ['name', 'description', 'parent_id', 'is_active', 'sort_order']) if (b[k] !== undefined) update[k] = b[k]
    const { error } = await supabaseAdmin.from('part_categories').update(update).eq('id', id).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true })
  } catch (error) {
    console.error('Update part category error:', error)
    return c.json({ error: 'Failed to update part category' }, 500)
  }
})

// ===========================================================================
// Stock Locations (lookup) — GMS/PARTS.md §5.5
// ===========================================================================
partsStock.get('/stock-locations', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { data, error } = await supabaseAdmin
      .from('stock_locations')
      .select('id, name, code, is_default, is_active, sort_order')
      .eq('organization_id', auth.orgId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ locations: data ?? [] })
  } catch (error) {
    console.error('List stock locations error:', error)
    return c.json({ error: 'Failed to list stock locations' }, 500)
  }
})

partsStock.post('/stock-locations', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    if (!b.name) return c.json({ error: 'name is required' }, 400)
    const { data, error } = await supabaseAdmin
      .from('stock_locations')
      .insert({ organization_id: auth.orgId, name: b.name, code: b.code ?? null, sort_order: b.sort_order ?? 0 })
      .select('id')
      .single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ id: data.id })
  } catch (error) {
    console.error('Create stock location error:', error)
    return c.json({ error: 'Failed to create stock location' }, 500)
  }
})

partsStock.patch('/stock-locations/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of ['name', 'code', 'is_active', 'sort_order']) if (b[k] !== undefined) update[k] = b[k]
    const { error } = await supabaseAdmin.from('stock_locations').update(update).eq('id', id).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true })
  } catch (error) {
    console.error('Update stock location error:', error)
    return c.json({ error: 'Failed to update stock location' }, 500)
  }
})

export default partsStock
