import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { recordSupplierInvoice } from '../services/parts-accounting-service.js'

/**
 * Purchase Orders + Goods-in / GRN — the Full-mode order-in flow (GMS/PARTS.md §5.7/§5.8/§7.1, P1).
 * Gated behind the `parts_stock` module. Receiving a STOCKED line writes a `receipt`
 * stock_movement (SOH↑, provisional WAVCO) — quantity only, NO GL journal at receipt
 * (the asset is recognised at the supplier invoice, Event 2, P2). qty_on_hand is DERIVED;
 * never written directly here.
 */
const purchaseOrders = new Hono()
purchaseOrders.use('*', authMiddleware)
purchaseOrders.use('*', requireModule('parts_stock'))

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : d
}

const WRITE_ROLES = ['super_admin', 'org_admin', 'site_admin', 'service_advisor'] as const

// Derive a stable part number for an ad-hoc received line that has none, from its
// part number or description (so the auto-created catalogue item is identifiable). Re-receipt
// of the same name links to the existing row via the (org, part_number) lookup in receive().
// Note: distinct inputs that slug to the same value (e.g. "BP 1234" / "BP-1234") intentionally
// share one catalogue row — acceptable dedup for ad-hoc free-text lines.
function derivePartNumber(partNumber: string | null, description: string | null): string {
  const base = (partNumber && partNumber.trim()) || (description && description.trim()) || 'PART'
  const slug = base.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug || 'PART'
}

// Recompute a PO's header status from its line receipts (draft/ordered preserved until
// any receipt arrives; then part_received → received).
async function recomputePoStatus(poId: string, orgId: string): Promise<void> {
  const { data: po } = await supabaseAdmin
    .from('purchase_orders').select('status').eq('id', poId).eq('organization_id', orgId).single()
  if (!po || po.status === 'cancelled' || po.status === 'closed' || po.status === 'invoiced') return
  const { data: lines } = await supabaseAdmin
    .from('purchase_order_lines')
    .select('qty_ordered, qty_received, line_status')
    .eq('purchase_order_id', poId)
  const active = (lines ?? []).filter(l => l.line_status !== 'cancelled')
  if (!active.length) return
  const anyReceived = active.some(l => num(l.qty_received) > 0)
  const allReceived = active.every(l => num(l.qty_received) >= num(l.qty_ordered))
  const next = allReceived ? 'received' : anyReceived ? 'part_received' : po.status
  if (next !== po.status) {
    await supabaseAdmin.from('purchase_orders')
      .update({ status: next, received_at: allReceived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', poId).eq('organization_id', orgId)
  }
}

// ===========================================================================
// List POs
// ===========================================================================
purchaseOrders.get('/', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const status = c.req.query('status')
    let q = supabaseAdmin
      .from('purchase_orders')
      .select('id, po_number, status, supplier_id, supplier:suppliers(name), ordered_at, received_at, created_at, lines:purchase_order_lines(id, qty_ordered, qty_received, unit_cost)')
      .eq('organization_id', auth.orgId)
      // Invoice-in-hand entries are POs under the hood (origin='direct_invoice'); they belong on
      // the Purchase Invoices ledger, not the open-orders list.
      .eq('origin', 'order')
      .order('created_at', { ascending: false })
      .limit(500)
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return c.json({ error: error.message }, 500)
    const orders = (data ?? []).map((po: Record<string, unknown>) => {
      const lines = (po.lines as Array<Record<string, unknown>>) || []
      const supplier = po.supplier as { name?: string } | null
      const totalValue = round2(lines.reduce((s, l) => s + num(l.qty_ordered) * num(l.unit_cost), 0))
      return {
        id: po.id,
        poNumber: po.po_number,
        status: po.status,
        supplierId: po.supplier_id,
        supplierName: supplier?.name ?? null,
        orderedAt: po.ordered_at,
        receivedAt: po.received_at,
        createdAt: po.created_at,
        lineCount: lines.length,
        totalValue,
      }
    })
    return c.json({ orders })
  } catch (error) {
    console.error('List purchase orders error:', error)
    return c.json({ error: 'Failed to list purchase orders' }, 500)
  }
})

