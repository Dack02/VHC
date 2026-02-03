import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../contexts/SocketContext'
import { api } from '../lib/api'
import DmsImportModal from './DmsImportModal'

interface DashboardMetrics {
  totalToday: number
  completedToday: number
  conversionRate: number
  avgResponseTimeMinutes: number
  totalValueSent: number
  totalValueAuthorized: number
  totalValueDeclined: number
}

interface StatusCounts {
  [key: string]: number
}

interface ColumnCounts {
  technician: number
  tech_done: number
  advisor: number
  customer: number
  actioned: number
}

interface Alerts {
  overdueCount: number
  expiringLinksCount: number
}

interface QueueItem {
  id: string
  status: string
  promise_time?: string
  token_expires_at?: string
  created_at: string
  vehicle?: { registration: string; make: string; model: string }
  customer?: { first_name: string; last_name: string }
  technician?: { first_name: string; last_name: string }
  advisor?: { first_name: string; last_name: string }
  alertType?: string
}

interface DashboardData {
  metrics: DashboardMetrics
  statusCounts: StatusCounts
  columnCounts: ColumnCounts
  alerts: Alerts
  period: { from: string; to: string }
}

interface MonthlyKpiMonth {
  label: string
  hcCount: number
  completedCount: number
  redSoldPct: number | null
  avgIdentified: number | null
  avgSold: number | null
  avgPerDay: number
  topAdvisor: { advisorId: string; name: string; redSoldPct: number; totalSold: number; score: number } | null
}

interface MonthlyKpiData {
  currentMonth: MonthlyKpiMonth
  previousMonth: MonthlyKpiMonth
  deltas: {
    redSoldPct: number | null
    avgIdentified: number | null
    avgSold: number | null
    avgPerDay: number | null
  }
}

interface QueuesData {
  needsAttention: { items: QueueItem[]; total: number }
  technicianQueue: { items: QueueItem[]; total: number }
  advisorQueue: { items: QueueItem[]; total: number }
  customerQueue: { items: QueueItem[]; total: number }
}

interface TechnicianWorkload {
  id: string
  firstName: string
  lastName: string
  status: 'working' | 'available' | 'idle'
  currentJob: { id: string; vehicle: { registration: string }; timeElapsedMinutes: number } | null
  queueCount: number
  completedToday: number
  isClockedIn: boolean
}

interface AwaitingArrivalItem {
  id: string
  registration: string
  make: string
  model: string
  customerName: string
  promiseTime: string | null
  dueDate: string | null
  importedAt: string
  // Phase 1 Quick Wins
  customerWaiting: boolean
  loanCarRequired: boolean
  bookedRepairs: Array<{ code?: string; description?: string; notes?: string }>
  jobsheetNumber: string | null
}

interface AwaitingCheckinItem {
  id: string
  registration: string
  make: string
  model: string
  customerName: string
  arrivedAt: string
  customerWaiting: boolean
}

