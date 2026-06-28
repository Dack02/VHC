import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { postStockAdjustmentJournal } from '../services/parts-accounting-service.js'

/**
 * Stocktake sessions (GMS/PARTS.md §7.4, P3). Gated behind parts_stock.
 * Flow: create a session over a scope (all / category / location / supplier) which
 * FREEZES expected_qty + unit_cost per stocked item → enter counted qty (variance is
 * computed) → commit posts an `adjustment` stock_movement per varianced line (with a
 * MANDATORY reason_code) and fires Event 6 (Dr Stock Adjustment / Cr Inventory, or the
 * reverse for found stock). The freeze means a movement landing mid-count can't silently
 * rewrite the variance. Uncounted lines (counted_qty NULL) post nothing.
 */
const stocktake = new Hono()
stocktake.use('*', authMiddleware)
stocktake.use('*', requireModule('parts_stock'))

const WRITE_ROLES = ['super_admin', 'org_admin', 'site_admin', 'service_advisor'] as const
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : d
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// List sessions (newest first)
stocktake.get('/', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { data, error } = await supabaseAdmin
      .from('stocktake_sessions')
      .select('id, reference, scope_type, scope_category_id, scope_supplier_id, location_id, location:stock_locations(name), status, line_count, variance_value, committed_at, created_at')
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return c.json({ error: error.message }, 500)
    const sessions = (data ?? []).map((s) => {
      const loc = s.location as unknown as { name?: string } | null
      return {
        id: s.id,
        reference: s.reference,
        scopeType: s.scope_type,
        locationName: loc?.name ?? null,
        status: s.status,
        lineCount: s.line_count,
        varianceValue: num(s.variance_value),
        committedAt: s.committed_at,
        createdAt: s.created_at,
      }
    })
    return c.json({ sessions })
  } catch (err) {
    console.error('Stocktake list error:', err)
    return c.json({ error: 'Failed to load stocktakes' }, 500)
  }
})

// Session detail with lines
stocktake.get('/:id', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data: s, error } = await supabaseAdmin
      .from('stocktake_sessions')
      .select('id, reference, scope_type, scope_category_id, scope_supplier_id, location_id, location:stock_locations(name), status, line_count, variance_value, notes, committed_at, created_at')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (error || !s) return c.json({ error: 'Stocktake not found' }, 404)
    const { data: lines } = await supabaseAdmin
      .from('stocktake_session_lines')
      .select('id, stock_item_id, part_number, description, expected_qty, counted_qty, unit_cost, variance_qty, reason_code, movement_id')
      .eq('stocktake_session_id', id)
      .order('part_number', { ascending: true })
    const loc = s.location as unknown as { name?: string } | null
    return c.json({
      session: {
        id: s.id,
        reference: s.reference,
        scopeType: s.scope_type,
        locationName: loc?.name ?? null,
        status: s.status,
        lineCount: s.line_count,
        varianceValue: num(s.variance_value),
        notes: s.notes,
        committedAt: s.committed_at,
        createdAt: s.created_at,
      },
      lines: (lines ?? []).map((l) => ({
        id: l.id,
        stockItemId: l.stock_item_id,
        partNumber: l.part_number,
        description: l.description,
        expectedQty: num(l.expected_qty),
        countedQty: l.counted_qty == null ? null : num(l.counted_qty),
        unitCost: num(l.unit_cost),
        varianceQty: num(l.variance_qty),
        varianceValue: round2(num(l.variance_qty) * num(l.unit_cost)),
        reasonCode: l.reason_code,
        movementId: l.movement_id,
      })),
    })
  } catch (err) {
    console.error('Stocktake detail error:', err)
    return c.json({ error: 'Failed to load stocktake' }, 500)
  }
})

