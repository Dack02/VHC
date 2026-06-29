import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import {
  formatMoney,
  PlateChip,
  Pill,
  CountTile,
  Tabs,
  SearchInput,
  SortHeader,
  DensityToggle,
  useDensity,
  DENSITY_ROW,
  type Tone,
  type SortDir
} from '../../components/list/primitives'

interface ArrivalLite {
  id: string
  healthCheckId: string | null
  hasVhc: boolean
  status: 'awaiting_arrival' | 'awaiting_checkin'
  origin: 'dms' | 'jobsheet' | 'manual'
  jobsheetId: string | null
  jobsheetReference: string | null
  registration: string
  make: string
  model: string
  customerName: string
  customerWaiting: boolean
  dueDate: string | null
}

interface JobsheetRow {
  id: string
  reference: string
  createdAt: string
  dueInDate: string
  dueInTime: string | null
  mileage: number | null
  jobsheetComplete?: boolean
  invoiceNumber?: string | null
  vehicleStatus?: string | null
  total?: number | null
  bookingSource?: string | null
  customer: { firstName: string; lastName: string } | null
  vehicle: { registration: string; make: string | null; model: string | null; motExpiryDate?: string | null } | null
  serviceType: { code: string; colour: string } | null
  advisor: { firstName: string; lastName: string } | null
  healthCheck: {
    id: string
    status?: string
    vehicleStatus: string
    vhcReference: string | null
    inspectionRequired?: boolean
    redCount?: number
    amberCount?: number
    greenCount?: number
  } | null
  bookingCodes: { id: string; code: string; colour: string }[]
}

interface JobsheetStats {
  all: number
  active: number
  completed: number
  tiles: { onSite: number; awaitingParts: number; readyToInvoice: number; overdue: number; dueToday: number }
}

const VEHICLE_STATUS: Record<string, { label: string; tone: Tone }> = {
  due_in: { label: 'Due in', tone: 'gray' },
  arrived: { label: 'On site', tone: 'blue' },
  in_workshop: { label: 'In workshop', tone: 'amber' },
  work_complete: { label: 'Ready to invoice', tone: 'green' },
  collected: { label: 'Collected', tone: 'mutedGray' }
}

const TABS = [
  { key: 'active', label: 'Active', complete: 'false' },
  { key: 'completed', label: 'Completed', complete: 'true' },
  { key: 'all', label: 'All', complete: '' }
]

const PAGE = 50

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}
function daysFromToday(iso: string): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / 86400000)
}

/** The most informative single status for an advisor scanning the list. */
function jobStatus(row: JobsheetRow): { label: string; tone: Tone } {
  if (row.jobsheetComplete) return { label: row.invoiceNumber ? 'Invoiced' : 'Complete', tone: 'mutedGray' }
  const s = row.healthCheck?.status
  if (s === 'awaiting_parts') return { label: 'Awaiting parts', tone: 'amber' }
  if (s === 'awaiting_pricing') return { label: 'Awaiting pricing', tone: 'amber' }
  if (s === 'awaiting_review') return { label: 'Awaiting review', tone: 'amber' }
  if (s === 'sent' || s === 'delivered' || s === 'opened') return { label: 'Awaiting auth', tone: 'red' }
  const v = row.vehicleStatus || row.healthCheck?.vehicleStatus || 'due_in'
  return VEHICLE_STATUS[v] || { label: v, tone: 'gray' }
}

