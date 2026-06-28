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

// `deps` lets a range caller (getAvailabilityStrip) preload the day-invariant
// inputs (config / quotas / assets) once instead of re-reading them per day.
export interface DayCapacityDeps {
  config?: ResourceSiteConfig
  quotas?: Map<string, CategoryQuota>
  assetMap?: Map<string, { quantity: number; name: string | null }>
}

export async function getDayCapacity(orgId: string, siteId: string, date: string, today?: string, deps?: DayCapacityDeps): Promise<DayCapacity> {
  const now = today || new Date().toISOString().slice(0, 10)
  const [config, quotas, assetMap] = await Promise.all([
    deps?.config ? Promise.resolve(deps.config) : loadSiteConfig(orgId, siteId),
    deps?.quotas ? Promise.resolve(deps.quotas) : loadCategoryQuotas(orgId, siteId),
    deps?.assetMap ? Promise.resolve(deps.assetMap) : loadAssets(orgId, siteId)
  ])
  const [summaryRes, skillCap, booked] = await Promise.all([
    supabaseAdmin.rpc('diary_day_summary', { p_org_id: orgId, p_site_id: siteId, p_from: date, p_to: date }),
    getSkillCapacity(orgId, siteId, date),
    getCategoryBooked(orgId, siteId, date)
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

// ---------------------------------------------------------------------------
// Booking-job resolution + availability strip (consumed by the booking flows —
// advisor BookingDatePicker via /resource-manager/availability, and the public
// estimate picker). A "job" is the category + hours + booking mode a booking
// consumes; the strip is the contiguous run of upcoming days with a per-day
// verdict + load band, plus the recommended day and alternatives — everything
// the picker needs in one call.
// ---------------------------------------------------------------------------

export type BookingMode = 'drop_off' | 'timed_slot'

export interface BookingJob {
  siteId: string
  repairTypeId: string
  hours: number
  bookingMode: BookingMode
  slotMinutes: number
  label: string | null
  colour: string | null
}

export type ParentRef =
  | { kind: 'jobsheet'; id: string }
  | { kind: 'estimate'; id: string }
  | { kind: 'health_check'; id: string }

const PARENT_TABLE: Record<ParentRef['kind'], string> = {
  jobsheet: 'jobsheets', estimate: 'estimates', health_check: 'health_checks'
}
const PARENT_FK: Record<ParentRef['kind'], string> = {
  jobsheet: 'jobsheet_id', estimate: 'estimate_id', health_check: 'health_check_id'
}

async function defaultSiteId(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('sites').select('id').eq('organization_id', orgId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return data?.id ?? null
}

// Derive mode + slot length for a repair type given the job's hours.
function modeAndSlot(rt: any, hours: number): { bookingMode: BookingMode; slotMinutes: number } {
  const bookingMode: BookingMode = rt?.booking_mode === 'timed_slot' ? 'timed_slot' : 'drop_off'
  const slotMinutes = bookingMode === 'timed_slot'
    ? (Number(rt?.slot_minutes) || Math.max(15, Math.round(hours * 60)))
    : Math.max(15, Math.round(hours * 60))
  return { bookingMode, slotMinutes }
}

// Build a BookingJob straight from a repair type id + caller-supplied hours
// (the surfaces with no draft parent yet, e.g. an explicit repair-type pick).
export async function resolveBookingJobByType(orgId: string, siteId: string, repairTypeId: string, hours?: number): Promise<BookingJob | null> {
  const { data: rt } = await supabaseAdmin
    .from('repair_types')
    .select('id, code, label, colour, booking_mode, slot_minutes, default_estimated_hours')
    .eq('id', repairTypeId).eq('organization_id', orgId).maybeSingle()
  if (!rt) return null
  let h = Number(hours) || 0
  if (h <= 0) h = Number(rt.default_estimated_hours) || 1
  const { bookingMode, slotMinutes } = modeAndSlot(rt, h)
  return { siteId, repairTypeId, hours: h, bookingMode, slotMinutes, label: rt.label ?? rt.code ?? null, colour: rt.colour ?? null }
}

// Resolve the category + hours + mode a booking consumes from its parent doc.
// Category ladder: parent.primary_repair_type_id → first priced top-level
// repair item → any item with a type. Hours = Σ repair_labour.hours, falling
// back to the type's default. `siteHint` (an org-validated ?siteId) wins over
// the parent's stored site. Returns null when no category can be resolved yet.
export async function resolveBookingJobForParent(orgId: string, parent: ParentRef, siteHint?: string | null): Promise<BookingJob | null> {
  const table = PARENT_TABLE[parent.kind]
  const fk = PARENT_FK[parent.kind]
  const cols = parent.kind === 'estimate' ? 'id, site_id' : 'id, site_id, primary_repair_type_id'
  const { data: row } = await supabaseAdmin
    .from(table).select(cols).eq('id', parent.id).eq('organization_id', orgId).maybeSingle()
  if (!row) return null

  const siteId = siteHint || (row as any).site_id || await defaultSiteId(orgId)
  if (!siteId) return null

  const { data: items } = await supabaseAdmin
    .from('repair_items')
    .select('id, parent_repair_item_id, repair_type_id, created_at')
    .eq(fk, parent.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  const all = items || []
  const topTyped = all.find((i: any) => !i.parent_repair_item_id && i.repair_type_id)
  const repairTypeId: string | null =
    (row as any).primary_repair_type_id ||
    topTyped?.repair_type_id ||
    all.find((i: any) => i.repair_type_id)?.repair_type_id ||
    null
  if (!repairTypeId) return null

  const itemIds = all.map((i: any) => i.id)
  let hours = 0
  if (itemIds.length) {
    const { data: lab } = await supabaseAdmin.from('repair_labour').select('hours').in('repair_item_id', itemIds)
    hours = (lab || []).reduce((s: number, l: any) => s + (Number(l.hours) || 0), 0)
  }
  const job = await resolveBookingJobByType(orgId, siteId, repairTypeId, hours)
  return job
}

export interface StripDay {
  date: string
  status: BookVerdict
  reason: string
  availableHours: number
  bookedHours: number
  bookedPct: number | null
  freeHours: number
  ceilingHours: number
  band: CapacityBand
}

export interface AvailabilityStrip {
  days: StripDay[]
  recommended: StripDay | null
  alternatives: StripDay[]
  softHints: StripDay[]
}

// Contiguous run of upcoming operating days with a per-day verdict + load band
// for one job, plus the recommended day / alternatives / soft hints. Loads the
// day-invariant inputs once; when quotas are off it computes the verdict from
// the range summary alone (no heavy per-day calls).
export async function getAvailabilityStrip(
  orgId: string, siteId: string, repairTypeId: string, hours: number,
  opts?: { fromDate?: string; leadFloorDays?: number; stripDays?: number }
): Promise<AvailabilityStrip> {
  const config = await loadSiteConfig(orgId, siteId)
  const quotas = await loadCategoryQuotas(orgId, siteId)
  const quota = quotas.get(repairTypeId) || defaultQuota(repairTypeId)
  const assetMap = config.enableCategoryQuotas ? await loadAssets(orgId, siteId) : new Map<string, { quantity: number; name: string | null }>()
  const today = new Date().toISOString().slice(0, 10)
  const floor = opts?.leadFloorDays ?? config.bookingLeadTimeDays
  const stripLen = opts?.stripDays ?? 14
  const opDays = await operatingDays(orgId, siteId)
  const start = addDays(opts?.fromDate || today, Math.max(0, floor))

  // One range summary instead of a per-day diary_day_summary.
  const end = addDays(start, config.bookingMaxDays)
  const { data: sumRows } = await supabaseAdmin.rpc('diary_day_summary', { p_org_id: orgId, p_site_id: siteId, p_from: start, p_to: end })
  const summary = new Map<string, any>()
  for (const r of sumRows || []) summary.set(r.day, r)

  const days: StripDay[] = []
  const ok: StripDay[] = []
  const warn: StripDay[] = []

  for (let i = 0; i <= config.bookingMaxDays; i++) {
    const d = addDays(start, i)
    if (!opDays.includes(isoDow(d))) continue

    const s = summary.get(d) || {}
    const available = Number(s.available_hours) || 0
    const bookedH = Number(s.booked_hours) || 0
    const { ceilingHours, band } = computeBand(bookedH, available, config.targetLoadingPct)

    let status: BookVerdict, reason: string, freeHours: number
    if (config.enableCategoryQuotas) {
      const day = await getDayCapacity(orgId, siteId, d, today, { config, quotas, assetMap })
      const r = canBookOnDay(day, config, quota, repairTypeId, hours)
      status = r.status; reason = r.reason; freeHours = day.freePool
    } else {
      const freePool = Math.max(0, ceilingHours - bookedH)
      const physicalFree = available * config.overbookFactor - bookedH
      freeHours = round2(freePool)
      if (available <= 0) { status = 'DENY_HARD'; reason = 'Closed' }
      else if (hours > physicalFree) { status = 'DENY_HARD'; reason = 'Day is physically full' }
      else if (hours > freePool) { status = 'WARN'; reason = 'Over the loading target for this day' }
      else { status = 'OK'; reason = 'Within capacity' }
    }

    const sd: StripDay = {
      date: d, status, reason,
      availableHours: round2(available), bookedHours: round2(bookedH),
      bookedPct: available > 0 ? round2(bookedH / available) : null,
      freeHours, ceilingHours, band
    }
    if (days.length < stripLen) days.push(sd)
    if (status === 'OK') ok.push(sd)
    else if (status === 'WARN') warn.push(sd)

    if (days.length >= stripLen && ok.length >= 4) break
  }

  return { days, recommended: ok[0] || warn[0] || null, alternatives: ok.slice(1, 4), softHints: warn.slice(0, 3) }
}
