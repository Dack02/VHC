import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, NewRepairItem } from '../../../lib/api'

interface DeclinedReason {
  id: string
  reason: string
  description: string | null
  isSystem: boolean
}

type Decision = 'authorise' | 'decline' | 'defer'
type AuthMethod = 'in_person' | 'phone' | 'not_sent'

interface ItemDecision {
  decision: Decision | null
  declined_reason_id?: string
  declined_notes?: string
  deferred_until?: string
  deferred_notes?: string
}

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
  const { session, user } = useAuth()
  const [authMethod, setAuthMethod] = useState<AuthMethod>(
    healthCheckStatus === 'ready_to_send' ? 'not_sent' : 'in_person'
  )
  const [decisions, setDecisions] = useState<Record<string, ItemDecision>>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [declinedReasons, setDeclinedReasons] = useState<DeclinedReason[]>([])

  // Only show top-level, non-deleted items
  const visibleItems = repairItems.filter(
    item => !item.parentRepairItemId && item.outcomeStatus !== 'deleted'
  )

  // Initialize decisions from existing outcomes
  useEffect(() => {
    const initial: Record<string, ItemDecision> = {}
    for (const item of visibleItems) {
      if (item.outcomeStatus === 'authorised') {
        initial[item.id] = { decision: 'authorise' }
      } else if (item.outcomeStatus === 'declined') {
        initial[item.id] = { decision: 'decline' }
      } else if (item.outcomeStatus === 'deferred') {
        initial[item.id] = { decision: 'defer' }
      } else {
        initial[item.id] = { decision: null }
      }
    }
    setDecisions(initial)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch declined reasons
  useEffect(() => {
    const fetchReasons = async () => {
      if (!session?.accessToken || !user?.organization?.id) return
      try {
        const data = await api<{ reasons: DeclinedReason[] }>(
          `/api/v1/organizations/${user.organization.id}/declined-reasons`,
          { token: session.accessToken }
        )
        setDeclinedReasons(data.reasons || [])
      } catch {
        // Non-critical, decline reason dropdown will just be empty
      }
    }
    fetchReasons()
  }, [session?.accessToken, user?.organization?.id])

  const updateDecision = (itemId: string, updates: Partial<ItemDecision>) => {
    setDecisions(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...updates }
    }))
  }

  const setAllDecisions = (decision: Decision) => {
    const updated: Record<string, ItemDecision> = {}
    for (const item of visibleItems) {
      updated[item.id] = { decision }
    }
    setDecisions(updated)
  }

  const allDecided = visibleItems.every(item => decisions[item.id]?.decision)

  const handleSubmit = async () => {
    if (!session?.accessToken || !allDecided) return

    setSaving(true)
    setError(null)

    try {
      const items = visibleItems.map(item => {
        const d = decisions[item.id]
        return {
          repair_item_id: item.id,
          decision: d.decision!,
          declined_reason_id: d.declined_reason_id || undefined,
          declined_notes: d.declined_notes || undefined,
          deferred_until: d.deferred_until || undefined,
          deferred_notes: d.deferred_notes || undefined
        }
      })

      await api(`/api/v1/health-checks/${healthCheckId}/advisor-authorize`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          items,
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

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
  }

  const ragColor = (status: string | null | undefined) => {
    if (status === 'red') return 'bg-red-500'
    if (status === 'amber') return 'bg-amber-500'
    return 'bg-gray-300'
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

              {/* Quick Actions */}
              <div className="mb-4 flex gap-2">
                <button
                  onClick={() => setAllDecisions('authorise')}
                  className="px-3 py-1.5 text-xs font-medium border border-green-300 text-green-700 rounded-lg hover:bg-green-50"
                >
                  Authorise All
                </button>
                <button
                  onClick={() => setAllDecisions('decline')}
                  className="px-3 py-1.5 text-xs font-medium border border-red-300 text-red-700 rounded-lg hover:bg-red-50"
                >
                  Decline All
                </button>
              </div>

              {/* Repair Items */}
              <div className="mb-6 space-y-3">
                <h3 className="text-sm font-medium text-gray-700">Repair Items</h3>
                {visibleItems.map(item => {
                  const d = decisions[item.id] || { decision: null }
                  const wasOnline = item.outcomeSource === 'online' && item.outcomeStatus

                  return (
                    <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                      {/* Item header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-3 h-3 rounded-full ${ragColor(item.ragStatus)}`} />
                          <span className="text-sm font-medium text-gray-900">{item.name}</span>
                          {wasOnline && (
                            <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                              decided online
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-700">
                          {formatPrice(item.totalIncVat || 0)}
                        </span>
                      </div>

                      {/* Decision buttons */}
                      <div className="flex gap-2 mb-2">
                        <button
                          onClick={() => updateDecision(item.id, { decision: 'authorise' })}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            d.decision === 'authorise'
                              ? 'bg-green-600 text-white'
                              : 'border border-green-300 text-green-700 hover:bg-green-50'
                          }`}
                        >
                          Authorise
                        </button>
                        <button
                          onClick={() => updateDecision(item.id, { decision: 'decline' })}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            d.decision === 'decline'
                              ? 'bg-red-600 text-white'
                              : 'border border-red-300 text-red-700 hover:bg-red-50'
                          }`}
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => updateDecision(item.id, { decision: 'defer' })}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            d.decision === 'defer'
                              ? 'bg-amber-600 text-white'
                              : 'border border-amber-300 text-amber-700 hover:bg-amber-50'
                          }`}
                        >
                          Defer
                        </button>
                      </div>

                      {/* Decline expanded fields */}
                      {d.decision === 'decline' && (
                        <div className="mt-3 pl-3 border-l-2 border-red-200 space-y-2">
                          <select
                            value={d.declined_reason_id || ''}
                            onChange={e => updateDecision(item.id, { declined_reason_id: e.target.value || undefined })}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                          >
                            <option value="">Select reason (optional)</option>
                            {declinedReasons.map(r => (
                              <option key={r.id} value={r.id}>{r.reason}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={d.declined_notes || ''}
                            onChange={e => updateDecision(item.id, { declined_notes: e.target.value || undefined })}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                          />
                        </div>
                      )}

                      {/* Defer expanded fields */}
                      {d.decision === 'defer' && (
                        <div className="mt-3 pl-3 border-l-2 border-amber-200 space-y-2">
                          <input
                            type="date"
                            value={d.deferred_until || ''}
                            onChange={e => updateDecision(item.id, { deferred_until: e.target.value || undefined })}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                          />
                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={d.deferred_notes || ''}
                            onChange={e => updateDecision(item.id, { deferred_notes: e.target.value || undefined })}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
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
