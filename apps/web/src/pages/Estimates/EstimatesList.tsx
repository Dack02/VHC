import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
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

interface EstimateRow {
  id: string
  reference: string | null
  status: string
  validUntil: string | null
  createdAt: string
  total?: number | null
  sentAt?: string | null
  firstOpenedAt?: string | null
  respondedAt?: string | null
  convertedToJobsheetReference?: string | null
  customer: { firstName: string; lastName: string } | null
  vehicle: { registration: string; make: string | null; model: string | null } | null
  advisor: { firstName: string; lastName: string } | null
}

interface EstimateStats {
  all: number
  open: number
  sent: number
  opened: number
  accepted: number
  declined: number
  draft: number
  expiringSoon: number
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', opened: 'Opened', accepted: 'Accepted',
  partial: 'Partly accepted', declined: 'Declined', expired: 'Expired',
  converted: 'Converted', cancelled: 'Cancelled'
}
const STATUS_TONES: Record<string, Tone> = {
  draft: 'mutedGray', sent: 'blue', opened: 'indigo', accepted: 'green',
  partial: 'amber', declined: 'red', expired: 'amber', converted: 'teal', cancelled: 'mutedGray'
}
const TERMINAL = new Set(['accepted', 'converted', 'declined', 'expired', 'cancelled'])

const TABS = [
  { key: 'open', label: 'Open', statuses: 'draft,sent,opened,partial' },
  { key: 'sent', label: 'Sent', statuses: 'sent' },
  { key: 'accepted', label: 'Accepted', statuses: 'accepted,converted' },
  { key: 'declined', label: 'Declined', statuses: 'declined' },
  { key: 'all', label: 'All', statuses: '' }
]

const PAGE = 50

function tabCount(s: EstimateStats, k: string): number {
  switch (k) {
    case 'all': return s.all
    case 'open': return s.open
    case 'sent': return s.sent
    case 'accepted': return s.accepted
    case 'declined': return s.declined
    default: return 0
  }
}

