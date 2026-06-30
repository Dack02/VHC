import { Link } from 'react-router-dom'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import ReportFiltersBar from './components/ReportFiltersBar'
import StatCard from './components/StatCard'
import { formatCurrency, formatNumber } from './utils/formatters'

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

interface OverviewData {
  period: { from: string; to: string }
  totals: PlatformRow
  platforms: PlatformRow[]
  series: { date: string; reach: number; views: number; spend: number }[]
  accounts: { id: string; platform: string; account_type: string; display_name: string | null; handle: string | null }[]
}

const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }

function growthTrend(row: { followers: number; followerGrowth: number }) {
  const base = row.followers - row.followerGrowth
  const percent = base > 0 ? Math.round((row.followerGrowth / base) * 1000) / 10 : 0
  return {
    direction: (row.followerGrowth > 0 ? 'up' : row.followerGrowth < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
    percent,
  }
}

export default function SocialMediaAnalytics() {
  const { filters, queryString, setDatePreset, setCustomDateRange, setGroupBy, setSiteId } = useReportFilters()
  const { data, loading, error } = useReportData<OverviewData>({ endpoint: '/api/v1/social-media/overview', queryString })

  const totals = data?.totals
  const hasData = (data?.accounts?.length ?? 0) > 0

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Social Media Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Reach, engagement, follower growth and marketing spend across your connected platforms.</p>
      </div>

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
        </>
      )}
    </div>
  )
}
