import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import {
  FollowUpCase,
  FollowUpSummary,
  fmtMoney,
  relativeDue,
  STATUS_META,
} from './types'
import FollowUpDetailDrawer from './FollowUpDetailDrawer'

const PAGE_SIZE = 50

const DUE_TONE: Record<string, string> = {
  overdue: 'text-red-600 font-semibold',
  today: 'text-amber-600 font-semibold',
  soon: 'text-amber-600',
  future: 'text-gray-600',
  none: 'text-gray-400',
}

export default function FollowUpList() {
  const { session, user } = useAuth()
  const toast = useToast()
  const token = session?.accessToken

  const [cases, setCases] = useState<FollowUpCase[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<FollowUpSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [sweeping, setSweeping] = useState(false)

  const [statusFilter, setStatusFilter] = useState<string>('open')
  const [dueFilter, setDueFilter] = useState<string>('')
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const canSweep = user?.isOrgAdmin || user?.role === 'org_admin' || user?.role === 'super_admin'

  const fetchSummary = useCallback(async () => {
    try {
      const data = await api<FollowUpSummary>('/api/v1/follow-ups/summary', { token })
      setSummary(data)
    } catch {
      /* non-fatal */
    }
  }, [token])

  const fetchCases = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'open') params.set('status', statusFilter)
      if (dueFilter) params.set('due', dueFilter)
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(offset))
      const data = await api<{ cases: FollowUpCase[]; total: number }>(`/api/v1/follow-ups?${params.toString()}`, { token })
      setCases(data.cases || [])
      setTotal(data.total || 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load follow-ups')
    } finally {
      setLoading(false)
    }
  }, [token, statusFilter, dueFilter, offset, toast])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  useEffect(() => {
    fetchCases()
  }, [fetchCases])

  const refresh = () => {
    fetchCases()
    fetchSummary()
  }

  const runSweep = async () => {
    try {
      setSweeping(true)
      const res = await api<{ casesCreated: number; casesProcessed: number }>('/api/v1/follow-ups/run-sweep', { method: 'POST', token })
      toast.success(`Sweep complete — ${res.casesCreated} created, ${res.casesProcessed} processed`)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sweep failed')
    } finally {
      setSweeping(false)
    }
  }

  const applyStatus = (s: string) => { setStatusFilter(s); setDueFilter(''); setOffset(0) }
  const applyDue = (d: string) => { setStatusFilter('open'); setDueFilter(d); setOffset(0) }

  const chips: Array<{ key: string; label: string; value: number; onClick: () => void; tone: string }> = summary
    ? [
        { key: 'open', label: 'Open', value: summary.open, onClick: () => applyStatus('open'), tone: 'text-indigo-700' },
        { key: 'today', label: 'Due today', value: summary.dueToday, onClick: () => applyDue('today'), tone: 'text-amber-700' },
        { key: 'overdue', label: 'Overdue', value: summary.overdue, onClick: () => applyDue('overdue'), tone: 'text-red-700' },
        { key: 'manual', label: 'Call list', value: summary.manual, onClick: () => applyStatus('manual'), tone: 'text-amber-700' },
        { key: 'booking_found', label: 'Bookings to confirm', value: summary.bookingFound, onClick: () => applyStatus('booking_found'), tone: 'text-green-700' },
        { key: 'engaged', label: 'Replied', value: summary.engaged, onClick: () => applyStatus('engaged'), tone: 'text-purple-700' },
      ]
    : []

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-Ups</h1>
          <p className="text-sm text-gray-500 mt-1">Recover deferred work — chase, track and close out recommended jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Refresh</button>
          {canSweep && (
            <button onClick={runSweep} disabled={sweeping} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">
              {sweeping ? 'Running…' : 'Run sweep now'}
            </button>
          )}
        </div>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        {chips.map((chip) => (
          <button
            key={chip.key}
            onClick={chip.onClick}
            className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3 text-left hover:border-primary transition-colors"
          >
            <div className={`text-2xl font-bold ${chip.tone}`}>{chip.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{chip.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setDueFilter(''); setOffset(0) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="open">All open</option>
          <option value="active">In cadence</option>
          <option value="manual">Call list</option>
          <option value="booking_found">Booking found</option>
          <option value="engaged">Replied</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={dueFilter}
          onChange={(e) => { setDueFilter(e.target.value); setOffset(0) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due this week</option>
        </select>
        <span className="text-sm text-gray-500 ml-auto">{total} case{total === 1 ? '' : 's'}</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Customer', 'Vehicle', 'Deferred', 'Due', 'Stage', 'Next action', 'Owner'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
            ) : cases.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500">No follow-ups match these filters.</td></tr>
            ) : (
              cases.map((c) => {
                const due = relativeDue(c.anchorDate)
                const next = relativeDue(c.nextActionAt)
                return (
                  <tr key={c.id} onClick={() => setSelectedId(c.id)} className="hover:bg-indigo-50/40 cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{c.customer?.name || '—'}</div>
                      <div className="text-xs text-gray-400">{c.customer?.mobile || c.customer?.email || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm text-gray-900">{c.vehicle?.registration || '—'}</div>
                      <div className="text-xs text-gray-400">{c.vehicle?.makeModel}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-semibold text-gray-900">{fmtMoney(c.deferredValue)}</div>
                      <div className="text-xs text-gray-400">{c.itemCount} item{c.itemCount === 1 ? '' : 's'}</div>
                    </td>
                    <td className={`px-4 py-3 whitespace-nowrap text-sm ${DUE_TONE[due.tone]}`}>{due.label}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[c.status].cls}`}>{STATUS_META[c.status].label}</span>
                      {c.status === 'closed' && c.outcome && <div className="text-xs text-gray-400 mt-1">{c.outcome.name}</div>}
                    </td>
                    <td className={`px-4 py-3 whitespace-nowrap text-sm ${c.status === 'closed' ? 'text-gray-400' : DUE_TONE[next.tone]}`}>
                      {c.status === 'closed' ? '—' : next.label}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{c.assignee?.name || <span className="text-gray-400">Unassigned</span>}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-2 border border-gray-300 rounded-lg disabled:opacity-40"
          >Previous</button>
          <span className="text-gray-500">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-2 border border-gray-300 rounded-lg disabled:opacity-40"
          >Next</button>
        </div>
      )}

      {selectedId && (
        <FollowUpDetailDrawer
          caseId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}
