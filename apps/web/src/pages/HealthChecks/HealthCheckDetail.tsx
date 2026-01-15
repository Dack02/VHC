import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api, HealthCheck, CheckResult, RepairItem, StatusHistoryEntry, TemplateSection } from '../../lib/api'
import { PricingTab } from './tabs/PricingTab'
import { ResultsTab } from './tabs/ResultsTab'
import { PhotosTab } from './tabs/PhotosTab'
import { TimelineTab } from './tabs/TimelineTab'
import { PublishModal } from './PublishModal'
import { CustomerPreviewModal } from './CustomerPreviewModal'

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

type Tab = 'summary' | 'results' | 'pricing' | 'photos' | 'timeline'

export default function HealthCheckDetail() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()

  const [healthCheck, setHealthCheck] = useState<HealthCheck | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [results, setResults] = useState<CheckResult[]>([])
  const [repairItems, setRepairItems] = useState<RepairItem[]>([])
  const [history, setHistory] = useState<StatusHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('summary')
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)

  const fetchData = useCallback(async () => {
    if (!session?.accessToken || !id) return

    setLoading(true)
    setError(null)

    try {
      // Fetch health check
      const hcData = await api<{ healthCheck: HealthCheck }>(
        `/api/v1/health-checks/${id}`,
        { token: session.accessToken }
      )
      setHealthCheck(hcData.healthCheck)

      // Fetch template sections
      if (hcData.healthCheck.template_id) {
        const templateData = await api<{ sections?: TemplateSection[] }>(
          `/api/v1/templates/${hcData.healthCheck.template_id}`,
          { token: session.accessToken }
        )
        setSections(templateData.sections || [])
      }

      // Fetch results
      const resultsData = await api<{ results: CheckResult[] }>(
        `/api/v1/health-checks/${id}/results`,
        { token: session.accessToken }
      )
      setResults(resultsData.results || [])

      // Fetch repair items
      const repairData = await api<{ repairItems: RepairItem[] }>(
        `/api/v1/health-checks/${id}/repair-items`,
        { token: session.accessToken }
      )
      setRepairItems(repairData.repairItems || [])

      // Fetch history
      const historyData = await api<{ history: StatusHistoryEntry[] }>(
        `/api/v1/health-checks/${id}/history`,
        { token: session.accessToken }
      )
      setHistory(historyData.history || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health check')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, id])

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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !healthCheck) {
    return (
      <div className="bg-red-50 text-red-700 p-4">
        {error || 'Health check not found'}
        <Link to="/health-checks" className="ml-4 underline">Back to list</Link>
      </div>
    )
  }

  const vehicle = healthCheck.vehicle
  const customer = healthCheck.vehicle?.customer

  const tabs: { id: Tab; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'results', label: 'Results' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'photos', label: 'Photos' },
    { id: 'timeline', label: 'Timeline' }
  ]

  // Determine available actions based on status
  const canStartReview = healthCheck.status === 'tech_completed'
  const canMarkReady = ['awaiting_review', 'awaiting_pricing'].includes(healthCheck.status)
  const canSend = healthCheck.status === 'ready_to_send'
  const canResend = ['sent', 'expired'].includes(healthCheck.status)

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link to="/health-checks" className="text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              {vehicle?.registration || 'Health Check'}
            </h1>
            <span className={`px-3 py-1 text-sm font-medium ${statusColors[healthCheck.status]}`}>
              {statusLabels[healthCheck.status]}
            </span>
          </div>
          <p className="text-gray-500">
            {vehicle?.make} {vehicle?.model} {vehicle?.year && `(${vehicle.year})`}
            {customer && ` - ${customer.first_name} ${customer.last_name}`}
          </p>
        </div>

        <div className="flex gap-2">
          {canStartReview && (
            <button
              onClick={() => handleStatusChange('awaiting_pricing')}
              className="px-4 py-2 bg-orange-500 text-white font-medium hover:bg-orange-600"
            >
              Start Review
            </button>
          )}
          {canMarkReady && (
            <button
              onClick={() => handleStatusChange('ready_to_send')}
              className="px-4 py-2 bg-blue-500 text-white font-medium hover:bg-blue-600"
            >
              Mark Ready
            </button>
          )}
          {canSend && (
            <>
              <button
                onClick={() => setShowPreviewModal(true)}
                className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Preview
              </button>
              <button
                onClick={() => setShowPublishModal(true)}
                className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark"
              >
                Send to Customer
              </button>
            </>
          )}
          {canResend && (
            <button
              onClick={() => setShowPublishModal(true)}
              className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark"
            >
              Resend
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 -mb-px
                ${activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'summary' && (
        <SummaryTab healthCheck={healthCheck} />
      )}
      {activeTab === 'results' && (
        <ResultsTab sections={sections} results={results} />
      )}
      {activeTab === 'pricing' && (
        <PricingTab
          healthCheckId={id!}
          repairItems={repairItems}
          onUpdate={fetchData}
        />
      )}
      {activeTab === 'photos' && (
        <PhotosTab results={results} />
      )}
      {activeTab === 'timeline' && (
        <TimelineTab history={history} />
      )}

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
    </div>
  )
}

// Summary Tab Component
function SummaryTab({ healthCheck }: { healthCheck: HealthCheck }) {
  const vehicle = healthCheck.vehicle
  const customer = healthCheck.vehicle?.customer

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Vehicle Info */}
      <div className="bg-white border border-gray-200 shadow-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Vehicle Details</h3>
        <dl className="space-y-2">
          <div className="flex justify-between">
            <dt className="text-gray-500">Registration</dt>
            <dd className="font-medium">{vehicle?.registration || '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Make</dt>
            <dd className="font-medium">{vehicle?.make || '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Model</dt>
            <dd className="font-medium">{vehicle?.model || '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Year</dt>
            <dd className="font-medium">{vehicle?.year || '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Colour</dt>
            <dd className="font-medium">{vehicle?.color || '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Mileage In</dt>
            <dd className="font-medium">{healthCheck.mileage_in?.toLocaleString() || '-'}</dd>
          </div>
        </dl>
      </div>

      {/* Customer Info */}
      <div className="bg-white border border-gray-200 shadow-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Customer</h3>
        {customer ? (
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-gray-500">Name</dt>
              <dd className="font-medium">{customer.first_name} {customer.last_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Email</dt>
              <dd className="font-medium">{customer.email || '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Mobile</dt>
              <dd className="font-medium">{customer.mobile || '-'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-gray-500">No customer assigned</p>
        )}
      </div>

      {/* RAG Summary */}
      <div className="bg-white border border-gray-200 shadow-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Inspection Summary</h3>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="text-center p-4 bg-green-50">
            <div className="text-3xl font-bold text-green-600">{healthCheck.green_count}</div>
            <div className="text-sm text-green-700">Passed</div>
          </div>
          <div className="text-center p-4 bg-yellow-50">
            <div className="text-3xl font-bold text-yellow-600">{healthCheck.amber_count}</div>
            <div className="text-sm text-yellow-700">Advisory</div>
          </div>
          <div className="text-center p-4 bg-red-50">
            <div className="text-3xl font-bold text-red-600">{healthCheck.red_count}</div>
            <div className="text-sm text-red-700">Urgent</div>
          </div>
        </div>

        {healthCheck.total_amount > 0 && (
          <div className="border-t border-gray-200 pt-4">
            <div className="flex justify-between mb-2">
              <span className="text-gray-500">Parts</span>
              <span className="font-medium">£{healthCheck.total_parts.toFixed(2)}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-gray-500">Labour</span>
              <span className="font-medium">£{healthCheck.total_labour.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>£{healthCheck.total_amount.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Notes */}
      {(healthCheck.technician_notes || healthCheck.advisor_notes) && (
        <div className="lg:col-span-3 bg-white border border-gray-200 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Notes</h3>
          {healthCheck.technician_notes && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-500 mb-1">Technician Notes</h4>
              <p className="text-gray-700">{healthCheck.technician_notes}</p>
            </div>
          )}
          {healthCheck.advisor_notes && (
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-1">Advisor Notes</h4>
              <p className="text-gray-700">{healthCheck.advisor_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
