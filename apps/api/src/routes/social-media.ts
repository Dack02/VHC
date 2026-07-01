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

// Stable display order for the per-platform trend lines.
const PLATFORM_ORDER = ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube', 'googlebusiness', 'twitter', 'pinterest', 'threads']
function orderPlatforms(ps: string[]): string[] {
  return [...ps].sort((a, b) => {
    const ia = PLATFORM_ORDER.indexOf(a); const ib = PLATFORM_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
}

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
/** GET /zernio-profiles — existing Zernio profiles, for the "use existing workspace" picker. */
socialMedia.get('/zernio-profiles', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const key = await getZernioKeyForOrg(auth.orgId)
  if (!key) return c.json({ error: 'Zernio API key not configured', code: 'ZERNIO_NOT_CONFIGURED' }, 400)
  try {
    const { data } = await zernio.listProfiles(key)
    const profiles = (Array.isArray((data as any)?.profiles) ? (data as any).profiles : []).map((p: any) => ({
      id: p._id,
      name: p.name,
      isDefault: !!p.isDefault,
      accountCount: Array.isArray(p.accountUsernames) ? p.accountUsernames.length : 0,
    }))
    return c.json({ profiles })
  } catch (e) {
    const msg = e instanceof ZernioError ? `Zernio ${e.status}: ${e.message}` : String(e)
    return c.json({ error: msg }, 502)
  }
})

socialMedia.post('/connection/init', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const key = await getZernioKeyForOrg(auth.orgId)
  if (!key) return c.json({ error: 'Zernio API key not configured (set ZERNIO_API_KEY).', code: 'ZERNIO_NOT_CONFIGURED' }, 400)

  const body = await c.req.json().catch(() => ({}))
  const bindProfileId = typeof body.profileId === 'string' && body.profileId ? body.profileId : null

  const { data: existing } = await supabaseAdmin
    .from('social_connections').select('id, zernio_profile_id').eq('organization_id', auth.orgId).maybeSingle()

  // Precedence: explicitly-chosen existing profile → already-bound profile → create new.
  let profileId = bindProfileId || ((existing as any)?.zernio_profile_id as string | undefined)

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
// Profiles — an org has many Zernio profiles (brands / per-page groupings)
// ---------------------------------------------------------------------------

/** GET /profiles — the org's profiles, each with its linked accounts (+ live follower counts). */
socialMedia.get('/profiles', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  const auth = c.get('auth')
  const [{ data: profiles }, { data: accounts }] = await Promise.all([
    supabaseAdmin.from('social_profiles')
      .select('id, name, color, is_default, status, last_synced_at')
      .eq('organization_id', auth.orgId)
      .order('is_default', { ascending: false }).order('created_at'),
    supabaseAdmin.from('social_accounts')
      .select('id, social_profile_id, platform, display_name, handle, avatar_url, status')
      .eq('organization_id', auth.orgId).eq('is_active', true),
  ])

  const accountIds = (accounts || []).map((a: any) => a.id)
  const followersByAccount = new Map<string, number>()
  if (accountIds.length) {
    const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
    const { data: fol } = await supabaseAdmin.from('social_metrics_daily')
      .select('social_account_id, value, stat_date')
      .eq('organization_id', auth.orgId).eq('metric', 'followers_count')
      .in('social_account_id', accountIds).gte('stat_date', since)
      .order('stat_date', { ascending: false })
    for (const r of (fol || []) as any[]) if (!followersByAccount.has(r.social_account_id)) followersByAccount.set(r.social_account_id, Number(r.value) || 0)
  }

  const byProfile = new Map<string, any[]>()
  for (const a of (accounts || []) as any[]) {
    if (!a.social_profile_id) continue
    if (!byProfile.has(a.social_profile_id)) byProfile.set(a.social_profile_id, [])
    byProfile.get(a.social_profile_id)!.push({
      id: a.id, platform: a.platform, displayName: a.display_name, handle: a.handle,
      avatarUrl: a.avatar_url, followers: followersByAccount.get(a.id) || 0, status: a.status,
    })
  }

  return c.json({
    profiles: (profiles || []).map((p: any) => ({
      id: p.id, name: p.name, color: p.color, isDefault: p.is_default,
      status: p.status, lastSyncedAt: p.last_synced_at,
      accountCount: (byProfile.get(p.id) || []).length,
      accounts: byProfile.get(p.id) || [],
    })),
  })
})

/** POST /profiles — create a Zernio profile + bind it to this org. */
socialMedia.post('/profiles', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const key = await getZernioKeyForOrg(auth.orgId)
  if (!key) return c.json({ error: 'Zernio API key not configured', code: 'ZERNIO_NOT_CONFIGURED' }, 400)
  const body = await c.req.json().catch(() => ({}))
  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim().slice(0, 80) : null
  if (!name) return c.json({ error: 'Name is required' }, 400)
  const color = typeof body.color === 'string' && body.color ? body.color.slice(0, 16) : null

  await supabaseAdmin.from('social_connections').upsert(
    { organization_id: auth.orgId, status: 'connected', updated_at: new Date().toISOString() },
    { onConflict: 'organization_id' }
  )

  let zpid: string | undefined
  try {
    const { data: created } = await zernio.createProfile(key, { name, color: color || undefined })
    zpid = (created as any)?._id || (created as any)?.id || (created as any)?.profile?._id
  } catch (e) {
    const msg = e instanceof ZernioError ? `Zernio ${e.status}: ${e.message}` : String(e)
    return c.json({ error: `Failed to create Zernio profile — ${msg}`, code: 'ZERNIO_PROFILE_FAILED' }, 502)
  }
  if (!zpid) return c.json({ error: 'Zernio did not return a profile id' }, 502)

  const { count } = await supabaseAdmin.from('social_profiles')
    .select('id', { count: 'exact', head: true }).eq('organization_id', auth.orgId)
  const isDefault = !count
  const { data: row } = await supabaseAdmin.from('social_profiles')
    .insert({ organization_id: auth.orgId, zernio_profile_id: zpid, name, color, is_default: isDefault, status: 'connected', created_by_user_id: auth.user.id })
    .select('id, name, color, is_default').single()

  try {
    const { data: conn } = await supabaseAdmin.from('social_connections').select('sync_hour, sync_minute').eq('organization_id', auth.orgId).maybeSingle()
    await scheduleSocialMediaSync(auth.orgId, (conn as any)?.sync_hour ?? 2, (conn as any)?.sync_minute ?? 0)
  } catch { /* redis may be down in dev */ }

  return c.json({ profile: { id: (row as any)?.id, name, color, isDefault } })
})

