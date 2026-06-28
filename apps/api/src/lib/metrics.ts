/**
 * Shared repair-item metric helpers.
 *
 * Single source of truth for the KPI math used by the dashboard, today,
 * monthly-kpis and reports endpoints. See docs/metrics-glossary.md for the
 * plain-English definition of each metric.
 */

export const VAT_RATE = 0.2

export type RagStatus = 'red' | 'amber' | 'green'

/** Repair item row as selected by the various endpoints (fields optional where not all selects include them). */
export interface RepairItemLike {
  id?: string
  health_check_id: string
  labour_total?: number | string | null
  parts_total?: number | string | null
  total_inc_vat?: number | string | null
  customer_approved?: boolean | null
  outcome_status?: string | null
  is_group?: boolean | null
  parent_repair_item_id?: string | null
  selected_option_id?: string | null
  repair_type_id?: string | null
  deleted_at?: string | null
  /** Direct RAG column — the source for MRI-sourced and manually-added items (inspection items use check_results) */
  rag_status?: string | null
  /** 'mri_scan' for manufacturer-recommended items; null/other for technician inspection items */
  source?: string | null
  check_results?: unknown
}

/** Manufacturer-recommended item (MRI scan), as opposed to a technician-flagged inspection item. */
export function isMriItem(item: Pick<RepairItemLike, 'source'>): boolean {
  return item.source === 'mri_scan'
}

export interface OptionTotals {
  labour_total?: number | string | null
  parts_total?: number | string | null
  total_inc_vat?: number | string | null
}

/**
 * Inc-VAT value of an item. Prefers the selected price option's totals
 * (price options feature), falls back to labour+parts+VAT when total_inc_vat is 0.
 */
export function calcItemTotal(
  item: RepairItemLike,
  optionTotalsMap: Record<string, OptionTotals> = {}
): number {
  const selectedOpt = item.selected_option_id ? optionTotalsMap[item.selected_option_id] : null

  const srcTotalIncVat = selectedOpt?.total_inc_vat ?? item.total_inc_vat
  const srcLabourTotal = selectedOpt?.labour_total ?? item.labour_total
  const srcPartsTotal = selectedOpt?.parts_total ?? item.parts_total

  let totalIncVat = parseFloat(String(srcTotalIncVat ?? 0)) || 0
  if (totalIncVat === 0) {
    const labourTotal = parseFloat(String(srcLabourTotal ?? 0)) || 0
    const partsTotal = parseFloat(String(srcPartsTotal ?? 0)) || 0
    if (labourTotal > 0 || partsTotal > 0) {
      const subtotal = labourTotal + partsTotal
      totalIncVat = subtotal + subtotal * VAT_RATE
    }
  }
  return totalIncVat
}

/** An item the customer (or advisor on their behalf) said yes to. */
export function isItemAuthorised(item: Pick<RepairItemLike, 'customer_approved' | 'outcome_status'>): boolean {
  return item.customer_approved === true || item.outcome_status === 'authorised'
}

/** Any recorded customer decision (yes / no / later) — evidence the work was presented. */
export function hasItemDecision(item: Pick<RepairItemLike, 'customer_approved' | 'outcome_status'>): boolean {
  if (item.customer_approved === true) return true
  return item.outcome_status === 'authorised' || item.outcome_status === 'declined' || item.outcome_status === 'deferred'
}

/**
 * RAG status of a repair item (red > amber > green).
 *
 * Two sources, matching reports.ts so the dashboard and reports agree:
 *  1. The item's own `rag_status` column — set for MRI-sourced and
 *     manually-added items. Takes priority.
 *  2. The linked check results — set for inspection-checklist items.
 *     Supabase returns the junction rows as arrays of objects or arrays.
 *
 * In practice the two are mutually exclusive per item; the direct column
 * wins when both are somehow present. Omitting source #1 silently drops
 * every MRI item from red/amber sold %, so both must be considered.
 */
