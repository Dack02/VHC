import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useReportFilters } from '../Reports/hooks/useReportFilters'
import type { GroupBy } from '../Reports/hooks/useReportFilters'
import { useReportData } from '../Reports/hooks/useReportData'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import ReportFiltersBar from '../Reports/components/ReportFiltersBar'
import ChartCard from '../Reports/components/ChartCard'
import StatCard from '../Reports/components/StatCard'
import { SERIES_COLORS } from '../Reports/utils/colors'
import { formatCurrency, formatNumber, formatDateFull } from '../Reports/utils/formatters'

interface PlatformRow {
  platform: string
  followers: number
  followerGrowth: number
  reach: number
  views: number
  engagement: number
  spend: number
  impressions: number
  clicks: number
}

interface PeriodRow {
  period: string
  followers: number
  followerGrowth: number
  reach: number
  views: number
  engagement: number
  spend: number
  posts: number
}

type SeriesRow = Record<string, string | number | null>
interface DeltaPair { recent: number; prior: number }
interface RecentData {
  window: number
  unit: GroupBy
  followerGrowth: DeltaPair
  posts: DeltaPair
  views: DeltaPair
  engagement: DeltaPair
}
interface ChartData {
  platforms: string[]
  followers: SeriesRow[]
  posts: SeriesRow[]
  views: SeriesRow[]
  engagement: SeriesRow[]
}

interface AccountRow {
  id: string
  platform: string
  name: string
  handle: string | null
  accountType: string
  followers: number
  followerGrowth: number
  reach: number
  views: number
  engagement: number
  spend: number
}

interface ProfileBreakdownRow {
  id: string
  name: string
  color: string | null
  isDefault: boolean
  followers: number
  followerGrowth: number
  views: number
  engagement: number
  spend: number
  accountCount: number
}

interface OverviewData {
  period: { from: string; to: string }
  groupBy: GroupBy
  totals: PlatformRow
  platforms: PlatformRow[]
  accountsBreakdown: AccountRow[]
  periods: PeriodRow[]
  chart: ChartData
  recent: RecentData | null
  accounts: { id: string; platform: string; account_type: string; display_name: string | null; handle: string | null }[]
  profilesBreakdown: ProfileBreakdownRow[]
  selectedProfileId: string
}

/** Minimal profile shape for the selector — from GET /profiles. */
interface ProfileOption {
  id: string
  name: string
  color: string | null
  isDefault: boolean
}

const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', googlebusiness: 'Google Business', twitter: 'X', youtube: 'YouTube', pinterest: 'Pinterest', threads: 'Threads' }
const PLATFORM_COLOR: Record<string, string> = { facebook: '#1877F2', instagram: '#E1306C', tiktok: '#111111', linkedin: '#0A66C2', googlebusiness: '#34A853', twitter: '#1DA1F2', youtube: '#FF0000', pinterest: '#E60023', threads: '#444444' }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PERIOD_HEADER: Record<GroupBy, string> = { day: 'Date', week: 'Week', month: 'Month' }
const UNIT_WORD: Record<GroupBy, string> = { day: 'day', week: 'week', month: 'month' }

function colorFor(platform: string, i: number): string {
  return PLATFORM_COLOR[platform] || SERIES_COLORS[i % SERIES_COLORS.length]
}

function periodLabel(key: string, groupBy: GroupBy): string {
  if (groupBy === 'month') { const [y, m] = key.split('-'); return `${MONTH_NAMES[Number(m) - 1]} ${y}` }
  if (groupBy === 'week') return `w/c ${formatDateFull(key)}`
  return formatDateFull(key)
}

function growthTrend(row: { followers: number; followerGrowth: number }) {
  const base = row.followers - row.followerGrowth
  const percent = base > 0 ? Math.round((row.followerGrowth / base) * 1000) / 10 : 0
  return {
    direction: (row.followerGrowth > 0 ? 'up' : row.followerGrowth < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
    percent,
  }
}

function TrendTile({ label, pair, unit, signed, decimals }: { label: string; pair: DeltaPair; unit: string; signed?: boolean; decimals?: number }) {
  const fmt = (x: number) => {
    const r = decimals ? x.toFixed(decimals) : formatNumber(Math.round(x))
    return signed && x > 0 ? `+${r}` : r
  }
  const delta = pair.recent - pair.prior
  const cls = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-800'
  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="text-sm text-gray-500 mb-1">{label} <span className="text-gray-400">/ {unit}</span></div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm text-gray-400 tabular-nums">{fmt(pair.prior)}</span>
        <span className="text-gray-300">→</span>
        <span className={`text-2xl font-semibold tabular-nums ${cls}`}>{fmt(pair.recent)}</span>
      </div>
      <div className="text-[11px] text-gray-400 mt-1">recent vs prior</div>
    </div>
  )
}

