/**
 * Repair Type report (P4).
 *
 * Aggregates priced work by REPAIR TYPE for a period: £ identified / sold
 * (authorised) / declined / deferred, conversion %, work-mix %, plus a slice by
 * vehicle make and fuel type. Revenue-side only — margin is deferred to the Parts
 * module (see GMS/REPAIR_TYPES.md §4.4/§12).
 *
 * Built as a Node aggregation (NOT a SQL RPC) so it reuses the SAME period set
 * (fetchPeriodHcSet) and the SAME per-item value math (calcItemTotal — selected
 * option substitution + labour/parts fallback) as the dashboard / Item Performance
 * reports. That guarantees the repair-type numbers agree with the other reports,
 * and the chunked fetch already dodges PostgREST's ~1000-row cap. NULL repair_type
 * rolls into an "Unassigned" bucket.
 */
import { supabaseAdmin } from '../lib/supabase.js'
import { calcItemTotal, isItemAuthorised, buildChildrenByParent } from '../lib/metrics.js'
import { fetchPeriodHcSet, fetchRepairItemsForHcs, unwrapRef, type PeriodFilters } from './hc-period-service.js'

export interface RepairTypeRow {
  repairTypeId: string | null
  code: string
  label: string
  colour: string | null
  itemCount: number
  identified: number
  authorised: number
  declined: number
  deferred: number
  conversionPct: number | null
  mixPct: number | null
}

export interface VehicleSliceRow {
  repairTypeId: string | null
  code: string
  value: string
  itemCount: number
  identified: number
  authorised: number
}

export interface RepairTypeReport {
  rows: RepairTypeRow[]
  totals: { identified: number; authorised: number; declined: number; deferred: number; itemCount: number; conversionPct: number | null }
  byMake: VehicleSliceRow[]
  byFuel: VehicleSliceRow[]
}

const UNASSIGNED = '__unassigned__'
const round = (n: number) => Math.round(n * 100) / 100
// Free-text make/fuel are noisy ('BMW'/'bmw', ' Diesel '); collapse for grouping, keep a tidy label.
const cleanLabel = (s: string) => s.trim().replace(/\s+/g, ' ')

interface Acc { itemCount: number; identified: number; authorised: number; declined: number; deferred: number }
const emptyAcc = (): Acc => ({ itemCount: 0, identified: 0, authorised: 0, declined: 0, deferred: 0 })

interface SliceAcc { repairTypeId: string | null; code: string; value: string; itemCount: number; identified: number; authorised: number }