export function deriveRagStatus(item: RepairItemLike): RagStatus | null {
  const direct = item.rag_status
  if (direct === 'red' || direct === 'amber' || direct === 'green') return direct

  const links = item.check_results as
    | Array<{ check_result: { rag_status: string } | { rag_status: string }[] | null }>
    | null
    | undefined
  if (!links || !Array.isArray(links)) return null

  let derived: RagStatus | null = null
  for (const link of links) {
    const checkResult = Array.isArray(link?.check_result) ? link.check_result[0] : link?.check_result
    const rag = checkResult?.rag_status
    if (rag === 'red') return 'red'
    if (rag === 'amber') derived = 'amber'
    else if (rag === 'green' && !derived) derived = 'green'
  }
  return derived
}

export function buildChildrenByParent(items: RepairItemLike[]): Map<string, RepairItemLike[]> {
  const map = new Map<string, RepairItemLike[]>()
  for (const item of items) {
    if (item.parent_repair_item_id) {
      const children = map.get(item.parent_repair_item_id) || []
      children.push(item)
      map.set(item.parent_repair_item_id, children)
    }
  }
  return map
}

export interface RagBucketAgg {
  identifiedValue: number
  authorisedValue: number
  identifiedCount: number
  authorisedCount: number
}

export interface RagSet {
  red: RagBucketAgg
  amber: RagBucketAgg
  green: RagBucketAgg
}

export interface HcItemsAgg {
  /** £ of all live (non-deleted) top-level items (inspection + MRI combined) */
  identifiedTotal: number
  /** £ of authorised work (group fallback: sum of authorised children), inspection + MRI */
  authorisedTotal: number
  declinedTotal: number
  pendingTotal: number
  deferredCount: number
  deferredValue: number
  /** Combined RAG buckets (inspection + MRI) — used where "all red work" is wanted */
  red: RagBucketAgg
  amber: RagBucketAgg
  green: RagBucketAgg
  /** RAG buckets for technician inspection items only (source != 'mri_scan') */
  inspection: RagSet
  /** RAG buckets for manufacturer-recommended items only (source = 'mri_scan') */
  mri: RagSet
  /** £ of live MRI top-level items */
  mriIdentifiedTotal: number
  /** £ of authorised MRI work */
  mriAuthorisedTotal: number
  /** live top-level items */
  actionableCount: number
  /** live top-level items authorised (incl. via children for groups) */
  authorisedItemCount: number
  /** live items (incl. children) with any recorded decision */
  decidedCount: number
}

function emptyBucket(): RagBucketAgg {
  return { identifiedValue: 0, authorisedValue: 0, identifiedCount: 0, authorisedCount: 0 }
}

function emptyRagSet(): RagSet {
  return { red: emptyBucket(), amber: emptyBucket(), green: emptyBucket() }
}

export function emptyHcAgg(): HcItemsAgg {
  return {
    identifiedTotal: 0,
    authorisedTotal: 0,
    declinedTotal: 0,
    pendingTotal: 0,
    deferredCount: 0,
    deferredValue: 0,
    red: emptyBucket(),
    amber: emptyBucket(),
    green: emptyBucket(),
    inspection: emptyRagSet(),
    mri: emptyRagSet(),
    mriIdentifiedTotal: 0,
    mriAuthorisedTotal: 0,
    actionableCount: 0,
    authorisedItemCount: 0,
    decidedCount: 0
  }
}

/**
 * Canonical per-health-check aggregation of repair items.
 *
 * Rules:
 * - Only top-level items count toward totals (children roll up to their group).
 * - Deleted items count toward NOTHING — neither identified nor authorised.
 * - A group whose children are approved counts as authorised for the sum of
 *   its approved children's values.
 * - RAG buckets use the worst linked check-result status.
 */
