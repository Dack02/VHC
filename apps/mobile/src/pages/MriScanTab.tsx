import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api, MriResultsResponse, MriItem, CheckinData } from '../lib/api'
import { Card } from '../components/Card'

interface MriScanTabProps {
  healthCheckId: string
  vehicle?: {
    make: string | null
    model: string | null
    year: number | null
    registration: string
  }
  advisor?: {
    id: string
    first_name: string
    last_name: string
  } | null
  bookedRepairs?: Array<{
    code?: string
    description?: string
    notes?: string
    labourItems?: Array<{ description: string; price?: number; units?: number; fitter?: string }>
  }> | null
  bookingNotes?: string | null
  jobsheetNumber?: string | null
}

export function MriScanTab({ healthCheckId, vehicle, advisor, bookedRepairs, bookingNotes, jobsheetNumber }: MriScanTabProps) {
  const { session } = useAuth()
  const [mriData, setMriData] = useState<MriResultsResponse | null>(null)
  const [checkinData, setCheckinData] = useState<CheckinData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [healthCheckId])

  const fetchData = async () => {
    if (!session) return

    try {
      setLoading(true)
      // Fetch MRI results and check-in data in parallel
      const [mriResponse, checkinResponse] = await Promise.all([
        api<MriResultsResponse>(
          `/api/v1/health-checks/${healthCheckId}/mri-results`,
          { token: session.access_token }
        ),
        api<CheckinData>(
          `/api/v1/health-checks/${healthCheckId}/checkin-data`,
          { token: session.access_token }
        ).catch(() => null) // Don't fail if check-in data not available
      ])
      setMriData(mriResponse)
      setCheckinData(checkinResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MRI scan')
    } finally {
      setLoading(false)
    }
  }

  // Format date for display (e.g., "March 2026")
  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    } catch {
      return dateStr
    }
  }

  // Format mileage with commas (e.g., "48,000 miles")
  const formatMileage = (mileage: number | null): string => {
    if (!mileage) return ''
    return `${mileage.toLocaleString()} miles`
  }

  // Get RAG emoji
  const getRagEmoji = (status: string | null): string => {
    switch (status) {
      case 'red': return '🔴'
      case 'amber': return '🟠'
      case 'green': return '🟢'
      default: return '⚪'
    }
  }

  // Format completion time
  const formatCompletedAt = (completedAt: string | null): string => {
    if (!completedAt) return ''
    try {
      const date = new Date(completedAt)
      const now = new Date()
      const isToday = date.toDateString() === now.toDateString()

      if (isToday) {
        return `Completed ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} today`
      }
      return `Completed ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    } catch {
      return 'Completed'
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <Card padding="lg">
          <p className="text-rag-red text-center">{error}</p>
        </Card>
      </div>
    )
  }

  // Empty state - MRI scan not yet completed
  if (!mriData || !mriData.isMriComplete) {
    return (
      <div className="p-4">
        <Card padding="lg">
          <div className="text-center py-8">
            <div className="text-4xl mb-4">⏳</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Awaiting MRI Scan</h3>
            <p className="text-sm text-gray-600">
              The service advisor will complete this during vehicle check-in.
            </p>
          </div>
        </Card>
      </div>
    )
  }

  // Find a completed timestamp from any result
  const completedAt = Object.values(mriData.items)
    .flat()
    .find(item => item.result?.completedAt)?.result?.completedAt

  // Categories to display (ordered)
  const categoryOrder = ['Service Items', 'Safety & Compliance', 'Other', 'Archived Items']
  const categories = categoryOrder.filter(cat => mriData.items[cat]?.length > 0)

  // Add any categories not in the predefined order
  Object.keys(mriData.items).forEach(cat => {
    if (!categories.includes(cat) && mriData.items[cat]?.length > 0) {
      categories.splice(-1, 0, cat) // Insert before Archived Items
    }
  })

  // Check if there's any check-in data to display
  const hasCheckinInfo = checkinData && (
    checkinData.customerWaiting !== null ||
    checkinData.mileageIn !== null ||
    checkinData.timeRequired !== null ||
    checkinData.keyLocation !== null
  )

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <Card padding="md">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">MRI SCAN</h2>
            <p className="text-sm text-gray-500">{formatCompletedAt(completedAt || null)}</p>
          </div>
          <div className="flex items-center gap-1 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-xs">Read-only</span>
          </div>
        </div>
      </Card>

      {/* Vehicle Info */}
      {vehicle && (vehicle.make || vehicle.model) && (
        <Card padding="md">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            VEHICLE
          </h3>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 flex items-center justify-center text-xl">
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-4 4v-4m-8 8h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">
                {vehicle.make} {vehicle.model}
                {vehicle.year && <span className="text-gray-500"> ({vehicle.year})</span>}
              </p>
              <p className="text-sm text-gray-500">{vehicle.registration}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Service Advisor */}
      {advisor && (
        <Card padding="md">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            SERVICE ADVISOR
          </h3>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary text-white flex items-center justify-center text-lg font-bold">
              {advisor.first_name?.[0] || ''}{advisor.last_name?.[0] || ''}
            </div>
            <p className="font-medium text-gray-900">
              {advisor.first_name} {advisor.last_name}
            </p>
          </div>
        </Card>
      )}

      {/* Pre-Booked Work from DMS */}
      {(bookedRepairs && bookedRepairs.length > 0 || bookingNotes) && (() => {
        const hasLabourItems = bookedRepairs?.some(r => r.labourItems && r.labourItems.length > 0) ?? false
        const allLabourItems = hasLabourItems
          ? bookedRepairs!.flatMap(r => r.labourItems || [])
          : []

        return (
          <Card padding="md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                PRE-BOOKED WORK
              </h3>
              {jobsheetNumber && (
                <span className="text-xs text-gray-400">Job #{jobsheetNumber}</span>
              )}
            </div>

            {/* Booking-level notes header */}
            {bookingNotes && (
              <div className="p-2 bg-blue-50 rounded mb-3">
                <p className="text-sm font-medium text-gray-900">{bookingNotes}</p>
              </div>
            )}

            {hasLabourItems ? (
              /* New format: labour line items */
              <div className="space-y-2">
                {allLabourItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-gray-50">
                    <div className="flex items-center gap-2">
                      <span className="text-primary font-bold">•</span>
                      <p className="text-sm font-medium text-gray-900">{item.description}</p>
                    </div>
                    {item.price != null && item.price > 0 && (
                      <span className="text-xs text-gray-500">£{item.price.toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : bookedRepairs && bookedRepairs.length > 0 ? (
              /* Fallback: old format */
              <div className="space-y-2">
                {bookedRepairs.map((repair, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 bg-gray-50">
                    <span className="text-primary font-bold">•</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {repair.description || repair.code || 'Booked item'}
                      </p>
                      {repair.notes && (
                        <p className="text-xs text-gray-500 mt-1">{repair.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        )
      })()}

      {/* Check-In Information */}
      {hasCheckinInfo && (
        <Card padding="md">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            CHECK-IN INFORMATION
          </h3>
          <div className="space-y-2">
            {checkinData.customerWaiting !== null && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Customer Waiting</span>
                <span className={`text-sm font-medium px-2 py-0.5 ${
                  checkinData.customerWaiting
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {checkinData.customerWaiting ? 'Yes' : 'No'}
                </span>
              </div>
            )}
            {checkinData.mileageIn !== null && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Mileage In</span>
                <span className="text-sm font-medium text-gray-900">
                  {checkinData.mileageIn.toLocaleString()}
                </span>
              </div>
            )}
            {checkinData.timeRequired !== null && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Time Required</span>
                <span className="text-sm font-medium text-gray-900">
                  {checkinData.timeRequired}
                </span>
              </div>
            )}
            {checkinData.keyLocation !== null && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Key Location</span>
                <span className="text-sm font-medium text-gray-900">
                  {checkinData.keyLocation}
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Advisor Notes - only show if visible to tech */}
      {checkinData?.checkinNotes && checkinData.checkinNotesVisibleToTech && (
        <Card padding="md" className="bg-blue-50 border border-blue-200">
          <div className="flex items-start gap-3">
            <div className="text-blue-600 mt-0.5">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-blue-900 mb-1">ADVISOR NOTES</h3>
              <p className="text-sm text-blue-800">{checkinData.checkinNotes}</p>
            </div>
          </div>
        </Card>
      )}

      {/* MRI Items grouped by category */}
      {categories.map(category => (
        <div key={category} className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
            {category}
          </h3>

          {mriData.items[category].map((item: MriItem) => (
            <MriItemCard key={item.id} item={item} formatDate={formatDate} formatMileage={formatMileage} getRagEmoji={getRagEmoji} />
          ))}
        </div>
      ))}

      {/* Progress */}
      <div className="text-center text-sm text-gray-500 py-4">
        {mriData.progress.completed} of {mriData.progress.total} items reviewed
      </div>
    </div>
  )
}

