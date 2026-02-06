import { Link } from 'react-router-dom'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import ReportFiltersBar from './components/ReportFiltersBar'
import ExportButton from './components/ExportButton'
import { formatCurrency, formatPercent, formatNumber, formatDateFull } from './utils/formatters'

interface DailyOverviewDay {
  date: string
  jobsQty: number
  noShows: number
  hcQty: number
  conversionRate: number
  sendRate: number
  totalIdentified: number
  totalSold: number
  mriIdentified: number
  mriSold: number
  redSoldPercent: number
  amberSoldPercent: number
}

interface DailyOverviewData {
  period: { from: string; to: string }
  days: DailyOverviewDay[]
  totals: {
    jobsQty: number
    noShows: number
    hcQty: number
    conversionRate: number
    sendRate: number
    totalIdentified: number
    totalSold: number
    mriIdentified: number
    mriSold: number
    redSoldPercent: number
    amberSoldPercent: number
  }
}

function conversionColor(rate: number): string {
  if (rate >= 80) return 'text-green-600'
  if (rate >= 60) return 'text-amber-600'
  return 'text-red-600'
}

export default function DailyOverview() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<DailyOverviewData>({
    endpoint: '/api/v1/reports/daily-overview',
    queryString,
  })

  const t = data?.totals

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/reports" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Overview</h1>
            <p className="text-gray-500 text-sm mt-0.5">Daily performance, revenue, conversion</p>
          </div>
        </div>
        <ExportButton
          endpoint="/api/v1/reports/daily-overview/export"
          queryString={queryString}
          filename={`daily-overview-${new Date().toISOString().split('T')[0]}.csv`}
        />
      </div>

      {/* Filters — hide group_by since this is always daily */}
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
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="sticky left-0 bg-gray-50 z-10 px-3 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">Date</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">Jobs</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">No Show</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">HCs</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">Conv%</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">Send%</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">Identified</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">Sold</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">MRI Id.</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">MRI Sold</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">% Red Sold</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">% Amber Sold</th>
                </tr>
              </thead>
              <tbody>
                {data?.days.map((day, i) => (
                  <tr key={day.date} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-gray-50`}>
                    <td className="sticky left-0 bg-white z-10 px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap"
                        style={i % 2 === 1 ? { backgroundColor: 'rgb(249 250 251 / 0.5)' } : undefined}>
                      {formatDateFull(day.date)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(day.jobsQty)}</td>
                    <td className={`px-3 py-2.5 text-right ${day.noShows > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      {day.noShows}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(day.hcQty)}</td>
                    <td className={`px-3 py-2.5 text-right font-medium ${conversionColor(day.conversionRate)}`}>
                      {formatPercent(day.conversionRate)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-medium ${day.sendRate >= 80 ? 'text-green-600' : day.sendRate >= 60 ? 'text-amber-600' : 'text-blue-600'}`}>
                      {formatPercent(day.sendRate)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{formatCurrency(day.totalIdentified)}</td>
                    <td className="px-3 py-2.5 text-right text-green-600 font-medium">{formatCurrency(day.totalSold)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{formatCurrency(day.mriIdentified)}</td>
                    <td className="px-3 py-2.5 text-right text-green-600 font-medium">{formatCurrency(day.mriSold)}</td>
                    <td className={`px-3 py-2.5 text-right font-medium ${day.redSoldPercent > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {formatPercent(day.redSoldPercent)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-medium ${day.amberSoldPercent > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {formatPercent(day.amberSoldPercent)}
                    </td>
                  </tr>
                ))}
                {(!data?.days || data.days.length === 0) && (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-gray-400">
                      No data for the selected period
                    </td>
                  </tr>
                )}
              </tbody>
              {t && data?.days && data.days.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 font-bold border-t-2 border-gray-300 sticky bottom-0">
                    <td className="sticky left-0 bg-gray-50 z-10 px-3 py-3 text-gray-900">Totals</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatNumber(t.jobsQty)}</td>
                    <td className={`px-3 py-3 text-right ${t.noShows > 0 ? 'text-red-600' : 'text-gray-900'}`}>{t.noShows}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatNumber(t.hcQty)}</td>
                    <td className={`px-3 py-3 text-right ${conversionColor(t.conversionRate)}`}>
                      {formatPercent(t.conversionRate)}
                    </td>
                    <td className={`px-3 py-3 text-right ${t.sendRate >= 80 ? 'text-green-600' : t.sendRate >= 60 ? 'text-amber-600' : 'text-blue-600'}`}>
                      {formatPercent(t.sendRate)}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(t.totalIdentified)}</td>
                    <td className="px-3 py-3 text-right text-green-600">{formatCurrency(t.totalSold)}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(t.mriIdentified)}</td>
                    <td className="px-3 py-3 text-right text-green-600">{formatCurrency(t.mriSold)}</td>
                    <td className={`px-3 py-3 text-right ${t.redSoldPercent > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {formatPercent(t.redSoldPercent)}
                    </td>
                    <td className={`px-3 py-3 text-right ${t.amberSoldPercent > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                      {formatPercent(t.amberSoldPercent)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