export function aggregateRepairItemsByHc(
  items: RepairItemLike[],
  optionTotalsMap: Record<string, OptionTotals> = {}
): Map<string, HcItemsAgg> {
  const aggByHc = new Map<string, HcItemsAgg>()
  const childrenByParent = buildChildrenByParent(items)

  for (const item of items) {
    let agg = aggByHc.get(item.health_check_id)
    if (!agg) {
      agg = emptyHcAgg()
      aggByHc.set(item.health_check_id, agg)
    }

    const isDeleted = !!item.deleted_at

    // Decision evidence considers children too (a group's decision may live on its children)
    if (!isDeleted && hasItemDecision(item)) agg.decidedCount++

    // Totals/buckets: top-level, live items only
    if (item.parent_repair_item_id || isDeleted) continue

    const value = calcItemTotal(item, optionTotalsMap)
    const rag = deriveRagStatus(item)
    const isMri = isMriItem(item)
    // Per-stream RAG set: MRI (manufacturer-recommended) vs inspection (technician-flagged)
    const stream = isMri ? agg.mri : agg.inspection

    agg.actionableCount++
    agg.identifiedTotal += value
    if (isMri) agg.mriIdentifiedTotal += value
    if (rag) {
      agg[rag].identifiedCount++
      agg[rag].identifiedValue += value
      stream[rag].identifiedCount++
      stream[rag].identifiedValue += value
    }

    // Authorisation: direct, or via approved children for groups
    let authorised = isItemAuthorised(item)
    let authorisedValue = value
    if (item.is_group && !authorised && item.id) {
      const children = childrenByParent.get(item.id) || []
      const approvedChildren = children.filter(ch => !ch.deleted_at && isItemAuthorised(ch))
      if (approvedChildren.length > 0) {
        authorised = true
        authorisedValue = approvedChildren.reduce((sum, ch) => sum + calcItemTotal(ch, optionTotalsMap), 0)
      }
    }

    if (authorised) {
      agg.authorisedItemCount++
      agg.authorisedTotal += authorisedValue
      if (isMri) agg.mriAuthorisedTotal += authorisedValue
      if (rag) {
        agg[rag].authorisedCount++
        agg[rag].authorisedValue += authorisedValue
        stream[rag].authorisedCount++
        stream[rag].authorisedValue += authorisedValue
      }
    } else if (item.outcome_status === 'declined') {
      agg.declinedTotal += value
    } else if (item.outcome_status === 'deferred') {
      agg.deferredCount++
      agg.deferredValue += value
    } else {
      agg.pendingTotal += value
    }
  }

  return aggByHc
}

/** MRI sold % across all RAG levels for one HC's aggregation (authorised count ÷ identified count). */
export function mriSoldPctFromSet(mri: RagSet): number | null {
  const identified = mri.red.identifiedCount + mri.amber.identifiedCount + mri.green.identifiedCount
  const authorised = mri.red.authorisedCount + mri.amber.authorisedCount + mri.green.authorisedCount
  if (identified === 0) return null
  return Math.round((authorised / identified) * 1000) / 10
}

/**
 * A health check was "presented" when it has live work AND that work reached
 * the customer — digitally (sent_at) or by a recorded decision (phone authorisation).
 */
export function isHcPresented(sentAt: string | null | undefined, agg: HcItemsAgg | undefined): boolean {
  if (!agg || agg.actionableCount === 0) return false
  return !!sentAt || agg.decidedCount > 0
}

export interface ConversionResult {
  presentedCount: number
  convertedCount: number
  /** % of presented HCs with at least one authorised item, clamped 0–100 */
  conversionRate: number
}

/**
 * HC-level conversion: of the health checks presented to customers in the
 * period, how many had at least one item authorised. The numerator is by
 * construction a subset of the denominator, so the rate is always 0–100%.
 */
export function computeHcConversion(
  hcs: Array<{ id: string; sent_at?: string | null }>,
  aggByHc: Map<string, HcItemsAgg>
): ConversionResult {
  let presentedCount = 0
  let convertedCount = 0
  for (const hc of hcs) {
    const agg = aggByHc.get(hc.id)
    if (!isHcPresented(hc.sent_at, agg)) continue
    presentedCount++
    if (agg && agg.authorisedItemCount > 0) convertedCount++
  }
  const rate = presentedCount > 0 ? (convertedCount / presentedCount) * 100 : 0
  return {
    presentedCount,
    convertedCount,
    conversionRate: Math.min(100, Math.max(0, Math.round(rate * 10) / 10))
  }
}

/** Sold % = authorised / identified for a RAG bucket (null when nothing identified). */
export function soldPct(bucket: RagBucketAgg): number | null {
  if (bucket.identifiedCount === 0) return null
  return Math.round((bucket.authorisedCount / bucket.identifiedCount) * 1000) / 10
}
