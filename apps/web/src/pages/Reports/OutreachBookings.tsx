import { useState } from 'react'
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

type Dimension = 'timeline' | 'advisor' | 'site' | 'month'

interface OutreachGroup {
  key: string
  label: string
  bookings: number
  recovered: number
  avgTouches: number
}

interface OutreachData {
  period: { from: string; to: string }
  groupBy: string
  totalBookings: number
  totalRecovered: number
  groups: OutreachGroup[]
}

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'advisor', label: 'Advisor' },
  { value: 'site', label: 'Site' },
  { value: 'month', label: 'Month attributed' },
]

export default function OutreachBookings() {
  const {
    filters,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()
  const [dimension, setDimension] = useState<Dimension>('timeline')

  // Build the query ourselves so the breakdown dimension (timeline/advisor/site/
  // month) drives group_by, independent of the filter bar's day/week/month toggle.
  const params = new URLSearchParams()
  params.set('date_from', filters.dateFrom)
  params.set('date_to', filters.dateTo)
  params.set('group_by', dimension)
  if (filters.siteId) params.set('site_id', filters.siteId)

  const { data, loading, error } = useReportData<OutreachData>({
    endpoint: '/api/v1/follow-ups/reports/outreach',
    queryString: params.toString(),
  })

  const groups = data?.groups || []
  const dimensionLabel = DIMENSIONS.find(d => d.value === dimension)?.label || 'Group'

  const columns: Column<OutreachGroup>[] = [
    { key: 'label', label: dimensionLabel, render: r => <span className="font-medium text-gray-900">{r.label}</span>, sortable: true, sortValue: r => r.label },
    { key: 'bookings', label: 'Bookings', render: r => r.bookings, align: 'right', sortable: true, sortValue: r => r.bookings },
    { key: 'recovered', label: 'Est. recovered', render: r => <span className="font-medium text-green-600">{formatCurrency(r.recovered)}</span>, align: 'right', sortable: true, sortValue: r => r.recovered },
    { key: 'avgTouches', label: 'Avg touches', render: r => r.avgTouches, align: 'right', sortable: true, sortValue: r => r.avgTouches },
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
          <h1 className="text-2xl font-bold text-gray-900">Bookings from Outreach</h1>
          <p className="text-gray-500 text-sm mt-0.5">Bookings the Follow-Up module recovered, and the deferred revenue they brought back</p>
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Bookings attributed" value={data?.totalBookings || 0} valueClassName="text-primary" />
        <StatCard label="Est. revenue recovered" value={formatCurrency(data?.totalRecovered || 0)} valueClassName="text-green-600" />
        <StatCard label="Avg deferred £ / booking" value={formatCurrency(data && data.totalBookings ? data.totalRecovered / data.totalBookings : 0)} />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Break down by</span>
        <select
          value={dimension}
          onChange={e => setDimension(e.target.value as Dimension)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        >
          {DIMENSIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
        <>
          <ChartCard title="Recovered revenue by group">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={groups}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Bar dataKey="recovered" name="Recovered" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4"><h3 className="font-semibold text-gray-900">Breakdown by {dimensionLabel.toLowerCase()}</h3></div>
            <DataTable columns={columns} data={groups} rowKey={r => r.key} pageSize={12} emptyMessage="No outreach-attributed bookings in this period" />
          </div>
        </>
      )}
    </div>
  )
}
