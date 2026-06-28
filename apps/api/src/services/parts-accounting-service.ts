/**
 * Parts accounting — Simple-mode events (GMS/PARTS.md §6, §7.3, §7.7).
 *
 *  - recognizeSimplePurchase: the "Mark purchased" action. Expenses a part's
 *    cost straight to the P&L AT PURCHASE (Dr Parts COGS / Dr VAT Input / Cr AP),
 *    dated so it reconciles the supplier's monthly statement.
 *  - invoiceJobsheet: stamps the jobsheet invoice (the single sale trigger) and
 *    posts the parts SALE journal (Dr AR / Cr Parts Sales / Cr VAT Output).
 *    Simple mode posts no cost leg at invoice (cost was taken at purchase).
 *  - reverseJobsheetInvoice: reopen path — reverses the sale journal.
 *
 * The £0-cost gate blocks an invoice whose billable parts have no recorded cost
 * (would silently book 100% margin) unless force=true.
 */
import { supabaseAdmin } from '../lib/supabase.js'
import { postJournal, reverseJournal } from './inventory-journal-service.js'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const today = () => new Date().toISOString().slice(0, 10)

async function getVatRate(orgId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('vat_rate')
    .eq('organization_id', orgId)
    .maybeSingle()
  const r = Number(data?.vat_rate)
  return Number.isFinite(r) ? r : 20
}

async function getPartsMode(orgId: string): Promise<'simple' | 'full'> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('parts_mode')
    .eq('organization_id', orgId)
    .maybeSingle()
  return data?.parts_mode === 'full' ? 'full' : 'simple'
}

/** Resolve the jobsheet/health_check a repair_part hangs off (best-effort, for jobPath linking). */
async function resolveJobRefs(repairItemId: string | null, repairOptionId: string | null) {
  let itemId = repairItemId
  if (!itemId && repairOptionId) {
    const { data: opt } = await supabaseAdmin
      .from('repair_options')
      .select('repair_item_id')
      .eq('id', repairOptionId)
      .maybeSingle()
    itemId = opt?.repair_item_id ?? null
  }
  if (!itemId) return { jobsheetId: null as string | null, healthCheckId: null as string | null }
  const { data: item } = await supabaseAdmin
    .from('repair_items')
    .select('jobsheet_id, health_check_id')
    .eq('id', itemId)
    .maybeSingle()
  let jobsheetId = item?.jobsheet_id ?? null
  const healthCheckId = item?.health_check_id ?? null
  // If the part hangs off a VHC, its parent jobsheet (if any) carries the job link.
  if (!jobsheetId && healthCheckId) {
    const { data: hc } = await supabaseAdmin
      .from('health_checks')
      .select('jobsheet_id')
      .eq('id', healthCheckId)
      .maybeSingle()
    jobsheetId = hc?.jobsheet_id ?? null
  }
  return { jobsheetId, healthCheckId }
}

export interface SimplePurchaseResult {
  ok: boolean
  skipped?: boolean
  journalId?: string | null
  error?: string
}

/**
 * "Mark purchased" — expense a part's cost to the P&L at the purchase date.
 * Idempotent on the repair_part (purchase_recognised_at guard).
 */
