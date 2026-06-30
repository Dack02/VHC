/**
 * Social Media nightly sync (Zernio buy-layer).
 *
 * Per organization (one Zernio profile): pull organic insights — accounts,
 * follower counts, per-day post metrics, and post catalogue — and (if the plan
 * has the Ads add-on) ad-spend timelines. Normalise into our tables. Idempotent:
 * for the long-format time-series tables we delete the pulled window per account,
 * then insert.
 *
 * Field mappings below were verified against the live Zernio API (Z0 smoke test,
 * 2026-06-30): profile-level endpoints return all accounts' data in one call.
 * See GMS/SOCIAL_MEDIA.md §2.5.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { getZernioKeyForOrg, zernio, ZernioError } from '../lib/zernio.js'
import type { SocialMediaSyncJob } from '../services/queue.js'

const WINDOW_DAYS = 90

// Organic metric keys present in Zernio's per-day platformMetrics.
const METRIC_KEYS = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'views'] as const

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
function arr(json: unknown, key: string): any[] {
  const v = (json as any)?.[key]
  return Array.isArray(v) ? v : []
}

interface MetricRow { accountDbId: string; stat_date: string; metric: string; value: number }

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
  const since = new Date(until.getTime() - WINDOW_DAYS * 86400000)
  const fromDate = toISODate(since)
  const toDate = toISODate(until)

  const { data: runRow } = await supabaseAdmin
    .from('social_sync_runs')
    .insert({ organization_id: organizationId, platform: 'all', status: 'running' })
    .select('id').single()
  const runId = (runRow as { id?: string } | null)?.id

  let rowsWritten = 0
  const notes: string[] = []

  try {
    // 1) Accounts → upsert
    const accountsResp = await zernio.listAccounts(key, { profileId })
    const accounts = arr(accountsResp.data, 'accounts')
    for (const a of accounts) {
      const zid = a?._id
      if (!zid) continue
      await supabaseAdmin.from('social_accounts').upsert(
        {
          organization_id: organizationId,
          zernio_account_id: String(zid),
          platform: String(a.platform || 'unknown').toLowerCase(),
          account_type: 'organic',
          external_id: a.platformUserId ?? null,
          display_name: a.displayName ?? null,
          handle: a.username ?? null,
          avatar_url: a.profilePicture ?? null,
          status: a.platformStatus ?? 'connected',
          token_expires_at: a.tokenExpiresAt ?? null,
          is_active: a.isActive !== false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,zernio_account_id' }
      )
    }

    // Resolve our account ids
    const { data: ourAccounts } = await supabaseAdmin
      .from('social_accounts')
      .select('id, zernio_account_id, platform, is_active')
      .eq('organization_id', organizationId)
    const byZernioId = new Map<string, string>()
    const firstByPlatform = new Map<string, string>()
    for (const a of (ourAccounts || []) as any[]) {
      byZernioId.set(a.zernio_account_id, a.id)
      if (a.is_active && !firstByPlatform.has(a.platform)) firstByPlatform.set(a.platform, a.id)
    }

    const metricRows: MetricRow[] = []

    // 2) Follower counts — store the daily history series (stats is keyed by
    //    Zernio account id → [{ date, followers }]). Falls back to the current
    //    snapshot if a series is absent.
    try {
      const fs = await zernio.followerStats(key, { profileId, granularity: 'daily', fromDate, toDate })
      const statsByAccount = ((fs.data as any)?.stats || {}) as Record<string, any[]>
      const seriesAccounts = new Set<string>()
      for (const [zid, series] of Object.entries(statsByAccount)) {
        const acctDbId = byZernioId.get(String(zid))
        if (!acctDbId || !Array.isArray(series)) continue
        for (const pt of series) {
          if (pt?.date && pt.followers != null) {
            metricRows.push({ accountDbId: acctDbId, stat_date: String(pt.date).slice(0, 10), metric: 'followers_count', value: num(pt.followers) })
          }
        }
        seriesAccounts.add(acctDbId)
      }
      // Fallback snapshot for accounts without a series
      for (const fa of arr(fs.data, 'accounts')) {
        const acctDbId = byZernioId.get(String(fa?._id))
        if (acctDbId && !seriesAccounts.has(acctDbId) && fa.currentFollowers != null) {
          metricRows.push({ accountDbId: acctDbId, stat_date: toDate, metric: 'followers_count', value: num(fa.currentFollowers) })
        }
      }
    } catch (e) { if (!(e instanceof ZernioError && [403, 404].includes(e.status))) throw e }

    // 3) Per-day organic metrics (per platform → first account of that platform)
    try {
      const dm = await zernio.dailyMetrics(key, { profileId, fromDate, toDate })
      for (const day of arr(dm.data, 'dailyData')) {
        const date = String(day?.date || '').slice(0, 10)
        if (!date) continue
        const pm = day.platformMetrics || {}
        for (const platform of Object.keys(pm)) {
          const acctDbId = firstByPlatform.get(platform.toLowerCase())
          if (!acctDbId) continue
          for (const metric of METRIC_KEYS) {
            const v = pm[platform]?.[metric]
            if (v != null) metricRows.push({ accountDbId: acctDbId, stat_date: date, metric, value: num(v) })
          }
        }
      }
    } catch (e) { if (!(e instanceof ZernioError && [403, 404].includes(e.status))) throw e }

    // Persist metrics: delete each account's window, then insert
    const byAccount = new Map<string, MetricRow[]>()
    for (const r of metricRows) {
      if (!byAccount.has(r.accountDbId)) byAccount.set(r.accountDbId, [])
      byAccount.get(r.accountDbId)!.push(r)
    }
    for (const [acctDbId, rows] of byAccount) {
      await supabaseAdmin.from('social_metrics_daily').delete()
        .eq('organization_id', organizationId).eq('social_account_id', acctDbId)
        .gte('stat_date', fromDate).lte('stat_date', toDate)
      const insertRows = rows.map((r) => ({
        organization_id: organizationId, social_account_id: r.accountDbId,
        stat_date: r.stat_date, metric: r.metric, value: r.value, breakdown: {},
      }))
      if (insertRows.length) {
        const { error } = await supabaseAdmin.from('social_metrics_daily').insert(insertRows)
        if (error) throw error
        rowsWritten += insertRows.length
      }
    }

    // 4) Posts → social_posts (attribute via platforms[].accountId)
    try {
      const an = await zernio.analytics(key, { profileId, fromDate, toDate, limit: 50 })
      const postRows: any[] = []
      for (const post of arr(an.data, 'posts')) {
        const plat = Array.isArray(post.platforms) ? post.platforms[0] : null
        const acctDbId = byZernioId.get(String(plat?.accountId)) || firstByPlatform.get(String(post.platform || '').toLowerCase())
        const ext = post._id || plat?.platformPostId
        if (!acctDbId || !ext) continue
        postRows.push({
          organization_id: organizationId,
          social_account_id: acctDbId,
          external_post_id: String(ext),
          post_type: post.mediaType ?? null,
          permalink: post.platformPostUrl ?? plat?.platformPostUrl ?? null,
          caption: post.content ?? null,
          thumbnail_url: post.thumbnailUrl ?? null,
          posted_at: post.publishedAt ? new Date(post.publishedAt).toISOString() : null,
          metrics: post.analytics ?? {},
          metrics_fetched_at: new Date().toISOString(),
        })
      }
      if (postRows.length) {
        const { error } = await supabaseAdmin.from('social_posts').upsert(postRows, { onConflict: 'organization_id,social_account_id,external_post_id' })
        if (error) throw error
        rowsWritten += postRows.length
      }
    } catch (e) { if (!(e instanceof ZernioError && [403, 404].includes(e.status))) throw e }

    // 5) Ad spend (Ads add-on gated — skip gracefully if 403)
    try {
      const at = await zernio.adsTimeline(key, { profileId, fromDate, toDate })
      const rows = arr(at.data, 'timeline').length ? arr(at.data, 'timeline') : arr(at.data, 'rows')
      // (field mapping kept simple; expand once the Ads add-on is enabled and we see live shapes)
      if (!rows.length) notes.push('ads: no rows')
    } catch (e) {
      if (e instanceof ZernioError && e.status === 403) notes.push('ads: add-on required')
      else if (!(e instanceof ZernioError && e.status === 404)) notes.push(`ads: ${e instanceof Error ? e.message : 'error'}`)
    }

    await supabaseAdmin.from('social_connections')
      .update({ last_synced_at: new Date().toISOString(), status: 'connected', last_error: notes.join('; ') || null, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
    if (runId) {
      await supabaseAdmin.from('social_sync_runs')
        .update({ finished_at: new Date().toISOString(), status: 'success', rows_written: rowsWritten, error: notes.join('; ') || null })
        .eq('id', runId)
    }
    log(`done — rows=${rowsWritten} ${notes.length ? `notes=[${notes.join('; ')}]` : ''}`)
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
