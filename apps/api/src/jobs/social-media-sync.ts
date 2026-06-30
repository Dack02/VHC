/**
 * Social Media nightly sync (Zernio buy-layer).
 *
 * Per organization: pull organic insights (follower growth, daily account
 * metrics, post metrics) and ad-spend timelines from Zernio for the trailing
 * window and normalise them into our tables. Idempotent: for the long-format
 * time-series tables we delete the pulled window per account, then insert.
 *
 * Field mappings marked "CONFIRM Z0" are provisional (the Zernio docs were
 * partly JS-rendered). The extractors below try several candidate field names
 * so the sync is resilient; reconcile with scratchpad/zernio-smoke.mjs output
 * and tighten before relying on production figures. See GMS/SOCIAL_MEDIA.md §2.5.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { getZernioKeyForOrg, zernio, ZernioError } from '../lib/zernio.js'
import type { SocialMediaSyncJob } from '../services/queue.js'

const WINDOW_DAYS = 30

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Find the first array payload in a Zernio response (shapes vary by endpoint). */
function asArray(json: unknown, ...keys: string[]): any[] {
  if (Array.isArray(json)) return json
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    for (const k of [...keys, 'data', 'results', 'items']) {
      if (Array.isArray(obj[k])) return obj[k] as any[]
    }
  }
  return []
}

function pick<T = unknown>(o: any, ...keys: string[]): T | undefined {
  if (!o || typeof o !== 'object') return undefined
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k] as T
  return undefined
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

interface MetricRow {
  stat_date: string
  metric: string
  value: number
  breakdown?: Record<string, unknown>
}

interface AdRow {
  stat_date: string
  level: string
  external_campaign_id: string
  campaign_name: string | null
  spend: number
  impressions: number
  reach: number
  clicks: number
  cpc: number | null
  cpm: number | null
  ctr: number | null
  conversions: number | null
  roas: number | null
  actions: unknown
  currency: string | null
}

// --- Normalisers (CONFIRM Z0) ------------------------------------------------

/** Zernio follower-stats → daily followers_count metric rows. */
function normalizeFollowerStats(json: unknown): MetricRow[] {
  // Shapes seen in docs: { stats: [{ date, followers }] } or metrics{ follower_count: { values: [{date, value}] } }
  const stats = asArray(json, 'stats', 'values', 'history')
  if (stats.length) {
    return stats
      .map((p) => {
        const date = pick<string>(p, 'date', 'stat_date', 'day')
        const value = num(pick(p, 'followers', 'follower_count', 'value', 'count'))
        return date ? { stat_date: String(date).slice(0, 10), metric: 'followers_count', value } : null
      })
      .filter(Boolean) as MetricRow[]
  }
  // nested metrics{ follower_count: { values: [...] } }
  const metrics = pick<Record<string, any>>(json, 'metrics')
  const fc = metrics?.follower_count?.values || metrics?.followers?.values
  if (Array.isArray(fc)) {
    return fc
      .map((p: any) => {
        const date = pick<string>(p, 'date', 'day')
        return date ? { stat_date: String(date).slice(0, 10), metric: 'followers_count', value: num(pick(p, 'value', 'followers')) } : null
      })
      .filter(Boolean) as MetricRow[]
  }
  return []
}

/** Zernio daily-metrics → per-day organic metric rows (reach/views/engagement/etc.). */
function normalizeDailyMetrics(json: unknown): MetricRow[] {
  const days = asArray(json, 'days', 'metrics', 'daily')
  const out: MetricRow[] = []
  const ORGANIC_KEYS = ['impressions', 'reach', 'views', 'likes', 'comments', 'shares', 'saves', 'clicks', 'engagement', 'total_interactions']
  for (const d of days) {
    const date = pick<string>(d, 'date', 'stat_date', 'day')
    if (!date) continue
    const sd = String(date).slice(0, 10)
    for (const k of ORGANIC_KEYS) {
      if (d[k] !== undefined && d[k] !== null) out.push({ stat_date: sd, metric: k, value: num(d[k]) })
    }
  }
  return out
}