/** The due-in / overdue pill shown under the reference. */
function DuePill({ row }: { row: JobsheetRow }) {
  if (!row.dueInDate) return <span className="text-[11px] text-gray-400">No date</span>
  const d = daysFromToday(row.dueInDate)
  const time = row.dueInTime ? ` ${row.dueInTime}` : ''
  if (!row.jobsheetComplete && d < 0) return <Pill tone="red">Overdue {Math.abs(d)}d</Pill>
  if (d === 0) return <Pill tone="blue">Today{time}</Pill>
  const label = new Date(`${row.dueInDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
  return <span className="text-[11px] text-gray-500">{d === 1 ? `Tomorrow${time}` : label + time}</span>
}

function motNear(row: JobsheetRow): boolean {
  const exp = row.vehicle?.motExpiryDate
  if (!exp) return false
  return daysFromToday(exp) <= 30
}

function RagCounts({ row }: { row: JobsheetRow }) {
  const hc = row.healthCheck
  if (!hc || hc.inspectionRequired === false) return <span className="text-gray-300 text-sm">—</span>
  const r = hc.redCount ?? 0
  const a = hc.amberCount ?? 0
  const g = hc.greenCount ?? 0
  const chip = (n: number, on: string, off: string) => (
    <span className={`min-w-[18px] text-center px-1 py-0.5 rounded text-[11px] font-medium ${n > 0 ? on : off}`}>{n}</span>
  )
  return (
    <span className="inline-flex gap-1" title={`${r} red · ${a} amber · ${g} green`}>
      {chip(r, 'bg-red-100 text-red-700', 'bg-gray-100 text-gray-400')}
      {chip(a, 'bg-amber-100 text-amber-700', 'bg-gray-100 text-gray-400')}
      {chip(g, 'bg-green-100 text-green-700', 'bg-gray-100 text-gray-400')}
    </span>
  )
}

const TILE_PREDICATES: Record<string, (r: JobsheetRow) => boolean> = {
  onSite: (r) => r.vehicleStatus === 'arrived' || r.vehicleStatus === 'in_workshop',
  awaitingParts: (r) => r.healthCheck?.status === 'awaiting_parts',
  readyToInvoice: (r) => r.vehicleStatus === 'work_complete' || r.healthCheck?.status === 'authorized',
  overdue: (r) => !r.jobsheetComplete && !!r.dueInDate && daysFromToday(r.dueInDate) < 0,
  dueToday: (r) => r.dueInDate === todayStr()
}

export default function JobsheetList() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<JobsheetRow[]>([])
  const [stats, setStats] = useState<JobsheetStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('active')
  const [tileFilter, setTileFilter] = useState<string | null>(null)
  const [density, setDensity] = useDensity()
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [arrivals, setArrivals] = useState<ArrivalLite[]>([])
  const token = session?.accessToken

  const fetchArrivals = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ arrivals: ArrivalLite[] }>('/api/v1/arrivals?window=soon', { token })
      setArrivals((data.arrivals || []).filter((a) => a.origin === 'jobsheet'))
    } catch {
      setArrivals([])
    }
  }, [token])

  const fetchStats = useCallback(async () => {
    if (!token) return
    try {
      setStats(await api<JobsheetStats>('/api/v1/jobsheets/stats', { token }))
    } catch {
      setStats(null)
    }
  }, [token])

  const fetchRows = useCallback(
    async (q: string, tabKey: string, offset: number) => {
      if (!token) return
      offset === 0 ? setLoading(true) : setLoadingMore(true)
      try {
        const complete = TABS.find((t) => t.key === tabKey)?.complete ?? ''
        const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
        if (q.trim()) params.set('q', q.trim())
        if (complete) params.set('complete', complete)
        const data = await api<{ jobsheets: JobsheetRow[]; total: number }>(`/api/v1/jobsheets?${params}`, { token })
        setTotal(data.total || 0)
        setRows((prev) => (offset === 0 ? data.jobsheets || [] : [...prev, ...(data.jobsheets || [])]))
      } catch {
        if (offset === 0) setRows([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [token]
  )

  useEffect(() => {
    fetchArrivals()
    fetchStats()
  }, [fetchArrivals, fetchStats])

  useEffect(() => {
    const debounce = setTimeout(() => fetchRows(search, tab, 0), 300)
    return () => clearTimeout(debounce)
  }, [search, tab, fetchRows])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'total' ? 'desc' : 'asc')
    }
  }
  function toggleTile(key: string) {
    setTileFilter((cur) => (cur === key ? null : key))
  }

  const view = useMemo(() => {
    let list = tileFilter ? rows.filter(TILE_PREDICATES[tileFilter]) : rows
    if (sortKey) {
      list = [...list].sort((a, b) => {
        let av: string | number = '', bv: string | number = ''
        if (sortKey === 'total') {
          av = a.total || 0
          bv = b.total || 0
        } else if (sortKey === 'reference') {
          av = a.reference || ''
          bv = b.reference || ''
        } else if (sortKey === 'due') {
          av = a.dueInDate || '9999'
          bv = b.dueInDate || '9999'
        } else if (sortKey === 'customer') {
          av = a.customer ? `${a.customer.lastName} ${a.customer.firstName}` : 'zzz'
          bv = b.customer ? `${b.customer.lastName} ${b.customer.firstName}` : 'zzz'
        } else if (sortKey === 'status') {
          av = jobStatus(a).label
          bv = jobStatus(b).label
        }
        const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [rows, tileFilter, sortKey, sortDir])

  const pageValue = useMemo(() => view.reduce((s, r) => s + (r.total || 0), 0), [view])
  const rowPad = DENSITY_ROW[density]
  const t = stats?.tiles

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Jobsheets</h1>
          <p className="text-gray-600 mt-1">Booking documents — the top-level record for upcoming work.</p>
        </div>
        <Link to="/jobsheets/new" className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark">
          + New Jobsheet
        </Link>
      </div>

      {/* Due in — arrivals still needing check-in */}
      {arrivals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <h2 className="text-sm font-semibold text-gray-800">Due in</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{arrivals.length}</span>
            <Link to="/arrivals" className="ml-auto text-xs font-semibold text-primary hover:underline">Open arrivals</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {arrivals.map((item) => (
              <div key={item.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${item.customerWaiting ? 'bg-red-50/50' : ''}`}>
                <Link to={item.jobsheetId ? `/jobsheets/${item.jobsheetId}` : '/arrivals'} className="flex items-center gap-3 min-w-0">
                  <PlateChip reg={item.registration} />
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 truncate">
                      {item.make} {item.model}
                      {item.jobsheetReference && <span className="text-gray-400"> · {item.jobsheetReference}</span>}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{item.customerName || 'No customer'}</div>
                  </div>
                  {item.customerWaiting && <span className="px-2 py-0.5 text-[10px] font-bold text-white bg-rag-red rounded-full">WAITING</span>}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.status === 'awaiting_checkin' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                    {item.status === 'awaiting_checkin' ? 'Awaiting check-in' : 'Due in'}
                  </span>
                  <button onClick={() => navigate(`/jobsheets/${item.jobsheetId}?tab=checkin`)} className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg">
                    Check in
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Count tiles */}
      {t && (
        <div className="flex flex-wrap gap-2 mb-4">
          <CountTile label="On site" value={t.onSite} tone="blue" active={tileFilter === 'onSite'} onClick={() => toggleTile('onSite')} />
          <CountTile label="Awaiting parts" value={t.awaitingParts} tone="amber" active={tileFilter === 'awaitingParts'} onClick={() => toggleTile('awaitingParts')} />
          <CountTile label="Ready to invoice" value={t.readyToInvoice} tone="green" active={tileFilter === 'readyToInvoice'} onClick={() => toggleTile('readyToInvoice')} />
          <CountTile label="Due today" value={t.dueToday} active={tileFilter === 'dueToday'} onClick={() => toggleTile('dueToday')} />
          <CountTile label="Overdue" value={t.overdue} tone="red" active={tileFilter === 'overdue'} onClick={() => toggleTile('overdue')} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Tabs
          tabs={TABS.map((tb) => ({
            key: tb.key,
            label: tb.label,
            count: stats ? (tb.key === 'active' ? stats.active : tb.key === 'completed' ? stats.completed : stats.all) : null
          }))}
          active={tab}
          onChange={(k) => {
            setTab(k)
            setTileFilter(null)
          }}
        />
        <div className="flex-1" />
        <SearchInput value={search} onChange={setSearch} placeholder="Reg, customer, job no…" />
        <DensityToggle density={density} onChange={setDensity} />
      </div>

      {tileFilter && (
        <div className="mb-3 text-xs text-gray-500">
          Filtered to <span className="font-medium text-gray-700">{tileFilter.replace(/([A-Z])/g, ' $1').toLowerCase()}</span> within loaded jobs ·{' '}
          <button onClick={() => setTileFilter(null)} className="text-primary hover:underline">clear</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-400">
          {search ? 'No jobsheets match your search.' : 'No jobsheets yet. Create one to get started.'}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[112px]" />
                <col className="w-[150px]" />
                <col />
                <col className="w-[124px]" />
                <col className="w-[84px]" />
                <col className="w-[100px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader label="Job" sortKey="reference" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Vehicle" />
                  <SortHeader label="Customer" sortKey="customer" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="R / A / G" />
                  <SortHeader label="Total" sortKey="total" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {view.map((row) => {
                  const st = jobStatus(row)
                  const dim = !!row.jobsheetComplete
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className={`px-3 ${rowPad}`}>
                        <Link to={`/jobsheets/${row.id}`} className="block">
                          <div className={`text-sm font-semibold ${dim ? 'text-gray-500' : 'text-gray-900'}`}>{row.reference}</div>
                          <div className="mt-0.5"><DuePill row={row} /></div>
                        </Link>
                      </td>
                      <td className={`px-3 ${rowPad}`}>
                        <div className="flex items-center gap-1.5">
                          <PlateChip reg={row.vehicle?.registration} dim={dim} />
                          {motNear(row) && <span className="px-1 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700" title="MOT due soon">MOT</span>}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">
                          {row.vehicle?.make ? `${row.vehicle.make} ${row.vehicle.model || ''}` : '—'}
                        </div>
                      </td>
                      <td className={`px-3 ${rowPad}`}>
                        <div className="text-sm text-gray-900 truncate">
                          {row.customer ? `${row.customer.lastName}, ${row.customer.firstName}` : 'No customer'}
                        </div>
                        {row.advisor && <div className="text-[11px] text-gray-500 truncate">Adv: {row.advisor.firstName} {row.advisor.lastName}</div>}
                      </td>
                      <td className={`px-3 ${rowPad}`}><Pill tone={st.tone}>{st.label}</Pill></td>
                      <td className={`px-3 ${rowPad}`}><RagCounts row={row} /></td>
                      <td className={`px-3 ${rowPad} text-right font-mono tabular-nums text-sm font-medium ${dim ? 'text-gray-500' : 'text-gray-900'}`}>
                        {formatMoney(row.total)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/50">
                  <td colSpan={5} className="px-3 py-2.5 text-xs text-gray-500">
                    {tileFilter ? `${view.length} shown` : `${total} ${tab === 'active' ? 'active jobs' : 'jobs'}`} · loaded {rows.length}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-sm font-medium text-gray-900">{formatMoney(pageValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100 overflow-hidden">
            {view.map((row) => {
              const st = jobStatus(row)
              const dim = !!row.jobsheetComplete
              return (
                <Link key={row.id} to={`/jobsheets/${row.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <PlateChip reg={row.vehicle?.registration} dim={dim} />
                      <span className="text-xs text-gray-400">{row.reference}</span>
                    </div>
                    <div className="text-sm text-gray-900 mt-1 truncate">
                      {row.customer ? `${row.customer.lastName}, ${row.customer.firstName}` : 'No customer'}
                      {row.vehicle?.make && <span className="text-gray-500"> · {row.vehicle.make} {row.vehicle.model}</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      <DuePill row={row} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-mono tabular-nums text-sm font-medium ${dim ? 'text-gray-500' : 'text-gray-900'}`}>{formatMoney(row.total)}</div>
                    <div className="mt-1.5 flex justify-end"><RagCounts row={row} /></div>
                  </div>
                </Link>
              )
            })}
          </div>

          {!tileFilter && rows.length < total && (
            <div className="flex justify-center mt-4">
              <button
                type="button"
                onClick={() => fetchRows(search, tab, rows.length)}
                disabled={loadingMore}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : `Load more (${total - rows.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
