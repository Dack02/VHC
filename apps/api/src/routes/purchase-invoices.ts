import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { recordSupplierInvoice } from '../services/parts-accounting-service.js'
import { resolveSellPrice } from '../services/pricing-matrix-service.js'

/**
 * Purchase Invoice entry — the "invoice in hand" flow (GMS/PARTS.md §5.7/§6/§7).
 *
 * Records a supplier invoice in ONE action, reusing the existing PO + goods-receipt +
 * Event-2/4A journal rails: a "direct invoice" is a purchase_order created straight to
 * status='invoiced' (origin='direct_invoice'). Per line, a disposition drives the books:
 *   - 'stock' → catalogue part (create/promote to stocked) + receipt movement (SOH↑,
 *     provisional WAVCO) → Event 2 books the inventory asset (Dr Inventory / Cr AP).
 *   - 'job'   → a priced line is added to the target jobsheet (authorised work line) and
 *     NO stock movement is written → Event 4A parks the cost in WIP (Dr WIP / Cr AP); COGS
 *     lands when that jobsheet is invoiced.
 * One invoice may mix both and fan job lines out to several jobsheets in a single post.
 *
 * Gated behind `parts_stock` (Full mode). qty_on_hand/average_cost are DERIVED — only the
 * receipt movement (via the apply_stock_movement trigger) moves them; never written here.
 * Idempotent on a client-supplied clientRequestId so a double-submit/retry can't duplicate.
 */
const purchaseInvoices = new Hono()
purchaseInvoices.use('*', authMiddleware)
purchaseInvoices.use('*', requireModule('parts_stock'))

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : d
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WRITE_ROLES = ['super_admin', 'org_admin', 'site_admin', 'service_advisor'] as const

// Stable part number for an ad-hoc line with none — mirrors purchase-orders.ts so re-entry of
// the same name links to the existing catalogue row via the (org, part_number) lookup.
function derivePartNumber(partNumber: string | null, description: string | null): string {
  const base = (partNumber && partNumber.trim()) || (description && description.trim()) || 'PART'
  const slug = base.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug || 'PART'
}
async function nextPoNumber(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin.rpc('next_purchase_order_number', { p_org_id: orgId })
  return (data as string) ?? 'PO000000'
}
async function nextGrnNumber(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin.rpc('next_goods_receipt_number', { p_org_id: orgId })
  return (data as string) ?? 'GRN000000'
}

interface InvoiceLineInput {
  partId: string | null
  partNumber: string | null
  description: string
  qty: number
  unitCost: number
  target: 'stock' | 'job'
  jobsheetId: string | null
  categoryId: string | null
  sellPrice: number | null
}
interface ResolvedLine {
  line: InvoiceLineInput
  stockItemId: string | null
  lineStocked: boolean
  linePartNumber: string | null
  categoryId: string | null
}

// ===========================================================================
// Purchase ledger — invoiced POs (raised-then-invoiced ∪ direct invoices) with
// net/VAT/gross from each one's purchase_invoice journal.
// ===========================================================================
purchaseInvoices.get('/', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { data: pos, error } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, po_number, origin, supplier_id, supplier:suppliers(name), supplier_invoice_ref, supplier_invoice_date, created_at')
      .eq('organization_id', auth.orgId)
      .eq('status', 'invoiced')
      .order('supplier_invoice_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return c.json({ error: error.message }, 500)

    const poIds = (pos ?? []).map((p) => p.id as string)
    const totals = new Map<string, { net: number; vat: number; gross: number }>()
    if (poIds.length) {
      const { data: journals } = await supabaseAdmin
        .from('inventory_journal')
        .select('source_id, net_total, tax_total, gross_total')
        .eq('organization_id', auth.orgId)
        .eq('source_event', 'purchase_invoice')
        .in('source_id', poIds)
      for (const j of journals ?? []) {
        // At most one purchase_invoice journal per PO (idempotent on poId+ref).
        totals.set(j.source_id as string, { net: num(j.net_total), vat: num(j.tax_total), gross: num(j.gross_total) })
      }
    }

    const invoices = (pos ?? []).map((p) => {
      const sup = p.supplier as { name?: string } | null
      const t = totals.get(p.id as string) || { net: 0, vat: 0, gross: 0 }
      return {
        id: p.id,
        poNumber: p.po_number,
        origin: p.origin,
        supplierId: p.supplier_id,
        supplierName: sup?.name ?? null,
        invoiceRef: p.supplier_invoice_ref,
        invoiceDate: p.supplier_invoice_date,
        net: t.net,
        vat: t.vat,
        gross: t.gross,
      }
    })
    return c.json({ invoices })
  } catch (error) {
    console.error('List purchase invoices error:', error)
    return c.json({ error: 'Failed to list purchase invoices' }, 500)
  }
})