// ===========================================================================
// PO detail (with lines)
// ===========================================================================
purchaseOrders.get('/:id', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data: po, error } = await supabaseAdmin
      .from('purchase_orders')
      .select('*, supplier:suppliers(id, name), lines:purchase_order_lines(*, stock_item:parts_catalog(id, part_number, description, is_stocked))')
      .eq('id', id).eq('organization_id', auth.orgId)
      .single()
    if (error || !po) return c.json({ error: 'Purchase order not found' }, 404)
    const supplier = po.supplier as { id?: string; name?: string } | null
    const lines = ((po.lines as Array<Record<string, unknown>>) || []).map(l => {
      const item = l.stock_item as { is_stocked?: boolean } | null
      return {
        id: l.id,
        stockItemId: l.stock_item_id,
        repairPartId: l.repair_part_id,
        partNumber: l.part_number,
        description: l.description,
        qtyOrdered: num(l.qty_ordered),
        qtyReceived: num(l.qty_received),
        unitCost: num(l.unit_cost),
        lineStatus: l.line_status,
        isStocked: Boolean(item?.is_stocked),
        reconciled: Boolean(l.reconciled),
      }
    })
    return c.json({
      order: {
        id: po.id,
        poNumber: po.po_number,
        status: po.status,
        supplierId: po.supplier_id,
        supplierName: supplier?.name ?? null,
        siteId: po.site_id,
        locationId: po.location_id,
        supplierInvoiceRef: po.supplier_invoice_ref,
        notes: po.notes,
        orderedAt: po.ordered_at,
        receivedAt: po.received_at,
        createdAt: po.created_at,
        lines,
      },
    })
  } catch (error) {
    console.error('Get purchase order error:', error)
    return c.json({ error: 'Failed to get purchase order' }, 500)
  }
})

// ===========================================================================
// Create a draft PO (optionally with lines)
// ===========================================================================
purchaseOrders.post('/', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    const poNumber = await nextPoNumber(auth.orgId)
    const { data: po, error } = await supabaseAdmin
      .from('purchase_orders')
      .insert({
        organization_id: auth.orgId,
        supplier_id: b.supplierId ?? null,
        site_id: b.siteId ?? null,
        location_id: b.locationId ?? null,
        po_number: poNumber,
        status: 'draft',
        notes: b.notes ?? null,
        created_by: auth.user.id,
      })
      .select('id')
      .single()
    if (error || !po) return c.json({ error: error?.message ?? 'Failed to create PO' }, 500)
    if (Array.isArray(b.lines) && b.lines.length) {
      await insertPoLines(po.id, auth.orgId, b.lines)
    }
    return c.json({ id: po.id, poNumber })
  } catch (error) {
    console.error('Create purchase order error:', error)
    return c.json({ error: 'Failed to create purchase order' }, 500)
  }
})

