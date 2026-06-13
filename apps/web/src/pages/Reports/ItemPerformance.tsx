import { useState, useMemo, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatCurrency, formatPercent, formatNumber, formatDate } from './utils/formatters'
import { CHART_COLORS, RAG_COLORS } from './utils/colors'

// --- API response types (mirror apps/api/src/services/item-report-service.ts) ---
interface ItemTrendPoint { period: string; identified: number; sold: number; flagged: number }

interface ItemRow {
  item: string
  inspected: number
  red: number
  amber: number
  flagged: number
  flagRate: number | null
  identified: number
  sold: number
  declined: number
  deferred: number
  conversionValuePct: number | null
  approvalPct: number | null
  trend: ItemTrendPoint[]
}

interface ItemSummaryTotals {
  inspected: number; red: number; amber: number; flagged: number; flagRate: number | null
  identified: number; sold: number; declined: number; deferred: number
  conversionValuePct: number | null; approvalPct: number | null
}

interface ItemListResponse {
  period: { from: string; to: string }
  summary: {
    itemCount: number
    totals: ItemSummaryTotals
    unmapped: { identified: number; sold: number; declined: number; deferred: number }
  }
  items: ItemRow[]
}

interface ItemDetailResponse {
  item: string
  period: { from: string; to: string }
  usage: { inspected: number; red: number; amber: number; flagged: number; flagRate: number | null }
  revenue: {
    identified: number; sold: number; declined: number; deferred: number
    conversionValuePct: number | null; approvalPct: number | null
  }
  trend: ItemTrendPoint[]
  topReasons: Array<{
    itemReasonId: string; reasonText: string; defaultRag: string | null
    count: number; approved: number; declined: number; approvalPct: number | null
  }>
  technicians: Array<{ userId: string; name: string; flagged: number; red: number; amber: number }>
  advisors: Array<{
    advisorId: string; name: string
    identified: number; sold: number; soldCount: number; identifiedCount: number; approvalPct: number | null
  }>
  deferred: Array<{
    repairItemId: string; healthCheckId: string; value: number
    deferredUntil: string | null; deferredNotes: string | null; isOverdue: boolean
    vehicleReg: string | null; customerName: string | null; advisorName: string | null
  }>
}

interface TemplateOpt { id: string; name: string }

const pctOrDash = (v: number | null) => (v == null ? '—' : formatPercent(v))
const moneyOrDash = (v: number) => (v ? formatCurrency(v) : '—')

