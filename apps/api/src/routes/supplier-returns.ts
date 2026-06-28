import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { postSupplierCreditJournal } from '../services/parts-accounting-service.js'

/**
 * Supplier returns / credit loop — the #1 UK money leak (GMS/PARTS.md §5.9/§7.5, P2).
 * Gated behind parts_stock. Returns are for UNUSED/UNSOLD parts (line_status to_return/
 * declined, never invoiced). Ship writes return_out movements for STOCKED lines (SOH↓);
 * the credit note fires Event 5 (Dr AP / Cr Inventory+WIP / Cr VAT Input).
 */
const supplierReturns = new Hono()
supplierReturns.use('*', authMiddleware)
supplierReturns.use('*', requireModule('parts_stock'))

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : d
}
const WRITE_ROLES = ['super_admin', 'org_admin', 'site_admin', 'service_advisor'] as const
const VALID_REASON = ['unused', 'declined', 'core', 'warranty', 'damaged']

async function nextRmaNumber(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin.rpc('next_supplier_return_number', { p_org_id: orgId })
  return (data as string) ?? 'RMA000000'
}

// List returns
supplierReturns.get('/', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const status = c.req.query('status')
    let q = supabaseAdmin
      .from('supplier_returns')
      .select('id, rma_ref, status, supplier_id, supplier:suppliers(name), credit_note_ref, credit_amount, returned_at, created_at, lines:supplier_return_lines(id, qty, unit_cost)')
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(500)
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return c.json({ error: error.message }, 500)
    const returns = (data ?? []).map((r: Record<string, unknown>) => {
      const lines = (r.lines as Array<Record<string, unknown>>) || []
      const supplier = r.supplier as { name?: string } | null
      const value = Math.round(lines.reduce((s, l) => s + num(l.qty) * num(l.unit_cost), 0) * 100) / 100
      return {
        id: r.id, rmaRef: r.rma_ref, status: r.status, supplierId: r.supplier_id,
        supplierName: supplier?.name ?? null, creditNoteRef: r.credit_note_ref,
        creditAmount: r.credit_amount != null ? Number(r.credit_amount) : null,
        returnedAt: r.returned_at, createdAt: r.created_at, lineCount: lines.length, value,
      }
    })
    return c.json({ returns })
  } catch (error) {
    console.error('List supplier returns error:', error)
    return c.json({ error: 'Failed to list returns' }, 500)
  }
})

// Return detail
supplierReturns.get('/:id', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data: r, error } = await supabaseAdmin
      .from('supplier_returns')
      .select('*, supplier:suppliers(name), lines:supplier_return_lines(*)')
      .eq('id', id).eq('organization_id', auth.orgId).single()
    if (error || !r) return c.json({ error: 'Return not found' }, 404)
    const supplier = r.supplier as { name?: string } | null
    return c.json({
      return: {
        id: r.id, rmaRef: r.rma_ref, status: r.status, supplierId: r.supplier_id,
        supplierName: supplier?.name ?? null, creditNoteRef: r.credit_note_ref,
        creditAmount: r.credit_amount != null ? Number(r.credit_amount) : null,
        notes: r.notes, returnedAt: r.returned_at, createdAt: r.created_at,
        lines: ((r.lines as Array<Record<string, unknown>>) || []).map(l => ({
          id: l.id, partNumber: l.part_number, description: l.description,
          qty: num(l.qty), unitCost: num(l.unit_cost), reason: l.reason, isStocked: Boolean(l.is_stocked),
        })),
      },
    })
  } catch (error) {
    console.error('Get supplier return error:', error)
    return c.json({ error: 'Failed to get return' }, 500)
  }
})

// Create a return from parts (typically the Parts-to-Return report, one supplier at a time).
// Body: { supplierId?, notes?, lines: [{ repairPartId?, stockItemId?, purchaseOrderLineId?, partNumber?, description?, qty, unitCost, reason?, isStocked? }] }
supplierReturns.post('/', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()
    const lines: Array<Record<string, unknown>> = Array.isArray(b.lines) ? b.lines : []
    if (!lines.length) return c.json({ error: 'lines is required' }, 400)
    const rmaRef = await nextRmaNumber(auth.orgId)
    const { data: ret, error } = await supabaseAdmin
      .from('supplier_returns')
      .insert({ organization_id: auth.orgId, supplier_id: b.supplierId ?? null, rma_ref: rmaRef, status: 'to_return', notes: b.notes ?? null, created_by: auth.user.id })
      .select('id').single()
    if (error || !ret) return c.json({ error: error?.message ?? 'Failed to create return' }, 500)

    const rows = lines.map(l => ({
      organization_id: auth.orgId,
      supplier_return_id: ret.id,
      repair_part_id: (l.repairPartId as string) ?? null,
      stock_item_id: (l.stockItemId as string) ?? null,
      purchase_order_line_id: (l.purchaseOrderLineId as string) ?? null,
      part_number: (l.partNumber as string) ?? null,
      description: (l.description as string) ?? null,
      qty: num(l.qty, 1),
      unit_cost: num(l.unitCost, 0),
      reason: VALID_REASON.includes(l.reason as string) ? (l.reason as string) : 'unused',
      is_stocked: Boolean(l.isStocked),
    }))
    await supabaseAdmin.from('supplier_return_lines').insert(rows)

    // Mark the linked job lines as to_return (they're heading back to the factor).
    const partIds = lines.map(l => l.repairPartId as string).filter(Boolean)
    if (partIds.length) {
      await supabaseAdmin.from('repair_parts')
        .update({ line_status: 'to_return', updated_at: new Date().toISOString() })
        .in('id', partIds).neq('line_status', 'invoiced')
    }
    return c.json({ id: ret.id, rmaRef })
  } catch (error) {
    console.error('Create supplier return error:', error)
    return c.json({ error: 'Failed to create return' }, 500)
  }
})

