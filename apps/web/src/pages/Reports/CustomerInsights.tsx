import { Link } from 'react-router-dom'
import {
  BarChart, Bar, PieChart, Pie, Cell,
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
  authorizationChannel: {
    online: { count: number; value: number }
    manual: { count: number; value: number }
    onlinePercent: number
    manualBreakdown: Record<string, { count: number; value: number }>
  }
  approvalRate: {
    totalItemsSent: number
    totalItemsApproved: number
    rate: number
    avgValueOnline: number
    avgValueManual: number
  }
  timeToAuthorize: {
    avgHours: number
    distribution: Array<{ bucket: string; count: number }>
  }
  deviceBreakdown: Record<string, number>
  engagementFunnel: {
    sent: number
    opened: number
    responded: number
    signed: number
  }
}

const MANUAL_METHOD_LABELS: Record<string, string> = {
  in_person: 'In Person',
  phone: 'Phone',
  not_sent: 'Not Sent',
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
  const ac = data?.authorizationChannel
  const ar = data?.approvalRate
  const tta = data?.timeToAuthorize
  const funnel = data?.engagementFunnel
  const device = data?.deviceBreakdown

  // Pie data for authorization channel
  const authPieData = ac ? [
    { name: 'Online', value: ac.online.count },
    { name: 'Manual', value: ac.manual.count },
  ].filter(d => d.value > 0) : []
  const authPieColors = [CHART_COLORS.primary, CHART_COLORS.quaternary]

  // Pie data for device breakdown
  const devicePieData = device ? [
    { name: 'Mobile', value: device.mobile || 0 },
    { name: 'Tablet', value: device.tablet || 0 },
    { name: 'Desktop', value: device.desktop || 0 },
  ].filter(d => d.value > 0) : []
  const devicePieColors = [CHART_COLORS.primary, CHART_COLORS.tertiary, CHART_COLORS.secondary]

  // Funnel data
  const funnelData = funnel ? [
    { stage: 'Sent', count: funnel.sent },
    { stage: 'Opened', count: funnel.opened },
    { stage: 'Responded', count: funnel.responded },
    { stage: 'Signed', count: funnel.signed },
  ] : []

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
          <p className="text-gray-500 text-sm mt-0.5">Engagement, authorization channels, response patterns</p>
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

          {/* Authorization Channel */}
          {ac && (ac.online.count > 0 || ac.manual.count > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Donut: Online vs Manual */}
              <ChartCard title="Authorization Channel">
                {authPieData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={authPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                        >
                          {authPieData.map((_, i) => (
                            <Cell key={i} fill={authPieColors[i]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-6 mt-2 text-sm">
                      <span className="text-gray-600">Online: {formatCurrency(ac.online.value)}</span>
                      <span className="text-gray-600">Manual: {formatCurrency(ac.manual.value)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-[240px] text-gray-400 text-sm">No authorization data</div>
                )}
              </ChartCard>

              {/* Manual Breakdown */}
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Manual Authorization Breakdown</h2>
                <div className="space-y-4">
                  {Object.entries(ac.manualBreakdown).map(([method, { count, value }]) => {
                    const totalManual = ac.manual.count || 1
                    const pct = Math.round((count / totalManual) * 100)
                    return (
                      <div key={method}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700">{MANUAL_METHOD_LABELS[method] || method}</span>
                          <span className="text-gray-500">{count} items &middot; {formatCurrency(value)}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2.5">
                          <div
                            className="bg-orange-400 h-2.5 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {ac.manual.count === 0 && (
                    <div className="text-gray-400 text-sm text-center py-6">No manual authorizations</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Approval & Timing StatCards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Item Approval Rate"
              value={formatPercent(ar?.rate || 0)}
              valueClassName="text-primary"
            />
            <StatCard
              label="Avg Value (Online)"
              value={ar?.avgValueOnline ? formatCurrency(ar.avgValueOnline) : '-'}
            />
            <StatCard
              label="Avg Value (Manual)"
              value={ar?.avgValueManual ? formatCurrency(ar.avgValueManual) : '-'}
            />
            <StatCard
              label="Avg Time to Authorize"
              value={tta?.avgHours ? formatDuration(tta.avgHours * 60) : '-'}
            />
          </div>

          {/* Charts 2x2 Grid */}
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

            {/* Time to Authorize Distribution */}
            <ChartCard title="Time to Authorize (Online)">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={tta?.distribution || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Items" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Responses by Day of Week */}
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

            {/* Device Breakdown */}
            <ChartCard title="Device Type (Portal Views)">
              {devicePieData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={devicePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                      >
                        {devicePieData.map((_, i) => (
                          <Cell key={i} fill={devicePieColors[i]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `${value}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-4 mt-2 text-sm text-gray-600">
                    <span>Mobile: {device?.mobile || 0}%</span>
                    <span>Tablet: {device?.tablet || 0}%</span>
                    <span>Desktop: {device?.desktop || 0}%</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-[280px] text-gray-400 text-sm">No device data</div>
              )}
            </ChartCard>
          </div>

          {/* Engagement Funnel */}
          {funnel && funnel.sent > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Engagement Funnel</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={funnelData} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 13, fontWeight: 500 }} width={90} />
                  <Tooltip formatter={(value) => {
                    const v = Number(value) || 0
                    const pct = funnel.sent > 0 ? ((v / funnel.sent) * 100).toFixed(1) : '0'
                    return `${v} (${pct}%)`
                  }} />
                  <Bar dataKey="count" name="Reports" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

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
