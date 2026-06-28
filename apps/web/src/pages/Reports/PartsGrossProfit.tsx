import { Link } from 'react-router-dom'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatPercent, formatNumber } from './utils/formatters'

interface PartsGpRow {
  repairTypeId: string | null
  repairTypeName: string
  partCount: number
  totalSell: number
  totalCost: number
  totalMargin: number
  marginPercent: number
}

interface PartsGpReport {
  rows: PartsGpRow[]
  totals: {
    partCount: number
    totalSell: number
    totalCost: number
    totalMargin: number
    marginPercent: number
  }
}

export default function PartsGrossProfit() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<PartsGpReport>({
    endpoint: '/api/v1/reports/parts-gp',
    queryString,
  })

  const t = data?.totals
  const rows = data?.rows || []
  const maxMargin = Math.max(1, ...rows.map(r => r.totalMargin))

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Parts Gross Profit</h1>
          <p className="text-gray-500 text-sm mt-1">Parts margin (sell − cost) by repair type</p>
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
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Parts Sold" value={formatCurrency(t?.totalSell || 0)} />
            <StatCard label="Parts Cost" value={formatCurrency(t?.totalCost || 0)} />
            <StatCard label="Gross Profit" value={formatCurrency(t?.totalMargin || 0)} valueClassName="text-green-600" />
            <StatCard label="Margin" value={formatPercent(t?.marginPercent || 0)} valueClassName="text-primary" />
          </div>

          {/* Per repair type */}
          <ChartCard title="By Repair Type">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No priced parts on authorised work in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">Repair Type</th>
                      <th className="py-2 px-2 text-right">Parts</th>
                      <th className="py-2 px-2 text-right">Sold</th>
                      <th className="py-2 px-2 text-right">Cost</th>
                      <th className="py-2 px-2 text-right">Margin</th>
                      <th className="py-2 px-2 text-right">Margin %</th>
                      <th className="py-2 pl-2 w-40">GP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.repairTypeId ?? 'unassigned'} className="hover:bg-gray-50">
                        <td className="py-2 pr-4">
                          <span className={`font-medium ${r.repairTypeId ? 'text-gray-900' : 'text-gray-400 italic'}`}>{r.repairTypeName}</span>
                        </td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatNumber(r.partCount)}</td>
                        <td className="py-2 px-2 text-right text-gray-900">{formatCurrency(r.totalSell)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatCurrency(r.totalCost)}</td>
                        <td className="py-2 px-2 text-right text-green-600">{formatCurrency(r.totalMargin)}</td>
                        <td className={`py-2 px-2 text-right ${r.marginPercent < 0 ? 'text-red-600' : 'text-gray-600'}`}>{formatPercent(r.marginPercent)}</td>
                        <td className="py-2 pl-2">
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-500"
                              style={{ width: `${Math.max(0, (r.totalMargin / maxMargin) * 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>

          <p className="text-xs text-gray-400">
            Margin = parts sell (line total) − parts cost (cost price × qty) on authorised work. Closes the deferred
            Repair Types margin view. Work without a repair type is grouped under “Unassigned”.
          </p>
        </>
      )}
    </div>
  )
}
