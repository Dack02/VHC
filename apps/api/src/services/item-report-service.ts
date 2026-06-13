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

/** Distinct inspection-item refs (id + name) linked to a repair item, optionally scoped to a template. */
function linkedItemRefs(item: RepairItemWithLinks, allowedItemIds: Set<string> | null): TemplateItemRef[] {
  const byNorm = new Map<string, TemplateItemRef>()
  for (const link of item.item_links || []) {
    const cr = unwrapRef(link?.check_result as unknown)
    if (!cr || typeof cr !== 'object') continue
    const ti = unwrapRef((cr as { template_item?: unknown }).template_item)
    const ref = ti as TemplateItemRef | null
    if (!ref || !ref.name) continue
    if (allowedItemIds && !allowedItemIds.has(ref.id)) continue
    byNorm.set(normalizeName(ref.name), ref)
  }
  return [...byNorm.values()]
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
interface RevTally { identified: number; sold: number; declined: number; deferred: number; identifiedCount: number; soldCount: number }

function emptyUsage(): UsageTally { return { inspected: 0, red: 0, amber: 0, green: 0 } }
function emptyRev(): RevTally { return { identified: 0, sold: 0, declined: 0, deferred: 0, identifiedCount: 0, soldCount: 0 } }

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

  // --- Usage pass: check_results -> template_items(name) ---
  if (hcIds.length) {
    for (const chunk of chunkIds(hcIds)) {
      let q = supabaseAdmin
        .from('check_results')
        .select('health_check_id, template_item_id, rag_status, template_item:template_items!inner(id, name)')
        .in('health_check_id', chunk)
      if (allowedItemIds) q = q.in('template_item_id', [...allowedItemIds])
      const { data, error } = await q
      if (error) { console.error('Item report usage query error:', error); continue }

      for (const row of (data || []) as Array<Record<string, unknown>>) {
        const ti = unwrapRef(row.template_item) as TemplateItemRef | null
        if (!ti || !ti.name) continue
        const rag = row.rag_status as string | null
        if (rag !== 'red' && rag !== 'amber' && rag !== 'green') continue // exclude not_checked / null

        const norm = normalizeName(ti.name)
        picker.observe(norm, ti.name)
        const u = usageByName.get(norm) ?? emptyUsage()
        u.inspected++
        totInspected++
        if (rag === 'red') { u.red++; totRed++ }
        else if (rag === 'amber') { u.amber++; totAmber++ }
        else u.green++
        usageByName.set(norm, u)

        if (rag === 'red' || rag === 'amber') {
          const d = hcDateById.get(row.health_check_id as string)
          if (d) trendBucket(norm, bucketKey(d, opts.groupBy)).flagged++
        }
      }
    }
  }

  // --- Revenue pass: repair_items -> linked findings -> item name ---
  let totIdentified = 0, totSold = 0, totDeclined = 0, totDeferred = 0, totIdentifiedCount = 0, totSoldCount = 0
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

      const refs = item.source === 'inspection' ? linkedItemRefs(item, allowedItemIds) : []

      if (refs.length === 0) {
        // Non-inspection-sourced, unlinked, or (templateId set) out-of-scope.
        if (item.source !== 'inspection' || !allowedItemIds) {
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
        approvalPct: pct(totSoldCount, totIdentifiedCount)
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
  let displayName = item

  if (hcIds.length) {
    for (const chunk of chunkIds(hcIds)) {
      let q = supabaseAdmin
        .from('check_results')
        .select('id, health_check_id, checked_by, template_item_id, rag_status, template_item:template_items!inner(id, name)')
        .in('health_check_id', chunk)
      if (allowedItemIds) q = q.in('template_item_id', [...allowedItemIds])
      const { data, error } = await q
      if (error) { console.error('Item detail usage query error:', error); continue }

      for (const row of (data || []) as Array<Record<string, unknown>>) {
        const ti = unwrapRef(row.template_item) as TemplateItemRef | null
        if (!ti || !ti.name || normalizeName(ti.name) !== targetNorm) continue
        const rag = row.rag_status as string | null
        if (rag !== 'red' && rag !== 'amber' && rag !== 'green') continue

        displayName = ti.name
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
    }
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
  const revenue = { identified: 0, sold: 0, declined: 0, deferred: 0, identifiedCount: 0, soldCount: 0 }
  const advisorStats = new Map<string, { identified: number; sold: number; soldCount: number; identifiedCount: number }>()
  const deferredRaw: Array<{ repairItemId: string; healthCheckId: string; value: number; deferredUntil: string | null; deferredNotes: string | null }> = []

  if (hcIds.length) {
    const { items, optionTotalsMap } = await fetchRepairItemsWithItemLinks(hcIds)
    const childrenByParent = buildChildrenByParent(items)

    for (const it of items) {
      if (it.deleted_at || it.parent_repair_item_id || it.source !== 'inspection') continue
      const refs = linkedItemRefs(it, allowedItemIds)
      if (!refs.some(r => normalizeName(r.name) === targetNorm)) continue

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
      approvalPct: pct(revenue.soldCount, revenue.identifiedCount)
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
