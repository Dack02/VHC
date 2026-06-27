/**
 * Estimate settings — per-org configuration for the Estimates module: how long a sent
 * estimate's customer link stays live, whether stale estimates auto-expire, whether the
 * customer must sign to accept, and the terms & conditions shown on the portal.
 *
 * Stored as columns on organization_settings (20260626160000_estimates_send.sql),
 * matching the follow-up / check-in settings convention.
 */
import { supabaseAdmin } from '../lib/supabase.js'

export interface EstimateSettings {
  linkExpiryDays: number
  autoExpire: boolean
  requireSignature: boolean
  termsText: string | null
}

const DEFAULTS: EstimateSettings = {
  linkExpiryDays: 7,
  autoExpire: true,
  requireSignature: false,
  termsText: null
}

export async function getEstimateSettings(orgId: string): Promise<EstimateSettings> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('estimate_link_expiry_days, estimate_auto_expire, estimate_require_signature, estimate_terms_text')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!data) return { ...DEFAULTS }
  return {
    linkExpiryDays: data.estimate_link_expiry_days ?? DEFAULTS.linkExpiryDays,
    autoExpire: data.estimate_auto_expire ?? DEFAULTS.autoExpire,
    requireSignature: data.estimate_require_signature ?? DEFAULTS.requireSignature,
    termsText: data.estimate_terms_text ?? DEFAULTS.termsText
  }
}