export async function recognizeSimplePurchase(
  repairPartId: string,
  orgId: string,
  userId: string | null,
  opts: { purchasedAt?: string | null } = {}
): Promise<SimplePurchaseResult> {
  const { data: part, error } = await supabaseAdmin
    .from('repair_parts')
    .select(
      'id, repair_item_id, repair_option_id, part_number, description, quantity, cost_price, supplier_id, supplier_name, purchased_at, purchase_recognised_at'
    )
    .eq('id', repairPartId)
    .maybeSingle()

  if (error || !part) return { ok: false, error: error?.message ?? 'Part not found' }
  if (part.purchase_recognised_at) return { ok: true, skipped: true, journalId: null }

  const cost = Number(part.cost_price) || 0
  const qty = Number(part.quantity) || 0
  if (cost <= 0 || qty <= 0) {
    return { ok: false, error: 'Set a cost and quantity before marking the part purchased' }
  }

  const purchasedAt = opts.purchasedAt || part.purchased_at || today()
  const vatRate = await getVatRate(orgId)
  const costNet = round2(cost * qty)
  const vat = round2(costNet * (vatRate / 100))
  const gross = round2(costNet + vat)
  const desc = [part.part_number, part.description].filter(Boolean).join(' — ') || 'Part'

  const { jobsheetId, healthCheckId } = await resolveJobRefs(part.repair_item_id, part.repair_option_id)

  const { journalId, error: jErr } = await postJournal({
    organizationId: orgId,
    sourceEvent: 'simple_purchase',
    sourceType: 'repair_part',
    sourceId: part.id,
    jobsheetId,
    healthCheckId,
    documentDate: purchasedAt,
    idempotencyKey: `simple_purchase:${part.id}`,
    createdBy: userId,
    lines: [
      { account: 'parts_cogs', debit: costNet, description: `Parts cost — ${desc}`, entityType: 'supplier', entityId: part.supplier_id, trackingJobId: jobsheetId ?? healthCheckId },
      { account: 'vat_input', debit: vat, taxCode: 'STD_20', taxAmount: vat, description: 'Input VAT on parts purchase' },
      { account: 'accounts_payable', credit: gross, description: `Payable — ${part.supplier_name ?? 'supplier'}`, entityType: 'supplier', entityId: part.supplier_id },
    ],
  })

  if (jErr) return { ok: false, error: jErr }

  await supabaseAdmin
    .from('repair_parts')
    .update({
      purchased_at: purchasedAt,
      purchase_recognised_at: new Date().toISOString(),
      purchased_by: userId,
      purchase_journal_id: journalId,
    })
    .eq('id', part.id)

  return { ok: true, journalId }
}

/** Undo a Simple purchase (e.g. mistaken mark-purchased): reverse + clear. */
export async function unrecognizeSimplePurchase(
  repairPartId: string,
  _orgId: string,
  userId: string | null
): Promise<SimplePurchaseResult> {
  const { data: part } = await supabaseAdmin
    .from('repair_parts')
    .select('id, purchase_journal_id, purchase_recognised_at')
    .eq('id', repairPartId)
    .maybeSingle()
  if (!part?.purchase_recognised_at) return { ok: true, skipped: true }
  if (part.purchase_journal_id) {
    await reverseJournal(part.purchase_journal_id, { createdBy: userId })
  }
  await supabaseAdmin
    .from('repair_parts')
    .update({ purchase_recognised_at: null, purchase_journal_id: null })
    .eq('id', repairPartId)
  return { ok: true }
}

interface BillablePart {
  id: string
  line_total: number
  cost_price: number | null
  description: string | null
  part_number: string | null
  quantity: number | null
  qty_fitted: number | null
  stock_item_id: string | null
  cogs_recognised_at: string | null
  cogs_snapshot: number | null
  purchase_order_line_id: string | null
  supplier_id: string | null
  supplier_name: string | null
}

const BILLABLE_PART_COLS =
  'id, line_total, cost_price, description, part_number, quantity, qty_fitted, stock_item_id, cogs_recognised_at, cogs_snapshot, purchase_order_line_id, supplier_id, supplier_name'

/** Gather the billable parts for a jobsheet (authorised items + their selected option). */
async function gatherJobsheetParts(jobsheetId: string, _orgId: string): Promise<{
  parts: BillablePart[]
  healthCheckId: string | null
}> {
  // Child VHC(s) of the jobsheet
  const { data: hcs } = await supabaseAdmin
    .from('health_checks')
    .select('id')
    .eq('jobsheet_id', jobsheetId)
    .is('deleted_at', null)
  const hcIds = (hcs ?? []).map((h) => h.id)
  const healthCheckId = hcIds[0] ?? null

  // Top-level items billed by this jobsheet (booked-direct ∪ linked-VHC findings)
  const { data: items } = await supabaseAdmin
    .from('repair_items')
    .select('id, selected_option_id, parent_repair_item_id, deleted_at, outcome_status, customer_approved, jobsheet_id, health_check_id')
    .or(
      `jobsheet_id.eq.${jobsheetId}${hcIds.length ? `,health_check_id.in.(${hcIds.join(',')})` : ''}`
    )

  const billable = (items ?? []).filter(
    (it) =>
      !it.deleted_at &&
      !it.parent_repair_item_id &&
      it.outcome_status !== 'deleted' &&
      (it.customer_approved === true || it.outcome_status === 'authorised')
  )

  const itemIdsNoOption = billable.filter((b) => !b.selected_option_id).map((b) => b.id)
  const selectedOptionIds = billable.filter((b) => b.selected_option_id).map((b) => b.selected_option_id as string)

  if (!itemIdsNoOption.length && !selectedOptionIds.length) return { parts: [], healthCheckId }

  // Collect each repair_part once, via item OR selected-option FK (never both).
  const partsMap = new Map<string, BillablePart>()
  if (itemIdsNoOption.length) {
    const { data } = await supabaseAdmin
      .from('repair_parts')
      .select(BILLABLE_PART_COLS)
      .in('repair_item_id', itemIdsNoOption)
    for (const p of data ?? []) partsMap.set(p.id, p as BillablePart)
  }
  if (selectedOptionIds.length) {
    const { data } = await supabaseAdmin
      .from('repair_parts')
      .select(BILLABLE_PART_COLS)
      .in('repair_option_id', selectedOptionIds)
    for (const p of data ?? []) partsMap.set(p.id, p as BillablePart)
  }
  return { parts: [...partsMap.values()], healthCheckId }
}

