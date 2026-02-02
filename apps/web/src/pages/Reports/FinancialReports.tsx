import { Link } from 'react-router-dom'
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatPercent, formatDate } from './utils/formatters'
import { CHART_COLORS } from './utils/colors'

interface FinancialData {
  period: { from: string; to: string }
  overview: {
    totalIdentified: number
    totalAuthorized: number
    totalDeclined: number
    totalDeferred: number
    captureRate: number
    labourTotal: number
    partsTotal: number
    labourPercent: number
  }
  revenueTimeline: Array<{ period: string; identified: number; authorized: number; declined: number }>
  topItems: Array<{
    name: string
    count: number
    totalValue: number
    avgValue: number
    authorizedCount: number
    authRate: number
  }>
  priceOverrides: Array<{
    name: string
    originalTotal: number
    overrideAmount: number
    reason: string | null
    advisorName: string
  }>
}

export default function FinancialReports() {
  const {
    filters, queryString,
    setDatePreset, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<FinancialData>({
    endpoint: '/api/v1/reports/financial',
    queryString,
  })

  const o = data?.overview

  const pieData = o ? [
    { name: 'Labour', value: o.labourTotal },
    { name: 'Parts', value: o.partsTotal },
  ].filter(d => d.value > 0) : []

  const pieColors = [CHART_COLORS.primary, CHART_COLORS.tertiary]

  const chartData = data?.revenueTimeline.map(d => ({
    ...d,
    label: formatDate(d.period),
  })) || []

  const topItemColumns: Column<FinancialData['topItems'][0]>[] = [
    { key: 'name', label: 'Item', render: r => <span className="font-medium text-gray-900">{r.name}</span>, sortable: true, sortValue: r => r.name },
    { key: 'count', label: 'Count', render: r => r.count, align: 'right', sortable: true, sortValue: r => r.count },
    { key: 'avgValue', label: 'Avg Value', render: r => formatCurrency(r.avgValue), align: 'right', sortable: true, sortValue: r => r.avgValue },
    { key: 'totalValue', label: 'Total Value', render: r => <span className="font-medium">{formatCurrency(r.totalValue)}</span>, align: 'right', sortable: true, sortValue: r => r.totalValue },
    { key: 'authRate', label: 'Auth Rate', render: r => (
      <span className={r.authRate >= 50 ? 'text-green-600' : r.authRate >= 30 ? 'text-amber-600' : 'text-red-600'}>
        {formatPercent(r.authRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.authRate },
  ]

  const overrideColumns: Column<FinancialData['priceOverrides'][0]>[] = [
    { key: 'name', label: 'Item', render: r => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: 'original', label: 'Original', render: r => formatCurrency(r.originalTotal), align: 'right' },
    { key: 'override', label: 'Override', render: r => formatCurrency(r.overrideAmount), align: 'right' },
    { key: 'reason', label: 'Reason', render: r => <span className="text-gray-500">{r.reason || '-'}</span> },
    { key: 'advisor', label: 'Advisor', render: r => r.advisorName },
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
          <h1 className="text-2xl font-bold text-gray-900">Financial Reports</h1>
          <p className="text-gray-500 text-sm mt-0.5">Revenue, margins, parts vs labour</p>
        </div>
      </div>

      <ReportFiltersBar
        datePreset={filters.datePreset}
        groupBy={filters.groupBy}
        siteId={filters.siteId}
        onDatePresetChange={setDatePreset}
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
          {/* Revenue Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Identified" value={formatCurrency(o?.totalIdentified || 0)} />
            <StatCard label="Authorized" value={formatCurrency(o?.totalAuthorized || 0)} valueClassName="text-green-600" />
            <StatCard label="Declined" value={formatCurrency(o?.totalDeclined || 0)} valueClassName="text-red-600" />
            <StatCard label="Capture Rate" value={formatPercent(o?.captureRate || 0)} valueClassName="text-primary" />
          </div>

          {/* Revenue Over Time + Labour vs Parts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartCard title="Revenue Over Time" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                  <Area type="monotone" dataKey="authorized" name="Authorized" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} stackId="1" />
                  <Area type="monotone" dataKey="declined" name="Declined" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} stackId="1" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Labour vs Parts">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={pieColors[i]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-6 mt-2 text-sm">
                <span className="text-gray-600">Labour: {formatCurrency(o?.labourTotal || 0)}</span>
                <span className="text-gray-600">Parts: {formatCurrency(o?.partsTotal || 0)}</span>
              </div>
            </ChartCard>
          </div>

          {/* Top Items by Value */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Top Repair Items by Value</h2>
            </div>
            <DataTable
              columns={topItemColumns}
              data={data?.topItems || []}
              rowKey={r => r.name}
              pageSize={15}
              emptyMessage="No repair item data available"
            />
          </div>

          {/* Price Overrides */}
          {(data?.priceOverrides.length || 0) > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="border-b border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900">Price Overrides</h2>
                <p className="text-sm text-gray-500 mt-0.5">Items where the price was manually overridden</p>
              </div>
              <DataTable
                columns={overrideColumns}
                data={data?.priceOverrides || []}
                rowKey={r => `${r.name}-${r.overrideAmount}`}
                pageSize={10}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