// ===========================================================================
// Raise a PO from job lines (repair_parts) — auto-consolidate into the supplier's
// open draft PO if one exists (GA4 pattern); else create one per supplier.
// Body: { repairPartIds: string[], siteId?, locationId? }
// ===========================================================================
purchaseOrders.post('/raise-from-job', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    const ids: string[] = Array.isArray(b.repairPartIds) ? b.repairPartIds : []
    if (!ids.length) return c.json({ error: 'repairPartIds is required' }, 400)

    const { data: parts } = await supabaseAdmin
      .from('repair_parts')
      .select('id, part_number, description, quantity, cost_price, supplier_id, stock_item_id, purchase_order_line_id')
      .in('id', ids)
    if (!parts?.length) return c.json({ error: 'No matching parts' }, 404)

    // Group by supplier (null supplier groups together under a single "unassigned" PO).
    const bySupplier = new Map<string, typeof parts>()
    for (const p of parts) {
      if (p.purchase_order_line_id) continue // already on a PO — skip
      const key = p.supplier_id ?? '__none__'
      if (!bySupplier.has(key)) bySupplier.set(key, [])
      bySupplier.get(key)!.push(p)
    }

    const created: Array<{ poId: string; poNumber: string | null; lineCount: number }> = []
    for (const [key, group] of bySupplier) {
      const supplierId = key === '__none__' ? null : key
      // Find an open draft PO for this supplier to append to (GA4 auto-consolidation).
      let poId: string | null = null
      let poNumber: string | null = null
      let draftQuery = supabaseAdmin
        .from('purchase_orders')
        .select('id, po_number')
        .eq('organization_id', auth.orgId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
      draftQuery = supplierId === null ? draftQuery.is('supplier_id', null) : draftQuery.eq('supplier_id', supplierId)
      const { data: existing } = await draftQuery.maybeSingle()
      if (existing) { poId = existing.id; poNumber = existing.po_number }
      if (!poId) {
        poNumber = await nextPoNumber(auth.orgId)
        const { data: po, error } = await supabaseAdmin
          .from('purchase_orders')
          .insert({ organization_id: auth.orgId, supplier_id: supplierId, site_id: b.siteId ?? null, location_id: b.locationId ?? null, po_number: poNumber, status: 'draft', created_by: auth.user.id })
          .select('id').single()
        if (error || !po) continue
        poId = po.id
      }
      // Append a line per part + back-link the repair_part.
      for (const p of group) {
        const { data: line } = await supabaseAdmin
          .from('purchase_order_lines')
          .insert({
            organization_id: auth.orgId,
            purchase_order_id: poId,
            stock_item_id: p.stock_item_id ?? null,
            repair_part_id: p.id,
            part_number: p.part_number,
            description: p.description,
            qty_ordered: num(p.quantity, 1),
            unit_cost: num(p.cost_price, 0),
            line_status: 'ordered',
          })
          .select('id').single()
        if (line) {
          await supabaseAdmin.from('repair_parts')
            .update({ purchase_order_line_id: line.id, line_status: 'ordered', updated_at: new Date().toISOString() })
            .eq('id', p.id)
        }
      }
      created.push({ poId: poId!, poNumber, lineCount: group.length })
    }
    return c.json({ created })
  } catch (error) {
    console.error('Raise PO from job error:', error)
    return c.json({ error: 'Failed to raise purchase order' }, 500)
  }
})

// ===========================================================================
// Update PO header (status transitions, supplier, notes, invoice ref)
// ===========================================================================
purchaseOrders.patch('/:id', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.supplierId !== undefined) update.supplier_id = b.supplierId
    if (b.locationId !== undefined) update.location_id = b.locationId
    if (b.notes !== undefined) update.notes = b.notes
    if (b.supplierInvoiceRef !== undefined) update.supplier_invoice_ref = b.supplierInvoiceRef
    if (b.status !== undefined) {
      const allowed = ['draft', 'ordered', 'part_received', 'received', 'invoiced', 'closed', 'cancelled']
      if (!allowed.includes(b.status)) return c.json({ error: 'Invalid status' }, 400)
      update.status = b.status
      if (b.status === 'ordered') update.ordered_at = new Date().toISOString()
    }
    const { error } = await supabaseAdmin
      .from('purchase_orders').update(update).eq('id', id).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    // When a PO is sent, advance its lines requested → ordered.
    if (b.status === 'ordered') {
      await supabaseAdmin.from('purchase_order_lines')
        .update({ line_status: 'ordered', updated_at: new Date().toISOString() })
        .eq('purchase_order_id', id).eq('organization_id', auth.orgId).eq('line_status', 'requested')
    }
    return c.json({ ok: true })
  } catch (error) {
    console.error('Update purchase order error:', error)
    return c.json({ error: 'Failed to update purchase order' }, 500)
  }
})