/** is_stocked + current WAVCO per stock item — for COGS valuation + the £0-cost gate. */
async function fetchStockInfo(stockItemIds: string[]): Promise<Map<string, { isStocked: boolean; averageCost: number }>> {
  const map = new Map<string, { isStocked: boolean; averageCost: number }>()
  const ids = [...new Set(stockItemIds.filter(Boolean))]
  if (!ids.length) return map
  const { data } = await supabaseAdmin.from('parts_catalog').select('id, is_stocked, average_cost').in('id', ids)
  for (const r of data ?? []) map.set(r.id as string, { isStocked: Boolean(r.is_stocked), averageCost: Number(r.average_cost) || 0 })
  return map
}

/** The unit cost used for COGS + the £0-cost gate: WAVCO for stocked items, else the line cost. */
function effectiveUnitCost(p: BillablePart, stockInfo: Map<string, { isStocked: boolean; averageCost: number }>): number {
  const si = p.stock_item_id ? stockInfo.get(p.stock_item_id) : null
  if (si?.isStocked) return si.averageCost > 0 ? si.averageCost : Number(p.cost_price) || 0
  return Number(p.cost_price) || 0
}

export interface InvoiceJobsheetResult {
  ok: boolean
  blocked?: boolean
  blockers?: Array<{ id: string; label: string }>
  warnings?: string[]
  invoiceNumber?: string
  journalId?: string | null
  alreadyInvoiced?: boolean
  error?: string
}

/**
 * Invoice a jobsheet — the single COGS/sale trigger. Stamps invoice state and
 * posts the parts SALE journal. Simple mode posts revenue only (cost already
 * expensed at purchase). £0-cost gate blocks unless force=true.
 */
