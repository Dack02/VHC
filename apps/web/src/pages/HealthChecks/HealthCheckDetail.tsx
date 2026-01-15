import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api, HealthCheck, CheckResult, RepairItem, StatusHistoryEntry, TemplateSection, Authorization, HealthCheckSummary, FullHealthCheckResponse } from '../../lib/api'
import { PhotosTab } from './tabs/PhotosTab'
import { TimelineTab } from './tabs/TimelineTab'
import { PublishModal } from './PublishModal'
import { CustomerPreviewModal } from './CustomerPreviewModal'
import { HealthCheckTabContent } from './components/HealthCheckTabContent'
import { CloseHealthCheckModal } from './components/CloseHealthCheckModal'

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
  cancelled: 'Cancelled'
}

const statusColors: Record<string, string> = {
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
  cancelled: 'bg-gray-100 text-gray-700'
}

type Tab = 'summary' | 'health-check' | 'photos' | 'timeline'

export default function HealthCheckDetail() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()

  const [healthCheck, setHealthCheck] = useState<HealthCheck | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [results, setResults] = useState<CheckResult[]>([])
  const [repairItems, setRepairItems] = useState<RepairItem[]>([])
  const [authorizations, setAuthorizations] = useState<Authorization[]>([])
  const [summary, setSummary] = useState<HealthCheckSummary | null>(null)
  const [history, setHistory] = useState<StatusHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [activeTab, setActiveTab] = useState<Tab>('health-check')
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [generatingPDF, setGeneratingPDF] = useState(false)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const fetchData = useCallback(async (isRetry = false) => {
    if (!session?.accessToken || !id) return

    // Clear any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    setLoading(true)
    if (!isRetry) setError(null)

    try {
      // Fetch health check with full advisor view data
      const hcData = await api<FullHealthCheckResponse>(
        `/api/v1/health-checks/${id}?include=advisor`,
        { token: session.accessToken }
      )
      setHealthCheck(hcData.healthCheck)
      setResults(hcData.check_results || [])
      setRepairItems(hcData.repair_items || [])
      setAuthorizations(hcData.authorizations || [])
      setSummary(hcData.summary || null)

      // Fetch template sections
      if (hcData.healthCheck.template_id) {
        const templateData = await api<{ sections?: TemplateSection[] }>(
          `/api/v1/templates/${hcData.healthCheck.template_id}`,
          { token: session.accessToken }
        )
        setSections(templateData.sections || [])
      }

      // Fetch history
      const historyData = await api<{ history: StatusHistoryEntry[] }>(
        `/api/v1/health-checks/${id}/history`,
        { token: session.accessToken }
      )
      setHistory(historyData.history || [])

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
          fetchData(true)
        }, delay)
      }
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, id, retryCount])

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

  const handlePrintPDF = async () => {
    if (!session?.accessToken || !id) return

    setGeneratingPDF(true)
    try {
      // Fetch PDF as blob with auth token
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
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

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'health-check', label: 'Health Check' },
    { id: 'photos', label: 'Photos', badge: summary?.media_count },
    { id: 'timeline', label: 'Timeline' }
  ]

  // Determine available actions based on status
  const canStartReview = healthCheck.status === 'tech_completed'
  const canMarkReady = ['awaiting_review', 'awaiting_pricing'].includes(healthCheck.status)
  const canSend = healthCheck.status === 'ready_to_send'
  const canResend = ['sent', 'expired'].includes(healthCheck.status)
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
          </div>
        </div>
      </div>

      {/* Vehicle Info Bar */}
      <VehicleInfoBar healthCheck={healthCheck} />

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
            healthCheck={healthCheck}
            summary={summary}
            repairItems={repairItems}
            authorizations={authorizations}
          />
        )}
        {activeTab === 'health-check' && (
          <HealthCheckTabContent
            healthCheckId={id!}
            sections={sections}
            results={results}
            repairItems={repairItems}
            authorizations={authorizations}
            onUpdate={fetchData}
          />
        )}
        {activeTab === 'photos' && (
          <PhotosTab results={results} />
        )}
        {activeTab === 'timeline' && (
          <TimelineTab history={history} />
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
          repairItems={repairItems}
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
          authorizations={authorizations}
          summary={summary}
          onClose={() => setShowCloseModal(false)}
          onClosed={handleClosed}
        />
      )}
    </div>
  )
}

