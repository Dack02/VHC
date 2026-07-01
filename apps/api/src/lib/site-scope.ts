import { supabaseAdmin } from './supabase.js'
import type { AuthContext } from '../middleware/auth.js'

/**
 * Per-site customer/vehicle separation — see GMS/GROUPS_AND_SITES.md §4.2.
 *
 * A tenant either SHARES its customer/vehicle book across all sites (default) or
 * keeps each site SEPARATED. The mode is the per-org flag
 * `organization_settings.share_customers_across_sites`.
 *
 * SAFETY: separation is only honoured when the flag is *explicitly* false. A
 * missing settings row, NULL, or true all resolve to 'shared' — so a lazily
 * created settings row can never silently hide an org's own records.
 */
export type ScopeMode = 'shared' | 'separated'

export async function getCustomerScopeMode(orgId: string): Promise<ScopeMode> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('share_customers_across_sites')
    .eq('organization_id', orgId)
    .maybeSingle()
  return data?.share_customers_across_sites === false ? 'separated' : 'shared'
}

/**
 * The site_id to confine customer/vehicle reads to, or null for org-wide.
 *
 * Returns the actor's site ONLY when the org is separated AND the actor is a
 * site-bound user. Org/site-admins with no `site_id` (auth.user.siteId === null)
 * read org-wide even under separation — intended oversight (§4.2 rule 1).
 */
export function scopedSiteId(auth: AuthContext, mode: ScopeMode): string | null {
  return mode === 'separated' && auth.user.siteId ? auth.user.siteId : null
}

/**
 * Convenience: resolve the scope mode and the site filter in one call.
 * Apply the returned `siteId` inline to a query when non-null, e.g.
 *   let q = supabaseAdmin.from('customers').select('*').eq('organization_id', auth.orgId)
 *   if (scope.siteId) q = q.eq('site_id', scope.siteId)
 * (Inline rather than a generic wrapper — PostgREST builder types are too deep
 *  for a generic helper, which trips TS2589.)
 */
export async function resolveCustomerScope(auth: AuthContext): Promise<{ mode: ScopeMode; siteId: string | null }> {
  const mode = await getCustomerScopeMode(auth.orgId)
  return { mode, siteId: scopedSiteId(auth, mode) }
}