export default function Dashboard() {
  const { user, session } = useAuth()
  const { on, off, isConnected } = useSocket()
  const [data, setData] = useState<DashboardData | null>(null)
  const [queues, setQueues] = useState<QueuesData | null>(null)
  const [technicians, setTechnicians] = useState<TechnicianWorkload[]>([])
  const [awaitingArrival, setAwaitingArrival] = useState<AwaitingArrivalItem[]>([])
  const [awaitingArrivalTotal, setAwaitingArrivalTotal] = useState(0)
  const [awaitingArrivalLoading, setAwaitingArrivalLoading] = useState(false)
  const [awaitingCheckin, setAwaitingCheckin] = useState<AwaitingCheckinItem[]>([])
  const [awaitingCheckinLoading, setAwaitingCheckinLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [liveUpdate, setLiveUpdate] = useState<string | null>(null)
  const [dmsEnabled, setDmsEnabled] = useState(false)
  const [showDmsModal, setShowDmsModal] = useState(false)
  const [monthlyKpis, setMonthlyKpis] = useState<MonthlyKpiData | null>(null)

  const token = session?.accessToken

  // Filters
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('today')

  const fetchDashboard = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      setError(null)

      // Calculate date range
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      let dateFrom = today.toISOString()
      const dateTo = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()

      if (dateRange === 'week') {
        dateFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      } else if (dateRange === 'month') {
        dateFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      }

      // Fetch all data in parallel
      const [dashboardData, queuesData, techData] = await Promise.all([
        api<DashboardData>(`/api/v1/dashboard?date_from=${dateFrom}&date_to=${dateTo}`, { token }),
        api<QueuesData>('/api/v1/dashboard/queues', { token }),
        api<{ technicians: TechnicianWorkload[]; summary: unknown }>('/api/v1/dashboard/technicians', { token }).catch(() => ({ technicians: [], summary: {} }))
      ])

      setData(dashboardData)
      setQueues(queuesData)
      setTechnicians(techData.technicians || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [token, dateRange])

  // Fetch awaiting arrival health checks (from DMS imports)
  const fetchAwaitingArrival = useCallback(async () => {
    if (!token) return
    try {
      setAwaitingArrivalLoading(true)
      const response = await api<{ healthChecks: AwaitingArrivalItem[]; pagination: { total: number } }>('/api/v1/dms-settings/unactioned?limit=200', { token })
      setAwaitingArrival(response.healthChecks || [])
      setAwaitingArrivalTotal(response.pagination?.total ?? response.healthChecks?.length ?? 0)
    } catch (err) {
      console.error('Failed to fetch awaiting arrival:', err)
    } finally {
      setAwaitingArrivalLoading(false)
    }
  }, [token])

  // Fetch awaiting check-in health checks
  const fetchAwaitingCheckin = useCallback(async () => {
    if (!token) return
    try {
      setAwaitingCheckinLoading(true)
      const response = await api<{ healthChecks: Array<{
        id: string
        arrived_at: string | null
        customer_waiting: boolean
        vehicle: {
          registration: string
          make: string
          model: string
          customer: { first_name: string; last_name: string } | null
        } | null
      }> }>('/api/v1/health-checks?status=awaiting_checkin&limit=50', { token })

      setAwaitingCheckin((response.healthChecks || []).map(hc => ({
        id: hc.id,
        registration: hc.vehicle?.registration || 'Unknown',
        make: hc.vehicle?.make || '',
        model: hc.vehicle?.model || '',
        customerName: hc.vehicle?.customer ? `${hc.vehicle.customer.first_name} ${hc.vehicle.customer.last_name}` : 'Unknown',
        arrivedAt: hc.arrived_at || '',
        customerWaiting: hc.customer_waiting || false
      })))
    } catch (err) {
      console.error('Failed to fetch awaiting checkin:', err)
    } finally {
      setAwaitingCheckinLoading(false)
    }
  }, [token])

  // Check if DMS integration is enabled
  const checkDmsEnabled = useCallback(async () => {
    if (!token) return
    try {
      const settings = await api<{ enabled?: boolean; credentialsConfigured?: boolean }>('/api/v1/dms-settings/settings', { token })
      setDmsEnabled(settings?.enabled === true && settings?.credentialsConfigured === true)
    } catch {
      setDmsEnabled(false)
    }
  }, [token])

  // Fetch monthly KPIs
  const fetchMonthlyKpis = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<MonthlyKpiData>('/api/v1/dashboard/monthly-kpis', { token })
      setMonthlyKpis(data)
    } catch (err) {
      console.error('Failed to fetch monthly KPIs:', err)
    }
  }, [token])

  // Debounced refresh for WebSocket events (500ms, leading + trailing)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastCallRef = useRef<number>(0)

  const debouncedRefresh = useMemo(() => {
    return () => {
      const now = Date.now()
      // Leading edge: fire immediately if >500ms since last call
      if (now - lastCallRef.current > 500) {
        lastCallRef.current = now
        fetchDashboard()
        return
      }
      // Trailing edge: debounce subsequent calls
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        lastCallRef.current = Date.now()
        fetchDashboard()
      }, 500)
    }
  }, [fetchDashboard])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
    // Only poll if WebSocket is disconnected (fallback)
    if (!isConnected) {
      const interval = setInterval(fetchDashboard, 30000)
      return () => clearInterval(interval)
    }
  }, [fetchDashboard, isConnected])

  // Initial fetch for awaiting arrival, check-in, DMS status, and monthly KPIs
  useEffect(() => {
    fetchAwaitingArrival()
    fetchAwaitingCheckin()
    checkDmsEnabled()
    fetchMonthlyKpis()
  }, [fetchAwaitingArrival, fetchAwaitingCheckin, checkDmsEnabled, fetchMonthlyKpis])

  // Subscribe to real-time WebSocket events (debounced to prevent request storms)
  useEffect(() => {
    const handleStatusChange = (data: { healthCheckId: string; status: string; vehicleReg: string }) => {
      setLiveUpdate(`${data.vehicleReg} → ${data.status.replace('_', ' ')}`)
      setTimeout(() => setLiveUpdate(null), 3000)
      debouncedRefresh()
      // Refresh check-in list if status changed to/from awaiting_checkin
      if (data.status === 'awaiting_checkin' || data.status === 'created') {
        fetchAwaitingCheckin()
      }
    }

    const handleCustomerAction = (data: { vehicleReg: string; action: string }) => {
      const actionText = data.action === 'authorized' ? 'Authorized' : data.action === 'declined' ? 'Declined' : 'Signed'
      setLiveUpdate(`${data.vehicleReg} - Customer ${actionText}!`)
      setTimeout(() => setLiveUpdate(null), 3000)
      debouncedRefresh()
    }

    const handleTechnicianClocked = (data: { technicianName: string; vehicleReg: string }) => {
      setLiveUpdate(`${data.technicianName} started ${data.vehicleReg}`)
      setTimeout(() => setLiveUpdate(null), 3000)
      debouncedRefresh()
    }

    on(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED, handleStatusChange)
    on(WS_EVENTS.CUSTOMER_AUTHORIZED, handleCustomerAction)
    on(WS_EVENTS.CUSTOMER_DECLINED, handleCustomerAction)
    on(WS_EVENTS.TECHNICIAN_CLOCKED_IN, handleTechnicianClocked)
    on(WS_EVENTS.TECHNICIAN_CLOCKED_OUT, handleTechnicianClocked)

    return () => {
      off(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED)
      off(WS_EVENTS.CUSTOMER_AUTHORIZED)
      off(WS_EVENTS.CUSTOMER_DECLINED)
      off(WS_EVENTS.TECHNICIAN_CLOCKED_IN)
      off(WS_EVENTS.TECHNICIAN_CLOCKED_OUT)
    }
  }, [on, off, debouncedRefresh, fetchAwaitingCheckin])

  // Check if onboarding is incomplete (only show for org admins)
  const showOnboardingReminder =
    user?.isOrgAdmin &&
    user?.organization?.onboardingCompleted === false

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
  }

  // Mark a vehicle as arrived
  const handleMarkArrived = async (healthCheckId: string) => {
    if (!token) return
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/mark-arrived`, {
        method: 'POST',
        token
      })
      // Refresh awaiting arrival list
      fetchAwaitingArrival()
      // Also refresh dashboard to update counts
      fetchDashboard()
      setLiveUpdate('Vehicle marked as arrived')
      setTimeout(() => setLiveUpdate(null), 3000)
    } catch (err) {
      console.error('Failed to mark arrived:', err)
      setError(err instanceof Error ? err.message : 'Failed to mark vehicle as arrived')
    }
  }

  // Mark a vehicle as no-show
  const handleMarkNoShow = async (healthCheckId: string) => {
    if (!token) return
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/mark-no-show`, {
        method: 'POST',
        token
      })
      // Refresh awaiting arrival list
      fetchAwaitingArrival()
      setLiveUpdate('Vehicle marked as no-show')
      setTimeout(() => setLiveUpdate(null), 3000)
    } catch (err) {
      console.error('Failed to mark no-show:', err)
      setError(err instanceof Error ? err.message : 'Failed to mark vehicle as no-show')
    }
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
      {/* Onboarding Reminder Banner */}
      {showOnboardingReminder && (
        <div className="bg-amber-50 border border-amber-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-amber-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-medium text-amber-800">Complete your organization setup</p>
                <p className="text-sm text-amber-700">Finish setting up your organization to unlock all features.</p>
              </div>
            </div>
            <Link
              to="/onboarding"
              className="px-4 py-2 bg-amber-500 text-white hover:bg-amber-600 transition-colors text-sm font-medium"
            >
              Continue Setup
            </Link>
          </div>
        </div>
      )}

      {/* Live Update Toast */}
      {liveUpdate && (
        <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:w-auto z-50 bg-primary text-white px-4 py-2 shadow-lg animate-pulse text-center md:text-left">
          {liveUpdate}
        </div>
      )}

      {/* Header with filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          {/* Connection Status */}
          <span className={`flex items-center gap-1 text-xs ${isConnected ? 'text-rag-green' : 'text-gray-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-rag-green' : 'bg-gray-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          {/* Date Range Filter */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setDateRange('today')}
              className={`px-3 py-1.5 text-sm font-medium ${
                dateRange === 'today'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateRange('week')}
              className={`px-3 py-1.5 text-sm font-medium ${
                dateRange === 'week'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => setDateRange('month')}
              className={`px-3 py-1.5 text-sm font-medium ${
                dateRange === 'month'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              30 Days
            </button>
          </div>
          {/* Quick Links */}
          {dmsEnabled && (
            <button
              onClick={() => setShowDmsModal(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 rounded-lg flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              DMS Import
            </button>
          )}
          <Link
            to="/health-checks"
            className="px-4 py-2 bg-primary text-white text-sm font-medium hover:bg-primary/90 rounded-lg"
          >
            Kanban Board
          </Link>
          <Link
            to="/today"
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 rounded-lg"
          >
            Today
          </Link>
          <Link
            to="/reports"
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 rounded-lg"
          >
            Reports
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 p-4 text-red-700">
          {error}
          <button onClick={fetchDashboard} className="ml-4 underline">Retry</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-3xl font-bold text-gray-900">{data?.metrics.totalToday || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Total</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-3xl font-bold text-rag-green">{data?.metrics.completedToday || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Completed</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-3xl font-bold text-primary">{data?.metrics.conversionRate || 0}%</div>
          <div className="text-sm text-gray-500 mt-1">Conversion Rate</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-3xl font-bold text-gray-900">{data?.metrics.avgResponseTimeMinutes || 0}m</div>
          <div className="text-sm text-gray-500 mt-1">Avg Response</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-xl font-bold text-rag-green">{formatCurrency(data?.metrics.totalValueAuthorized || 0)}</div>
          <div className="text-sm text-gray-500 mt-1">Authorized</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-xl font-bold text-rag-red">{formatCurrency(data?.metrics.totalValueDeclined || 0)}</div>
          <div className="text-sm text-gray-500 mt-1">Declined</div>
        </div>
      </div>

      {/* Monthly Performance KPIs */}
      {monthlyKpis && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Monthly Performance — {monthlyKpis.currentMonth.label}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* Red Work Sold % */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div className="text-sm text-gray-500">Red Work Sold %</div>
                {monthlyKpis.deltas.redSoldPct !== null && (
                  <span className={`flex items-center text-xs font-medium ${monthlyKpis.deltas.redSoldPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    <svg className={`w-3 h-3 mr-0.5 ${monthlyKpis.deltas.redSoldPct < 0 ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    {monthlyKpis.deltas.redSoldPct > 0 ? '+' : ''}{monthlyKpis.deltas.redSoldPct}%
                  </span>
                )}
              </div>
              <div className="text-3xl font-bold text-gray-900 mt-2">
                {monthlyKpis.currentMonth.redSoldPct !== null ? `${monthlyKpis.currentMonth.redSoldPct}%` : '--'}
              </div>
            </div>

            {/* Avg HC Value Identified */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div className="text-sm text-gray-500">Avg Identified</div>
                {monthlyKpis.deltas.avgIdentified !== null && (
                  <span className={`flex items-center text-xs font-medium ${monthlyKpis.deltas.avgIdentified >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    <svg className={`w-3 h-3 mr-0.5 ${monthlyKpis.deltas.avgIdentified < 0 ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    {monthlyKpis.deltas.avgIdentified > 0 ? '+' : ''}{formatCurrency(monthlyKpis.deltas.avgIdentified)}
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-2">
                {monthlyKpis.currentMonth.avgIdentified !== null ? formatCurrency(monthlyKpis.currentMonth.avgIdentified) : '--'}
              </div>
            </div>

            {/* Avg HC Value Sold */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div className="text-sm text-gray-500">Avg Sold</div>
                {monthlyKpis.deltas.avgSold !== null && (
                  <span className={`flex items-center text-xs font-medium ${monthlyKpis.deltas.avgSold >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    <svg className={`w-3 h-3 mr-0.5 ${monthlyKpis.deltas.avgSold < 0 ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    {monthlyKpis.deltas.avgSold > 0 ? '+' : ''}{formatCurrency(monthlyKpis.deltas.avgSold)}
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-2">
                {monthlyKpis.currentMonth.avgSold !== null ? formatCurrency(monthlyKpis.currentMonth.avgSold) : '--'}
              </div>
            </div>

            {/* Avg HCs Completed Per Day */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div className="text-sm text-gray-500">HCs / Day</div>
                {monthlyKpis.deltas.avgPerDay !== null && (
                  <span className={`flex items-center text-xs font-medium ${monthlyKpis.deltas.avgPerDay >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    <svg className={`w-3 h-3 mr-0.5 ${monthlyKpis.deltas.avgPerDay < 0 ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    {monthlyKpis.deltas.avgPerDay > 0 ? '+' : ''}{monthlyKpis.deltas.avgPerDay}
                  </span>
                )}
              </div>
              <div className="text-3xl font-bold text-gray-900 mt-2">
                {monthlyKpis.currentMonth.avgPerDay}
              </div>
            </div>

            {/* Advisor of the Month */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="text-sm text-gray-500">Advisor of the Month</div>
              {monthlyKpis.currentMonth.topAdvisor ? (
                <div className="mt-2">
                  <div className="text-lg font-bold text-gray-900 truncate">{monthlyKpis.currentMonth.topAdvisor.name}</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {Math.round(monthlyKpis.currentMonth.topAdvisor.redSoldPct)}% red sold · {formatCurrency(monthlyKpis.currentMonth.topAdvisor.totalSold)}
                  </div>
                </div>
              ) : (
                <div className="text-2xl font-bold text-gray-400 mt-2">--</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Alerts Section */}
      {(data?.alerts.overdueCount || 0) + (data?.alerts.expiringLinksCount || 0) > 0 && (
        <div className="bg-rag-red-bg border border-rag-red p-4">
          <div className="flex items-center gap-6">
            {(data?.alerts.overdueCount || 0) > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-rag-red font-bold text-xl">{data?.alerts.overdueCount}</span>
                <span className="text-rag-red">Overdue Items</span>
              </div>
            )}
            {(data?.alerts.expiringLinksCount || 0) > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-rag-amber font-bold text-xl">{data?.alerts.expiringLinksCount}</span>
                <span className="text-rag-amber">Links Expiring Soon</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Check-In Required Section */}
      {awaitingCheckin.length > 0 && (
        <div className="bg-white border-2 border-red-400 rounded-xl shadow-sm overflow-hidden">
          <div className="border-b border-red-200 p-4 flex items-center justify-between bg-red-50">
            <div className="flex items-center gap-3">
              <span className="animate-pulse">
                <svg className="w-6 h-6 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </span>
              <div>
                <h2 className="font-bold text-red-700">Check-In Required</h2>
                <p className="text-xs text-red-600">{awaitingCheckin.length} vehicle{awaitingCheckin.length !== 1 ? 's' : ''} awaiting check-in</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchAwaitingCheckin}
                disabled={awaitingCheckinLoading}
                className="p-2 text-red-600 hover:bg-red-100 disabled:opacity-50"
                title="Refresh"
              >
                <svg className={`w-4 h-4 ${awaitingCheckinLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <Link to="/health-checks?status=awaiting_checkin" className="text-sm text-red-600 hover:underline font-medium">
                View All
              </Link>
            </div>
          </div>
          <div className="divide-y divide-red-100">
            {awaitingCheckin.map((item) => {
              // Calculate elapsed time (handle null/invalid dates)
              const arrivedTime = item.arrivedAt ? new Date(item.arrivedAt) : null
              const now = new Date()
              const isValidDate = arrivedTime && !isNaN(arrivedTime.getTime())
              const elapsedMinutes = isValidDate ? Math.floor((now.getTime() - arrivedTime.getTime()) / (1000 * 60)) : null
              const isOverdue = elapsedMinutes !== null && elapsedMinutes >= 20

              return (
                <Link
                  key={item.id}
                  to={`/health-checks/${item.id}?tab=checkin`}
                  className={`block p-3 hover:bg-red-50 ${isOverdue ? 'bg-red-100' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-center gap-1">
                        <div className="font-mono font-semibold text-gray-900 bg-yellow-50 px-2.5 py-1 border border-gray-300 rounded-lg text-sm">
                          {item.registration}
                        </div>
                        {item.customerWaiting && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold text-white bg-red-600 rounded-full animate-pulse">
                            WAITING
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="text-sm text-gray-900">
                          {item.make} {item.model}
                        </div>
                        <div className="text-sm text-gray-500">
                          {item.customerName}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {/* Elapsed time with warning */}
                      <div className={`text-right ${isOverdue ? 'text-red-700' : 'text-gray-600'}`}>
                        <div className="flex items-center gap-1">
                          {isOverdue && (
                            <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          )}
                          <span className={`font-medium ${isOverdue ? 'text-red-700 font-bold' : ''}`}>
                            {elapsedMinutes !== null ? `${elapsedMinutes}m` : '-'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">
                          {isValidDate ? `Arrived ${arrivedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Awaiting arrival'}
                        </div>
                      </div>
                      <span className="px-3 py-1.5 bg-red-600 text-white text-sm font-bold rounded-lg">
                        CHECK IN
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Board Column Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
        <Link to="/health-checks" className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:border-primary transition-colors">
          <div className="text-2xl font-bold text-gray-900">{data?.columnCounts.technician || 0}</div>
          <div className="text-sm text-gray-500">Technician Queue</div>
        </Link>
        <Link to="/health-checks" className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:border-primary transition-colors">
          <div className="text-2xl font-bold text-rag-amber">{data?.columnCounts.tech_done || 0}</div>
          <div className="text-sm text-gray-500">Tech Done / Review</div>
        </Link>
        <Link to="/health-checks" className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:border-primary transition-colors">
          <div className="text-2xl font-bold text-primary">{data?.columnCounts.advisor || 0}</div>
          <div className="text-sm text-gray-500">Ready to Send</div>
        </Link>
        <Link to="/health-checks" className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:border-primary transition-colors">
          <div className="text-2xl font-bold text-purple-600">{data?.columnCounts.customer || 0}</div>
          <div className="text-sm text-gray-500">With Customer</div>
        </Link>
        <Link to="/health-checks" className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:border-primary transition-colors">
          <div className="text-2xl font-bold text-rag-green">{data?.columnCounts.actioned || 0}</div>
          <div className="text-sm text-gray-500">Actioned</div>
        </Link>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Needs Attention Queue */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="border-b border-gray-200 p-4 flex items-center justify-between bg-rag-red-bg">
            <h2 className="font-semibold text-rag-red">Needs Attention</h2>
            <span className="bg-rag-red text-white px-2 py-0.5 text-sm font-medium">
              {queues?.needsAttention.total || 0}
            </span>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {queues?.needsAttention.items.map((item) => (
              <Link
                key={item.id}
                to={`/health-checks/${item.id}`}
                className="block p-3 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">{item.vehicle?.registration}</div>
                    <div className="text-sm text-gray-500">
                      {item.customer?.first_name} {item.customer?.last_name}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium ${
                    item.alertType === 'overdue' ? 'bg-rag-red text-white' : 'bg-rag-amber text-white'
                  }`}>
                    {item.alertType === 'overdue' ? 'OVERDUE' : 'EXPIRING'}
                  </span>
                </div>
              </Link>
            ))}
            {queues?.needsAttention.items.length === 0 && (
              <div className="p-4 text-center text-gray-500 text-sm">No items need attention</div>
            )}
          </div>
        </div>

        {/* Technician Workload */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="border-b border-gray-200 p-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Technician Workload</h2>
            <Link to="/dashboard/technicians" className="text-sm text-primary hover:underline">
              View All
            </Link>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {technicians.map((tech) => (
              <div key={tech.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      tech.status === 'working' ? 'bg-rag-green' :
                      tech.status === 'available' ? 'bg-rag-amber' : 'bg-gray-400'
                    }`} />
                    <div>
                      <div className="font-medium text-gray-900">{tech.firstName} {tech.lastName}</div>
                      {tech.currentJob && (
                        <div className="text-sm text-gray-500">
                          {tech.currentJob.vehicle.registration} - {tech.currentJob.timeElapsedMinutes}m
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-gray-900">{tech.queueCount} in queue</div>
                    <div className="text-xs text-gray-500">{tech.completedToday} today</div>
                  </div>
                </div>
              </div>
            ))}
            {technicians.length === 0 && (
              <div className="p-4 text-center text-gray-500 text-sm">No technicians found</div>
            )}
          </div>
        </div>

        {/* Customer Queue */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="border-b border-gray-200 p-4 flex items-center justify-between bg-purple-50">
            <h2 className="font-semibold text-purple-700">With Customer</h2>
            <span className="bg-purple-600 text-white px-2 py-0.5 text-sm font-medium">
              {queues?.customerQueue.total || 0}
            </span>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {queues?.customerQueue.items.map((item) => (
              <Link
                key={item.id}
                to={`/health-checks/${item.id}`}
                className="block p-3 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">{item.vehicle?.registration}</div>
                    <div className="text-sm text-gray-500">
                      {item.customer?.first_name} {item.customer?.last_name}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium ${
                    item.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                    item.status === 'delivered' ? 'bg-blue-200 text-blue-800' :
                    item.status === 'opened' ? 'bg-purple-100 text-purple-700' :
                    'bg-purple-200 text-purple-800'
                  }`}>
                    {item.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
              </Link>
            ))}
            {queues?.customerQueue.items.length === 0 && (
              <div className="p-4 text-center text-gray-500 text-sm">No items with customers</div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Status Breakdown</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Object.entries(data?.statusCounts || {}).map(([status, count]) => (
            <div key={status} className="text-center">
              <div className="text-xl font-bold text-gray-900">{count}</div>
              <div className="text-xs text-gray-500 capitalize">{status.replace('_', ' ')}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Awaiting Arrival Section (DMS Imports) */}
      {awaitingArrival.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="border-b border-gray-200 p-4 flex items-center justify-between bg-blue-50">
            <div>
              <h2 className="font-semibold text-primary">Awaiting Arrival</h2>
              <p className="text-xs text-gray-500 mt-1">{awaitingArrivalTotal} vehicle{awaitingArrivalTotal !== 1 ? 's' : ''} waiting{awaitingArrivalTotal > awaitingArrival.length ? ` (showing ${awaitingArrival.length})` : ''}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchAwaitingArrival}
                disabled={awaitingArrivalLoading}
                className="p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                title="Refresh"
              >
                <svg className={`w-4 h-4 ${awaitingArrivalLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <Link to="/health-checks?status=awaiting_arrival" className="text-sm text-primary hover:underline">
                View All
              </Link>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {awaitingArrival.map((item) => (
              <div key={item.id} className={`p-3 flex items-center justify-between hover:bg-gray-50 ${item.customerWaiting ? 'bg-red-50' : ''}`}>
                <Link to={`/health-checks/${item.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <div className="font-mono font-semibold text-gray-900 bg-yellow-50 px-2.5 py-1 border border-gray-300 rounded-lg text-sm">
                        {item.registration}
                      </div>
                      {/* Customer Waiting Badge - Phase 1 Quick Wins */}
                      {item.customerWaiting && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold text-white bg-red-600 rounded-full animate-pulse">
                          <span className="w-2 h-2 bg-white rounded-full"></span>
                          WAITING
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900 truncate flex items-center gap-2">
                        {item.make} {item.model}
                        {/* Loan Car Indicator - Phase 1 Quick Wins */}
                        {item.loanCarRequired && (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded-full" title="Loan car required">
                            <svg className="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                            </svg>
                            LOAN
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 truncate">
                        {item.customerName}
                      </div>
                    </div>
                    {/* Show due time */}
                    {(item.dueDate || item.promiseTime) && (
                      <div className="text-sm text-gray-500">
                        Due: {new Date(item.dueDate || item.promiseTime!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                    {/* Pre-booked work indicator - Phase 1 Quick Wins */}
                    {item.bookedRepairs && item.bookedRepairs.length > 0 && (
                      <div className="text-xs text-gray-400" title={item.bookedRepairs.map(r => r.description).join(', ')}>
                        {item.bookedRepairs.length} pre-booked
                      </div>
                    )}
                    {item.importedAt && (
                      <div className="text-xs text-gray-400" title={`Imported: ${new Date(item.importedAt).toLocaleString()}`}>
                        Imported {new Date(item.importedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                </Link>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => handleMarkArrived(item.id)}
                    className="px-3 py-1.5 bg-rag-green text-white text-sm font-medium rounded-lg hover:bg-rag-green/90"
                    title="Mark vehicle as arrived"
                  >
                    Arrived
                  </button>
                  <button
                    onClick={() => handleMarkNoShow(item.id)}
                    className="px-3 py-1.5 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600"
                    title="Mark as no-show"
                  >
                    No Show
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DMS Import Modal */}
      {token && (
        <DmsImportModal
          open={showDmsModal}
          onClose={() => setShowDmsModal(false)}
          onImportComplete={() => {
            fetchAwaitingArrival()
            fetchDashboard()
          }}
          token={token}
        />
      )}
    </div>
  )
}
