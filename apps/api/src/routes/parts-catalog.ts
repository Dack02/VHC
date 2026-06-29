import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const partsCatalog = new Hono()

partsCatalog.use('*', authMiddleware)

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// Stock status for a stocked item (mirrors parts-stock.ts).
function stockStatus(qty: number, min: number | null): string {
  if (qty <= 0) return 'out'
  if (min != null && qty <= min) return 'low'
  return 'in_stock'
}

// Shape a parts_catalog row into the unified Parts payload (catalogue master + stock view).
function shapePart(p: Record<string, unknown>): Record<string, unknown> {
  const qty = Number(p.qty_on_hand) || 0
  const avg = Number(p.average_cost) || 0
  const cat = p.category as { name?: string } | null | undefined
  return {
    id: p.id,
    partNumber: p.part_number,
    description: p.description,
    costPrice: p.cost_price != null ? parseFloat(p.cost_price as string) : 0,
    isActive: p.is_active,
    isStocked: !!p.is_stocked,
    categoryId: (p.category_id as string) ?? null,
    categoryName: cat?.name ?? null,
    unitOfMeasure: (p.unit_of_measure as string) ?? 'each',
    sellPrice: p.sell_price != null ? parseFloat(p.sell_price as string) : null,
    sellPriceOverride: p.sell_price_override != null ? parseFloat(p.sell_price_override as string) : null,
    qtyOnHand: qty,
    averageCost: avg,
    stockValue: round2(qty * avg),
    minQty: p.min_qty != null ? Number(p.min_qty) : null,
    maxQty: p.max_qty != null ? Number(p.max_qty) : null,
    binLocation: (p.bin_location as string) ?? null,
    preferredSupplierId: (p.preferred_supplier_id as string) ?? null,
    vatCode: (p.vat_code as string) ?? null,
    barcode: (p.barcode as string) ?? null,
    stockStatus: p.is_stocked ? stockStatus(qty, p.min_qty != null ? Number(p.min_qty) : null) : null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }
}

