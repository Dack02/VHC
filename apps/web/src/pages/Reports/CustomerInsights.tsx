import { Link } from 'react-router-dom'
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatPercent, formatDuration } from './utils/formatters'
import { CHART_COLORS } from './utils/colors'

interface CustomerData {
  period: { from: string; to: string }
  engagement: {
    reportsSent: number
    reportsOpened: number
    openRate: number
    avgTimeToOpenHours: number
  }
  responseDistribution: Array<{ bucket: string; count: number }>
  approvalByDay: Array<{ day: string; count: number }>
  topDeclinedReasons: Array<{ reason: string; count: number; value: number }>
  repeatCustomers: {
    total: number
    repeat: number
    repeatRate: number
  }
}

export default function CustomerInsights() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<CustomerData>({
    endpoint: '/api/v1/reports/customers',
    queryString,
  })

  const e = data?.engagement

  const declinedColumns: Column<CustomerData['topDeclinedReasons'][0]>[] = [
    { key: 'reason', label: 'Reason', render: r => <span className="font-medium text-gray-900">{r.reason}</span> },
    { key: 'count', label: 'Count', render: r => r.count, align: 'right', sortable: true, sortValue: r => r.count },
    { key: 'value', label: 'Value Declined', render: r => <span className="text-red-600">{formatCurrency(r.value)}</span>, align: 'right', sortable: true, sortValue: r => r.value },
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
          <h1 className="text-2xl font-bold text-gray-900">Customer Insights</h1>
          <p className="text-gray-500 text-sm mt-0.5">Engagement, decline analysis, response patterns</p>
        </div>
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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          {/* Engagement Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Reports Sent" value={e?.reportsSent || 0} />
            <StatCard label="Reports Opened" value={e?.reportsOpened || 0} />
            <StatCard label="Open Rate" value={formatPercent(e?.openRate || 0)} valueClassName="text-primary" />
            <StatCard
              label="Avg Time to Open"
              value={e?.avgTimeToOpenHours ? formatDuration(e.avgTimeToOpenHours * 60) : '-'}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Response Time Distribution */}
            <ChartCard title="Response Time Distribution">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data?.responseDistribution || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Responses" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Approval by Day of Week */}
            <ChartCard title="Responses by Day of Week">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data?.approvalByDay || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Responses" fill={CHART_COLORS.tertiary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Repeat Customers */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Repeat Customers</h2>
            <div className="grid grid-cols-3 gap-6">
              <div>
                <div className="text-sm text-gray-500">Total Customers</div>
                <div className="text-2xl font-bold text-gray-900">{data?.repeatCustomers.total || 0}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Repeat Customers</div>
                <div className="text-2xl font-bold text-primary">{data?.repeatCustomers.repeat || 0}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Repeat Rate</div>
                <div className="text-2xl font-bold text-primary">{formatPercent(data?.repeatCustomers.repeatRate || 0)}</div>
              </div>
            </div>
          </div>

          {/* Declined Reasons */}
          {(data?.topDeclinedReasons.length || 0) > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="border-b border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900">Top Declined Reasons</h2>
              </div>
              <DataTable
                columns={declinedColumns}
                data={data?.topDeclinedReasons || []}
                rowKey={r => r.reason}
                pageSize={15}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
