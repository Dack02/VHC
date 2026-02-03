import { Link } from 'react-router-dom'
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatPercent, formatDuration } from './utils/formatters'
import { CHART_COLORS } from './utils/colors'

interface TechnicianData {
  period: { from: string; to: string }
  leaderboard: Array<{
    id: string
    name: string
    assigned: number
    completed: number
    completionRate: number
    avgInspectionTime: number
    avgRedAmber: number
    revenueIdentified: number
    totalInspectedItems: number
    libraryOnlyCount: number
    freeTextOnlyCount: number
    bothCount: number
    noReasonCount: number
    libraryUsageRate: number
  }>
  timeByTech: Array<{ name: string; avgTime: number }>
  timeDistribution: Array<{ bucket: string; count: number }>
  reasonUsageByTech: Array<{ name: string; libraryOnly: number; freeTextOnly: number; both: number }>
}

export default function TechnicianPerformance() {
  const {
    filters, queryString,
    setDatePreset, setGroupBy, setSiteId, setTechnicianId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<TechnicianData>({
    endpoint: '/api/v1/reports/technicians',
    queryString,
  })

  const leaderboardColumns: Column<TechnicianData['leaderboard'][0]>[] = [
    { key: 'name', label: 'Technician', render: r => <span className="font-medium text-gray-900">{r.name}</span>, sortable: true, sortValue: r => r.name },
    { key: 'assigned', label: 'Assigned', render: r => r.assigned, align: 'right', sortable: true, sortValue: r => r.assigned },
    { key: 'completed', label: 'Completed', render: r => r.completed, align: 'right', sortable: true, sortValue: r => r.completed },
    { key: 'completionRate', label: 'Completion %', render: r => (
      <span className={r.completionRate >= 80 ? 'text-green-600' : r.completionRate >= 60 ? 'text-amber-600' : 'text-red-600'}>
        {formatPercent(r.completionRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.completionRate },
    { key: 'avgTime', label: 'Avg Time', render: r => r.avgInspectionTime > 0 ? formatDuration(r.avgInspectionTime) : '-', align: 'right', sortable: true, sortValue: r => r.avgInspectionTime },
    { key: 'avgRedAmber', label: 'Avg Red/Amber', render: r => r.avgRedAmber.toFixed(1), align: 'right', sortable: true, sortValue: r => r.avgRedAmber },
    { key: 'revenue', label: 'Revenue Found', render: r => <span className="font-medium">{formatCurrency(r.revenueIdentified)}</span>, align: 'right', sortable: true, sortValue: r => r.revenueIdentified },
    { key: 'libraryUsage', label: 'Library %', render: r => {
      const rate = r.libraryUsageRate
      const denominator = r.libraryOnlyCount + r.freeTextOnlyCount + r.bothCount
      if (denominator === 0) return <span className="text-gray-400">-</span>
      const color = rate >= 80 ? 'text-green-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600'
      return <span className={`font-medium ${color}`}>{formatPercent(rate)}</span>
    }, align: 'right', sortable: true, sortValue: r => r.libraryUsageRate },
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
          <h1 className="text-2xl font-bold text-gray-900">Technician Performance</h1>
          <p className="text-gray-500 text-sm mt-0.5">KPIs, inspection times, quality metrics</p>
        </div>
      </div>

      <ReportFiltersBar
        datePreset={filters.datePreset}
        groupBy={filters.groupBy}
        siteId={filters.siteId}
        technicianId={filters.technicianId}
        onDatePresetChange={setDatePreset}
        onGroupByChange={setGroupBy}
        onSiteChange={setSiteId}
        onTechnicianChange={setTechnicianId}
        showTechnicianFilter
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
              <h2 className="font-semibold text-gray-900">Technician Leaderboard</h2>
            </div>
            <DataTable
              columns={leaderboardColumns}
              data={data?.leaderboard || []}
              rowKey={r => r.id}
              pageSize={15}
              emptyMessage="No technician data available"
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Avg Inspection Time by Tech */}
            <ChartCard title="Average Inspection Time by Technician">
              <ResponsiveContainer width="100%" height={Math.max(200, (data?.timeByTech.length || 0) * 40)}>
                <BarChart data={data?.timeByTech || []} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} unit=" min" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
                  <Tooltip formatter={(value) => `${Number(value).toFixed(1)} min`} />
                  <Bar dataKey="avgTime" name="Avg Time" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Time Distribution */}
            <ChartCard title="Inspection Time Distribution">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data?.timeDistribution || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Count" fill={CHART_COLORS.tertiary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Reason Library vs Free Text Chart */}
          {data?.reasonUsageByTech && data.reasonUsageByTech.length > 0 && (
            <ChartCard title="Reason Library vs Free Text Usage">
              <ResponsiveContainer width="100%" height={Math.max(200, data.reasonUsageByTech.length * 40)}>
                <BarChart data={data.reasonUsageByTech} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="libraryOnly" name="Library Only" stackId="reasons" fill={CHART_COLORS.primary} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="both" name="Library + Text" stackId="reasons" fill={CHART_COLORS.tertiary} />
                  <Bar dataKey="freeTextOnly" name="Free Text Only" stackId="reasons" fill={CHART_COLORS.quaternary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </>
      )}
    </div>
  )
}
