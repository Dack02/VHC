import { useState, useEffect, useCallback } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

type Status = 'ok' | 'degraded' | 'down' | 'unknown'

interface QueueItem {
  name: string
  waiting?: number
  active?: number
  delayed?: number
  failed?: number
  completed?: number
  error?: boolean
}

interface HealthData {
  overall: Status
  api: { status: Status; uptimeSeconds: number; nodeEnv: string }
  db: { status: Status; latencyMs?: number; detail?: string }
  queues: { status: Status; redisConnected: boolean; workerCount: number; items: QueueItem[] }
  comms: { status: Status; smsConfigured: boolean; emailConfigured: boolean; encryptionConfigured: boolean }
  database?: { database_size_pretty?: string; top_tables?: Array<{ name: string; size_pretty: string }> }
  migrations?: { latest_version?: string; count?: number }
}

const statusBg = (s: Status) =>
  s === 'ok' ? 'bg-rag-green' : s === 'degraded' ? 'bg-rag-amber' : s === 'down' ? 'bg-rag-red' : 'bg-gray-400'

function StatusCard({ title, status, children }: { title: string; status: Status; children?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{title}</p>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${statusBg(status)}`}>
          {status}
        </span>
      </div>
      {children && <div className="mt-3 text-sm text-gray-600 space-y-1">{children}</div>}
    </div>
  )
}

export default function AdminSystemHealth() {
  const { session } = useSuperAdmin()
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [deepLoading, setDeepLoading] = useState(false)

  const fetchHealth = useCallback(async (include: 'cheap' | 'all') => {
    if (!session?.accessToken) return
    if (include === 'all') setDeepLoading(true)
    try {
      const d = await api<HealthData>(`/api/v1/admin/system/health?include=${include}`, { token: session.accessToken })
      setData(d)
    } catch (e) {
      console.error('Failed to fetch system health:', e)
    } finally {
      setLoading(false)
      setDeepLoading(false)
    }
  }, [session])

  useEffect(() => {
    fetchHealth('cheap')
    const interval = setInterval(() => fetchHealth('cheap'), 30000)
    return () => clearInterval(interval)
  }, [fetchHealth])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-500">Checking system health...</div></div>
  }

  if (!data) {
    return <div className="text-center py-12 text-gray-500">Failed to load system health</div>
  }

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
          <p className="text-gray-500 mt-1">Infrastructure status — refreshes every 30s</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium text-white ${statusBg(data.overall)}`}>
            Overall: {data.overall}
          </span>
          <button
            onClick={() => fetchHealth('all')}
            disabled={deepLoading}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {deepLoading ? 'Running...' : 'Run deep checks'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard title="API" status={data.api.status}>
          <div>Uptime: {fmtUptime(data.api.uptimeSeconds)}</div>
          <div>Env: {data.api.nodeEnv}</div>
        </StatusCard>
        <StatusCard title="Database" status={data.db.status}>
          {data.db.latencyMs != null && <div>Latency: {data.db.latencyMs}ms</div>}
          {data.db.detail && <div className="text-red-500">{data.db.detail}</div>}
          {data.database?.database_size_pretty && <div>Size: {data.database.database_size_pretty}</div>}
        </StatusCard>
        <StatusCard title="Queues / Workers" status={data.queues.status}>
          <div>Redis: {data.queues.redisConnected ? 'connected' : 'down'}</div>
          <div>Workers attached: {data.queues.workerCount}</div>
        </StatusCard>
        <StatusCard title="Comms Providers" status={data.comms.status}>
          <div>SMS configured: {data.comms.smsConfigured ? 'yes' : 'no'}</div>
          <div>Email configured: {data.comms.emailConfigured ? 'yes' : 'no'}</div>
          <div>Encryption: {data.comms.encryptionConfigured ? 'yes' : 'no'}</div>
        </StatusCard>
      </div>

      {/* Queue depths */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Queue Depths</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Queue</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Waiting</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Active</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Delayed</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Failed</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Completed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.queues.items.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">{data.queues.redisConnected ? 'No queues' : 'Redis not connected'}</td></tr>
            ) : data.queues.items.map((q) => (
              <tr key={q.name}>
                <td className="px-6 py-3 font-medium text-gray-900">{q.name}</td>
                {q.error ? (
                  <td colSpan={5} className="px-6 py-3 text-right text-red-500">probe error</td>
                ) : (
                  <>
                    <td className="px-6 py-3 text-right text-gray-700">{q.waiting ?? 0}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{q.active ?? 0}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{q.delayed ?? 0}</td>
                    <td className={`px-6 py-3 text-right ${(q.failed ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-gray-700'}`}>{q.failed ?? 0}</td>
                    <td className="px-6 py-3 text-right text-gray-400">{q.completed ?? 0}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Deep info */}
      {(data.database?.top_tables || data.migrations) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.migrations && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Migrations</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">Latest applied</dt><dd className="font-mono text-gray-900">{data.migrations.latest_version || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Total applied</dt><dd className="text-gray-900">{data.migrations.count ?? '—'}</dd></div>
              </dl>
            </div>
          )}
          {data.database?.top_tables && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Largest Tables</h2>
              <div className="space-y-1 text-sm">
                {data.database.top_tables.slice(0, 8).map((t) => (
                  <div key={t.name} className="flex justify-between">
                    <span className="text-gray-700 font-mono">{t.name}</span>
                    <span className="text-gray-500">{t.size_pretty}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
