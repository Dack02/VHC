import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../contexts/SocketContext'
import { api } from '../lib/api'

interface TodayData {
  arrivals: {
    totalBookings: number
    arrivedCount: number
    awaitingCount: number
    noShowCount: number
    noShowRate: number
    customerWaitingCount: number
  }
  speed: {
    avgTechInspectionMinutes: number | null
    techSampleSize: number
    avgAdvisorProcessingMinutes: number | null
    advisorSampleSize: number
    avgAuthorizationMinutes: number | null
    authSampleSize: number
  }
  financial: {
    totalIdentified: number
    totalAuthorized: number
    totalDeclined: number
    totalPending: number
    conversionRate: number
  }
  ragBreakdown: {
    red: { identifiedValue: number; authorizedValue: number; itemCount: number; authorizedCount: number }
    amber: { identifiedValue: number; authorizedValue: number; itemCount: number; authorizedCount: number }
    green: { identifiedValue: number; authorizedValue: number; itemCount: number; authorizedCount: number }
  }
  technicians: Array<{
    name: string
    completedCount: number
    avgInspectionMinutes: number | null
    redFound: number
    amberFound: number
    greenFound: number
  }>
  advisors: Array<{
    name: string
    sentCount: number
    avgProcessingMinutes: number | null
    totalValueSent: number
    totalValueAuthorized: number
    conversionRate: number
  }>
  recentActivity: Array<{
    timestamp: string
    vehicleReg: string
    fromStatus: string | null
    toStatus: string
    changedBy: string | null
  }>
}

