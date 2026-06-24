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

  // Awaiting arrival — unified across DMS imports AND jobsheet bookings (see /api/v1/arrivals).
  // We show only VHC-backed rows here so the existing Arrived/No-show/Delete actions (which act
  // on a health check id) work unchanged; no-VHC jobsheets are actioned from the Arrivals hub.
  const fetchAwaitingArrival = useCallback(async () => {
    if (!token) return
    try {
      setAwaitingArrivalLoading(true)
      const response = await api<{
        arrivals: Array<{
          healthCheckId: string | null
          hasVhc: boolean
          jobsheetId: string | null
          registration: string
          make: string
          model: string
          customerName: string
          promiseTime: string | null
          dueDate: string | null
          importedAt: string | null
          customerWaiting: boolean
          loanCarRequired: boolean
          bookedRepairs: Array<{ code?: string; description?: string; notes?: string }>
          jobsheetReference: string | null
        }>
      }>('/api/v1/arrivals?status=awaiting_arrival', { token })

      const items: AwaitingArrivalItem[] = (response.arrivals || [])
        .filter(a => a.hasVhc && a.healthCheckId)
        .map(a => ({
          id: a.healthCheckId as string,
          jobsheetId: a.jobsheetId,
          registration: a.registration,
          make: a.make,
          model: a.model,
          customerName: a.customerName,
          promiseTime: a.promiseTime,
          dueDate: a.dueDate,
          importedAt: a.importedAt || '',
          customerWaiting: a.customerWaiting,
          loanCarRequired: a.loanCarRequired,
          bookedRepairs: a.bookedRepairs || [],
          jobsheetNumber: a.jobsheetReference
        }))
      setAwaitingArrival(items)
      setAwaitingArrivalTotal(items.length)
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
        jobsheet_id: string | null
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
        jobsheetId: hc.jobsheet_id,
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

  // Header date + scope sub-line, e.g. "22 June 2026 · today at a glance"
  const dateLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const scopeLabel =
    dateRange === 'today' ? 'today at a glance'
    : dateRange === 'week' ? 'last 7 days at a glance'
    : 'last 30 days at a glance'

  const btnSecondary = 'inline-flex items-center gap-[7px] text-[13px] font-semibold text-[#5f636c] bg-white border border-[#e6e6e3] rounded-[10px] px-[14px] py-2 hover:bg-[#f7f7f5] transition-colors'
  const btnPrimary = 'inline-flex items-center gap-[7px] text-[13px] font-semibold text-white bg-[#16181d] border border-[#16181d] rounded-[10px] px-[14px] py-2 hover:bg-[#16181d]/90 transition-colors'

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

      {/* Page header: title, live status, scope control + actions */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[30px] font-extrabold tracking-[-0.025em] text-[#16181d] leading-none">Dashboard</h1>
            <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${isConnected ? 'text-[#2c9367]' : 'text-[#a4a8b0]'}`}>
              <span className={`w-[7px] h-[7px] rounded-full ${isConnected ? 'bg-[#2c9367]' : 'bg-[#a4a8b0]'}`} />
              {isConnected ? 'Live' : 'Offline'}
            </span>
          </div>
          <div className="text-[13.5px] text-[#7b7f88] mt-[5px]">{dateLabel} · {scopeLabel}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date-range segmented control — scopes the flow KPIs */}
          <div className="flex items-center bg-white border border-[#e6e6e3] rounded-[10px] p-[3px] gap-[2px]">
            {([['today', 'Today'], ['week', '7 Days'], ['month', '30 Days']] as Array<[DateRange, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setDateRange(key)}
                className={`text-[13px] rounded-[7px] px-[15px] py-[6px] transition-colors ${
                  dateRange === key ? 'bg-[#16181d] text-white font-semibold' : 'text-[#7b7f88] font-medium hover:text-[#16181d]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {dmsEnabled && (
            <button onClick={() => setShowDmsModal(true)} className={btnSecondary}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              DMS Import
            </button>
          )}
          <Link to="/health-checks" className={btnSecondary}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
              <path d="M15 3v18" />
            </svg>
            Kanban
          </Link>
          <Link to="/today" className={btnPrimary}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M8 2v4" />
              <path d="M16 2v4" />
              <rect width="18" height="18" x="3" y="4" rx="2" />
              <path d="M3 10h18" />
              <path d="m9 16 2 2 4-4" />
            </svg>
            Today View
          </Link>
          <Link to="/reports" className={btnSecondary}>Reports</Link>
        </div>
      </div>

      {error && (
        <div className="bg-[#fbeceb] border border-[#efc9c7] rounded-[14px] px-[22px] py-4 text-[13px] text-[#cf4a45]">
          {error}
          <button onClick={fetchOverview} className="ml-4 underline font-semibold">Retry</button>
        </div>
      )}

      {/* Action Center — what needs a human right now (full width) */}
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

      {/* Today + This month */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <TodayKpis
          metrics={overview?.metrics || null}
          todayRag={overview?.todayRag || null}
          dateRange={dateRange}
          loading={initialLoading}
        />
        <MonthlyKpis data={overview?.monthlyKpis || null} loading={initialLoading} />
      </div>

      {/* Health check pipeline (full width) */}
      <PipelineStrip counts={overview?.columnCounts || null} loading={initialLoading} />

      {/* Technician workload + With customer */}
      <TeamPanel
        technicians={overview?.technicians || []}
        customerQueue={overview?.queues.customerQueue || null}
      />

      {/* Status breakdown — diagnostic detail, collapsed by default */}
      {statusEntries.length > 0 && (
        <details className="bg-white border border-[#ededeb] rounded-[18px]">
          <summary className="p-5 cursor-pointer select-none text-[13px] font-semibold text-[#5f636c] hover:text-[#16181d]">
            Status breakdown ({statusEntries.reduce((sum, [, count]) => sum + count, 0)} health checks in period)
          </summary>
          <div className="px-5 pb-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {statusEntries.map(([status, count]) => (
              <div key={status} className="text-center">
                <div className="text-xl font-extrabold text-[#16181d] tabular-nums">{count}</div>
                <div className="text-[11px] text-[#a4a8b0] capitalize mt-0.5">{formatStatusLabel(status)}</div>
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
