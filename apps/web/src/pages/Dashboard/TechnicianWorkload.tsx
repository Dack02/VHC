import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface TechnicianWorkload {
  id: string
  firstName: string
  lastName: string
  siteId: string
  status: 'working' | 'available' | 'idle'
  currentJob: {
    id: string
    vehicle: { registration: string; make?: string; model?: string }
    timeElapsedMinutes: number
  } | null
  queueCount: number
  completedToday: number
  isClockedIn: boolean
}

interface WorkloadSummary {
  total: number
  working: number
  available: number
  idle: number
}

interface WorkloadData {
  technicians: TechnicianWorkload[]
  summary: WorkloadSummary
}

export default function TechnicianWorkload() {
  const { session } = useAuth()
  const token = session?.accessToken
  const [data, setData] = useState<WorkloadData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkload = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      const workloadData = await api<WorkloadData>('/api/v1/dashboard/technicians', { token })
      setData(workloadData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workload')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchWorkload()
    // Refresh every 30 seconds
    const interval = setInterval(fetchWorkload, 30000)
    return () => clearInterval(interval)
  }, [fetchWorkload])

  const formatTime = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-500 hover:text-gray-700">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Technician Workload</h1>
        </div>
        <button
          onClick={fetchWorkload}
          className="px-4 py-2 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 p-4 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">Dismiss</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-gray-900">{data?.summary.total || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Total Technicians</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-rag-green">{data?.summary.working || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Working</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-rag-amber">{data?.summary.available || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Available</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-gray-400">{data?.summary.idle || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Not Clocked In</div>
        </div>
      </div>

      {/* Technician Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.technicians.map((tech) => (
          <div
            key={tech.id}
            className={`bg-white border shadow-sm ${
              tech.status === 'working' ? 'border-rag-green border-l-4' :
              tech.status === 'available' ? 'border-rag-amber border-l-4' :
              'border-gray-200'
            }`}
          >
            {/* Technician Header */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    tech.status === 'working' ? 'bg-rag-green' :
                    tech.status === 'available' ? 'bg-rag-amber' : 'bg-gray-400'
                  }`} />
                  <div>
                    <div className="font-semibold text-gray-900">
                      {tech.firstName} {tech.lastName}
                    </div>
                    <div className="text-xs text-gray-500 capitalize">
                      {tech.status === 'working' ? 'Working on job' :
                       tech.status === 'available' ? 'Clocked in, available' :
                       'Not clocked in'}
                    </div>
                  </div>
                </div>
                {tech.isClockedIn && (
                  <span className="px-2 py-0.5 text-xs bg-rag-green-bg text-rag-green font-medium">
                    CLOCKED IN
                  </span>
                )}
              </div>
            </div>

            {/* Current Job */}
            {tech.currentJob && (
              <Link
                to={`/health-checks/${tech.currentJob.id}`}
                className="block p-4 bg-rag-green-bg hover:bg-green-100 transition-colors"
              >
                <div className="text-xs text-rag-green font-medium mb-1">CURRENT JOB</div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-gray-900">{tech.currentJob.vehicle.registration}</div>
                    {tech.currentJob.vehicle.make && (
                      <div className="text-sm text-gray-600">
                        {tech.currentJob.vehicle.make} {tech.currentJob.vehicle.model}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-rag-green">
                      {formatTime(tech.currentJob.timeElapsedMinutes)}
                    </div>
                    <div className="text-xs text-gray-500">elapsed</div>
                  </div>
                </div>
              </Link>
            )}

            {/* Stats */}
            <div className="p-4 grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{tech.queueCount}</div>
                <div className="text-xs text-gray-500">In Queue</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-rag-green">{tech.completedToday}</div>
                <div className="text-xs text-gray-500">Completed Today</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {data?.technicians.length === 0 && (
        <div className="bg-white border border-gray-200 p-8 text-center text-gray-500">
          No technicians found in your organization
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-rag-green"></div>
          <span>Working on job</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-rag-amber"></div>
          <span>Clocked in, available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-400"></div>
          <span>Not clocked in</span>
        </div>
      </div>
    </div>
  )
}