// Ship — stocked lines write a return_out movement (SOH↓). Non-stock lines just advance.
supplierReturns.post('/:id/ship', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data: ret } = await supabaseAdmin
      .from('supplier_returns').select('id, status').eq('id', id).eq('organization_id', auth.orgId).single()
    if (!ret) return c.json({ error: 'Return not found' }, 404)
    const { data: lines } = await supabaseAdmin
      .from('supplier_return_lines').select('stock_item_id, qty, unit_cost, is_stocked').eq('supplier_return_id', id)
    for (const l of lines ?? []) {
      if (l.is_stocked && l.stock_item_id) {
        const qty = num(l.qty, 0)
        await supabaseAdmin.from('stock_movements').insert({
          organization_id: auth.orgId,
          stock_item_id: l.stock_item_id,
          movement_type: 'return_out',
          qty_delta: -qty,
          unit_cost: num(l.unit_cost, 0),
          total_cost: Math.round(-qty * num(l.unit_cost, 0) * 100) / 100,
          reference_type: 'supplier_return',
          reference_id: id,
          created_by: auth.user.id,
        })
      }
    }
    await supabaseAdmin.from('supplier_returns')
      .update({ status: 'shipped', returned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id).eq('organization_id', auth.orgId)
    return c.json({ ok: true })
  } catch (error) {
    console.error('Ship supplier return error:', error)
    return c.json({ error: 'Failed to ship return' }, 500)
  }
})

// Record the supplier credit note — fires Event 5 + marks the lines credited.
supplierReturns.post('/:id/credit', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const b = await c.req.json()
    const res = await postSupplierCreditJournal(id, auth.orgId, auth.user.id, { creditNoteRef: b.creditNoteRef ?? null })
    if (!res.ok) return c.json({ error: res.error ?? 'Failed to post credit' }, 400)
    await supabaseAdmin.from('supplier_returns')
      .update({ status: 'credited', credit_note_ref: b.creditNoteRef ?? null, credit_amount: b.creditAmount != null ? num(b.creditAmount) : null, reconciled_po_id: b.poId ?? null, updated_at: new Date().toISOString() })
      .eq('id', id).eq('organization_id', auth.orgId)
    // Mark linked job lines credited (terminal).
    const { data: lines } = await supabaseAdmin
      .from('supplier_return_lines').select('repair_part_id').eq('supplier_return_id', id)
    const partIds = (lines ?? []).map(l => l.repair_part_id).filter(Boolean) as string[]
    if (partIds.length) {
      await supabaseAdmin.from('repair_parts').update({ line_status: 'credited', updated_at: new Date().toISOString() }).in('id', partIds)
    }
    return c.json({ ok: true, journalId: res.journalId })
  } catch (error) {
    console.error('Credit supplier return error:', error)
    return c.json({ error: 'Failed to record credit' }, 500)
  }
})

// Reject — factor refused the credit.
supplierReturns.post('/:id/reject', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    await supabaseAdmin.from('supplier_returns')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', id).eq('organization_id', auth.orgId)
    const { data: lines } = await supabaseAdmin
      .from('supplier_return_lines').select('repair_part_id').eq('supplier_return_id', id)
    const partIds = (lines ?? []).map(l => l.repair_part_id).filter(Boolean) as string[]
    if (partIds.length) {
      await supabaseAdmin.from('repair_parts').update({ line_status: 'return_rejected', updated_at: new Date().toISOString() }).in('id', partIds)
    }
    return c.json({ ok: true })
  } catch (error) {
    console.error('Reject supplier return error:', error)
    return c.json({ error: 'Failed to reject return' }, 500)
  }
})

export default supplierReturns