/** Zernio analytics (post list) → social_posts upsert rows. */
function normalizePosts(json: unknown, orgId: string, accountId: string): any[] {
  const posts = asArray(json, 'posts', 'analytics', 'platformAnalytics')
  return posts
    .map((p) => {
      const ext = pick<string>(p, 'postId', 'id', '_id', 'externalId')
      if (!ext) return null
      const m = {
        reach: num(pick(p, 'reach')),
        views: num(pick(p, 'views')),
        likes: num(pick(p, 'likes')),
        comments: num(pick(p, 'comments')),
        shares: num(pick(p, 'shares')),
        saves: num(pick(p, 'saves')),
        impressions: num(pick(p, 'impressions')),
        total_interactions: num(pick(p, 'total_interactions', 'engagement')),
        engagementRate: num(pick(p, 'engagementRate')),
      }
      const posted = pick<string>(p, 'postedAt', 'posted_at', 'createdAt', 'create_time', 'date')
      return {
        organization_id: orgId,
        social_account_id: accountId,
        external_post_id: String(ext),
        post_type: pick<string>(p, 'type', 'postType', 'mediaType') ?? null,
        permalink: pick<string>(p, 'permalink', 'url', 'platformUrl') ?? null,
        caption: pick<string>(p, 'caption', 'text', 'message') ?? null,
        thumbnail_url: pick<string>(p, 'thumbnailUrl', 'thumbnail', 'coverImageUrl') ?? null,
        posted_at: posted ? new Date(posted).toISOString() : null,
        metrics: m,
        metrics_fetched_at: new Date().toISOString(),
      }
    })
    .filter(Boolean) as any[]
}

/** Zernio ads/timeline → daily ad-spend rows. */
function normalizeAdsTimeline(json: unknown): AdRow[] {
  const rows = asArray(json, 'timeline', 'rows', 'days')
  return rows
    .map((r) => {
      const date = pick<string>(r, 'date', 'stat_date', 'day')
      if (!date) return null
      return {
        stat_date: String(date).slice(0, 10),
        level: 'account',
        external_campaign_id: '',
        campaign_name: null,
        spend: num(pick(r, 'spend')),
        impressions: num(pick(r, 'impressions')),
        reach: num(pick(r, 'reach')),
        clicks: num(pick(r, 'clicks')),
        cpc: r.cpc != null ? num(r.cpc) : null,
        cpm: r.cpm != null ? num(r.cpm) : null,
        ctr: r.ctr != null ? num(r.ctr) : null,
        conversions: r.conversions != null ? num(r.conversions) : null,
        roas: r.roas != null ? num(r.roas) : null,
        actions: pick(r, 'actions', 'actionValues') ?? null,
        currency: pick<string>(r, 'currency') ?? null,
      } as AdRow
    })
    .filter(Boolean) as AdRow[]
}

// --- Orchestration -----------------------------------------------------------

