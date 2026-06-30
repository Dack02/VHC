import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useReportFilters } from './hooks/useReportFilters'
import type { GroupBy } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import ReportFiltersBar from './components/ReportFiltersBar'
import ExportButton from './components/ExportButton'
import { formatCurrency, formatPercent, formatNumber, formatDateFull } from './utils/formatters'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function periodLabel(dateStr: string, groupBy: GroupBy): string {
  if (groupBy === 'month') {
    const [year, month] = dateStr.split('-')
    return `${MONTH_NAMES[Number(month) - 1]} ${year}`
  }
  if (groupBy === 'week') return `w/c ${formatDateFull(dateStr)}`
  return formatDateFull(dateStr)
}

const PERIOD_HEADER: Record<GroupBy, string> = { day: 'Date', week: 'Week', month: 'Month' }

interface CohortBucket {
  identified: number
  authorised: number
  declined: number
  deferred: number
  pending: number
  respondedValue: number
  authPct: number
  declinedPct: number
  deferredPct: number
}
interface CohortTriplet {
  online: CohortBucket
  sentOffline: CohortBucket
  neverSent: CohortBucket
}
interface PeriodRow {
  date: string
  sent: number
  opened: number
  responded: number
  openRate: number
  responseRate: number
  avgHrsToOpen: number | null
  avgHrsToAuthorise: number | null
  redAuthPct: number
  amberAuthPct: number
  redAuthValue: number
  amberAuthValue: number
}
interface AdvisorRow {
  id: string
  name: string
  sent: number
  opened: number
  responded: number
  openRate: number
  responseRate: number
  avgHrsToOpen: number | null
  avgHrsToAuthorise: number | null
  redAuthPct: number
  amberAuthPct: number
  onlineAuthValue: number
  offlineAuthValue: number
  selfServeSharePct: number
}
interface OnlineVhcData {
  period: { from: string; to: string }
  groupBy: GroupBy
  periods: PeriodRow[]
  totals: PeriodRow
  cohorts: { red: CohortTriplet; amber: CohortTriplet }
  advisors: AdvisorRow[]
}

const COHORTS: { key: keyof CohortTriplet; label: string; hint: string }[] = [
  { key: 'online', label: 'Self-served online', hint: 'Customer authorised in the portal' },
  { key: 'sentOffline', label: 'Sent online → offline', hint: 'Link sent, but they called / we called' },
  { key: 'neverSent', label: 'Never sent online', hint: 'Pure offline workflow' },
]

function fmtHrs(h: number | null): string {
  if (h === null || h === undefined) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 48) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