export async function invoiceJobsheet(
  jobsheetId: string,
  orgId: string,
  userId: string | null,
  opts: { force?: boolean; taxPointDate?: string | null } = {}
): Promise<InvoiceJobsheetResult> {
  const { data: js, error } = await supabaseAdmin
    .from('jobsheets')
    .select('id, organization_id, closed_at, invoice_number')
    .eq('id', jobsheetId)
    .maybeSingle()
  if (error || !js) return { ok: false, error: error?.message ?? 'Jobsheet not found' }
  if (js.organization_id !== orgId) return { ok: false, error: 'Jobsheet not found' }
  if (js.closed_at) {
    return { ok: true, alreadyInvoiced: true, invoiceNumber: js.invoice_number ?? undefined }
  }

  const mode = await getPartsMode(orgId)
  const { parts, healthCheckId } = await gatherJobsheetParts(jobsheetId, orgId)
  const stockInfo = await fetchStockInfo(parts.map((p) => p.stock_item_id).filter(Boolean) as string[])

  // £0-cost gate: a billable part being sold with no recorded cost books 100% margin.
  // Stocked items value at WAVCO, so the gate uses the effective unit cost, not just cost_price.
  const blockers = parts
    .filter((p) => Number(p.line_total) > 0 && effectiveUnitCost(p, stockInfo) <= 0)
    .map((p) => ({ id: p.id, label: [p.part_number, p.description].filter(Boolean).join(' — ') || 'Part' }))
  if (blockers.length && !opts.force) {
    return { ok: false, blocked: true, blockers }
  }

  const vatRate = await getVatRate(orgId)
  const partsNet = round2(parts.reduce((s, p) => s + (Number(p.line_total) || 0), 0))
  const vat = round2(partsNet * (vatRate / 100))
  const gross = round2(partsNet + vat)

  // Stamp the invoice state (this is the customer VAT invoice).
  const taxPointDate = opts.taxPointDate || today()
  const { data: invNum } = await supabaseAdmin.rpc('next_jobsheet_invoice_number', { p_org_id: orgId })
  const invoiceNumber = (invNum as string) ?? null
  await supabaseAdmin
    .from('jobsheets')
    .update({
      closed_at: new Date().toISOString(),
      invoice_number: invoiceNumber,
      tax_point_date: taxPointDate,
      closed_by: userId,
    })
    .eq('id', jobsheetId)

  // The sale leg (Event 3b) — identical in both modes (Dr AR / Cr Sales / Cr VAT Output).
  // Keyed by invoice number so a reopen→re-invoice posts a fresh journal (§7.7).
  let journalId: string | null = null
  if (partsNet > 0) {
    const res = await postJournal({
      organizationId: orgId,
      sourceEvent: 'part_sale',
      sourceType: 'jobsheet',
      sourceId: jobsheetId,
      jobsheetId,
      healthCheckId,
      documentDate: taxPointDate,
      invoiceNumber: invoiceNumber ?? undefined,
      taxPointDate,
      idempotencyKey: `part_sale:${jobsheetId}:${invoiceNumber ?? ''}`,
      createdBy: userId,
      lines: [
        { account: 'accounts_receivable', debit: gross, description: `Parts on invoice ${invoiceNumber ?? ''}`.trim(), entityType: 'customer', trackingJobId: jobsheetId },
        { account: 'parts_sales', credit: partsNet, description: 'Parts sales' },
        { account: 'vat_output', credit: vat, taxCode: 'STD_20', taxAmount: vat, description: 'Output VAT on parts' },
      ],
    })
    journalId = res.journalId
  }

  const warnings: string[] = []

  if (mode === 'full') {
    // Full mode: the COST side at the jobsheet invoice. Issue movement + Event 3a (stocked:
    // Dr COGS / Cr Inventory) or 4A-sale (non-stock: Dr COGS / Cr WIP), atomic with the sale
    // (§7.2/§13 Q11 simpler-alternative: issue + COGS both fire here, not at booking).
    let stockedCogs = 0
    let nonStockCogs = 0
    for (const p of parts) {
      if (p.cogs_recognised_at) continue // idempotent (cleared + reversed on reopen, §7.7)
      const qtyFitted = Number(p.qty_fitted ?? p.quantity ?? 1) || 1
      const unitCost = effectiveUnitCost(p, stockInfo)
      if (unitCost <= 0) continue
      const extCogs = round2(qtyFitted * unitCost)
      const si = p.stock_item_id ? stockInfo.get(p.stock_item_id) : null
      const isStocked = Boolean(si?.isStocked)
      if (isStocked) {
        stockedCogs += extCogs
        // Relieve physical stock (SOH↓). The trigger does not re-roll average on an issue.
        await supabaseAdmin.from('stock_movements').insert({
          organization_id: orgId,
          stock_item_id: p.stock_item_id,
          movement_type: 'issue',
          qty_delta: -qtyFitted,
          unit_cost: unitCost,
          total_cost: round2(-extCogs),
          reference_type: 'repair_part',
          reference_id: p.id,
          repair_part_id: p.id,
          document_date: taxPointDate,
          created_by: userId,
        })
      } else {
        nonStockCogs += extCogs
      }
      await supabaseAdmin.from('repair_parts').update({
        cogs_snapshot: unitCost,
        cogs_recognised_at: new Date().toISOString(),
        qty_fitted: qtyFitted,
        line_status: 'invoiced',
        updated_at: new Date().toISOString(),
      }).eq('id', p.id)
      if (p.purchase_order_line_id) {
        await supabaseAdmin.from('purchase_order_lines')
          .update({ reconciled: true, line_status: 'invoiced', updated_at: new Date().toISOString() })
          .eq('id', p.purchase_order_line_id)
      }
    }
    const totalCogs = round2(stockedCogs + nonStockCogs)
    if (totalCogs > 0) {
      await postJournal({
        organizationId: orgId,
        sourceEvent: 'part_cogs',
        sourceType: 'jobsheet',
        sourceId: jobsheetId,
        jobsheetId,
        healthCheckId,
        documentDate: taxPointDate,
        invoiceNumber: invoiceNumber ?? undefined,
        taxPointDate,
        idempotencyKey: `part_cogs:${jobsheetId}:${invoiceNumber ?? ''}`,
        createdBy: userId,
        lines: [
          { account: 'parts_cogs', debit: totalCogs, description: 'Parts COGS' },
          { account: 'parts_stock', credit: round2(stockedCogs), description: 'Relieve inventory (stocked)' },
          { account: 'parts_wip', credit: round2(nonStockCogs), description: 'Relieve WIP clearing (non-stock)' },
        ],
      })
    }
  } else {
    // Simple mode: cost was taken at purchase. Warn on any sold-but-not-yet-purchased lines.
    const partIds = parts.map((p) => p.id)
    if (partIds.length) {
      const { data: unp } = await supabaseAdmin
        .from('repair_parts')
        .select('id')
        .in('id', partIds)
        .is('purchase_recognised_at', null)
        .gt('cost_price', 0)
      if (unp?.length) warnings.push(`${unp.length} part(s) sold but not yet marked purchased — their cost hasn't hit the P&L.`)
    }
  }

  return { ok: true, invoiceNumber: invoiceNumber ?? undefined, journalId, warnings: warnings.length ? warnings : undefined }
}