// ===========================================================================
// Line management
// ===========================================================================
purchaseOrders.post('/:id/lines', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    if (!b.description) return c.json({ error: 'description is required' }, 400)
    const ids = await insertPoLines(id, auth.orgId, [b])
    return c.json({ id: ids[0] ?? null })
  } catch (error) {
    console.error('Add PO line error:', error)
    return c.json({ error: 'Failed to add line' }, 500)
  }
})

purchaseOrders.patch('/lines/:lineId', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { lineId } = c.req.param()
    const b = await c.req.json()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.description !== undefined) update.description = b.description
    if (b.partNumber !== undefined) update.part_number = b.partNumber
    if (b.qtyOrdered !== undefined) update.qty_ordered = num(b.qtyOrdered, 1)
    if (b.unitCost !== undefined) update.unit_cost = num(b.unitCost, 0)
    if (b.stockItemId !== undefined) {
      // A stock_item_id must belong to this org — never let a crafted id point a PO line
      // (and a later receipt movement) at another tenant's catalogue item.
      if (b.stockItemId) {
        const { data: owned } = await supabaseAdmin
          .from('parts_catalog').select('id').eq('id', b.stockItemId).eq('organization_id', auth.orgId).maybeSingle()
        if (!owned) return c.json({ error: 'Invalid stock item' }, 400)
      }
      update.stock_item_id = b.stockItemId
    }
    if (b.lineStatus !== undefined) update.line_status = b.lineStatus
    const { error } = await supabaseAdmin
      .from('purchase_order_lines').update(update).eq('id', lineId).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true })
  } catch (error) {
    console.error('Update PO line error:', error)
    return c.json({ error: 'Failed to update line' }, 500)
  }
})

purchaseOrders.delete('/lines/:lineId', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { lineId } = c.req.param()
    // Unlink any repair_part pointing at this line so we don't dangle.
    await supabaseAdmin.from('repair_parts')
      .update({ purchase_order_line_id: null, line_status: 'requested' })
      .eq('purchase_order_line_id', lineId)
    const { error } = await supabaseAdmin
      .from('purchase_order_lines').delete().eq('id', lineId).eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true })
  } catch (error) {
    console.error('Delete PO line error:', error)
    return c.json({ error: 'Failed to delete line' }, 500)
  }
})

