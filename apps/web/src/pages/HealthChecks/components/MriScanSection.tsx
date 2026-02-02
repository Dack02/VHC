/**
 * MRI Scan Section Component
 * Displays and manages the MRI (Manufacturer Recommended Items) scan checklist
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

interface MriResult {
  id?: string
  nextDueDate: string | null
  nextDueMileage: number | null
  dueIfNotReplaced: boolean
  recommendedThisVisit: boolean
  notDueYet: boolean
  yesNoValue: boolean | null
  notes: string | null
  ragStatus: string | null
  completedAt: string | null
  dateNa: boolean
  mileageNa: boolean
  notApplicable: boolean
  alreadyBookedThisVisit: boolean
}

interface MriResultUpdate {
  nextDueDate?: string | null
  nextDueMileage?: number | null
  dueIfNotReplaced?: boolean
  recommendedThisVisit?: boolean
  notDueYet?: boolean
  yesNoValue?: boolean | null
  notes?: string | null
  dateNa?: boolean
  mileageNa?: boolean
  notApplicable?: boolean
  alreadyBookedThisVisit?: boolean
}

interface MriItem {
  id: string
  name: string
  description: string | null
  salesDescription: string | null
  itemType: 'date_mileage' | 'yes_no'
  severityWhenDue: string | null
  severityWhenYes: string | null
  severityWhenNo: string | null
  isInformational: boolean
  sortOrder: number
  result: MriResult | null
}

interface MriResultsResponse {
  healthCheckId: string
  items: Record<string, MriItem[]>
  progress: {
    completed: number
    total: number
  }
  isMriComplete: boolean
}

interface MriScanSectionProps {
  healthCheckId: string
  isReadOnly?: boolean
  allowEditWhenComplete?: boolean
  onComplete?: () => void
}

const RAG_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  red: { bg: 'bg-rag-red', text: 'text-white', label: 'Action Required' },
  amber: { bg: 'bg-rag-amber', text: 'text-white', label: 'Attention' },
  green: { bg: 'bg-rag-green', text: 'text-white', label: 'OK' }
}

export function MriScanSection({ healthCheckId, isReadOnly = false, allowEditWhenComplete = false, onComplete }: MriScanSectionProps) {
  const { session } = useAuth()
  const [data, setData] = useState<MriResultsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [expanded, setExpanded] = useState(true)

  // Track pending saves for debouncing
  const saveTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Fetch MRI data
  const fetchData = useCallback(async () => {
    if (!session?.accessToken) return

    setLoading(true)
    setError(null)

    try {
      const response = await api<MriResultsResponse>(
        `/api/v1/health-checks/${healthCheckId}/mri-results`,
        { token: session.accessToken }
      )
      setData(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MRI data')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, healthCheckId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      saveTimeoutsRef.current.forEach(timeout => clearTimeout(timeout))
    }
  }, [])

  // Calculate progress from current items
  const calculateProgress = (items: Record<string, MriItem[]>) => {
    let completed = 0
    let total = 0
    for (const category of Object.keys(items)) {
      for (const item of items[category]) {
        total++
        if (item.result && (
          item.result.notApplicable ||
          item.result.alreadyBookedThisVisit ||
          item.result.nextDueDate ||
          item.result.nextDueMileage ||
          item.result.dateNa ||
          item.result.mileageNa ||
          item.result.dueIfNotReplaced ||
          item.result.recommendedThisVisit ||
          item.result.notDueYet ||
          item.result.yesNoValue !== null
        )) {
          completed++
        }
      }
    }
    return { completed, total }
  }

  // Auto-save a single item result
  const saveItemResult = useCallback(async (
    mriItemId: string,
    updates: MriResultUpdate
  ) => {
    if (!session?.accessToken || isReadOnly) return

    // Clear any pending save for this item
    const existingTimeout = saveTimeoutsRef.current.get(mriItemId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Debounce save
    const timeout = setTimeout(async () => {
      setSaving(true)
      try {
        const response = await api<{ result: { ragStatus: string | null } }>(
          `/api/v1/health-checks/${healthCheckId}/mri-results/${mriItemId}`,
          {
            method: 'PATCH',
            token: session.accessToken,
            body: updates
          }
        )
        // Update only the RAG status for this specific item (no full refresh)
        if (response.result) {
          setData(prev => {
            if (!prev) return prev
            const newItems = { ...prev.items }
            for (const category of Object.keys(newItems)) {
              newItems[category] = newItems[category].map(item => {
                if (item.id === mriItemId && item.result) {
                  return {
                    ...item,
                    result: {
                      ...item.result,
                      ragStatus: response.result.ragStatus
                    }
                  }
                }
                return item
              })
            }
            return { ...prev, items: newItems }
          })
        }
      } catch (err) {
        console.error('Failed to save MRI result:', err)
      } finally {
        setSaving(false)
        saveTimeoutsRef.current.delete(mriItemId)
      }
    }, 500)

    saveTimeoutsRef.current.set(mriItemId, timeout)
  }, [session?.accessToken, healthCheckId, isReadOnly])

  // Complete MRI scan
  const handleComplete = async () => {
    if (!session?.accessToken || completing) return

    setCompleting(true)
    setError(null)

    try {
      await api(
        `/api/v1/health-checks/${healthCheckId}/mri-results/complete`,
        {
          method: 'POST',
          token: session.accessToken
        }
      )
      await fetchData()
      onComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete MRI scan')
    } finally {
      setCompleting(false)
    }
  }

  // Update local state optimistically
  const updateItemResult = (categoryItems: MriItem[], itemId: string, updates: MriResultUpdate) => {
    return categoryItems.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          result: {
            ...item.result,
            nextDueDate: item.result?.nextDueDate || null,
            nextDueMileage: item.result?.nextDueMileage || null,
            dueIfNotReplaced: item.result?.dueIfNotReplaced || false,
            recommendedThisVisit: item.result?.recommendedThisVisit || false,
            notDueYet: item.result?.notDueYet || false,
            yesNoValue: item.result?.yesNoValue ?? null,
            notes: item.result?.notes || null,
            ragStatus: item.result?.ragStatus || null,
            completedAt: item.result?.completedAt || null,
            dateNa: item.result?.dateNa || false,
            mileageNa: item.result?.mileageNa || false,
            notApplicable: item.result?.notApplicable || false,
            alreadyBookedThisVisit: item.result?.alreadyBookedThisVisit || false,
            ...updates
          }
        }
      }
      return item
    })
  }

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full"></div>
          <span className="ml-2 text-gray-500">Loading MRI items...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 rounded-lg font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!data || Object.keys(data.items).length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900">MRI Scan</h3>
        </div>
        <div className="p-6 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <p className="text-gray-500 mb-2">No MRI items configured</p>
          <p className="text-sm text-gray-400">
            MRI items can be configured in Settings &rarr; Workflow &rarr; MRI Items
          </p>
        </div>
      </div>
    )
  }

  const { items, progress, isMriComplete } = data
  const categories = Object.keys(items)

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900">MRI Scan</h3>
          {isMriComplete && (
            <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-lg">
              Complete
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            Progress: {progress.completed} / {progress.total}
          </span>
          {saving && (
            <span className="text-xs text-blue-500">Saving...</span>
          )}
          <button className="text-gray-400 hover:text-gray-600">
            <svg
              className={`w-5 h-5 transform transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1 bg-gray-200">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
        />
      </div>

      {/* Content */}
      {expanded && (
        <div className="p-4 space-y-6">
          {categories.map(category => (
            <div key={category}>
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                {category}
              </h4>
              <div className="space-y-3">
                {items[category].map(item => (
                  <MriItemCard
                    key={item.id}
                    item={item}
                    isReadOnly={isReadOnly || (isMriComplete && !allowEditWhenComplete)}
                    onUpdate={(updates) => {
                      // Optimistic update
                      setData(prev => {
                        if (!prev) return prev
                        const newItems = {
                          ...prev.items,
                          [category]: updateItemResult(prev.items[category], item.id, updates)
                        }
                        return {
                          ...prev,
                          items: newItems,
                          progress: calculateProgress(newItems)
                        }
                      })
                      // Save to server
                      saveItemResult(item.id, updates)
                    }}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Actions */}
          {!isReadOnly && !isMriComplete && (
            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                onClick={handleComplete}
                disabled={completing || progress.completed === 0}
                className="px-6 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {completing ? 'Completing...' : 'Complete MRI Scan'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Individual MRI Item Card Component
interface MriItemCardProps {
  item: MriItem
  isReadOnly: boolean
  onUpdate: (updates: MriResultUpdate) => void
}

function MriItemCard({ item, isReadOnly, onUpdate }: MriItemCardProps) {
  // Item is considered "complete" if it has any meaningful data
  const hasResult = item.result && (
    item.result.notApplicable ||
    item.result.alreadyBookedThisVisit ||
    item.result.nextDueDate ||
    item.result.nextDueMileage ||
    item.result.dateNa ||
    item.result.mileageNa ||
    item.result.dueIfNotReplaced ||
    item.result.recommendedThisVisit ||
    item.result.notDueYet ||
    item.result.yesNoValue !== null
  )

  const ragStatus = item.result?.ragStatus
  const ragColor = ragStatus ? RAG_COLORS[ragStatus] : null

  return (
    <div className={`border rounded-lg p-4 ${hasResult ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {hasResult ? (
            <span className="text-green-500">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </span>
          ) : (
            <span className="text-gray-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
          )}
          <span className="font-medium text-gray-900">{item.name}</span>
          {item.isInformational && (
            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-lg">Info only</span>
          )}
        </div>
        {ragColor && (
          <span className={`px-2 py-1 text-xs font-medium ${ragColor.bg} ${ragColor.text} rounded-lg`}>
            {ragColor.label}
          </span>
        )}
      </div>

      {(item.salesDescription || item.description) && (
        <p className="text-sm text-gray-500 mb-3">{item.salesDescription || item.description}</p>
      )}

      {item.result?.notApplicable ? (
        <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg border border-gray-200">
          <span className="text-sm text-gray-500 italic">Not applicable to this vehicle</span>
          {!isReadOnly && (
            <button
              onClick={() => onUpdate({ notApplicable: false })}
              className="text-xs text-primary hover:text-primary-dark font-medium"
            >
              Undo
            </button>
          )}
        </div>
      ) : item.itemType === 'date_mileage' ? (
        <DateMileageFields
          item={item}
          isReadOnly={isReadOnly}
          onUpdate={onUpdate}
        />
      ) : (
        <YesNoFields
          item={item}
          isReadOnly={isReadOnly}
          onUpdate={onUpdate}
        />
      )}
    </div>
  )
}

// Date/Mileage Item Fields
interface DateMileageFieldsProps {
  item: MriItem
  isReadOnly: boolean
  onUpdate: (updates: MriResultUpdate) => void
}

// Status type for the radio group (null = no selection)
type MriStatus = 'not_due' | 'due' | 'recommended' | 'already_booked' | 'na' | null

function DateMileageFields({ item, isReadOnly, onUpdate }: DateMileageFieldsProps) {
  const result = item.result

  // Derive current status from result (null if no status flag is set)
  const getCurrentStatus = (): MriStatus => {
    if (result?.notApplicable) return 'na'
    if (result?.alreadyBookedThisVisit) return 'already_booked'
    if (result?.dueIfNotReplaced) return 'due'
    if (result?.recommendedThisVisit) return 'recommended'
    if (result?.notDueYet) return 'not_due'
    // Also check if there's date/mileage/N/A data (backwards compatibility)
    if (result?.nextDueDate || result?.nextDueMileage || result?.dateNa || result?.mileageNa) {
      return 'not_due'
    }
    return null // No selection yet
  }

  const currentStatus = getCurrentStatus()

  // Handle status change
  const handleStatusChange = (status: MriStatus) => {
    if (status === 'na') {
      onUpdate({ notApplicable: true, alreadyBookedThisVisit: false })
    } else if (status === 'already_booked') {
      onUpdate({
        alreadyBookedThisVisit: true,
        dueIfNotReplaced: false,
        recommendedThisVisit: false,
        notDueYet: false,
        notApplicable: false
      })
    } else {
      onUpdate({
        dueIfNotReplaced: status === 'due',
        recommendedThisVisit: status === 'recommended',
        notDueYet: status === 'not_due',
        notApplicable: false,
        alreadyBookedThisVisit: false
      })
    }
  }

  // Handle N/A checkbox change
  const handleDateNaChange = (checked: boolean) => {
    const updates: MriResultUpdate = { dateNa: checked }
    if (checked) {
      updates.nextDueDate = null // Clear date when N/A is checked
    }
    onUpdate(updates)
  }

  const handleMileageNaChange = (checked: boolean) => {
    const updates: MriResultUpdate = { mileageNa: checked }
    if (checked) {
      updates.nextDueMileage = null // Clear mileage when N/A is checked
    }
    onUpdate(updates)
  }

  const dateNa = result?.dateNa || false
  const mileageNa = result?.mileageNa || false

  return (
    <div className="space-y-3">
      {/* Date/Mileage inputs with N/A checkboxes - hidden when status is N/A or Already Booked */}
      {currentStatus !== 'na' && currentStatus !== 'already_booked' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Next Due Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={result?.nextDueDate || ''}
                onChange={(e) => onUpdate({ nextDueDate: e.target.value || null })}
                disabled={isReadOnly || dateNa}
                className={`flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100 ${dateNa ? 'opacity-50' : ''}`}
              />
              <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  checked={dateNa}
                  onChange={(e) => handleDateNaChange(e.target.checked)}
                  disabled={isReadOnly}
                  className="rounded-lg"
                />
                N/A
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Next Due Mileage</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={result?.nextDueMileage || ''}
                onChange={(e) => onUpdate({ nextDueMileage: e.target.value ? parseInt(e.target.value, 10) : null })}
                disabled={isReadOnly || mileageNa}
                placeholder="e.g., 120000"
                className={`flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100 ${mileageNa ? 'opacity-50' : ''}`}
              />
              <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  checked={mileageNa}
                  onChange={(e) => handleMileageNaChange(e.target.checked)}
                  disabled={isReadOnly}
                  className="rounded-lg"
                />
                N/A
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Status radio group */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-gray-500">Status</span>

        {/* Not due yet */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={`mri-status-${item.id}`}
            checked={currentStatus === 'not_due'}
            onChange={() => handleStatusChange('not_due')}
            disabled={isReadOnly}
            className="border-gray-300"
          />
          <span className="text-sm text-gray-700">Not due yet</span>
        </label>

        {/* Due if not already replaced */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={`mri-status-${item.id}`}
            checked={currentStatus === 'due'}
            onChange={() => handleStatusChange('due')}
            disabled={isReadOnly}
            className="border-gray-300"
          />
          <span className="text-sm text-gray-700">Due if not already replaced</span>
          {!item.isInformational && item.severityWhenDue && (
            <span className={`px-1.5 py-0.5 text-xs ${RAG_COLORS[item.severityWhenDue]?.bg} ${RAG_COLORS[item.severityWhenDue]?.text} rounded-lg`}>
              {item.severityWhenDue.toUpperCase()}
            </span>
          )}
        </label>

        {/* Recommended this visit */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={`mri-status-${item.id}`}
            checked={currentStatus === 'recommended'}
            onChange={() => handleStatusChange('recommended')}
            disabled={isReadOnly}
            className="border-gray-300"
          />
          <span className="text-sm text-gray-700">Recommended this visit</span>
          {!item.isInformational && item.severityWhenDue && (
            <span className={`px-1.5 py-0.5 text-xs ${RAG_COLORS[item.severityWhenDue]?.bg} ${RAG_COLORS[item.severityWhenDue]?.text} rounded-lg`}>
              {item.severityWhenDue.toUpperCase()}
            </span>
          )}
        </label>

        {/* Already booked for this visit */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={`mri-status-${item.id}`}
            checked={currentStatus === 'already_booked'}
            onChange={() => handleStatusChange('already_booked')}
            disabled={isReadOnly}
            className="border-gray-300"
          />
          <span className="text-sm text-gray-700">Already booked for this visit</span>
          <span className="px-1.5 py-0.5 text-xs bg-rag-green text-white rounded-lg">GREEN</span>
        </label>

        {/* Not Applicable */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={`mri-status-${item.id}`}
            checked={currentStatus === 'na'}
            onChange={() => handleStatusChange('na')}
            disabled={isReadOnly}
            className="border-gray-300"
          />
          <span className="text-sm text-gray-500">Not Applicable</span>
        </label>
      </div>
    </div>
  )
}

// Yes/No Item Fields
interface YesNoFieldsProps {
  item: MriItem
  isReadOnly: boolean
  onUpdate: (updates: MriResultUpdate) => void
}

function YesNoFields({ item, isReadOnly, onUpdate }: YesNoFieldsProps) {
  const result = item.result
  const isNa = result?.notApplicable || false

  const isAlreadyBooked = result?.alreadyBookedThisVisit || false

  // Derive select value
  const selectValue = isNa ? 'na' : isAlreadyBooked ? 'already_booked' : (result?.yesNoValue === null ? '' : result?.yesNoValue ? 'yes' : 'no')

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
        <select
          value={selectValue}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'na') {
              onUpdate({ notApplicable: true, alreadyBookedThisVisit: false })
            } else if (value === 'already_booked') {
              onUpdate({
                alreadyBookedThisVisit: true,
                yesNoValue: null,
                notApplicable: false
              })
            } else {
              onUpdate({
                yesNoValue: value === '' ? null : value === 'yes',
                notApplicable: false,
                alreadyBookedThisVisit: false
              })
            }
          }}
          disabled={isReadOnly}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
        >
          <option value="">Select...</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="already_booked">Already booked for this visit</option>
          <option value="na">Not Applicable</option>
        </select>
        {!item.isInformational && (
          <div className="flex gap-2 mt-1 text-xs text-gray-500">
            {item.severityWhenYes && (
              <span>Yes = <span className={`px-1 ${RAG_COLORS[item.severityWhenYes]?.bg} ${RAG_COLORS[item.severityWhenYes]?.text}`}>{item.severityWhenYes}</span></span>
            )}
            {item.severityWhenNo && (
              <span>No = <span className={`px-1 ${RAG_COLORS[item.severityWhenNo]?.bg} ${RAG_COLORS[item.severityWhenNo]?.text}`}>{item.severityWhenNo}</span></span>
            )}
          </div>
        )}
      </div>
      {!isNa && !isAlreadyBooked && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
          <textarea
            value={result?.notes || ''}
            onChange={(e) => onUpdate({ notes: e.target.value || null })}
            disabled={isReadOnly}
            rows={2}
            placeholder="Additional notes..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100"
          />
        </div>
      )}
    </div>
  )
}
