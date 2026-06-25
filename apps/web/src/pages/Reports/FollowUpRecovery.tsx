import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency } from './utils/formatters'
import { CHART_COLORS } from './utils/colors'

interface PipelineData {
  totalCount: number
  totalValue: number
  undated: { count: number; value: number }
  months: Array<{ month: string; label: string; count: number; value: number }>
}

interface ConversionData {
  period: { from: string; to: string }
  totalClosed: number
  wonCount: number
  wonValue: number
  conversionRate: number
  byOutcome: Array<{ name: string; isWon: boolean; count: number; value: number }>
}

export default function FollowUpRecovery() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data: pipeline, loading: pLoading } = useReportData<PipelineData>({
    endpoint: '/api/v1/follow-ups/reports/pipeline',
    queryString,
  })
  const { data: conv, loading: cLoading, error } = useReportData<ConversionData>({
    endpoint: '/api/v1/follow-ups/reports/conversion',
    queryString,
  })

  const months = pipeline?.months || []

  const monthColumns: Column<PipelineData['months'][0]>[] = [
    { key: 'label', label: 'Due month', render: r => <span className="font-medium text-gray-900">{r.label}</span>, sortable: true, sortValue: r => r.month },
    { key: 'count', label: 'Items', render: r => r.count, align: 'right', sortable: true, sortValue: r => r.count },
    { key: 'value', label: 'Value', render: r => <span className="font-medium">{formatCurrency(r.value)}</span>, align: 'right', sortable: true, sortValue: r => r.value },
  ]

  const outcomeColumns: Column<ConversionData['byOutcome'][0]>[] = [
    { key: 'name', label: 'Outcome', render: r => (
      <span className="font-medium text-gray-900">
        {r.name}
        {r.isWon && <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Won</span>}
      </span>
    ), sortable: true, sortValue: r => r.name },
    { key: 'count', label: 'Cases', render: r => r.count, align: 'right', sortable: true, sortValue: r => r.count },
    { key: 'value', label: 'Deferred value', render: r => formatCurrency(r.value), align: 'right', sortable: true, sortValue: r => r.value },
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
          <h1 className="text-2xl font-bold text-gray-900">Follow-Up Recovery</h1>
          <p className="text-gray-500 text-sm mt-0.5">Future deferred-work pipeline and recovery performance</p>
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

      {/* Future pipeline (independent of date range) */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Future pipeline <span className="text-sm font-normal text-gray-400">— all open deferred work</span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          <StatCard label="Open deferred items" value={pipeline?.totalCount || 0} />
          <StatCard label="Pipeline value" value={formatCurrency(pipeline?.totalValue || 0)} />
          <StatCard label="No due date" value={`${pipeline?.undated.count || 0} · ${formatCurrency(pipeline?.undated.value || 0)}`} />
        </div>

        {pLoading && !pipeline ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : (
          <>
            <ChartCard title="Deferred work by due month">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={months}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="value" name="Value" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm mt-4">
              <div className="border-b border-gray-200 p-4"><h3 className="font-semibold text-gray-900">By month</h3></div>
              <DataTable columns={monthColumns} data={months} rowKey={r => r.month} pageSize={12} emptyMessage="No open deferred work" />
            </div>
          </>
        )}
      </div>

      {/* Recovery (uses the selected date range) */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Recovery <span className="text-sm font-normal text-gray-400">— follow-ups closed in the selected period</span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <StatCard label="Cases closed" value={conv?.totalClosed || 0} />
          <StatCard label="Won (booked)" value={conv?.wonCount || 0} valueClassName="text-green-600" />
          <StatCard label="Conversion rate" value={`${conv?.conversionRate || 0}%`} valueClassName="text-primary" />
          <StatCard label="Value recovered" value={formatCurrency(conv?.wonValue || 0)} valueClassName="text-green-600" />
        </div>

        {cLoading && !conv ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4"><h3 className="font-semibold text-gray-900">By outcome</h3></div>
            <DataTable columns={outcomeColumns} data={conv?.byOutcome || []} rowKey={r => r.name} pageSize={10} emptyMessage="No follow-ups closed in this period" />
          </div>
        )}
      </div>
    </div>
  )
}