function formatTime(minutes: number | null): string {
  if (minutes === null) return '-'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function Today() {
  const { session } = useAuth()
  const { on, off, isConnected } = useSocket()
  const [data, setData] = useState<TodayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const token = session?.accessToken

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      setError(null)
      const result = await api<TodayData>('/api/v1/dashboard/today', { token })
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
    on(WS_EVENTS.CUSTOMER_AUTHORIZED, handleRefresh)
    on(WS_EVENTS.CUSTOMER_DECLINED, handleRefresh)
    on(WS_EVENTS.TECHNICIAN_CLOCKED_IN, handleRefresh)
    on(WS_EVENTS.TECHNICIAN_CLOCKED_OUT, handleRefresh)

    return () => {
      off(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED)
      off(WS_EVENTS.CUSTOMER_AUTHORIZED)
      off(WS_EVENTS.CUSTOMER_DECLINED)
      off(WS_EVENTS.TECHNICIAN_CLOCKED_IN)
      off(WS_EVENTS.TECHNICIAN_CLOCKED_OUT)
    }
  }, [on, off, debouncedRefresh])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  const arrivals = data?.arrivals
  const speed = data?.speed
  const financial = data?.financial
  const rag = data?.ragBreakdown

  // Progress bar proportions
  const total = arrivals?.totalBookings || 0
  const arrivedPct = total > 0 ? (arrivals!.arrivedCount / total) * 100 : 0
  const awaitingPct = total > 0 ? (arrivals!.awaitingCount / total) * 100 : 0
  const noShowPct = total > 0 ? (arrivals!.noShowCount / total) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Today</h1>
          <span className={`flex items-center gap-1 text-xs ${isConnected ? 'text-rag-green' : 'text-gray-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-rag-green animate-pulse' : 'bg-gray-400'}`} />
            {isConnected ? 'Live' : 'Polling'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Refresh
          </button>
          <Link
            to="/"
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 rounded-lg"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
          {error}
          <button onClick={fetchData} className="ml-4 underline">Retry</button>
        </div>
      )}

      {/* Section 1 - Arrival Overview */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Arrivals</h2>
          {(arrivals?.customerWaitingCount || 0) > 0 && (
            <span className="px-3 py-1 bg-red-600 text-white text-sm font-bold rounded-full animate-pulse">
              {arrivals!.customerWaitingCount} Customer{arrivals!.customerWaitingCount !== 1 ? 's' : ''} Waiting
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <div>
            <div className="text-3xl font-bold text-gray-900">{arrivals?.totalBookings || 0}</div>
            <div className="text-sm text-gray-500">Total Booked</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-rag-green">{arrivals?.arrivedCount || 0}</div>
            <div className="text-sm text-gray-500">Arrived</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-rag-amber">{arrivals?.awaitingCount || 0}</div>
            <div className="text-sm text-gray-500">Awaiting</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-500">{arrivals?.noShowCount || 0}</div>
            <div className="text-sm text-gray-500">No-Show</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-900">{arrivals?.noShowRate || 0}%</div>
            <div className="text-sm text-gray-500">No-Show Rate</div>
          </div>
        </div>
        {/* Progress bar */}
        {total > 0 && (
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden flex">
            {arrivedPct > 0 && (
              <div
                className="bg-rag-green h-full transition-all duration-500"
                style={{ width: `${arrivedPct}%` }}
                title={`Arrived: ${arrivals!.arrivedCount}`}
              />
            )}
            {awaitingPct > 0 && (
              <div
                className="bg-rag-amber h-full transition-all duration-500"
                style={{ width: `${awaitingPct}%` }}
                title={`Awaiting: ${arrivals!.awaitingCount}`}
              />
            )}
            {noShowPct > 0 && (
              <div
                className="bg-gray-300 h-full transition-all duration-500"
                style={{ width: `${noShowPct}%` }}
                title={`No-Show: ${arrivals!.noShowCount}`}
              />
            )}
          </div>
        )}
      </div>

      {/* Section 2 - Speed Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Tech Inspection</div>
          <div className="text-3xl font-bold text-gray-900">{formatTime(speed?.avgTechInspectionMinutes ?? null)}</div>
          <div className="text-xs text-gray-400 mt-1">{speed?.techSampleSize || 0} inspections</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Advisor Processing</div>
          <div className="text-3xl font-bold text-gray-900">{formatTime(speed?.avgAdvisorProcessingMinutes ?? null)}</div>
          <div className="text-xs text-gray-400 mt-1">{speed?.advisorSampleSize || 0} processed</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Authorization Time</div>
          <div className="text-3xl font-bold text-gray-900">{formatTime(speed?.avgAuthorizationMinutes ?? null)}</div>
          <div className="text-xs text-gray-400 mt-1">{speed?.authSampleSize || 0} responses</div>
        </div>
      </div>

      {/* Section 3 - Financial Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Total Identified</div>
          <div className="text-2xl font-bold text-gray-900">{formatCurrency(financial?.totalIdentified || 0)}</div>
        </div>
        <div className="bg-white border-2 border-rag-green rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Authorized</div>
          <div className="text-2xl font-bold text-rag-green">{formatCurrency(financial?.totalAuthorized || 0)}</div>
        </div>
        <div className="bg-white border-2 border-rag-red rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Declined</div>
          <div className="text-2xl font-bold text-rag-red">{formatCurrency(financial?.totalDeclined || 0)}</div>
        </div>
        <div className="bg-white border-2 border-rag-amber rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Pending</div>
          <div className="text-2xl font-bold text-rag-amber">{formatCurrency(financial?.totalPending || 0)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Conversion Rate</div>
          <div className="text-2xl font-bold text-primary">{financial?.conversionRate || 0}%</div>
        </div>
      </div>

      {/* Section 4 - RAG Value Breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Value Breakdown by RAG</h2>
        <div className="space-y-4">
          {/* Red row */}
          <div className="flex items-center gap-4">
            <div className="w-16 text-sm font-medium text-rag-red">Red</div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600">{rag?.red.itemCount || 0} items</span>
                <span className="text-sm font-medium text-gray-900">{formatCurrency(rag?.red.identifiedValue || 0)}</span>
              </div>
              <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="bg-rag-red h-full rounded-full transition-all duration-500"
                  style={{
                    width: (rag?.red.identifiedValue || 0) > 0
                      ? `${Math.max(((rag?.red.authorizedValue || 0) / (rag?.red.identifiedValue || 1)) * 100, 2)}%`
                      : '0%'
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-400">{rag?.red.authorizedCount || 0} authorized</span>
                <span className="text-xs font-medium text-rag-green">{formatCurrency(rag?.red.authorizedValue || 0)}</span>
              </div>
            </div>
            <div className="w-16 text-right text-sm font-medium text-gray-600">
              {(rag?.red.identifiedValue || 0) > 0
                ? `${Math.round(((rag?.red.authorizedValue || 0) / (rag?.red.identifiedValue || 1)) * 100)}%`
                : '-'}
            </div>
          </div>

          {/* Amber row */}
          <div className="flex items-center gap-4">
            <div className="w-16 text-sm font-medium text-rag-amber">Amber</div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600">{rag?.amber.itemCount || 0} items</span>
                <span className="text-sm font-medium text-gray-900">{formatCurrency(rag?.amber.identifiedValue || 0)}</span>
              </div>
              <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="bg-rag-amber h-full rounded-full transition-all duration-500"
                  style={{
                    width: (rag?.amber.identifiedValue || 0) > 0
                      ? `${Math.max(((rag?.amber.authorizedValue || 0) / (rag?.amber.identifiedValue || 1)) * 100, 2)}%`
                      : '0%'
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-400">{rag?.amber.authorizedCount || 0} authorized</span>
                <span className="text-xs font-medium text-rag-green">{formatCurrency(rag?.amber.authorizedValue || 0)}</span>
              </div>
            </div>
            <div className="w-16 text-right text-sm font-medium text-gray-600">
              {(rag?.amber.identifiedValue || 0) > 0
                ? `${Math.round(((rag?.amber.authorizedValue || 0) / (rag?.amber.identifiedValue || 1)) * 100)}%`
                : '-'}
            </div>
          </div>

          {/* Green row */}
          {(rag?.green.itemCount || 0) > 0 && (
          <div className="flex items-center gap-4">
            <div className="w-16 text-sm font-medium text-rag-green">Green</div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600">{rag?.green.itemCount || 0} items</span>
                <span className="text-sm font-medium text-gray-900">{formatCurrency(rag?.green.identifiedValue || 0)}</span>
              </div>
              <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="bg-rag-green h-full rounded-full transition-all duration-500"
                  style={{
                    width: (rag?.green.identifiedValue || 0) > 0
                      ? `${Math.max(((rag?.green.authorizedValue || 0) / (rag?.green.identifiedValue || 1)) * 100, 2)}%`
                      : '0%'
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-400">{rag?.green.authorizedCount || 0} authorized</span>
                <span className="text-xs font-medium text-rag-green">{formatCurrency(rag?.green.authorizedValue || 0)}</span>
              </div>
            </div>
            <div className="w-16 text-right text-sm font-medium text-gray-600">
              {(rag?.green.identifiedValue || 0) > 0
                ? `${Math.round(((rag?.green.authorizedValue || 0) / (rag?.green.identifiedValue || 1)) * 100)}%`
                : '-'}
            </div>
          </div>
          )}

          {/* Combined total */}
          <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Total Authorized</span>
            <span className="text-lg font-bold text-rag-green">
              {formatCurrency((rag?.red.authorizedValue || 0) + (rag?.amber.authorizedValue || 0) + (rag?.green.authorizedValue || 0))}
            </span>
          </div>
        </div>
      </div>

      {/* Section 5 & 6 - Tables side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Section 5 - Technician Leaderboard */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900">Technician Leaderboard</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-center">Done</th>
                  <th className="px-4 py-3 text-center">Avg Time</th>
                  <th className="px-4 py-3 text-center text-rag-red">R</th>
                  <th className="px-4 py-3 text-center text-rag-amber">A</th>
                  <th className="px-4 py-3 text-center text-rag-green">G</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.technicians.map((tech, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{tech.name}</td>
                    <td className="px-4 py-3 text-sm text-center text-gray-900 font-semibold">{tech.completedCount}</td>
                    <td className="px-4 py-3 text-sm text-center text-gray-600">{formatTime(tech.avgInspectionMinutes)}</td>
                    <td className="px-4 py-3 text-sm text-center text-rag-red font-medium">{tech.redFound}</td>
                    <td className="px-4 py-3 text-sm text-center text-rag-amber font-medium">{tech.amberFound}</td>
                    <td className="px-4 py-3 text-sm text-center text-rag-green font-medium">{tech.greenFound}</td>
                  </tr>
                ))}
                {(!data?.technicians || data.technicians.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">No technician data today</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 6 - Advisor Performance */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900">Advisor Performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-center">Sent</th>
                  <th className="px-4 py-3 text-center">Avg Time</th>
                  <th className="px-4 py-3 text-right">Sent Value</th>
                  <th className="px-4 py-3 text-right">Auth Value</th>
                  <th className="px-4 py-3 text-center">Conv %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.advisors.map((adv, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{adv.name}</td>
                    <td className="px-4 py-3 text-sm text-center text-gray-900 font-semibold">{adv.sentCount}</td>
                    <td className="px-4 py-3 text-sm text-center text-gray-600">{formatTime(adv.avgProcessingMinutes)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{formatCurrency(adv.totalValueSent)}</td>
                    <td className="px-4 py-3 text-sm text-right text-rag-green font-medium">{formatCurrency(adv.totalValueAuthorized)}</td>
                    <td className="px-4 py-3 text-sm text-center text-primary font-semibold">{adv.conversionRate}%</td>
                  </tr>
                ))}
                {(!data?.advisors || data.advisors.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">No advisor data today</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section 7 - Live Activity Feed */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 p-4 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Activity Feed</h2>
          <span className="text-xs text-gray-400">Last 20 status changes</span>
        </div>
        <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {data?.recentActivity.map((activity, i) => {
            const time = new Date(activity.timestamp)
            return (
              <div key={i} className="px-4 py-3 hover:bg-gray-50 flex items-center gap-4">
                <div className="text-xs text-gray-400 w-14 shrink-0">
                  {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="font-mono text-sm font-medium text-gray-900 bg-yellow-50 px-2 py-0.5 border border-gray-200 rounded-lg shrink-0">
                  {activity.vehicleReg}
                </div>
                <div className="flex items-center gap-2 text-sm min-w-0">
                  {activity.fromStatus && (
                    <>
                      <span className="text-gray-500 truncate">{formatStatus(activity.fromStatus)}</span>
                      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                  <span className="text-gray-900 font-medium truncate">{formatStatus(activity.toStatus)}</span>
                </div>
                {activity.changedBy && (
                  <div className="text-xs text-gray-400 ml-auto shrink-0">{activity.changedBy}</div>
                )}
              </div>
            )
          })}
          {(!data?.recentActivity || data.recentActivity.length === 0) && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No activity today</div>
          )}
        </div>
      </div>
    </div>
  )
}
