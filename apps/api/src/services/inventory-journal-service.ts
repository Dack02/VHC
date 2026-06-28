/**
 * Inventory journal writer (GMS/PARTS.md §5.10).
 *
 * Thin typed wrapper over the atomic `post_inventory_journal` RPC. Computes the
 * period-lock-aware period_key + net/tax/gross totals, then posts a balanced,
 * idempotent double-entry journal. Corrections = reverseJournal (never edit a
 * posted journal). Journals are recorded internally now ("posted") and pushed to
 * an external GL later (P4) via journal_push_log.
 */
import { supabaseAdmin } from '../lib/supabase.js'

export type InternalAccountKey =
  | 'parts_stock'
  | 'parts_wip'
  | 'accounts_payable'
  | 'vat_input'
  | 'accounts_receivable'
  | 'parts_sales'
  | 'parts_cogs'
  | 'vat_output'
  | 'stock_adjustment'
  | 'purchase_price_variance'
  | 'core_liability'

export type JournalSourceEvent =
  | 'simple_purchase'
  | 'simple_sale'
  | 'goods_receipt'
  | 'purchase_invoice'
  | 'part_sale'
  | 'part_cogs'
  | 'non_stock_invoice'
  | 'non_stock_cogs'
  | 'supplier_credit'
  | 'stock_adjustment'
  | 'price_variance'
  | 'core_charge'
  | 'reversal'

export interface JournalLine {
  account: InternalAccountKey
  debit?: number
  credit?: number
  taxCode?: string | null
  taxAmount?: number
  trackingSiteId?: string | null
  trackingJobId?: string | null
  entityType?: 'supplier' | 'customer' | 'stock_item' | null
  entityId?: string | null
  description?: string | null
  sortOrder?: number
}

export interface PostJournalInput {
  organizationId: string
  sourceEvent: JournalSourceEvent
  sourceType?: string | null
  sourceId?: string | null
  jobsheetId?: string | null
  healthCheckId?: string | null
  documentDate: string // YYYY-MM-DD
  invoiceNumber?: string | null
  taxPointDate?: string | null
  idempotencyKey: string
  reversalOf?: string | null
  createdBy?: string | null
  currency?: string
  lines: JournalLine[]
}

const VAT_ACCOUNTS: InternalAccountKey[] = ['vat_input', 'vat_output']

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7) // YYYY-MM
}

/**
 * Period-lock: a journal dated within a locked period posts into the first open
 * month (the month after books_locked_through) rather than back-posting a closed
 * month. document_date keeps the real date for reference (GMS/PARTS.md §5.10).
 */
export function resolvePeriodKey(documentDate: string, booksLockedThrough: string | null): string {
  if (booksLockedThrough && documentDate <= booksLockedThrough) {
    const [y, m] = booksLockedThrough.slice(0, 7).split('-').map(Number)
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  return monthKey(documentDate)
}

export async function postJournal(
  input: PostJournalInput
): Promise<{ journalId: string | null; error?: string }> {
  const lines = input.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0)
  if (lines.length < 2) return { journalId: null, error: 'Journal needs at least 2 non-zero lines' }

  const grossTotal = round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0))
  const taxTotal = round2(
    lines.filter((l) => VAT_ACCOUNTS.includes(l.account)).reduce((s, l) => s + (l.debit ?? 0) + (l.credit ?? 0), 0)
  )
  const netTotal = round2(grossTotal - taxTotal)

  const { data: settings } = await supabaseAdmin
    .from('organization_settings')
    .select('books_locked_through')
    .eq('organization_id', input.organizationId)
    .maybeSingle()

  const periodKey = resolvePeriodKey(input.documentDate, settings?.books_locked_through ?? null)

  const header = {
    organization_id: input.organizationId,
    source_event: input.sourceEvent,
    source_type: input.sourceType ?? '',
    source_id: input.sourceId ?? '',
    jobsheet_id: input.jobsheetId ?? '',
    health_check_id: input.healthCheckId ?? '',
    document_date: input.documentDate,
    period_key: periodKey,
    invoice_number: input.invoiceNumber ?? '',
    tax_point_date: input.taxPointDate ?? '',
    net_total: netTotal,
    tax_total: taxTotal,
    gross_total: grossTotal,
    idempotency_key: input.idempotencyKey,
    posting_status: 'posted',
    reversal_of: input.reversalOf ?? '',
    currency: input.currency ?? 'GBP',
    created_by: input.createdBy ?? '',
  }

  const jsonLines = lines.map((l, i) => ({
    account: l.account,
    debit: round2(l.debit ?? 0),
    credit: round2(l.credit ?? 0),
    tax_code: l.taxCode ?? '',
    tax_amount: round2(l.taxAmount ?? 0),
    tracking_site_id: l.trackingSiteId ?? '',
    tracking_job_id: l.trackingJobId ?? '',
    entity_type: l.entityType ?? '',
    entity_id: l.entityId ?? '',
    description: l.description ?? '',
    sort_order: l.sortOrder ?? i,
  }))

  const { data, error } = await supabaseAdmin.rpc('post_inventory_journal', {
    p_header: header,
    p_lines: jsonLines,
  })

  if (error) {
    console.error('postJournal error:', error.message)
    return { journalId: null, error: error.message }
  }
  return { journalId: data as string }
}

/**
 * Reverse a posted journal by re-posting its lines with debit/credit swapped.
 * Idempotent on the originating journal id (GMS/PARTS.md §7.7 reopen path).
 */
export async function reverseJournal(
  journalId: string,
  opts: { documentDate?: string; createdBy?: string | null } = {}
): Promise<{ journalId: string | null; error?: string }> {
  const { data: jr, error: jErr } = await supabaseAdmin
    .from('inventory_journal')
    .select('*')
    .eq('id', journalId)
    .maybeSingle()
  if (jErr || !jr) return { journalId: null, error: jErr?.message ?? 'Journal not found' }

  const { data: jrLines, error: lErr } = await supabaseAdmin
    .from('inventory_journal_lines')
    .select('*')
    .eq('journal_id', journalId)
    .order('sort_order', { ascending: true })
  if (lErr || !jrLines?.length) return { journalId: null, error: lErr?.message ?? 'Journal has no lines' }

  const swapped: JournalLine[] = jrLines.map((l) => ({
    account: l.internal_account_key as InternalAccountKey,
    debit: Number(l.credit) || 0,
    credit: Number(l.debit) || 0,
    taxCode: l.tax_code,
    taxAmount: -(Number(l.tax_amount) || 0),
    trackingSiteId: l.tracking_site_id,
    trackingJobId: l.tracking_job_id,
    entityType: l.entity_type,
    entityId: l.entity_id,
    description: `Reversal: ${l.line_description ?? ''}`.trim(),
    sortOrder: l.sort_order,
  }))

  return postJournal({
    organizationId: jr.organization_id,
    sourceEvent: 'reversal',
    sourceType: jr.source_type,
    sourceId: jr.source_id,
    jobsheetId: jr.jobsheet_id,
    healthCheckId: jr.health_check_id,
    documentDate: opts.documentDate ?? new Date().toISOString().slice(0, 10),
    idempotencyKey: `reversal:${journalId}`,
    reversalOf: journalId,
    createdBy: opts.createdBy ?? null,
    currency: jr.currency,
    lines: swapped,
  })
}
