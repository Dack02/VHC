import { Link } from 'react-router-dom'
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatPercent, formatNumber, formatDate } from './utils/formatters'
import { CHART_COLORS, RAG_COLORS, FUNNEL_COLORS } from './utils/colors'

interface MriPerformanceData {
  period: { from: string; to: string }
  summary: {
    totalScans: number
    totalItemsScanned: number
    totalFlagged: number
    flagRate: number
    totalRecommended: number
    repairItemsCreated: number
    conversionToRepairRate: number
    revenueIdentified: number
    revenueAuthorized: number
    captureRate: number
    avgItemsPerScan: number
    notApplicableCount: number
    alreadyBookedCount: number
    notDueYetCount: number
  }
  ragDistribution: {
    red: number
    amber: number
    green: number
    notDueYet: number
    notApplicable: number
  }
  itemBreakdown: Array<{
    mriItemId: string
    name: string
    category: string
    itemType: string
    timesScanned: number
    flaggedRed: number
    flaggedAmber: number
    flaggedGreen: number
    notApplicable: number
    recommended: number
    repairItems: number
    revenueIdentified: number
    revenueAuthorized: number
    flagRate: number
    authRate: number
  }>
  advisorMetrics: Array<{
    id: string
    name: string
    scans: number
    itemsScanned: number
    flagged: number
    flagRate: number
    naCount: number
    naRate: number
    revenueIdentified: number
    revenueAuthorized: number
    bypassed: number
    bypassRate: number
  }>
  conversionFunnel: {
    scanned: number
    flagged: number
    repairCreated: number
    authorised: number
    declined: number
    deferred: number
  }
  timeline: Array<{
    period: string
    scans: number
    flagged: number
    flagRate: number
    revenueIdentified: number
    revenueAuthorized: number
  }>
  topFlaggedItems: Array<{
    name: string
    flagCount: number
    revenueIdentified: number
  }>
}