// Individual MRI Item Card
interface MriItemCardProps {
  item: MriItem
  formatDate: (date: string | null) => string
  formatMileage: (mileage: number | null) => string
  getRagEmoji: (status: string | null) => string
}

function MriItemCard({ item, formatDate, formatMileage, getRagEmoji }: MriItemCardProps) {
  const result = item.result
  const ragStatus = result?.ragStatus || null

  // Determine what to display based on item type and result
  const renderValue = () => {
    if (!result) {
      return <span className="text-gray-400">Not reviewed</span>
    }

    if (result.notApplicable) {
      return <span className="text-sm text-gray-400 italic">Not Applicable</span>
    }

    if (result.alreadyBookedThisVisit) {
      return <span className="text-sm text-green-600 font-medium">Already booked for this visit</span>
    }

    if (item.itemType === 'date_mileage') {
      // Show due date/mileage or "Due if not already replaced" / "Recommended this visit"
      if (result.dueIfNotReplaced) {
        return (
          <span className="text-sm text-gray-700">
            Due if not already replaced
          </span>
        )
      }

      if (result.recommendedThisVisit) {
        return (
          <span className="text-sm text-gray-700">
            Recommended this visit
          </span>
        )
      }

      // Format date and mileage, accounting for N/A flags
      const dueDate = result.dateNa ? null : formatDate(result.nextDueDate)
      const dueMileage = result.mileageNa ? null : formatMileage(result.nextDueMileage)
      const dateNaLabel = result.dateNa ? 'Date: N/A' : null
      const mileageNaLabel = result.mileageNa ? 'Mileage: N/A' : null

      // Build display string
      const parts: string[] = []
      if (dueDate) parts.push(dueDate)
      else if (dateNaLabel) parts.push(dateNaLabel)
      if (dueMileage) parts.push(dueMileage)
      else if (mileageNaLabel) parts.push(mileageNaLabel)

      if (parts.length > 0) {
        return <span className="text-sm text-gray-700">Due: {parts.join(' / ')}</span>
      } else if (ragStatus === 'green') {
        return <span className="text-sm text-gray-500">OK - not due yet</span>
      }
      return <span className="text-sm text-gray-400">No data recorded</span>
    }

    if (item.itemType === 'yes_no') {
      if (result.yesNoValue === true) {
        return (
          <span className="text-sm text-gray-700">
            Yes{result.notes ? ` - ${result.notes}` : ''}
          </span>
        )
      } else if (result.yesNoValue === false) {
        return <span className="text-sm text-gray-700">No</span>
      }
      return <span className="text-sm text-gray-400">Not answered</span>
    }

    return null
  }

  // Check if this item created a repair item (has a non-green/non-null RAG status indicates it was flagged)
  const wasAddedToHealthCheck = result && (ragStatus === 'red' || ragStatus === 'amber') && result.recommendedThisVisit

  return (
    <Card padding="md" className={item.isDeleted ? 'opacity-60' : ''}>
      <div className="space-y-2">
        {/* Item name with RAG indicator */}
        <div className="flex items-start gap-3">
          <span className="text-lg flex-shrink-0">{getRagEmoji(ragStatus)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{item.name}</span>
              {item.isDeleted && (
                <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5">Archived</span>
              )}
            </div>

            {/* Value/Status */}
            <div className="mt-1">
              {renderValue()}
            </div>

            {/* Notes (for date_mileage items) */}
            {item.itemType === 'date_mileage' && result?.notes && (
              <p className="text-sm text-gray-500 mt-1 italic">{result.notes}</p>
            )}

            {/* Added to Health Check indicator */}
            {wasAddedToHealthCheck && (
              <div className="flex items-center gap-1 mt-2 text-primary text-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span>Added to Health Check</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
