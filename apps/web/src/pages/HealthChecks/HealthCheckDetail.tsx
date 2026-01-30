import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api, HealthCheck, CheckResult, RepairItem, TemplateSection, HealthCheckSummary, FullHealthCheckResponse, NewRepairItem, TimelineEvent } from '../../lib/api'
import { WorkflowBadges, WorkflowStatus, calculateWorkflowStatus, calculateAuthorisationInfo, CompletionInfo, AuthorisationInfo } from '../../components/WorkflowBadges'
import { PhotosTab } from './tabs/PhotosTab'
import { TimelineTab } from './tabs/TimelineTab'
import { LabourTab } from './tabs/LabourTab'
import { PartsTab } from './tabs/PartsTab'
import { SummaryTab } from './tabs/SummaryTab'
import { CheckInTab } from './tabs/CheckInTab'
import { MriTab } from './tabs/MriTab'
import { CustomerActivityTab } from './tabs/CustomerActivityTab'
import { PublishModal } from './PublishModal'
import { CustomerPreviewModal } from './CustomerPreviewModal'
import { HealthCheckTabContent } from './components/HealthCheckTabContent'
import { CloseHealthCheckModal } from './components/CloseHealthCheckModal'
import { AdvisorSelectionModal } from './components/AdvisorSelectionModal'
import { WorkAuthoritySheetModal } from './components/WorkAuthoritySheetModal'
import { CustomerEditModal } from './components/CustomerEditModal'
import { HcDeletionModal } from './components/HcDeletionModal'
import { InspectionTimer } from '../../components/InspectionTimer'

// Hook for online/offline detection
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}

const statusLabels: Record<string, string> = {
  awaiting_arrival: 'Awaiting Arrival',
  awaiting_checkin: 'Awaiting Check-In',
  created: 'Created',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  paused: 'Paused',
  tech_completed: 'Tech Complete',
  awaiting_review: 'Awaiting Review',
  awaiting_pricing: 'Awaiting Pricing',
  ready_to_send: 'Ready to Send',
  sent: 'Sent',
  opened: 'Opened',
  partial_response: 'Partial Response',
  authorized: 'Authorized',
  declined: 'Declined',
  expired: 'Expired',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show'
}

const statusColors: Record<string, string> = {
  awaiting_arrival: 'bg-purple-100 text-purple-700',
  awaiting_checkin: 'bg-amber-100 text-amber-700',
  created: 'bg-gray-100 text-gray-700',
  assigned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  paused: 'bg-gray-100 text-gray-700',
  tech_completed: 'bg-green-100 text-green-700',
  awaiting_review: 'bg-orange-100 text-orange-700',
  awaiting_pricing: 'bg-orange-100 text-orange-700',
  ready_to_send: 'bg-blue-100 text-blue-700',
  sent: 'bg-purple-100 text-purple-700',
  opened: 'bg-green-100 text-green-700',
  partial_response: 'bg-yellow-100 text-yellow-700',
  authorized: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700',
  no_show: 'bg-red-100 text-red-700'
}

type Tab = 'summary' | 'checkin' | 'mri' | 'health-check' | 'labour' | 'parts' | 'photos' | 'timeline' | 'activity'