// ===========================================================================
// Receive (goods-in / GRN). Body: { lines: [{ poLineId, qtyReceived, unitCost?, condition? }], notes? }
// Stocked lines write a `receipt` movement (quantity only, no GL journal — Event 1).
// ===========================================================================
purchaseOrders.post('/:id/receive', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const reqLines: Array<Record<string, unknown>> = Array.isArray(b.lines) ? b.lines : []
    if (!reqLines.length) return c.json({ error: 'lines is required' }, 400)

    const { data: po } = await supabaseAdmin
      .from('purchase_orders').select('id, location_id').eq('id', id).eq('organization_id', auth.orgId).single()
    if (!po) return c.json({ error: 'Purchase order not found' }, 404)

    const grnNumber = await nextGrnNumber(auth.orgId)
    const { data: grn, error: grnErr } = await supabaseAdmin
      .from('goods_receipts')
      .insert({ organization_id: auth.orgId, purchase_order_id: id, grn_number: grnNumber, notes: b.notes ?? null, received_by: auth.user.id })
      .select('id').single()
    if (grnErr || !grn) return c.json({ error: grnErr?.message ?? 'Failed to create GRN' }, 500)

    let movementsWritten = 0
    for (const rl of reqLines) {
      const poLineId = rl.poLineId as string
      const qty = num(rl.qtyReceived, 0)
      if (!poLineId || qty <= 0) continue
      const { data: poLine } = await supabaseAdmin
        .from('purchase_order_lines')
        .select('id, stock_item_id, qty_ordered, qty_received, unit_cost, repair_part_id, part_number, description')
        .eq('id', poLineId).eq('organization_id', auth.orgId).single()
      if (!poLine) continue
      const unitCost = rl.unitCost !== undefined ? num(rl.unitCost, num(poLine.unit_cost)) : num(poLine.unit_cost)

      // Resolve the catalogue item this line stocks. (May be auto-created below.)
      let stockItemId = poLine.stock_item_id as string | null
      let isStocked = false
      if (stockItemId) {
        // Org-scope the lookup: a stale/foreign id must NOT drive a movement against another
        // tenant's item — if it isn't ours, drop it and fall through to the backstop.
        const { data: item } = await supabaseAdmin
          .from('parts_catalog').select('is_stocked').eq('id', stockItemId).eq('organization_id', auth.orgId).maybeSingle()
        if (item) isStocked = Boolean(item.is_stocked)
        else stockItemId = null
      }
      if (!stockItemId && !poLine.repair_part_id) {
        // Backstop: a free-text PURCHASE line (not linked to a catalogue item, not bound to a
        // job) is a stock buy. Link an existing catalogue part by derived number if one exists,
        // else create a new stocked item — so the part appears in Parts and on-hand builds,
        // instead of vanishing into the GRN (the reported bug).
        const partNo = derivePartNumber(poLine.part_number as string | null, poLine.description as string | null)
        const { data: existing } = await supabaseAdmin
          .from('parts_catalog')
          .select('id, is_stocked')
          .eq('organization_id', auth.orgId)
          .eq('part_number', partNo)
          .maybeSingle()
        if (existing) {
          stockItemId = existing.id as string
          isStocked = Boolean(existing.is_stocked)
          // A stock purchase against a not-yet-stocked catalogue part promotes it to stocked
          // (without touching its description/cost), so the receipt movement fires and on-hand
          // builds rather than silently going nowhere.
          if (!isStocked) {
            await supabaseAdmin.from('parts_catalog')
              .update({ is_stocked: true, updated_at: new Date().toISOString() })
              .eq('id', stockItemId).eq('organization_id', auth.orgId)
            isStocked = true
          }
        } else {
          const { data: created } = await supabaseAdmin
            .from('parts_catalog')
            .insert({
              organization_id: auth.orgId,
              part_number: partNo,
              description: (poLine.description as string) || partNo,
              cost_price: unitCost,
              is_stocked: true,
              created_by: auth.user.id,
              updated_at: new Date().toISOString(),
            })
            .select('id, is_stocked')
            .single()
          if (created) {
            stockItemId = created.id as string
            isStocked = Boolean(created.is_stocked)
          }
        }
        if (stockItemId) {
          await supabaseAdmin.from('purchase_order_lines')
            .update({ stock_item_id: stockItemId, part_number: partNo, updated_at: new Date().toISOString() })
            .eq('id', poLineId)
        }
      }

      // GRN line.
      await supabaseAdmin.from('goods_receipt_lines').insert({
        organization_id: auth.orgId,
        goods_receipt_id: grn.id,
        purchase_order_line_id: poLineId,
        stock_item_id: stockItemId,
        qty_received: qty,
        unit_cost: unitCost,
        condition: (rl.condition as string) === 'damaged' ? 'damaged' : 'ok',
      })

      // Stocked → receipt movement (trigger maintains SOH + provisional WAVCO). No GL journal.
      if (isStocked && stockItemId) {
        await supabaseAdmin.from('stock_movements').insert({
          organization_id: auth.orgId,
          stock_item_id: stockItemId,
          location_id: po.location_id ?? null,
          movement_type: 'receipt',
          qty_delta: qty,
          unit_cost: unitCost,
          total_cost: round2(qty * unitCost),
          reference_type: 'goods_receipt',
          reference_id: grn.id,
          created_by: auth.user.id,
        })
        movementsWritten++
      }

      // Advance line receipt + status.
      const newReceived = num(poLine.qty_received) + qty
      const fully = newReceived >= num(poLine.qty_ordered)
      await supabaseAdmin.from('purchase_order_lines')
        .update({ qty_received: newReceived, unit_cost: unitCost, line_status: 'received', is_stocked_at_receipt: isStocked, updated_at: new Date().toISOString() })
        .eq('id', poLineId)
      void fully

      // Advance the linked job line to received (on shelf for the job).
      if (poLine.repair_part_id) {
        await supabaseAdmin.from('repair_parts')
          .update({ line_status: 'received', updated_at: new Date().toISOString() })
          .eq('id', poLine.repair_part_id)
      }
    }

    await recomputePoStatus(id, auth.orgId)
    return c.json({ grnId: grn.id, grnNumber, movementsWritten })
  } catch (error) {
    console.error('Receive purchase order error:', error)
    return c.json({ error: 'Failed to receive goods' }, 500)
  }
})

