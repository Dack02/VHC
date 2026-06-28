/**
 * Health-check period + repair-item fetch layer.
 *
 * Shared by the dashboard services and the reports endpoints so they all draw
 * from the same "which health checks belong to this period" universe and the
 * same repair-item shape. Extracted from dashboard-service.ts (which now
 * re-imports fetchPeriodHcSet / fetchRepairItemsForHcs from here unchanged).
 */
import { supabaseAdmin } from '../lib/supabase.js'
import type { OptionTotals, RepairItemLike } from '../lib/metrics.js'

/** The subset of filters the period/fetch helpers need (structurally a DashboardFilters). */
export interface PeriodFilters {
  orgId: string
  siteId?: string
  technicianId?: string
  advisorId?: string
}

/**
 * Health checks belonging to a period, using the dual-date approach
 * (due_date in range, OR created_at in range when due_date is null) plus
 * HCs whose items were actioned in the range (sales from earlier bookings).
 * Matches the Today page / reports logic.
 */
export async function fetchPeriodHcSet(
  filters: PeriodFilters,
  startDate: string,
  endDate: string,
  select: string
): Promise<Record<string, unknown>[]> {
  let dueDateQuery = supabaseAdmin
    .from('health_checks')
    .select(select)
    .eq('organization_id', filters.orgId)
    .is('deleted_at', null)
    .gte('due_date', startDate)
    .lt('due_date', endDate)

  let createdAtQuery = supabaseAdmin
    .from('health_checks')
    .select(select)
    .eq('organization_id', filters.orgId)
    .is('deleted_at', null)
    .is('due_date', null)
    .gte('created_at', startDate)
    .lt('created_at', endDate)

  let outcomeDateQuery = supabaseAdmin
    .from('repair_items')
    .select('health_check_id, health_check:health_checks!inner(organization_id, site_id)')
    .gte('outcome_set_at', startDate)
    .lt('outcome_set_at', endDate)
    .eq('health_check.organization_id', filters.orgId)

  if (filters.siteId) {
    dueDateQuery = dueDateQuery.eq('site_id', filters.siteId)
    createdAtQuery = createdAtQuery.eq('site_id', filters.siteId)
    outcomeDateQuery = outcomeDateQuery.eq('health_check.site_id', filters.siteId)
  }
  if (filters.technicianId) {
    dueDateQuery = dueDateQuery.eq('technician_id', filters.technicianId)
    createdAtQuery = createdAtQuery.eq('technician_id', filters.technicianId)
  }
  if (filters.advisorId) {
    dueDateQuery = dueDateQuery.eq('advisor_id', filters.advisorId)
    createdAtQuery = createdAtQuery.eq('advisor_id', filters.advisorId)
  }

  const [dueDateResult, createdAtResult, outcomeDateResult] = await Promise.all([
    dueDateQuery,
    createdAtQuery,
    outcomeDateQuery
  ])

  if (dueDateResult.error) throw dueDateResult.error
  if (createdAtResult.error) throw createdAtResult.error
  if (outcomeDateResult.error) {
    console.error('Outcome date query error:', outcomeDateResult.error)
    // Non-fatal: continue without these HCs
  }

  const healthCheckMap = new Map<string, Record<string, unknown>>()
  const fetched = [
    ...(dueDateResult.data || []),
    ...(createdAtResult.data || [])
  ] as unknown as Record<string, unknown>[]
  for (const hc of fetched) {
    if (!healthCheckMap.has(hc.id as string)) {
      healthCheckMap.set(hc.id as string, hc)
    }
  }

  const outcomeDateHcIds = [
    ...new Set((outcomeDateResult.data || []).map((r: { health_check_id: string }) => r.health_check_id))
  ].filter(id => !healthCheckMap.has(id))

  if (outcomeDateHcIds.length > 0) {
    // Chunk the id list: a busy period's actioned-HC set can overflow a single .in() URL.
    for (const idChunk of chunkIds(outcomeDateHcIds)) {
      let actionedQuery = supabaseAdmin
        .from('health_checks')
        .select(select)
        .in('id', idChunk)
        .is('deleted_at', null)

      if (filters.technicianId) actionedQuery = actionedQuery.eq('technician_id', filters.technicianId)
      if (filters.advisorId) actionedQuery = actionedQuery.eq('advisor_id', filters.advisorId)

      const { data: actionedHcs, error: actionedError } = await actionedQuery
      if (actionedError) {
        console.error('Actioned date range HC query error:', actionedError)
      } else {
        for (const hc of (actionedHcs || []) as unknown as Record<string, unknown>[]) {
          if (!healthCheckMap.has(hc.id as string)) {
            healthCheckMap.set(hc.id as string, hc)
          }
        }
      }
    }
  }

  return Array.from(healthCheckMap.values())
}

