/**
 * Zernio API client — the Social Media Analytics buy-layer (docs.zernio.com).
 *
 * v1 is DATA/ANALYTICS ONLY and READ-ONLY against Zernio (plus the connect flow
 * to link a dealership's accounts). We never hold platform OAuth tokens — Zernio
 * holds those and its own Meta/TikTok app approvals. We hold a Zernio API key
 * (env-first, or a per-org scoped read-only key stored encrypted).
 *
 * Auth: `Authorization: Bearer <ZERNIO_API_KEY>`. Base URL is configurable so we
 * can pin whatever the live API confirms (the Z0 smoke test verifies the exact
 * base + endpoint paths; see scratchpad/zernio-smoke.mjs and GMS/SOCIAL_MEDIA.md §2.5).
 *
 * NOTE: endpoint paths and response field names below reflect the documented API
 * and MUST be reconciled with the Z0 smoke-test output before the sync normaliser
 * is trusted in production. Anything marked "// CONFIRM Z0" is provisional.
 */

import { supabaseAdmin } from './supabase.js'
import { decrypt } from './encryption.js'

export const ZERNIO_BASE_URL = (process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1').replace(/\/$/, '')

export class ZernioError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message)
    this.name = 'ZernioError'
  }
}

export interface ZernioRateSnapshot {
  limit: string | null
  remaining: string | null
  reset: string | null
}

/** Resolve the Zernio API key for an org: env-first, then the encrypted per-org scoped key. */
export async function getZernioKeyForOrg(organizationId: string): Promise<string | null> {
  const envKey = process.env.ZERNIO_API_KEY
  if (envKey) return envKey.trim()

  const { data } = await supabaseAdmin
    .from('social_connections')
    .select('zernio_api_key_encrypted')
    .eq('organization_id', organizationId)
    .maybeSingle()

  const enc = (data as { zernio_api_key_encrypted?: string } | null)?.zernio_api_key_encrypted
  if (!enc) return null
  try {
    return decrypt(enc)
  } catch {
    return null
  }
}

interface ZernioRequestOpts {
  key: string
  method?: string
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
}

/** Low-level Zernio request. Returns parsed JSON; throws ZernioError on non-2xx. */
export async function zernioRequest<T = unknown>(
  path: string,
  opts: ZernioRequestOpts
): Promise<{ data: T; rate: ZernioRateSnapshot }> {
  const url = new URL(ZERNIO_BASE_URL + (path.startsWith('/') ? path : `/${path}`))
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${opts.key}`,
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  const rate: ZernioRateSnapshot = {
    limit: res.headers.get('x-ratelimit-limit'),
    remaining: res.headers.get('x-ratelimit-remaining'),
    reset: res.headers.get('x-ratelimit-reset'),
  }

  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }

  if (!res.ok) {
    let msg = `Zernio ${res.status}`
    if (json && typeof json === 'object' && 'error' in json) {
      msg = String((json as { error: unknown }).error)
    }
    throw new ZernioError(res.status, msg, json)
  }

  return { data: json as T, rate }
}

// ---------------------------------------------------------------------------
// Typed wrappers (provisional shapes — CONFIRM Z0). Each returns raw JSON; the
// sync normaliser maps fields into our tables.
// ---------------------------------------------------------------------------

export const zernio = {
  listProfiles: (key: string) => zernioRequest('/profiles', { key }),

  createProfile: (key: string, body: { name: string; description?: string; color?: string }) =>
    zernioRequest('/profiles', { key, method: 'POST', body }),

  updateProfile: (key: string, profileId: string, body: { name?: string; description?: string; color?: string }) =>
    zernioRequest(`/profiles/${profileId}`, { key, method: 'PUT', body }),

  deleteProfile: (key: string, profileId: string) =>
    zernioRequest(`/profiles/${profileId}`, { key, method: 'DELETE' }),

  /** Start the per-tenant OAuth connect; returns a hosted authUrl (+ state). */
  getConnectUrl: (
    key: string,
    platform: string,
    query: { profileId: string; redirect_url?: string; headless?: boolean }
  ) => zernioRequest(`/connect/${platform}`, { key, query }),

  listAccounts: (key: string, query: { profileId?: string; platform?: string; status?: string }) =>
    zernioRequest('/accounts', { key, query }),

  accountsHealth: (key: string, query: { profileId?: string }) =>
    zernioRequest('/accounts/health', { key, query }),

  followerStats: (
    key: string,
    query: { profileId?: string; accountIds?: string; fromDate?: string; toDate?: string; granularity?: string }
  ) => zernioRequest('/accounts/follower-stats', { key, query }),

  dailyMetrics: (
    key: string,
    query: { profileId?: string; accountId?: string; platform?: string; fromDate?: string; toDate?: string }
  ) => zernioRequest('/analytics/daily-metrics', { key, query }),

  analytics: (
    key: string,
    query: { profileId?: string; accountId?: string; platform?: string; fromDate?: string; toDate?: string; limit?: number; page?: number }
  ) => zernioRequest('/analytics', { key, query }),

  adsTimeline: (
    key: string,
    query: { profileId?: string; accountId?: string; adAccountId?: string; platform?: string; fromDate?: string; toDate?: string }
  ) => zernioRequest('/ads/timeline', { key, query }),

  /** Per-account, account-level insights. `path` = 'facebook/page-insights' | 'instagram/account-insights' | 'tiktok/account-insights'. */
  accountInsights: (
    key: string,
    path: string,
    query: { accountId: string; since?: string; until?: string; metricType?: string; metrics?: string }
  ) => zernioRequest(`/analytics/${path}`, { key, query }),

  /** All Facebook Pages an account can access (id, name, fan_count) + the active one. */
  facebookPages: (key: string, accountId: string) =>
    zernioRequest(`/accounts/${accountId}/facebook-page`, { key }),
}
