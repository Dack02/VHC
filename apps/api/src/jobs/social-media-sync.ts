/**
 * Social Media nightly sync (Zernio buy-layer) — multi-profile.
 *
 * An org has many Zernio profiles (social_profiles). For EACH profile we pull
 * its accounts, follower history, and post-derived per-account daily metrics,
 * tagging every account with its social_profile_id. Per-account metrics are
 * derived from posts (each post carries platforms[].accountId) so multiple
 * Facebook Pages — each in its own profile — stay separated. Idempotent: we
 * delete each touched account's window then insert. See GMS/SOCIAL_MEDIA.md §17.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { getZernioKeyForOrg, zernio, ZernioError } from '../lib/zernio.js'
import type { SocialMediaSyncJob } from '../services/queue.js'

const WINDOW_DAYS = 90

const toISODate = (d: Date) => d.toISOString().slice(0, 10)
const num = (v: unknown): number => { const n = typeof v === 'string' ? parseFloat(v) : (v as number); return Number.isFinite(n) ? n : 0 }
const arr = (json: unknown, key: string): any[] => { const v = (json as any)?.[key]; return Array.isArray(v) ? v : [] }

interface MetricRow { accountDbId: string; stat_date: string; metric: string; value: number }

export async function runSocialMediaSync(job: SocialMediaSyncJob): Promise<void> {
  const { organizationId } = job
  const log = (m: string) => console.log(`[SocialMediaSync] org=${organizationId} ${m}`)

  const { data: conn } = await supabaseAdmin
    .from('social_connections').select('status').eq('organization_id', organizationId).maybeSingle()
  if (conn && (conn as { status?: string }).status === 'disabled') { log('disabled — skipping'); return }

  const key = await getZernioKeyForOrg(organizationId)
  if (!key) {
    await supabaseAdmin.from('social_connections')
      .update({ last_error: 'No Zernio API key configured', status: 'error', updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
    log('no API key — aborting'); return
  }

  const { data: profiles } = await supabaseAdmin
    .from('social_profiles').select('id, zernio_profile_id, name').eq('organization_id', organizationId)
  if (!profiles || profiles.length === 0) { log('no profiles — skipping'); return }

  const until = new Date()
  const since = new Date(until.getTime() - WINDOW_DAYS * 86400000)
  const fromDate = toISODate(since)
  const toDate = toISODate(until)

  const { data: runRow } = await supabaseAdmin
    .from('social_sync_runs').insert({ organization_id: organizationId, platform: 'all', status: 'running' }).select('id').single()
  const runId = (runRow as { id?: string } | null)?.id

  let rowsWritten = 0
  const notes: string[] = []
  const metricRows: MetricRow[] = []
  const postRows: any[] = []

  try {
    for (const profile of profiles as any[]) {
      const zpid = profile.zernio_profile_id
      try {
        // 1) Accounts for this profile → upsert tagged with social_profile_id
        const accountsResp = await zernio.listAccounts(key, { profileId: zpid })
        for (const a of arr(accountsResp.data, 'accounts')) {
          const zid = a?._id
          if (!zid) continue
          await supabaseAdmin.from('social_accounts').upsert({
            organization_id: organizationId,
            social_profile_id: profile.id,
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
          }, { onConflict: 'organization_id,zernio_account_id' })
        }

        // Maps scoped to THIS profile (so attribution never crosses profiles)
        const { data: ourAccounts } = await supabaseAdmin
          .from('social_accounts').select('id, zernio_account_id, platform, is_active')
          .eq('organization_id', organizationId).eq('social_profile_id', profile.id)
        const byZernioId = new Map<string, string>()
        const firstByPlatform = new Map<string, string>()
        for (const a of (ourAccounts || []) as any[]) {
          byZernioId.set(a.zernio_account_id, a.id)
          if (a.is_active && !firstByPlatform.has(a.platform)) firstByPlatform.set(a.platform, a.id)
        }

        // 2) Follower history (stats keyed by zernio account id → [{date,followers}])
        try {
          const fs = await zernio.followerStats(key, { profileId: zpid, granularity: 'daily', fromDate, toDate })
          const statsByAccount = ((fs.data as any)?.stats || {}) as Record<string, any[]>
          const seriesAccounts = new Set<string>()
          for (const [zid, series] of Object.entries(statsByAccount)) {
            const acctDbId = byZernioId.get(String(zid))
            if (!acctDbId || !Array.isArray(series)) continue
            let pushed = false
            for (const pt of series) {
              if (pt?.date && pt.followers != null) { metricRows.push({ accountDbId: acctDbId, stat_date: String(pt.date).slice(0, 10), metric: 'followers_count', value: num(pt.followers) }); pushed = true }
            }
            // Only treat the account as "has a daily series" when it actually
            // produced points. A newly-connected page returns an empty stats[]
            // key before Zernio builds its history — without this guard that
            // empty key suppresses the currentFollowers fallback below, so the
            // page would show 0 even once Zernio knows the live count.
            if (pushed) seriesAccounts.add(acctDbId)
          }
          for (const fa of arr(fs.data, 'accounts')) {
            const acctDbId = byZernioId.get(String(fa?._id))
            if (acctDbId && !seriesAccounts.has(acctDbId) && fa.currentFollowers != null) metricRows.push({ accountDbId: acctDbId, stat_date: toDate, metric: 'followers_count', value: num(fa.currentFollowers) })
          }
        } catch (e) { if (!(e instanceof ZernioError && [403, 404].includes(e.status))) throw e }

        // 3) Posts → per-account daily reach/views/engagement + the post catalogue
        const perAcctDay = new Map<string, { reach: number; views: number; engagement: number }>()
        try {
          for (let page = 1; page <= 20; page++) {
            const { data } = await zernio.analytics(key, { profileId: zpid, fromDate, toDate, limit: 100, page })
            const posts = arr(data, 'posts')
            if (!posts.length) break
            for (const post of posts) {
              const plat = Array.isArray(post.platforms) ? post.platforms[0] : null
              const acctDbId = byZernioId.get(String(plat?.accountId)) || firstByPlatform.get(String(post.platform || '').toLowerCase())
              if (!acctDbId) continue
              const a = post.analytics || plat?.analytics || {}
              const day = String(post.publishedAt || post.scheduledFor || '').slice(0, 10)
              if (day) {
                const kk = `${acctDbId}|${day}`
                if (!perAcctDay.has(kk)) perAcctDay.set(kk, { reach: 0, views: 0, engagement: 0 })
                const agg = perAcctDay.get(kk)!
                agg.reach += num(a.reach)
                agg.views += num(a.views)
                agg.engagement += num(a.likes) + num(a.comments) + num(a.shares) + num(a.saves)
              }
              const ext = post._id || plat?.platformPostId
              if (ext) postRows.push({
                organization_id: organizationId,
                social_account_id: acctDbId,
                external_post_id: String(ext),
                post_type: post.mediaType ?? null,
                permalink: post.platformPostUrl ?? plat?.platformPostUrl ?? null,
                caption: post.content ?? null,
                thumbnail_url: post.thumbnailUrl ?? null,
                posted_at: post.publishedAt ? new Date(post.publishedAt).toISOString() : null,
                metrics: a,
                metrics_fetched_at: new Date().toISOString(),
              })
            }
            const pag = (data as any)?.pagination
            const hasMore = pag ? (pag.hasMore ?? pag.hasNextPage ?? (Number(pag.page) < Number(pag.totalPages))) : posts.length >= 100
            if (!hasMore) break
          }
        } catch (e) { if (!(e instanceof ZernioError && [403, 404].includes(e.status))) throw e }
        for (const [kk, agg] of perAcctDay) {
          const [acctDbId, day] = kk.split('|')
          metricRows.push({ accountDbId: acctDbId, stat_date: day, metric: 'reach', value: agg.reach })
          metricRows.push({ accountDbId: acctDbId, stat_date: day, metric: 'views', value: agg.views })
          metricRows.push({ accountDbId: acctDbId, stat_date: day, metric: 'engagement', value: agg.engagement })
        }

        // 4) Ad spend (Ads add-on gated — skip gracefully)
        try {
          await zernio.adsTimeline(key, { profileId: zpid, fromDate, toDate })
        } catch (e) {
          if (e instanceof ZernioError && e.status === 403) { if (!notes.includes('ads: add-on required')) notes.push('ads: add-on required') }
          else if (!(e instanceof ZernioError && e.status === 404)) notes.push(`ads ${profile.name}: ${e instanceof Error ? e.message : 'error'}`)
        }

        await supabaseAdmin.from('social_profiles')
          .update({ last_synced_at: new Date().toISOString(), status: 'connected', last_error: null, updated_at: new Date().toISOString() })
          .eq('id', profile.id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        notes.push(`${profile.name}: ${msg}`)
        await supabaseAdmin.from('social_profiles')
          .update({ status: 'error', last_error: msg.slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', profile.id)
        log(`profile ${profile.name} failed: ${msg}`)
      }
    }

    // Persist metrics: delete each touched account's window, then insert
    const byAccount = new Map<string, MetricRow[]>()
    for (const r of metricRows) {
      if (!byAccount.has(r.accountDbId)) byAccount.set(r.accountDbId, [])
      byAccount.get(r.accountDbId)!.push(r)
    }
    for (const [acctDbId, rows] of byAccount) {
      await supabaseAdmin.from('social_metrics_daily').delete()
        .eq('organization_id', organizationId).eq('social_account_id', acctDbId)
        .gte('stat_date', fromDate).lte('stat_date', toDate)
      const insertRows = rows.map((r) => ({ organization_id: organizationId, social_account_id: r.accountDbId, stat_date: r.stat_date, metric: r.metric, value: r.value, breakdown: {} }))
      if (insertRows.length) {
        const { error } = await supabaseAdmin.from('social_metrics_daily').insert(insertRows)
        if (error) throw error
        rowsWritten += insertRows.length
      }
    }

    // Posts: dedupe + upsert
    const seen = new Set<string>()
    const uniquePosts = postRows.filter((p) => { const k = `${p.social_account_id}|${p.external_post_id}`; if (seen.has(k)) return false; seen.add(k); return true })
    if (uniquePosts.length) {
      const { error } = await supabaseAdmin.from('social_posts').upsert(uniquePosts, { onConflict: 'organization_id,social_account_id,external_post_id' })
      if (error) throw error
      rowsWritten += uniquePosts.length
    }

    const hadRealError = notes.some((n) => !n.startsWith('ads:'))
    await supabaseAdmin.from('social_connections')
      .update({ last_synced_at: new Date().toISOString(), status: hadRealError ? 'error' : 'connected', last_error: notes.join('; ') || null, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
    if (runId) {
      await supabaseAdmin.from('social_sync_runs')
        .update({ finished_at: new Date().toISOString(), status: hadRealError ? 'partial' : 'success', rows_written: rowsWritten, error: notes.join('; ') || null })
        .eq('id', runId)
    }
    log(`done — rows=${rowsWritten} profiles=${profiles.length} ${notes.length ? `notes=[${notes.join('; ')}]` : ''}`)
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