/** Repair items (incl. soft-deleted — the aggregator excludes them) + selected-option totals. */
export async function fetchRepairItemsForHcs(
  healthCheckIds: string[],
  { withRag = false }: { withRag?: boolean } = {}
): Promise<{ items: RepairItemLike[]; optionTotalsMap: Record<string, OptionTotals> }> {
  if (healthCheckIds.length === 0) return { items: [], optionTotalsMap: {} }

  const ragSelect = withRag
    ? `,
      rag_status,
      source,
      check_results:repair_item_check_results(
        check_result:check_results(rag_status)
      )`
    : ''

  const itemSelect = `
      id,
      health_check_id,
      labour_total,
      parts_total,
      total_inc_vat,
      customer_approved,
      outcome_status,
      is_group,
      parent_repair_item_id,
      selected_option_id,
      repair_type_id,
      deleted_at${ragSelect}
    `

  const items: RepairItemLike[] = []
  // Batch by HC id so no single response approaches PostgREST's ~1000-row cap.
  // A busy org's monthly dashboard window (getMonthlyKpis spans ~2 months of
  // HCs) can hold well over 1000 repair items; an unchunked .in() would silently
  // truncate and undercount revenue/conversion. Mirrors fetchRepairItemsWithItemLinks.
  for (const chunk of chunkIds(healthCheckIds, 100)) {
    const { data, error } = await supabaseAdmin
      .from('repair_items')
      .select(itemSelect)
      .in('health_check_id', chunk)
    if (error) {
      console.error('Error fetching repair items for dashboard metrics:', error)
      continue
    }
    const batch = (data || []) as unknown as RepairItemLike[]
    if (batch.length >= 1000) console.warn(`fetchRepairItemsForHcs: chunk hit ${batch.length} rows — possible truncation`)
    items.push(...batch)
  }

  const selectedOptionIds = items
    .map(item => item.selected_option_id)
    .filter((id): id is string => !!id)

  const optionTotalsMap: Record<string, OptionTotals> = {}
  if (selectedOptionIds.length > 0) {
    for (const optChunk of chunkIds(selectedOptionIds)) {
      const { data: optionData } = await supabaseAdmin
        .from('repair_options')
        .select('id, labour_total, parts_total, total_inc_vat')
        .in('id', optChunk)
      for (const opt of optionData || []) optionTotalsMap[opt.id] = opt
    }
  }

  return { items, optionTotalsMap }
}

// ---------------------------------------------------------------------------
// Item Performance report support
// ---------------------------------------------------------------------------

/** Split an id list into chunks small enough for a PostgREST `.in()` URL. */
export function chunkIds<T>(arr: T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** A single linked finding (Supabase may return the embed as an object or a 1-element array). */
type TemplateItemRef = { id: string; name: string }
export interface RepairItemLink {
  check_result: {
    id: string
    rag_status: string | null
    instance_number: number | null
    template_item: TemplateItemRef | TemplateItemRef[] | null
  } | null
}

/** Repair item with the fields + finding links needed to attribute revenue to an inspection item. */
export interface RepairItemWithLinks extends RepairItemLike {
  name?: string | null
  source?: string | null
  created_at?: string | null
  outcome_set_at?: string | null
  deferred_until?: string | null
  deferred_notes?: string | null
  item_links?: RepairItemLink[] | null
}

const ITEM_LINK_SELECT = `
  id,
  health_check_id,
  name,
  labour_total,
  parts_total,
  total_inc_vat,
  customer_approved,
  outcome_status,
  is_group,
  parent_repair_item_id,
  selected_option_id,
  deleted_at,
  source,
  rag_status,
  created_at,
  outcome_set_at,
  deferred_until,
  deferred_notes,
  item_links:repair_item_check_results(
    check_result:check_results(
      id,
      rag_status,
      instance_number,
      template_item:template_items(id, name)
    )
  )
`

/**
 * Repair items for a set of HCs, each carrying its linked check_results and the
 * inspection item (`template_items.name`) those findings belong to — the join
 * that lets the Item Performance report attribute revenue back to the item that
 * triggered it. Batched by HC-id to keep the (heavy, 3-level) query URLs sane.
 */
export async function fetchRepairItemsWithItemLinks(
  healthCheckIds: string[]
): Promise<{ items: RepairItemWithLinks[]; optionTotalsMap: Record<string, OptionTotals> }> {
  if (healthCheckIds.length === 0) return { items: [], optionTotalsMap: {} }

  const items: RepairItemWithLinks[] = []
  // Smaller HC chunks keep each response's top-level row count well under
  // PostgREST's ~1000-row cap (repair items run ~2-3 per HC).
  for (const chunk of chunkIds(healthCheckIds, 100)) {
    const { data, error } = await supabaseAdmin
      .from('repair_items')
      .select(ITEM_LINK_SELECT)
      .in('health_check_id', chunk)
    if (error) {
      console.error('Error fetching repair items with item links:', error)
      continue
    }
    const batch = (data || []) as unknown as RepairItemWithLinks[]
    if (batch.length >= 1000) console.warn(`fetchRepairItemsWithItemLinks: chunk hit ${batch.length} rows — possible truncation`)
    items.push(...batch)
  }

  const selectedOptionIds = items
    .map(item => item.selected_option_id)
    .filter((id): id is string => !!id)

  const optionTotalsMap: Record<string, OptionTotals> = {}
  if (selectedOptionIds.length > 0) {
    for (const optChunk of chunkIds(selectedOptionIds)) {
      const { data: optionData } = await supabaseAdmin
        .from('repair_options')
        .select('id, labour_total, parts_total, total_inc_vat')
        .in('id', optChunk)
      for (const opt of optionData || []) optionTotalsMap[opt.id] = opt
    }
  }

  return { items, optionTotalsMap }
}

export type GroupBy = 'day' | 'week' | 'month'

/** Bucket a date into a period key (ISO day, ISO week-start Monday, or YYYY-MM). Mirrors reports.ts. */
export function bucketKey(date: Date, groupBy: GroupBy): string {
  if (groupBy === 'week') {
    const weekStart = new Date(date)
    const day = weekStart.getDay()
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
    weekStart.setDate(diff)
    return weekStart.toISOString().split('T')[0]
  } else if (groupBy === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }
  return date.toISOString().split('T')[0]
}

/** Resolve a Supabase embed that may be an object or a 1-element array to the object. */
export function unwrapRef<T>(ref: T | T[] | null | undefined): T | null {
  if (!ref) return null
  return Array.isArray(ref) ? (ref[0] ?? null) : ref
}