/** PATCH /profiles/:id — rename / recolour. */
socialMedia.patch('/profiles/:id', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim().slice(0, 80)
  if (typeof body.color === 'string') update.color = body.color.slice(0, 16)

  const { data: prof } = await supabaseAdmin.from('social_profiles')
    .select('zernio_profile_id').eq('id', id).eq('organization_id', auth.orgId).maybeSingle()
  if (!prof) return c.json({ error: 'Profile not found' }, 404)

  await supabaseAdmin.from('social_profiles').update(update).eq('id', id).eq('organization_id', auth.orgId)
  if (update.name) {
    const key = await getZernioKeyForOrg(auth.orgId)
    if (key) { try { await zernio.updateProfile(key, (prof as any).zernio_profile_id, { name: update.name as string }) } catch { /* non-fatal */ } }
  }
  return c.json({ status: 'updated' })
})

/** DELETE /profiles/:id — unbind on our side (accounts + metrics cascade). Leaves the Zernio profile intact. */
socialMedia.delete('/profiles/:id', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const id = c.req.param('id')
  const { data: prof } = await supabaseAdmin.from('social_profiles')
    .select('id').eq('id', id).eq('organization_id', auth.orgId).maybeSingle()
  if (!prof) return c.json({ error: 'Profile not found' }, 404)
  await supabaseAdmin.from('social_profiles').delete().eq('id', id).eq('organization_id', auth.orgId)
  return c.json({ status: 'deleted' })
})