/** Tiny inline SVG sparkline (no chart lib overhead per row). */
function Sparkline({ values, color = CHART_COLORS.primary }: { values: number[]; color?: string }) {
  if (values.length < 2 || values.every(v => v === 0)) return <span className="text-gray-300">—</span>
  const w = 72, h = 24
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

export default function ItemPerformance() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()
  const { session } = useAuth()
  const token = session?.accessToken

  const [templateId, setTemplateId] = useState('')
  const [ragFilter, setRagFilter] = useState<'all' | 'red' | 'amber'>('all')
  const [search, setSearch] = useState('')
  const [templates, setTemplates] = useState<TemplateOpt[]>([])

  // Template scoping changes the server-side universe, so include it in the query.
  const fullQuery = useMemo(
    () => `${queryString}${templateId ? `&template_id=${templateId}` : ''}`,
    [queryString, templateId]
  )

  const { data, loading, error } = useReportData<ItemListResponse>({
    endpoint: '/api/v1/reports/items',
    queryString: fullQuery,
  })

  // Load templates for the optional template filter
  useEffect(() => {
    if (!token) return
    api<{ templates: TemplateOpt[] }>('/api/v1/templates', { token })
      .then(d => setTemplates(d.templates || []))
      .catch(() => {})
  }, [token])

  // RAG + search filters are applied client-side (summary stays whole-business)
  const rows = useMemo(() => {
    let r = data?.items ?? []
    if (ragFilter === 'red') r = r.filter(i => i.red > 0)
    else if (ragFilter === 'amber') r = r.filter(i => i.amber > 0)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      r = r.filter(i => i.item.toLowerCase().includes(q))
    }
    return r
  }, [data, ragFilter, search])

  const totals = data?.summary.totals
  const unmapped = data?.summary.unmapped
  const missed = totals ? totals.declined + totals.deferred : 0
  const unmappedTotal = unmapped ? unmapped.identified : 0

  // --- Detail drawer ---
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ItemDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const openDetail = useCallback(async (name: string) => {
    setSelected(name)
    setDetail(null)
    setDetailLoading(true)
    try {
      const q = `${fullQuery}&item=${encodeURIComponent(name)}`
      const d = await api<ItemDetailResponse>(`/api/v1/reports/items/detail?${q}`, { token })
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [fullQuery, token])

  const exportCsv = () => {
    const header = ['Item', 'Inspected', 'Red', 'Amber', 'Flagged', 'Flag Rate %', 'Identified', 'Sold', 'Declined', 'Deferred', 'Conversion %', 'Approval %']
    const lines = rows.map(r => [
      `"${r.item.replace(/"/g, '""')}"`,
      r.inspected, r.red, r.amber, r.flagged, r.flagRate ?? '',
      r.identified, r.sold, r.declined, r.deferred,
      r.conversionValuePct ?? '', r.approvalPct ?? '',
    ].join(','))
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `item-performance-${filters.dateFrom.slice(0, 10)}_${filters.dateTo.slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  const columns: Column<ItemRow>[] = [
    {
      key: 'item', label: 'Inspection Item', sortable: true, sortValue: r => r.item,
      render: r => <span className="font-medium text-gray-900">{r.item}</span>,
    },
    {
      key: 'red', label: 'Red', align: 'right', sortable: true, sortValue: r => r.red,
      render: r => r.red ? <span className="text-red-600 font-medium">{formatNumber(r.red)}</span> : <span className="text-gray-300">0</span>,
    },
    {
      key: 'amber', label: 'Amber', align: 'right', sortable: true, sortValue: r => r.amber,
      render: r => r.amber ? <span className="text-amber-600 font-medium">{formatNumber(r.amber)}</span> : <span className="text-gray-300">0</span>,
    },
    {
      key: 'flagged', label: 'Flagged', align: 'right', sortable: true, sortValue: r => r.flagged,
      render: r => formatNumber(r.flagged),
    },
    {
      key: 'inspected', label: 'Inspected', align: 'right', sortable: true, sortValue: r => r.inspected,
      render: r => <span className="text-gray-500">{formatNumber(r.inspected)}</span>,
    },
    {
      key: 'flagRate', label: 'Flag Rate', align: 'right', sortable: true, sortValue: r => r.flagRate ?? -1,
      render: r => <span className="text-gray-500">{pctOrDash(r.flagRate)}</span>,
    },
    {
      key: 'identified', label: 'Identified', align: 'right', sortable: true, sortValue: r => r.identified,
      render: r => moneyOrDash(r.identified),
    },
    {
      key: 'sold', label: 'Sold', align: 'right', sortable: true, sortValue: r => r.sold,
      render: r => <span className="font-medium text-gray-900">{moneyOrDash(r.sold)}</span>,
    },
    {
      key: 'conversionValuePct', label: 'Conv.', align: 'right', sortable: true, sortValue: r => r.conversionValuePct ?? -1,
      render: r => (
        <span className={r.conversionValuePct == null ? 'text-gray-300'
          : r.conversionValuePct >= 50 ? 'text-green-600'
          : r.conversionValuePct >= 30 ? 'text-amber-600' : 'text-red-600'}>
          {pctOrDash(r.conversionValuePct)}
        </span>
      ),
    },
    {
      key: 'missed', label: 'Missed', align: 'right', sortable: true, sortValue: r => r.declined + r.deferred,
      render: r => <span className="text-gray-500">{moneyOrDash(r.declined + r.deferred)}</span>,
    },
    {
      key: 'trend', label: 'Identified trend', align: 'right',
      render: r => <Sparkline values={r.trend.map(t => t.identified)} />,
    },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/reports" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Item Performance</h1>
            <p className="text-sm text-gray-500">Usage and revenue per inspection item, across all templates</p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          disabled={!rows.length}
          className="px-4 py-2 bg-white border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-3">
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
        <div className="flex flex-wrap items-center gap-2">
          {templates.length > 0 && (
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">All Templates</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {(['all', 'red', 'amber'] as const).map(g => (
              <button
                key={g}
                onClick={() => setRagFilter(g)}
                className={`px-3 py-2 text-sm capitalize ${
                  ragFilter === g ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {g === 'all' ? 'All' : g}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items…"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white flex-1 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
      )}
      {loading && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-12 text-center text-gray-500">Loading…</div>
      )}

      {!loading && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <StatCard label="Items flagged" value={formatNumber(data.summary.itemCount)} />
            <StatCard label="Concerns (red + amber)" value={formatNumber(totals?.flagged ?? 0)} />
            <StatCard label="Identified" value={formatCurrency(totals?.identified ?? 0)} />
            <StatCard label="Sold" value={formatCurrency(totals?.sold ?? 0)} valueClassName="text-green-600" />
            <StatCard label="Conversion" value={pctOrDash(totals?.conversionValuePct ?? null)} />
            <StatCard label="Missed (declined + deferred)" value={formatCurrency(missed)} valueClassName="text-red-600" />
          </div>

          {unmappedTotal > 0 && (
            <p className="text-xs text-gray-400 -mt-2">
              Per-item revenue can overlap where one repair covers two items, so item rows need not sum to the totals above.
              A further {formatCurrency(unmappedTotal)} identified came from non-inspection sources (MRI / manual / prebooked) and isn't attributed to an item.
            </p>
          )}

          {/* Main table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Inspection items</h3>
              <span className="text-sm text-gray-500">{rows.length} of {data.items.length}</span>
            </div>
            <DataTable
              columns={columns}
              data={rows}
              rowKey={r => r.item}
              pageSize={12}
              emptyMessage="No inspection items in this period"
              onRowClick={r => openDetail(r.item)}
            />
          </div>
        </>
      )}

      {selected && (
        <ItemDetailDrawer
          name={selected}
          detail={detail}
          loading={detailLoading}
          onClose={() => { setSelected(null); setDetail(null) }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function ItemDetailDrawer({
  name, detail, loading, onClose,
}: {
  name: string
  detail: ItemDetailResponse | null
  loading: boolean
  onClose: () => void
}) {
  const trendData = (detail?.trend ?? []).map(t => ({ ...t, label: formatDate(t.period) }))

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-gray-50 h-full overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{name}</h2>
            <p className="text-sm text-gray-500">Inspection item detail</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && <div className="p-12 text-center text-gray-500">Loading…</div>}

        {!loading && detail && (
          <div className="p-6 space-y-5">
            {/* Usage + revenue mini-stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label="Flagged" value={formatNumber(detail.usage.flagged)} sub={`${detail.usage.red} red · ${detail.usage.amber} amber`} />
              <MiniStat label="Flag rate" value={pctOrDash(detail.usage.flagRate)} sub={`of ${formatNumber(detail.usage.inspected)} inspected`} />
              <MiniStat label="Identified" value={formatCurrency(detail.revenue.identified)} sub={`${pctOrDash(detail.revenue.conversionValuePct)} converted`} />
              <MiniStat label="Sold" value={formatCurrency(detail.revenue.sold)} sub={`${formatCurrency(detail.revenue.declined + detail.revenue.deferred)} missed`} valueClass="text-green-600" />
            </div>

            {/* Trend */}
            <ChartCard title="Trend" subtitle="Identified vs sold revenue, and flagged count, over time">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grayLight} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value, name) => (name === 'flagged' ? formatNumber(Number(value) || 0) : formatCurrency(Number(value) || 0))} />
                  <Area type="monotone" dataKey="identified" stroke={CHART_COLORS.primary} fill={CHART_COLORS.primaryLight} name="Identified" />
                  <Area type="monotone" dataKey="sold" stroke={RAG_COLORS.green} fill={RAG_COLORS.green} fillOpacity={0.15} name="Sold" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Top reasons */}
            <ChartCard title="Top reasons" subtitle="Predefined reasons selected for this item in the period">
              {detail.topReasons.length === 0 ? (
                <p className="text-sm text-gray-500">No reasons recorded.</p>
              ) : (
                <div className="space-y-2">
                  {detail.topReasons.map(r => (
                    <div key={r.itemReasonId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          r.defaultRag === 'red' ? 'bg-red-500' : r.defaultRag === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                        }`} />
                        <span className="truncate text-gray-700">{r.reasonText}</span>
                      </span>
                      <span className="flex items-center gap-3 flex-shrink-0 text-gray-500">
                        <span>{formatNumber(r.count)}×</span>
                        <span className="w-16 text-right">{pctOrDash(r.approvalPct)} appr.</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            {/* Technicians (who flags) */}
            <ChartCard title="Who flags it" subtitle="Technicians raising this concern">
              {detail.technicians.length === 0 ? (
                <p className="text-sm text-gray-500">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(120, detail.technicians.length * 36)}>
                  <BarChart data={detail.technicians} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => formatNumber(Number(value) || 0)} />
                    <Bar dataKey="flagged" name="Flagged" radius={[0, 4, 4, 0]}>
                      {detail.technicians.map((t, i) => (
                        <Cell key={i} fill={t.red >= t.amber ? RAG_COLORS.red : RAG_COLORS.amber} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Advisors (who sells) */}
            <ChartCard title="Who sells it" subtitle="Advisor conversion on this item">
              {detail.advisors.length === 0 ? (
                <p className="text-sm text-gray-500">No data.</p>
              ) : (
                <div className="space-y-2">
                  {detail.advisors.map(a => (
                    <div key={a.advisorId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-gray-700">{a.name}</span>
                      <span className="flex items-center gap-3 flex-shrink-0 text-gray-500">
                        <span>{formatCurrency(a.sold)} sold</span>
                        <span className="w-14 text-right">{pctOrDash(a.approvalPct)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            {/* Deferred follow-ups */}
            {detail.deferred.length > 0 && (
              <ChartCard title={`Deferred follow-ups (${detail.deferred.length})`} subtitle="Future revenue opportunities">
                <div className="space-y-2">
                  {detail.deferred.map(d => (
                    <div key={d.repairItemId} className="flex items-center justify-between gap-3 text-sm border-b border-gray-100 pb-2 last:border-0">
                      <span className="min-w-0">
                        <span className="font-medium text-gray-700">{d.vehicleReg || '—'}</span>
                        <span className="text-gray-400"> · {d.customerName || 'Unknown'}</span>
                      </span>
                      <span className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-gray-700">{formatCurrency(d.value)}</span>
                        <span className={d.isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}>
                          {d.deferredUntil ? formatDate(d.deferredUntil) : 'No date'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </ChartCard>
            )}
          </div>
        )}

        {!loading && !detail && (
          <div className="p-12 text-center text-gray-500">Failed to load detail.</div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className={`text-lg font-bold ${valueClass || 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
