import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { HealthCheck, RepairItem, CheckResult, api } from '../../lib/api'

// Type for selected reasons
interface SelectedReason {
  id: string
  reasonText: string
  customerDescription?: string
  followUpDays?: number
  followUpText?: string
}

interface CustomerPreviewModalProps {
  healthCheck: HealthCheck
  repairItems: RepairItem[]
  checkResults?: CheckResult[]
  onClose: () => void
  onSend: () => void
}

export function CustomerPreviewModal({ healthCheck, repairItems, checkResults, onClose, onSend }: CustomerPreviewModalProps) {
  const { session } = useAuth()
  const vehicle = healthCheck.vehicle
  const customer = healthCheck.vehicle?.customer

  // Track reasons for each check result
  const [reasonsByCheckResult, setReasonsByCheckResult] = useState<Record<string, SelectedReason[]>>({})
  const [loadingReasons, setLoadingReasons] = useState(false)
  const fetchedRef = useRef(false)

  // Only show visible items to customer
  const visibleItems = useMemo(() => repairItems.filter(item => item.is_visible), [repairItems])
  const redItems = useMemo(() => visibleItems.filter(item => item.rag_status === 'red'), [visibleItems])
  const amberItems = useMemo(() => visibleItems.filter(item => item.rag_status === 'amber'), [visibleItems])

  // Get green items from check results
  const greenResults = useMemo(() => checkResults?.filter(r => r.rag_status === 'green') || [], [checkResults])

  const totalParts = visibleItems.reduce((sum, i) => sum + i.parts_cost, 0)
  const totalLabour = visibleItems.reduce((sum, i) => sum + i.labor_cost, 0)
  const totalAmount = totalParts + totalLabour

  // Memoize check result IDs to create stable dependency
  const checkResultIdsKey = useMemo(() => {
    const ids: string[] = []
    visibleItems.forEach(item => {
      if (item.check_result_id) ids.push(item.check_result_id)
    })
    greenResults.forEach(r => ids.push(r.id))
    return [...new Set(ids)].sort().join(',')
  }, [visibleItems, greenResults])

  // Fetch reasons ONCE when modal opens
  useEffect(() => {
    // Skip if already fetched or no IDs
    if (fetchedRef.current || !session?.accessToken || !checkResultIdsKey) return

    const uniqueIds = checkResultIdsKey.split(',').filter(Boolean)
    if (uniqueIds.length === 0) {
      setReasonsByCheckResult({})
      return
    }

    fetchedRef.current = true
    setLoadingReasons(true)

    const fetchReasons = async () => {
      try {
        const data = await api<{ reasonsByCheckResult: Record<string, SelectedReason[]> }>(
          `/api/v1/check-results/batch-reasons`,
          {
            token: session.accessToken,
            method: 'POST',
            body: { checkResultIds: uniqueIds }
          }
        )
        setReasonsByCheckResult(data.reasonsByCheckResult || {})
      } catch {
        setReasonsByCheckResult({})
      }
      setLoadingReasons(false)
    }

    fetchReasons()
  }, [session?.accessToken, checkResultIdsKey])

  // Format follow-up text
  const formatFollowUp = (days?: number, text?: string) => {
    if (text) return text
    if (!days) return null
    if (days <= 7) return 'Recommend addressing within 1 week'
    if (days <= 30) return 'Recommend addressing within 1 month'
    if (days <= 90) return 'Recommend addressing within 3 months'
    if (days <= 180) return 'Recommend addressing within 6 months'
    return `Recommend addressing within ${Math.round(days / 30)} months`
  }

  // Get reasons for a repair item
  const getReasonsForItem = (item: RepairItem): SelectedReason[] => {
    if (!item.check_result_id) return []
    return reasonsByCheckResult[item.check_result_id] || []
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Customer Preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="text-center text-sm text-gray-500 mb-4 bg-yellow-50 p-2 border border-yellow-200">
            This is how the customer will see their health check report
          </div>

          {/* Header section */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Vehicle Health Check</h1>
            <p className="text-gray-600">
              {vehicle?.make} {vehicle?.model} - {vehicle?.registration}
            </p>
            {customer && (
              <p className="text-gray-500">
                Prepared for {customer.first_name} {customer.last_name}
              </p>
            )}
          </div>

          {/* RAG Summary */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="text-center p-4 bg-green-50 border border-green-200">
              <div className="text-3xl font-bold text-green-600">{healthCheck.green_count}</div>
              <div className="text-sm text-green-700">Passed</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 border border-yellow-200">
              <div className="text-3xl font-bold text-yellow-600">{healthCheck.amber_count}</div>
              <div className="text-sm text-yellow-700">Advisory</div>
            </div>
            <div className="text-center p-4 bg-red-50 border border-red-200">
              <div className="text-3xl font-bold text-red-600">{healthCheck.red_count}</div>
              <div className="text-sm text-red-700">Urgent</div>
            </div>
          </div>

          {/* Repair items */}
          {visibleItems.length > 0 && (
            <>
              {/* Urgent Items */}
              {redItems.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-red-700 mb-3 flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-red-500" />
                    Urgent Attention Required
                  </h3>
                  <div className="space-y-3">
                    {redItems.map(item => {
                      const reasons = getReasonsForItem(item)
                      const hasReasons = reasons.length > 0
                      const followUpInfo = reasons.find(r => r.followUpDays || r.followUpText)

                      return (
                        <div key={item.id} className="bg-red-50 border border-red-200 p-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">{item.title}</div>

                              {/* Show reasons or description */}
                              {hasReasons ? (
                                <div className="mt-2">
                                  {reasons.length > 1 && (
                                    <div className="text-sm text-gray-700 mb-2">
                                      We identified the following issues:
                                    </div>
                                  )}
                                  <ul className="space-y-1">
                                    {reasons.map((reason) => (
                                      <li key={reason.id} className="text-sm text-gray-600 flex gap-2">
                                        {reasons.length > 1 && (
                                          <span className="text-red-400">&bull;</span>
                                        )}
                                        <span>{reason.customerDescription || reason.reasonText}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  {followUpInfo && (
                                    <div className="mt-2 text-sm text-red-600 font-medium">
                                      {formatFollowUp(followUpInfo.followUpDays, followUpInfo.followUpText)}
                                    </div>
                                  )}
                                </div>
                              ) : item.description && (
                                <div className="text-sm text-gray-600 mt-1">{item.description}</div>
                              )}
                            </div>
                            <div className="text-right ml-4">
                              <div className="font-bold text-gray-900">£{item.total_price.toFixed(2)}</div>
                              <div className="text-xs text-gray-500">
                                Parts: £{item.parts_cost.toFixed(2)} | Labour: £{item.labor_cost.toFixed(2)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Advisory Items */}
              {amberItems.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-yellow-500" />
                    Advisory Items
                  </h3>
                  <div className="space-y-3">
                    {amberItems.map(item => {
                      const reasons = getReasonsForItem(item)
                      const hasReasons = reasons.length > 0
                      const followUpInfo = reasons.find(r => r.followUpDays || r.followUpText)

                      return (
                        <div key={item.id} className="bg-yellow-50 border border-yellow-200 p-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">{item.title}</div>

                              {/* Show reasons or description */}
                              {hasReasons ? (
                                <div className="mt-2">
                                  {reasons.length > 1 && (
                                    <div className="text-sm text-gray-700 mb-2">
                                      We identified the following items to monitor:
                                    </div>
                                  )}
                                  <ul className="space-y-1">
                                    {reasons.map((reason) => (
                                      <li key={reason.id} className="text-sm text-gray-600 flex gap-2">
                                        {reasons.length > 1 && (
                                          <span className="text-amber-400">&bull;</span>
                                        )}
                                        <span>{reason.customerDescription || reason.reasonText}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  {followUpInfo && (
                                    <div className="mt-2 text-sm text-amber-600 font-medium">
                                      {formatFollowUp(followUpInfo.followUpDays, followUpInfo.followUpText)}
                                    </div>
                                  )}
                                </div>
                              ) : item.description && (
                                <div className="text-sm text-gray-600 mt-1">{item.description}</div>
                              )}
                            </div>
                            <div className="text-right ml-4">
                              <div className="font-bold text-gray-900">£{item.total_price.toFixed(2)}</div>
                              <div className="text-xs text-gray-500">
                                Parts: £{item.parts_cost.toFixed(2)} | Labour: £{item.labor_cost.toFixed(2)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Total */}
              <div className="bg-gray-100 border border-gray-300 p-4">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-600">Parts Total</span>
                  <span className="font-medium">£{totalParts.toFixed(2)}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-600">Labour Total</span>
                  <span className="font-medium">£{totalLabour.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xl font-bold border-t border-gray-300 pt-2 mt-2">
                  <span>Total</span>
                  <span>£{totalAmount.toFixed(2)}</span>
                </div>
              </div>
            </>
          )}

          {/* Green items - All OK section */}
          {greenResults.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-green-700 mb-3 flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-green-500" />
                All OK
              </h3>
              <div className="bg-green-50 border border-green-200 p-4">
                <GreenItemsPreview
                  results={greenResults}
                  reasonsByCheckResult={reasonsByCheckResult}
                />
              </div>
            </div>
          )}

          {visibleItems.length === 0 && greenResults.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p className="text-lg font-medium text-green-600 mb-2">All Clear!</p>
              <p>Your vehicle has passed all inspection points.</p>
            </div>
          )}

          {loadingReasons && (
            <div className="text-center py-2 text-sm text-gray-500">
              Loading details...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between flex-shrink-0 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-100"
          >
            Close Preview
          </button>
          <button
            onClick={onSend}
            className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark"
          >
            Send to Customer
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Green items preview - collapsible list with positive findings
 */
interface GreenItemsPreviewProps {
  results: CheckResult[]
  reasonsByCheckResult: Record<string, SelectedReason[]>
}

function GreenItemsPreview({ results, reasonsByCheckResult }: GreenItemsPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const initialShowCount = 5
  const hasMore = results.length > initialShowCount

  const displayedResults = expanded
    ? results
    : results.slice(0, initialShowCount)

  return (
    <div>
      <ul className="space-y-1">
        {displayedResults.map((result) => {
          const reasons = reasonsByCheckResult[result.id] || []
          const positiveReason = reasons.find(r => r.customerDescription || r.reasonText)

          return (
            <li key={result.id} className="flex items-start gap-2 text-sm">
              <svg className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-gray-700">
                {result.template_item?.name || 'Unknown Item'}
                {positiveReason && (
                  <span className="text-green-600 ml-1">
                    - {positiveReason.customerDescription || positiveReason.reasonText}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-sm text-green-600 hover:text-green-700"
        >
          {expanded
            ? 'Show less'
            : `Show all ${results.length} items...`
          }
        </button>
      )}
    </div>
  )
}