/** GET /profiles/:id/connect/:platform/url — connect an account/page INTO this profile. */
socialMedia.get('/profiles/:id/connect/:platform/url', authorizeMinRole('org_admin'), async (c) => {
  const auth = c.get('auth')
  const id = c.req.param('id')
  const platform = c.req.param('platform')
  const ALLOWED = ['facebook', 'instagram', 'tiktok', 'linkedin', 'googlebusiness', 'youtube', 'twitter', 'pinterest', 'threads']
  if (!ALLOWED.includes(platform)) return c.json({ error: 'Unsupported platform' }, 400)
  const key = await getZernioKeyForOrg(auth.orgId)
  if (!key) return c.json({ error: 'Zernio API key not configured', code: 'ZERNIO_NOT_CONFIGURED' }, 400)
  const { data: prof } = await supabaseAdmin.from('social_profiles')
    .select('zernio_profile_id').eq('id', id).eq('organization_id', auth.orgId).maybeSingle()
  if (!prof) return c.json({ error: 'Profile not found' }, 404)

  const redirectUrl = c.req.query('redirectUrl') || undefined
  try {
    const { data } = await zernio.getConnectUrl(key, platform, { profileId: (prof as any).zernio_profile_id, redirect_url: redirectUrl })
    const authUrl = (data as any)?.authUrl || (data as any)?.url
    if (!authUrl) return c.json({ error: 'Zernio did not return an authUrl', raw: data }, 502)
    return c.json({ authUrl })
  } catch (e) {
    const msg = e instanceof ZernioError ? `Zernio ${e.status}: ${e.message}` : String(e)
    return c.json({ error: msg, code: 'ZERNIO_CONNECT_FAILED' }, 502)
  }
})

// ---------------------------------------------------------------------------
// Overview report — aggregated from our normalised tables
// ---------------------------------------------------------------------------