export default function HealthCheckDetail() {
  const { id } = useParams<{ id: string }>()
  const { session, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isOnline = useOnlineStatus()

  // Get initial tab from URL query parameter
  const validTabs: Tab[] = ['summary', 'checkin', 'mri', 'health-check', 'labour', 'parts', 'photos', 'timeline', 'activity']
  const urlTab = searchParams.get('tab') as Tab | null
  const initialTab: Tab = urlTab && validTabs.includes(urlTab) ? urlTab : 'health-check'

  // Permission check for changing advisor
  const canChangeAdvisor = user && ['super_admin', 'org_admin', 'site_admin', 'service_advisor'].includes(user.role)

  const [healthCheck, setHealthCheck] = useState<HealthCheck | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [results, setResults] = useState<CheckResult[]>([])
  const [repairItems, setRepairItems] = useState<RepairItem[]>([])
  const [newRepairItems, setNewRepairItems] = useState<NewRepairItem[]>([])
  const [summary, setSummary] = useState<HealthCheckSummary | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null)
  const [labourCompletion, setLabourCompletion] = useState<CompletionInfo | undefined>(undefined)
  const [partsCompletion, setPartsCompletion] = useState<CompletionInfo | undefined>(undefined)
  const [authorisationInfo, setAuthorisationInfo] = useState<AuthorisationInfo | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [showAdvisorModal, setShowAdvisorModal] = useState(false)
  const [showWorkAuthorityModal, setShowWorkAuthorityModal] = useState(false)
  const [showCustomerEditModal, setShowCustomerEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [generatingPDF, setGeneratingPDF] = useState(false)
  const [checkinEnabled, setCheckinEnabled] = useState(false)
  const [timerData, setTimerData] = useState<{
    total_closed_minutes: number
    active_clock_in_at: string | null
  } | null>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const fetchData = useCallback(async (options: { isRetry?: boolean; silent?: boolean } = {}) => {
    const { isRetry = false, silent = false } = options
    if (!session?.accessToken || !id) return

    // Clear any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    // Don't show loading spinner for silent background refreshes
    if (!silent) {
      setLoading(true)
    }
    if (!isRetry) setError(null)

    try {
      // Fetch health check with full advisor view data (must complete first - others depend on it)
      const hcData = await api<FullHealthCheckResponse>(
        `/api/v1/health-checks/${id}?include=advisor`,
        { token: session.accessToken }
      )
      setHealthCheck(hcData.healthCheck)
      setResults(hcData.check_results || [])
      setRepairItems(hcData.repair_items || [])
      setSummary(hcData.summary || null)

      // Run remaining calls in parallel - they only depend on hcData
      const [templateResult, timelineResult, timeEntriesResult, checkinResult, repairItemsResult] =
        await Promise.allSettled([
          // Template sections
          hcData.healthCheck.template_id
            ? api<{ sections?: TemplateSection[] }>(
                `/api/v1/templates/${hcData.healthCheck.template_id}`,
                { token: session.accessToken }
              )
            : Promise.resolve({ sections: [] as TemplateSection[] }),
          // Timeline
          api<{ timeline: TimelineEvent[] }>(
            `/api/v1/health-checks/${id}/timeline`,
            { token: session.accessToken }
          ),
          // Time entries (only for in_progress)
          hcData.healthCheck.status === 'in_progress'
            ? api<{
                entries: Array<{
                  clockIn: string
                  clockOut: string | null
                  durationMinutes: number | null
                }>
                totalMinutes: number
              }>(
                `/api/v1/health-checks/${id}/time-entries`,
                { token: session.accessToken }
              )
            : Promise.resolve(null),
          // Check-in settings
          user?.organization?.id
            ? api<{ checkinEnabled: boolean }>(
                `/api/v1/organizations/${user.organization.id}/checkin-settings`,
                { token: session.accessToken }
              )
            : Promise.resolve({ checkinEnabled: false }),
          // Repair items for workflow status
          api<{ repairItems: NewRepairItem[] }>(
            `/api/v1/health-checks/${id}/repair-items`,
            { token: session.accessToken }
          )
        ])

      // Process template result
      if (templateResult.status === 'fulfilled') {
        setSections(templateResult.value?.sections || [])
      }

      // Process timeline result
      if (timelineResult.status === 'fulfilled') {
        setTimeline(timelineResult.value?.timeline || [])
      }

      // Process time entries result
      if (timeEntriesResult.status === 'fulfilled' && timeEntriesResult.value) {
        const timeEntriesData = timeEntriesResult.value
        const activeEntry = timeEntriesData.entries?.find(e => !e.clockOut)
        const closedMinutes = timeEntriesData.entries
          ?.filter(e => e.clockOut)
          .reduce((sum, e) => sum + (e.durationMinutes || 0), 0) || 0
        setTimerData({
          total_closed_minutes: closedMinutes,
          active_clock_in_at: activeEntry?.clockIn || null
        })
      } else {
        setTimerData(null)
      }

      // Process check-in settings result
      if (checkinResult.status === 'fulfilled') {
        setCheckinEnabled(checkinResult.value?.checkinEnabled || false)
      } else {
        setCheckinEnabled(false)
      }

      // Process repair items result
      if (repairItemsResult.status === 'fulfilled') {
        const items = repairItemsResult.value?.repairItems || []
        setNewRepairItems(items)

        // Calculate workflow status from repair items (with tech timestamps)
        const calculatedStatus = calculateWorkflowStatus(items, hcData.healthCheck.sent_at, {
          tech_started_at: hcData.healthCheck.tech_started_at,
          tech_completed_at: hcData.healthCheck.tech_completed_at
        })
        setWorkflowStatus(calculatedStatus)

        // Calculate authorisation info for A badge tooltip
        const authInfo = calculateAuthorisationInfo(items)
        setAuthorisationInfo(authInfo)

        // Aggregate completion info from repair items for L/P badge tooltips
        let latestLabour: NewRepairItem | null = null
        let latestParts: NewRepairItem | null = null

        for (const item of items) {
          if (item.labourCompletedAt) {
            if (!latestLabour || new Date(item.labourCompletedAt) > new Date(latestLabour.labourCompletedAt!)) {
              latestLabour = item
            }
          }
          if (item.partsCompletedAt) {
            if (!latestParts || new Date(item.partsCompletedAt) > new Date(latestParts.partsCompletedAt!)) {
              latestParts = item
            }
          }
        }

        if (latestLabour?.labourCompletedAt) {
          const userName = latestLabour.labourCompletedByUser
            ? `${latestLabour.labourCompletedByUser.first_name} ${latestLabour.labourCompletedByUser.last_name}`
            : undefined
          setLabourCompletion({
            completedAt: latestLabour.labourCompletedAt,
            completedBy: userName
          })
        } else {
          setLabourCompletion(undefined)
        }

        if (latestParts?.partsCompletedAt) {
          const userName = latestParts.partsCompletedByUser
            ? `${latestParts.partsCompletedByUser.first_name} ${latestParts.partsCompletedByUser.last_name}`
            : undefined
          setPartsCompletion({
            completedAt: latestParts.partsCompletedAt,
            completedBy: userName
          })
        } else {
          setPartsCompletion(undefined)
        }
      } else {
        // Workflow status is optional, don't fail the whole page
        setWorkflowStatus(null)
        setLabourCompletion(undefined)
        setPartsCompletion(undefined)
        setAuthorisationInfo(undefined)
      }

      // Reset retry count on success
      setRetryCount(0)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load health check'
      setError(errorMessage)

      // Auto-retry logic (max 3 attempts with exponential backoff)
      if (retryCount < 3 && navigator.onLine) {
        const delay = Math.pow(2, retryCount) * 1000 // 1s, 2s, 4s
        setRetryCount(prev => prev + 1)
        retryTimeoutRef.current = setTimeout(() => {
          fetchData({ isRetry: true })
        }, delay)
      }
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, id, retryCount])

  // Silent refresh for background updates (no loading spinner)
  const silentRefresh = useCallback(() => fetchData({ silent: true }), [fetchData])

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleStatusChange = async (newStatus: string) => {
    if (!session?.accessToken || !id) return

    try {
      await api(`/api/v1/health-checks/${id}/status`, {
        method: 'POST',
        token: session.accessToken,
        body: { status: newStatus }
      })
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  const handleClosed = () => {
    setShowCloseModal(false)
    navigate('/health-checks')
  }

  const handleDelete = async (hcDeletionReasonId: string, notes: string) => {
    if (!session?.accessToken || !id) return

    await api(`/api/v1/health-checks/${id}/delete`, {
      method: 'POST',
      token: session.accessToken,
      body: { hcDeletionReasonId, notes: notes || undefined }
    })
    setShowDeleteModal(false)
    navigate('/health-checks')
  }

  const handlePrintPDF = async () => {
    if (!session?.accessToken || !id) return

    setGeneratingPDF(true)
    try {
      // Fetch PDF as blob with auth token
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5180'
      const response = await fetch(`${apiUrl}/api/v1/health-checks/${id}/pdf`, {
        headers: {
          'Authorization': `Bearer ${session.accessToken}`
        }
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to generate PDF' }))
        throw new Error(errorData.error || 'Failed to generate PDF')
      }

      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `health-check-${healthCheck?.vehicle?.registration || id}.pdf`
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/)
        if (match) filename = match[1]
      }

      // Create blob and download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PDF')
    } finally {
      setGeneratingPDF(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !healthCheck) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 text-center mb-2">
            {!isOnline ? 'You are offline' : 'Error Loading Health Check'}
          </h2>
          <p className="text-gray-600 text-center mb-4">
            {!isOnline
              ? 'Please check your internet connection and try again.'
              : error || 'Health check not found'}
          </p>
          {retryCount > 0 && retryCount < 3 && (
            <p className="text-sm text-gray-500 text-center mb-4">
              Retrying... (attempt {retryCount + 1} of 3)
            </p>
          )}
          <div className="flex gap-3 justify-center">
            <Link
              to="/health-checks"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50"
            >
              Back to list
            </Link>
            <button
              onClick={() => {
                setRetryCount(0)
                fetchData()
              }}
              disabled={loading}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Try Again'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const customer = healthCheck.vehicle?.customer

  // Build tabs array - conditionally include Check-In and MRI tabs if enabled
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'summary', label: 'Summary' },
    // Show Check-In tab when check-in is enabled for the org
    ...(checkinEnabled ? [{ id: 'checkin' as Tab, label: 'Check-In' }] : []),
    // Show MRI tab when check-in is enabled (for viewing MRI scan results)
    ...(checkinEnabled ? [{ id: 'mri' as Tab, label: 'MRI Scan' }] : []),
    { id: 'health-check', label: 'Health Check' },
    { id: 'labour', label: 'Labour' },
    { id: 'parts', label: 'Parts' },
    { id: 'photos', label: 'Photos', badge: summary?.media_count },
    { id: 'timeline', label: 'Timeline' },
    { id: 'activity', label: 'Customer Activity' }
  ]

  // Determine available actions based on status
  const canStartReview = healthCheck.status === 'tech_completed'
  const canMarkReady = ['awaiting_review', 'awaiting_pricing'].includes(healthCheck.status)
  const canSend = healthCheck.status === 'ready_to_send'
  const canResend = ['sent', 'expired', 'opened', 'customer_viewed', 'customer_approved', 'customer_partial', 'customer_declined'].includes(healthCheck.status)
  const canDelete = ['created', 'assigned', 'cancelled', 'awaiting_checkin'].includes(healthCheck.status) && !healthCheck.deleted_at
  const canClose = ['authorized', 'declined', 'partial_response'].includes(healthCheck.status) && !healthCheck.closed_at
  const isClosed = !!healthCheck.closed_at

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Action Bar */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Link
              to="/health-checks"
              className="flex items-center gap-1 md:gap-2 text-gray-600 hover:text-gray-900"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium hidden sm:inline">Back</span>
            </Link>
          </div>

          <div className="flex items-center gap-2 md:gap-3 overflow-x-auto">
            {canStartReview && (
              <button
                onClick={() => handleStatusChange('awaiting_pricing')}
                className="px-3 md:px-4 py-2 bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 rounded whitespace-nowrap"
              >
                <span className="hidden sm:inline">Start Review</span>
                <span className="sm:hidden">Review</span>
              </button>
            )}
            {canMarkReady && (
              <button
                onClick={() => handleStatusChange('ready_to_send')}
                className="px-3 md:px-4 py-2 bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 rounded whitespace-nowrap"
              >
                <span className="hidden sm:inline">Mark Ready</span>
                <span className="sm:hidden">Ready</span>
              </button>
            )}
            {(canSend || canResend) && (
              <>
                <button
                  onClick={() => setShowPreviewModal(true)}
                  className="px-3 md:px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 rounded whitespace-nowrap"
                >
                  Preview
                </button>
                <button
                  onClick={() => setShowPublishModal(true)}
                  className="px-3 md:px-4 py-2 bg-primary text-white text-sm font-medium hover:bg-primary-dark rounded whitespace-nowrap"
                >
                  <span className="hidden md:inline">{canResend ? 'Resend' : 'Send to Customer'}</span>
                  <span className="md:hidden">{canResend ? 'Resend' : 'Send'}</span>
                </button>
              </>
            )}
            <button
              onClick={handlePrintPDF}
              disabled={generatingPDF}
              title="Print PDF"
              className={`px-3 md:px-4 py-2 border text-sm font-medium rounded flex items-center gap-2 whitespace-nowrap ${
                generatingPDF
                  ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {generatingPDF ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
              )}
              <span className="hidden sm:inline">{generatingPDF ? 'Generating...' : 'PDF'}</span>
            </button>
            <button
              onClick={() => setShowWorkAuthorityModal(true)}
              title="Generate Work Authority Sheet"
              className="px-3 md:px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 rounded flex items-center gap-2 whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="hidden sm:inline">Work Sheet</span>
            </button>
            {canClose && (
              <button
                onClick={() => setShowCloseModal(true)}
                className="px-3 md:px-4 py-2 bg-green-600 text-white text-sm font-medium hover:bg-green-700 rounded whitespace-nowrap"
              >
                <span className="hidden md:inline">Close Health Check</span>
                <span className="md:hidden">Close</span>
              </button>
            )}
            {isClosed && (
              <span className="px-3 md:px-4 py-2 bg-green-100 text-green-800 text-sm font-medium rounded whitespace-nowrap">
                Closed
              </span>
            )}
            {canDelete && (
              <button
                onClick={() => setShowDeleteModal(true)}
                className="px-3 md:px-4 py-2 bg-red-600 text-white text-sm font-medium hover:bg-red-700 rounded whitespace-nowrap"
              >
                <span className="hidden md:inline">Delete</span>
                <span className="md:hidden">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Vehicle Info Bar */}
      <VehicleInfoBar
        healthCheck={healthCheck}
        workflowStatus={workflowStatus}
        technicianCompletion={{
          startedAt: healthCheck.tech_started_at,
          startedBy: healthCheck.technician ? `${healthCheck.technician.first_name} ${healthCheck.technician.last_name}` : undefined,
          completedAt: healthCheck.tech_completed_at,
          completedBy: healthCheck.technician ? `${healthCheck.technician.first_name} ${healthCheck.technician.last_name}` : undefined
        }}
        labourCompletion={labourCompletion}
        partsCompletion={partsCompletion}
        authorisationInfo={authorisationInfo}
        canChangeAdvisor={canChangeAdvisor || undefined}
        onAdvisorClick={() => setShowAdvisorModal(true)}
        canEditCustomer={canChangeAdvisor || undefined}
        onCustomerEditClick={() => setShowCustomerEditModal(true)}
        timerData={timerData}
      />

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-6">
          <nav className="flex gap-6">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  relative px-1 py-4 text-sm font-medium border-b-2 -mb-px transition-colors
                  ${activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                  }
                `}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === 'summary' && (
          <SummaryTab
            healthCheckId={id!}
            sentAt={healthCheck.sent_at ?? null}
            bookedRepairs={healthCheck.booked_repairs}
            onUpdate={silentRefresh}
          />
        )}
        {activeTab === 'checkin' && (
          <CheckInTab
            healthCheckId={id!}
            healthCheckStatus={healthCheck.status}
            onUpdate={silentRefresh}
            onCheckInComplete={() => {
              silentRefresh()
              // Optionally switch to health-check tab after check-in
              setActiveTab('health-check')
            }}
            advisor={healthCheck.advisor || null}
            onAdvisorChange={(advisor) => {
              setHealthCheck({ ...healthCheck, advisor: advisor || undefined })
            }}
          />
        )}
        {activeTab === 'mri' && (
          <MriTab healthCheckId={id!} />
        )}
        {activeTab === 'health-check' && (
          <HealthCheckTabContent
            healthCheckId={id!}
            sections={sections}
            results={results}
            repairItems={repairItems}
            onUpdate={silentRefresh}
          />
        )}
        {activeTab === 'labour' && (
          <LabourTab
            healthCheckId={id!}
            onUpdate={silentRefresh}
          />
        )}
        {activeTab === 'parts' && (
          <PartsTab
            healthCheckId={id!}
            onUpdate={silentRefresh}
          />
        )}
        {activeTab === 'photos' && healthCheck && (
          <PhotosTab
            results={results}
            healthCheckId={healthCheck.id}
            onSelectionChange={silentRefresh}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelineTab timeline={timeline} />
        )}
        {activeTab === 'activity' && (
          <CustomerActivityTab healthCheckId={id!} />
        )}
      </div>

      {/* Modals */}
      {showPublishModal && (
        <PublishModal
          healthCheck={healthCheck}
          customer={customer}
          onClose={() => setShowPublishModal(false)}
          onPublished={fetchData}
        />
      )}
      {showPreviewModal && (
        <CustomerPreviewModal
          healthCheck={healthCheck}
          newRepairItems={newRepairItems}
          checkResults={results}
          onClose={() => setShowPreviewModal(false)}
          onSend={() => {
            setShowPreviewModal(false)
            setShowPublishModal(true)
          }}
        />
      )}
      {showCloseModal && (
        <CloseHealthCheckModal
          healthCheckId={id!}
          repairItems={repairItems}
          summary={summary}
          onClose={() => setShowCloseModal(false)}
          onClosed={handleClosed}
        />
      )}
      {showAdvisorModal && healthCheck && (
        <AdvisorSelectionModal
          healthCheckId={healthCheck.id}
          currentAdvisor={healthCheck.advisor || null}
          onClose={() => setShowAdvisorModal(false)}
          onAdvisorChanged={(advisor) => {
            setHealthCheck({ ...healthCheck, advisor: advisor || undefined })
            setShowAdvisorModal(false)
          }}
        />
      )}
      {showWorkAuthorityModal && healthCheck && (
        <WorkAuthoritySheetModal
          isOpen={showWorkAuthorityModal}
          onClose={() => setShowWorkAuthorityModal(false)}
          healthCheckId={healthCheck.id}
          vehicleReg={healthCheck.vehicle?.registration || ''}
          userRole={user?.role || 'technician'}
        />
      )}
      {showCustomerEditModal && customer && (
        <CustomerEditModal
          customer={{
            id: customer.id,
            firstName: customer.first_name,
            lastName: customer.last_name,
            email: customer.email || null,
            mobile: customer.mobile || null
          }}
          onClose={() => setShowCustomerEditModal(false)}
          onCustomerUpdated={(updatedCustomer) => {
            // Update the health check with new customer data
            if (healthCheck?.vehicle) {
              setHealthCheck({
                ...healthCheck,
                vehicle: {
                  ...healthCheck.vehicle,
                  customer: {
                    ...healthCheck.vehicle.customer!,
                    first_name: updatedCustomer.firstName,
                    last_name: updatedCustomer.lastName,
                    email: updatedCustomer.email,
                    mobile: updatedCustomer.mobile
                  }
                }
              })
            }
            setShowCustomerEditModal(false)
          }}
        />
      )}
      <HcDeletionModal
        isOpen={showDeleteModal}
        vhcReference={healthCheck.vhc_reference ?? undefined}
        vehicleRegistration={healthCheck.vehicle?.registration}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

// Calculate days on site (from arrived_at to now)
function calculateDaysOnSite(arrivedAt: string | null): { days: number; color: string } | null {
  if (!arrivedAt) return null
  const arrived = new Date(arrivedAt)
  const now = new Date()
  const diffTime = Math.abs(now.getTime() - arrived.getTime())
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  let color = 'text-gray-600'
  if (diffDays > 2) {
    color = 'text-red-600'
  } else if (diffDays > 1) {
    color = 'text-amber-600'
  }
  return { days: diffDays, color }
}

// Vehicle Info Bar Component
interface VehicleInfoBarProps {
  healthCheck: HealthCheck
  workflowStatus: WorkflowStatus | null
  technicianCompletion?: CompletionInfo
  labourCompletion?: CompletionInfo
  partsCompletion?: CompletionInfo
  authorisationInfo?: AuthorisationInfo
  canChangeAdvisor?: boolean
  onAdvisorClick?: () => void
  canEditCustomer?: boolean
  onCustomerEditClick?: () => void
  timerData?: {
    total_closed_minutes: number
    active_clock_in_at: string | null
  } | null
}

function VehicleInfoBar({ healthCheck, workflowStatus, technicianCompletion, labourCompletion, partsCompletion, authorisationInfo, canChangeAdvisor, onAdvisorClick, canEditCustomer, onCustomerEditClick, timerData }: VehicleInfoBarProps) {
  const vehicle = healthCheck.vehicle
  const customer = healthCheck.vehicle?.customer
  const [vinExpanded, setVinExpanded] = useState(false)
  const daysOnSite = calculateDaysOnSite(healthCheck.arrived_at || null)

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-4">
      {/* Mobile Layout - Stacked with priority info */}
      <div className="md:hidden space-y-4">
        {/* Top row: VHC Ref + Registration + Status */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-shrink-0 space-y-1">
            {healthCheck.vhc_reference && (
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                {healthCheck.vhc_reference}
              </div>
            )}
            <div className="text-2xl font-bold text-gray-900 bg-yellow-100 px-3 py-1 rounded border-2 border-yellow-400">
              {vehicle?.registration || '-'}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`inline-block px-3 py-1 text-sm font-medium rounded ${statusColors[healthCheck.status]}`}>
              {statusLabels[healthCheck.status]}
            </span>
            {/* Timer for in_progress health checks */}
            {healthCheck.status === 'in_progress' && timerData && (
              <InspectionTimer
                status={healthCheck.status}
                totalClosedMinutes={timerData.total_closed_minutes}
                activeClockInAt={timerData.active_clock_in_at}
                variant="compact"
              />
            )}
            {workflowStatus && <WorkflowBadges status={workflowStatus} compact technicianCompletion={technicianCompletion} labourCompletion={labourCompletion} partsCompletion={partsCompletion} authorisationInfo={authorisationInfo} />}
          </div>
        </div>

        {/* Vehicle + Customer */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Vehicle</div>
            <div className="text-sm font-medium text-gray-900">
              {vehicle?.make} {vehicle?.model}
              {vehicle?.year && <span className="text-gray-500 ml-1">({vehicle.year})</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Customer</div>
            <div className="text-sm font-medium text-gray-900">
              {customer ? (
                <Link to={`/customers/${customer.id}`} className="text-primary hover:text-primary-dark">
                  {customer.first_name} {customer.last_name}
                </Link>
              ) : '-'}
            </div>
          </div>
        </div>

        {/* Contact info - Stacked on mobile */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            {customer?.mobile || '-'}
          </span>
          <span className="flex items-center gap-1 truncate max-w-[200px]">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="truncate">{customer?.email || '-'}</span>
          </span>
          {canEditCustomer && customer && (
            <button
              onClick={onCustomerEditClick}
              className="text-primary hover:text-primary-dark"
              title="Edit customer contact"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>

        {/* Secondary info row */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Mileage</div>
            <div className="font-medium text-gray-900">{healthCheck.mileage_in?.toLocaleString() || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Tech</div>
            <div className="text-gray-900 truncate">
              {healthCheck.technician
                ? `${healthCheck.technician.first_name} ${healthCheck.technician.last_name.charAt(0)}.`
                : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Date</div>
            <div className="text-gray-900">
              {healthCheck.updated_at
                ? new Date(healthCheck.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                : '-'}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Layout - Original horizontal flex-wrap */}
      <div className="hidden md:flex flex-wrap items-start gap-x-8 gap-y-3">
        {/* VHC Reference */}
        {healthCheck.vhc_reference && (
          <div className="flex-shrink-0">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">VHC Ref</div>
            <div className="text-sm font-bold text-primary bg-blue-50 px-3 py-2 rounded border border-blue-200">
              {healthCheck.vhc_reference}
            </div>
          </div>
        )}

        {/* Registration - Large */}
        <div className="flex-shrink-0">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Registration</div>
          <div className="text-2xl font-bold text-gray-900 bg-yellow-100 px-3 py-1 rounded border-2 border-yellow-400">
            {vehicle?.registration || '-'}
          </div>
        </div>

        {/* Vehicle Details */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Vehicle</div>
          <div className="text-sm font-medium text-gray-900">
            {vehicle?.make} {vehicle?.model} {vehicle?.year && `(${vehicle.year})`}
          </div>
        </div>

        {/* VIN */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">VIN</div>
          <div className="text-sm text-gray-900">
            {vehicle?.vin ? (
              vinExpanded ? (
                <span>
                  {vehicle.vin}
                  <button onClick={() => setVinExpanded(false)} className="ml-2 text-primary text-xs">
                    Hide
                  </button>
                </span>
              ) : (
                <span>
                  {vehicle.vin.substring(0, 8)}...
                  <button onClick={() => setVinExpanded(true)} className="ml-2 text-primary text-xs">
                    Show
                  </button>
                </span>
              )
            ) : (
              '-'
            )}
          </div>
        </div>

        {/* Customer */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Customer</div>
          <div className="text-sm font-medium text-gray-900">
            {customer ? (
              <Link to={`/customers/${customer.id}`} className="text-primary hover:text-primary-dark">
                {customer.first_name} {customer.last_name}
              </Link>
            ) : '-'}
          </div>
        </div>

        {/* Contact */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-2">
            Contact
            {canEditCustomer && customer && (
              <button
                onClick={onCustomerEditClick}
                className="text-primary hover:text-primary-dark"
                title="Edit customer contact"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </div>
          <div className="text-sm text-gray-900">
            <span className="mr-3">
              <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {customer?.mobile || '-'}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {customer?.email || '-'}
            </span>
          </div>
        </div>

        {/* Mileage */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Mileage</div>
          <div className="text-sm font-medium text-gray-900">
            {healthCheck.mileage_in?.toLocaleString() || '-'}
          </div>
        </div>

        {/* Technician */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Technician</div>
          <div className="text-sm text-gray-900">
            {healthCheck.technician
              ? `${healthCheck.technician.first_name} ${healthCheck.technician.last_name}`
              : '-'}
          </div>
        </div>

        {/* Service Advisor */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Service Advisor</div>
          <div
            className={`text-sm text-gray-900 ${canChangeAdvisor ? 'cursor-pointer hover:text-orange-600' : ''}`}
            onClick={() => canChangeAdvisor && onAdvisorClick?.()}
          >
            {healthCheck.advisor
              ? `${healthCheck.advisor.first_name} ${healthCheck.advisor.last_name}`
              : '-'}
            {canChangeAdvisor && (
              <svg className="w-3 h-3 inline ml-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            )}
          </div>
        </div>

        {/* Date Completed */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Date</div>
          <div className="text-sm text-gray-900">
            {formatDate(healthCheck.updated_at)}
          </div>
        </div>

        {/* Status */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Status</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block px-3 py-1 text-sm font-medium rounded ${statusColors[healthCheck.status]}`}>
              {statusLabels[healthCheck.status]}
            </span>
            {/* Customer Waiting Badge - Phase 1 Quick Wins */}
            {healthCheck.customer_waiting && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-white bg-red-600 rounded animate-pulse">
                <span className="w-2 h-2 bg-white rounded-full"></span>
                WAITING
              </span>
            )}
          </div>
        </div>

        {/* Inspection Timer - shown when in_progress */}
        {healthCheck.status === 'in_progress' && timerData && (
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Inspection Time</div>
            <InspectionTimer
              status={healthCheck.status}
              totalClosedMinutes={timerData.total_closed_minutes}
              activeClockInAt={timerData.active_clock_in_at}
              variant="full"
            />
          </div>
        )}

        {/* Workflow Status */}
        {workflowStatus && (
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Workflow</div>
            <WorkflowBadges status={workflowStatus} technicianCompletion={technicianCompletion} labourCompletion={labourCompletion} partsCompletion={partsCompletion} authorisationInfo={authorisationInfo} />
          </div>
        )}

        {/* Phase 1 Quick Wins - Additional indicators */}
        {(healthCheck.loan_car_required || daysOnSite || healthCheck.booked_date) && (
          <>
            {/* Loan Car */}
            {healthCheck.loan_car_required && (
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Loan Car</div>
                <span className="inline-flex items-center px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded">
                  <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                  </svg>
                  Required
                </span>
              </div>
            )}

            {/* Days on Site */}
            {daysOnSite && (
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">On Site</div>
                <span className={`text-sm font-medium ${daysOnSite.color}`}>
                  {daysOnSite.days} {daysOnSite.days === 1 ? 'day' : 'days'}
                </span>
              </div>
            )}

            {/* Booked Date */}
            {healthCheck.booked_date && (
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Booked</div>
                <div className="text-sm text-gray-900">
                  {new Date(healthCheck.booked_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}