// ===========================================================================
// Record a supplier invoice in hand (direct entry).
// Body: {
//   clientRequestId? (UUID, idempotency), supplierId?, invoiceRef?, invoiceDate? (YYYY-MM-DD),
//   vat? (actual VAT total), notes?,
//   lines: [{ partId?, partNumber?, description, qty, unitCost, target:'stock'|'job',
//             jobsheetId?, categoryId?, sellPrice? }]
// }
// ===========================================================================
purchaseInvoices.post('/', authorize([...WRITE_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const b = await c.req.json()

    const lines: InvoiceLineInput[] = (Array.isArray(b.lines) ? b.lines : [])
      .map((l: Record<string, unknown>) => ({
        partId: (l.partId as string) || null,
        partNumber: (l.partNumber as string) || null,
        description: ((l.description as string) || '').trim(),
        qty: num(l.qty, 0),
        unitCost: num(l.unitCost, 0),
        target: l.target === 'job' ? 'job' : 'stock',
        jobsheetId: (l.jobsheetId as string) || null,
        categoryId: (l.categoryId as string) || null,
        sellPrice: l.sellPrice != null && l.sellPrice !== '' ? num(l.sellPrice) : null,
      }))
      .filter((l: InvoiceLineInput) => l.description && l.qty > 0)

    if (!lines.length) return c.json({ error: 'Add at least one line with a description and quantity' }, 400)
    // A zero/negative unit cost on a stock line would dilute WAVCO toward zero; require a real cost.
    if (lines.some((l) => l.unitCost <= 0)) return c.json({ error: 'Every line needs a unit cost greater than zero' }, 400)
    const totalNet = round2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0))
    if (totalNet <= 0) return c.json({ error: 'Invoice total must be greater than zero' }, 400)

    // Idempotency: a repeat of the same client request must NOT mint a second PO (which would
    // duplicate stock receipts/journals/job parts). A prior PO that's already 'invoiced' replays as
    // success; one still 'ordered' means a previous journal post failed mid-way — re-drive it (the
    // journal RPC dedups on its key) so the natural retry actually completes the post rather than
    // silently reporting success with no GL entry.
    const completePriorInvoice = async (prior: { id: string; po_number: string | null; status: string; supplier_invoice_ref: string | null; supplier_invoice_date: string | null }) => {
      if (prior.status === 'invoiced') {
        return c.json({ ok: true, purchaseOrderId: prior.id, poNumber: prior.po_number, idempotentReplay: true })
      }
      const { data: poLines } = await supabaseAdmin
        .from('purchase_order_lines').select('id, qty_received, qty_ordered, unit_cost')
        .eq('purchase_order_id', prior.id).eq('organization_id', auth.orgId)
      const replayLines = (poLines ?? [])
        .map((l) => ({ poLineId: l.id as string, qty: num(l.qty_received) || num(l.qty_ordered), unitCost: num(l.unit_cost) }))
        .filter((l) => l.qty > 0)
      if (!replayLines.length) return c.json({ error: 'Could not complete the invoice', purchaseOrderId: prior.id }, 400)
      const r = await recordSupplierInvoice(prior.id, auth.orgId, auth.user.id, {
        invoiceRef: prior.supplier_invoice_ref,
        taxPointDate: prior.supplier_invoice_date,
        vatOverride: b.vat != null && b.vat !== '' ? num(b.vat) : null,
        lines: replayLines,
      })
      if (!r.ok) return c.json({ error: r.error ?? 'Could not complete the invoice', purchaseOrderId: prior.id }, 400)
      return c.json({ ok: true, purchaseOrderId: prior.id, poNumber: prior.po_number, journalId: r.journalId ?? null, idempotentReplay: true })
    }
    const PRIOR_COLS = 'id, po_number, status, supplier_invoice_ref, supplier_invoice_date'
    const clientRequestId =
      typeof b.clientRequestId === 'string' && UUID_RE.test(b.clientRequestId) ? b.clientRequestId : null
    if (clientRequestId) {
      const { data: prior } = await supabaseAdmin
        .from('purchase_orders').select(PRIOR_COLS)
        .eq('organization_id', auth.orgId).eq('client_request_id', clientRequestId).maybeSingle()
      if (prior) return await completePriorInvoice(prior as Parameters<typeof completePriorInvoice>[0])
    }

    // Validate job targets: owned + OPEN + not a soft-deleted or standalone-VHC shell jobsheet
    // (a shell/deleted job can never be invoiced, so its WIP cost could never clear).
    const jobIds = [...new Set(lines.filter((l) => l.target === 'job').map((l) => l.jobsheetId).filter(Boolean))] as string[]
    const jobEligible = new Map<string, boolean>()
    if (jobIds.length) {
      const { data: js } = await supabaseAdmin
        .from('jobsheets').select('id, closed_at, deleted_at, is_shell').eq('organization_id', auth.orgId).in('id', jobIds)
      for (const j of js ?? []) jobEligible.set(j.id as string, !j.closed_at && !j.deleted_at && !j.is_shell)
    }
    for (const l of lines) {
      if (l.target === 'job') {
        if (!l.jobsheetId) return c.json({ error: 'Pick a job for each line set to "Apply to job"' }, 400)
        if (!jobEligible.has(l.jobsheetId)) return c.json({ error: 'A tagged job was not found' }, 400)
        if (!jobEligible.get(l.jobsheetId))
          return c.json({ error: "A tagged job can't take parts (it's already invoiced, deleted, or a standalone-VHC shell) — pick another" }, 400)
      }
    }

    // Validate any picked catalogue part belongs to the org (a foreign id is treated as new).
    const wantParts = [...new Set(lines.map((l) => l.partId).filter(Boolean))] as string[]
    const ownedParts = new Map<string, { isStocked: boolean }>()
    if (wantParts.length) {
      const { data } = await supabaseAdmin
        .from('parts_catalog').select('id, is_stocked').eq('organization_id', auth.orgId).in('id', wantParts)
      for (const p of data ?? []) ownedParts.set(p.id as string, { isStocked: Boolean(p.is_stocked) })
    }

    // Validate any supplied category belongs to the org (else drop it — never tag a part with a
    // foreign tenant's category id).
    const wantCats = [...new Set(lines.map((l) => l.categoryId).filter(Boolean))] as string[]
    const ownedCats = new Set<string>()
    if (wantCats.length) {
      const { data } = await supabaseAdmin
        .from('part_categories').select('id').eq('organization_id', auth.orgId).in('id', wantCats)
      for (const cat of data ?? []) ownedCats.add(cat.id as string)
    }

    // Validate supplier ownership + grab its name (for the job-line denormalised supplier_name).
    let supplierId = (b.supplierId as string) || null
    let supplierName: string | null = null
    if (supplierId) {
      const { data: sup } = await supabaseAdmin
        .from('suppliers').select('id, name').eq('id', supplierId).eq('organization_id', auth.orgId).maybeSingle()
      if (sup) supplierName = sup.name as string
      else supplierId = null
    }

    const invoiceDate =
      typeof b.invoiceDate === 'string' && b.invoiceDate ? b.invoiceDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
    const invoiceRef = (b.invoiceRef as string) || null
    const now = new Date().toISOString()

    // ---- RESOLVE pass: settle each line's catalogue part BEFORE creating the PO, so a failure
    // aborts cleanly with no orphan PO. Stock lines must resolve a stock_item_id (else the Event-2
    // inventory debit would have no matching receipt movement). Job lines never link stock. ----
    const resolved: ResolvedLine[] = []
    for (const l of lines) {
      const categoryId = l.categoryId && ownedCats.has(l.categoryId) ? l.categoryId : null
      if (l.target === 'job') {
        // Job line goes straight to the job (WIP) — never into sellable stock, so no stock_item_id
        // (a stocked catalogue part linked here would be treated as a stock issue at jobsheet invoice).
        resolved.push({ line: l, stockItemId: null, lineStocked: false, linePartNumber: l.partNumber || null, categoryId })
        continue
      }
      let stockItemId: string | null = null
      let linePartNumber: string | null = l.partNumber || null
      if (l.partId && ownedParts.has(l.partId)) {
        stockItemId = l.partId
        if (!ownedParts.get(l.partId)!.isStocked) {
          await supabaseAdmin.from('parts_catalog')
            .update({ is_stocked: true, updated_at: now }).eq('id', l.partId).eq('organization_id', auth.orgId)
        }
      } else {
        const partNo = derivePartNumber(l.partNumber, l.description)
        linePartNumber = partNo
        const { data: existing } = await supabaseAdmin
          .from('parts_catalog').select('id, is_stocked').eq('organization_id', auth.orgId).eq('part_number', partNo).maybeSingle()
        if (existing) {
          stockItemId = existing.id as string
          if (!existing.is_stocked) {
            await supabaseAdmin.from('parts_catalog')
              .update({ is_stocked: true, updated_at: now }).eq('id', stockItemId).eq('organization_id', auth.orgId)
          }
        } else {
          const { data: created } = await supabaseAdmin
            .from('parts_catalog')
            .insert({
              organization_id: auth.orgId,
              part_number: partNo,
              description: l.description || partNo,
              cost_price: l.unitCost,
              is_stocked: true,
              category_id: categoryId,
              preferred_supplier_id: supplierId,
              created_by: auth.user.id,
              updated_at: now,
            })
            .select('id')
            .single()
          stockItemId = (created?.id as string) ?? null
        }
      }
      if (!stockItemId) {
        // No PO created yet → nothing to clean up. A stock line that can't get a catalogue part
        // must not proceed (it would debit inventory with no backing receipt movement).
        return c.json({ error: 'Could not record a stocked part on the invoice — try again' }, 500)
      }
      resolved.push({ line: l, stockItemId, lineStocked: true, linePartNumber, categoryId })
    }

    // ---- COMMIT pass ----
    const poNumber = await nextPoNumber(auth.orgId)
    const { data: po, error: poErr } = await supabaseAdmin
      .from('purchase_orders')
      .insert({
        organization_id: auth.orgId,
        supplier_id: supplierId,
        po_number: poNumber,
        status: 'ordered', // recordSupplierInvoice() flips this to 'invoiced' once the journal posts
        origin: 'direct_invoice',
        supplier_invoice_ref: invoiceRef,
        supplier_invoice_date: invoiceDate,
        client_request_id: clientRequestId,
        ordered_at: now,
        notes: b.notes ?? null,
        created_by: auth.user.id,
      })
      .select('id')
      .single()
    if (poErr || !po) {
      // Lost the idempotency race (two identical submits at once) → complete/return the winner.
      if ((poErr as { code?: string } | null)?.code === '23505' && clientRequestId) {
        const { data: prior } = await supabaseAdmin
          .from('purchase_orders').select(PRIOR_COLS)
          .eq('organization_id', auth.orgId).eq('client_request_id', clientRequestId).maybeSingle()
        if (prior) return await completePriorInvoice(prior as Parameters<typeof completePriorInvoice>[0])
      }
      return c.json({ error: poErr?.message ?? 'Failed to create invoice' }, 500)
    }
    const poId = po.id as string

    const grnNumber = await nextGrnNumber(auth.orgId)
    const { data: grn } = await supabaseAdmin
      .from('goods_receipts')
      .insert({
        organization_id: auth.orgId,
        purchase_order_id: poId,
        grn_number: grnNumber,
        notes: invoiceRef ? `Supplier invoice ${invoiceRef}` : 'Direct supplier invoice',
        received_by: auth.user.id,
      })
      .select('id')
      .single()
    const grnId = (grn?.id as string) ?? null

    const workLineByJob = new Map<string, string>() // jobsheetId → authorised work line (repair_item) id
    const invoiceLines: Array<{ poLineId: string; qty: number; unitCost: number }> = []
    let stockLines = 0
    let jobLines = 0

    for (const r of resolved) {
      const l = r.line
      const { data: poLine } = await supabaseAdmin
        .from('purchase_order_lines')
        .insert({
          organization_id: auth.orgId,
          purchase_order_id: poId,
          stock_item_id: r.stockItemId,
          part_number: r.linePartNumber,
          description: l.description,
          qty_ordered: l.qty,
          qty_received: l.qty,
          unit_cost: l.unitCost,
          line_status: 'received',
          is_stocked_at_receipt: r.lineStocked,
        })
        .select('id')
        .single()
      if (!poLine) continue // rare DB error — skip this line (PO stays recoverable)
      const poLineId = poLine.id as string

      if (grnId) {
        await supabaseAdmin.from('goods_receipt_lines').insert({
          organization_id: auth.orgId,
          goods_receipt_id: grnId,
          purchase_order_line_id: poLineId,
          stock_item_id: r.stockItemId,
          qty_received: l.qty,
          unit_cost: l.unitCost,
          condition: 'ok',
        })
      }

      if (r.lineStocked && r.stockItemId) {
        // Receipt movement → SOH↑ + provisional WAVCO (no GL journal here). Only invoice the line
        // (debit inventory) if the movement actually wrote — never debit the asset with no stock.
        const { error: mErr } = await supabaseAdmin.from('stock_movements').insert({
          organization_id: auth.orgId,
          stock_item_id: r.stockItemId,
          location_id: null,
          movement_type: 'receipt',
          qty_delta: l.qty,
          unit_cost: l.unitCost,
          total_cost: round2(l.qty * l.unitCost),
          reference_type: 'goods_receipt',
          reference_id: grnId,
          created_by: auth.user.id,
        })
        if (mErr) continue // movement failed → don't book the inventory asset for this line
        stockLines++
      } else if (l.target === 'job' && l.jobsheetId) {
        // Priced line on the target jobsheet's authorised work line. Only invoice it (debit WIP)
        // if the billable repair_part actually exists — else the WIP could never clear.
        let workLineId = workLineByJob.get(l.jobsheetId)
        if (!workLineId) {
          const wlName = invoiceRef ? `Parts — supplier invoice ${invoiceRef}` : 'Parts — supplier invoice'
          const { data: wl } = await supabaseAdmin
            .from('repair_items')
            .insert({
              jobsheet_id: l.jobsheetId,
              organization_id: auth.orgId,
              name: wlName,
              source: 'booking',
              outcome_status: 'authorised', // makes the line billable at jobsheet invoice
              outcome_source: 'manual',
              outcome_set_by: auth.user.id,
              outcome_set_at: now,
              created_by: auth.user.id,
            })
            .select('id')
            .single()
          if (wl) {
            workLineId = wl.id as string
            workLineByJob.set(l.jobsheetId, workLineId)
          }
        }
        if (!workLineId) continue // couldn't create the work line → don't book WIP with no billable line
        const sell =
          l.sellPrice != null && l.sellPrice >= 0
            ? round2(l.sellPrice)
            : (await resolveSellPrice(auth.orgId, l.unitCost, r.categoryId)).sellPrice
        const lineTotal = round2(l.qty * sell)
        const marginPercent = sell > 0 ? round2(((sell - l.unitCost) / sell) * 100) : 0
        const markupPercent = l.unitCost > 0 ? round2(((sell - l.unitCost) / l.unitCost) * 100) : 0
        const { data: rp } = await supabaseAdmin
          .from('repair_parts')
          .insert({
            repair_item_id: workLineId,
            part_number: l.partNumber || null,
            description: l.description,
            quantity: l.qty,
            supplier_id: supplierId,
            supplier_name: supplierName,
            cost_price: l.unitCost,
            sell_price: sell,
            line_total: lineTotal,
            margin_percent: marginPercent,
            markup_percent: markupPercent,
            purchase_order_line_id: poLineId,
            line_status: 'received',
            created_by: auth.user.id,
          })
          .select('id')
          .single()
        if (!rp) continue // couldn't create the billable part → don't book WIP for it
        await supabaseAdmin.from('purchase_order_lines')
          .update({ repair_part_id: rp.id, updated_at: now }).eq('id', poLineId)
        jobLines++
      }

      invoiceLines.push({ poLineId, qty: l.qty, unitCost: l.unitCost })
    }

    if (!invoiceLines.length) {
      // Nothing committed (every line hit a DB error) — tidy up the empty PO/GRN so it doesn't
      // linger as a phantom order. No stock movements were written (no line committed).
      if (grnId) await supabaseAdmin.from('goods_receipts').delete().eq('id', grnId).eq('organization_id', auth.orgId)
      await supabaseAdmin.from('purchase_orders').delete().eq('id', poId).eq('organization_id', auth.orgId)
      return c.json({ error: 'No valid lines to invoice' }, 400)
    }

    // Post the supplier-invoice journal (Event 2 stocked → Inventory, Event 4A job → WIP, + VAT +
    // AP) and flip the PO to invoiced. VAT taken from the invoice in hand when provided.
    const res = await recordSupplierInvoice(poId, auth.orgId, auth.user.id, {
      invoiceRef,
      taxPointDate: invoiceDate,
      vatOverride: b.vat != null && b.vat !== '' ? num(b.vat) : null,
      lines: invoiceLines,
    })
    if (!res.ok) {
      // The PO is left in a valid "received, not invoiced" state — recoverable via the PO's
      // supplier-invoice action — so we surface the error and the id rather than swallowing it.
      return c.json({ error: res.error ?? 'Goods received, but the invoice journal failed to post', purchaseOrderId: poId }, 400)
    }

    return c.json({
      ok: true,
      purchaseOrderId: poId,
      poNumber,
      grnNumber,
      journalId: res.journalId ?? null,
      stockLines,
      jobLines,
    })
  } catch (error) {
    console.error('Record purchase invoice error:', error)
    return c.json({ error: 'Failed to record purchase invoice' }, 500)
  }
})

export default purchaseInvoices