export default function MriPerformance() {
  const {
    filters, queryString,
    setDatePreset, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<MriPerformanceData>({
    endpoint: '/api/v1/reports/mri-performance',
    queryString,
  })

  const s = data?.summary

  const ragData = data?.ragDistribution ? [
    { name: 'Red', value: data.ragDistribution.red, color: RAG_COLORS.red },
    { name: 'Amber', value: data.ragDistribution.amber, color: RAG_COLORS.amber },
    { name: 'Green', value: data.ragDistribution.green, color: '#22c55e' },
    { name: 'Not Due', value: data.ragDistribution.notDueYet, color: CHART_COLORS.gray },
    { name: 'N/A', value: data.ragDistribution.notApplicable, color: CHART_COLORS.grayLight },
  ].filter(d => d.value > 0) : []

  const trendData = data?.timeline.map(d => ({
    ...d,
    label: formatDate(d.period),
  })) || []

  const funnelData = data?.conversionFunnel ? [
    { name: 'Scanned', value: data.conversionFunnel.scanned },
    { name: 'Flagged', value: data.conversionFunnel.flagged },
    { name: 'Repair Created', value: data.conversionFunnel.repairCreated },
    { name: 'Authorised', value: data.conversionFunnel.authorised },
  ].filter(d => d.value > 0) : []

  const revenueData = data?.timeline.map(d => ({
    label: formatDate(d.period),
    authorized: d.revenueAuthorized,
    identified: d.revenueIdentified,
  })) || []

  const itemColumns: Column<MriPerformanceData['itemBreakdown'][0]>[] = [
    { key: 'name', label: 'Item', render: r => <span className="font-medium text-gray-900">{r.name}</span>, sortable: true, sortValue: r => r.name },
    { key: 'category', label: 'Category', render: r => <span className="text-gray-500 text-xs">{r.category}</span> },
    { key: 'itemType', label: 'Type', render: r => (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
        {r.itemType === 'date_mileage' ? 'Date/Mileage' : 'Yes/No'}
      </span>
    )},
    { key: 'timesScanned', label: 'Scanned', render: r => formatNumber(r.timesScanned), align: 'right', sortable: true, sortValue: r => r.timesScanned },
    { key: 'flaggedRed', label: 'Red', render: r => (
      <span className={r.flaggedRed > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{r.flaggedRed}</span>
    ), align: 'right', sortable: true, sortValue: r => r.flaggedRed },
    { key: 'flaggedAmber', label: 'Amber', render: r => (
      <span className={r.flaggedAmber > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}>{r.flaggedAmber}</span>
    ), align: 'right', sortable: true, sortValue: r => r.flaggedAmber },
    { key: 'flagRate', label: 'Flag Rate', render: r => (
      <span className={r.flagRate >= 30 ? 'text-green-600' : r.flagRate >= 15 ? 'text-amber-600' : 'text-gray-500'}>
        {formatPercent(r.flagRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.flagRate },
    { key: 'repairItems', label: 'Repairs', render: r => r.repairItems, align: 'right', sortable: true, sortValue: r => r.repairItems },
    { key: 'revenueIdentified', label: 'Identified', render: r => formatCurrency(r.revenueIdentified), align: 'right', sortable: true, sortValue: r => r.revenueIdentified },
    { key: 'revenueAuthorized', label: 'Authorized', render: r => (
      <span className="text-green-600 font-medium">{formatCurrency(r.revenueAuthorized)}</span>
    ), align: 'right', sortable: true, sortValue: r => r.revenueAuthorized },
    { key: 'authRate', label: 'Auth Rate', render: r => (
      <span className={r.authRate >= 50 ? 'text-green-600' : r.authRate >= 30 ? 'text-amber-600' : 'text-red-600'}>
        {formatPercent(r.authRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.authRate },
  ]

  const advisorColumns: Column<MriPerformanceData['advisorMetrics'][0]>[] = [
    { key: 'name', label: 'Advisor', render: r => <span className="font-medium text-gray-900">{r.name}</span>, sortable: true, sortValue: r => r.name },
    { key: 'scans', label: 'Scans', render: r => formatNumber(r.scans), align: 'right', sortable: true, sortValue: r => r.scans },
    { key: 'itemsScanned', label: 'Items', render: r => formatNumber(r.itemsScanned), align: 'right', sortable: true, sortValue: r => r.itemsScanned },
    { key: 'flagRate', label: 'Flag Rate', render: r => (
      <span className={r.flagRate >= 30 ? 'text-green-600' : r.flagRate >= 15 ? 'text-amber-600' : 'text-gray-500'}>
        {formatPercent(r.flagRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.flagRate },
    { key: 'naRate', label: 'N/A Rate', render: r => (
      <span className={r.naRate > 30 ? 'text-red-600' : 'text-gray-600'}>{formatPercent(r.naRate)}</span>
    ), align: 'right', sortable: true, sortValue: r => r.naRate },
    { key: 'revenueIdentified', label: 'Identified', render: r => formatCurrency(r.revenueIdentified), align: 'right', sortable: true, sortValue: r => r.revenueIdentified },
    { key: 'revenueAuthorized', label: 'Authorized', render: r => (
      <span className="text-green-600 font-medium">{formatCurrency(r.revenueAuthorized)}</span>
    ), align: 'right', sortable: true, sortValue: r => r.revenueAuthorized },
    { key: 'bypassed', label: 'Bypassed', render: r => (
      <span className={r.bypassed > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{r.bypassed}</span>
    ), align: 'right', sortable: true, sortValue: r => r.bypassed },
    { key: 'bypassRate', label: 'Bypass Rate', render: r => (
      <span className={r.bypassRate > 10 ? 'text-red-600' : r.bypassRate > 0 ? 'text-amber-600' : 'text-green-600'}>
        {formatPercent(r.bypassRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.bypassRate },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/reports" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">MRI Performance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Scan outcomes, flag rates, revenue conversion</p>
        </div>
      </div>

      {/* Filters */}
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
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard label="MRI Scans" value={formatNumber(s?.totalScans || 0)} />
            <StatCard
              label="Items Flagged"
              value={formatNumber(s?.totalFlagged || 0)}
              valueClassName={s && s.totalFlagged > 0 ? 'text-red-600' : undefined}
            />
            <StatCard
              label="Flag Rate"
              value={formatPercent(s?.flagRate || 0)}
              valueClassName={
                s && s.flagRate >= 30 ? 'text-green-600'
                : s && s.flagRate >= 15 ? 'text-amber-600'
                : 'text-red-600'
              }
            />
            <StatCard
              label="Revenue Identified"
              value={formatCurrency(s?.revenueIdentified || 0)}
            />
            <StatCard
              label="Revenue Authorized"
              value={formatCurrency(s?.revenueAuthorized || 0)}
              valueClassName="text-green-600"
            />
            <StatCard
              label="Capture Rate"
              value={formatPercent(s?.captureRate || 0)}
              valueClassName={
                s && s.captureRate >= 50 ? 'text-green-600'
                : s && s.captureRate >= 30 ? 'text-amber-600'
                : 'text-red-600'
              }
            />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* MRI Trend Over Time */}
            <ChartCard title="MRI Trend Over Time" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={(value, name) =>
                    name === 'Flag Rate' ? `${Number(value).toFixed(1)}%` : value
                  } />
                  <Legend />
                  <Bar yAxisId="left" dataKey="scans" name="Scans" fill={CHART_COLORS.primaryLight} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" dataKey="flagRate" name="Flag Rate" stroke={RAG_COLORS.red} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* RAG Distribution */}
            <ChartCard title="RAG Distribution">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={ragData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  >
                    {ragData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top 10 Flagged Items */}
            <ChartCard title="Top 10 Flagged Items" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data?.topFlaggedItems || []} layout="vertical" barCategoryGap="15%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip formatter={(value, name) =>
                    name === 'Revenue' ? formatCurrency(Number(value)) : value
                  } />
                  <Legend />
                  <Bar dataKey="flagCount" name="Flags" fill={RAG_COLORS.amber} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Conversion Funnel */}
            <ChartCard title="Conversion Funnel">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={funnelData} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {funnelData.map((_, i) => (
                      <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Revenue Timeline */}
          <ChartCard title="MRI Revenue Over Time">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="identified"
                  name="Identified"
                  stroke={CHART_COLORS.gray}
                  fill={CHART_COLORS.grayLight}
                  fillOpacity={0.4}
                  stackId="1"
                />
                <Area
                  type="monotone"
                  dataKey="authorized"
                  name="Authorized"
                  stroke="#22c55e"
                  fill="#22c55e"
                  fillOpacity={0.3}
                  stackId="2"
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Item Breakdown Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Item Breakdown</h2>
              <p className="text-sm text-gray-500 mt-0.5">Per-item scan results, flag rates, and revenue</p>
            </div>
            <DataTable
              columns={itemColumns}
              data={data?.itemBreakdown || []}
              rowKey={r => r.mriItemId}
              pageSize={15}
              emptyMessage="No MRI scan data available"
            />
          </div>

          {/* Advisor MRI Metrics Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Advisor MRI Metrics</h2>
              <p className="text-sm text-gray-500 mt-0.5">Per-advisor scan performance, flag rates, and bypass tracking</p>
            </div>
            <DataTable
              columns={advisorColumns}
              data={data?.advisorMetrics || []}
              rowKey={r => r.id}
              pageSize={15}
              emptyMessage="No advisor MRI data available"
            />
          </div>
        </>
      )}
    </div>
  )
}