// ===========================================================================
// Enter a supplier invoice against the PO (Event 2 / 4A-invoice). Books the inventory
// asset (stocked) or parks the cost in WIP (non-stock) + VAT + AP.
// Body: { invoiceRef?, taxPointDate?, lines: [{ poLineId, qty, unitCost }] }
// ===========================================================================
purchaseOrders.post('/:id/supplier-invoice', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const lines = (Array.isArray(b.lines) ? b.lines : []).map((l: Record<string, unknown>) => ({
      poLineId: l.poLineId as string,
      qty: num(l.qty, 0),
      unitCost: num(l.unitCost, 0),
    })).filter((l: { poLineId: string; qty: number }) => l.poLineId && l.qty > 0)
    if (!lines.length) return c.json({ error: 'No invoice lines' }, 400)
    const res = await recordSupplierInvoice(id, auth.orgId, auth.user.id, {
      invoiceRef: b.invoiceRef ?? null,
      taxPointDate: b.taxPointDate ?? null,
      lines,
    })
    if (!res.ok) return c.json({ error: res.error ?? 'Failed to record supplier invoice' }, 400)
    return c.json(res)
  } catch (error) {
    console.error('Supplier invoice error:', error)
    return c.json({ error: 'Failed to record supplier invoice' }, 500)
  }
})

// ---- helpers ----------------------------------------------------------------
async function nextPoNumber(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin.rpc('next_purchase_order_number', { p_org_id: orgId })
  return (data as string) ?? 'PO000000'
}
async function nextGrnNumber(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin.rpc('next_goods_receipt_number', { p_org_id: orgId })
  return (data as string) ?? 'GRN000000'
}
async function insertPoLines(poId: string, orgId: string, lines: Array<Record<string, unknown>>): Promise<string[]> {
  // Drop any stock_item_id that isn't this org's — a foreign id must never reach a PO line
  // (it would later drive a receipt movement against another tenant's catalogue item).
  const wanted = [...new Set(lines.map(l => l.stockItemId as string).filter(Boolean))]
  let owned = new Set<string>()
  if (wanted.length) {
    const { data } = await supabaseAdmin.from('parts_catalog').select('id').eq('organization_id', orgId).in('id', wanted)
    owned = new Set((data ?? []).map(r => r.id as string))
  }
  const rows = lines.map(l => {
    const sid = l.stockItemId as string | undefined
    return {
      organization_id: orgId,
      purchase_order_id: poId,
      stock_item_id: sid && owned.has(sid) ? sid : null,
      repair_part_id: (l.repairPartId as string) ?? null,
      part_number: (l.partNumber as string) ?? null,
      description: (l.description as string) ?? '',
      qty_ordered: num(l.qtyOrdered, 1),
      unit_cost: num(l.unitCost, 0),
      line_status: (l.lineStatus as string) ?? 'ordered',
    }
  })
  const { data } = await supabaseAdmin.from('purchase_order_lines').insert(rows).select('id')
  return (data ?? []).map(r => r.id as string)
}

export default purchaseOrders