export async function buildRepairTypeReport(
  filters: PeriodFilters,
  startDate: string,
  endDate: string
): Promise<RepairTypeReport> {
  // 1. Period health checks, carrying their vehicle make/fuel for the slices.
  const hcs = await fetchPeriodHcSet(filters, startDate, endDate, 'id, vehicle:vehicles(make, fuel_type)')
  const hcVehicle = new Map<string, { make: string; fuel: string }>()
  for (const hc of hcs) {
    const v = unwrapRef(hc.vehicle as { make?: string | null; fuel_type?: string | null } | null)
    hcVehicle.set(hc.id as string, {
      make: cleanLabel(v?.make || '') || 'Unknown',
      fuel: cleanLabel(v?.fuel_type || '') || 'Unknown'
    })
  }
  const hcIds = hcs.map(h => h.id as string)

  // 2. Repair items (+ selected-option totals). The fetch carries repair_type_id.
  const { items, optionTotalsMap } = await fetchRepairItemsForHcs(hcIds)

  // 3. Repair type lookup (labels/colours; includes inactive so historic rows still resolve).
  const { data: typeRows } = await supabaseAdmin
    .from('repair_types')
    .select('id, code, label, colour')
    .eq('organization_id', filters.orgId)
  const typeMap = new Map<string, { code: string; label: string; colour: string | null }>()
  for (const t of typeRows || []) typeMap.set(t.id, { code: t.code, label: t.label || t.code, colour: t.colour })

  // 4. Aggregate top-level, non-deleted items by repair type (+ vehicle slices).
  const byType = new Map<string, Acc>()
  const byMake = new Map<string, SliceAcc>()
  const byFuel = new Map<string, SliceAcc>()

  const sliceBump = (m: Map<string, SliceAcc>, typeId: string, repairTypeId: string | null, code: string, label: string, idAmt: number, authAmt: number) => {
    const key = `${typeId}|${label.toLowerCase()}`
    let s = m.get(key)
    if (!s) { s = { repairTypeId, code, value: label, itemCount: 0, identified: 0, authorised: 0 }; m.set(key, s) }
    s.itemCount++; s.identified += idAmt; s.authorised += authAmt
  }

  // A group's decision can live on its children — replicate the authorisation fallback so this report's
  // Sold £ / conversion match the dashboard & Item Performance (which call aggregateRepairItemsByHc).
  const childrenByParent = buildChildrenByParent(items)

  for (const item of items) {
    if (item.deleted_at) continue
    if (item.parent_repair_item_id) continue // top-level only — children roll up via the group total
    const value = calcItemTotal(item, optionTotalsMap)
    const typeId = item.repair_type_id || UNASSIGNED
    const repairTypeId = item.repair_type_id ?? null
    const code = typeId === UNASSIGNED ? 'Unassigned' : (typeMap.get(typeId)?.code || 'Unknown')

    // Authorisation: direct, or via approved children for a group (mirrors aggregateRepairItemsByHc).
    let authorised = isItemAuthorised(item)
    let authorisedValue = value
    if (item.is_group && !authorised && item.id) {
      const approvedChildren = (childrenByParent.get(item.id) || []).filter(ch => !ch.deleted_at && isItemAuthorised(ch))
      if (approvedChildren.length > 0) {
        authorised = true
        authorisedValue = approvedChildren.reduce((s, ch) => s + calcItemTotal(ch, optionTotalsMap), 0)
      }
    }

    let a = byType.get(typeId)
    if (!a) { a = emptyAcc(); byType.set(typeId, a) }
    a.itemCount++
    a.identified += value
    // else-if chain (matches the dashboard): a row counts in at most one outcome bucket.
    if (authorised) a.authorised += authorisedValue
    else if (item.outcome_status === 'declined') a.declined += value
    else if (item.outcome_status === 'deferred') a.deferred += value

    const veh = hcVehicle.get(item.health_check_id)
    if (veh) {
      sliceBump(byMake, typeId, repairTypeId, code, veh.make, value, authorised ? authorisedValue : 0)
      sliceBump(byFuel, typeId, repairTypeId, code, veh.fuel, value, authorised ? authorisedValue : 0)
    }
  }

  const totalIdentified = [...byType.values()].reduce((s, a) => s + a.identified, 0)

  const rows: RepairTypeRow[] = [...byType.entries()].map(([typeId, a]) => {
    const meta = typeId === UNASSIGNED
      ? { code: 'Unassigned', label: 'Unassigned', colour: '#9CA3AF' }
      : (typeMap.get(typeId) || { code: 'Unknown', label: 'Unknown', colour: null })
    return {
      repairTypeId: typeId === UNASSIGNED ? null : typeId,
      code: meta.code,
      label: meta.label,
      colour: meta.colour,
      itemCount: a.itemCount,
      identified: round(a.identified),
      authorised: round(a.authorised),
      declined: round(a.declined),
      deferred: round(a.deferred),
      conversionPct: a.identified > 0 ? round((a.authorised / a.identified) * 100) : null,
      mixPct: totalIdentified > 0 ? round((a.identified / totalIdentified) * 100) : null
    }
  }).sort((x, y) => y.identified - x.identified)

  const sum = (pick: (a: Acc) => number) => [...byType.values()].reduce((s, a) => s + pick(a), 0)
  const totals = {
    identified: round(totalIdentified),
    authorised: round(sum(a => a.authorised)),
    declined: round(sum(a => a.declined)),
    deferred: round(sum(a => a.deferred)),
    itemCount: sum(a => a.itemCount),
    conversionPct: null as number | null
  }
  totals.conversionPct = totals.identified > 0 ? round((totals.authorised / totals.identified) * 100) : null

  const sliceRows = (m: Map<string, SliceAcc>): VehicleSliceRow[] =>
    [...m.values()]
      .map(s => ({ repairTypeId: s.repairTypeId, code: s.code, value: s.value, itemCount: s.itemCount, identified: round(s.identified), authorised: round(s.authorised) }))
      .sort((a, b) => b.identified - a.identified)

  return { rows, totals, byMake: sliceRows(byMake), byFuel: sliceRows(byFuel) }
}