// Create a session — snapshot the scope into frozen lines
stocktake.post('/', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    const scopeType = ['all', 'category', 'location', 'supplier'].includes(b.scopeType) ? b.scopeType : 'all'
    if (scopeType === 'category' && !b.scopeCategoryId) return c.json({ error: 'scopeCategoryId is required for a category stocktake' }, 400)
    if (scopeType === 'supplier' && !b.scopeSupplierId) return c.json({ error: 'scopeSupplierId is required for a supplier stocktake' }, 400)

    // Validate any supplied location belongs to this org — otherwise a planted foreign id
    // would leak another org's location name back through the list/detail embed (service-role
    // reads bypass RLS). stock_locations.organization_id is NOT NULL.
    let validLocationId: string | null = null
    if (b.locationId) {
      const { data: loc } = await supabaseAdmin
        .from('stock_locations')
        .select('id')
        .eq('id', b.locationId)
        .eq('organization_id', auth.orgId)
        .maybeSingle()
      if (!loc) return c.json({ error: 'Invalid location' }, 400)
      validLocationId = loc.id as string
    }

    // Resolve the stocked items in scope (only is_stocked items have a perpetual qty to count).
    let itemQ = supabaseAdmin
      .from('parts_catalog')
      .select('id, part_number, description, qty_on_hand, average_cost')
      .eq('organization_id', auth.orgId)
      .eq('is_stocked', true)
      .eq('is_active', true)
    if (scopeType === 'category') itemQ = itemQ.eq('category_id', b.scopeCategoryId)
    if (scopeType === 'supplier') itemQ = itemQ.eq('preferred_supplier_id', b.scopeSupplierId)
    const { data: items, error: itemErr } = await itemQ.limit(5000)
    if (itemErr) return c.json({ error: itemErr.message }, 500)
    if (!items || items.length === 0) return c.json({ error: 'No stocked items match this scope' }, 400)

    const { data: ref } = await supabaseAdmin.rpc('next_stocktake_number', { p_org_id: auth.orgId })

    const { data: session, error: sErr } = await supabaseAdmin
      .from('stocktake_sessions')
      .insert({
        organization_id: auth.orgId,
        reference: (ref as string) ?? null,
        location_id: validLocationId,
        scope_type: scopeType,
        scope_category_id: scopeType === 'category' ? b.scopeCategoryId : null,
        scope_supplier_id: scopeType === 'supplier' ? b.scopeSupplierId : null,
        status: 'counting',
        notes: b.notes ?? null,
        line_count: items.length,
        created_by: auth.user.id,
      })
      .select('id')
      .single()
    if (sErr || !session) return c.json({ error: sErr?.message ?? 'Failed to create stocktake' }, 500)

    const lineRows = items.map((it) => ({
      organization_id: auth.orgId,
      stocktake_session_id: session.id,
      stock_item_id: it.id,
      part_number: it.part_number,
      description: it.description,
      expected_qty: num(it.qty_on_hand),     // FROZEN
      unit_cost: num(it.average_cost),        // FROZEN
      counted_qty: null,
      variance_qty: 0,
    }))
    const { error: lErr } = await supabaseAdmin.from('stocktake_session_lines').insert(lineRows)
    if (lErr) {
      // best-effort rollback of the header so we don't leave an empty session
      await supabaseAdmin.from('stocktake_sessions').delete().eq('id', session.id)
      return c.json({ error: lErr.message }, 500)
    }
    return c.json({ ok: true, id: session.id })
  } catch (err) {
    console.error('Stocktake create error:', err)
    return c.json({ error: 'Failed to create stocktake' }, 500)
  }
})

// Save counts — bulk update counted_qty (+ optional reason_code) per line
stocktake.post('/:id/counts', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const counts: Array<{ lineId: string; countedQty: number | null; reasonCode?: string | null }> = Array.isArray(b.counts) ? b.counts : []
    if (counts.length === 0) return c.json({ error: 'counts array is required' }, 400)

    const { data: session } = await supabaseAdmin
      .from('stocktake_sessions')
      .select('id, status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (!session) return c.json({ error: 'Stocktake not found' }, 404)
    if (session.status !== 'counting') return c.json({ error: 'Stocktake is no longer open for counting' }, 400)

    // Fetch the frozen expected_qty for the affected lines to compute variance server-side.
    const lineIds = counts.map((x) => x.lineId).filter(Boolean)
    const { data: existing } = await supabaseAdmin
      .from('stocktake_session_lines')
      .select('id, expected_qty')
      .eq('stocktake_session_id', id)
      .in('id', lineIds)
    const expectedById = new Map((existing ?? []).map((l) => [l.id as string, num(l.expected_qty)]))

    for (const ct of counts) {
      if (!expectedById.has(ct.lineId)) continue
      const counted = ct.countedQty == null ? null : num(ct.countedQty)
      const variance = counted == null ? 0 : round2(counted - (expectedById.get(ct.lineId) ?? 0))
      await supabaseAdmin
        .from('stocktake_session_lines')
        .update({
          counted_qty: counted,
          variance_qty: variance,
          reason_code: ct.reasonCode ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ct.lineId)
        .eq('stocktake_session_id', id)
    }
    return c.json({ ok: true })
  } catch (err) {
    console.error('Stocktake counts error:', err)
    return c.json({ error: 'Failed to save counts' }, 500)
  }
})

