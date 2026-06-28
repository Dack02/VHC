import { Link } from 'react-router-dom'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatDate } from './utils/formatters'
import { CHART_COLORS } from './utils/colors'

interface DayRow {
  date: string
  availableHours: number
  bookedHours: number
  ceilingHours: number
  utilisationPct: number | null
  band: 'closed' | 'low' | 'healthy' | 'high' | 'over'
  totalJobs: number
}

interface CapacityData {
  period: { from: string; to: string }
  targetLoadingPct: number
  days: DayRow[]
  totals: {
    availableHours: number
    bookedHours: number
    ceilingHours: number
    utilisationPct: number | null
    vsTargetPct: number | null
    daysOpen: number
    daysOver: number
    daysUnder: number
  }
}

const BAND_LABEL: Record<DayRow['band'], string> = {
  closed: 'Closed', low: 'Underloaded', healthy: 'Healthy', high: 'At target', over: 'Over'
}
const BAND_CLASS: Record<DayRow['band'], string> = {
  closed: 'bg-gray-100 text-gray-500',
  low: 'bg-blue-50 text-blue-700',
  healthy: 'bg-green-50 text-green-700',
  high: 'bg-amber-50 text-amber-700',
  over: 'bg-red-50 text-red-700'
}

export default function CapacityUtilisation() {
  const { filters, queryString, setDatePreset, setCustomDateRange, setGroupBy, setSiteId } = useReportFilters()
  const { data, loading, error } = useReportData<CapacityData>({
    endpoint: '/api/v1/reports/capacity-utilisation',
    queryString,
  })

  const chartData = (data?.days || []).map(d => ({
    label: formatDate(d.date),
    booked: d.bookedHours,
    available: d.availableHours,
    ceiling: d.ceilingHours,
  }))

  const columns: Column<DayRow>[] = [
    { key: 'date', label: 'Day', render: r => formatDate(r.date) },
    { key: 'available', label: 'Available', render: r => `${r.availableHours}h`, align: 'right', sortable: true, sortValue: r => r.availableHours },
    { key: 'ceiling', label: 'Target', render: r => `${r.ceilingHours}h`, align: 'right', sortable: true, sortValue: r => r.ceilingHours },
    { key: 'booked', label: 'Booked', render: r => `${r.bookedHours}h`, align: 'right', sortable: true, sortValue: r => r.bookedHours },
    { key: 'util', label: 'Utilisation', render: r => r.utilisationPct == null ? '—' : `${r.utilisationPct}%`, align: 'right', sortable: true, sortValue: r => r.utilisationPct ?? -1 },
    { key: 'band', label: 'Status', render: r => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BAND_CLASS[r.band]}`}>{BAND_LABEL[r.band]}</span>
    ) },
    { key: 'jobs', label: 'Jobs', render: r => r.totalJobs, align: 'right', sortable: true, sortValue: r => r.totalJobs },
  ]

  const t = data?.totals

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/reports" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Capacity utilisation</h1>
          <p className="text-gray-500 text-sm mt-0.5">Booked vs available hours against your loading target</p>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Utilisation" value={t?.utilisationPct == null ? '—' : `${t.utilisationPct}%`} />
            <StatCard label={`vs target (${data?.targetLoadingPct ?? 85}%)`} value={t?.vsTargetPct == null ? '—' : `${t.vsTargetPct}%`} />
            <StatCard label="Days over capacity" value={t?.daysOver ?? 0} />
            <StatCard label="Underloaded days" value={t?.daysUnder ?? 0} />
          </div>

          <ChartCard title="Booked vs available hours">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="available" name="Available" fill={CHART_COLORS.grayLight} radius={[4, 4, 0, 0]} />
                <Bar dataKey="booked" name="Booked" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                <Line dataKey="ceiling" name="Target" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Daily breakdown</h2>
              <p className="text-sm text-gray-500 mt-0.5">Per-day load against the {data?.targetLoadingPct ?? 85}% target</p>
            </div>
            <DataTable columns={columns} data={data?.days || []} rowKey={r => r.date} pageSize={31} />
          </div>
        </>
      )}
    </div>
  )
}
