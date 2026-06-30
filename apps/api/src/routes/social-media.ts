/**
 * Social Media Analytics routes (Zernio buy-layer). v1 = data/analytics only.
 *
 * Each dealership (organization) links its own FB / IG / TikTok (organic + ads)
 * through Zernio. We hold a Zernio API key (env-first) + a per-org Zernio profile
 * id; Zernio holds the platform tokens and its own Meta/TikTok app approvals.
 *
 * Connection lifecycle + manual sync require org_admin+; the overview report is
 * readable by service_advisor+. The whole group is gated by the social_media
 * module. See GMS/SOCIAL_MEDIA.md §2.5 / §4.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorizeMinRole, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { getZernioKeyForOrg, zernio, ZernioError } from '../lib/zernio.js'
import {
  queueSocialMediaSync,
  scheduleSocialMediaSync,
  cancelSocialMediaSyncSchedule,
} from '../services/queue.js'

const socialMedia = new Hono()

socialMedia.use('*', authMiddleware)
socialMedia.use('*', requireModule('social_media'))

const PLATFORMS = ['facebook', 'instagram', 'tiktok'] as const

// ---------------------------------------------------------------------------
// Connection — status, init, settings, disconnect
// ---------------------------------------------------------------------------

/** GET /connection — connection status + linked accounts (no secrets). */
socialMedia.get('/connection', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  const auth = c.get('auth')
  const [{ data: conn }, { data: accounts }] = await Promise.all([
    supabaseAdmin.from('social_connections').select('*').eq('organization_id', auth.orgId).maybeSingle(),
    supabaseAdmin
      .from('social_accounts')
      .select('id, platform, account_type, display_name, handle, avatar_url, currency, status, is_active, token_expires_at')
      .eq('organization_id', auth.orgId)
      .order('platform'),
  ])

  const envKeyPresent = !!process.env.ZERNIO_API_KEY
  const keyConfigured = envKeyPresent || !!(conn as any)?.zernio_api_key_encrypted

  return c.json({
    connection: conn
      ? {
          status: (conn as any).status,
          profileLinked: !!(conn as any).zernio_profile_id,
          keyConfigured,
          syncHour: (conn as any).sync_hour,
          syncMinute: (conn as any).sync_minute,
          lastSyncedAt: (conn as any).last_synced_at,
          lastError: (conn as any).last_error,
        }
      : { status: 'not_configured', profileLinked: false, keyConfigured, syncHour: 2, syncMinute: 0, lastSyncedAt: null, lastError: null },
    accounts: accounts || [],
    platforms: PLATFORMS,
  })
})

/**
 * POST /connection/init — provision the org's Zernio profile (idempotent).
 * Requires a Zernio API key (env ZERNIO_API_KEY for v1).
 */
socialMedia.post('/connection/init', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const key = await getZernioKeyForOrg(auth.orgId)
  if (!key) return c.json({ error: 'Zernio API key not configured (set ZERNIO_API_KEY).', code: 'ZERNIO_NOT_CONFIGURED' }, 400)

  const { data: existing } = await supabaseAdmin
    .from('social_connections').select('id, zernio_profile_id').eq('organization_id', auth.orgId).maybeSingle()

  let profileId = (existing as any)?.zernio_profile_id as string | undefined

  if (!profileId) {
    // fetch org name for the profile label
    const { data: org } = await supabaseAdmin.from('organizations').select('name').eq('id', auth.orgId).maybeSingle()
    try {
      const { data: created } = await zernio.createProfile(key, { name: (org as any)?.name || `Org ${auth.orgId.slice(0, 8)}`, description: `VHC organization ${auth.orgId}` })
      profileId = (created as any)?._id || (created as any)?.id || (created as any)?.profile?._id
    } catch (e) {
      const msg = e instanceof ZernioError ? `Zernio ${e.status}: ${e.message}` : String(e)
      return c.json({ error: `Failed to create Zernio profile — ${msg}`, code: 'ZERNIO_PROFILE_FAILED' }, 502)
    }
  }

  const row = {
    organization_id: auth.orgId,
    zernio_profile_id: profileId,
    status: 'connected',
    created_by_user_id: auth.user.id,
    updated_at: new Date().toISOString(),
  }
  await supabaseAdmin.from('social_connections').upsert(row, { onConflict: 'organization_id' })

  // register the nightly schedule
  const { data: conn } = await supabaseAdmin.from('social_connections').select('sync_hour, sync_minute').eq('organization_id', auth.orgId).maybeSingle()
  try {
    await scheduleSocialMediaSync(auth.orgId, (conn as any)?.sync_hour ?? 2, (conn as any)?.sync_minute ?? 0)
  } catch { /* redis may be down in dev; ignore */ }

  return c.json({ status: 'connected', profileId })
})

