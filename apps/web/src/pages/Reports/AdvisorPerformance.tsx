import { Link } from 'react-router-dom'
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatPercent, formatDuration } from './utils/formatters'
import { CHART_COLORS } from './utils/colors'

interface AdvisorData {
  period: { from: string; to: string }
  leaderboard: Array<{
    id: string
    name: string
    managed: number
    sent: number
    sendRate: number
    authorized: number
    conversionRate: number
    valueIdentified: number
    valueAuthorized: number
    valueDeclined: number
    avgPricingHours: number
    avgResponseHours: number
    mriNaCount: number
    deferredCount: number
    deferredValue: number
    avgIdentifiedValue: number
    avgSoldValue: number
  }>
  funnelComparison: Array<{ name: string; managed: number; sent: number; authorized: number }>
  agingChecks: Array<{
    healthCheckId: string
    advisorName: string
    sentAt: string
    daysWaiting: number
  }>
}

export default function AdvisorPerformance() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId, setAdvisorId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<AdvisorData>({
    endpoint: '/api/v1/reports/advisors',
    queryString,
  })

  const leaderboardColumns: Column<AdvisorData['leaderboard'][0]>[] = [
    { key: 'name', label: 'Advisor', render: r => <span className="font-medium text-gray-900">{r.name}</span>, sortable: true, sortValue: r => r.name },
    { key: 'managed', label: 'Managed', render: r => r.managed, align: 'right', sortable: true, sortValue: r => r.managed },
    { key: 'sent', label: 'Sent', render: r => r.sent, align: 'right', sortable: true, sortValue: r => r.sent },
    { key: 'sendRate', label: 'Send %', render: r => formatPercent(r.sendRate), align: 'right', sortable: true, sortValue: r => r.sendRate },
    { key: 'authorized', label: 'Auth', render: r => r.authorized, align: 'right', sortable: true, sortValue: r => r.authorized },
    { key: 'convRate', label: 'Conv %', render: r => (
      <span className={r.conversionRate >= 50 ? 'text-green-600' : r.conversionRate >= 30 ? 'text-amber-600' : 'text-red-600'}>
        {formatPercent(r.conversionRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.conversionRate },
    { key: 'value', label: 'Authorized', render: r => <span className="font-medium text-green-600">{formatCurrency(r.valueAuthorized)}</span>, align: 'right', sortable: true, sortValue: r => r.valueAuthorized },
    { key: 'avgIdentified', label: 'Avg Identified', render: r => formatCurrency(r.avgIdentifiedValue), align: 'right', sortable: true, sortValue: r => r.avgIdentifiedValue },
    { key: 'avgSold', label: 'Avg Sold', render: r => <span className="text-green-600">{formatCurrency(r.avgSoldValue)}</span>, align: 'right', sortable: true, sortValue: r => r.avgSoldValue },
    { key: 'deferred', label: 'Deferred', render: r => <span>{r.deferredCount} ({formatCurrency(r.deferredValue)})</span>, align: 'right', sortable: true, sortValue: r => r.deferredCount },
    { key: 'mriNa', label: 'MRI N/A', render: r => r.mriNaCount, align: 'right', sortable: true, sortValue: r => r.mriNaCount },
    { key: 'avgCompletion', label: 'Avg Completion', render: r => r.avgPricingHours > 0 ? formatDuration(r.avgPricingHours * 60) : '-', align: 'right', sortable: true, sortValue: r => r.avgPricingHours },
  ]

  const agingColumns: Column<AdvisorData['agingChecks'][0]>[] = [
    { key: 'id', label: 'Health Check', render: r => (
      <Link to={`/health-checks/${r.healthCheckId}`} className="text-primary hover:underline font-mono text-xs">
        {r.healthCheckId.slice(0, 8)}...
      </Link>
    ) },
    { key: 'advisor', label: 'Advisor', render: r => r.advisorName },
    { key: 'sentAt', label: 'Sent', render: r => new Date(r.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) },
    { key: 'days', label: 'Days Waiting', render: r => (
      <span className={r.daysWaiting >= 7 ? 'text-red-600 font-medium' : r.daysWaiting >= 3 ? 'text-amber-600' : 'text-gray-600'}>
        {r.daysWaiting.toFixed(1)}d
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.daysWaiting },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/reports" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Advisor Performance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Conversion, pricing speed, revenue</p>
        </div>
      </div>

      <ReportFiltersBar
        datePreset={filters.datePreset}
        groupBy={filters.groupBy}
        siteId={filters.siteId}
        advisorId={filters.advisorId}
        customDateFrom={filters.customFrom}
        customDateTo={filters.customTo}
        onDatePresetChange={setDatePreset}
        onCustomDateRange={setCustomDateRange}
        onGroupByChange={setGroupBy}
        onSiteChange={setSiteId}
        onAdvisorChange={setAdvisorId}
        showAdvisorFilter
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          {/* Leaderboard */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Advisor Leaderboard</h2>
            </div>
            <DataTable
              columns={leaderboardColumns}
              data={data?.leaderboard || []}
              rowKey={r => r.id}
              pageSize={15}
              emptyMessage="No advisor data available"
            />
          </div>

          {/* Funnel Comparison */}
          {(data?.funnelComparison.length || 0) > 0 && (
            <ChartCard title="Funnel Comparison by Advisor">
              <ResponsiveContainer width="100%" height={Math.max(200, (data?.funnelComparison.length || 0) * 50)}>
                <BarChart data={data?.funnelComparison || []} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="managed" name="Managed" fill={CHART_COLORS.gray} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="sent" name="Sent" fill={CHART_COLORS.tertiary} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="authorized" name="Authorized" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* Aging Checks */}
          {(data?.agingChecks.length || 0) > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="border-b border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900">Unresponded Checks</h2>
                <p className="text-sm text-gray-500 mt-0.5">Sent but awaiting customer response</p>
              </div>
              <DataTable
                columns={agingColumns}
                data={data?.agingChecks || []}
                rowKey={r => r.healthCheckId}
                pageSize={10}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
