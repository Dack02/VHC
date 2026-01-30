import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { HealthCheck, CheckResult, api, NewRepairItem } from '../../lib/api'

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
  newRepairItems?: NewRepairItem[]
  checkResults?: CheckResult[]
  onClose: () => void
  onSend: () => void
}

// Derive RAG status for an item (groups get highest severity from children)
function deriveRagStatus(item: NewRepairItem): 'red' | 'amber' | null {
  // For groups, derive from children's checkResults
  if (item.isGroup && item.children && item.children.length > 0) {
    let highestSeverity: 'red' | 'amber' | null = null
    for (const child of item.children) {
      const childRag = child.checkResults?.[0]?.ragStatus as 'red' | 'amber' | null
      if (childRag === 'red') return 'red'
      if (childRag === 'amber') highestSeverity = 'amber'
    }
    return highestSeverity
  }

  // For individual items, use direct ragStatus or derive from checkResults
  if (item.ragStatus) return item.ragStatus as 'red' | 'amber' | null
  return item.checkResults?.[0]?.ragStatus as 'red' | 'amber' | null
}

export function CustomerPreviewModal({ healthCheck, newRepairItems, checkResults, onClose, onSend }: CustomerPreviewModalProps) {
  const { session } = useAuth()
  const vehicle = healthCheck.vehicle
  const customer = healthCheck.vehicle?.customer

  // Track reasons for each check result
  const [reasonsByCheckResult, setReasonsByCheckResult] = useState<Record<string, SelectedReason[]>>({})
  const [loadingReasons, setLoadingReasons] = useState(false)
  const fetchedRef = useRef(false)

  // Get green items from check results
  const greenResults = useMemo(() => checkResults?.filter(r => r.rag_status === 'green') || [], [checkResults])

  // Get photos grouped by finding (only include_in_report photos)
  const photosGroupedByFinding = useMemo(() => {
    const groups: Array<{
      findingName: string
      ragStatus: 'red' | 'amber' | 'green'
      photos: Array<{ id: string; url: string; thumbnailUrl: string | null; caption: string | null }>
    }> = []

    for (const result of checkResults || []) {
      const photos = (result.media || [])
        .filter(m => m.include_in_report !== false)
        .map(m => ({
          id: m.id,
          url: m.url,
          thumbnailUrl: m.thumbnail_url,
          caption: m.caption || null
        }))

      if (photos.length > 0) {
        groups.push({
          findingName: result.template_item?.name || 'Unknown Item',
          ragStatus: result.rag_status as 'red' | 'amber' | 'green',
          photos
        })
      }
    }

    return groups
  }, [checkResults])

  const hasPhotos = photosGroupedByFinding.length > 0

  // Filter top-level new repair items (those without a parent)
  const topLevelNewRepairItems = useMemo(() =>
    (newRepairItems || []).filter(item => !item.parentRepairItemId),
    [newRepairItems]
  )

  // Categorize items by RAG status
  const categorizedItems = useMemo(() => {
    const urgentItems: NewRepairItem[] = []
    const advisoryItems: NewRepairItem[] = []

    for (const item of topLevelNewRepairItems) {
      const rag = deriveRagStatus(item)
      if (rag === 'red') urgentItems.push(item)
      else if (rag === 'amber') advisoryItems.push(item)
    }

    return { urgentItems, advisoryItems }
  }, [topLevelNewRepairItems])

  // Calculate totals for repair items (only urgent + advisory), option-aware
  const repairItemsTotals = useMemo(() => {
    const allItems = [...categorizedItems.urgentItems, ...categorizedItems.advisoryItems]
    let subtotal = 0
    let vatAmount = 0
    let totalIncVat = 0

    for (const item of allItems) {
      const hasOptions = item.options && item.options.length > 0
      if (hasOptions && item.selectedOptionId) {
        const opt = item.options!.find(o => o.id === item.selectedOptionId)
        if (opt) {
          subtotal += opt.subtotal
          vatAmount += opt.vatAmount
          totalIncVat += opt.totalIncVat
          continue
        }
      }
      if (hasOptions) {
        const opt = item.options!.find(o => o.isRecommended) || item.options![0]
        subtotal += opt.subtotal
        vatAmount += opt.vatAmount
        totalIncVat += opt.totalIncVat
      } else {
        subtotal += item.subtotal
        vatAmount += item.vatAmount
        totalIncVat += item.totalIncVat
      }
    }

    return { subtotal, vatAmount, totalIncVat }
  }, [categorizedItems])

  // Memoize check result IDs to create stable dependency
  const checkResultIdsKey = useMemo(() => {
    const ids: string[] = []
    // Get IDs from children's checkResults (since groups don't have direct check results)
    for (const item of topLevelNewRepairItems) {
      if (item.children) {
        for (const child of item.children) {
          if (child.checkResults) {
            for (const cr of child.checkResults) {
              ids.push(cr.id)
            }
          }
        }
      }
      // Also get from item's own checkResults if it has them
      if (item.checkResults) {
        for (const cr of item.checkResults) {
          ids.push(cr.id)
        }
      }
    }
    // Add green results
    greenResults.forEach(r => ids.push(r.id))
    return [...new Set(ids)].sort().join(',')
  }, [topLevelNewRepairItems, greenResults])

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

  // Get reasons for a new repair item (from its children's check results)
  const getReasonsForNewItem = (item: NewRepairItem): SelectedReason[] => {
    const reasons: SelectedReason[] = []

    // Get reasons from children's check results
    if (item.children) {
      for (const child of item.children) {
        if (child.checkResults) {
          for (const cr of child.checkResults) {
            const crReasons = reasonsByCheckResult[cr.id] || []
            reasons.push(...crReasons)
          }
        }
      }
    }

    // Also get from item's own checkResults
    if (item.checkResults) {
      for (const cr of item.checkResults) {
        const crReasons = reasonsByCheckResult[cr.id] || []
        reasons.push(...crReasons)
      }
    }

    return reasons
  }

  const hasRepairItems = categorizedItems.urgentItems.length > 0 || categorizedItems.advisoryItems.length > 0

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

          {/* Urgent Items */}
          {categorizedItems.urgentItems.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-red-700 mb-3 flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-red-500" />
                Urgent Attention Required
              </h3>
              <div className="space-y-3">
                {categorizedItems.urgentItems.map(item => (
                  <RepairItemCard
                    key={item.id}
                    item={item}
                    ragStatus="red"
                    reasons={getReasonsForNewItem(item)}
                    formatFollowUp={formatFollowUp}
                    reasonsByCheckResult={reasonsByCheckResult}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Advisory Items */}
          {categorizedItems.advisoryItems.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-amber-700 mb-3 flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-amber-500" />
                Advisory Items
              </h3>
              <div className="space-y-3">
                {categorizedItems.advisoryItems.map(item => (
                  <RepairItemCard
                    key={item.id}
                    item={item}
                    ragStatus="amber"
                    reasons={getReasonsForNewItem(item)}
                    formatFollowUp={formatFollowUp}
                    reasonsByCheckResult={reasonsByCheckResult}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Totals */}
          {hasRepairItems && (
            <div className="bg-gray-100 border border-gray-300 p-4 mt-4">
              <div className="flex justify-between mb-2 text-sm">
                <span className="text-gray-600">Subtotal (ex VAT)</span>
                <span className="font-medium">£{repairItemsTotals.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between mb-2 text-sm">
                <span className="text-gray-600">VAT (20%)</span>
                <span className="font-medium">£{repairItemsTotals.vatAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t border-gray-300 pt-2 mt-2">
                <span>Total Inc VAT</span>
                <span>£{repairItemsTotals.totalIncVat.toFixed(2)}</span>
              </div>
            </div>
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

          {!hasRepairItems && greenResults.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p className="text-lg font-medium text-green-600 mb-2">All Clear!</p>
              <p>Your vehicle has passed all inspection points.</p>
            </div>
          )}

          {/* Photo Evidence Section */}
          {hasPhotos && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Photo Evidence
              </h3>
              <div className="space-y-4">
                {photosGroupedByFinding.map((group, idx) => (
                  <div key={idx} className="border border-gray-200">
                    {/* Finding header */}
                    <div className={`px-3 py-2 flex items-center gap-2 ${
                      group.ragStatus === 'red' ? 'bg-red-50 border-b border-red-200' :
                      group.ragStatus === 'amber' ? 'bg-amber-50 border-b border-amber-200' :
                      'bg-green-50 border-b border-green-200'
                    }`}>
                      <span className={`w-3 h-3 rounded-full ${
                        group.ragStatus === 'red' ? 'bg-red-500' :
                        group.ragStatus === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                      }`} />
                      <span className="font-medium text-gray-900 text-sm">{group.findingName}</span>
                    </div>
                    {/* Photos grid - max 4 per row */}
                    <div className="p-3 grid grid-cols-4 gap-2">
                      {group.photos.map(photo => (
                        <div key={photo.id} className="aspect-square bg-gray-100 overflow-hidden">
                          <img
                            src={photo.thumbnailUrl || photo.url}
                            alt={photo.caption || group.findingName}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
 * Repair Item Card - unified display for urgent/advisory items
 */
interface RepairItemCardProps {
  item: NewRepairItem
  ragStatus: 'red' | 'amber'
  reasons: SelectedReason[]
  formatFollowUp: (days?: number, text?: string) => string | null
  reasonsByCheckResult: Record<string, SelectedReason[]>
}

function RepairItemCard({ item, ragStatus, reasons, formatFollowUp, reasonsByCheckResult }: RepairItemCardProps) {
  const borderColor = ragStatus === 'red' ? 'border-l-red-500' : 'border-l-amber-500'
  const bgColor = ragStatus === 'red' ? 'bg-red-50' : 'bg-amber-50'
  const bulletColor = ragStatus === 'red' ? 'text-red-400' : 'text-amber-400'
  const followUpColor = ragStatus === 'red' ? 'text-red-600' : 'text-amber-600'

  const hasReasons = reasons.length > 0
  const followUpInfo = reasons.find(r => r.followUpDays || r.followUpText)

  // Derive display price from options (selected > recommended > first) or base item
  const hasOptions = item.options && item.options.length > 0
  const selectedOption = hasOptions && item.selectedOptionId
    ? item.options!.find(o => o.id === item.selectedOptionId)
    : null
  const displayOption = selectedOption
    || (hasOptions ? item.options!.find(o => o.isRecommended) || item.options![0] : null)
  const displayPrice = displayOption || item

  return (
    <div className={`${bgColor} border border-gray-200 border-l-4 ${borderColor} p-4`}>
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{item.name}</span>
            {item.isGroup && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700">
                GROUP
              </span>
            )}
          </div>

          {/* Show reasons or description (skip reasons for groups - shown in children section) */}
          {!item.isGroup && hasReasons ? (
            <div className="mt-2">
              {reasons.length > 1 && (
                <div className="text-sm text-gray-700 mb-2">
                  {ragStatus === 'red' ? 'We identified the following issues:' : 'We identified the following items to monitor:'}
                </div>
              )}
              <ul className="space-y-1">
                {reasons.map((reason) => (
                  <li key={reason.id} className="text-sm text-gray-600 flex gap-2">
                    {reasons.length > 1 && (
                      <span className={bulletColor}>&bull;</span>
                    )}
                    <span>{reason.customerDescription || reason.reasonText}</span>
                  </li>
                ))}
              </ul>
              {followUpInfo && (
                <div className={`mt-2 text-sm ${followUpColor} font-medium`}>
                  {formatFollowUp(followUpInfo.followUpDays, followUpInfo.followUpText)}
                </div>
              )}
            </div>
          ) : item.description && (
            <div className="text-sm text-gray-600 mt-1">{item.description}</div>
          )}

          {/* Options list */}
          {hasOptions && (
            <div className="mt-3 space-y-1">
              {item.options!.map(opt => (
                <div
                  key={opt.id}
                  className={`flex items-center justify-between text-sm p-2 border ${
                    opt.id === item.selectedOptionId
                      ? 'border-blue-300 bg-blue-50'
                      : opt.isRecommended
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-800">{opt.name}</span>
                    {opt.isRecommended && (
                      <span className="text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5">
                        Recommended
                      </span>
                    )}
                    {opt.id === item.selectedOptionId && (
                      <span className="text-xs font-medium text-blue-700 bg-blue-100 px-1.5 py-0.5">
                        Selected
                      </span>
                    )}
                  </div>
                  <span className="font-medium text-gray-900">£{opt.totalIncVat.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Nested children for groups */}
          {item.isGroup && item.children && item.children.length > 0 && (
            <div className="mt-3 p-3 bg-purple-50 border-l-2 border-purple-400">
              <div className="text-xs font-semibold text-purple-700 uppercase mb-2">
                Grouped Items ({item.children.length})
              </div>
              <div className="space-y-1">
                {item.children.map(child => {
                  const childRag = child.checkResults?.[0]?.ragStatus
                  // Get reasons for this child's check results
                  const childReasons = (child.checkResults || []).flatMap(cr =>
                    reasonsByCheckResult[cr.id] || []
                  )
                  const childDescription = childReasons[0]?.customerDescription || childReasons[0]?.reasonText

                  return (
                    <div key={child.id} className="flex items-start gap-2 text-sm">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
                        childRag === 'red' ? 'bg-red-500' :
                        childRag === 'amber' ? 'bg-amber-500' : 'bg-gray-400'
                      }`} />
                      <div>
                        <span className="text-gray-700">{child.name}</span>
                        {childDescription && (
                          <span className="text-gray-500 ml-1">- {childDescription}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-bold text-gray-900">£{displayPrice.totalIncVat.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Inc VAT</div>
          <div className="text-xs text-gray-400 mt-1">
            (£{displayPrice.subtotal.toFixed(2)} + £{displayPrice.vatAmount.toFixed(2)} VAT)
          </div>
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