// GET /api/v1/organizations/:orgId/parts-catalog - List all parts (paginated)
partsCatalog.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '25', 10)))
    const q = c.req.query('q')?.trim() || ''
    const includeInactive = c.req.query('include_inactive') === 'true'
    const sort = c.req.query('sort') || 'part_number'
    const order = c.req.query('order') === 'desc' ? false : true
    const offset = (page - 1) * limit

    const allowedSortColumns = ['part_number', 'description', 'cost_price', 'created_at', 'updated_at', 'qty_on_hand']
    const sortColumn = allowedSortColumns.includes(sort) ? sort : 'part_number'
    const stocked = c.req.query('stocked')          // 'true' | 'false' | undefined (all)
    const categoryId = c.req.query('category_id')

    let query = supabaseAdmin
      .from('parts_catalog')
      .select('*, category:part_categories(name)', { count: 'exact' })
      .eq('organization_id', orgId)
      .order(sortColumn, { ascending: order })
      .range(offset, offset + limit - 1)

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }
    if (stocked === 'true') query = query.eq('is_stocked', true)
    else if (stocked === 'false') query = query.eq('is_stocked', false)
    if (categoryId) query = query.eq('category_id', categoryId)

    if (q) {
      query = query.or(`part_number.ilike.%${q}%,description.ilike.%${q}%,barcode.ilike.%${q}%`)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('List parts catalog error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      parts: (data || []).map(shapePart),
      total: count || 0,
      page,
      limit
    })
  } catch (error) {
    console.error('List parts catalog error:', error)
    return c.json({ error: 'Failed to list parts catalog' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/parts-catalog - Upsert part to catalog
partsCatalog.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { part_number, description, cost_price } = body

    if (!part_number || !part_number.trim()) {
      return c.json({ error: 'Part number is required' }, 400)
    }
    if (!description || !description.trim()) {
      return c.json({ error: 'Description is required' }, 400)
    }
    // Cost is optional (default 0) — a part can be catalogued and priced later.
    if (cost_price !== undefined && cost_price !== null && isNaN(parseFloat(cost_price))) {
      return c.json({ error: 'Invalid cost price' }, 400)
    }

    // Full field set so the single unified "Add part" form (catalogue + stock) writes one row.
    const row: Record<string, unknown> = {
      organization_id: orgId,
      part_number: part_number.trim(),
      description: description.trim(),
      cost_price: cost_price != null && !isNaN(parseFloat(cost_price)) ? parseFloat(cost_price) : 0,
      is_stocked: body.is_stocked === true,
      category_id: body.category_id ?? null,
      unit_of_measure: body.unit_of_measure ?? 'each',
      sell_price: body.sell_price ?? null,
      sell_price_override: body.sell_price_override ?? null,
      min_qty: body.min_qty ?? null,
      max_qty: body.max_qty ?? null,
      bin_location: body.bin_location ?? null,
      preferred_supplier_id: body.preferred_supplier_id ?? null,
      vat_code: body.vat_code ?? 'STD_20',
      barcode: body.barcode ?? null,
      created_by: auth.user.id,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .upsert(row, { onConflict: 'organization_id,part_number' })
      .select('*, category:part_categories(name)')
      .single()

    if (error) {
      console.error('Upsert parts catalog error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json(shapePart(data), 201)
  } catch (error) {
    console.error('Upsert parts catalog error:', error)
    return c.json({ error: 'Failed to save part to catalog' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/parts-catalog/:id/toggle-active - Toggle active status
partsCatalog.patch('/:id/toggle-active', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const id = c.req.param('id')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Fetch current state
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('parts_catalog')
      .select('id, is_active')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single()

    if (fetchError || !existing) {
      return c.json({ error: 'Part not found' }, 404)
    }

    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .update({
        is_active: !existing.is_active,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single()

    if (error) {
      console.error('Toggle part active error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: data.id,
      partNumber: data.part_number,
      description: data.description,
      costPrice: parseFloat(data.cost_price),
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    })
  } catch (error) {
    console.error('Toggle part active error:', error)
    return c.json({ error: 'Failed to toggle part status' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/parts-catalog/:id - Update a part
partsCatalog.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const id = c.req.param('id')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const body = await c.req.json()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (body.description !== undefined) {
      if (!body.description || !body.description.trim()) {
        return c.json({ error: 'Description cannot be empty' }, 400)
      }
      updates.description = body.description.trim()
    }

    if (body.cost_price !== undefined) {
      if (body.cost_price === null || isNaN(parseFloat(body.cost_price))) {
        return c.json({ error: 'Invalid cost price' }, 400)
      }
      updates.cost_price = parseFloat(body.cost_price)
    }

    // Stock + catalogue fields (partial update; qty_on_hand/average_cost are NEVER set here —
    // they are derived from stock_movements). Promoting to stocked = is_stocked:true.
    const passthrough = ['is_stocked', 'category_id', 'unit_of_measure', 'sell_price', 'sell_price_override', 'min_qty', 'max_qty', 'bin_location', 'preferred_supplier_id', 'vat_code', 'barcode', 'part_number', 'is_active']
    for (const k of passthrough) {
      if (body[k] !== undefined) updates[k] = body[k]
    }
    if (typeof updates.part_number === 'string') updates.part_number = (updates.part_number as string).trim()

    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('*, category:part_categories(name)')
      .single()

    if (error) {
      console.error('Update part error:', error)
      return c.json({ error: error.message }, 500)
    }

    if (!data) {
      return c.json({ error: 'Part not found' }, 404)
    }

    return c.json(shapePart(data))
  } catch (error) {
    console.error('Update part error:', error)
    return c.json({ error: 'Failed to update part' }, 500)
  }
})

// GET /api/v1/organizations/:orgId/parts-catalog/search?q= - Search catalog
partsCatalog.get('/search', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const q = c.req.query('q')?.trim() || ''

    let query = supabaseAdmin
      .from('parts_catalog')
      .select('id, part_number, description, cost_price, is_active')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('part_number', { ascending: true })
      .limit(10)

    if (q) {
      query = query.or(`part_number.ilike.%${q}%,description.ilike.%${q}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Search parts catalog error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      parts: (data || []).map(p => ({
        id: p.id,
        partNumber: p.part_number,
        description: p.description,
        costPrice: parseFloat(p.cost_price),
        isActive: p.is_active
      }))
    })
  } catch (error) {
    console.error('Search parts catalog error:', error)
    return c.json({ error: 'Failed to search parts catalog' }, 500)
  }
})

// GET /api/v1/organizations/:orgId/parts-catalog/part-numbers - Get all active part numbers
partsCatalog.get('/part-numbers', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data, error } = await supabaseAdmin
      .from('parts_catalog')
      .select('part_number')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('part_number', { ascending: true })

    if (error) {
      console.error('Get part numbers error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      partNumbers: (data || []).map(p => p.part_number)
    })
  } catch (error) {
    console.error('Get part numbers error:', error)
    return c.json({ error: 'Failed to get part numbers' }, 500)
  }
})

// GET /api/v1/organizations/:orgId/parts-catalog/:id - Full part detail card
// (item + stock KPIs + movement ledger + open orders + where-used). Registered AFTER the
// literal /search and /part-numbers routes so it doesn't shadow them.
partsCatalog.get('/:id', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const id = c.req.param('id')
    if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

    const { data: item } = await supabaseAdmin
      .from('parts_catalog')
      .select('*, category:part_categories(name), supplier:suppliers(name)')
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!item) return c.json({ error: 'Part not found' }, 404)

    // Movement ledger (most recent first). Empty for non-stock parts.
    const { data: movements } = await supabaseAdmin
      .from('stock_movements')
      .select('id, movement_type, qty_delta, unit_cost, total_cost, reference_type, reason_code, document_date, movement_at')
      .eq('organization_id', orgId)
      .eq('stock_item_id', id)
      .order('movement_at', { ascending: false })
      .limit(100)

    // Open purchase-order lines for this item (on order).
    const { data: poLines } = await supabaseAdmin
      .from('purchase_order_lines')
      .select('id, qty_ordered, qty_received, unit_cost, line_status, purchase_order:purchase_orders(id, po_number, status, supplier:suppliers(name))')
      .eq('organization_id', orgId)
      .eq('stock_item_id', id)
      .limit(200)
    const openOrders = (poLines ?? [])
      .map((l) => {
        const po = l.purchase_order as unknown as { id?: string; po_number?: string; status?: string; supplier?: { name?: string } } | null
        const outstanding = (Number(l.qty_ordered) || 0) - (Number(l.qty_received) || 0)
        return {
          lineId: l.id,
          poId: po?.id ?? null,
          poNumber: po?.po_number ?? null,
          poStatus: po?.status ?? null,
          supplierName: po?.supplier?.name ?? null,
          qtyOrdered: Number(l.qty_ordered) || 0,
          qtyReceived: Number(l.qty_received) || 0,
          qtyOutstanding: outstanding,
          unitCost: Number(l.unit_cost) || 0,
          lineStatus: (l.line_status as string) ?? null,
        }
      })
      .filter((l) => l.qtyOutstanding > 0 && l.poStatus !== 'cancelled' && l.poStatus !== 'closed' && l.lineStatus !== 'cancelled')

    // Where-used: recent job lines that reference this item.
    const { data: usedRows } = await supabaseAdmin
      .from('repair_parts')
      .select('id, quantity, cost_price, sell_price, line_status, created_at, repair_item:repair_items(id, health_check_id, jobsheet_id)')
      .eq('stock_item_id', id)
      .order('created_at', { ascending: false })
      .limit(50)
    const whereUsed = (usedRows ?? []).map((r) => {
      const ri = r.repair_item as unknown as { id?: string; health_check_id?: string; jobsheet_id?: string } | null
      return {
        id: r.id,
        quantity: Number(r.quantity) || 0,
        costPrice: r.cost_price != null ? Number(r.cost_price) : null,
        sellPrice: r.sell_price != null ? Number(r.sell_price) : null,
        lineStatus: (r.line_status as string) ?? null,
        healthCheckId: ri?.health_check_id ?? null,
        jobsheetId: ri?.jobsheet_id ?? null,
        createdAt: r.created_at,
      }
    })

    const qty = Number(item.qty_on_hand) || 0
    const avg = Number(item.average_cost) || 0
    const onOrder = openOrders.reduce((s, l) => s + l.qtyOutstanding, 0)
    const supplier = item.supplier as { name?: string } | null | undefined

    return c.json({
      part: { ...shapePart(item), preferredSupplierName: supplier?.name ?? null },
      kpis: {
        onHand: qty,
        available: qty,            // reservations not tracked yet (P4)
        averageCost: avg,
        stockValue: round2(qty * avg),
        onOrder,
      },
      movements: (movements ?? []).map((m) => ({
        id: m.id,
        movementType: m.movement_type,
        qtyDelta: Number(m.qty_delta) || 0,
        unitCost: Number(m.unit_cost) || 0,
        totalCost: Number(m.total_cost) || 0,
        referenceType: m.reference_type,
        reasonCode: m.reason_code,
        documentDate: m.document_date,
        movementAt: m.movement_at,
      })),
      openOrders,
      whereUsed,
    })
  } catch (error) {
    console.error('Part detail error:', error)
    return c.json({ error: 'Failed to load part detail' }, 500)
  }
})

export default partsCatalog
