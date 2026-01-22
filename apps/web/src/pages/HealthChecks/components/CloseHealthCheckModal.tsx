/**
 * CloseHealthCheckModal Component
 * Confirmation modal for closing a health check with summary
 * Includes outcome enforcement - blocks closing if items need outcome decisions
 */

import { useState, useMemo } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, RepairItem, HealthCheckSummary } from '../../../lib/api'
import { calculateOutcomeStatus } from './OutcomeButton'

interface CloseHealthCheckModalProps {
  healthCheckId: string
  repairItems: RepairItem[]
  summary: HealthCheckSummary | null
  onClose: () => void
  onClosed: () => void
}

export function CloseHealthCheckModal({
  healthCheckId,
  repairItems,
  summary: _summary,  // Reserved for additional summary display
  onClose,
  onClosed
}: CloseHealthCheckModalProps) {
  void _summary  // Silence unused var warning
  const { session } = useAuth()
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [incompleteItems, setIncompleteItems] = useState<{ id: string; title: string }[]>([])
  const [pendingOutcomeItems, setPendingOutcomeItems] = useState<{ id: string; title: string }[]>([])

  // Calculate pending outcome items (items that need an outcome decision)
  const pendingOutcomeData = useMemo(() => {
    // Only check top-level items (not children)
    const topLevelItems = repairItems.filter(item =>
      !item.parent_repair_item_id && !item.deleted_at
    )

    const pending = topLevelItems.filter(item => {
      const status = calculateOutcomeStatus({
        deleted_at: item.deleted_at,
        outcome_status: item.outcome_status,
        is_approved: item.is_approved,
        labour_status: item.labour_status,
        parts_status: item.parts_status,
        no_labour_required: item.no_labour_required,
        no_parts_required: item.no_parts_required
      })

      // Items in 'incomplete' or 'ready' state need an outcome
      return status === 'incomplete' || status === 'ready'
    })

    return {
      items: pending,
      count: pending.length,
      readyCount: pending.filter(item => {
        const status = calculateOutcomeStatus({
          deleted_at: item.deleted_at,
          outcome_status: item.outcome_status,
          is_approved: item.is_approved,
          labour_status: item.labour_status,
          parts_status: item.parts_status,
          no_labour_required: item.no_labour_required,
          no_parts_required: item.no_parts_required
        })
        return status === 'ready'
      }).length,
      incompleteCount: pending.filter(item => {
        const status = calculateOutcomeStatus({
          deleted_at: item.deleted_at,
          outcome_status: item.outcome_status,
          is_approved: item.is_approved,
          labour_status: item.labour_status,
          parts_status: item.parts_status,
          no_labour_required: item.no_labour_required,
          no_parts_required: item.no_parts_required
        })
        return status === 'incomplete'
      }).length
    }
  }, [repairItems])

  // Build children map for groups
  const childrenByParent = new Map<string, RepairItem[]>()
  repairItems.forEach(item => {
    if (item.parent_repair_item_id) {
      const children = childrenByParent.get(item.parent_repair_item_id) || []
      children.push(item)
      childrenByParent.set(item.parent_repair_item_id, children)
    }
  })

  // Helper to check if item or any of its children are approved
  // Uses is_approved field on repair_items table
  const hasApproved = (item: RepairItem): boolean => {
    // Check is_approved field directly on repair item
    if (item.is_approved === true) return true

    // For groups, also check if any children are approved
    if (item.is_group) {
      const children = childrenByParent.get(item.id) || []
      return children.some(child => child.is_approved === true)
    }
    return false
  }

  // Helper to check if item or any of its children are declined
  const hasDeclined = (item: RepairItem): boolean => {
    // Check is_approved=false (explicitly declined)
    if (item.is_approved === false) return true

    // For groups, also check if any children are declined
    if (item.is_group) {
      const children = childrenByParent.get(item.id) || []
      return children.some(child => child.is_approved === false)
    }
    return false
  }

  // Calculate statistics (exclude children - they're counted under their parent group)
  const authorisedItems = repairItems.filter(item =>
    !item.parent_repair_item_id && hasApproved(item)
  )

  const declinedItems = repairItems.filter(item =>
    !item.parent_repair_item_id && hasDeclined(item)
  )

  const completedWork = authorisedItems.filter(item => item.work_completed_at)
  const incompleteWork = authorisedItems.filter(item => !item.work_completed_at)

  const authorisedTotal = authorisedItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const completedTotal = completedWork.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const declinedTotal = declinedItems.reduce((sum, item) => sum + (item.total_price || 0), 0)

  // Can close only if:
  // 1. No items pending outcome (all have authorised/deferred/declined/deleted)
  // 2. All authorised work is marked complete
  const hasPendingOutcomes = pendingOutcomeData.count > 0
  const hasIncompleteWork = incompleteWork.length > 0
  const canClose = !hasPendingOutcomes && !hasIncompleteWork

  // Determine button text based on blocking reason
  const getButtonText = () => {
    if (closing) return 'Closing...'
    if (hasPendingOutcomes) return `Action ${pendingOutcomeData.count} Item${pendingOutcomeData.count !== 1 ? 's' : ''} First`
    if (hasIncompleteWork) return 'Complete Work First'
    return 'Close Health Check'
  }

  const handleClose = async () => {
    if (!session?.accessToken) return

    setClosing(true)
    setError(null)
    setIncompleteItems([])
    setPendingOutcomeItems([])

    try {
      await api(`/api/v1/health-checks/${healthCheckId}/close`, {
        method: 'POST',
        token: session.accessToken
      })
      onClosed()
    } catch (err) {
      // Check if error contains pending outcome items or incomplete work items
      const errorData = err as {
        code?: string
        incomplete_items?: { id: string; title: string }[]
        pending_outcome_items?: { id: string; title: string }[]
        pending_count?: number
      }

      if (errorData.code === 'PENDING_OUTCOMES' && errorData.pending_outcome_items) {
        setPendingOutcomeItems(errorData.pending_outcome_items)
        setError(`Cannot close: ${errorData.pending_count || errorData.pending_outcome_items.length} repair item(s) need an outcome`)
      } else if (errorData.code === 'INCOMPLETE_WORK' && errorData.incomplete_items) {
        setIncompleteItems(errorData.incomplete_items)
        setError('Cannot close: Some authorised work is not complete')
      } else if (errorData.incomplete_items) {
        // Legacy support
        setIncompleteItems(errorData.incomplete_items)
        setError('Cannot close: Some authorised work is not complete')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to close health check')
      }
    } finally {
      setClosing(false)
    }
  }

  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Close Health Check</h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4">
            {/* Authorised */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-700">{authorisedItems.length}</div>
              <div className="text-sm text-green-600">Items Authorised</div>
              <div className="text-sm font-medium text-green-700 mt-1">{formatCurrency(authorisedTotal)}</div>
            </div>

            {/* Declined */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-2xl font-bold text-red-700">{declinedItems.length}</div>
              <div className="text-sm text-red-600">Items Declined</div>
              <div className="text-sm font-medium text-red-700 mt-1">{formatCurrency(declinedTotal)}</div>
            </div>

            {/* Work Completed */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-700">{completedWork.length}</div>
              <div className="text-sm text-blue-600">Work Completed</div>
              <div className="text-sm font-medium text-blue-700 mt-1">{formatCurrency(completedTotal)}</div>
            </div>

            {/* Pending Outcome - highlighted if blocking */}
            <div className={`rounded-lg p-3 ${
              hasPendingOutcomes
                ? 'bg-purple-50 border border-purple-200'
                : 'bg-gray-50 border border-gray-200'
            }`}>
              <div className={`text-2xl font-bold ${hasPendingOutcomes ? 'text-purple-700' : 'text-gray-700'}`}>
                {pendingOutcomeData.count}
              </div>
              <div className={`text-sm ${hasPendingOutcomes ? 'text-purple-600' : 'text-gray-600'}`}>
                Pending Outcome
              </div>
              {hasPendingOutcomes && (
                <div className="text-xs text-purple-500 mt-1">
                  {pendingOutcomeData.readyCount > 0 && `${pendingOutcomeData.readyCount} ready`}
                  {pendingOutcomeData.readyCount > 0 && pendingOutcomeData.incompleteCount > 0 && ', '}
                  {pendingOutcomeData.incompleteCount > 0 && `${pendingOutcomeData.incompleteCount} incomplete`}
                </div>
              )}
            </div>
          </div>

          {/* Pending Outcome Warning */}
          {hasPendingOutcomes && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <div className="font-medium text-purple-800">Items Need an Outcome</div>
                  <div className="text-sm text-purple-700 mt-1">
                    {pendingOutcomeData.count} repair item{pendingOutcomeData.count !== 1 ? 's' : ''} need to be authorised, deferred, declined, or deleted:
                  </div>
                  <ul className="mt-2 text-sm text-purple-700 list-disc list-inside">
                    {pendingOutcomeData.items.slice(0, 5).map(item => (
                      <li key={item.id}>{item.title}</li>
                    ))}
                    {pendingOutcomeData.items.length > 5 && (
                      <li>...and {pendingOutcomeData.items.length - 5} more</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Incomplete Work Warning */}
          {hasIncompleteWork && !hasPendingOutcomes && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <div className="font-medium text-amber-800">Incomplete Authorised Work</div>
                  <div className="text-sm text-amber-700 mt-1">
                    {incompleteWork.length} authorised item{incompleteWork.length > 1 ? 's are' : ' is'} not marked complete:
                  </div>
                  <ul className="mt-2 text-sm text-amber-700 list-disc list-inside">
                    {incompleteWork.slice(0, 5).map(item => (
                      <li key={item.id}>{item.title}</li>
                    ))}
                    {incompleteWork.length > 5 && (
                      <li>...and {incompleteWork.length - 5} more</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Error from API */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              <div className="font-medium">{error}</div>
              {pendingOutcomeItems.length > 0 && (
                <ul className="mt-2 text-sm list-disc list-inside">
                  {pendingOutcomeItems.map(item => (
                    <li key={item.id}>{item.title}</li>
                  ))}
                </ul>
              )}
              {incompleteItems.length > 0 && (
                <ul className="mt-2 text-sm list-disc list-inside">
                  {incompleteItems.map(item => (
                    <li key={item.id}>{item.title}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Confirmation text */}
          {canClose && (
            <p className="text-sm text-gray-600">
              Are you sure you want to close this health check? This action cannot be undone.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleClose}
            disabled={closing || !canClose}
            title={!canClose ? (hasPendingOutcomes ? 'Action all items first' : 'Complete all authorised work first') : undefined}
            className={`px-4 py-2 rounded font-medium ${
              canClose
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {getButtonText()}
          </button>
        </div>
      </div>
    </div>
  )
}
