import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api, downloadCsv } from '../../lib/api'

interface CommLog {
  id: string
  organizationId: string
  organizationName: string
  healthCheckId: string | null
  channel: string
  recipient: string
  subject: string | null
  status: string
  providerId: string | null
  errorMessage: string | null
  createdAt: string
}

interface SmsThread {
  id: string
  organizationId: string
  organizationName: string
  direction: string
  fromNumber: string
  toNumber: string
  body: string
  status: string | null
  isRead: boolean
  createdAt: string
}

interface ChannelStat {
  channel: string
  total: number
  delivered: number
  failed: number
  bounced: number
  successRate: number
  bounceRate: number
}

interface OrgOption { id: string; name: string }

const PAGE_SIZE = 50

function statusPill(status: string): string {
  switch (status) {
    case 'delivered': return 'bg-green-100 text-green-800'
    case 'sent': return 'bg-indigo-100 text-indigo-800'
    case 'failed':
    case 'bounced': return 'bg-red-100 text-red-800'
    case 'pending': return 'bg-gray-100 text-gray-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

export default function AdminCommunications() {
  const { session } = useSuperAdmin()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [view, setView] = useState<'logs' | 'threads'>('logs')
  const [orgsList, setOrgsList] = useState<OrgOption[]>([])
  const [channelStats, setChannelStats] = useState<ChannelStat[]>([])
  const [logs, setLogs] = useState<CommLog[]>([])
  const [threads, setThreads] = useState<SmsThread[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const page = parseInt(searchParams.get('page') || '1')
  const organizationId = searchParams.get('organization_id') || ''
  const channel = searchParams.get('channel') || ''
  const status = searchParams.get('status') || ''
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    next.set('page', '1')
    setSearchParams(next)
  }

  const setPage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(p))
    setSearchParams(next)
  }

  // Load org list once for the filter dropdown
  useEffect(() => {
    if (!session?.accessToken) return
    api<{ organizations: OrgOption[] }>('/api/v1/admin/organizations?limit=100', { token: session.accessToken })
      .then((d) => setOrgsList(d.organizations || []))
      .catch(() => {})
  }, [session])

  // Load delivery-quality strip (last 30d)
  useEffect(() => {
    if (!session?.accessToken) return
    api<{ byChannel: ChannelStat[] }>('/api/v1/admin/communications/stats?period=30d', { token: session.accessToken })
      .then((d) => setChannelStats(d.byChannel || []))
      .catch(() => {})
  }, [session])

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (organizationId) params.set('organization_id', organizationId)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (view === 'logs') {
      if (channel) params.set('channel', channel)
      if (status) params.set('status', status)
    }
    return params
  }, [page, organizationId, channel, status, from, to, view])

  useEffect(() => {
    if (!session?.accessToken) return
    setLoading(true)
    const params = buildQuery()
    const endpoint = view === 'logs'
      ? `/api/v1/admin/communications/logs?${params}`
      : `/api/v1/admin/communications/sms-threads?${params}`
    api<{ logs?: CommLog[]; messages?: SmsThread[]; pagination: { total: number } }>(endpoint, { token: session.accessToken })
      .then((d) => {
        if (view === 'logs') setLogs(d.logs || [])
        else setThreads(d.messages || [])
        setTotal(d.pagination?.total || 0)
      })
      .catch((err) => console.error('Failed to fetch communications:', err))
      .finally(() => setLoading(false))
  }, [session, buildQuery, view])

  const handleExport = async () => {
    if (!session?.accessToken) return
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (organizationId) params.set('organization_id', organizationId)
      if (channel) params.set('channel', channel)
      if (status) params.set('status', status)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      await downloadCsv(`/api/v1/admin/communications/export?${params}`, session.accessToken, `communications-${new Date().toISOString().split('T')[0]}.csv`)
    } catch (err) {
      console.error('Failed to export communications:', err)
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Communications</h1>
          <p className="text-gray-500 mt-1">SMS & email delivery across all organisations</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || view === 'threads'}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Delivery quality strip */}
      {channelStats.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {channelStats.map((s) => {
            const label = s.channel === 'sms' ? 'SMS' : s.channel.charAt(0).toUpperCase() + s.channel.slice(1)
            const failedRate = s.total > 0 ? Math.round((s.failed / s.total) * 1000) / 10 : 0
            return (
              <div key={s.channel} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">{label} (30d)</p>
                  <p className="text-xs text-gray-400">{s.total.toLocaleString()} total</p>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-semibold text-green-600">{s.delivered.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">Delivered ({s.successRate}%)</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-red-600">{s.failed.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">Failed ({failedRate}%)</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-amber-600">{s.bounced.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">Bounced ({s.bounceRate}%)</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* View toggle */}
      <div className="flex gap-2">
        {(['logs', 'threads'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${view === v ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {v === 'logs' ? 'Delivery Logs' : 'SMS Threads'}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-3">
        <select value={organizationId} onChange={(e) => setFilter('organization_id', e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All organisations</option>
          {orgsList.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {view === 'logs' && (
          <>
            <select value={channel} onChange={(e) => setFilter('channel', e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All channels</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
            <select value={status} onChange={(e) => setFilter('status', e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
              <option value="bounced">Bounced</option>
            </select>
          </>
        )}
        <input type="date" value={from} onChange={(e) => setFilter('from', e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={to} onChange={(e) => setFilter('to', e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-500">Loading...</div>
        ) : view === 'logs' ? (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Organisation</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {logs.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No communications found</td></tr>
              ) : logs.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">{new Date(l.createdAt).toLocaleString('en-GB')}</td>
                  <td className="px-6 py-4 text-sm">
                    <button onClick={() => navigate(`/admin/organizations/${l.organizationId}`)} className="text-gray-900 hover:text-indigo-600">{l.organizationName}</button>
                  </td>
                  <td className="px-6 py-4"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">{l.channel}</span></td>
                  <td className="px-6 py-4 text-sm text-gray-700">{l.recipient}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusPill(l.status)}`}>{l.status}</span>
                    {l.errorMessage && <span className="block text-xs text-red-500 mt-1 max-w-[200px] truncate" title={l.errorMessage}>{l.errorMessage}</span>}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400 font-mono">{l.providerId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Organisation</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">From → To</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {threads.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No SMS messages found</td></tr>
              ) : threads.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">{new Date(m.createdAt).toLocaleString('en-GB')}</td>
                  <td className="px-6 py-4 text-sm">
                    <button onClick={() => navigate(`/admin/organizations/${m.organizationId}`)} className="text-gray-900 hover:text-indigo-600">{m.organizationName}</button>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.direction === 'inbound' ? 'bg-blue-100 text-blue-800' : 'bg-indigo-100 text-indigo-800'}`}>{m.direction}</span>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-500 whitespace-nowrap">{m.fromNumber} → {m.toNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 max-w-md truncate" title={m.body}>{m.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-600">
              Page {page} of {totalPages} • {total.toLocaleString()} total
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(page - 1)} disabled={page <= 1} className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 hover:bg-gray-50">Previous</button>
              <button onClick={() => setPage(page + 1)} disabled={page >= totalPages} className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
