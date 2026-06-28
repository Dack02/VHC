/**
 * Estimate settings — per-org configuration for the Estimates module: how long a sent
 * estimate's customer link stays live, whether stale estimates auto-expire, whether the
 * customer must sign to accept, the terms & conditions shown on the portal, and the tenant's
 * selling points (USPs) shown as a trust strip on the customer estimate.
 *
 * Stored as columns on organization_settings (20260626160000_estimates_send.sql +
 * 20260627120000_estimate_usps.sql), matching the follow-up / check-in settings convention.
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
  onlineBookingEnabled: boolean
}

const DEFAULTS: EstimateSettings = {
  linkExpiryDays: 7,
  autoExpire: true,
  requireSignature: false,
  termsText: null,
  usps: [],
  onlineBookingEnabled: false
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

export async function getEstimateSettings(orgId: string): Promise<EstimateSettings> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('estimate_link_expiry_days, estimate_auto_expire, estimate_require_signature, estimate_terms_text, estimate_usps, estimate_online_booking_enabled')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!data) return { ...DEFAULTS }
  return {
    linkExpiryDays: data.estimate_link_expiry_days ?? DEFAULTS.linkExpiryDays,
    autoExpire: data.estimate_auto_expire ?? DEFAULTS.autoExpire,
    requireSignature: data.estimate_require_signature ?? DEFAULTS.requireSignature,
    termsText: data.estimate_terms_text ?? DEFAULTS.termsText,
    usps: normaliseUsps(data.estimate_usps),
    onlineBookingEnabled: data.estimate_online_booking_enabled ?? DEFAULTS.onlineBookingEnabled
  }
}
