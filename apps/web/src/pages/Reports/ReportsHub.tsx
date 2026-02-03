import { Link } from 'react-router-dom'
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import ReportFiltersBar from './components/ReportFiltersBar'
import ExportButton from './components/ExportButton'
import { formatCurrency, formatPercent, formatNumber, formatDate, trendDirection, trendPercent } from './utils/formatters'
import { CHART_COLORS, FUNNEL_COLORS } from './utils/colors'

interface SummaryData {
  period: { from: string; to: string }
  summary: {
    total: number
    completed: number
    sent: number
    authorized: number
    declined: number
    pending: number
    conversionRate: number
    totalValueIdentified: number
    totalValueAuthorized: number
    totalValueDeclined: number
  }
  chartData: Array<{
    period: string
    total: number
    completed: number
    authorized: number
    declined: number
    value: number
  }>
  technicianMetrics: Array<{ id: string; name: string; total: number; completed: number }>
  advisorMetrics: Array<{ id: string; name: string; total: number; sent: number; authorized: number; conversionRate: number; totalValue: number }>
  previousPeriod?: {
    total: number
    completed: number
    sent: number
    authorized: number
    totalValueIdentified: number
    totalValueAuthorized: number
    conversionRate: number
  }
}

interface NavCard {
  to: string
  title: string
  description: string
  icon: React.ReactNode
}

const navCards: NavCard[] = [
  {
    to: '/reports/daily-overview',
    title: 'Daily Overview',
    description: 'Daily performance, revenue, conversion',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    to: '/reports/financial',
    title: 'Financial',
    description: 'Revenue, margins, parts vs labour',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/technicians',
    title: 'Technicians',
    description: 'KPIs, inspection times, quality',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/advisors',
    title: 'Advisors',
    description: 'Conversion, pricing speed, revenue',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/customers',
    title: 'Customers',
    description: 'Engagement, decline analysis',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    to: '/reports/operations',
    title: 'Operations',
    description: 'Bottlenecks, turnaround, throughput',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    to: '/reports/compliance',
    title: 'Quality & Compliance',
    description: 'Brake disc, MRI, audit trail',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    to: '/reports/deferred',
    title: 'Deferred Work',
    description: 'Deferred items, due dates, follow-ups',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/mri-performance',
    title: 'MRI Performance',
    description: 'Scan outcomes, flag rates, revenue',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
]

export default function ReportsHub() {
  const {
    filters, queryString,
    setDatePreset, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<SummaryData>({
    endpoint: '/api/v1/reports',
    queryString,
  })

  const s = data?.summary
  const prev = data?.previousPeriod

  // Build funnel data from summary
  const funnelData = s ? [
    { name: 'Created', value: s.total },
    { name: 'Completed', value: s.completed },
    { name: 'Sent', value: s.sent },
    { name: 'Authorized', value: s.authorized },
  ].filter(d => d.value > 0) : []

  // Chart data formatted for display
  const chartData = data?.chartData.map(d => ({
    ...d,
    label: formatDate(d.period),
  })) || []

  // Revenue chart data
  const revenueData = data?.chartData.map(d => ({
    label: formatDate(d.period),
    authorized: d.value,
    total: d.total,
  })) || []

  const captureRate = s && s.totalValueIdentified > 0
    ? (s.totalValueAuthorized / s.totalValueIdentified) * 100
    : 0

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm mt-1">Executive overview and analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            endpoint="/api/v1/reports/export"
            queryString={queryString}
            filename={`reports-${new Date().toISOString().split('T')[0]}.csv`}
          />
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
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard
              label="Health Checks"
              value={formatNumber(s?.total || 0)}
              trend={prev ? { direction: trendDirection(s?.total || 0, prev.total), percent: trendPercent(s?.total || 0, prev.total) } : undefined}
            />
            <StatCard
              label="Completion Rate"
              value={s && s.total > 0 ? formatPercent((s.completed / s.total) * 100) : '0%'}
              valueClassName="text-primary"
            />
            <StatCard
              label="Conversion Rate"
              value={formatPercent(s?.conversionRate || 0)}
              valueClassName="text-primary"
              trend={prev ? { direction: trendDirection(s?.conversionRate || 0, prev.conversionRate), percent: trendPercent(s?.conversionRate || 0, prev.conversionRate) } : undefined}
            />
            <StatCard
              label="Revenue Authorized"
              value={formatCurrency(s?.totalValueAuthorized || 0)}
              valueClassName="text-green-600"
              trend={prev ? { direction: trendDirection(s?.totalValueAuthorized || 0, prev.totalValueAuthorized), percent: trendPercent(s?.totalValueAuthorized || 0, prev.totalValueAuthorized) } : undefined}
            />
            <StatCard
              label="Revenue Identified"
              value={formatCurrency(s?.totalValueIdentified || 0)}
            />
            <StatCard
              label="Capture Rate"
              value={formatPercent(captureRate)}
              valueClassName={captureRate >= 50 ? 'text-green-600' : captureRate >= 30 ? 'text-amber-600' : 'text-red-600'}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Health Check Volume */}
            <ChartCard title="Health Check Volume">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="total" name="Total" fill={CHART_COLORS.grayLight} radius={[4, 4, 0, 0]} />
                  <Line dataKey="authorized" name="Authorized" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Revenue Trend */}
            <ChartCard title="Revenue Trend">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Area
                    type="monotone"
                    dataKey="authorized"
                    name="Authorized"
                    stroke={CHART_COLORS.primary}
                    fill={CHART_COLORS.primaryLight}
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Conversion Funnel */}
          {funnelData.length > 0 && (
            <ChartCard title="Conversion Funnel">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={funnelData} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {funnelData.map((_, index) => (
                      <rect key={index} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* Navigation Grid */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Detailed Reports</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {navCards.map(card => (
                <Link
                  key={card.to}
                  to={card.to}
                  className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-primary hover:shadow-sm transition-all"
                >
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0 text-gray-400">{card.icon}</div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900">{card.title}</h3>
                      <p className="text-xs text-gray-500 mt-1">{card.description}</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