export default function SocialOverview() {
  const { session } = useAuth()
  const token = session?.accessToken
  const { filters, queryString, setDatePreset, setCustomDateRange, setGroupBy, setSiteId } = useReportFilters({ period: '12m', groupBy: 'week' })

  // Profile selector — "all" or a specific profile id. Drives the &profileId param.
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('all')

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api<{ profiles: ProfileOption[] }>('/api/v1/social-media/profiles', { token })
      .then((res) => { if (!cancelled) setProfileOptions(res.profiles || []) })
      .catch(() => { if (!cancelled) setProfileOptions([]) })
    return () => { cancelled = true }
  }, [token])

  // The overview query is the report filters plus the selected profile.
  const overviewQuery = useMemo(() => `${queryString}&profileId=${encodeURIComponent(selectedProfileId)}`, [queryString, selectedProfileId])
  const { data, loading, error } = useReportData<OverviewData>({ endpoint: '/api/v1/social-media/overview', queryString: overviewQuery })

  const totals = data?.totals
  const hasData = (data?.accounts?.length ?? 0) > 0
  const recent = data?.recent ?? null
  const chartPlatforms = data?.chart?.platforms ?? []
  const unitWord = UNIT_WORD[filters.groupBy]
  const profilesBreakdown = data?.profilesBreakdown ?? []

  // The selector options: "All profiles" + each profile (fall back to whatever
  // the overview returned if the /profiles list hasn't loaded yet).
  const selectorOptions: ProfileOption[] = profileOptions.length > 0
    ? profileOptions
    : profilesBreakdown.map((p) => ({ id: p.id, name: p.name, color: p.color, isDefault: p.isDefault }))

  // Followers re-based to 100 at the period start, so big and small accounts compare on one axis.
  const followerIndexed = useMemo<SeriesRow[]>(() => {
    const rows = data?.chart?.followers ?? []
    const platforms = data?.chart?.platforms ?? []
    const base: Record<string, number> = {}
    for (const pl of platforms) {
      for (const r of rows) { const v = r[pl]; if (v != null) { base[pl] = Number(v); break } }
    }
    return rows.map((r) => {
      const out: SeriesRow = { period: r.period }
      for (const pl of platforms) {
        const v = r[pl]
        out[pl] = v != null && base[pl] ? Math.round((Number(v) / base[pl]) * 1000) / 10 : null
      }
      return out
    })
  }, [data])

  return (
    <div className="space-y-6">
      {/* Profile selector — All profiles / one profile (deep dive) */}
      {selectorOptions.length > 0 && (
        <div className="flex items-center gap-3 overflow-x-auto pb-1">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">Profile</span>
          <div className="inline-flex shrink-0 items-center gap-1 rounded-[10px] border border-gray-200 bg-gray-50 p-1">
            <button
              onClick={() => setSelectedProfileId('all')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                selectedProfileId === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              All profiles
            </button>
            {selectorOptions.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProfileId(p.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  selectedProfileId === p.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color || '#6366F1' }} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <ReportFiltersBar
        datePreset={filters.datePreset}
        groupBy={filters.groupBy}
        siteId={filters.siteId}
        customDateFrom={filters.customFrom}
        customDateTo={filters.customTo}
        onDatePresetChange={setDatePreset}
        onCustomDateRange={setCustomDateRange}
        onGroupByChange={setGroupBy}
        onSiteChange={setSiteId}
        extraDatePresets={[
          { value: '6m', label: 'Last 6 Months' },
          { value: '12m', label: 'Last 12 Months' },
          { value: 'all', label: 'All Time' },
        ]}
      />

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : !hasData ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-gray-600 mb-1">No social accounts connected yet.</p>
          <p className="text-sm text-gray-400 mb-4">Link Facebook, Instagram or TikTok to start tracking performance.</p>
          <Link to="/settings/social-media" className="inline-block px-4 py-2 bg-[#16191f] hover:bg-black text-white rounded-[10px] text-sm font-medium">
            Connect accounts
          </Link>
        </div>
      ) : (
        <>
          {/* Trajectory — recent vs prior averages (the "is it accelerating" read) */}
          {recent ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <TrendTile label="Follower growth" pair={recent.followerGrowth} unit={unitWord} signed />
              <TrendTile label="Posts published" pair={recent.posts} unit={unitWord} decimals={1} />
              <TrendTile label="Views" pair={recent.views} unit={unitWord} />
              <TrendTile label="Engagement" pair={recent.engagement} unit={unitWord} />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Followers" value={formatNumber(totals?.followers || 0)} trend={totals ? growthTrend(totals) : undefined} />
              <StatCard label="Views" value={formatNumber(totals?.views || 0)} />
              <StatCard label="Engagement" value={formatNumber(totals?.engagement || 0)} />
              <StatCard label="Ad spend" value={formatCurrency(totals?.spend || 0)} />
            </div>
          )}

          {/* By profile — only when viewing all profiles and there's more than one.
              Each card deep-dives into that profile when clicked. */}
          {selectedProfileId === 'all' && profilesBreakdown.length > 1 && (
            <div>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">By profile</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {profilesBreakdown.map((p) => {
                  const accent = p.color || '#6366F1'
                  const growthCls = p.followerGrowth > 0 ? 'text-green-600' : p.followerGrowth < 0 ? 'text-red-600' : 'text-gray-400'
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProfileId(p.id)}
                      className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accent }} />
                      <div className="flex items-center justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                          <span className="truncate font-semibold text-gray-900">{p.name}</span>
                          {p.isDefault && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Default</span>}
                        </div>
                        <span className="shrink-0 text-gray-300 transition-colors group-hover:text-primary">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </span>
                      </div>

                      <div className="mt-4 flex items-baseline gap-2">
                        <span className="text-3xl font-bold tabular-nums text-gray-900">{formatNumber(p.followers)}</span>
                        <span className={`text-sm font-medium tabular-nums ${growthCls}`}>
                          {p.followerGrowth > 0 ? '+' : ''}{formatNumber(p.followerGrowth)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400">followers · {p.accountCount} account{p.accountCount === 1 ? '' : 's'}</div>

                      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 text-center">
                        <div>
                          <div className="text-sm font-semibold tabular-nums text-gray-900">{formatNumber(p.views)}</div>
                          <div className="text-[10px] uppercase tracking-wide text-gray-400">Views</div>
                        </div>
                        <div>
                          <div className="text-sm font-semibold tabular-nums text-gray-900">{formatNumber(p.engagement)}</div>
                          <div className="text-[10px] uppercase tracking-wide text-gray-400">Engage</div>
                        </div>
                        <div>
                          <div className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(p.spend)}</div>
                          <div className="text-[10px] uppercase tracking-wide text-gray-400">Ad spend</div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Hero — follower growth per platform, indexed to 100 at the start */}
          <ChartCard title="Follower growth by platform" subtitle="Indexed to 100 at the start of the period so platforms of different sizes compare directly.">
            {followerIndexed.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-gray-400">No follower history in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={followerIndexed} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tickFormatter={(k) => periodLabel(String(k), filters.groupBy)} tick={{ fontSize: 12 }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 12 }} width={40} domain={['auto', 'auto']} />
                  <Tooltip
                    formatter={(v, name) => [v == null ? '—' : `${v}`, PLATFORM_LABEL[String(name)] || String(name)]}
                    labelFormatter={(k) => periodLabel(String(k), filters.groupBy)}
                  />
                  <Legend formatter={(name) => PLATFORM_LABEL[String(name)] || String(name)} />
                  {chartPlatforms.map((pl, i) => (
                    <Line key={pl} type="monotone" dataKey={pl} name={pl} stroke={colorFor(pl, i)} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Activity — posts published per period (leading indicator) */}
          <ChartCard title={`Posts published per ${unitWord}`} subtitle="The activity the team controls directly — the leading indicator the rest follows.">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data?.chart?.posts ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tickFormatter={(k) => periodLabel(String(k), filters.groupBy)} tick={{ fontSize: 12 }} minTickGap={28} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={32} />
                <Tooltip labelFormatter={(k) => periodLabel(String(k), filters.groupBy)} formatter={(v, name) => [v, PLATFORM_LABEL[String(name)] || String(name)]} />
                <Legend formatter={(name) => PLATFORM_LABEL[String(name)] || String(name)} />
                {chartPlatforms.map((pl, i) => (
                  <Bar key={pl} dataKey={pl} name={pl} stackId="p" fill={colorFor(pl, i)} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Visibility — views per period (reach isn't reported for Facebook, so views stands in) */}
          <ChartCard title={`Views per ${unitWord} by platform`} subtitle="Facebook doesn’t report reach through Zernio, so views is the visibility metric here.">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data?.chart?.views ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tickFormatter={(k) => periodLabel(String(k), filters.groupBy)} tick={{ fontSize: 12 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 12 }} width={44} tickFormatter={(v) => formatNumber(Number(v))} />
                <Tooltip labelFormatter={(k) => periodLabel(String(k), filters.groupBy)} formatter={(v, name) => [formatNumber(Number(v)), PLATFORM_LABEL[String(name)] || String(name)]} />
                <Legend formatter={(name) => PLATFORM_LABEL[String(name)] || String(name)} />
                {chartPlatforms.map((pl, i) => (
                  <Line key={pl} type="monotone" dataKey={pl} name={pl} stroke={colorFor(pl, i)} strokeWidth={2} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Per-page (per-account) breakdown */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">By page</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Page</th>
                    <th className="px-4 py-3 font-medium text-right">Followers</th>
                    <th className="px-4 py-3 font-medium text-right">Growth</th>
                    <th className="px-4 py-3 font-medium text-right">Reach</th>
                    <th className="px-4 py-3 font-medium text-right">Views</th>
                    <th className="px-4 py-3 font-medium text-right">Engagement</th>
                    <th className="px-6 py-3 font-medium text-right">Ad spend</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.accountsBreakdown || []).map((a) => (
                    <tr key={a.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-6 py-3">
                        <div className="font-medium text-gray-900">{a.name}</div>
                        <div className="text-xs text-gray-400">{PLATFORM_LABEL[a.platform] || a.platform}{a.handle ? ` · @${a.handle}` : ''}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.followers)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${a.followerGrowth > 0 ? 'text-green-600' : a.followerGrowth < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {a.followerGrowth > 0 ? '+' : ''}{formatNumber(a.followerGrowth)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.reach)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.views)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.engagement)}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{formatCurrency(a.spend)}</td>
                    </tr>
                  ))}
                  {(data?.accountsBreakdown?.length ?? 0) === 0 && (
                    <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No connected pages yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-platform breakdown */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">By platform</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Platform</th>
                    <th className="px-4 py-3 font-medium text-right">Followers</th>
                    <th className="px-4 py-3 font-medium text-right">Growth</th>
                    <th className="px-4 py-3 font-medium text-right">Reach</th>
                    <th className="px-4 py-3 font-medium text-right">Views</th>
                    <th className="px-4 py-3 font-medium text-right">Engagement</th>
                    <th className="px-6 py-3 font-medium text-right">Ad spend</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.platforms || []).map((p) => (
                    <tr key={p.platform} className="border-b border-gray-50 last:border-0">
                      <td className="px-6 py-3 font-medium text-gray-900">{PLATFORM_LABEL[p.platform] || p.platform}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(p.followers)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${p.followerGrowth > 0 ? 'text-green-600' : p.followerGrowth < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {p.followerGrowth > 0 ? '+' : ''}{formatNumber(p.followerGrowth)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(p.reach)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(p.views)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(p.engagement)}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{formatCurrency(p.spend)}</td>
                    </tr>
                  ))}
                  {totals && (data?.platforms?.length ?? 0) > 1 && (
                    <tr className="bg-gray-50 font-semibold text-gray-900">
                      <td className="px-6 py-3">Total</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totals.followers)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{totals.followerGrowth > 0 ? '+' : ''}{formatNumber(totals.followerGrowth)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totals.reach)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totals.views)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totals.engagement)}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{formatCurrency(totals.spend)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Over time — switches with the Day / Week / Month toggle */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Over time</h2>
            </div>
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">{PERIOD_HEADER[filters.groupBy]}</th>
                    <th className="px-4 py-3 font-medium text-right">Followers</th>
                    <th className="px-4 py-3 font-medium text-right">Growth</th>
                    <th className="px-4 py-3 font-medium text-right">Reach</th>
                    <th className="px-4 py-3 font-medium text-right">Views</th>
                    <th className="px-4 py-3 font-medium text-right">Engagement</th>
                    <th className="px-6 py-3 font-medium text-right">Ad spend</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.periods || []).map((row) => (
                    <tr key={row.period} className="border-b border-gray-50 last:border-0">
                      <td className="px-6 py-3 text-gray-900 whitespace-nowrap">{periodLabel(row.period, filters.groupBy)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.followers)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${row.followerGrowth > 0 ? 'text-green-600' : row.followerGrowth < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {row.followerGrowth > 0 ? '+' : ''}{formatNumber(row.followerGrowth)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.reach)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.views)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.engagement)}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{formatCurrency(row.spend)}</td>
                    </tr>
                  ))}
                  {(data?.periods?.length ?? 0) === 0 && (
                    <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No data in this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
