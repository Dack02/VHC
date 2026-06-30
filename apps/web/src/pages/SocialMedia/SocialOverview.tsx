import { Link } from 'react-router-dom'
import { useReportFilters } from '../Reports/hooks/useReportFilters'
import type { GroupBy } from '../Reports/hooks/useReportFilters'
import { useReportData } from '../Reports/hooks/useReportData'
import ReportFiltersBar from '../Reports/components/ReportFiltersBar'
import StatCard from '../Reports/components/StatCard'
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

interface OverviewData {
  period: { from: string; to: string }
  groupBy: GroupBy
  totals: PlatformRow
  platforms: PlatformRow[]
  accountsBreakdown: AccountRow[]
  periods: PeriodRow[]
  accounts: { id: string; platform: string; account_type: string; display_name: string | null; handle: string | null }[]
}

const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', googlebusiness: 'Google Business', twitter: 'X', youtube: 'YouTube', pinterest: 'Pinterest', threads: 'Threads' }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PERIOD_HEADER: Record<GroupBy, string> = { day: 'Date', week: 'Week', month: 'Month' }

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

export default function SocialOverview() {
  const { filters, queryString, setDatePreset, setCustomDateRange, setGroupBy, setSiteId } = useReportFilters()
  const { data, loading, error } = useReportData<OverviewData>({ endpoint: '/api/v1/social-media/overview', queryString })

  const totals = data?.totals
  const hasData = (data?.accounts?.length ?? 0) > 0

  return (
    <div className="space-y-6">
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Followers" value={formatNumber(totals?.followers || 0)} trend={totals ? growthTrend(totals) : undefined} />
            <StatCard label="Reach" value={formatNumber(totals?.reach || 0)} />
            <StatCard label="Engagement" value={formatNumber(totals?.engagement || 0)} />
            <StatCard label="Ad spend" value={formatCurrency(totals?.spend || 0)} />
          </div>

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