/** PATCH /connection — update the nightly sync time. */
socialMedia.patch('/connection', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json().catch(() => ({}))
  const syncHour = Math.min(23, Math.max(0, parseInt(String(body.syncHour ?? 2), 10) || 0))
  const syncMinute = Math.min(59, Math.max(0, parseInt(String(body.syncMinute ?? 0), 10) || 0))

  await supabaseAdmin.from('social_connections')
    .update({ sync_hour: syncHour, sync_minute: syncMinute, updated_at: new Date().toISOString() })
    .eq('organization_id', auth.orgId)
  try { await scheduleSocialMediaSync(auth.orgId, syncHour, syncMinute) } catch { /* ignore */ }
  return c.json({ status: 'updated', syncHour, syncMinute })
})

/** DELETE /connection — disconnect on our side (disable sync; keep stored data). */
socialMedia.delete('/connection', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  await supabaseAdmin.from('social_connections')
    .update({ status: 'disabled', updated_at: new Date().toISOString() })
    .eq('organization_id', auth.orgId)
  try { await cancelSocialMediaSyncSchedule(auth.orgId) } catch { /* ignore */ }
  return c.json({ status: 'disabled' })
})

// ---------------------------------------------------------------------------
// Account linking (Zernio OAuth-as-a-service) + sync
// ---------------------------------------------------------------------------

/**
 * GET /connect/:platform/url?redirectUrl=... — returns the Zernio hosted
 * connect URL the dealership opens to authorize their own account.
 */
socialMedia.get('/connect/:platform/url', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const platform = c.req.param('platform')
  if (!PLATFORMS.includes(platform as any)) return c.json({ error: 'Unsupported platform' }, 400)

  const key = await getZernioKeyForOrg(auth.orgId)
  if (!key) return c.json({ error: 'Zernio API key not configured', code: 'ZERNIO_NOT_CONFIGURED' }, 400)

  const { data: conn } = await supabaseAdmin
    .from('social_connections').select('zernio_profile_id').eq('organization_id', auth.orgId).maybeSingle()
  const profileId = (conn as any)?.zernio_profile_id
  if (!profileId) return c.json({ error: 'Run connection init first', code: 'NO_PROFILE' }, 400)

  const redirectUrl = c.req.query('redirectUrl') || undefined
  try {
    const { data } = await zernio.getConnectUrl(key, platform, { profileId, redirect_url: redirectUrl })
    const authUrl = (data as any)?.authUrl || (data as any)?.url
    if (!authUrl) return c.json({ error: 'Zernio did not return an authUrl', raw: data }, 502)
    return c.json({ authUrl })
  } catch (e) {
    const msg = e instanceof ZernioError ? `Zernio ${e.status}: ${e.message}` : String(e)
    return c.json({ error: msg, code: 'ZERNIO_CONNECT_FAILED' }, 502)
  }
})

/** POST /sync — enqueue a manual sync now (also refreshes linked accounts). */
socialMedia.post('/sync', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const { data: conn } = await supabaseAdmin
    .from('social_connections').select('zernio_profile_id, status').eq('organization_id', auth.orgId).maybeSingle()
  if (!conn || !(conn as any).zernio_profile_id) return c.json({ error: 'No active connection', code: 'NOT_CONNECTED' }, 400)

  try {
    await queueSocialMediaSync({ type: 'social_media_sync', organizationId: auth.orgId, trigger: 'manual' })
    return c.json({ status: 'queued' })
  } catch {
    // Redis unavailable — run inline as a fallback so dev still works
    const { runSocialMediaSync } = await import('../jobs/social-media-sync.js')
    runSocialMediaSync({ type: 'social_media_sync', organizationId: auth.orgId, trigger: 'manual' }).catch(() => {})
    return c.json({ status: 'running_inline' })
  }
})

// ---------------------------------------------------------------------------
// Overview report — aggregated from our normalised tables
// ---------------------------------------------------------------------------

