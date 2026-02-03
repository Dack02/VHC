import { Link } from 'react-router-dom'
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatDate, formatDateFull } from './utils/formatters'
import { CHART_COLORS, RAG_COLORS } from './utils/colors'

interface DeferredData {
  period: { from: string; to: string }
  summary: {
    totalCount: number
    totalValue: number
    overdueCount: number
    overdueValue: number
    avgDeferralDays: number
  }
  dueBreakdown: Array<{
    label: string
    count: number
    value: number
  }>
  timeline: Array<{
    period: string
    count: number
    value: number
  }>
  topItems: Array<{
    name: string
    count: number
    totalValue: number
    avgValue: number
  }>
  items: Array<{
    id: string
    itemName: string
    vehicleReg: string
    customerName: string
    advisorName: string
    value: number
    deferredAt: string
    deferredUntil: string | null
    deferredNotes: string | null
    isOverdue: boolean
    healthCheckId: string
  }>
}

export default function DeferredWork() {
  const {
    filters, queryString,
    setDatePreset, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<DeferredData>({
    endpoint: '/api/v1/reports/deferred',
    queryString,
  })

  const s = data?.summary

  const chartData = data?.timeline.map(d => ({
    ...d,
    label: formatDate(d.period),
  })) || []

  const dueBreakdownData = data?.dueBreakdown || []

  const topItemColumns: Column<DeferredData['topItems'][0]>[] = [
    { key: 'name', label: 'Item', render: r => <span className="font-medium text-gray-900">{r.name}</span>, sortable: true, sortValue: r => r.name },
    { key: 'count', label: 'Count', render: r => r.count, align: 'right', sortable: true, sortValue: r => r.count },
    { key: 'avgValue', label: 'Avg Value', render: r => formatCurrency(r.avgValue), align: 'right', sortable: true, sortValue: r => r.avgValue },
    { key: 'totalValue', label: 'Total Value', render: r => <span className="font-medium">{formatCurrency(r.totalValue)}</span>, align: 'right', sortable: true, sortValue: r => r.totalValue },
  ]

  const itemColumns: Column<DeferredData['items'][0]>[] = [
    { key: 'itemName', label: 'Item', render: r => <span className="font-medium text-gray-900">{r.itemName}</span>, sortable: true, sortValue: r => r.itemName },
    { key: 'vehicleReg', label: 'Vehicle', render: r => (
      <span className="font-mono text-xs bg-yellow-50 px-1.5 py-0.5 border border-gray-200 rounded">{r.vehicleReg}</span>
    ), sortable: true, sortValue: r => r.vehicleReg },
    { key: 'customerName', label: 'Customer', render: r => r.customerName, sortable: true, sortValue: r => r.customerName },
    { key: 'value', label: 'Value', render: r => formatCurrency(r.value), align: 'right', sortable: true, sortValue: r => r.value },
    { key: 'deferredAt', label: 'Deferred', render: r => formatDateFull(r.deferredAt), sortable: true, sortValue: r => r.deferredAt },
    { key: 'deferredUntil', label: 'Due Back', render: r => r.deferredUntil ? formatDateFull(r.deferredUntil) : '-', sortable: true, sortValue: r => r.deferredUntil || '' },
    { key: 'status', label: 'Status', render: r => r.isOverdue ? (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Overdue</span>
    ) : (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Deferred</span>
    ), sortable: true, sortValue: r => r.isOverdue ? 1 : 0 },
    { key: 'action', label: '', render: r => (
      <Link to={`/health-checks/${r.healthCheckId}`} className="text-primary hover:underline text-xs">
        View
      </Link>
    )},
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
          <h1 className="text-2xl font-bold text-gray-900">Deferred Work</h1>
          <p className="text-gray-500 text-sm mt-0.5">Deferred items, due dates, follow-ups</p>
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
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard label="Total Deferred" value={s?.totalCount || 0} />
            <StatCard label="Total Value" value={formatCurrency(s?.totalValue || 0)} />
            <StatCard
              label="Overdue Items"
              value={s?.overdueCount || 0}
              valueClassName={(s?.overdueCount || 0) > 0 ? 'text-red-600' : 'text-gray-900'}
            />
            <StatCard
              label="Overdue Value"
              value={formatCurrency(s?.overdueValue || 0)}
              valueClassName={(s?.overdueValue || 0) > 0 ? 'text-red-600' : 'text-gray-900'}
            />
            <StatCard
              label="Avg Deferral Period"
              value={s?.avgDeferralDays ? `${s.avgDeferralDays} days` : '-'}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Due Date Breakdown */}
            <ChartCard title="Due Date Breakdown">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dueBreakdownData} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={100} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="value" name="Value" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]}>
                    {dueBreakdownData.map((entry, index) => (
                      <rect
                        key={index}
                        fill={entry.label === 'Overdue' ? RAG_COLORS.red : CHART_COLORS.primary}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Deferred Volume Over Time */}
            <ChartCard title="Deferred Volume Over Time">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Deferred Value"
                    stroke={CHART_COLORS.quaternary}
                    fill={CHART_COLORS.quaternary}
                    fillOpacity={0.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Top Deferred Items */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Top Deferred Items</h2>
            </div>
            <DataTable
              columns={topItemColumns}
              data={data?.topItems || []}
              rowKey={r => r.name}
              pageSize={10}
              emptyMessage="No deferred items in this period"
            />
          </div>

          {/* Detailed Items Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">All Deferred Items</h2>
              <p className="text-sm text-gray-500 mt-0.5">{data?.items.length || 0} items</p>
            </div>
            <DataTable
              columns={itemColumns}
              data={data?.items || []}
              rowKey={r => r.id}
              pageSize={20}
              emptyMessage="No deferred items in this period"
            />
          </div>
        </>
      )}
    </div>
  )
}
