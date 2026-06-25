/**
 * Item Performance report.
 *
 * Aggregates health-check data by INSPECTION ITEM (template_items, e.g.
 * "ABS Warning Light") across all templates, grouped by normalised item name:
 *  - usage: how often the item is flagged (red / amber), of how many inspected
 *  - revenue: £ identified vs sold (authorised), declined, deferred — attributed
 *    back to the item via repair_items -> repair_item_check_results -> check_results
 *  - per-item trend, and (in the detail view) the reasons / technicians / advisors
 *    behind it.
 *
 * See docs/metrics-glossary.md for the metric definitions and the important
 * reconciliation note (per-item revenue can overlap; summary totals are
 * de-duplicated scalars + an `unmapped` line for non-inspection revenue).
 */
import { supabaseAdmin } from '../lib/supabase.js'
import {
  calcItemTotal,
  isItemAuthorised,
  buildChildrenByParent,
  type OptionTotals
} from '../lib/metrics.js'
import {
  fetchPeriodHcSet,
  fetchRepairItemsWithItemLinks,
  chunkIds,
  bucketKey,
  unwrapRef,
  type PeriodFilters,
  type GroupBy,
  type RepairItemWithLinks
} from './hc-period-service.js'

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ItemTrendPoint {
  period: string
  identified: number
  sold: number
  flagged: number
}

/** Revenue split out for a single RAG band (red or amber). */
export interface RagBreakdown {
  identified: number
  sold: number
  declined: number
  deferred: number
  conversionValuePct: number | null
}

export interface ItemRow {
  item: string
  inspected: number
  red: number
  amber: number
  flagged: number
  flagRate: number | null
  identified: number
  sold: number
  declined: number
  deferred: number
  conversionValuePct: number | null
  approvalPct: number | null
  /**
   * Revenue split by the RAG of the finding that triggered it. A repair is
   * attributed to red or amber by the worst linked finding for THIS item; the
   * two need not sum to the combined `identified` (a repair linked only to a
   * green finding lands in neither band).
   */
  byRag: { red: RagBreakdown; amber: RagBreakdown }
  trend: ItemTrendPoint[]
}

export interface ItemSummaryTotals {
  inspected: number
  red: number
  amber: number
  flagged: number
  flagRate: number | null
  identified: number
  sold: number
  declined: number
  deferred: number
  conversionValuePct: number | null
  approvalPct: number | null
  /** Whole-business revenue split, de-duplicated: each repair classified once by its worst linked RAG. */
  byRag: { red: RagBreakdown; amber: RagBreakdown }
}

export interface ItemListResponse {
  period: { from: string; to: string }
  summary: {
    itemCount: number
    totals: ItemSummaryTotals
    /** Revenue that can't be attributed to an inspection item (MRI / manual / prebooked / unlinked). */
    unmapped: { identified: number; sold: number; declined: number; deferred: number }
  }
  items: ItemRow[]
}

export interface ItemDetailResponse {
  item: string
  period: { from: string; to: string }
  usage: { inspected: number; red: number; amber: number; flagged: number; flagRate: number | null }
  revenue: {
    identified: number; sold: number; declined: number; deferred: number
    conversionValuePct: number | null; approvalPct: number | null
    byRag: { red: RagBreakdown; amber: RagBreakdown }
  }
  trend: ItemTrendPoint[]
  topReasons: Array<{
    itemReasonId: string; reasonText: string; defaultRag: string | null
    count: number; approved: number; declined: number; approvalPct: number | null
  }>
  technicians: Array<{ userId: string; name: string; flagged: number; red: number; amber: number }>
  advisors: Array<{
    advisorId: string; name: string
    identified: number; sold: number; soldCount: number; identifiedCount: number; approvalPct: number | null
  }>
  deferred: Array<{
    repairItemId: string; healthCheckId: string; value: number
    deferredUntil: string | null; deferredNotes: string | null; isOverdue: boolean
    vehicleReg: string | null; customerName: string | null; advisorName: string | null
  }>
}