export async function runSocialMediaSync(job: SocialMediaSyncJob): Promise<void> {
  const { organizationId } = job
  const log = (m: string) => console.log(`[SocialMediaSync] org=${organizationId} ${m}`)

  const { data: conn } = await supabaseAdmin
    .from('social_connections')
    .select('zernio_profile_id, status')
    .eq('organization_id', organizationId)
    .maybeSingle()

  const profileId = (conn as { zernio_profile_id?: string } | null)?.zernio_profile_id
  if (!conn || !profileId || (conn as { status?: string }).status === 'disabled') {
    log('no active connection — skipping')
    return
  }

  const key = await getZernioKeyForOrg(organizationId)
  if (!key) {
    await supabaseAdmin.from('social_connections')
      .update({ last_error: 'No Zernio API key configured', status: 'error', updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
    log('no API key — aborting')
    return
  }

  const until = new Date()
  const since = new Date(until.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const fromDate = toISODate(since)
  const toDate = toISODate(until)

  const { data: runRow } = await supabaseAdmin
    .from('social_sync_runs')
    .insert({ organization_id: organizationId, platform: 'all', status: 'running' })
    .select('id')
    .single()
  const runId = (runRow as { id?: string } | null)?.id

  let rowsWritten = 0
  let hadError = false
  const errors: string[] = []

  try {
    // 1) Accounts → upsert social_accounts
    const { data: accountsJson } = await zernio.listAccounts(key, { profileId })
    const accounts = asArray(accountsJson, 'accounts')
    for (const a of accounts) {
      const zid = pick<string>(a, '_id', 'id', 'accountId')
      if (!zid) continue
      const platform = (pick<string>(a, 'platform', 'provider') ?? 'unknown').toLowerCase()
      const acctType = pick<string>(a, 'accountType', 'type')
      await supabaseAdmin.from('social_accounts').upsert(
        {
          organization_id: organizationId,
          zernio_account_id: String(zid),
          platform,
          account_type: acctType && /ads/i.test(acctType) ? acctType.toLowerCase() : 'organic',
          external_id: pick<string>(a, 'externalId', 'platformId', 'pageId', 'advertiserId') ?? null,
          display_name: pick<string>(a, 'name', 'displayName', 'username') ?? null,
          handle: pick<string>(a, 'username', 'handle') ?? null,
          avatar_url: pick<string>(a, 'avatarUrl', 'picture', 'avatar') ?? null,
          currency: pick<string>(a, 'currency') ?? null,
          status: pick<string>(a, 'status') ?? 'connected',
          token_expires_at: pick<string>(a, 'tokenExpiresAt') ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,zernio_account_id' }
      )
    }

    // Map our account ids
    const { data: ourAccounts } = await supabaseAdmin
      .from('social_accounts')
      .select('id, zernio_account_id, platform, account_type, is_active')
      .eq('organization_id', organizationId)
    const ourById = new Map<string, any>()
    for (const a of (ourAccounts || [])) ourById.set((a as any).zernio_account_id, a)

    // 2) Per account: pull + normalise + persist
    for (const [zid, acct] of ourById) {
      if (!acct.is_active) continue
      const accountDbId: string = acct.id
      const isAds = /ads/i.test(acct.account_type || '')
      try {
        if (!isAds) {
          // followers + daily metrics + posts (organic)
          const metricRows: MetricRow[] = []
          try {
            const { data } = await zernio.followerStats(key, { profileId, accountIds: zid, fromDate, toDate, granularity: 'daily' })
            metricRows.push(...normalizeFollowerStats(data))
          } catch (e) { if (!(e instanceof ZernioError && e.status === 404)) throw e }
          try {
            const { data } = await zernio.dailyMetrics(key, { accountId: zid, fromDate, toDate })
            metricRows.push(...normalizeDailyMetrics(data))
          } catch (e) { if (!(e instanceof ZernioError && e.status === 404)) throw e }

          if (metricRows.length) {
            // delete-then-insert the window for this account (idempotent)
            await supabaseAdmin.from('social_metrics_daily')
              .delete()
              .eq('organization_id', organizationId)
              .eq('social_account_id', accountDbId)
              .gte('stat_date', fromDate)
              .lte('stat_date', toDate)
            const insertRows = metricRows.map((r) => ({
              organization_id: organizationId,
              social_account_id: accountDbId,
              stat_date: r.stat_date,
              metric: r.metric,
              value: r.value,
              breakdown: r.breakdown ?? {},
            }))
            const { error } = await supabaseAdmin.from('social_metrics_daily').insert(insertRows)
            if (error) throw error
            rowsWritten += insertRows.length
          }

          try {
            const { data } = await zernio.analytics(key, { accountId: zid, fromDate, toDate, limit: 50 })
            const postRows = normalizePosts(data, organizationId, accountDbId)
            if (postRows.length) {
              const { error } = await supabaseAdmin.from('social_posts').upsert(postRows, { onConflict: 'organization_id,social_account_id,external_post_id' })
              if (error) throw error
              rowsWritten += postRows.length
            }
          } catch (e) { if (!(e instanceof ZernioError && e.status === 404)) throw e }
        } else {
          // ad spend
          const { data } = await zernio.adsTimeline(key, { accountId: zid, fromDate, toDate })
          const adRows = normalizeAdsTimeline(data)
          if (adRows.length) {
            await supabaseAdmin.from('social_ad_spend_daily')
              .delete()
              .eq('organization_id', organizationId)
              .eq('social_account_id', accountDbId)
              .gte('stat_date', fromDate)
              .lte('stat_date', toDate)
            const insertRows = adRows.map((r) => ({
              organization_id: organizationId,
              social_account_id: accountDbId,
              ...r,
              breakdown: {},
            }))
            const { error } = await supabaseAdmin.from('social_ad_spend_daily').insert(insertRows)
            if (error) throw error
            rowsWritten += insertRows.length
          }
        }
      } catch (e) {
        hadError = true
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`${acct.platform}/${zid}: ${msg}`)
        log(`account ${zid} failed: ${msg}`)
      }
    }

    await supabaseAdmin.from('social_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        status: hadError ? 'error' : 'connected',
        last_error: hadError ? errors.join('; ').slice(0, 1000) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId)

    if (runId) {
      await supabaseAdmin.from('social_sync_runs')
        .update({ finished_at: new Date().toISOString(), status: hadError ? 'partial' : 'success', rows_written: rowsWritten, error: errors.join('; ').slice(0, 1000) || null })
        .eq('id', runId)
    }
    log(`done — rows=${rowsWritten} status=${hadError ? 'partial' : 'success'}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log(`fatal: ${msg}`)
    await supabaseAdmin.from('social_connections')
      .update({ status: 'error', last_error: msg.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
    if (runId) {
      await supabaseAdmin.from('social_sync_runs')
        .update({ finished_at: new Date().toISOString(), status: 'error', rows_written: rowsWritten, error: msg.slice(0, 1000) })
        .eq('id', runId)
    }
    throw e
  }
}
