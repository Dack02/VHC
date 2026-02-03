import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, NewRepairItem } from '../../../lib/api'

type AuthMethod = 'in_person' | 'phone' | 'not_sent'

interface AdvisorAuthorizationModalProps {
  healthCheckId: string
  repairItems: NewRepairItem[]
  healthCheckStatus: string
  onClose: () => void
  onAuthorized: () => void
}

export function AdvisorAuthorizationModal({
  healthCheckId,
  repairItems,
  healthCheckStatus,
  onClose,
  onAuthorized
}: AdvisorAuthorizationModalProps) {
  const { session } = useAuth()
  const [authMethod, setAuthMethod] = useState<AuthMethod>(
    healthCheckStatus === 'ready_to_send' ? 'not_sent' : 'in_person'
  )
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Only show top-level, non-deleted items
  const visibleItems = repairItems.filter(
    item => !item.parentRepairItemId && item.outcomeStatus !== 'deleted'
  )

  const allDecided = visibleItems.every(item =>
    item.outcomeStatus === 'authorised' ||
    item.outcomeStatus === 'declined' ||
    item.outcomeStatus === 'deferred'
  )

  const handleSubmit = async () => {
    if (!session?.accessToken || !allDecided) return

    setSaving(true)
    setError(null)

    try {
      await api(`/api/v1/health-checks/${healthCheckId}/advisor-authorize`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          authorization_method: authMethod,
          notes: notes || undefined
        }
      })

      setSuccess(true)
      setTimeout(() => {
        onAuthorized()
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record authorization')
    } finally {
      setSaving(false)
    }
  }

  const outcomeBadge = (status: string | null | undefined) => {
    switch (status) {
      case 'authorised':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Authorised</span>
      case 'declined':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Declined</span>
      case 'deferred':
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Deferred</span>
      default:
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Not decided</span>
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl shadow-xl rounded-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Record Customer Authorization</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="p-6 overflow-y-auto flex-1">
          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-medium text-gray-900">Authorization Recorded</p>
              <p className="text-gray-500 mt-1">The health check status has been updated.</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-4">
                  {error}
                </div>
              )}

              {/* Warning when not all items decided */}
              {!allDecided && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg mb-4 flex gap-3">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium">Not all items have been decided</p>
                    <p className="text-sm mt-1">Close this modal and use the Authorise / Decline / Defer buttons on each repair item before recording authorization.</p>
                  </div>
                </div>
              )}

              {/* Authorization Method */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">How was this authorized?</h3>
                <div className="flex gap-3">
                  {([
                    { value: 'in_person', label: 'In Person' },
                    { value: 'phone', label: 'Phone' },
                    { value: 'not_sent', label: 'Not Sent' }
                  ] as { value: AuthMethod; label: string }[]).map(opt => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-2 px-4 py-2 border rounded-lg cursor-pointer transition-colors ${
                        authMethod === opt.value
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="authMethod"
                        value={opt.value}
                        checked={authMethod === opt.value}
                        onChange={() => setAuthMethod(opt.value)}
                        className="sr-only"
                      />
                      <span className="text-sm font-medium">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Repair Items Summary (read-only) */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Item Decisions</h3>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {visibleItems.map(item => (
                    <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                      <span className="text-sm text-gray-900">{item.name}</span>
                      {outcomeBadge(item.outcomeStatus)}
                    </div>
                  ))}
                </div>
              </div>

              {/* General Notes */}
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Notes (optional)</h3>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any additional notes about this authorization..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !allDecided}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Record Authorization'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
