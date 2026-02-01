/**
 * MRI Tab Component
 * Displays MRI scan results in read-only mode for viewing after check-in
 * Visible to both advisors and technicians
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

interface MriResult {
  id?: string
  nextDueDate: string | null
  nextDueMileage: number | null
  dueIfNotReplaced: boolean
  yesNoValue: boolean | null
  notes: string | null
  ragStatus: string | null
  completedAt: string | null
}

interface MriItem {
  id: string
  name: string
  description: string | null
  itemType: 'date_mileage' | 'yes_no' | 'unknown'
  severityWhenDue: string | null
  severityWhenYes: string | null
  severityWhenNo: string | null
  isInformational: boolean
  sortOrder: number
  isDeleted?: boolean  // Flag for deleted/disabled items
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

interface MriTabProps {
  healthCheckId: string
}

const RAG_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  red: { bg: 'bg-rag-red', text: 'text-white', label: 'Action Required' },
  amber: { bg: 'bg-rag-amber', text: 'text-white', label: 'Attention' },
  green: { bg: 'bg-rag-green', text: 'text-white', label: 'OK' }
}

export function MriTab({ healthCheckId }: MriTabProps) {
  const { session } = useAuth()
  const [data, setData] = useState<MriResultsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full"></div>
          <span className="ml-2 text-gray-500">Loading MRI scan results...</span>
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
        <div className="p-8 text-center">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="text-lg font-medium text-gray-700 mb-2">No MRI Scan Data</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            No MRI (Manufacturer Recommended Items) scan was performed for this health check.
            MRI scans are completed during the vehicle check-in process.
          </p>
        </div>
      </div>
    )
  }

  const { items, progress, isMriComplete } = data
  const categories = Object.keys(items)

  // Count flagged items (items that created repair items)
  const flaggedCount = Object.values(items).flat().filter(
    item => item.result?.ragStatus === 'red' || item.result?.ragStatus === 'amber'
  ).length

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-900">MRI Scan Results</h2>
            {isMriComplete ? (
              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-lg">
                Complete
              </span>
            ) : (
              <span className="px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 rounded-lg">
                In Progress
              </span>
            )}
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-500">Items Checked:</span>{' '}
              <span className="font-medium">{progress.completed} / {progress.total}</span>
            </div>
            {flaggedCount > 0 && (
              <div>
                <span className="text-gray-500">Flagged Items:</span>{' '}
                <span className="font-medium text-amber-600">{flaggedCount}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results by Category */}
      {categories.map(category => {
        const isArchived = category === 'Archived Items'
        return (
          <div key={category} className={`bg-white border rounded-lg ${isArchived ? 'border-gray-300' : 'border-gray-200'}`}>
            <div className={`px-4 py-3 border-b ${isArchived ? 'bg-gray-100 border-gray-300' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-sm font-semibold uppercase tracking-wider ${isArchived ? 'text-gray-500' : 'text-gray-700'}`}>
                  {category}
                </h3>
                {isArchived && (
                  <span className="text-xs text-gray-500 normal-case font-normal">
                    Items that have been removed from the MRI configuration
                  </span>
                )}
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {items[category].map(item => (
                <MriItemRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Read-only MRI Item Row
interface MriItemRowProps {
  item: MriItem
}

function MriItemRow({ item }: MriItemRowProps) {
  const result = item.result
  const hasResult = result && (
    result.nextDueDate ||
    result.nextDueMileage ||
    result.dueIfNotReplaced ||
    result.yesNoValue !== null
  )

  const ragStatus = result?.ragStatus
  const ragColor = ragStatus ? RAG_COLORS[ragStatus] : null
  const isActionRequired = ragStatus === 'red' || ragStatus === 'amber'
  const isDeleted = item.isDeleted === true

  return (
    <div className={`px-4 py-3 ${isActionRequired ? 'bg-amber-50' : ''} ${isDeleted ? 'bg-gray-50 opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {hasResult ? (
              <span className={isDeleted ? 'text-gray-400' : 'text-green-500'}>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </span>
            ) : (
              <span className="text-gray-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth={2} />
                </svg>
              </span>
            )}
            <span className={`font-medium ${isDeleted ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{item.name}</span>
            {isDeleted && (
              <span className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-600 rounded-lg">
                Archived
              </span>
            )}
            {item.isInformational && !isDeleted && (
              <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-lg">Info</span>
            )}
            {isActionRequired && !isDeleted && (
              <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-lg">
                Repair Item Created
              </span>
            )}
          </div>
          {item.description && (
            <p className="text-sm text-gray-500 mt-1 ml-6">{item.description}</p>
          )}
        </div>

        {ragColor && (
          <span className={`px-2 py-1 text-xs font-medium ${ragColor.bg} ${ragColor.text} rounded-lg`}>
            {ragColor.label}
          </span>
        )}
      </div>

      {/* Result Details */}
      {hasResult && (
        <div className="mt-2 ml-6 text-sm text-gray-600 space-y-1">
          {item.itemType === 'date_mileage' ? (
            <>
              {result?.nextDueDate && (
                <div>
                  <span className="text-gray-500">Next Due Date:</span>{' '}
                  <span className="font-medium">{new Date(result.nextDueDate).toLocaleDateString('en-GB')}</span>
                </div>
              )}
              {result?.nextDueMileage && (
                <div>
                  <span className="text-gray-500">Next Due Mileage:</span>{' '}
                  <span className="font-medium">{result.nextDueMileage.toLocaleString()}</span>
                </div>
              )}
              {result?.dueIfNotReplaced && (
                <div className="text-amber-600 font-medium">
                  Due if not already replaced
                </div>
              )}
            </>
          ) : (
            <>
              {result?.yesNoValue !== null && (
                <div>
                  <span className="text-gray-500">Response:</span>{' '}
                  <span className={`font-medium ${result.yesNoValue ? 'text-green-600' : 'text-red-600'}`}>
                    {result.yesNoValue ? 'Yes' : 'No'}
                  </span>
                </div>
              )}
            </>
          )}
          {result?.notes && (
            <div>
              <span className="text-gray-500">Notes:</span>{' '}
              <span>{result.notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
