/**
 * ItemReasonsDisplay Component
 * Displays selected reasons for a check result with technical/customer descriptions
 * Allows advisors to edit customer-facing descriptions
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

// Minimum role level for editing reasons
const EDITOR_ROLES = ['super_admin', 'org_admin', 'site_admin', 'service_advisor']

// Types for available reasons from API
interface AvailableReason {
  id: string
  reasonText: string
  technicalDescription?: string
  customerDescription?: string
  defaultRag?: 'red' | 'amber' | 'green'
  categoryId?: string
  categoryName?: string
  categoryColor?: string
  source?: string
}

// Types for reasons data
export interface SelectedReason {
  id: string
  itemReasonId: string
  reasonText: string
  technicalDescription?: string
  customerDescription?: string
  defaultRag?: 'red' | 'amber' | 'green'
  categoryId?: string
  categoryName?: string
  categoryColor?: string
  followUpDays?: number
  followUpText?: string
  hasOverrides?: boolean
}

interface ItemReasonsDisplayProps {
  checkResultId: string
  ragStatus: 'red' | 'amber' | 'green'
  itemName: string
  compact?: boolean
  onUpdate?: () => void
  preloadedReasons?: SelectedReason[]
}

export function ItemReasonsDisplay({
  checkResultId,
  ragStatus,
  itemName,
  compact = false,
  onUpdate,
  preloadedReasons
}: ItemReasonsDisplayProps) {
  const { session, user } = useAuth()
  const [reasons, setReasons] = useState<SelectedReason[]>(preloadedReasons || [])
  const [loading, setLoading] = useState(!preloadedReasons)
  const [error, setError] = useState<string | null>(null)
  const [editingReason, setEditingReason] = useState<SelectedReason | null>(null)
  const [showEditReasons, setShowEditReasons] = useState(false)

  const canEditReasons = EDITOR_ROLES.includes(user?.role || '')

  const fetchReasons = useCallback(async (forceRefresh = false) => {
    // Skip fetch if preloaded reasons are provided (unless forcing refresh)
    if (preloadedReasons && !forceRefresh) {
      setReasons(preloadedReasons)
      setLoading(false)
      return
    }

    if (!session?.accessToken || !checkResultId) return

    setLoading(true)
    try {
      const data = await api<{ selectedReasons: SelectedReason[] }>(
        `/api/v1/check-results/${checkResultId}/reasons`,
        { token: session.accessToken }
      )
      setReasons(data.selectedReasons || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reasons')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, checkResultId, preloadedReasons])

  useEffect(() => {
    fetchReasons()
  }, [fetchReasons])

  const handleDescriptionSaved = () => {
    setEditingReason(null)
    fetchReasons(true)
    onUpdate?.()
  }

  const handleReasonsSaved = () => {
    setShowEditReasons(false)
    fetchReasons(true)
    onUpdate?.()
  }

  if (loading) {
    return (
      <div className="py-2 text-sm text-gray-400">
        Loading reasons...
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-2 text-sm text-red-500">
        {error}
      </div>
    )
  }

  if (reasons.length === 0) {
    return null
  }

  // Get follow-up info from the first reason that has it
  const followUpInfo = reasons.find(r => r.followUpDays || r.followUpText)

  // Format follow-up recommendation text
  const formatFollowUp = (days?: number, text?: string) => {
    if (text) return text
    if (!days) return null
    if (days <= 7) return 'Recommend addressing within 1 week'
    if (days <= 30) return 'Recommend addressing within 1 month'
    if (days <= 90) return 'Recommend addressing within 3 months'
    if (days <= 180) return 'Recommend addressing within 6 months'
    return `Recommend addressing within ${Math.round(days / 30)} months`
  }

  if (compact) {
    // Compact view - just show count and first reason
    return (
      <div className="mt-2 text-sm">
        <div className="flex items-center gap-2 text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span>{reasons.length} reason{reasons.length !== 1 ? 's' : ''} selected</span>
        </div>
        {followUpInfo && (
          <div className="mt-1 text-amber-600 text-xs">
            {formatFollowUp(followUpInfo.followUpDays, followUpInfo.followUpText)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Header row with edit button */}
      <div className="flex items-center justify-between">
        {reasons.length > 1 && (
          <div className="text-sm text-gray-700 font-medium">
            We identified the following issues with your {itemName.toLowerCase()}:
          </div>
        )}
        {!reasons.length || reasons.length <= 1 ? <div /> : null}
        {canEditReasons && (
          <button
            onClick={() => setShowEditReasons(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg"
            title="Edit selected reasons"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {/* Reasons list */}
      <div className="space-y-2">
        {reasons.map((reason) => (
          <ReasonItem
            key={reason.id}
            reason={reason}
            ragStatus={ragStatus}
            onEdit={() => setEditingReason(reason)}
            showMultiple={reasons.length > 1}
          />
        ))}
      </div>

      {/* Follow-up recommendation */}
      {followUpInfo && (
        <div className={`p-2 rounded text-sm ${
          ragStatus === 'red'
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-amber-50 text-amber-700 border border-amber-200'
        }`}>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatFollowUp(followUpInfo.followUpDays, followUpInfo.followUpText)}
          </div>
        </div>
      )}

      {/* Edit customer description modal */}
      {editingReason && (
        <EditCustomerDescriptionModal
          checkResultReasonId={editingReason.id}
          currentDescription={editingReason.customerDescription || ''}
          reasonText={editingReason.reasonText}
          onClose={() => setEditingReason(null)}
          onSave={handleDescriptionSaved}
        />
      )}

      {/* Edit reasons selection modal */}
      {showEditReasons && (
        <EditReasonsModal
          checkResultId={checkResultId}
          onClose={() => setShowEditReasons(false)}
          onSave={handleReasonsSaved}
        />
      )}
    </div>
  )
}

/**
 * Individual reason item with technical and customer descriptions
 */
interface ReasonItemProps {
  reason: SelectedReason
  ragStatus: 'red' | 'amber' | 'green'
  onEdit: () => void
  showMultiple: boolean
}

function ReasonItem({ reason, ragStatus, onEdit, showMultiple }: ReasonItemProps) {
  const [showTechnical, setShowTechnical] = useState(false)

  const categoryColor = reason.categoryColor || (
    ragStatus === 'red' ? '#ef4444' :
    ragStatus === 'amber' ? '#f59e0b' :
    '#22c55e'
  )

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Main reason row */}
      <div className="px-3 py-2">
        <div className="flex items-start gap-2">
          {/* Category indicator */}
          {reason.categoryName && (
            <span
              className="inline-block px-2 py-0.5 text-xs rounded-full text-white mt-0.5"
              style={{ backgroundColor: categoryColor }}
            >
              {reason.categoryName}
            </span>
          )}

          {/* Bullet for multi-reason display */}
          {showMultiple && !reason.categoryName && (
            <span className="text-gray-400 mt-0.5">&bull;</span>
          )}

          {/* Reason text */}
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">
              {reason.reasonText}
            </div>

            {/* Customer description */}
            {reason.customerDescription && (
              <div className="mt-1 text-sm text-gray-600">
                {reason.customerDescription}
                {reason.hasOverrides && (
                  <span className="ml-1 text-xs text-blue-600">(edited)</span>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            {/* Toggle technical view */}
            {reason.technicalDescription && (
              <button
                onClick={() => setShowTechnical(!showTechnical)}
                className="p-1 text-gray-400 hover:text-gray-600"
                title="Technical details"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                </svg>
              </button>
            )}

            {/* Edit customer description */}
            <button
              onClick={onEdit}
              className="p-1 text-gray-400 hover:text-primary"
              title="Edit customer description"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Technical description (collapsed by default) */}
      {showTechnical && reason.technicalDescription && (
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">
            Technical Details (not shown to customer)
          </div>
          <div className="text-sm text-gray-700">
            {reason.technicalDescription}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Modal for editing customer description
 */
interface EditCustomerDescriptionModalProps {
  checkResultReasonId: string
  currentDescription: string
  reasonText: string
  onClose: () => void
  onSave: () => void
}

function EditCustomerDescriptionModal({
  checkResultReasonId,
  currentDescription,
  reasonText,
  onClose,
  onSave
}: EditCustomerDescriptionModalProps) {
  const { session } = useAuth()
  const [description, setDescription] = useState(currentDescription)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!session?.accessToken) return

    setSaving(true)
    setError(null)

    try {
      await api(`/api/v1/check-result-reasons/${checkResultReasonId}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { customerDescriptionOverride: description || null }
      })
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!session?.accessToken) return

    setSaving(true)
    setError(null)

    try {
      await api(`/api/v1/check-result-reasons/${checkResultReasonId}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { customerDescriptionOverride: null }
      })
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Edit Customer Description</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Reason context */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">Reason</div>
            <div className="text-sm font-medium text-gray-900">{reasonText}</div>
          </div>

          {/* Description textarea */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer-Facing Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="Enter a description the customer will see..."
            />
            <p className="mt-1 text-xs text-gray-500">
              This edit only applies to this health check.
            </p>
          </div>

          {error && (
            <div className="text-sm text-red-600">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={handleReset}
            disabled={saving || !currentDescription}
            className="text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            Reset to Default
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary-dark rounded disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Modal for editing reason selections on a check result
 */
interface EditReasonsModalProps {
  checkResultId: string
  onClose: () => void
  onSave: () => void
}

function EditReasonsModal({ checkResultId, onClose, onSave }: EditReasonsModalProps) {
  const { session } = useAuth()
  const [available, setAvailable] = useState<AvailableReason[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      if (!session?.accessToken) return
      setLoading(true)
      try {
        const data = await api<{
          selectedReasons: SelectedReason[]
          availableReasons: AvailableReason[]
        }>(`/api/v1/check-results/${checkResultId}/reasons`, {
          token: session.accessToken
        })
        setAvailable(data.availableReasons || [])
        setSelectedIds(new Set((data.selectedReasons || []).map(r => r.itemReasonId)))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load reasons')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [session?.accessToken, checkResultId])

  const toggleReason = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSave = async () => {
    if (!session?.accessToken) return
    setSaving(true)
    setError(null)
    try {
      await api(`/api/v1/check-results/${checkResultId}/reasons`, {
        method: 'PUT',
        token: session.accessToken,
        body: { reasonIds: Array.from(selectedIds) }
      })
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Group available reasons by category
  const grouped = useMemo(() => {
    const filtered = search
      ? available.filter(r => r.reasonText.toLowerCase().includes(search.toLowerCase()))
      : available
    const groups: Record<string, AvailableReason[]> = {}
    for (const reason of filtered) {
      const cat = reason.categoryName || 'Other'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(reason)
    }
    return groups
  }, [available, search])

  const showSearch = available.length > 10

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Edit Reasons</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        {showSearch && (
          <div className="px-4 pt-3">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reasons..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="text-sm text-gray-400 py-4 text-center">Loading reasons...</div>
          ) : available.length === 0 ? (
            <div className="text-sm text-gray-500 py-4 text-center">No reasons configured for this item.</div>
          ) : Object.keys(grouped).length === 0 ? (
            <div className="text-sm text-gray-500 py-4 text-center">No reasons match your search.</div>
          ) : (
            Object.entries(grouped).map(([category, reasons]) => (
              <div key={category}>
                <div className="text-xs font-medium text-gray-500 uppercase mb-2">{category}</div>
                <div className="space-y-1">
                  {reasons.map(reason => (
                    <label
                      key={reason.id}
                      className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(reason.id)}
                        onChange={() => toggleReason(reason.id)}
                        className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{reason.reasonText}</div>
                        {reason.customerDescription && (
                          <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{reason.customerDescription}</div>
                        )}
                      </div>
                      {reason.defaultRag && (
                        <span className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${
                          reason.defaultRag === 'red' ? 'bg-red-500' :
                          reason.defaultRag === 'amber' ? 'bg-amber-500' :
                          'bg-green-500'
                        }`} />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 text-sm text-red-600">{error}</div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="text-xs text-gray-500">
            {selectedIds.size} reason{selectedIds.size !== 1 ? 's' : ''} selected
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary-dark rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Green item reasons display - shows positive findings
 * Can accept preloaded reasons to avoid individual API calls
 */
interface GreenReasonsDisplayProps {
  checkResultId: string
  compact?: boolean
  preloadedReasons?: SelectedReason[]
}

export function GreenReasonsDisplay({ checkResultId, compact = true, preloadedReasons }: GreenReasonsDisplayProps) {
  const { session } = useAuth()
  const [reasons, setReasons] = useState<SelectedReason[]>(preloadedReasons || [])
  const [loading, setLoading] = useState(!preloadedReasons)

  useEffect(() => {
    // If preloaded reasons are provided, use them and skip fetch
    if (preloadedReasons) {
      setReasons(preloadedReasons)
      setLoading(false)
      return
    }

    const fetchReasons = async () => {
      if (!session?.accessToken || !checkResultId) return

      try {
        const data = await api<{ selectedReasons: SelectedReason[] }>(
          `/api/v1/check-results/${checkResultId}/reasons`,
          { token: session.accessToken }
        )
        setReasons(data.selectedReasons || [])
      } catch {
        // Silently fail for green items
      } finally {
        setLoading(false)
      }
    }

    fetchReasons()
  }, [session?.accessToken, checkResultId, preloadedReasons])

  if (loading || reasons.length === 0) {
    return null
  }

  if (compact) {
    // Just show first reason text
    return (
      <span className="text-xs text-green-600 ml-2">
        {reasons[0].customerDescription || reasons[0].reasonText}
      </span>
    )
  }

  return (
    <div className="mt-1 space-y-1">
      {reasons.map((reason) => (
        <div key={reason.id} className="text-xs text-green-600">
          {reason.customerDescription || reason.reasonText}
        </div>
      ))}
    </div>
  )
}

/**
 * AllOKSection - Collapsible section for green items with positive findings
 */
interface AllOKSectionProps {
  greenResults: Array<{
    id: string
    template_item?: { name?: string }
    notes?: string
  }>
}

export function AllOKSection({ greenResults }: AllOKSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const initialShowCount = 5
  const hasMore = greenResults.length > initialShowCount

  const displayedResults = expanded
    ? greenResults
    : greenResults.slice(0, initialShowCount)

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg">
      <div className="px-4 py-3 flex items-center gap-2 text-green-700 font-medium">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        All OK - {greenResults.length} items passed
      </div>

      <div className="border-t border-green-200">
        {displayedResults.map((result) => (
          <div
            key={result.id}
            className="px-4 py-2 flex items-center gap-2 border-b border-green-100 last:border-b-0"
          >
            <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-gray-700">
              {result.template_item?.name || 'Unknown Item'}
            </span>
            <GreenReasonsDisplay checkResultId={result.id} />
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-4 py-2 text-sm text-green-600 hover:text-green-700 hover:bg-green-100 border-t border-green-200"
        >
          {expanded
            ? 'Show less'
            : `Show all ${greenResults.length} items...`
          }
        </button>
      )}
    </div>
  )
}