socialMedia.get('/overview', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  const auth = c.get('auth')
  const now = new Date()
  const dateTo = c.req.query('date_to') || now.toISOString().slice(0, 10)
  const dateFrom = c.req.query('date_from') || new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
  const platformFilter = c.req.query('platform')

  let accountsQ = supabaseAdmin
    .from('social_accounts')
    .select('id, platform, account_type, display_name, handle')
    .eq('organization_id', auth.orgId)
    .eq('is_active', true)
  if (platformFilter) accountsQ = accountsQ.eq('platform', platformFilter)
  const { data: accounts } = await accountsQ
  const accountById = new Map((accounts || []).map((a: any) => [a.id, a]))
  const accountIds = (accounts || []).map((a: any) => a.id)

  if (accountIds.length === 0) {
    return c.json({ period: { from: dateFrom, to: dateTo }, totals: emptyTotals(), platforms: [], series: [], accounts: [] })
  }

  const [{ data: metrics }, { data: spend }] = await Promise.all([
    supabaseAdmin
      .from('social_metrics_daily')
      .select('social_account_id, stat_date, metric, value')
      .eq('organization_id', auth.orgId)
      .in('social_account_id', accountIds)
      .gte('stat_date', dateFrom)
      .lte('stat_date', dateTo)
      .order('stat_date'),
    supabaseAdmin
      .from('social_ad_spend_daily')
      .select('social_account_id, stat_date, spend, impressions, clicks')
      .eq('organization_id', auth.orgId)
      .in('social_account_id', accountIds)
      .eq('level', 'account')
      .gte('stat_date', dateFrom)
      .lte('stat_date', dateTo)
      .order('stat_date'),
  ])

  // per-platform rollup
  const perPlatform = new Map<string, any>()
  const ensure = (p: string) => {
    if (!perPlatform.has(p)) perPlatform.set(p, { platform: p, followers: 0, followerGrowth: 0, reach: 0, views: 0, engagement: 0, spend: 0, impressions: 0, clicks: 0 })
    return perPlatform.get(p)
  }
  // followers: latest snapshot per account; growth = latest - earliest
  const followerFirst = new Map<string, number>()
  const followerLast = new Map<string, number>()
  const seriesByDate = new Map<string, { date: string; reach: number; views: number; spend: number }>()

  for (const m of (metrics || []) as any[]) {
    const acct = accountById.get(m.social_account_id)
    if (!acct) continue
    const p = ensure(acct.platform)
    const v = Number(m.value) || 0
    if (m.metric === 'followers_count') {
      if (!followerFirst.has(m.social_account_id)) followerFirst.set(m.social_account_id, v)
      followerLast.set(m.social_account_id, v)
    } else if (m.metric === 'reach') { p.reach += v; bumpSeries(seriesByDate, m.stat_date).reach += v }
    else if (m.metric === 'views') { p.views += v; bumpSeries(seriesByDate, m.stat_date).views += v }
    else if (['total_interactions', 'engagement', 'likes', 'comments', 'shares', 'saves'].includes(m.metric)) p.engagement += v
  }
  // resolve followers per account into platform totals
  for (const [acctId, last] of followerLast) {
    const acct = accountById.get(acctId)
    if (!acct) continue
    const p = ensure(acct.platform)
    p.followers += last
    p.followerGrowth += last - (followerFirst.get(acctId) ?? last)
  }
  for (const s of (spend || []) as any[]) {
    const acct = accountById.get(s.social_account_id)
    if (!acct) continue
    const p = ensure(acct.platform)
    p.spend += Number(s.spend) || 0
    p.impressions += Number(s.impressions) || 0
    p.clicks += Number(s.clicks) || 0
    bumpSeries(seriesByDate, s.stat_date).spend += Number(s.spend) || 0
  }

  const platforms = [...perPlatform.values()]
  const totals = platforms.reduce((t, p) => ({
    followers: t.followers + p.followers,
    followerGrowth: t.followerGrowth + p.followerGrowth,
    reach: t.reach + p.reach,
    views: t.views + p.views,
    engagement: t.engagement + p.engagement,
    spend: t.spend + p.spend,
    impressions: t.impressions + p.impressions,
    clicks: t.clicks + p.clicks,
  }), emptyTotals())

  const series = [...seriesByDate.values()].sort((a, b) => a.date.localeCompare(b.date))

  return c.json({ period: { from: dateFrom, to: dateTo }, totals, platforms, series, accounts: accounts || [] })
})

function emptyTotals() {
  return { followers: 0, followerGrowth: 0, reach: 0, views: 0, engagement: 0, spend: 0, impressions: 0, clicks: 0 }
}
function bumpSeries(map: Map<string, any>, date: string) {
  const d = String(date).slice(0, 10)
  if (!map.has(d)) map.set(d, { date: d, reach: 0, views: 0, spend: 0 })
  return map.get(d)
}

export default socialMedia