socialMedia.get('/overview', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  const auth = c.get('auth')
  const now = new Date()
  const dateTo = (c.req.query('date_to') || now.toISOString().slice(0, 10)).slice(0, 10)
  const dateFrom = (c.req.query('date_from') || new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)).slice(0, 10)
  const gbRaw = c.req.query('group_by')
  const groupBy = (gbRaw === 'week' || gbRaw === 'month' ? gbRaw : 'day') as 'day' | 'week' | 'month'
  const platformFilter = c.req.query('platform')
  const profileFilter = c.req.query('profileId')

  let accountsQ = supabaseAdmin
    .from('social_accounts')
    .select('id, platform, account_type, display_name, handle, social_profile_id')
    .eq('organization_id', auth.orgId)
    .eq('is_active', true)
  if (platformFilter) accountsQ = accountsQ.eq('platform', platformFilter)
  if (profileFilter && profileFilter !== 'all') accountsQ = accountsQ.eq('social_profile_id', profileFilter)
  const { data: accounts } = await accountsQ
  const { data: orgProfiles } = await supabaseAdmin.from('social_profiles').select('id, name, color, is_default').eq('organization_id', auth.orgId)
  const profileById = new Map((orgProfiles || []).map((p: any) => [p.id, p]))
  const accountById = new Map((accounts || []).map((a: any) => [a.id, a]))
  const accountIds = (accounts || []).map((a: any) => a.id)

  if (accountIds.length === 0) {
    return c.json({ period: { from: dateFrom, to: dateTo }, groupBy, totals: emptyTotals(), platforms: [], accountsBreakdown: [], profilesBreakdown: [], selectedProfileId: profileFilter || 'all', periods: [], chart: { platforms: [], followers: [], posts: [], views: [], engagement: [] }, recent: null, accounts: [] })
  }

  // Daily snapshots over a long window (12m / all-time) can exceed PostgREST's
  // 1000-row cap, which would silently truncate older dates off the chart.
  // Page through each fetch so the series stay complete regardless of range.
  const paginate = async <T,>(makeQuery: () => any): Promise<T[]> => {
    const pageSize = 1000
    let offset = 0
    const all: T[] = []
    for (;;) {
      const { data, error } = await makeQuery().range(offset, offset + pageSize - 1)
      if (error) throw error
      const batch = (data || []) as T[]
      all.push(...batch)
      if (batch.length < pageSize) break
      offset += pageSize
    }
    return all
  }

  const [metrics, spend, postsRaw] = await Promise.all([
    paginate<any>(() => supabaseAdmin
      .from('social_metrics_daily')
      .select('social_account_id, stat_date, metric, value')
      .eq('organization_id', auth.orgId)
      .in('social_account_id', accountIds)
      .gte('stat_date', dateFrom)
      .lte('stat_date', dateTo)
      .order('stat_date').order('social_account_id').order('metric')),
    paginate<any>(() => supabaseAdmin
      .from('social_ad_spend_daily')
      .select('social_account_id, stat_date, spend, impressions, clicks')
      .eq('organization_id', auth.orgId)
      .in('social_account_id', accountIds)
      .eq('level', 'account')
      .gte('stat_date', dateFrom)
      .lte('stat_date', dateTo)
      .order('stat_date').order('social_account_id')),
    paginate<any>(() => supabaseAdmin
      .from('social_posts')
      .select('social_account_id, posted_at')
      .eq('organization_id', auth.orgId)
      .in('social_account_id', accountIds)
      .gte('posted_at', dateFrom)
      .lte('posted_at', `${dateTo}T23:59:59.999Z`)
      .order('posted_at')),
  ])

  const ENGAGEMENT_METRICS = ['total_interactions', 'engagement', 'likes', 'comments', 'shares', 'saves']

  // ---- per-platform rollup (powers the "By platform" table) ----
  const perPlatform = new Map<string, any>()
  const ensure = (p: string) => {
    if (!perPlatform.has(p)) perPlatform.set(p, { platform: p, followers: 0, followerGrowth: 0, reach: 0, views: 0, engagement: 0, spend: 0, impressions: 0, clicks: 0 })
    return perPlatform.get(p)
  }
  const followerFirst = new Map<string, number>()
  const followerLast = new Map<string, number>()

  // ---- per-account (per-page) breakdown ----
  const perAccount = new Map<string, any>()
  const ensureAcct = (id: string) => {
    if (!perAccount.has(id)) {
      const a = accountById.get(id)
      perAccount.set(id, {
        id, platform: a?.platform || 'unknown',
        name: a?.display_name || a?.handle || a?.platform || 'Account',
        handle: a?.handle || null, accountType: a?.account_type || 'organic',
        followers: 0, followerGrowth: 0, reach: 0, views: 0, engagement: 0, spend: 0,
      })
    }
    return perAccount.get(id)
  }

  // ---- per-profile breakdown (powers the "By profile" cards / deep dive) ----
  const perProfile = new Map<string, any>()
  const ensureProf = (acct: any) => {
    const pid = acct?.social_profile_id || '__none__'
    if (!perProfile.has(pid)) {
      const pr = profileById.get(pid)
      perProfile.set(pid, {
        id: pid, name: pr?.name || (pid === '__none__' ? 'Unassigned' : 'Profile'),
        color: pr?.color || null, isDefault: !!pr?.is_default,
        followers: 0, followerGrowth: 0, reach: 0, views: 0, engagement: 0, spend: 0, accountCount: 0,
      })
    }
    return perProfile.get(pid)
  }
  // seed every profile that has an active account (so empty-but-connected profiles still show)
  for (const a of (accounts || []) as any[]) ensureProf(a).accountCount++

  // ---- period buckets (powers the day/week/month "Over time" table) ----
  const periodAgg = new Map<string, { reach: number; views: number; engagement: number; spend: number }>()
  const ensurePeriod = (key: string) => {
    if (!periodAgg.has(key)) periodAgg.set(key, { reach: 0, views: 0, engagement: 0, spend: 0 })
    return periodAgg.get(key)!
  }
  const followerSnaps = new Map<string, { date: string; value: number }[]>()  // accountId -> stat_date-asc series

  // ---- per-platform × per-period buckets (powers the per-platform trend lines) ----
  const platPeriod = new Map<string, Map<string, { views: number; engagement: number }>>()
  const ensurePlatPeriod = (platform: string, key: string) => {
    if (!platPeriod.has(platform)) platPeriod.set(platform, new Map())
    const mp = platPeriod.get(platform)!
    if (!mp.has(key)) mp.set(key, { views: 0, engagement: 0 })
    return mp.get(key)!
  }

  for (const m of (metrics || []) as any[]) {
    const acct = accountById.get(m.social_account_id)
    if (!acct) continue
    const v = Number(m.value) || 0
    const day = String(m.stat_date).slice(0, 10)
    const pk = periodKeyForDay(day, groupBy)
    const p = ensure(acct.platform)
    if (m.metric === 'followers_count') {
      if (!followerFirst.has(m.social_account_id)) followerFirst.set(m.social_account_id, v)
      followerLast.set(m.social_account_id, v)
      if (!followerSnaps.has(m.social_account_id)) followerSnaps.set(m.social_account_id, [])
      followerSnaps.get(m.social_account_id)!.push({ date: day, value: v })
      ensurePeriod(pk)  // register the period so follower-only days still get a row
    } else if (m.metric === 'reach') { p.reach += v; ensureAcct(m.social_account_id).reach += v; ensureProf(acct).reach += v; ensurePeriod(pk).reach += v }
    else if (m.metric === 'views') { p.views += v; ensureAcct(m.social_account_id).views += v; ensureProf(acct).views += v; ensurePeriod(pk).views += v; ensurePlatPeriod(acct.platform, pk).views += v }
    else if (ENGAGEMENT_METRICS.includes(m.metric)) { p.engagement += v; ensureAcct(m.social_account_id).engagement += v; ensureProf(acct).engagement += v; ensurePeriod(pk).engagement += v; ensurePlatPeriod(acct.platform, pk).engagement += v }
  }
  // resolve followers per account into platform totals
  for (const [acctId, last] of followerLast) {
    const acct = accountById.get(acctId)
    if (!acct) continue
    const p = ensure(acct.platform)
    p.followers += last
    p.followerGrowth += last - (followerFirst.get(acctId) ?? last)
    const a = ensureAcct(acctId)
    a.followers += last
    a.followerGrowth += last - (followerFirst.get(acctId) ?? last)
    const pr = ensureProf(acct)
    pr.followers += last
    pr.followerGrowth += last - (followerFirst.get(acctId) ?? last)
  }
  for (const s of (spend || []) as any[]) {
    const acct = accountById.get(s.social_account_id)
    if (!acct) continue
    const p = ensure(acct.platform)
    const sp = Number(s.spend) || 0
    p.spend += sp
    p.impressions += Number(s.impressions) || 0
    p.clicks += Number(s.clicks) || 0
    ensureAcct(s.social_account_id).spend += sp
    ensureProf(acct).spend += sp
    ensurePeriod(periodKeyForDay(String(s.stat_date).slice(0, 10), groupBy)).spend += sp
  }

  // ---- posts published per platform per period (from the post catalogue) ----
  const postPlatPeriod = new Map<string, Map<string, number>>()
  const postPeriodTotal = new Map<string, number>()
  for (const pr of (postsRaw || []) as any[]) {
    const acct = accountById.get(pr.social_account_id)
    if (!acct || !pr.posted_at) continue
    const pk = periodKeyForDay(String(pr.posted_at).slice(0, 10), groupBy)
    if (!postPlatPeriod.has(acct.platform)) postPlatPeriod.set(acct.platform, new Map())
    const mp = postPlatPeriod.get(acct.platform)!
    mp.set(pk, (mp.get(pk) || 0) + 1)
    postPeriodTotal.set(pk, (postPeriodTotal.get(pk) || 0) + 1)
    ensurePeriod(pk)  // register periods that only have posting activity
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

  // ---- assemble period rows: followers = total at the END of the period
  //      (latest snapshot per account on/before the period's last day), with
  //      growth = period-over-period delta. reach/views/engagement/spend summed. ----
  const followersAtEnd = (endDay: string) => {
    let sum = 0
    for (const series of followerSnaps.values()) {
      let val: number | null = null
      for (const pt of series) { if (pt.date <= endDay) val = pt.value; else break }
      if (val != null) sum += val
    }
    return sum
  }
  const periodKeys = [...periodAgg.keys()].sort((a, b) => a.localeCompare(b))
  let prevFollowers: number | null = null
  const periods = periodKeys.map((key) => {
    const agg = periodAgg.get(key)!
    const followers = followersAtEnd(periodEndDay(key, groupBy))
    const followerGrowth = prevFollowers == null ? 0 : followers - prevFollowers
    prevFollowers = followers
    return { period: key, followers, followerGrowth, reach: agg.reach, views: agg.views, engagement: agg.engagement, spend: agg.spend, posts: postPeriodTotal.get(key) || 0 }
  })

  const accountsBreakdown = [...perAccount.values()].sort((a, b) => b.followers - a.followers)
  const profilesBreakdown = [...perProfile.values()].filter((p) => profileById.has(p.id)).sort((a, b) => b.followers - a.followers)

  // ---- per-platform time-series for the trend charts (one line per platform) ----
  const platformsOrder = orderPlatforms([...perPlatform.keys()])
  const followerAtEndForPlatform = (platform: string, endDay: string): number | null => {
    let sum = 0; let any = false
    for (const [acctId, series] of followerSnaps) {
      const acct = accountById.get(acctId)
      if (!acct || acct.platform !== platform) continue
      let val: number | null = null
      for (const pt of series) { if (pt.date <= endDay) val = pt.value; else break }
      if (val != null) { sum += val; any = true }
    }
    return any ? sum : null
  }
  const seriesFor = (getter: (platform: string, key: string) => number | null) =>
    periodKeys.map((key) => {
      const row: Record<string, string | number | null> = { period: key }
      for (const pl of platformsOrder) row[pl] = getter(pl, key)
      return row
    })
  const chart = {
    platforms: platformsOrder,
    followers: seriesFor((pl, key) => followerAtEndForPlatform(pl, periodEndDay(key, groupBy))),
    posts: seriesFor((pl, key) => postPlatPeriod.get(pl)?.get(key) ?? 0),
    views: seriesFor((pl, key) => platPeriod.get(pl)?.get(key)?.views ?? 0),
    engagement: seriesFor((pl, key) => platPeriod.get(pl)?.get(key)?.engagement ?? 0),
  }

  // ---- recent vs prior averages (frames "is it accelerating", no fixed anchor) ----
  const n = periods.length
  const k = Math.min(4, Math.floor(n / 2))
  const mean = (a: typeof periods, f: (x: typeof periods[number]) => number) => a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0
  const r1 = (x: number) => Math.round(x * 10) / 10
  const recentWin = k > 0 ? periods.slice(n - k) : []
  const priorWin = k > 0 ? periods.slice(n - 2 * k, n - k) : []
  const delta = (f: (x: typeof periods[number]) => number) => ({ recent: r1(mean(recentWin, f)), prior: r1(mean(priorWin, f)) })
  const recent = k > 0 ? {
    window: k, unit: groupBy,
    followerGrowth: delta((x) => x.followerGrowth),
    posts: delta((x) => x.posts),
    views: delta((x) => x.views),
    engagement: delta((x) => x.engagement),
  } : null

  return c.json({ period: { from: dateFrom, to: dateTo }, groupBy, totals, platforms, accountsBreakdown, profilesBreakdown, selectedProfileId: profileFilter || 'all', periods, chart, recent, accounts: accounts || [] })
})

function emptyTotals() {
  return { followers: 0, followerGrowth: 0, reach: 0, views: 0, engagement: 0, spend: 0, impressions: 0, clicks: 0 }
}

/** Day → period bucket key (matches the reports' convention in routes/reports.ts). */
function periodKeyForDay(dayKey: string, groupBy: 'day' | 'week' | 'month'): string {
  if (groupBy === 'month') return `${dayKey.slice(0, 7)}-01`
  if (groupBy === 'week') {
    const d = new Date(`${dayKey}T00:00:00Z`)
    const dow = d.getUTCDay() // 0=Sun..6=Sat
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)) // back to Monday
    return d.toISOString().split('T')[0]
  }
  return dayKey
}

/** Last calendar day of a period bucket (inclusive), for end-of-period followers. */
function periodEndDay(key: string, groupBy: 'day' | 'week' | 'month'): string {
  if (groupBy === 'month') {
    const y = Number(key.slice(0, 4)); const mo = Number(key.slice(5, 7))
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) // day 0 of next month = last day
  }
  if (groupBy === 'week') {
    const d = new Date(`${key}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 6) // Monday + 6 = Sunday
    return d.toISOString().slice(0, 10)
  }
  return key
}

export default socialMedia