/** The core answer: red/amber £ authorisation split across the three channels. */
function CohortCard({ rag, triplet }: { rag: 'red' | 'amber'; triplet: CohortTriplet }) {
  const accent = rag === 'red' ? 'text-red-600' : 'text-amber-600'
  const dot = rag === 'red' ? 'bg-rag-red' : 'bg-rag-amber'
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        <h3 className="font-semibold text-gray-900 capitalize">{rag} work — authorisation by channel</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-600">
              <th className="text-left px-3 py-2 font-semibold">Channel</th>
              <th className="text-right px-3 py-2 font-semibold">Identified</th>
              <th className="text-right px-3 py-2 font-semibold">Auth £%</th>
              <th className="text-right px-3 py-2 font-semibold">Decl £%</th>
              <th className="text-right px-3 py-2 font-semibold">Defer £%</th>
            </tr>
          </thead>
          <tbody>
            {COHORTS.map(({ key, label, hint }) => {
              const b = triplet[key]
              return (
                <tr key={key} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-gray-900">{label}</div>
                    <div className="text-[11px] text-gray-400">{hint}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{formatCurrency(b.identified)}</td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${b.respondedValue > 0 ? accent : 'text-gray-300'}`}>
                    {b.respondedValue > 0 ? formatPercent(b.authPct) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-500">
                    {b.respondedValue > 0 ? formatPercent(b.declinedPct) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-500">
                    {b.respondedValue > 0 ? formatPercent(b.deferredPct) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortIndicator({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <svg className={`w-3 h-3 shrink-0 ${active ? 'text-gray-900' : 'text-gray-300'}`} viewBox="0 0 12 12"
      fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {!active || dir === 'asc' ? <path d="M3.5 5L6 2.5 8.5 5" /> : null}
      {!active || dir === 'desc' ? <path d="M3.5 7L6 9.5 8.5 7" /> : null}
    </svg>
  )
}

type PeriodSortKey = keyof PeriodRow

export default function OnlineVhcPerformance() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()

  const { data, loading, error } = useReportData<OnlineVhcData>({
    endpoint: '/api/v1/reports/online-vhc',
    queryString,
  })

  const [sortKey, setSortKey] = useState<PeriodSortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: PeriodSortKey) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'date' ? 'asc' : 'desc') }
  }

  const sortedPeriods = useMemo(() => {
    const rows = data?.periods ? [...data.periods] : []
    rows.sort((a, b) => {
      const av = a[sortKey] as number | string | null
      const bv = b[sortKey] as number | string | null
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [data?.periods, sortKey, sortDir])

  const t = data?.totals

  const periodCols: { key: PeriodSortKey; label: string }[] = [
    { key: 'sent', label: 'Sent' },
    { key: 'opened', label: 'Opened' },
    { key: 'openRate', label: 'Open%' },
    { key: 'responded', label: 'Responded' },
    { key: 'responseRate', label: 'Resp%' },
    { key: 'avgHrsToOpen', label: 'Avg→Open' },
    { key: 'avgHrsToAuthorise', label: 'Avg→Reply' },
    { key: 'redAuthPct', label: '% Red Auth' },
    { key: 'amberAuthPct', label: '% Amber Auth' },
  ]

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
            <h1 className="text-2xl font-bold text-gray-900">Online VHC Performance</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Red/amber authorisation when VHCs are sent online — self-serve vs chased — plus the open/response funnel
            </p>
          </div>
        </div>
        <ExportButton
          endpoint="/api/v1/reports/online-vhc/export"
          queryString={queryString}
          filename={`online-vhc-${new Date().toISOString().split('T')[0]}.csv`}
        />
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
          {/* Core answer: authorisation rate by channel */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Authorisation rate by channel (£ of work)</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data && <CohortCard rag="red" triplet={data.cohorts.red} />}
              {data && <CohortCard rag="amber" triplet={data.cohorts.amber} />}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Auth/Decl/Defer % are shares of <em>responded</em> value (work the customer actually decided on). Inspection
              red/amber only — MRI is reported separately. “Self-served online” = authorised in the portal; “Sent online →
              offline” = link sent but authorised by phone or in person.
            </p>
          </div>

          {/* Trend table — day / week / month */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Online send funnel over time</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th
                      onClick={() => toggleSort('date')}
                      className="sticky left-0 bg-gray-50 z-10 text-left px-3 py-3 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-gray-100"
                    >
                      <span className="inline-flex items-center gap-1">
                        {PERIOD_HEADER[filters.groupBy]}
                        <SortIndicator active={sortKey === 'date'} dir={sortDir} />
                      </span>
                    </th>
                    {periodCols.map(col => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className={`text-right px-3 py-3 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 ${sortKey === col.key ? 'text-gray-900' : 'text-gray-700'}`}
                      >
                        <span className="inline-flex items-center gap-1 flex-row-reverse">
                          {col.label}
                          <SortIndicator active={sortKey === col.key} dir={sortDir} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPeriods.map((p, i) => (
                    <tr key={p.date} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-gray-50`}>
                      <td className="sticky left-0 bg-white z-10 px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap"
                        style={i % 2 === 1 ? { backgroundColor: 'rgb(249 250 251 / 0.5)' } : undefined}>
                        {periodLabel(p.date, filters.groupBy)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(p.sent)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(p.opened)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{formatPercent(p.openRate)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(p.responded)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{formatPercent(p.responseRate)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{fmtHrs(p.avgHrsToOpen)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{fmtHrs(p.avgHrsToAuthorise)}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${p.redAuthPct > 0 ? 'text-red-600' : 'text-gray-300'}`}>{formatPercent(p.redAuthPct)}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${p.amberAuthPct > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{formatPercent(p.amberAuthPct)}</td>
                    </tr>
                  ))}
                  {sortedPeriods.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">No VHCs sent online in this period</td></tr>
                  )}
                </tbody>
                {t && sortedPeriods.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 font-bold border-t-2 border-gray-300 sticky bottom-0">
                      <td className="sticky left-0 bg-gray-50 z-10 px-3 py-3 text-gray-900">Totals</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatNumber(t.sent)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatNumber(t.opened)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatPercent(t.openRate)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatNumber(t.responded)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatPercent(t.responseRate)}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{fmtHrs(t.avgHrsToOpen)}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{fmtHrs(t.avgHrsToAuthorise)}</td>
                      <td className="px-3 py-3 text-right text-red-600">{formatPercent(t.redAuthPct)}</td>
                      <td className="px-3 py-3 text-right text-amber-600">{formatPercent(t.amberAuthPct)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
              Avg→Open = send → customer’s first open. Avg→Reply = send → their first response (any decision —
              authorise or decline). Delivery receipts aren’t tracked, so both run from the send time.
            </p>
          </div>

          {/* By advisor */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">By advisor</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-gray-700">
                    <th className="sticky left-0 bg-gray-50 z-10 text-left px-3 py-3 font-semibold whitespace-nowrap">Advisor</th>
                    <th className="text-right px-3 py-3 font-semibold">Sent</th>
                    <th className="text-right px-3 py-3 font-semibold">Open%</th>
                    <th className="text-right px-3 py-3 font-semibold">Resp%</th>
                    <th className="text-right px-3 py-3 font-semibold">Avg→Open</th>
                    <th className="text-right px-3 py-3 font-semibold">Avg→Reply</th>
                    <th className="text-right px-3 py-3 font-semibold">% Red Auth</th>
                    <th className="text-right px-3 py-3 font-semibold">% Amber Auth</th>
                    <th className="text-right px-3 py-3 font-semibold">Self-serve £</th>
                    <th className="text-right px-3 py-3 font-semibold">Chased £</th>
                    <th className="text-right px-3 py-3 font-semibold">Self-serve %</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.advisors || []).map((a, i) => (
                    <tr key={a.id} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-gray-50`}>
                      <td className="sticky left-0 bg-white z-10 px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap"
                        style={i % 2 === 1 ? { backgroundColor: 'rgb(249 250 251 / 0.5)' } : undefined}>
                        {a.name}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(a.sent)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{formatPercent(a.openRate)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{formatPercent(a.responseRate)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{fmtHrs(a.avgHrsToOpen)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{fmtHrs(a.avgHrsToAuthorise)}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${a.redAuthPct > 0 ? 'text-red-600' : 'text-gray-300'}`}>{formatPercent(a.redAuthPct)}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${a.amberAuthPct > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{formatPercent(a.amberAuthPct)}</td>
                      <td className="px-3 py-2.5 text-right text-green-600 font-medium">{formatCurrency(a.onlineAuthValue)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{formatCurrency(a.offlineAuthValue)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{a.onlineAuthValue + a.offlineAuthValue > 0 ? formatPercent(a.selfServeSharePct) : '—'}</td>
                    </tr>
                  ))}
                  {(data?.advisors || []).length === 0 && (
                    <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">No advisor activity in this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