// Vehicle Info Bar Component
function VehicleInfoBar({ healthCheck }: { healthCheck: HealthCheck }) {
  const vehicle = healthCheck.vehicle
  const customer = healthCheck.vehicle?.customer
  const [vinExpanded, setVinExpanded] = useState(false)

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
        {/* Top row: Registration + Status */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-shrink-0">
            <div className="text-2xl font-bold text-gray-900 bg-yellow-100 px-3 py-1 rounded border-2 border-yellow-400">
              {vehicle?.registration || '-'}
            </div>
          </div>
          <span className={`inline-block px-3 py-1 text-sm font-medium rounded ${statusColors[healthCheck.status]}`}>
            {statusLabels[healthCheck.status]}
          </span>
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
              {customer ? `${customer.first_name} ${customer.last_name}` : '-'}
            </div>
          </div>
        </div>

        {/* Contact info - Stacked on mobile */}
        {(customer?.mobile || customer?.email) && (
          <div className="flex flex-wrap gap-3 text-sm text-gray-600">
            {customer?.mobile && (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {customer.mobile}
              </span>
            )}
            {customer?.email && (
              <span className="flex items-center gap-1 truncate max-w-[200px]">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="truncate">{customer.email}</span>
              </span>
            )}
          </div>
        )}

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
            {customer ? `${customer.first_name} ${customer.last_name}` : '-'}
          </div>
        </div>

        {/* Contact */}
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Contact</div>
          <div className="text-sm text-gray-900">
            {customer?.mobile && (
              <span className="mr-3">
                <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {customer.mobile}
              </span>
            )}
            {customer?.email && (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {customer.email}
              </span>
            )}
            {!customer?.mobile && !customer?.email && '-'}
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
          <span className={`inline-block px-3 py-1 text-sm font-medium rounded ${statusColors[healthCheck.status]}`}>
            {statusLabels[healthCheck.status]}
          </span>
        </div>
      </div>
    </div>
  )
}

