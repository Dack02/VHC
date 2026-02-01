/**
 * CheckInTab Component
 * Displays and manages the vehicle check-in process for advisors
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { api } from '../../../lib/api'
import { MriScanSection } from '../components/MriScanSection'
import { CustomerEditModal } from '../components/CustomerEditModal'

interface CheckInData {
  id: string
  status: string
  mileageIn: number | null
  timeRequired: string | null
  keyLocation: string | null
  checkinNotes: string | null
  checkinNotesVisibleToTech: boolean
  customerWaiting: boolean | null
  bookedRepairs: Array<{ code?: string; description?: string; notes?: string }> | null
  loanCarRequired: boolean | null
  checkedInAt: string | null
  checkedInBy: string | null
  checkedInByUser: { id: string; firstName: string; lastName: string } | null
  arrivedAt: string | null
  vehicle: {
    id: string
    registration: string
    make: string | null
    model: string | null
    vin: string | null
    customer: {
      id: string
      firstName: string
      lastName: string
      email: string | null
      mobile: string | null
    } | null
  } | null
}

interface MriSummary {
  total: number
  completed: number
  flagged: number
}

interface Advisor {
  id: string
  first_name: string
  last_name: string
}

interface EligibleUser {
  id: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
}

interface CheckInTabProps {
  healthCheckId: string
  healthCheckStatus: string  // Used for status-based UI variations
  onUpdate: () => void
  onCheckInComplete?: () => void
  advisor: Advisor | null
  onAdvisorChange: (advisor: Advisor | null) => void
}

const KEY_LOCATIONS = [
  'In Vehicle',
  'Key Safe',
  'With Advisor',
  'Hook #1',
  'Hook #2',
  'Hook #3',
  'Other'
]

export function CheckInTab({ healthCheckId, healthCheckStatus, onUpdate, onCheckInComplete, advisor, onAdvisorChange }: CheckInTabProps) {
  const { session, user } = useAuth()
  const toast = useToast()
  const [data, setData] = useState<CheckInData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showSkipModal, setShowSkipModal] = useState(false)
  const [showCustomerEditModal, setShowCustomerEditModal] = useState(false)
  const [mriSummary, setMriSummary] = useState<MriSummary | null>(null)

  // Advisor selector state
  const [eligibleAdvisors, setEligibleAdvisors] = useState<EligibleUser[]>([])
  const [loadingAdvisors, setLoadingAdvisors] = useState(true)
  const [savingAdvisor, setSavingAdvisor] = useState(false)

  // Form state
  const [mileageIn, setMileageIn] = useState<string>('')
  const [timeRequired, setTimeRequired] = useState<string>('')
  const [keyLocation, setKeyLocation] = useState<string>('')
  const [customKeyLocation, setCustomKeyLocation] = useState<string>('')
  const [checkinNotes, setCheckinNotes] = useState<string>('')
  const [checkinNotesVisibleToTech, setCheckinNotesVisibleToTech] = useState(true)
  const [customerWaiting, setCustomerWaiting] = useState<boolean | null>(null)

  // Auto-save timer
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Permission check
  const canEdit = user && ['super_admin', 'org_admin', 'site_admin', 'service_advisor'].includes(user.role)
  const canSkip = user && ['super_admin', 'org_admin', 'site_admin'].includes(user.role)
  const isReadOnly = !!data?.checkedInAt && !['super_admin', 'org_admin'].includes(user?.role || '')
  const isAwaitingCheckin = healthCheckStatus === 'awaiting_checkin'

  // Fetch check-in data
  const fetchData = useCallback(async () => {
    if (!session?.accessToken) return

    setLoading(true)
    setError(null)

    try {
      const response = await api<CheckInData>(
        `/api/v1/health-checks/${healthCheckId}/checkin-data`,
        { token: session.accessToken }
      )
      setData(response)

      // Initialize form fields
      setMileageIn(response.mileageIn?.toString() || '')
      setTimeRequired(response.timeRequired || '')
      setKeyLocation(KEY_LOCATIONS.includes(response.keyLocation || '') ? response.keyLocation || '' : (response.keyLocation ? 'Other' : ''))
      setCustomKeyLocation(!KEY_LOCATIONS.includes(response.keyLocation || '') ? response.keyLocation || '' : '')
      setCheckinNotes(response.checkinNotes || '')
      setCheckinNotesVisibleToTech(response.checkinNotesVisibleToTech ?? true)
      setCustomerWaiting(response.customerWaiting)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load check-in data')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, healthCheckId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Fetch eligible advisors for the dropdown
  useEffect(() => {
    const fetchAdvisors = async () => {
      if (!session?.accessToken) return

      try {
        const data = await api<{ users: EligibleUser[] }>(
          '/api/v1/users?limit=100',
          { token: session.accessToken }
        )

        // Filter to only show users who can be advisors
        const advisorRoles = ['service_advisor', 'site_admin', 'org_admin', 'super_admin']
        const eligible = (data.users || []).filter(
          u => advisorRoles.includes(u.role) && u.isActive
        )

        setEligibleAdvisors(eligible)
      } catch {
        console.error('Failed to load eligible advisors')
      } finally {
        setLoadingAdvisors(false)
      }
    }

    fetchAdvisors()
  }, [session?.accessToken])

  // Handle advisor change
  const handleAdvisorChange = async (newAdvisorId: string) => {
    if (!session?.accessToken || savingAdvisor) return

    setSavingAdvisor(true)
    try {
      const response = await api<{ advisor: Advisor | null }>(
        `/api/v1/health-checks/${healthCheckId}`,
        {
          method: 'PATCH',
          token: session.accessToken,
          body: { advisorId: newAdvisorId || null }
        }
      )

      onAdvisorChange(response.advisor || null)
      toast.success('Advisor updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update advisor')
    } finally {
      setSavingAdvisor(false)
    }
  }

  // Auto-save function
  const autoSave = useCallback(async (field: string, value: unknown) => {
    if (!session?.accessToken || isReadOnly) return

    setSaving(true)
    try {
      await api(
        `/api/v1/health-checks/${healthCheckId}/checkin-data`,
        {
          method: 'PATCH',
          token: session.accessToken,
          body: { [field]: value }
        }
      )
    } catch (err) {
      console.error('Auto-save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [session?.accessToken, healthCheckId, isReadOnly])

  // Debounced auto-save
  const debouncedSave = useCallback((field: string, value: unknown) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      autoSave(field, value)
    }, 500)
  }, [autoSave])

  // Field change handlers
  const handleMileageChange = (value: string) => {
    setMileageIn(value)
    const numValue = value ? parseInt(value, 10) : null
    debouncedSave('mileageIn', numValue)
  }

  const handleTimeRequiredChange = (value: string) => {
    setTimeRequired(value)
    debouncedSave('timeRequired', value || null)
  }

  const handleKeyLocationChange = (value: string) => {
    setKeyLocation(value)
    if (value !== 'Other') {
      setCustomKeyLocation('')
      autoSave('keyLocation', value || null)
    }
  }

  const handleCustomKeyLocationChange = (value: string) => {
    setCustomKeyLocation(value)
    debouncedSave('keyLocation', value || null)
  }

  const handleNotesChange = (value: string) => {
    setCheckinNotes(value)
    debouncedSave('checkinNotes', value || null)
  }

  const handleNotesVisibleChange = (value: boolean) => {
    setCheckinNotesVisibleToTech(value)
    autoSave('checkinNotesVisibleToTech', value)
  }

  const handleCustomerWaitingChange = (value: boolean | null) => {
    setCustomerWaiting(value)
    autoSave('customerWaiting', value)
  }

  // Fetch MRI summary for confirmation modal
  const fetchMriSummary = useCallback(async () => {
    if (!session?.accessToken) return

    try {
      const response = await api<{
        progress: { completed: number; total: number }
        items: Record<string, Array<{ result?: { ragStatus?: string | null } }>>
      }>(
        `/api/v1/health-checks/${healthCheckId}/mri-results`,
        { token: session.accessToken }
      )

      // Count flagged items (red or amber)
      let flagged = 0
      Object.values(response.items).forEach(items => {
        items.forEach(item => {
          if (item.result?.ragStatus === 'red' || item.result?.ragStatus === 'amber') {
            flagged++
          }
        })
      })

      setMriSummary({
        total: response.progress.total,
        completed: response.progress.completed,
        flagged
      })
    } catch {
      // MRI data may not exist, that's okay
      setMriSummary({ total: 0, completed: 0, flagged: 0 })
    }
  }, [session?.accessToken, healthCheckId])

  // Open confirmation modal
  const handleCompleteClick = async () => {
    await fetchMriSummary()
    setShowConfirmModal(true)
  }

  // Complete check-in (after confirmation)
  const handleCompleteCheckIn = async () => {
    if (!session?.accessToken || completing) return

    setCompleting(true)
    setError(null)
    setShowConfirmModal(false)

    try {
      const result = await api<{ mriRepairItems?: { created: number } }>(
        `/api/v1/health-checks/${healthCheckId}/complete-checkin`,
        {
          method: 'POST',
          token: session.accessToken
        }
      )

      const mriCreated = result.mriRepairItems?.created || 0
      if (mriCreated > 0) {
        toast.success(`Check-in complete. ${mriCreated} repair item${mriCreated !== 1 ? 's' : ''} created from MRI scan.`)
      } else {
        toast.success('Check-in complete')
      }

      await fetchData()
      onUpdate()
      onCheckInComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete check-in')
    } finally {
      setCompleting(false)
    }
  }

  // Skip check-in (admin only, for when feature is disabled mid-workflow)
  const handleSkipCheckIn = async () => {
    if (!session?.accessToken || skipping) return

    setSkipping(true)
    setError(null)
    setShowSkipModal(false)

    try {
      await api(
        `/api/v1/health-checks/${healthCheckId}/skip-checkin`,
        {
          method: 'POST',
          token: session.accessToken,
          body: { reason: 'Check-in skipped - feature was disabled or vehicle needs to proceed' }
        }
      )
      toast.success('Check-in skipped')
      await fetchData()
      onUpdate()
      onCheckInComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip check-in')
    } finally {
      setSkipping(false)
    }
  }

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
        <div className="flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => {
              setError(null)
              fetchData()
            }}
            className="ml-4 px-3 py-1 text-sm bg-red-100 hover:bg-red-200 rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return <div className="text-gray-500">No check-in data available</div>
  }

  const vehicle = data.vehicle
  const customer = vehicle?.customer

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      {data.checkedInAt && (
        <div className="bg-green-50 border border-green-200 px-4 py-3 rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium text-green-800">Check-In Complete</span>
          </div>
          <p className="text-sm text-green-700 mt-1">
            Checked in at {new Date(data.checkedInAt).toLocaleString()}
            {data.checkedInByUser && ` by ${data.checkedInByUser.firstName} ${data.checkedInByUser.lastName}`}
          </p>
        </div>
      )}

      {saving && (
        <div className="fixed top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-lg text-sm shadow-lg z-50">
          Saving...
        </div>
      )}

      {/* Service Advisor Selector */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900">Service Advisor</h3>
        </div>
        <div className="p-4">
          {loadingAdvisors ? (
            <div className="h-10 bg-gray-100 animate-pulse rounded-lg"></div>
          ) : (
            <select
              value={advisor?.id || ''}
              onChange={(e) => handleAdvisorChange(e.target.value)}
              disabled={savingAdvisor || isReadOnly}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">-- Select Advisor --</option>
              {eligibleAdvisors.map(u => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          )}
          {savingAdvisor && (
            <p className="text-sm text-gray-500 mt-1">Updating...</p>
          )}
        </div>
      </div>

      {/* Vehicle Details */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900">Vehicle Details</h3>
        </div>
        <div className="p-4">
          {vehicle ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-500">Registration</span>
                <p className="font-mono font-semibold text-lg">{vehicle.registration}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Make / Model</span>
                <p className="font-medium">{vehicle.make} {vehicle.model}</p>
              </div>
              {vehicle.vin && (
                <div className="col-span-2">
                  <span className="text-sm text-gray-500">VIN</span>
                  <p className="font-mono text-sm">{vehicle.vin}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500">No vehicle information</p>
          )}
        </div>
      </div>

      {/* Customer Details */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Customer Details</h3>
          {customer && canEdit && (
            <button
              onClick={() => setShowCustomerEditModal(true)}
              className="flex items-center gap-1 text-sm text-primary hover:text-primary-dark"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Edit
            </button>
          )}
        </div>
        <div className="p-4">
          {customer ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-500">Name</span>
                <p className="font-medium">{customer.firstName} {customer.lastName}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Mobile</span>
                <p className="font-medium">{customer.mobile || '-'}</p>
              </div>
              <div className="col-span-2">
                <span className="text-sm text-gray-500">Email</span>
                <p className="text-sm">{customer.email || '-'}</p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">No customer information</p>
          )}
        </div>
      </div>

      {/* Check-In Form */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900">Check-In Information</h3>
        </div>
        <div className="p-4 space-y-4">
          {/* Customer Waiting */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer Waiting?
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="customerWaiting"
                  checked={customerWaiting === true}
                  onChange={() => handleCustomerWaitingChange(true)}
                  disabled={isReadOnly}
                  className="rounded-lg border-gray-300"
                />
                <span>Yes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="customerWaiting"
                  checked={customerWaiting === false}
                  onChange={() => handleCustomerWaitingChange(false)}
                  disabled={isReadOnly}
                  className="rounded-lg border-gray-300"
                />
                <span>No</span>
              </label>
            </div>
          </div>

          {/* Mileage In */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mileage In
            </label>
            <input
              type="number"
              value={mileageIn}
              onChange={(e) => handleMileageChange(e.target.value)}
              disabled={isReadOnly}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
              placeholder="Enter current mileage"
            />
          </div>

          {/* Time Required */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Time Required (when customer needs vehicle back)
            </label>
            <input
              type="time"
              value={timeRequired}
              onChange={(e) => handleTimeRequiredChange(e.target.value)}
              disabled={isReadOnly}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
            />
          </div>

          {/* Key Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Key Location
            </label>
            <select
              value={keyLocation}
              onChange={(e) => handleKeyLocationChange(e.target.value)}
              disabled={isReadOnly}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
            >
              <option value="">Select location...</option>
              {KEY_LOCATIONS.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
            {keyLocation === 'Other' && (
              <input
                type="text"
                value={customKeyLocation}
                onChange={(e) => handleCustomKeyLocationChange(e.target.value)}
                disabled={isReadOnly}
                className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
                placeholder="Specify key location"
              />
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Check-In Notes
            </label>
            <textarea
              value={checkinNotes}
              onChange={(e) => handleNotesChange(e.target.value)}
              disabled={isReadOnly}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
              placeholder="Any additional notes for this check-in..."
            />
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={checkinNotesVisibleToTech}
                onChange={(e) => handleNotesVisibleChange(e.target.checked)}
                disabled={isReadOnly}
                className="rounded-lg border-gray-300"
              />
              <span className="text-sm text-gray-600">Show notes to technician</span>
            </label>
          </div>
        </div>
      </div>

      {/* Pre-booked Work */}
      {data.bookedRepairs && data.bookedRepairs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="font-semibold text-gray-900">Pre-Booked Work (from DMS)</h3>
          </div>
          <div className="p-4">
            <ul className="space-y-2">
              {data.bookedRepairs.map((repair, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-gray-400 mt-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </span>
                  <div>
                    <p className="font-medium">{repair.description || repair.code || 'Booked work'}</p>
                    {repair.notes && <p className="text-sm text-gray-500">{repair.notes}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Loan Car Required */}
      {data.loanCarRequired && (
        <div className="bg-amber-50 border border-amber-200 px-4 py-3 rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium text-amber-800">Loan Car Required</span>
          </div>
        </div>
      )}

      {/* MRI Scan Section */}
      <MriScanSection
        healthCheckId={healthCheckId}
        isReadOnly={isReadOnly}
        onComplete={onUpdate}
      />

      {/* Error Display (inline, when data exists) */}
      {error && data && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-500 hover:text-red-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!data.checkedInAt && canEdit && (
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          {/* Skip Check-In (admin only, for edge cases) */}
          {canSkip && isAwaitingCheckin && (
            <button
              onClick={() => setShowSkipModal(true)}
              disabled={skipping}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {skipping ? 'Skipping...' : 'Skip Check-In'}
            </button>
          )}
          {!canSkip || !isAwaitingCheckin ? <div /> : null}

          {/* Complete Check-In */}
          <button
            onClick={handleCompleteClick}
            disabled={completing}
            className="px-6 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {completing ? 'Completing...' : 'Complete Check-In'}
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md mx-4 shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Complete Check-In?</h2>
            </div>
            <div className="p-6">
              <p className="text-gray-600 mb-4">
                This will mark the vehicle as checked in and ready for inspection.
              </p>

              {mriSummary && mriSummary.total > 0 && (
                <div className="bg-gray-50 border border-gray-200 p-4 mb-4">
                  <h3 className="font-medium text-gray-900 mb-2">MRI Scan Summary</h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>Items checked: {mriSummary.completed} / {mriSummary.total}</li>
                    {mriSummary.flagged > 0 && (
                      <li className="text-amber-600 font-medium">
                        {mriSummary.flagged} flagged item{mriSummary.flagged !== 1 ? 's' : ''} will create repair item{mriSummary.flagged !== 1 ? 's' : ''}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {mriSummary && mriSummary.total > 0 && mriSummary.completed < mriSummary.total && (
                <div className="bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 text-sm mb-4">
                  <strong>Note:</strong> Not all MRI items have been completed. You can still proceed.
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCompleteCheckIn}
                disabled={completing}
                className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark disabled:opacity-50"
              >
                {completing ? 'Completing...' : 'Complete Check-In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skip Check-In Confirmation Modal */}
      {showSkipModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md mx-4 shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Skip Check-In?</h2>
            </div>
            <div className="p-6">
              <p className="text-gray-600 mb-4">
                This will skip the check-in process and move the vehicle directly to the inspection queue.
              </p>
              <div className="bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 text-sm">
                <strong>Warning:</strong> No MRI scan data will be recorded and no MRI-based repair items will be created.
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowSkipModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSkipCheckIn}
                disabled={skipping}
                className="px-4 py-2 bg-amber-500 text-white font-medium hover:bg-amber-600 disabled:opacity-50"
              >
                {skipping ? 'Skipping...' : 'Skip Check-In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Edit Modal */}
      {showCustomerEditModal && customer && (
        <CustomerEditModal
          customer={{
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            mobile: customer.mobile
          }}
          onClose={() => setShowCustomerEditModal(false)}
          onCustomerUpdated={(updatedCustomer) => {
            // Update local state with new customer data
            if (data?.vehicle) {
              setData({
                ...data,
                vehicle: {
                  ...data.vehicle,
                  customer: {
                    id: updatedCustomer.id,
                    firstName: updatedCustomer.firstName,
                    lastName: updatedCustomer.lastName,
                    email: updatedCustomer.email,
                    mobile: updatedCustomer.mobile
                  }
                }
              })
            }
            setShowCustomerEditModal(false)
            onUpdate()
          }}
        />
      )}
    </div>
  )
}
