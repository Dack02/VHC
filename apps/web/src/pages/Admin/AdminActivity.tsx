import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api, downloadCsv } from '../../lib/api'

interface PlatformItem {
  id: string
  action: string
  targetType: string | null
  details: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
  superAdmin: { name: string; email: string } | null
}

interface OrgAuditItem {
  id: string
  action: string
  actorType: string
  organizationName: string | null
  resourceType: string | null
  resourceId: string | null
  metadata: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
}

const PAGE_SIZE = 25

export default function AdminActivity() {
  const { session } = useSuperAdmin()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<'platform' | 'org'>('platform')
  const [platform, setPlatform] = useState<PlatformItem[]>([])
  const [orgAudit, setOrgAudit] = useState<OrgAuditItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const page = parseInt(searchParams.get('page') || '1')
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''
  const q = searchParams.get('q') || ''
  const action = searchParams.get('action') || ''

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value); else next.delete(key)
    next.set('page', '1')
    setSearchParams(next)
  }
  const setPage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(p))
    setSearchParams(next)
  }

  const buildQuery = useCallback((forExport: boolean) => {
    const params = new URLSearchParams()
    if (!forExport) {
      if (tab === 'platform') {
        params.set('limit', String(PAGE_SIZE))
        params.set('offset', String((page - 1) * PAGE_SIZE))
      } else {
        params.set('limit', String(PAGE_SIZE))
        params.set('page', String(page))
      }
    }
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (q) params.set('q', q)
    if (tab === 'platform' && action) params.set('action', action)
    return params
  }, [tab, page, from, to, q, action])

  useEffect(() => {
    if (!session?.accessToken) return
    setLoading(true)
    const params = buildQuery(false)
    const endpoint = tab === 'platform' ? `/api/v1/admin/activity?${params}` : `/api/v1/admin/audit?${params}`
    api<{ activity?: PlatformItem[]; logs?: OrgAuditItem[]; pagination: { total: number } }>(endpoint, { token: session.accessToken })
      .then((d) => {
        if (tab === 'platform') setPlatform(d.activity || [])
        else setOrgAudit(d.logs || [])
        setTotal(d.pagination?.total || 0)
      })
      .catch((e) => console.error('Failed to fetch activity:', e))
      .finally(() => setLoading(false))
  }, [session, buildQuery, tab])

  const handleExport = async () => {
    if (!session?.accessToken) return
    setExporting(true)
    try {
      const params = buildQuery(true)
      const endpoint = tab === 'platform' ? `/api/v1/admin/activity/export?${params}` : `/api/v1/admin/audit/export?${params}`
      await downloadCsv(endpoint, session.accessToken, `${tab === 'platform' ? 'admin-activity' : 'org-audit'}-${new Date().toISOString().split('T')[0]}.csv`)
    } catch (e) {
      console.error('Export failed:', e)
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity & Audit</h1>
          <p className="text-gray-500 mt-1">Platform admin actions and organisation-level audit events</p>
        </div>
        <button onClick={handleExport} disabled={exporting} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {([['platform', 'Platform Activity'], ['org', 'Org Audit']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => { setTab(id); setPage(1) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === id ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={q}
          onChange={(e) => setFilter('q', e.target.value)}
          placeholder="Search action / details..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <label className="text-sm text-gray-500">From</label>
        <input type="date" value={from} onChange={(e) => setFilter('from', e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <label className="text-sm text-gray-500">To</label>
        <input type="date" value={to} onChange={(e) => setFilter('to', e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-500">Loading...</div>
        ) : tab === 'platform' ? (
          platform.length === 0 ? (
            <div className="py-16 text-center text-gray-500">No platform activity found</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {platform.map((item) => (
                <div key={item.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getActionColor(item.action)}`}>
                          {formatActionLabel(item.action)}
                        </span>
                        {item.targetType && <span className="text-xs text-gray-500">{item.targetType}</span>}
                      </div>
                      <p className="text-sm text-gray-900 mt-1">
                        <span className="font-medium">{item.superAdmin?.name || 'System'}</span>
                        {item.superAdmin?.email && <span className="text-gray-500"> ({item.superAdmin.email})</span>}
                      </p>
                      {item.details && Object.keys(item.details).length > 0 && !item.action.startsWith('view_') && !item.action.startsWith('list_') && (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Details</summary>
                          <pre className="mt-1 text-xs text-gray-500 bg-gray-50 rounded p-2 whitespace-pre-wrap">{JSON.stringify(item.details, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 ml-4 whitespace-nowrap">{new Date(item.createdAt).toLocaleString('en-GB')}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : orgAudit.length === 0 ? (
          <div className="py-16 text-center text-gray-500">No audit events found</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actor</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Organisation</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {orgAudit.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">{new Date(a.createdAt).toLocaleString('en-GB')}</td>
                  <td className="px-6 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getActionColor(a.action)}`}>{a.action}</span></td>
                  <td className="px-6 py-3 text-sm text-gray-600">{a.actorType}</td>
                  <td className="px-6 py-3 text-sm text-gray-900">{a.organizationName || '—'}</td>
                  <td className="px-6 py-3 text-xs text-gray-500">{a.resourceType}{a.resourceId ? ` · ${a.resourceId.slice(0, 8)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {total > PAGE_SIZE && (
          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-600">Page {page} of {totalPages} • {total.toLocaleString()} total</span>
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

function formatActionLabel(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

function getActionColor(action: string): string {
  if (action.includes('create')) return 'bg-green-100 text-green-800'
  if (action.includes('delete') || action.includes('suspend') || action.includes('deactivate')) return 'bg-red-100 text-red-800'
  if (action.includes('activate') || action.includes('reactivate')) return 'bg-blue-100 text-blue-800'
  if (action.includes('impersonat')) return 'bg-yellow-100 text-yellow-800'
  if (action.includes('update') || action.includes('reset') || action.includes('export')) return 'bg-purple-100 text-purple-800'
  if (action.includes('view') || action.includes('list')) return 'bg-gray-100 text-gray-800'
  return 'bg-gray-100 text-gray-800'
}
