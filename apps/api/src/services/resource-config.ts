/**
 * Resource Manager — per-site capacity config + RAG banding.
 *
 * P0 surface. `loadSiteConfig` reads a `resource_site_config` row (or returns
 * all-defaults when none exists — GETs never write). `computeBand` turns a day's
 * booked/available hours into a configurable RAG band against the site's
 * `target_loading_pct`, replacing the diary's old hard-coded 85% threshold.
 *
 * Later phases extend this service (skills capacity, category quotas, lead-time
 * recommender); P0 only needs config + banding.
 */

import { supabaseAdmin } from '../lib/supabase.js'

export interface ResourceSiteConfig {
  targetLoadingPct: number
  overbookFactor: number
  bookingLeadTimeDays: number
  onlineLeadTimeHours: number
  bookingMaxDays: number
  releaseWindowDays: number
  dropoffWindowStart: string   // 'HH:MM'
  dropoffWindowEnd: string     // 'HH:MM'
  dropoffSlotIntervalMinutes: number
  dropoffSlotCapacity: number | null
  enableSkillRouting: boolean
  enableCategoryQuotas: boolean
}

// Defaults mirror the column defaults in 20260629120000_resource_manager_p0.sql.
// A site with no saved row behaves exactly as if these were stored.
export const DEFAULT_RESOURCE_CONFIG: ResourceSiteConfig = {
  targetLoadingPct: 0.85,
  overbookFactor: 1.0,
  bookingLeadTimeDays: 0,
  onlineLeadTimeHours: 24,
  bookingMaxDays: 60,
  releaseWindowDays: 5,
  dropoffWindowStart: '08:00',
  dropoffWindowEnd: '09:30',
  dropoffSlotIntervalMinutes: 15,
  dropoffSlotCapacity: null,
  enableSkillRouting: false,
  enableCategoryQuotas: false
}

// 'HH:MM:SS' / 'HH:MM' → 'HH:MM' (drop seconds for the UI).
function hhmm(t: string | null | undefined, fallback: string): string {
  return t ? String(t).slice(0, 5) : fallback
}

export function mapConfigRow(row: any): ResourceSiteConfig {
  if (!row) return { ...DEFAULT_RESOURCE_CONFIG }
  return {
    targetLoadingPct: Number(row.target_loading_pct ?? DEFAULT_RESOURCE_CONFIG.targetLoadingPct),
    overbookFactor: Number(row.overbook_factor ?? DEFAULT_RESOURCE_CONFIG.overbookFactor),
    bookingLeadTimeDays: Number(row.booking_lead_time_days ?? DEFAULT_RESOURCE_CONFIG.bookingLeadTimeDays),
    onlineLeadTimeHours: Number(row.online_lead_time_hours ?? DEFAULT_RESOURCE_CONFIG.onlineLeadTimeHours),
    bookingMaxDays: Number(row.booking_max_days ?? DEFAULT_RESOURCE_CONFIG.bookingMaxDays),
    releaseWindowDays: Number(row.release_window_days ?? DEFAULT_RESOURCE_CONFIG.releaseWindowDays),
    dropoffWindowStart: hhmm(row.dropoff_window_start, DEFAULT_RESOURCE_CONFIG.dropoffWindowStart),
    dropoffWindowEnd: hhmm(row.dropoff_window_end, DEFAULT_RESOURCE_CONFIG.dropoffWindowEnd),
    dropoffSlotIntervalMinutes: Number(row.dropoff_slot_interval_minutes ?? DEFAULT_RESOURCE_CONFIG.dropoffSlotIntervalMinutes),
    dropoffSlotCapacity: row.dropoff_slot_capacity == null ? null : Number(row.dropoff_slot_capacity),
    enableSkillRouting: Boolean(row.enable_skill_routing),
    enableCategoryQuotas: Boolean(row.enable_category_quotas)
  }
}

/**
 * Load the saved config for a site, or all-defaults when no row exists.
 * Side-effect free (no lazy seed) so it's safe to call on every read.
 */
export async function loadSiteConfig(orgId: string, siteId: string): Promise<ResourceSiteConfig> {
  const { data, error } = await supabaseAdmin
    .from('resource_site_config')
    .select('*')
    .eq('organization_id', orgId)
    .eq('site_id', siteId)
    .maybeSingle()
  if (error) {
    console.error('loadSiteConfig error:', error)
    return { ...DEFAULT_RESOURCE_CONFIG }
  }
  return mapConfigRow(data)
}

export type CapacityBand = 'closed' | 'low' | 'healthy' | 'high' | 'over'

export interface DayBanding {
  ceilingHours: number          // available × target_loading_pct
  utilisationPct: number | null // booked / available (null when no capacity)
  band: CapacityBand
}

// Underloaded days fall below this fraction of the target (drives "fill me").
const UNDERLOAD_FRACTION = 0.5

/**
 * RAG band for a day, configurable against the site's target loading.
 *   closed  — no available hours (non-operating / no techs on shift)
 *   low     — well below target (room to fill)
 *   healthy — below target
 *   high    — at/over target but under 100% (amber)
 *   over    — over 100% of available hours (red, physically overbooked)
 */
export function computeBand(
  bookedHours: number,
  availableHours: number,
  targetLoadingPct: number
): DayBanding {
  const available = Number(availableHours) || 0
  const booked = Number(bookedHours) || 0
  const ceilingHours = Math.round(available * targetLoadingPct * 100) / 100
  if (available <= 0) {
    return { ceilingHours: 0, utilisationPct: null, band: 'closed' }
  }
  const utilisationPct = Math.round((booked / available) * 1000) / 1000
  let band: CapacityBand
  if (utilisationPct >= 1) band = 'over'
  else if (utilisationPct >= targetLoadingPct) band = 'high'
  else if (utilisationPct < targetLoadingPct * UNDERLOAD_FRACTION) band = 'low'
  else band = 'healthy'
  return { ceilingHours, utilisationPct, band }
}
