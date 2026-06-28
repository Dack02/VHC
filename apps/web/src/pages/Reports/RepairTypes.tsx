import { Link } from 'react-router-dom'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatPercent, formatNumber } from './utils/formatters'

interface RepairTypeRow {
  repairTypeId: string | null
  code: string
  label: string
  colour: string | null
  itemCount: number
  identified: number
  authorised: number
  declined: number
  deferred: number
  conversionPct: number | null
  mixPct: number | null
}

interface VehicleSliceRow {
  repairTypeId: string | null
  code: string
  value: string
  itemCount: number
  identified: number
  authorised: number
}

interface RepairTypeReport {
  rows: RepairTypeRow[]
  totals: { identified: number; authorised: number; declined: number; deferred: number; itemCount: number; conversionPct: number | null }
  byMake: VehicleSliceRow[]
  byFuel: VehicleSliceRow[]
}

// Aggregate the per-(type × value) slice rows into per-value totals for a digestible overview.
function aggregateSlice(rows: VehicleSliceRow[]): Array<{ value: string; identified: number; authorised: number; itemCount: number }> {
  const m = new Map<string, { value: string; identified: number; authorised: number; itemCount: number }>()
  for (const r of rows) {
    const key = r.value.toLowerCase()
    let acc = m.get(key)
    if (!acc) { acc = { value: r.value, identified: 0, authorised: 0, itemCount: 0 }; m.set(key, acc) }
    acc.identified += r.identified
    acc.authorised += r.authorised
    acc.itemCount += r.itemCount
  }
  return [...m.values()].sort((a, b) => b.identified - a.identified)
}

export default function RepairTypes() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<RepairTypeReport>({
    endpoint: '/api/v1/reports/repair-types',
    queryString,
  })

  const t = data?.totals
  const rows = data?.rows || []
  const maxIdentified = Math.max(1, ...rows.map(r => r.identified))
  const byMake = aggregateSlice(data?.byMake || []).slice(0, 10)
  const byFuel = aggregateSlice(data?.byFuel || [])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Repair Types</h1>
          <p className="text-gray-500 text-sm mt-1">Revenue, conversion and work-mix by repair type</p>
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
            <StatCard label="Revenue Identified" value={formatCurrency(t?.identified || 0)} />
            <StatCard label="Revenue Sold" value={formatCurrency(t?.authorised || 0)} valueClassName="text-green-600" />
            <StatCard label="Conversion" value={formatPercent(t?.conversionPct || 0)} valueClassName="text-primary" />
            <StatCard label="Work Items" value={formatNumber(t?.itemCount || 0)} />
          </div>

          {/* Per repair type */}
          <ChartCard title="By Repair Type">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No priced work in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">Repair Type</th>
                      <th className="py-2 px-2 text-right">Items</th>
                      <th className="py-2 px-2 text-right">Identified</th>
                      <th className="py-2 px-2 text-right">Sold</th>
                      <th className="py-2 px-2 text-right">Conversion</th>
                      <th className="py-2 pl-2 w-40">Mix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.repairTypeId ?? 'unassigned'} className="hover:bg-gray-50">
                        <td className="py-2 pr-4">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.colour || '#9CA3AF' }} />
                            <span className={`font-medium ${r.repairTypeId ? 'text-gray-900' : 'text-gray-400 italic'}`}>{r.label}</span>
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatNumber(r.itemCount)}</td>
                        <td className="py-2 px-2 text-right text-gray-900">{formatCurrency(r.identified)}</td>
                        <td className="py-2 px-2 text-right text-green-600">{formatCurrency(r.authorised)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{r.conversionPct != null ? formatPercent(r.conversionPct) : '—'}</td>
                        <td className="py-2 pl-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(r.identified / maxIdentified) * 100}%`, backgroundColor: r.colour || '#9CA3AF' }} />
                            </div>
                            <span className="text-xs text-gray-400 w-10 text-right">{r.mixPct != null ? `${r.mixPct.toFixed(0)}%` : '—'}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>

          {/* Vehicle slices */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="By Vehicle Brand">
              <SliceTable rows={byMake} emptyLabel="No vehicle data in this period." />
            </ChartCard>
            <ChartCard title="By Fuel Type">
              <SliceTable rows={byFuel} emptyLabel="No vehicle data in this period." />
            </ChartCard>
          </div>

          <p className="text-xs text-gray-400">
            Revenue figures match the dashboard / Item Performance reports (same value rules). Margin is not shown — it
            arrives with the Parts module. Work without a repair type is grouped under “Unassigned”.
          </p>
        </>
      )}
    </div>
  )
}

function SliceTable({ rows, emptyLabel }: { rows: Array<{ value: string; identified: number; authorised: number; itemCount: number }>; emptyLabel: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400 py-8 text-center">{emptyLabel}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
            <th className="py-2 pr-4">Value</th>
            <th className="py-2 px-2 text-right">Items</th>
            <th className="py-2 px-2 text-right">Identified</th>
            <th className="py-2 px-2 text-right">Sold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(r => (
            <tr key={r.value} className="hover:bg-gray-50">
              <td className="py-2 pr-4 font-medium text-gray-900">{r.value}</td>
              <td className="py-2 px-2 text-right text-gray-600">{formatNumber(r.itemCount)}</td>
              <td className="py-2 px-2 text-right text-gray-900">{formatCurrency(r.identified)}</td>
              <td className="py-2 px-2 text-right text-green-600">{formatCurrency(r.authorised)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
