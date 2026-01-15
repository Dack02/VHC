/**
 * CloseHealthCheckModal Component
 * Confirmation modal for closing a health check with summary
 */

import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, RepairItem, Authorization, HealthCheckSummary } from '../../../lib/api'

interface CloseHealthCheckModalProps {
  healthCheckId: string
  repairItems: RepairItem[]
  authorizations: Authorization[]
  summary: HealthCheckSummary | null
  onClose: () => void
  onClosed: () => void
}

export function CloseHealthCheckModal({
  healthCheckId,
  repairItems,
  authorizations,
  summary: _summary,  // Reserved for additional summary display
  onClose,
  onClosed
}: CloseHealthCheckModalProps) {
  void _summary  // Silence unused var warning
  const { session } = useAuth()
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [incompleteItems, setIncompleteItems] = useState<{ id: string; title: string }[]>([])

  // Create authorization lookup
  const authByRepairItemId = new Map(authorizations.map(a => [a.repair_item_id, a]))

  // Calculate statistics
  const authorisedItems = repairItems.filter(item => {
    const auth = authByRepairItemId.get(item.id)
    return auth?.decision === 'approved'
  })

  const declinedItems = repairItems.filter(item => {
    const auth = authByRepairItemId.get(item.id)
    return auth?.decision === 'declined'
  })

  const noResponseItems = repairItems.filter(item => {
    const auth = authByRepairItemId.get(item.id)
    return !auth
  })

  const completedWork = authorisedItems.filter(item => item.work_completed_at)
  const incompleteWork = authorisedItems.filter(item => !item.work_completed_at)

  const authorisedTotal = authorisedItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const completedTotal = completedWork.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const declinedTotal = declinedItems.reduce((sum, item) => sum + (item.total_price || 0), 0)

  const canClose = incompleteWork.length === 0

  const handleClose = async () => {
    if (!session?.accessToken) return

    setClosing(true)
    setError(null)
    setIncompleteItems([])

    try {
      await api(`/api/v1/health-checks/${healthCheckId}/close`, {
        method: 'POST',
        token: session.accessToken
      })
      onClosed()
    } catch (err) {
      // Check if error contains incomplete items
      const errorData = err as { incomplete_items?: { id: string; title: string }[] }
      if (errorData.incomplete_items) {
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

            {/* No Response */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="text-2xl font-bold text-gray-700">{noResponseItems.length}</div>
              <div className="text-sm text-gray-600">No Response</div>
            </div>
          </div>

          {/* Incomplete Work Warning */}
          {incompleteWork.length > 0 && (
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
            className={`px-4 py-2 rounded font-medium ${
              canClose
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {closing ? 'Closing...' : canClose ? 'Close Health Check' : 'Complete Work First'}
          </button>
        </div>
      </div>
    </div>
  )
}
