import { useState, useEffect } from 'react'
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
  const [freshItems, setFreshItems] = useState<NewRepairItem[] | null>(null)
  const [loadingItems, setLoadingItems] = useState(true)

  // Fetch fresh repair items when modal opens to avoid stale data
  useEffect(() => {
    const fetchItems = async () => {
      if (!session?.accessToken) {
        setLoadingItems(false)
        return
      }
      try {
        const data = await api<{ repairItems: NewRepairItem[] }>(
          `/api/v1/health-checks/${healthCheckId}/repair-items`,
          { token: session.accessToken }
        )
        setFreshItems(data.repairItems || [])
      } catch {
        // Fall back to prop data on error
        setFreshItems(null)
      } finally {
        setLoadingItems(false)
      }
    }
    fetchItems()
  }, [session?.accessToken, healthCheckId])

  // Use fresh data if available, otherwise fall back to prop
  const items = freshItems ?? repairItems

  // Only show top-level, non-deleted items
  const visibleItems = items.filter(
    item => !item.parentRepairItemId && item.outcomeStatus !== 'deleted'
  )

  // For groups, derive outcome from children since groups don't have outcome_status set directly
  const isDecided = (status: string | null | undefined) =>
    status === 'authorised' || status === 'declined' || status === 'deferred'

  // Check if an item has red/amber check results (needs authorization)
  const hasRedAmberResults = (item: NewRepairItem): boolean => {
    if (item.checkResults && item.checkResults.length > 0) {
      return item.checkResults.some(cr => cr.ragStatus === 'red' || cr.ragStatus === 'amber')
    }
    return false
  }

  // An item is in the auth flow if it has red/amber findings OR is a group with children that do
  // Items with only green/no check results are OK items, not in auth flow
  const isItemInAuthFlow = (item: NewRepairItem): boolean => {
    // Items with a decided outcome are always in auth flow
    if (isDecided(item.outcomeStatus)) return true
    // Non-group items: check their own check results
    if (!item.isGroup) return hasRedAmberResults(item)
    // Groups: in auth flow if they have red/amber results or children with them
    if (hasRedAmberResults(item)) return true
    if (item.children && item.children.length > 0) {
      return item.children.some(c => isDecided(c.outcomeStatus) || c.outcomeStatus === 'ready' || c.outcomeStatus === 'incomplete')
    }
    return false
  }

  const getEffectiveOutcome = (item: NewRepairItem): string | null => {
    // If the item itself has an outcome, use it
    if (isDecided(item.outcomeStatus)) return item.outcomeStatus!

    // For groups, derive from children
    if (item.isGroup && item.children && item.children.length > 0) {
      const activeChildren = item.children.filter(c => isDecided(c.outcomeStatus) || c.outcomeStatus === 'ready' || c.outcomeStatus === 'incomplete')
      if (activeChildren.length > 0 && activeChildren.every(c => isDecided(c.outcomeStatus))) {
        if (activeChildren.some(c => c.outcomeStatus === 'authorised')) return 'authorised'
        if (activeChildren.some(c => c.outcomeStatus === 'deferred')) return 'deferred'
        return 'declined'
      }
      // Group with no active children = green group
      if (activeChildren.length === 0) return null
    }

    // Not in auth flow = green/OK item
    if (!isItemInAuthFlow(item)) return null

    return item.outcomeStatus || null
  }

  // Items need a decision only if they're in the auth flow
  const itemsNeedingDecision = visibleItems.filter(item => {
    if (!isItemInAuthFlow(item)) return false
    const effective = getEffectiveOutcome(item)
    // null = green/OK item, not in auth flow
    if (effective === null) return false
    return true
  })

  const allDecided = itemsNeedingDecision.every(item => isDecided(getEffectiveOutcome(item)))

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
      case null:
      case undefined:
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600">OK</span>
      default:
        return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Not decided</span>
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl shadow-xl rounded-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Record Customer Authorisation</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="p-6 overflow-y-auto flex-1">
          {loadingItems ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <span className="ml-3 text-sm text-gray-500">Loading item decisions...</span>
            </div>
          ) : success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-medium text-gray-900">Authorisation Recorded</p>
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
                    <p className="text-sm mt-1">Close this modal and use the Authorise / Decline / Defer buttons on each repair item before recording authorisation.</p>
                  </div>
                </div>
              )}

              {/* Authorisation Method */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">How was this authorised?</h3>
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
                      {outcomeBadge(getEffectiveOutcome(item))}
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
        {!success && !loadingItems && (
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
              {saving ? 'Saving...' : 'Record Authorisation'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
