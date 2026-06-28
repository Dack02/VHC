/**
 * Estimate settings — per-org configuration for the Estimates module: customer-link expiry,
 * auto-expiry of stale estimates, require-signature-to-accept, terms text, the tenant's
 * selling points (USPs), and the online-booking config (lets a customer book a slot after
 * approving — slots come from Booking Diary capacity, see services/estimate-booking.ts).
 *
 * Stored as columns on organization_settings:
 *   20260626160000_estimates_send.sql   — expiry / auto-expire / signature / terms
 *   20260627120000_estimate_usps.sql    — usps
 *   20260628120000_estimate_online_booking.sql — online booking config
 */
import { supabaseAdmin } from '../lib/supabase.js'

const MAX_USPS = 6
const USP_MAXLEN = 80

export interface EstimateSettings {
  linkExpiryDays: number
  autoExpire: boolean
  requireSignature: boolean
  termsText: string | null
  usps: string[]
  // Online booking
  onlineBookingEnabled: boolean
  bookingLeadDays: number
  bookingWindowDays: number
  bookingSlotMinutes: number
  bookingDayStart: string   // 'HH:MM'
  bookingDayEnd: string     // 'HH:MM'
  bookingCourtesyCar: boolean
}

const DEFAULTS: EstimateSettings = {
  linkExpiryDays: 7,
  autoExpire: true,
  requireSignature: false,
  termsText: null,
  usps: [],
  onlineBookingEnabled: false,
  bookingLeadDays: 1,
  bookingWindowDays: 21,
  bookingSlotMinutes: 90,
  bookingDayStart: '08:30',
  bookingDayEnd: '17:00',
  bookingCourtesyCar: false
}

// Normalise a raw usps value (jsonb can arrive as array, string, or null) into a clean,
// bounded array of trimmed non-empty strings.
export function normaliseUsps(raw: unknown): string[] {
  let arr: unknown[] = []
  if (Array.isArray(raw)) arr = raw
  else if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p } catch { /* ignore */ }
  }
  return arr
    .filter((v): v is string => typeof v === 'string')
    .map((s) => s.trim().slice(0, USP_MAXLEN))
    .filter(Boolean)
    .slice(0, MAX_USPS)
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const clampTime = (v: unknown, fallback: string) => (typeof v === 'string' && HHMM.test(v) ? v : fallback)
const clampInt = (v: unknown, fallback: number, min: number, max: number) => {
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export async function getEstimateSettings(orgId: string): Promise<EstimateSettings> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select(`
      estimate_link_expiry_days, estimate_auto_expire, estimate_require_signature,
      estimate_terms_text, estimate_usps,
      estimate_online_booking_enabled, estimate_booking_lead_days, estimate_booking_window_days,
      estimate_booking_slot_minutes, estimate_booking_day_start, estimate_booking_day_end,
      estimate_booking_courtesy_car
    `)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!data) return { ...DEFAULTS }
  return {
    linkExpiryDays: data.estimate_link_expiry_days ?? DEFAULTS.linkExpiryDays,
    autoExpire: data.estimate_auto_expire ?? DEFAULTS.autoExpire,
    requireSignature: data.estimate_require_signature ?? DEFAULTS.requireSignature,
    termsText: data.estimate_terms_text ?? DEFAULTS.termsText,
    usps: normaliseUsps(data.estimate_usps),
    onlineBookingEnabled: data.estimate_online_booking_enabled ?? DEFAULTS.onlineBookingEnabled,
    bookingLeadDays: data.estimate_booking_lead_days ?? DEFAULTS.bookingLeadDays,
    bookingWindowDays: data.estimate_booking_window_days ?? DEFAULTS.bookingWindowDays,
    bookingSlotMinutes: data.estimate_booking_slot_minutes ?? DEFAULTS.bookingSlotMinutes,
    bookingDayStart: clampTime(data.estimate_booking_day_start, DEFAULTS.bookingDayStart),
    bookingDayEnd: clampTime(data.estimate_booking_day_end, DEFAULTS.bookingDayEnd),
    bookingCourtesyCar: data.estimate_booking_courtesy_car ?? DEFAULTS.bookingCourtesyCar
  }
}

// Map a camelCase settings PATCH body to organization_settings columns, validating each
// field. Returns { updates } for the DB or throws Error(message) on bad input.
export function buildSettingsUpdate(body: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {}

  if (body.linkExpiryDays !== undefined) {
    const days = parseInt(String(body.linkExpiryDays), 10)
    if (isNaN(days) || days < 1 || days > 365) throw new Error('Link expiry must be 1–365 days')
    updates.estimate_link_expiry_days = days
  }
  if (body.autoExpire !== undefined) updates.estimate_auto_expire = body.autoExpire === true
  if (body.requireSignature !== undefined) updates.estimate_require_signature = body.requireSignature === true
  if (body.termsText !== undefined) {
    const t = typeof body.termsText === 'string' ? body.termsText : ''
    if (t.length > 10000) throw new Error('Terms text is too long (max 10,000 characters)')
    updates.estimate_terms_text = t.trim() || null
  }
  if (body.usps !== undefined) {
    if (!Array.isArray(body.usps)) throw new Error('Selling points must be a list')
    updates.estimate_usps = normaliseUsps(body.usps)
  }

  // Online booking
  if (body.onlineBookingEnabled !== undefined) updates.estimate_online_booking_enabled = body.onlineBookingEnabled === true
  if (body.bookingLeadDays !== undefined) updates.estimate_booking_lead_days = clampInt(body.bookingLeadDays, DEFAULTS.bookingLeadDays, 0, 60)
  if (body.bookingWindowDays !== undefined) updates.estimate_booking_window_days = clampInt(body.bookingWindowDays, DEFAULTS.bookingWindowDays, 1, 90)
  if (body.bookingSlotMinutes !== undefined) updates.estimate_booking_slot_minutes = clampInt(body.bookingSlotMinutes, DEFAULTS.bookingSlotMinutes, 15, 480)
  if (body.bookingDayStart !== undefined) {
    if (!HHMM.test(String(body.bookingDayStart))) throw new Error('Opening time must be HH:MM')
    updates.estimate_booking_day_start = body.bookingDayStart
  }
  if (body.bookingDayEnd !== undefined) {
    if (!HHMM.test(String(body.bookingDayEnd))) throw new Error('Closing time must be HH:MM')
    updates.estimate_booking_day_end = body.bookingDayEnd
  }
  if (body.bookingCourtesyCar !== undefined) updates.estimate_booking_courtesy_car = body.bookingCourtesyCar === true

  return updates
}
