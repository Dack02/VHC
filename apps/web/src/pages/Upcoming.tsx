import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../contexts/SocketContext'
import { api } from '../lib/api'

interface MriProgress {
  completed: number
  total: number
}

interface UpcomingHealthCheck {
  id: string
  status: string
  dueDate: string
  bookingTime: string | null
  customerName: string
  vehicleReg: string
  vehicleMake: string | null
  vehicleModel: string | null
  customerWaiting: boolean
  loanCarRequired: boolean
  bookedRepairs: Array<{ code?: string; description?: string }>
  mriStatus: 'not_started' | 'in_progress' | 'complete'
  mriProgress: MriProgress
}

interface UpcomingDate {
  date: string
  dayLabel: string
  healthChecks: UpcomingHealthCheck[]
}

interface UpcomingData {
  dates: UpcomingDate[]
}

function MriBadge({ status, progress }: { status: string; progress: MriProgress }) {
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rag-green text-white">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        MRI Complete
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rag-amber text-white">
        In Progress {progress.completed}/{progress.total}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
      Not Started
    </span>
  )
}

export default function Upcoming() {
  const { session } = useAuth()
  const { on, off, isConnected } = useSocket()
  const [data, setData] = useState<UpcomingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const token = session?.accessToken

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      setError(null)
      const result = await api<UpcomingData>('/api/v1/dashboard/upcoming', { token })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [token])

  // Debounced refresh for WebSocket events
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastCallRef = useRef<number>(0)

  const debouncedRefresh = useMemo(() => {
    return () => {
      const now = Date.now()
      if (now - lastCallRef.current > 500) {
        lastCallRef.current = now
        fetchData()
        return
      }
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        lastCallRef.current = Date.now()
        fetchData()
      }, 500)
    }
  }, [fetchData])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  useEffect(() => {
    fetchData()
    if (!isConnected) {
      const interval = setInterval(fetchData, 60000)
      return () => clearInterval(interval)
    }
  }, [fetchData, isConnected])

  // Subscribe to real-time events
  useEffect(() => {
    const handleRefresh = () => debouncedRefresh()

    on(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED, handleRefresh)

    return () => {
      off(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED)
    }
  }, [on, off, debouncedRefresh])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
          {error}
        </div>
      </div>
    )
  }

  const dates = data?.dates || []
  const totalBookings = dates.reduce((sum, d) => sum + d.healthChecks.length, 0)

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upcoming Bookings</h1>
        <p className="text-sm text-gray-500 mt-1">
          {totalBookings} booking{totalBookings !== 1 ? 's' : ''} in the next 2 working days
        </p>
      </div>

      {dates.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-3 text-gray-500">No upcoming bookings</p>
        </div>
      ) : (
        dates.map(dateGroup => (
          <div key={dateGroup.date} className="space-y-3">
            {/* Date header */}
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">{dateGroup.dayLabel}</h2>
              <span className="text-sm text-gray-400">
                {dateGroup.healthChecks.length} booking{dateGroup.healthChecks.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Booking cards */}
            <div className="space-y-2">
              {dateGroup.healthChecks.map(hc => (
                <div
                  key={hc.id}
                  className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Vehicle & customer info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-gray-900">
                          {hc.vehicleReg}
                        </span>
                        {hc.bookingTime && (
                          <span className="text-sm text-gray-500">{hc.bookingTime}</span>
                        )}
                        {hc.customerWaiting && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                            Waiting
                          </span>
                        )}
                        {hc.loanCarRequired && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            Loan Car
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        {hc.vehicleMake && hc.vehicleModel
                          ? `${hc.vehicleMake} ${hc.vehicleModel}`
                          : hc.vehicleMake || ''}
                        {(hc.vehicleMake || hc.vehicleModel) && ' \u00B7 '}
                        {hc.customerName}
                      </div>
                      {hc.bookedRepairs && hc.bookedRepairs.length > 0 && (
                        <div className="mt-2 text-xs text-gray-500">
                          <span className="font-medium">Booked: </span>
                          {hc.bookedRepairs.map(r => r.description || r.code).filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Right: MRI status + action */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <MriBadge status={hc.mriStatus} progress={hc.mriProgress} />
                      <Link
                        to={`/health-checks/${hc.id}?tab=mri`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-primary/5 border border-primary/20 rounded-lg hover:bg-primary/10 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        {hc.mriStatus === 'complete' ? 'View MRI' : 'Perform MRI'}
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