// Commit — post adjustment movements + Event 6 journals for every varianced, counted line
stocktake.post('/:id/commit', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: session } = await supabaseAdmin
      .from('stocktake_sessions')
      .select('id, status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (!session) return c.json({ error: 'Stocktake not found' }, 404)
    if (session.status !== 'counting') return c.json({ error: 'Stocktake already committed or cancelled' }, 400)

    const { data: lines } = await supabaseAdmin
      .from('stocktake_session_lines')
      .select('id, stock_item_id, expected_qty, counted_qty, unit_cost, variance_qty, reason_code, movement_id')
      .eq('stocktake_session_id', id)
    const adjustLines = (lines ?? []).filter((l) => l.counted_qty != null && round2(num(l.variance_qty)) !== 0 && !l.movement_id)

    // Mandatory reason_code on every varianced line (§7.4).
    const missing = adjustLines.filter((l) => !l.reason_code)
    if (missing.length > 0) {
      return c.json({ error: `A reason is required for every counted line with a variance (${missing.length} missing)` }, 400)
    }

    const docDate = new Date().toISOString().slice(0, 10)
    let varianceValue = 0
    for (const l of adjustLines) {
      const qtyDelta = round2(num(l.variance_qty))
      const unitCost = num(l.unit_cost)
      const totalCost = round2(qtyDelta * unitCost)
      const { data: movement, error: mErr } = await supabaseAdmin
        .from('stock_movements')
        .insert({
          organization_id: auth.orgId,
          stock_item_id: l.stock_item_id,
          location_id: null,
          movement_type: 'adjustment',
          qty_delta: qtyDelta,
          unit_cost: unitCost,
          total_cost: totalCost,
          reference_type: 'stocktake',
          reference_id: id,
          reason_code: l.reason_code,
          document_date: docDate,
          created_by: auth.user.id,
        })
        .select('id')
        .single()
      if (mErr) return c.json({ error: `Failed to post adjustment: ${mErr.message}` }, 500)

      // Event 6 — same journal the manual adjust endpoint posts.
      await postStockAdjustmentJournal(auth.orgId, auth.user.id, {
        stockItemId: l.stock_item_id as string,
        qtyDelta,
        unitCost,
        reasonCode: (l.reason_code as string) ?? 'stocktake',
        movementId: movement?.id ?? null,
      })
      await supabaseAdmin
        .from('stocktake_session_lines')
        .update({ movement_id: movement?.id ?? null, updated_at: new Date().toISOString() })
        .eq('id', l.id)
      varianceValue = round2(varianceValue + totalCost)
    }

    await supabaseAdmin
      .from('stocktake_sessions')
      .update({
        status: 'committed',
        variance_value: varianceValue,
        committed_at: new Date().toISOString(),
        committed_by: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    return c.json({ ok: true, adjustments: adjustLines.length, varianceValue })
  } catch (err) {
    console.error('Stocktake commit error:', err)
    return c.json({ error: 'Failed to commit stocktake' }, 500)
  }
})

// Cancel an open session
stocktake.post('/:id/cancel', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data: session } = await supabaseAdmin
      .from('stocktake_sessions')
      .select('id, status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()
    if (!session) return c.json({ error: 'Stocktake not found' }, 404)
    if (session.status !== 'counting') return c.json({ error: 'Only an open stocktake can be cancelled' }, 400)
    await supabaseAdmin
      .from('stocktake_sessions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
    return c.json({ ok: true })
  } catch (err) {
    console.error('Stocktake cancel error:', err)
    return c.json({ error: 'Failed to cancel stocktake' }, 500)
  }
})

export default stocktake
