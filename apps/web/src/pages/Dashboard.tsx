import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../contexts/SocketContext'
import { api } from '../lib/api'
import DmsImportModal from './DmsImportModal'
import { HcDeletionModal } from './HealthChecks/components/HcDeletionModal'
import ActionCenter from './Dashboard/ActionCenter'
import PipelineStrip from './Dashboard/PipelineStrip'
import TodayKpis from './Dashboard/TodayKpis'
import MonthlyKpis from './Dashboard/MonthlyKpis'
import TeamPanel from './Dashboard/TeamPanel'
import type {
  AwaitingArrivalItem,
  AwaitingCheckinItem,
  DashboardOverview,
  DateRange
} from './Dashboard/types'
import { formatStatusLabel } from './Dashboard/types'

export default function Dashboard() {
  const { user, session } = useAuth()
  const { on, off, isConnected } = useSocket()
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
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
  const [deleteItem, setDeleteItem] = useState<AwaitingArrivalItem | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>('today')

  const token = session?.accessToken

  // One round-trip for metrics, queues, technicians, monthly KPIs and today's RAG breakdown
  const fetchOverview = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)
      setError(null)

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      let dateFrom = today.toISOString()
      const dateTo = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
      if (dateRange === 'week') {
        dateFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      } else if (dateRange === 'month') {
        dateFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      }

      const data = await api<DashboardOverview>(
        `/api/v1/dashboard/overview?date_from=${dateFrom}&date_to=${dateTo}`,
        { token }
      )
      setOverview(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [token, dateRange])

  // Awaiting arrival health checks (from DMS imports)
  const fetchAwaitingArrival = useCallback(async () => {
    if (!token) return
    try {
      setAwaitingArrivalLoading(true)
      const response = await api<{ healthChecks: AwaitingArrivalItem[]; pagination: { total: number } }>(
        '/api/v1/dms-settings/unactioned?limit=200',
        { token }
      )
      setAwaitingArrival(response.healthChecks || [])
      setAwaitingArrivalTotal(response.pagination?.total ?? response.healthChecks?.length ?? 0)
    } catch (err) {
      console.error('Failed to fetch awaiting arrival:', err)
    } finally {
      setAwaitingArrivalLoading(false)
    }
  }, [token])

  // Awaiting check-in health checks
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
        customerName: hc.vehicle?.customer
          ? `${hc.vehicle.customer.first_name} ${hc.vehicle.customer.last_name}`
          : 'Unknown',
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
      const settings = await api<{ enabled?: boolean; credentialsConfigured?: boolean }>(
        '/api/v1/dms-settings/settings',
        { token }
      )
      setDmsEnabled(settings?.enabled === true && settings?.credentialsConfigured === true)
    } catch {
      setDmsEnabled(false)
    }
  }, [token])

  // Debounced refresh for WebSocket events (500ms, leading + trailing)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastCallRef = useRef<number>(0)

  const debouncedRefresh = useMemo(() => {
    return () => {
      const now = Date.now()
      if (now - lastCallRef.current > 500) {
        lastCallRef.current = now
        fetchOverview()
        return
      }
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        lastCallRef.current = Date.now()
        fetchOverview()
      }, 500)
    }
  }, [fetchOverview])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  useEffect(() => {
    fetchOverview()
    // Only poll if WebSocket is disconnected (fallback)
    if (!isConnected) {
      const interval = setInterval(fetchOverview, 30000)
      return () => clearInterval(interval)
    }
  }, [fetchOverview, isConnected])

  useEffect(() => {
    fetchAwaitingArrival()
    fetchAwaitingCheckin()
    checkDmsEnabled()
  }, [fetchAwaitingArrival, fetchAwaitingCheckin, checkDmsEnabled])

  // Real-time updates (debounced to prevent request storms)
  useEffect(() => {
    const handleStatusChange = (data: { healthCheckId: string; status: string; vehicleReg: string }) => {
      setLiveUpdate(`${data.vehicleReg} → ${formatStatusLabel(data.status)}`)
      setTimeout(() => setLiveUpdate(null), 3000)
      debouncedRefresh()
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

  const showOnboardingReminder =
    user?.isOrgAdmin &&
    user?.organization?.onboardingCompleted === false

  const isAdmin = user?.role === 'super_admin' || user?.role === 'org_admin' || user?.role === 'site_admin'

  const handleMarkArrived = async (healthCheckId: string) => {
    if (!token) return
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/mark-arrived`, { method: 'POST', token })
      fetchAwaitingArrival()
      fetchOverview()
      setLiveUpdate('Vehicle marked as arrived')
      setTimeout(() => setLiveUpdate(null), 3000)
    } catch (err) {
      console.error('Failed to mark arrived:', err)
      setError(err instanceof Error ? err.message : 'Failed to mark vehicle as arrived')
    }
  }

  const handleMarkNoShow = async (healthCheckId: string) => {
    if (!token) return
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/mark-no-show`, { method: 'POST', token })
      fetchAwaitingArrival()
      setLiveUpdate('Vehicle marked as no-show')
      setTimeout(() => setLiveUpdate(null), 3000)
    } catch (err) {
      console.error('Failed to mark no-show:', err)
      setError(err instanceof Error ? err.message : 'Failed to mark vehicle as no-show')
    }
  }

  const handleDeleteHealthCheck = async (hcDeletionReasonId: string, notes: string) => {
    if (!token || !deleteItem) return
    await api(`/api/v1/health-checks/${deleteItem.id}/delete`, {
      method: 'POST',
      token,
      body: { hcDeletionReasonId, notes: notes || undefined }
    })
    setDeleteItem(null)
    fetchAwaitingArrival()
    fetchOverview()
    setLiveUpdate('Health check deleted')
    setTimeout(() => setLiveUpdate(null), 3000)
  }

  const initialLoading = loading && !overview
  const statusEntries = Object.entries(overview?.statusCounts || {})

  return (
    <div className="space-y-6">
      {/* Onboarding Reminder Banner */}
      {showOnboardingReminder && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
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
              className="px-4 py-2 bg-amber-500 text-white hover:bg-amber-600 transition-colors text-sm font-medium rounded-lg"
            >
              Continue Setup
            </Link>
          </div>
        </div>
      )}

      {/* Live Update Toast */}
      {liveUpdate && (
        <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:w-auto z-50 bg-primary text-white px-4 py-2 rounded-lg shadow-lg animate-pulse text-center md:text-left">
          {liveUpdate}
        </div>
      )}

      {/* Header: title, live status, scope + quick links */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <span className={`flex items-center gap-1 text-xs ${isConnected ? 'text-rag-green' : 'text-gray-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-rag-green' : 'bg-gray-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          {/* Date Range Filter — scopes the flow KPIs */}
          <div className="flex items-center rounded-lg overflow-hidden border border-gray-200">
            {([['today', 'Today'], ['week', '7 Days'], ['month', '30 Days']] as Array<[DateRange, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setDateRange(key)}
                className={`px-3 py-1.5 text-sm font-medium ${
                  dateRange === key ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
          <Link to="/health-checks" className="px-4 py-2 bg-primary text-white text-sm font-medium hover:bg-primary/90 rounded-lg">
            Kanban Board
          </Link>
          <Link to="/today" className="px-4 py-2 bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 rounded-lg">
            Today View
          </Link>
          <Link to="/reports" className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 rounded-lg">
            Reports
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
          {error}
          <button onClick={fetchOverview} className="ml-4 underline">Retry</button>
        </div>
      )}

      {/* Zone 1: what needs a human right now */}
      {!initialLoading && (
        <ActionCenter
          awaitingCheckin={awaitingCheckin}
          awaitingCheckinLoading={awaitingCheckinLoading}
          onRefreshCheckin={fetchAwaitingCheckin}
          needsAttention={overview?.queues.needsAttention || null}
          awaitingArrival={awaitingArrival}
          awaitingArrivalTotal={awaitingArrivalTotal}
          awaitingArrivalLoading={awaitingArrivalLoading}
          onRefreshArrival={fetchAwaitingArrival}
          onMarkArrived={handleMarkArrived}
          onMarkNoShow={handleMarkNoShow}
          onDelete={setDeleteItem}
          isAdmin={isAdmin}
        />
      )}

      {/* Zone 2: how work is flowing */}
      <PipelineStrip counts={overview?.columnCounts || null} loading={initialLoading} />
      <TodayKpis
        metrics={overview?.metrics || null}
        todayRag={overview?.todayRag || null}
        dateRange={dateRange}
        loading={initialLoading}
      />

      {/* Zone 3: are we on track this month */}
      <MonthlyKpis data={overview?.monthlyKpis || null} loading={initialLoading} />

      {/* Zone 4: the team */}
      <TeamPanel
        technicians={overview?.technicians || []}
        customerQueue={overview?.queues.customerQueue || null}
      />

      {/* Status breakdown — diagnostic detail, collapsed by default */}
      {statusEntries.length > 0 && (
        <details className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <summary className="p-4 cursor-pointer select-none text-sm font-medium text-gray-700 hover:text-gray-900">
            Status Breakdown ({statusEntries.reduce((sum, [, count]) => sum + count, 0)} health checks in period)
          </summary>
          <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {statusEntries.map(([status, count]) => (
              <div key={status} className="text-center">
                <div className="text-xl font-bold text-gray-900 tabular-nums">{count}</div>
                <div className="text-xs text-gray-500 capitalize">{formatStatusLabel(status)}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* DMS Import Modal */}
      {token && (
        <DmsImportModal
          open={showDmsModal}
          onClose={() => setShowDmsModal(false)}
          onImportComplete={() => {
            fetchAwaitingArrival()
            fetchOverview()
          }}
          token={token}
        />
      )}

      {/* Delete Health Check Modal (admin only) */}
      <HcDeletionModal
        isOpen={!!deleteItem}
        vehicleRegistration={deleteItem?.registration}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDeleteHealthCheck}
      />
    </div>
  )
}