/** Reopen a jobsheet invoice — reverse the sale journal + clear invoice state (GMS/PARTS.md §7.7). */
export async function reverseJobsheetInvoice(
  jobsheetId: string,
  orgId: string,
  userId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const { data: js } = await supabaseAdmin
    .from('jobsheets')
    .select('id, organization_id, closed_at')
    .eq('id', jobsheetId)
    .maybeSingle()
  if (!js || js.organization_id !== orgId) return { ok: false, error: 'Jobsheet not found' }
  if (!js.closed_at) return { ok: true }

  // Reverse every journal raised for this jobsheet invoice.
  const { data: journals } = await supabaseAdmin
    .from('inventory_journal')
    .select('id, source_event')
    .eq('organization_id', orgId)
    .eq('jobsheet_id', jobsheetId)
    .in('source_event', ['simple_sale', 'part_sale', 'part_cogs', 'non_stock_cogs'])
    .neq('posting_status', 'voided')
  for (const j of journals ?? []) {
    await reverseJournal(j.id, { createdBy: userId })
  }

  // Full mode: clear the COGS lock so re-invoicing re-recognises against the final basket,
  // and put any issued stock back (a reversing adjustment, no average re-roll) — §7.7.
  const { parts } = await gatherJobsheetParts(jobsheetId, orgId)
  const recognised = parts.filter((p) => p.cogs_recognised_at)
  if (recognised.length) {
    const stockInfo = await fetchStockInfo(recognised.map((p) => p.stock_item_id).filter(Boolean) as string[])
    for (const p of recognised) {
      const si = p.stock_item_id ? stockInfo.get(p.stock_item_id) : null
      if (si?.isStocked) {
        const qty = Number(p.qty_fitted ?? p.quantity ?? 1) || 1
        const unit = Number(p.cogs_snapshot) || si.averageCost || 0
        await supabaseAdmin.from('stock_movements').insert({
          organization_id: orgId,
          stock_item_id: p.stock_item_id,
          movement_type: 'adjustment',
          qty_delta: qty,
          unit_cost: unit,
          total_cost: round2(qty * unit),
          reference_type: 'repair_part',
          reference_id: p.id,
          repair_part_id: p.id,
          reason_code: 'reopen_reversal',
          document_date: today(),
          created_by: userId,
        })
      }
      await supabaseAdmin.from('repair_parts')
        .update({ cogs_snapshot: null, cogs_recognised_at: null, line_status: 'fitted', updated_at: new Date().toISOString() })
        .eq('id', p.id)
    }
  }

  await supabaseAdmin
    .from('jobsheets')
    .update({ closed_at: null, invoice_number: null, tax_point_date: null, closed_by: null })
    .eq('id', jobsheetId)

  return { ok: true }
}