function daysBetween(iso: string): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / 86400000)
}
function ago(iso: string | null): string {
  if (!iso) return ''
  const days = -daysBetween(iso)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

/** Small inline glyphs (no icon font dependency in the dashboard app). */
function SendGlyph({ on }: { on: boolean }) {
  return (
    <svg className={`h-4 w-4 ${on ? 'text-rag-green' : 'text-gray-300'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  )
}
function EyeGlyph({ on }: { on: boolean }) {
  return (
    <svg className={`h-4 w-4 ${on ? 'text-indigo-600' : 'text-gray-300'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function Comms({ row }: { row: EstimateRow }) {
  if (row.status === 'accepted' || row.status === 'converted') {
    return (
      <svg className="h-4 w-4 text-rag-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-label="Accepted">
        <path strokeLinecap="round" strokeLinejoin="round" d="M1 13l4 4L13 7m6 0l-7 8" />
      </svg>
    )
  }
  if (row.status === 'declined') {
    return (
      <svg className="h-4 w-4 text-rag-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-label="Declined">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
      </svg>
    )
  }
  const sent = !!row.sentAt
  const opened = !!row.firstOpenedAt
  if (!sent) return <span className="text-gray-300 text-sm">—</span>
  return (
    <span className="inline-flex items-center gap-1.5" title={`Sent${opened ? ' · opened' : ' · not opened'}`}>
      <SendGlyph on={sent} />
      <EyeGlyph on={opened} />
    </span>
  )
}

/** The lifecycle date/expiry pill shown under the reference. */
function LifecyclePill({ row }: { row: EstimateRow }) {
  if (row.status === 'accepted' || row.status === 'converted')
    return <span className="text-[11px] text-gray-500">Accepted {ago(row.respondedAt || row.createdAt)}</span>
  if (row.status === 'declined')
    return <span className="text-[11px] text-gray-500">Declined {ago(row.respondedAt || row.createdAt)}</span>
  if (row.status === 'expired') return <Pill tone="amber">Expired</Pill>
  if (row.status === 'draft') return <span className="text-[11px] text-gray-500">Created {ago(row.createdAt)}</span>
  if (row.validUntil) {
    const d = daysBetween(row.validUntil)
    if (d < 0) return <Pill tone="red">Expired</Pill>
    if (d <= 3) return <Pill tone="red">Expires {d}d</Pill>
    if (d <= 7) return <Pill tone="amber">Expires {d}d</Pill>
    return <Pill tone="green">Valid {d}d</Pill>
  }
  return <span className="text-[11px] text-gray-500">Created {ago(row.createdAt)}</span>
}

export default function EstimatesList() {
  const { session } = useAuth()
  const [rows, setRows] = useState<EstimateRow[]>([])
  const [stats, setStats] = useState<EstimateStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('open')
  const [density, setDensity] = useDensity()
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const token = session?.accessToken

  const fetchStats = useCallback(async () => {
    if (!token) return
    try {
      setStats(await api<EstimateStats>('/api/v1/estimates/stats', { token }))
    } catch {
      setStats(null)
    }
  }, [token])

  const fetchRows = useCallback(
    async (q: string, tabKey: string, offset: number) => {
      if (!token) return
      offset === 0 ? setLoading(true) : setLoadingMore(true)
      try {
        const statuses = TABS.find((t) => t.key === tabKey)?.statuses || ''
        const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
        if (q.trim()) params.set('q', q.trim())
        if (statuses) params.set('status', statuses)
        const data = await api<{ estimates: EstimateRow[]; total: number }>(`/api/v1/estimates?${params}`, { token })
        setTotal(data.total || 0)
        setRows((prev) => (offset === 0 ? data.estimates || [] : [...prev, ...(data.estimates || [])]))
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
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    const debounce = setTimeout(() => fetchRows(search, tab, 0), 300)
    return () => clearTimeout(debounce)
  }, [search, tab, fetchRows])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'value' ? 'desc' : 'asc')
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      if (sortKey === 'value') {
        av = a.total || 0
        bv = b.total || 0
      } else if (sortKey === 'reference') {
        av = a.reference || ''
        bv = b.reference || ''
      } else if (sortKey === 'status') {
        av = STATUS_LABELS[a.status] || a.status
        bv = STATUS_LABELS[b.status] || b.status
      } else if (sortKey === 'expiry') {
        av = a.validUntil || '9999'
        bv = b.validUntil || '9999'
      } else if (sortKey === 'customer') {
        av = a.customer ? `${a.customer.lastName} ${a.customer.firstName}` : 'zzz'
        bv = b.customer ? `${b.customer.lastName} ${b.customer.firstName}` : 'zzz'
      }
      const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  const pageValue = useMemo(() => rows.reduce((s, r) => s + (r.total || 0), 0), [rows])
  const rowPad = DENSITY_ROW[density]

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estimates</h1>
          <p className="text-gray-600 mt-1">Pre-booking priced quotes — send to the customer, then convert to a jobsheet.</p>
        </div>
        <Link to="/estimates/new" className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark">
          + New Estimate
        </Link>
      </div>

      {/* Count tiles — saved-filter counts promoted to navigation */}
      {stats && (
        <div className="flex flex-wrap gap-2 mb-4">
          <CountTile label="Draft · not sent" value={stats.draft} onClick={() => setTab('open')} active={false} />
          <CountTile label="Sent" value={stats.sent} tone="blue" onClick={() => setTab('sent')} active={tab === 'sent'} />
          <CountTile label="Opened" value={stats.opened} tone="blue" onClick={() => setTab('open')} />
          <CountTile label="Expiring soon" value={stats.expiringSoon} tone="amber" />
          <CountTile label="Accepted" value={stats.accepted} tone="green" onClick={() => setTab('accepted')} active={tab === 'accepted'} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Tabs
          tabs={TABS.map((t) => ({
            key: t.key,
            label: t.label,
            count: stats ? tabCount(stats, t.key) : null
          }))}
          active={tab}
          onChange={setTab}
        />
        <div className="flex-1" />
        <SearchInput value={search} onChange={setSearch} placeholder="Reg, customer, est no…" />
        <DensityToggle density={density} onChange={setDensity} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-400">
          {search ? 'No estimates match your search.' : 'No estimates yet. Create one to get started.'}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[120px]" />
                <col className="w-[150px]" />
                <col />
                <col className="w-[120px]" />
                <col className="w-[72px]" />
                <col className="w-[110px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-100">
                  <SortHeader label="Estimate" sortKey="reference" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Vehicle" />
                  <SortHeader label="Customer" sortKey="customer" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Comms" />
                  <SortHeader label="Value" sortKey="value" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((row) => {
                  const dim = TERMINAL.has(row.status)
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className={`px-3 ${rowPad}`}>
                        <Link to={`/estimates/${row.id}`} className="block">
                          <div className={`text-sm font-semibold ${dim ? 'text-gray-500' : 'text-gray-900'}`}>{row.reference || 'Draft'}</div>
                          <div className="mt-0.5"><LifecyclePill row={row} /></div>
                        </Link>
                      </td>
                      <td className={`px-3 ${rowPad}`}>
                        <PlateChip reg={row.vehicle?.registration} dim={dim} />
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
                      <td className={`px-3 ${rowPad}`}>
                        <Pill tone={STATUS_TONES[row.status] || 'gray'}>{STATUS_LABELS[row.status] || row.status}</Pill>
                      </td>
                      <td className={`px-3 ${rowPad}`}><Comms row={row} /></td>
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
                    {total} {tab === 'all' ? 'estimates' : 'open quotes'} · showing {rows.length}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-sm font-medium text-gray-900">{formatMoney(pageValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="md:hidden bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100 overflow-hidden">
            {sorted.map((row) => {
              const dim = TERMINAL.has(row.status)
              return (
                <Link key={row.id} to={`/estimates/${row.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <PlateChip reg={row.vehicle?.registration} dim={dim} />
                      <span className="text-xs text-gray-400">{row.reference || 'Draft'}</span>
                    </div>
                    <div className="text-sm text-gray-900 mt-1 truncate">
                      {row.customer ? `${row.customer.lastName}, ${row.customer.firstName}` : 'No customer'}
                      {row.vehicle?.make && <span className="text-gray-500"> · {row.vehicle.make} {row.vehicle.model}</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Pill tone={STATUS_TONES[row.status] || 'gray'}>{STATUS_LABELS[row.status] || row.status}</Pill>
                      <LifecyclePill row={row} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-mono tabular-nums text-sm font-medium ${dim ? 'text-gray-500' : 'text-gray-900'}`}>{formatMoney(row.total)}</div>
                    <div className="mt-1.5 flex justify-end"><Comms row={row} /></div>
                  </div>
                </Link>
              )
            })}
          </div>

          {rows.length < total && (
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
