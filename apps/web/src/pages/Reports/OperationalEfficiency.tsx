import { Link } from 'react-router-dom'
import {
  PieChart, Pie, Cell, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatDuration, formatPercent, formatDate } from './utils/formatters'
import { CHART_COLORS, SERIES_COLORS } from './utils/colors'

interface OperationsData {
  period: { from: string; to: string }
  timing: {
    avgTurnaroundHours: number
    avgInspectionMinutes: number
    avgPricingHours: number
    avgTimeToSendHours: number
    avgResponseHours: number
  }
  throughput: Array<{ period: string; created: number; completed: number }>
  statusDistribution: Array<{ status: string; count: number }>
  stuckChecks: Array<{
    healthCheckId: string
    status: string
    daysInStatus: number
    siteName: string
  }>
  siteComparison: Array<{
    name: string
    created: number
    avgTurnaround: number
    conversionRate: number
  }>
}

const STATUS_LABELS: Record<string, string> = {
  inspection_pending: 'Inspection Pending',
  inspection_in_progress: 'Inspection In Progress',
  inspection_complete: 'Inspection Complete',
  pricing_pending: 'Pricing Pending',
  pricing_in_progress: 'Pricing In Progress',
  pricing_complete: 'Pricing Complete',
  advisor_review: 'Advisor Review',
  customer_pending: 'Customer Pending',
  customer_viewed: 'Customer Viewed',
  customer_approved: 'Customer Approved',
  customer_partial: 'Customer Partial',
  customer_declined: 'Customer Declined',
  work_authorized: 'Work Authorized',
  work_in_progress: 'Work In Progress',
  work_complete: 'Work Complete',
  closed: 'Closed',
  archived: 'Archived',
  cancelled: 'Cancelled',
}

export default function OperationalEfficiency() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<OperationsData>({
    endpoint: '/api/v1/reports/operations',
    queryString,
  })

  const t = data?.timing

  const throughputData = data?.throughput.map(d => ({
    ...d,
    label: formatDate(d.period),
  })) || []

  const statusData = data?.statusDistribution.map(d => ({
    name: STATUS_LABELS[d.status] || d.status,
    value: d.count,
  })) || []

  const stuckColumns: Column<OperationsData['stuckChecks'][0]>[] = [
    { key: 'id', label: 'Health Check', render: r => (
      <Link to={`/health-checks/${r.healthCheckId}`} className="text-primary hover:underline font-mono text-xs">
        {r.healthCheckId.slice(0, 8)}...
      </Link>
    ) },
    { key: 'status', label: 'Status', render: r => (
      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
        {STATUS_LABELS[r.status] || r.status}
      </span>
    ) },
    { key: 'days', label: 'Days Stuck', render: r => (
      <span className={r.daysInStatus >= 7 ? 'text-red-600 font-medium' : 'text-amber-600'}>
        {r.daysInStatus.toFixed(1)}d
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.daysInStatus },
    { key: 'site', label: 'Site', render: r => r.siteName },
  ]

  const siteColumns: Column<OperationsData['siteComparison'][0]>[] = [
    { key: 'name', label: 'Site', render: r => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: 'created', label: 'Created', render: r => r.created, align: 'right', sortable: true, sortValue: r => r.created },
    { key: 'turnaround', label: 'Avg Turnaround', render: r => r.avgTurnaround > 0 ? formatDuration(r.avgTurnaround * 60) : '-', align: 'right', sortable: true, sortValue: r => r.avgTurnaround },
    { key: 'conv', label: 'Conv Rate', render: r => (
      <span className={r.conversionRate >= 50 ? 'text-green-600' : r.conversionRate >= 30 ? 'text-amber-600' : 'text-red-600'}>
        {formatPercent(r.conversionRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.conversionRate },
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
          <h1 className="text-2xl font-bold text-gray-900">Operational Efficiency</h1>
          <p className="text-gray-500 text-sm mt-0.5">Workflow bottlenecks, turnaround, throughput</p>
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
          {/* Workflow Timing Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Avg Turnaround" value={t?.avgTurnaroundHours ? formatDuration(t.avgTurnaroundHours * 60) : '-'} />
            <StatCard label="Avg Inspection" value={t?.avgInspectionMinutes ? formatDuration(t.avgInspectionMinutes) : '-'} />
            <StatCard label="Avg Pricing" value={t?.avgPricingHours ? formatDuration(t.avgPricingHours * 60) : '-'} />
            <StatCard label="Avg Time to Send" value={t?.avgTimeToSendHours ? formatDuration(t.avgTimeToSendHours * 60) : '-'} />
            <StatCard label="Avg Response" value={t?.avgResponseHours ? formatDuration(t.avgResponseHours * 60) : '-'} />
          </div>

          {/* Throughput + Status Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartCard title="Throughput Over Time" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={throughputData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="created" name="Created" fill={CHART_COLORS.grayLight} radius={[4, 4, 0, 0]} />
                  <Line dataKey="completed" name="Completed" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Status Distribution">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={statusData.slice(0, 8)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={1}
                    dataKey="value"
                  >
                    {statusData.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-2">
                {statusData.slice(0, 8).map((d, i) => (
                  <span key={d.name} className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                    {d.name} ({d.value})
                  </span>
                ))}
              </div>
            </ChartCard>
          </div>

          {/* Stuck Checks */}
          {(data?.stuckChecks.length || 0) > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="border-b border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900">Stuck Checks</h2>
                <p className="text-sm text-gray-500 mt-0.5">Checks in the same active status for 3+ days</p>
              </div>
              <DataTable
                columns={stuckColumns}
                data={data?.stuckChecks || []}
                rowKey={r => r.healthCheckId}
                pageSize={10}
              />
            </div>
          )}

          {/* Site Comparison */}
          {(data?.siteComparison.length || 0) > 1 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="border-b border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900">Site Comparison</h2>
              </div>
              <DataTable
                columns={siteColumns}
                data={data?.siteComparison || []}
                rowKey={r => r.name}
                pageSize={10}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