export interface ItemReportOptions {
  groupBy: GroupBy
  templateId?: string
  rag?: 'red' | 'amber'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const pct = (num: number, den: number): number | null => (den > 0 ? round1((num / den) * 100) : null)

/** Group key: trim, collapse internal whitespace, lower-case. */
function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Tracks the original casings seen for a normalised key so we can display the most common one. */
class DisplayNamePicker {
  private counts = new Map<string, Map<string, number>>()
  observe(norm: string, original: string) {
    const m = this.counts.get(norm) ?? new Map<string, number>()
    m.set(original, (m.get(original) ?? 0) + 1)
    this.counts.set(norm, m)
  }
  pick(norm: string): string {
    const m = this.counts.get(norm)
    if (!m) return norm
    let best = norm
    let bestCount = -1
    for (const [original, count] of m) {
      if (count > bestCount) {
        best = original
        bestCount = count
      }
    }
    return best
  }
}

type TemplateItemRef = { id: string; name: string }
type EffRag = 'red' | 'amber' | 'green'
const RAG_RANK: Record<EffRag, number> = { red: 3, amber: 2, green: 1 }
const asEffRag = (s: unknown): EffRag | null =>
  s === 'red' || s === 'amber' || s === 'green' ? s : null

/** An inspection-item ref plus the worst RAG of this repair's findings for that item. */
interface RaggedRef extends TemplateItemRef { rag: EffRag | null }

/**
 * Distinct inspection-item refs linked to a repair item (optionally scoped to a
 * template), each carrying the WORST rag_status among the findings that link this
 * repair to that item — so revenue can be split red vs amber by what triggered it.
 */
function linkedItemRefsWithRag(item: RepairItemWithLinks, allowedItemIds: Set<string> | null): RaggedRef[] {
  const byNorm = new Map<string, RaggedRef>()
  for (const link of item.item_links || []) {
    const cr = unwrapRef(link?.check_result as unknown)
    if (!cr || typeof cr !== 'object') continue
    const crObj = cr as { rag_status?: unknown; template_item?: unknown }
    const ref = unwrapRef(crObj.template_item) as TemplateItemRef | null
    if (!ref || !ref.name) continue
    if (allowedItemIds && !allowedItemIds.has(ref.id)) continue
    const norm = normalizeName(ref.name)
    const rag = asEffRag(crObj.rag_status)
    const existing = byNorm.get(norm)
    if (!existing) {
      byNorm.set(norm, { id: ref.id, name: ref.name, rag })
    } else if (rag && (existing.rag == null || RAG_RANK[rag] > RAG_RANK[existing.rag])) {
      existing.rag = rag
    }
  }
  return [...byNorm.values()]
}

/** Worst rag across a repair's linked refs — classifies the repair as a whole (for the de-duplicated summary). */
function worstRag(refs: RaggedRef[]): EffRag | null {
  let worst: EffRag | null = null
  for (const r of refs) {
    if (r.rag && (worst == null || RAG_RANK[r.rag] > RAG_RANK[worst])) worst = r.rag
  }
  return worst
}

/** HC effective date for trend bucketing: due_date if set, else created_at. */
function hcEffectiveDate(hc: Record<string, unknown>): Date | null {
  const raw = (hc.due_date as string | null) ?? (hc.created_at as string | null)
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

/** Resolve the template_item ids belonging to a template (via its sections). */
async function resolveTemplateItemIds(templateId: string): Promise<Set<string>> {
  const { data: sections } = await supabaseAdmin
    .from('template_sections')
    .select('id')
    .eq('template_id', templateId)
  const sectionIds = (sections || []).map(s => (s as { id: string }).id)
  if (!sectionIds.length) return new Set()

  const ids = new Set<string>()
  for (const chunk of chunkIds(sectionIds)) {
    const { data: items } = await supabaseAdmin
      .from('template_items')
      .select('id')
      .in('section_id', chunk)
    for (const it of items || []) ids.add((it as { id: string }).id)
  }
  return ids
}

async function resolveUserNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return map
  for (const chunk of chunkIds(unique)) {
    const { data } = await supabaseAdmin.from('users').select('id, first_name, last_name').in('id', chunk)
    for (const u of data || []) {
      const row = u as { id: string; first_name?: string; last_name?: string }
      map.set(row.id, `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Unknown')
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// List endpoint
// ---------------------------------------------------------------------------

interface UsageTally { inspected: number; red: number; amber: number; green: number }
interface RevSub { identified: number; sold: number; declined: number; deferred: number }
interface RevTally {
  identified: number; sold: number; declined: number; deferred: number; identifiedCount: number; soldCount: number
  red: RevSub; amber: RevSub
}

function emptyUsage(): UsageTally { return { inspected: 0, red: 0, amber: 0, green: 0 } }
function emptyRevSub(): RevSub { return { identified: 0, sold: 0, declined: 0, deferred: 0 } }
function emptyRev(): RevTally {
  return { identified: 0, sold: 0, declined: 0, deferred: 0, identifiedCount: 0, soldCount: 0, red: emptyRevSub(), amber: emptyRevSub() }
}

/** Fold a repair's outcome into a red/amber sub-bucket (mirrors the combined accumulation). */
function addToSub(sub: RevSub, value: number, authorised: boolean, authValue: number, outcome: string | null | undefined) {
  sub.identified += value
  if (authorised) sub.sold += authValue
  else if (outcome === 'declined') sub.declined += value
  else if (outcome === 'deferred') sub.deferred += value
}

/** Round a sub-bucket into the API's RagBreakdown shape (+ value conversion %). */
function ragBreakdown(s: RevSub): RagBreakdown {
  return {
    identified: round2(s.identified),
    sold: round2(s.sold),
    declined: round2(s.declined),
    deferred: round2(s.deferred),
    conversionValuePct: pct(s.sold, s.identified)
  }
}

/**
 * Per-item red/amber/green counts for a set of health checks, grouped by
 * normalised item name.
 *
 * An org can have tens of thousands of check_results in a period, well past
 * PostgREST's ~1000-row response cap — counting raw rows silently truncates.
 * Preferred path: the `item_report_usage` SQL function aggregates in Postgres
 * (one tiny result). If that function isn't deployed yet, fall back to a
 * client-side count that PAGES through the rows (so the cap can't truncate) and
 * runs the HC chunks concurrently. A template filter always uses the paged path
 * (filtered by template_item_id, which keeps the row set small anyway).
 */
async function fetchUsageByName(
  hcIds: string[],
  picker: DisplayNamePicker,
  allowedItemIds: Set<string> | null
): Promise<Map<string, UsageTally>> {
  const out = new Map<string, UsageTally>()
  const add = (name: string | null | undefined, red: number, amber: number, green: number) => {
    if (!name) return
    const norm = normalizeName(name)
    picker.observe(norm, name)
    const u = out.get(norm) ?? emptyUsage()
    u.red += red; u.amber += amber; u.green += green; u.inspected += red + amber + green
    out.set(norm, u)
  }

  if (!allowedItemIds) {
    const { data, error } = await supabaseAdmin.rpc('item_report_usage', { p_hc_ids: hcIds })
    if (!error && Array.isArray(data)) {
      for (const r of data as Array<{ item_name: string; red: number | string; amber: number | string; green: number | string }>) {
        add(r.item_name, Number(r.red) || 0, Number(r.amber) || 0, Number(r.green) || 0)
      }
      return out
    }
    console.warn('item_report_usage RPC unavailable; using paginated fallback:', error?.message)
  }

  const itemIdFilter = allowedItemIds ? [...allowedItemIds] : null
  const PAGE = 1000
  await Promise.all(chunkIds(hcIds, 100).map(async chunk => {
    let from = 0
    for (;;) {
      let q = supabaseAdmin
        .from('check_results')
        .select('rag_status, template_item:template_items!inner(name)')
        .in('health_check_id', chunk)
        .in('rag_status', ['red', 'amber', 'green'])
      if (itemIdFilter) q = q.in('template_item_id', itemIdFilter)
      // Stable order is REQUIRED for .range() pagination — without it pages
      // overlap/skip and the counts come out wrong.
      const { data: rows, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1)
      if (error) { console.error('Item usage fallback error:', error); break }
      const batch = rows || []
      for (const row of batch as Array<Record<string, unknown>>) {
        const ti = unwrapRef(row.template_item) as { name?: string } | null
        const rag = row.rag_status as string
        add(ti?.name, rag === 'red' ? 1 : 0, rag === 'amber' ? 1 : 0, rag === 'green' ? 1 : 0)
      }
      if (batch.length < PAGE) break
      from += PAGE
    }
  }))
  return out
}

export async function buildItemList(
  filters: PeriodFilters,
  startDate: string,
  endDate: string,
  opts: ItemReportOptions
): Promise<ItemListResponse> {
  const hcs = await fetchPeriodHcSet(filters, startDate, endDate, 'id, due_date, created_at')
  const hcIds = hcs.map(hc => hc.id as string)
  const hcDateById = new Map<string, Date | null>()
  for (const hc of hcs) hcDateById.set(hc.id as string, hcEffectiveDate(hc))

  const allowedItemIds = opts.templateId ? await resolveTemplateItemIds(opts.templateId) : null

  const usageByName = new Map<string, UsageTally>()
  const revByName = new Map<string, RevTally>()
  const trendByName = new Map<string, Map<string, ItemTrendPoint>>()
  const picker = new DisplayNamePicker()

  // Usage running totals (de-duplicated by nature — each check_result counted once)
  let totInspected = 0, totRed = 0, totAmber = 0

  const trendBucket = (norm: string, period: string): ItemTrendPoint => {
    const m = trendByName.get(norm) ?? new Map<string, ItemTrendPoint>()
    trendByName.set(norm, m)
    const p = m.get(period) ?? { period, identified: 0, sold: 0, flagged: 0 }
    m.set(period, p)
    return p
  }

  // --- Usage pass: per-item red/amber/green (DB-aggregated; see fetchUsageByName) ---
  if (hcIds.length) {
    const usage = await fetchUsageByName(hcIds, picker, allowedItemIds)
    for (const [norm, u] of usage) {
      usageByName.set(norm, u)
      totInspected += u.inspected
      totRed += u.red
      totAmber += u.amber
    }
  }

  // --- Revenue pass: repair_items -> linked findings -> item name ---
  let totIdentified = 0, totSold = 0, totDeclined = 0, totDeferred = 0, totIdentifiedCount = 0, totSoldCount = 0
  const sumRed = emptyRevSub(), sumAmber = emptyRevSub()
  const unmapped = { identified: 0, sold: 0, declined: 0, deferred: 0 }

  if (hcIds.length) {
    const { items, optionTotalsMap } = await fetchRepairItemsWithItemLinks(hcIds)
    const childrenByParent = buildChildrenByParent(items)

    for (const item of items) {
      if (item.deleted_at) continue
      if (item.parent_repair_item_id) continue // children roll up to their group

      const value = calcItemTotal(item, optionTotalsMap)
      const { authorised, authValue } = resolveAuthorisation(item, childrenByParent, optionTotalsMap)
      const outcome = item.outcome_status

      // Attribution is by junction link (repair -> check_result -> template_item),
      // not by `source`: inspection-derived repairs carry source=null in practice,
      // while MRI/manual items simply have no finding links. Each ref carries the
      // worst RAG of the findings linking this repair to that item.
      const refs = linkedItemRefsWithRag(item, allowedItemIds)

      if (refs.length === 0) {
        // No in-scope inspection link → unmapped (MRI / manual / unlinked). With a
        // template filter on, a repair linked only to OTHER templates' items is out
        // of scope — skip it rather than dumping it into unmapped.
        const outOfScope = allowedItemIds ? linkedItemRefsWithRag(item, null).length > 0 : false
        if (!outOfScope) {
          unmapped.identified += value
          if (authorised) unmapped.sold += authValue
          else if (outcome === 'declined') unmapped.declined += value
          else if (outcome === 'deferred') unmapped.deferred += value
        }
        continue
      }

      // De-duplicated scalar totals — count each repair once.
      totIdentified += value
      totIdentifiedCount++
      if (authorised) { totSold += authValue; totSoldCount++ }
      else if (outcome === 'declined') totDeclined += value
      else if (outcome === 'deferred') totDeferred += value

      // Summary red/amber: classify the whole repair once, by its worst linked RAG.
      const repairRag = worstRag(refs)
      if (repairRag === 'red') addToSub(sumRed, value, authorised, authValue, outcome)
      else if (repairRag === 'amber') addToSub(sumAmber, value, authorised, authValue, outcome)

      const d = hcDateById.get(item.health_check_id)
      const period = d ? bucketKey(d, opts.groupBy) : null

      // Per-item attribution — once per distinct linked name (overlap is intentional).
      for (const ref of refs) {
        const norm = normalizeName(ref.name)
        picker.observe(norm, ref.name)
        const r = revByName.get(norm) ?? emptyRev()
        r.identified += value
        r.identifiedCount++
        if (authorised) { r.sold += authValue; r.soldCount++ }
        else if (outcome === 'declined') r.declined += value
        else if (outcome === 'deferred') r.deferred += value
        // Per-item red/amber: by this link's worst RAG for this item.
        if (ref.rag === 'red') addToSub(r.red, value, authorised, authValue, outcome)
        else if (ref.rag === 'amber') addToSub(r.amber, value, authorised, authValue, outcome)
        revByName.set(norm, r)

        if (period) {
          const p = trendBucket(norm, period)
          p.identified += value
          if (authorised) p.sold += authValue
        }
      }
    }
  }

  // --- Merge usage + revenue into rows ---
  const names = new Set<string>([...usageByName.keys(), ...revByName.keys()])
  let rows: ItemRow[] = []
  for (const norm of names) {
    const u = usageByName.get(norm) ?? emptyUsage()
    const r = revByName.get(norm) ?? emptyRev()
    const flagged = u.red + u.amber
    const trend = [...(trendByName.get(norm)?.values() ?? [])]
      .map(p => ({ ...p, identified: round2(p.identified), sold: round2(p.sold) }))
      .sort((a, b) => a.period.localeCompare(b.period))

    rows.push({
      item: picker.pick(norm),
      inspected: u.inspected,
      red: u.red,
      amber: u.amber,
      flagged,
      flagRate: pct(flagged, u.inspected),
      identified: round2(r.identified),
      sold: round2(r.sold),
      declined: round2(r.declined),
      deferred: round2(r.deferred),
      conversionValuePct: pct(r.sold, r.identified),
      approvalPct: pct(r.soldCount, r.identifiedCount),
      byRag: { red: ragBreakdown(r.red), amber: ragBreakdown(r.amber) },
      trend
    })
  }

  if (opts.rag === 'red') rows = rows.filter(r => r.red > 0)
  else if (opts.rag === 'amber') rows = rows.filter(r => r.amber > 0)
  rows.sort((a, b) => b.identified - a.identified || b.flagged - a.flagged)

  const flaggedTotal = totRed + totAmber
  return {
    period: { from: startDate, to: endDate },
    summary: {
      itemCount: rows.length,
      totals: {
        inspected: totInspected,
        red: totRed,
        amber: totAmber,
        flagged: flaggedTotal,
        flagRate: pct(flaggedTotal, totInspected),
        identified: round2(totIdentified),
        sold: round2(totSold),
        declined: round2(totDeclined),
        deferred: round2(totDeferred),
        conversionValuePct: pct(totSold, totIdentified),
        approvalPct: pct(totSoldCount, totIdentifiedCount),
        byRag: { red: ragBreakdown(sumRed), amber: ragBreakdown(sumAmber) }
      },
      unmapped: {
        identified: round2(unmapped.identified),
        sold: round2(unmapped.sold),
        declined: round2(unmapped.declined),
        deferred: round2(unmapped.deferred)
      }
    },
    items: rows
  }
}

/** Authorisation with the group-children fallback (mirrors metrics.aggregateRepairItemsByHc). */
function resolveAuthorisation(
  item: RepairItemWithLinks,
  childrenByParent: Map<string, RepairItemWithLinks[]>,
  optionTotalsMap: Record<string, OptionTotals>
): { authorised: boolean; authValue: number } {
  const value = calcItemTotal(item, optionTotalsMap)
  let authorised = isItemAuthorised(item)
  let authValue = value
  if (item.is_group && !authorised && item.id) {
    const children = (childrenByParent.get(item.id) || []) as RepairItemWithLinks[]
    const approved = children.filter(ch => !ch.deleted_at && isItemAuthorised(ch))
    if (approved.length > 0) {
      authorised = true
      authValue = approved.reduce((s, ch) => s + calcItemTotal(ch, optionTotalsMap), 0)
    }
  }
  return { authorised, authValue }
}

// ---------------------------------------------------------------------------
// Detail endpoint
// ---------------------------------------------------------------------------

export async function buildItemDetail(
  filters: PeriodFilters,
  startDate: string,
  endDate: string,
  item: string,
  opts: ItemReportOptions
): Promise<ItemDetailResponse> {
  const targetNorm = normalizeName(item)
  const allowedItemIds = opts.templateId ? await resolveTemplateItemIds(opts.templateId) : null

  const hcs = await fetchPeriodHcSet(
    filters,
    startDate,
    endDate,
    'id, due_date, created_at, advisor_id, technician_id'
  )
  const hcIds = hcs.map(hc => hc.id as string)
  const hcDateById = new Map<string, Date | null>()
  const hcAdvisorById = new Map<string, string | null>()
  const hcTechById = new Map<string, string | null>()
  for (const hc of hcs) {
    const id = hc.id as string
    hcDateById.set(id, hcEffectiveDate(hc))
    hcAdvisorById.set(id, (hc.advisor_id as string | null) ?? null)
    hcTechById.set(id, (hc.technician_id as string | null) ?? null)
  }

  // --- Usage / technician pass: target item's check_results ---
  const usage = { inspected: 0, red: 0, amber: 0, green: 0 }
  const targetCrIds: string[] = []
  const techStats = new Map<string, { flagged: number; red: number; amber: number }>()
  const trendMap = new Map<string, ItemTrendPoint>()
  const displayName = item

  // Resolve the target item's template_item ids (case-insensitive, across templates)
  let targetItemIds: string[] = []
  {
    const { data: tiRows } = await supabaseAdmin
      .from('template_items')
      .select('id, name')
      .ilike('name', item)
    targetItemIds = (tiRows || [])
      .filter(r => normalizeName((r as { name: string }).name) === targetNorm)
      .map(r => (r as { id: string }).id)
    if (allowedItemIds) targetItemIds = targetItemIds.filter(id => allowedItemIds.has(id))
  }

  // Usage / technician pass: only THIS item's check_results (filtered by id, paged → no row-cap truncation)
  if (hcIds.length && targetItemIds.length) {
    const PAGE = 1000
    await Promise.all(chunkIds(hcIds, 100).map(async chunk => {
      let from = 0
      for (;;) {
        const { data, error } = await supabaseAdmin
          .from('check_results')
          .select('id, health_check_id, checked_by, rag_status')
          .in('template_item_id', targetItemIds)
          .in('health_check_id', chunk)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) { console.error('Item detail usage query error:', error); break }
        const batch = data || []
        for (const row of batch as Array<Record<string, unknown>>) {
          const rag = row.rag_status as string | null
          if (rag !== 'red' && rag !== 'amber' && rag !== 'green') continue
          usage.inspected++
          if (rag === 'red') usage.red++
          else if (rag === 'amber') usage.amber++
          else usage.green++
          targetCrIds.push(row.id as string)

          if (rag === 'red' || rag === 'amber') {
            const techId = (row.checked_by as string | null) ?? hcTechById.get(row.health_check_id as string) ?? null
            if (techId) {
              const t = techStats.get(techId) ?? { flagged: 0, red: 0, amber: 0 }
              t.flagged++
              if (rag === 'red') t.red++; else t.amber++
              techStats.set(techId, t)
            }
            const d = hcDateById.get(row.health_check_id as string)
            if (d) {
              const period = bucketKey(d, opts.groupBy)
              const p = trendMap.get(period) ?? { period, identified: 0, sold: 0, flagged: 0 }
              p.flagged++
              trendMap.set(period, p)
            }
          }
        }
        if (batch.length < PAGE) break
        from += PAGE
      }
    }))
  }

  // --- Reasons pass: check_result_reasons for the target's findings ---
  const reasonAgg = new Map<string, { reasonText: string; defaultRag: string | null; count: number; approved: number; declined: number }>()
  for (const chunk of chunkIds(targetCrIds)) {
    if (!chunk.length) continue
    const { data, error } = await supabaseAdmin
      .from('check_result_reasons')
      .select('item_reason_id, customer_approved, reason:item_reasons(id, reason_text, default_rag)')
      .in('check_result_id', chunk)
    if (error) { console.error('Item detail reasons query error:', error); continue }
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const reason = unwrapRef(row.reason) as { id?: string; reason_text?: string; default_rag?: string } | null
      const id = (row.item_reason_id as string | null) ?? reason?.id
      if (!id) continue
      const agg = reasonAgg.get(id) ?? { reasonText: reason?.reason_text ?? 'Unknown', defaultRag: reason?.default_rag ?? null, count: 0, approved: 0, declined: 0 }
      agg.count++
      if (row.customer_approved === true) agg.approved++
      else if (row.customer_approved === false) agg.declined++
      reasonAgg.set(id, agg)
    }
  }
  const topReasons = [...reasonAgg.entries()]
    .map(([itemReasonId, a]) => ({ itemReasonId, ...a, approvalPct: pct(a.approved, a.approved + a.declined) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  // --- Revenue / advisor / deferred / trend pass ---
  const revenue = { identified: 0, sold: 0, declined: 0, deferred: 0, identifiedCount: 0, soldCount: 0, red: emptyRevSub(), amber: emptyRevSub() }
  const advisorStats = new Map<string, { identified: number; sold: number; soldCount: number; identifiedCount: number }>()
  const deferredRaw: Array<{ repairItemId: string; healthCheckId: string; value: number; deferredUntil: string | null; deferredNotes: string | null }> = []

  if (hcIds.length) {
    const { items, optionTotalsMap } = await fetchRepairItemsWithItemLinks(hcIds)
    const childrenByParent = buildChildrenByParent(items)

    for (const it of items) {
      if (it.deleted_at || it.parent_repair_item_id) continue
      const refs = linkedItemRefsWithRag(it, allowedItemIds)
      const targetRef = refs.find(r => normalizeName(r.name) === targetNorm)
      if (!targetRef) continue

      const value = calcItemTotal(it, optionTotalsMap)
      const { authorised, authValue } = resolveAuthorisation(it, childrenByParent, optionTotalsMap)
      const outcome = it.outcome_status

      revenue.identified += value
      revenue.identifiedCount++
      if (authorised) { revenue.sold += authValue; revenue.soldCount++ }
      else if (outcome === 'declined') revenue.declined += value
      else if (outcome === 'deferred') {
        revenue.deferred += value
        deferredRaw.push({
          repairItemId: it.id as string,
          healthCheckId: it.health_check_id,
          value: round2(value),
          deferredUntil: it.deferred_until ?? null,
          deferredNotes: it.deferred_notes ?? null
        })
      }

      // Split this item's revenue by the RAG that triggered it (red sells same-day).
      if (targetRef.rag === 'red') addToSub(revenue.red, value, authorised, authValue, outcome)
      else if (targetRef.rag === 'amber') addToSub(revenue.amber, value, authorised, authValue, outcome)

      const advisorId = hcAdvisorById.get(it.health_check_id) ?? null
      if (advisorId) {
        const a = advisorStats.get(advisorId) ?? { identified: 0, sold: 0, soldCount: 0, identifiedCount: 0 }
        a.identified += value
        a.identifiedCount++
        if (authorised) { a.sold += authValue; a.soldCount++ }
        advisorStats.set(advisorId, a)
      }

      const d = hcDateById.get(it.health_check_id)
      if (d) {
        const period = bucketKey(d, opts.groupBy)
        const p = trendMap.get(period) ?? { period, identified: 0, sold: 0, flagged: 0 }
        p.identified += value
        if (authorised) p.sold += authValue
        trendMap.set(period, p)
      }
    }
  }

  // --- Resolve names + deferred context ---
  const [userNames, hcContext] = await Promise.all([
    resolveUserNames([...techStats.keys(), ...advisorStats.keys()]),
    fetchHcContext(deferredRaw.map(d => d.healthCheckId))
  ])

  const now = new Date()
  const technicians = [...techStats.entries()]
    .map(([userId, t]) => ({ userId, name: userNames.get(userId) ?? 'Unknown', ...t }))
    .sort((a, b) => b.flagged - a.flagged)

  const advisors = [...advisorStats.entries()]
    .map(([advisorId, a]) => ({
      advisorId,
      name: userNames.get(advisorId) ?? 'Unknown',
      identified: round2(a.identified),
      sold: round2(a.sold),
      soldCount: a.soldCount,
      identifiedCount: a.identifiedCount,
      approvalPct: pct(a.soldCount, a.identifiedCount)
    }))
    .sort((a, b) => b.identified - a.identified)

  const deferred = deferredRaw
    .map(d => {
      const ctx = hcContext.get(d.healthCheckId)
      return {
        ...d,
        isOverdue: !!d.deferredUntil && new Date(d.deferredUntil) < now,
        vehicleReg: ctx?.vehicleReg ?? null,
        customerName: ctx?.customerName ?? null,
        advisorName: ctx?.advisorName ?? null
      }
    })
    .sort((a, b) => (a.deferredUntil ?? '').localeCompare(b.deferredUntil ?? ''))

  const flagged = usage.red + usage.amber
  return {
    item: displayName,
    period: { from: startDate, to: endDate },
    usage: { inspected: usage.inspected, red: usage.red, amber: usage.amber, flagged, flagRate: pct(flagged, usage.inspected) },
    revenue: {
      identified: round2(revenue.identified),
      sold: round2(revenue.sold),
      declined: round2(revenue.declined),
      deferred: round2(revenue.deferred),
      conversionValuePct: pct(revenue.sold, revenue.identified),
      approvalPct: pct(revenue.soldCount, revenue.identifiedCount),
      byRag: { red: ragBreakdown(revenue.red), amber: ragBreakdown(revenue.amber) }
    },
    trend: [...trendMap.values()]
      .map(p => ({ ...p, identified: round2(p.identified), sold: round2(p.sold) }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    topReasons,
    technicians,
    advisors,
    deferred
  }
}

async function fetchHcContext(
  hcIds: string[]
): Promise<Map<string, { vehicleReg: string | null; customerName: string | null; advisorName: string | null }>> {
  const map = new Map<string, { vehicleReg: string | null; customerName: string | null; advisorName: string | null }>()
  const unique = [...new Set(hcIds.filter(Boolean))]
  if (!unique.length) return map
  for (const chunk of chunkIds(unique)) {
    const { data } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        vehicle:vehicles(registration),
        customer:customers(first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(first_name, last_name)
      `)
      .in('id', chunk)
    for (const hc of (data || []) as Array<Record<string, unknown>>) {
      const v = unwrapRef(hc.vehicle) as { registration?: string } | null
      const c = unwrapRef(hc.customer) as { first_name?: string; last_name?: string } | null
      const a = unwrapRef(hc.advisor) as { first_name?: string; last_name?: string } | null
      map.set(hc.id as string, {
        vehicleReg: v?.registration ?? null,
        customerName: c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || null : null,
        advisorName: a ? `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || null : null
      })
    }
  }
  return map
}