// Summary Tab Component
function SummaryTab({
  healthCheck,
  summary,
  repairItems,
  authorizations
}: {
  healthCheck: HealthCheck
  summary: HealthCheckSummary | null
  repairItems: RepairItem[]
  authorizations: Authorization[]
}) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Not yet'
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`

  // Create authorization lookup
  const authByRepairItemId = new Map(authorizations.map(a => [a.repair_item_id, a]))

  // Calculate values from repair items
  const redItems = repairItems.filter(i => i.rag_status === 'red')
  const amberItems = repairItems.filter(i => i.rag_status === 'amber')
  const redTotal = redItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const amberTotal = amberItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const totalIdentified = repairItems.reduce((sum, i) => sum + (i.total_price || 0), 0)

  // Authorization breakdowns
  const authorisedItems = repairItems.filter(item => authByRepairItemId.get(item.id)?.decision === 'approved')
  const declinedItems = repairItems.filter(item => authByRepairItemId.get(item.id)?.decision === 'declined')
  const pendingItems = repairItems.filter(item => !authByRepairItemId.has(item.id))

  const authorisedTotal = authorisedItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const declinedTotal = declinedItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const pendingTotal = pendingItems.reduce((sum, i) => sum + (i.total_price || 0), 0)

  // Work completion
  const completedWork = authorisedItems.filter(i => i.work_completed_at)
  const outstandingWork = authorisedItems.filter(i => !i.work_completed_at)
  const completedValue = completedWork.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const outstandingValue = outstandingWork.reduce((sum, i) => sum + (i.total_price || 0), 0)

  // Link expiry calculation
  const expiresAt = healthCheck.public_expires_at ? new Date(healthCheck.public_expires_at) : null
  const now = new Date()
  const isExpired = expiresAt && expiresAt < now
  const hoursUntilExpiry = expiresAt ? Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)) : null
  const isExpiringSoon = hoursUntilExpiry !== null && hoursUntilExpiry > 0 && hoursUntilExpiry <= 24

  return (
    <div className="space-y-6">
      {/* RAG Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-red-600">{summary?.red_count || healthCheck.red_count}</div>
          <div className="text-sm text-red-700 font-medium">Immediate Attention</div>
          {redTotal > 0 && (
            <div className="text-sm text-red-600 mt-1 font-medium">{formatCurrency(redTotal)}</div>
          )}
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-amber-600">{summary?.amber_count || healthCheck.amber_count}</div>
          <div className="text-sm text-amber-700 font-medium">Advisory</div>
          {amberTotal > 0 && (
            <div className="text-sm text-amber-600 mt-1 font-medium">{formatCurrency(amberTotal)}</div>
          )}
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-green-600">{summary?.green_count || healthCheck.green_count}</div>
          <div className="text-sm text-green-700 font-medium">Items OK</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-600">{summary?.total_items || (healthCheck.green_count + healthCheck.amber_count + healthCheck.red_count)}</div>
          <div className="text-sm text-gray-700 font-medium">Total Items</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer Response */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Customer Response</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-500">Sent</dt>
              <dd className="font-medium">{formatDate(healthCheck.sent_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">First Opened</dt>
              <dd className={`font-medium ${healthCheck.first_opened_at ? 'text-green-600' : 'text-gray-400'}`}>
                {formatDate(healthCheck.first_opened_at)}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">Link Expires</dt>
              <dd className="text-right">
                <div className={`font-medium ${isExpired ? 'text-red-600' : isExpiringSoon ? 'text-amber-600' : ''}`}>
                  {formatDate(healthCheck.public_expires_at)}
                </div>
                {isExpired && (
                  <div className="text-xs text-red-600 font-medium">EXPIRED</div>
                )}
                {isExpiringSoon && (
                  <div className="text-xs text-amber-600 font-medium">Expires in {hoursUntilExpiry}h</div>
                )}
              </dd>
            </div>
          </dl>

          {/* Response Summary */}
          {authorizations.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex gap-4 text-sm">
                {authorisedItems.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-gray-600">{authorisedItems.length} Approved</span>
                  </div>
                )}
                {declinedItems.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-gray-600">{declinedItems.length} Declined</span>
                  </div>
                )}
                {pendingItems.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <span className="text-gray-600">{pendingItems.length} Pending</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Financials */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Financials</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-500">Total Identified</dt>
              <dd className="font-semibold">{formatCurrency(totalIdentified)}</dd>
            </div>
            <div className="border-t border-gray-100 pt-3">
              <div className="flex justify-between">
                <dt className="text-gray-500">Total Authorised</dt>
                <dd className="font-medium text-green-600">{formatCurrency(authorisedTotal)}</dd>
              </div>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Total Declined</dt>
              <dd className="font-medium text-red-600">{formatCurrency(declinedTotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Pending Response</dt>
              <dd className="font-medium text-gray-500">{formatCurrency(pendingTotal)}</dd>
            </div>
            <div className="border-t border-gray-200 pt-3 mt-3">
              <div className="flex justify-between">
                <dt className="text-gray-500">Work Completed</dt>
                <dd className="font-medium text-green-600">
                  {formatCurrency(completedValue)}
                  <span className="text-xs text-gray-400 ml-1">({completedWork.length} items)</span>
                </dd>
              </div>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Work Outstanding</dt>
              <dd className="font-medium text-orange-600">
                {formatCurrency(outstandingValue)}
                <span className="text-xs text-gray-400 ml-1">({outstandingWork.length} items)</span>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Notes */}
      {(healthCheck.technician_notes || healthCheck.advisor_notes) && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Notes</h3>
          {healthCheck.technician_notes && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-500 mb-1">Technician Notes</h4>
              <p className="text-gray-700 bg-gray-50 p-3 rounded">{healthCheck.technician_notes}</p>
            </div>
          )}
          {healthCheck.advisor_notes && (
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-1">Advisor Notes</h4>
              <p className="text-gray-700 bg-gray-50 p-3 rounded">{healthCheck.advisor_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

