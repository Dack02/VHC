/**
 * Resource Manager — capacity engine (P2).
 *
 * Assembles per-category day capacity from three inputs — site hours (the diary
 * RPCs), skill-segmented staffing (resource_skill_capacity RPC), and per-category
 * booked load — then runs the supply-driven `canBook` (§4) and `recommendDay`
 * (§6). The decision is GUARDED: with `enable_category_quotas = false` it reduces
 * to the P0 hours ceiling, so it can't change behaviour until an org opts in.
 *
 * Category-booked accuracy depends on a booking's resolved repair type
 * (primary_repair_type_id → first priced repair item → MOT inference); bookings
 * with no resolvable category count toward the site pool only (§10).
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { loadSiteConfig, computeBand, type ResourceSiteConfig, type CapacityBand } from './resource-config.js'

export interface CategoryQuota {
  repairTypeId: string
  valueRank: number
  protectPrimary: boolean
  releaseWindowDays: number
  minHours: number | null
  hardCapJobs: number | null
  hardCapHours: number | null
  enforcement: 'soft' | 'hard'
  allowOverride: boolean
  weekdayMask: number
  isActive: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function defaultQuota(repairTypeId: string): CategoryQuota {
  return {
    repairTypeId,
    valueRank: 100,
    protectPrimary: true,
    releaseWindowDays: 5,
    minHours: null,
    hardCapJobs: null,
    hardCapHours: null,
    enforcement: 'soft',
    allowOverride: true,
    weekdayMask: 127,
    isActive: true
  }
}

export function mapQuotaRow(r: any): CategoryQuota {
  return {
    repairTypeId: r.repair_type_id,
    valueRank: r.value_rank ?? 100,
    protectPrimary: r.protect_primary ?? true,
    releaseWindowDays: r.release_window_days ?? 5,
    minHours: r.min_hours == null ? null : Number(r.min_hours),
    hardCapJobs: r.hard_cap_jobs == null ? null : Number(r.hard_cap_jobs),
    hardCapHours: r.hard_cap_hours == null ? null : Number(r.hard_cap_hours),
    enforcement: r.enforcement === 'hard' ? 'hard' : 'soft',
    allowOverride: r.allow_override ?? true,
    weekdayMask: r.weekday_mask ?? 127,
    isActive: r.is_active ?? true
  }
}

export async function loadCategoryQuotas(orgId: string, siteId: string): Promise<Map<string, CategoryQuota>> {
  const { data } = await supabaseAdmin
    .from('resource_category_quotas')
    .select('*')
    .eq('organization_id', orgId)
    .eq('site_id', siteId)
    .eq('is_active', true)
  const map = new Map<string, CategoryQuota>()
  for (const r of data || []) map.set(r.repair_type_id, mapQuotaRow(r))
  return map
}

interface SkillCap { primaryHours: number; eligibleHours: number; jobCapSum: number; uncappedTechs: number }

export async function getSkillCapacity(orgId: string, siteId: string, date: string): Promise<Map<string, SkillCap>> {
  const { data, error } = await supabaseAdmin.rpc('resource_skill_capacity', {
    p_org_id: orgId, p_site_id: siteId, p_date: date
  })
  const map = new Map<string, SkillCap>()
  if (error) { console.error('resource_skill_capacity error:', error); return map }
  for (const r of data || []) {
    map.set(r.repair_type_id, {
      primaryHours: Number(r.primary_hours) || 0,
      eligibleHours: Number(r.eligible_hours) || 0,
      jobCapSum: Number(r.job_cap_sum) || 0,
      uncappedTechs: Number(r.uncapped_techs) || 0
    })
  }
  return map
}

interface CategoryBooked { byType: Map<string, { hours: number; jobs: number }>; uncategorizedHours: number; uncategorizedJobs: number }

// Resolve each of a day's bookings to a repair type and total hours/jobs by type.
// Ladder: health_checks/jobsheets.primary_repair_type_id → first priced repair
// item → MOT inference → uncategorised (site pool only).
export async function getCategoryBooked(orgId: string, siteId: string, date: string): Promise<CategoryBooked> {
  const empty: CategoryBooked = { byType: new Map(), uncategorizedHours: 0, uncategorizedJobs: 0 }
  const { data: bookings, error } = await supabaseAdmin.rpc('diary_day_bookings', {
    p_org_id: orgId, p_site_id: siteId, p_date: date
  })
  if (error) { console.error('diary_day_bookings error:', error); return empty }
  if (!bookings || bookings.length === 0) return empty

  const hcIds = [...new Set(bookings.filter((b: any) => b.health_check_id).map((b: any) => b.health_check_id))]
  const jsIds = [...new Set(bookings.filter((b: any) => b.jobsheet_id).map((b: any) => b.jobsheet_id))]

  const [hcPrim, jsPrim, riHc, riJs, motType] = await Promise.all([
    hcIds.length ? supabaseAdmin.from('health_checks').select('id, primary_repair_type_id').in('id', hcIds) : Promise.resolve({ data: [] as any[] }),
    jsIds.length ? supabaseAdmin.from('jobsheets').select('id, primary_repair_type_id').in('id', jsIds) : Promise.resolve({ data: [] as any[] }),
    hcIds.length ? supabaseAdmin.from('repair_items').select('health_check_id, repair_type_id, created_at').in('health_check_id', hcIds).not('repair_type_id', 'is', null).order('created_at', { ascending: true }) : Promise.resolve({ data: [] as any[] }),
    jsIds.length ? supabaseAdmin.from('repair_items').select('jobsheet_id, repair_type_id, created_at').in('jobsheet_id', jsIds).not('repair_type_id', 'is', null).order('created_at', { ascending: true }) : Promise.resolve({ data: [] as any[] }),
    supabaseAdmin.from('repair_types').select('id').eq('organization_id', orgId).eq('is_active', true).ilike('code', 'mot').limit(1).maybeSingle()
  ])

  const hcPrimMap = new Map((hcPrim.data || []).map((r: any) => [r.id, r.primary_repair_type_id]))
  const jsPrimMap = new Map((jsPrim.data || []).map((r: any) => [r.id, r.primary_repair_type_id]))
  const riHcMap = new Map<string, string>()
  for (const r of riHc.data || []) if (!riHcMap.has(r.health_check_id)) riHcMap.set(r.health_check_id, r.repair_type_id)
  const riJsMap = new Map<string, string>()
  for (const r of riJs.data || []) if (!riJsMap.has(r.jobsheet_id)) riJsMap.set(r.jobsheet_id, r.repair_type_id)
  const motTypeId: string | null = (motType as any)?.data?.id ?? null

  const byType = new Map<string, { hours: number; jobs: number }>()
  let uncategorizedHours = 0, uncategorizedJobs = 0
  for (const b of bookings as any[]) {
    const rtId =
      (b.health_check_id && hcPrimMap.get(b.health_check_id)) ||
      (b.jobsheet_id && jsPrimMap.get(b.jobsheet_id)) ||
      (b.health_check_id && riHcMap.get(b.health_check_id)) ||
      (b.jobsheet_id && riJsMap.get(b.jobsheet_id)) ||
      (b.is_mot ? motTypeId : null)
    const hours = Number(b.estimated_hours) || 0
    if (rtId) {
      const cur = byType.get(rtId) || { hours: 0, jobs: 0 }
      cur.hours += hours; cur.jobs += 1
      byType.set(rtId, cur)
    } else {
      uncategorizedHours += hours; uncategorizedJobs += 1
    }
  }
  return { byType, uncategorizedHours, uncategorizedJobs }
}

export interface DayCategory {
  repairTypeId: string
  primarySupplyHours: number
  eligibleSupplyHours: number
  hoursCeiling: number        // eligible hours × target loading (the category's bookable hours)
  jobCeiling: number | null   // summed per-tech daily_job_cap (null = uncapped)
  hardCapJobs: number | null  // site/physical hard cap (e.g. MOT bay)
  enforcement: 'soft' | 'hard'
  bookedHours: number
  bookedJobs: number
  hold: number                // protected hours for this pool right now
}

export interface DayAsset {
  assetType: string
  name: string | null
  quantity: number
  booked: number
  available: number
}

export interface DayCapacity {
  date: string
  siteAvailableHours: number
  ceilingHours: number
  bookedHours: number
  freePool: number
  band: CapacityBand
  quotasEnabled: boolean
  categories: DayCategory[]
  assets: DayAsset[]
}

// Per-site physical resources (loan cars, waiter seats, MOT bay). Booked counts
// come from diary_day_summary totals so no extra per-booking query is needed.
export async function loadAssets(orgId: string, siteId: string): Promise<Map<string, { quantity: number; name: string | null }>> {
  const { data } = await supabaseAdmin
    .from('resource_assets')
    .select('asset_type, name, quantity')
    .eq('organization_id', orgId).eq('site_id', siteId).eq('is_active', true)
  const m = new Map<string, { quantity: number; name: string | null }>()
  for (const r of data || []) m.set(r.asset_type, { quantity: Number(r.quantity) || 0, name: r.name ?? null })
  return m
}

// Is a courtesy/loan car free on a date? Untracked (no asset row) → always yes.
export async function loanCarAvailableOn(orgId: string, siteId: string, date: string): Promise<boolean> {
  const [assets, summaryRes] = await Promise.all([
    loadAssets(orgId, siteId),
    supabaseAdmin.rpc('diary_day_summary', { p_org_id: orgId, p_site_id: siteId, p_from: date, p_to: date })
  ])
  const cap = assets.get('loan_car')
  if (!cap) return true
  const s = (summaryRes.data || [])[0] || {}
  return (Number(s.total_loans) || 0) < cap.quantity
}

function daysUntil(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime()
  const b = new Date(`${to}T12:00:00`).getTime()
  return Math.round((b - a) / 86400000)
}

export async function getDayCapacity(orgId: string, siteId: string, date: string, today?: string): Promise<DayCapacity> {
  const now = today || new Date().toISOString().slice(0, 10)
  const [config, summaryRes, skillCap, quotas, booked, assetMap] = await Promise.all([
    loadSiteConfig(orgId, siteId),
    supabaseAdmin.rpc('diary_day_summary', { p_org_id: orgId, p_site_id: siteId, p_from: date, p_to: date }),
    getSkillCapacity(orgId, siteId, date),
    loadCategoryQuotas(orgId, siteId),
    getCategoryBooked(orgId, siteId, date),
    loadAssets(orgId, siteId)
  ])

  const s = (summaryRes.data || [])[0] || {}
  const available = Number(s.available_hours) || 0
  const bookedHours = Number(s.booked_hours) || 0
  const { ceilingHours, band } = computeBand(bookedHours, available, config.targetLoadingPct)
  const freePool = round2(Math.max(0, ceilingHours - bookedHours))

  const dUntil = Math.max(0, daysUntil(now, date))

  // Build a category row for every repair type that is either staffed or quota'd.
  const typeIds = new Set<string>([...skillCap.keys(), ...quotas.keys(), ...booked.byType.keys()])
  const categories: DayCategory[] = []
  for (const rtId of typeIds) {
    const cap = skillCap.get(rtId)
    const q = quotas.get(rtId) || defaultQuota(rtId)
    const b = booked.byType.get(rtId) || { hours: 0, jobs: 0 }
    const primaryHours = cap?.primaryHours || 0
    const eligibleHours = cap?.eligibleHours || 0
    const jobCeiling = cap && cap.uncappedTechs === 0 ? cap.jobCapSum : null

    // hold = spare × time_factor × poolfill, with optional manual min-hours floor.
    const poolCeiling = primaryHours * config.targetLoadingPct
    const spare = Math.max(0, poolCeiling - b.hours)
    const timeFactor = clamp01(dUntil / Math.max(1, q.releaseWindowDays))
    const poolfill = poolCeiling > 0 ? clamp01(b.hours / poolCeiling) : 0
    let hold = q.protectPrimary ? spare * timeFactor * poolfill : 0
    if (q.minHours != null) hold = Math.max(hold, q.minHours * timeFactor)

    categories.push({
      repairTypeId: rtId,
      primarySupplyHours: round2(primaryHours),
      eligibleSupplyHours: round2(eligibleHours),
      hoursCeiling: round2(eligibleHours * config.targetLoadingPct),
      jobCeiling,
      hardCapJobs: q.hardCapJobs,
      enforcement: q.enforcement,
      bookedHours: round2(b.hours),
      bookedJobs: b.jobs,
      hold: round2(hold)
    })
  }

  // Physical resources: booked counts come straight from the summary totals.
  const assetCounts: Record<string, number> = {
    loan_car: Number(s.total_loans) || 0,
    waiter_seat: Number(s.total_waiting) || 0,
    mot_bay: Number(s.total_mots) || 0
  }
  const assets: DayAsset[] = [...assetMap.entries()].map(([assetType, a]) => {
    const bk = assetCounts[assetType] ?? 0
    return { assetType, name: a.name, quantity: a.quantity, booked: bk, available: Math.max(0, a.quantity - bk) }
  })

  return {
    date,
    siteAvailableHours: round2(available),
    ceilingHours,
    bookedHours: round2(bookedHours),
    freePool,
    band,
    quotasEnabled: config.enableCategoryQuotas,
    categories,
    assets
  }
}

export type BookVerdict = 'OK' | 'WARN' | 'DENY_SOFT' | 'DENY_HARD'
export interface BookResult { status: BookVerdict; reason: string }

// §4.5 acceptance against an assembled DayCapacity. Pure given the day bundle.
export function canBookOnDay(
  day: DayCapacity,
  config: ResourceSiteConfig,
  quota: CategoryQuota,
  repairTypeId: string,
  hours: number
): BookResult {
  const cat = day.categories.find(c => c.repairTypeId === repairTypeId)

  // Physical ceiling always applies (overbook factor over raw available hours).
  const physicalFree = day.siteAvailableHours * config.overbookFactor - day.bookedHours
  if (hours > physicalFree) return { status: 'DENY_HARD', reason: 'Day is physically full' }

  // Quotas off → pure hours ceiling (P0 behaviour).
  if (!day.quotasEnabled) {
    if (hours > day.freePool) {
      return { status: 'WARN', reason: 'Over the loading target for this day' }
    }
    return { status: 'OK', reason: 'Within capacity' }
  }

  const hard = quota.enforcement === 'hard' || !quota.allowOverride

  // 1. Skilled-hours feasibility (only when this category is actually staffed).
  if (cat && cat.eligibleSupplyHours > 0) {
    const skilledRemaining = cat.eligibleSupplyHours * config.targetLoadingPct - cat.bookedHours
    if (hours > skilledRemaining) {
      return { status: hard ? 'DENY_SOFT' : 'WARN', reason: 'Not enough skilled capacity for this work on the day' }
    }
  }

  // 2. Site / physical hard cap (count + hours).
  if (quota.hardCapJobs != null && cat && cat.bookedJobs + 1 > quota.hardCapJobs) {
    return { status: 'DENY_HARD', reason: 'Category hard cap reached (e.g. bay full)' }
  }
  if (quota.hardCapHours != null && cat && cat.bookedHours + hours > quota.hardCapHours) {
    return { status: 'DENY_HARD', reason: 'Category hours hard cap reached' }
  }

  // 3. Category count throttle (summed per-tech daily caps).
  if (cat && cat.jobCeiling != null && cat.bookedJobs + 1 > cat.jobCeiling) {
    return { status: hard ? 'DENY_SOFT' : 'WARN', reason: 'Category at its daily count limit' }
  }

  // 4. Protection — would this consume capacity held for OTHER specialist lanes?
  const protectedOther = day.categories
    .filter(c => c.repairTypeId !== repairTypeId)
    .reduce((sum, c) => sum + c.hold, 0)
  const allowance = day.freePool - protectedOther
  if (hours > allowance) {
    return { status: hard ? 'DENY_SOFT' : 'WARN', reason: 'Would consume capacity held for higher-value/specialist work' }
  }

  return { status: 'OK', reason: 'Within capacity' }
}

export async function canBook(orgId: string, siteId: string, date: string, repairTypeId: string, hours: number): Promise<BookResult> {
  const [day, config, quotas] = await Promise.all([
    getDayCapacity(orgId, siteId, date),
    loadSiteConfig(orgId, siteId),
    loadCategoryQuotas(orgId, siteId)
  ])
  const quota = quotas.get(repairTypeId) || defaultQuota(repairTypeId)
  return canBookOnDay(day, config, quota, repairTypeId, hours)
}

export interface DayOption { date: string; status: BookVerdict; reason: string; freeHours: number }
export interface AvailabilityResult {
  recommended: DayOption | null
  alternatives: DayOption[]
  softHints: DayOption[]
}

async function operatingDays(orgId: string, siteId: string): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from('workshop_board_config')
    .select('operating_days')
    .eq('organization_id', orgId).eq('site_id', siteId)
    .maybeSingle()
  const od = data?.operating_days as number[] | null | undefined
  return od && od.length ? od : [1, 2, 3, 4, 5, 6, 7]
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00`); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function isoDow(ymd: string): number {
  const d = new Date(`${ymd}T12:00:00`).getDay(); return ((d + 6) % 7) + 1
}

// §6 — scan forward for the earliest acceptable day + alternatives.
export async function recommendDay(
  orgId: string, siteId: string, repairTypeId: string, hours: number,
  fromDate?: string, leadFloorDays?: number
): Promise<AvailabilityResult> {
  const config = await loadSiteConfig(orgId, siteId)
  const quotas = await loadCategoryQuotas(orgId, siteId)
  const quota = quotas.get(repairTypeId) || defaultQuota(repairTypeId)
  const today = new Date().toISOString().slice(0, 10)
  const floor = leadFloorDays ?? config.bookingLeadTimeDays
  const opDays = await operatingDays(orgId, siteId)

  const start = addDays(fromDate || today, Math.max(0, floor))
  const ok: DayOption[] = []
  const warn: DayOption[] = []
  const MAX_ALTERNATIVES = 4

  for (let i = 0; i <= config.bookingMaxDays; i++) {
    const d = addDays(start, i)
    if (!opDays.includes(isoDow(d))) continue
    const day = await getDayCapacity(orgId, siteId, d, today)
    const r = canBookOnDay(day, config, quota, repairTypeId, hours)
    const opt: DayOption = { date: d, status: r.status, reason: r.reason, freeHours: day.freePool }
    if (r.status === 'OK') { ok.push(opt); if (ok.length >= MAX_ALTERNATIVES) break }
    else if (r.status === 'WARN') warn.push(opt)
  }

  return {
    recommended: ok[0] || warn[0] || null,
    alternatives: ok.slice(1, MAX_ALTERNATIVES),
    softHints: warn.slice(0, 3)
  }
}
