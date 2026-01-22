/**
 * HealthCheckTabContent Component
 * RAG-grouped sections view for the advisor health check detail
 * Supports selecting items to create repair groups
 * Supports bulk outcome actions for "ready" items
 */

import { useMemo, useState, useEffect, useCallback } from 'react'
import { CheckResult, RepairItem, TemplateSection, api } from '../../../lib/api'
import { useAuth } from '../../../contexts/AuthContext'
import { SectionHeader, SectionSubheader } from './SectionHeader'
import { RepairItemRow, GreenItemRow } from './RepairItemRow'
import { TyreSetDisplay } from './TyreDisplay'
import { BrakeDisplay } from './BrakeDisplay'
import { SelectedReason } from './ItemReasonsDisplay'
import { SelectionActionBar } from './SelectionActionBar'
import { CreateRepairGroupModal } from './CreateRepairGroupModal'
import { BulkOutcomeActionBar } from './BulkOutcomeActionBar'
import { BulkDeferModal, BulkDeclineModal } from './OutcomeModals'
import { calculateOutcomeStatus, OutcomeStatus } from './OutcomeButton'
import { useToast } from '../../../contexts/ToastContext'

interface HealthCheckTabContentProps {
  healthCheckId: string
  sections: TemplateSection[]  // May be used for grouping in future
  results: CheckResult[]
  repairItems: RepairItem[]
  onUpdate: () => void
  onPhotoClick?: (resultId: string) => void
}

// Interface for selected item info passed to modal
interface SelectedItemInfo {
  checkResultId: string
  name: string
  ragStatus: 'red' | 'amber'
  existingRepairItem?: RepairItem
}

export function HealthCheckTabContent({
  healthCheckId,
  sections: _sections,  // Reserved for future grouping enhancements
  results,
  repairItems,
  onUpdate,
  onPhotoClick
}: HealthCheckTabContentProps) {
  // Silence unused var warning - sections may be used in future for grouping
  void _sections

  const { session } = useAuth()
  const toast = useToast()

  // Selection state for grouping - stores check_result_ids
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Bulk outcome selection state - stores repair_item_ids
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkDeferModal, setShowBulkDeferModal] = useState(false)
  const [showBulkDeclineModal, setShowBulkDeclineModal] = useState(false)
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  // Batch-loaded reasons for all check results
  const [reasonsByCheckResult, setReasonsByCheckResult] = useState<Record<string, SelectedReason[]>>({})
  const [reasonsFetched, setReasonsFetched] = useState(false)

  // Memoize check result IDs to prevent unnecessary re-fetches
  const checkResultIdsKey = useMemo(() => {
    const ids = results.map(r => r.id)
    repairItems.forEach(item => {
      if (item.check_result_id && !ids.includes(item.check_result_id)) {
        ids.push(item.check_result_id)
      }
    })
    return ids.sort().join(',')
  }, [results, repairItems])

  // Batch fetch all reasons ONCE when component mounts or IDs change
  useEffect(() => {
    // Skip if already fetched for these IDs
    if (reasonsFetched || !session?.accessToken || !checkResultIdsKey) return

    const checkResultIds = checkResultIdsKey.split(',').filter(Boolean)
    if (checkResultIds.length === 0) return

    const fetchAllReasons = async () => {
      try {
        const data = await api<{ reasonsByCheckResult: Record<string, SelectedReason[]> }>(
          `/api/v1/check-results/batch-reasons`,
          {
            token: session.accessToken,
            method: 'POST',
            body: { checkResultIds }
          }
        )
        setReasonsByCheckResult(data.reasonsByCheckResult || {})
        setReasonsFetched(true)
      } catch {
        // Silently fail - reasons are optional enhancement
        setReasonsFetched(true) // Mark as fetched to prevent retry loops
      }
    }

    fetchAllReasons()
  }, [session?.accessToken, checkResultIdsKey, reasonsFetched])

  const resultsById = useMemo(() =>
    new Map(results.map(r => [r.id, r])),
    [results]
  )

  // Build children map for groups
  const childrenByParent = useMemo(() => {
    const map = new Map<string, RepairItem[]>()
    repairItems.forEach(item => {
      if (item.parent_repair_item_id) {
        const children = map.get(item.parent_repair_item_id) || []
        children.push(item)
        map.set(item.parent_repair_item_id, children)
      }
    })
    return map
  }, [repairItems])

  // Group repair items by RAG status (exclude children - they're shown in their parent group)
  // Attach children to groups
  const redItems = useMemo(() =>
    repairItems
      .filter(item => item.rag_status === 'red' && !item.parent_repair_item_id)
      .map(item => ({
        ...item,
        children: item.is_group ? childrenByParent.get(item.id) || [] : undefined
      })),
    [repairItems, childrenByParent]
  )

  const amberItems = useMemo(() =>
    repairItems
      .filter(item => item.rag_status === 'amber' && !item.parent_repair_item_id)
      .map(item => ({
        ...item,
        children: item.is_group ? childrenByParent.get(item.id) || [] : undefined
      })),
    [repairItems, childrenByParent]
  )

  // Green items come from results, not repair items
  const greenResults = useMemo(() =>
    results.filter(r => r.rag_status === 'green'),
    [results]
  )

  // Authorised items (approved by customer) - exclude children, they're shown in their parent group
  // Uses customer_approved field on repair_items table
  const authorisedItems = useMemo(() => {
    // Helper to check if item or any of its children are approved
    const hasApproved = (item: RepairItem): boolean => {
      // Check customer_approved field directly on repair item
      if (item.is_approved === true) return true

      // For groups, also check if any children are approved
      if (item.is_group) {
        const children = childrenByParent.get(item.id) || []
        return children.some(child => child.is_approved === true)
      }

      return false
    }

    return repairItems
      .filter(item => !item.parent_repair_item_id && hasApproved(item))
      .map(item => ({
        ...item,
        children: item.is_group ? childrenByParent.get(item.id) || [] : undefined
      }))
  }, [repairItems, childrenByParent])

  // Declined items - exclude children, they're shown in their parent group
  // Uses is_approved=false on repair_items table
  const declinedItems = useMemo(() => {
    // Helper to check if item or any of its children are declined
    const hasDeclined = (item: RepairItem): boolean => {
      // Check is_approved=false (explicitly declined, not just null)
      if (item.is_approved === false) return true

      // For groups, also check if any children are declined
      if (item.is_group) {
        const children = childrenByParent.get(item.id) || []
        return children.some(child => child.is_approved === false)
      }

      return false
    }

    return repairItems
      .filter(item => !item.parent_repair_item_id && hasDeclined(item))
      .map(item => ({
        ...item,
        children: item.is_group ? childrenByParent.get(item.id) || [] : undefined
      }))
  }, [repairItems, childrenByParent])

  // Calculate totals
  const redTotal = redItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const amberTotal = amberItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const authorisedTotal = authorisedItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const authorisedCompletedTotal = authorisedItems
    .filter(item => item.work_completed_at)
    .reduce((sum, item) => sum + (item.total_price || 0), 0)

  // Group green results by section
  const greenResultsBySection = useMemo(() => {
    const grouped = new Map<string, { section: TemplateSection; results: CheckResult[] }>()

    greenResults.forEach(result => {
      const section = result.template_item?.section
      if (section) {
        if (!grouped.has(section.id)) {
          grouped.set(section.id, {
            section: { ...section, items: [] } as TemplateSection,
            results: []
          })
        }
        grouped.get(section.id)!.results.push(result)
      }
    })

    // Sort by section order
    return Array.from(grouped.values()).sort(
      (a, b) => a.section.sort_order - b.section.sort_order
    )
  }, [greenResults])

  // Helper to get result for a repair item
  const getResultForRepairItem = (item: RepairItem): CheckResult | null => {
    if (item.check_result_id) {
      return resultsById.get(item.check_result_id) || null
    }
    return null
  }

  // Helper to check if an item is a tyre item (depth or details)
  const isTyreItem = (result: CheckResult | null): boolean => {
    const itemType = result?.template_item?.item_type
    return itemType === 'tyre_depth' || itemType === 'tyre_details'
  }

  // Helper to check if an item is a brake item
  const isBrakeItem = (result: CheckResult | null): boolean => {
    return result?.template_item?.item_type === 'brake_measurement'
  }

  // Helper to render special displays for tyre/brake items
  // Now rendered inside expanded sections, so no outer padding needed
  const renderSpecialDisplay = (result: CheckResult | null) => {
    if (!result) return null

    if (isTyreItem(result) && result.value) {
      return <TyreSetDisplay data={result.value as any} ragStatus={result.rag_status} />
    }

    if (isBrakeItem(result) && result.value) {
      return <BrakeDisplay data={result.value as any} ragStatus={result.rag_status} />
    }

    return null
  }

  // Selection handlers
  const toggleSelection = useCallback((checkResultId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(checkResultId)) {
        next.delete(checkResultId)
      } else {
        next.add(checkResultId)
      }
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // Build selected items info for the modal
  const selectedItems = useMemo((): SelectedItemInfo[] => {
    const items: SelectedItemInfo[] = []

    selectedIds.forEach(checkResultId => {
      // Find matching repair item or result
      const repairItem = repairItems.find(ri => ri.check_result_id === checkResultId)
      const result = resultsById.get(checkResultId)

      if (result) {
        items.push({
          checkResultId,
          name: result.template_item?.name || 'Unknown Item',
          ragStatus: result.rag_status as 'red' | 'amber',
          existingRepairItem: repairItem
        })
      }
    })

    return items
  }, [selectedIds, repairItems, resultsById])

  const handleCreateGroupSuccess = () => {
    setShowCreateModal(false)
    clearSelection()
    onUpdate()
  }

  const handleUngroup = async (itemId: string) => {
    if (!session?.accessToken) return
    if (!confirm('Are you sure you want to ungroup these items? They will become individual repair items again.')) return

    try {
      await api(`/api/v1/repair-items/${itemId}/ungroup`, {
        method: 'POST',
        token: session.accessToken
      })
      onUpdate()
    } catch (err) {
      console.error('Failed to ungroup:', err)
    }
  }

  // ==========================================================================
  // BULK OUTCOME SELECTION
  // ==========================================================================

  // Calculate outcome status for each repair item (for determining "ready" items)
  const repairItemOutcomes = useMemo(() => {
    const outcomes: Map<string, OutcomeStatus> = new Map()

    // Process all red and amber items (top-level only, not children)
    const allItems = [...redItems, ...amberItems]
    allItems.forEach(item => {
      const status = calculateOutcomeStatus({
        deleted_at: item.deleted_at,
        outcome_status: item.outcome_status,
        is_approved: item.is_approved, // Legacy field for backward compatibility
        labour_status: item.labour_status,
        parts_status: item.parts_status,
        no_labour_required: item.no_labour_required,
        no_parts_required: item.no_parts_required
      })
      outcomes.set(item.id, status)
    })

    return outcomes
  }, [redItems, amberItems])

  // Get list of "ready" repair item IDs (selectable for bulk actions)
  const readyItemIds = useMemo(() => {
    const ids: string[] = []
    repairItemOutcomes.forEach((status, id) => {
      if (status === 'ready') {
        ids.push(id)
      }
    })
    return ids
  }, [repairItemOutcomes])

  // Calculate pending outcome stats (for completion indicator)
  const pendingOutcomeStats = useMemo(() => {
    let incompleteCount = 0
    let readyCount = 0
    let actionedCount = 0

    repairItemOutcomes.forEach((status) => {
      if (status === 'incomplete') incompleteCount++
      else if (status === 'ready') readyCount++
      else if (['authorised', 'deferred', 'declined', 'deleted'].includes(status)) actionedCount++
    })

    const totalPending = incompleteCount + readyCount
    const totalItems = incompleteCount + readyCount + actionedCount

    return {
      incompleteCount,
      readyCount,
      actionedCount,
      totalPending,
      totalItems,
      canComplete: totalPending === 0
    }
  }, [repairItemOutcomes])

  // Check if all ready items are selected
  const allReadySelected = readyItemIds.length > 0 &&
    readyItemIds.every(id => bulkSelectedIds.has(id))

  // Check if some (but not all) ready items are selected
  const someReadySelected = readyItemIds.some(id => bulkSelectedIds.has(id)) && !allReadySelected

  // Toggle bulk selection for a single item
  const toggleBulkSelection = useCallback((repairItemId: string) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(repairItemId)) {
        next.delete(repairItemId)
      } else {
        next.add(repairItemId)
      }
      return next
    })
  }, [])

  // Select/Deselect all ready items
  const toggleSelectAllReady = useCallback(() => {
    if (allReadySelected) {
      // Deselect all
      setBulkSelectedIds(new Set())
    } else {
      // Select all ready items
      setBulkSelectedIds(new Set(readyItemIds))
    }
  }, [allReadySelected, readyItemIds])

  // Clear bulk selection
  const clearBulkSelection = useCallback(() => {
    setBulkSelectedIds(new Set())
  }, [])

  // Bulk Authorise handler
  const handleBulkAuthorise = async () => {
    if (!session?.accessToken || bulkSelectedIds.size === 0) return

    setBulkActionLoading(true)
    try {
      const repairItemIds = Array.from(bulkSelectedIds)
      await api('/api/v1/repair-items/bulk-authorise', {
        method: 'POST',
        token: session.accessToken,
        body: { repair_item_ids: repairItemIds }
      })

      toast.success(`${repairItemIds.length} item${repairItemIds.length !== 1 ? 's' : ''} authorised`)
      clearBulkSelection()
      onUpdate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to authorise items')
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Bulk Defer handler
  const handleBulkDefer = async (deferredUntil: string, notes: string) => {
    if (!session?.accessToken || bulkSelectedIds.size === 0) return

    setBulkActionLoading(true)
    try {
      const repairItemIds = Array.from(bulkSelectedIds)
      await api('/api/v1/repair-items/bulk-defer', {
        method: 'POST',
        token: session.accessToken,
        body: {
          repair_item_ids: repairItemIds,
          deferred_until: deferredUntil,
          notes: notes || undefined
        }
      })

      toast.success(`${repairItemIds.length} item${repairItemIds.length !== 1 ? 's' : ''} deferred`)
      clearBulkSelection()
      onUpdate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to defer items')
      throw err // Re-throw for modal to handle
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Bulk Decline handler
  const handleBulkDecline = async (declinedReasonId: string, notes: string) => {
    if (!session?.accessToken || bulkSelectedIds.size === 0) return

    setBulkActionLoading(true)
    try {
      const repairItemIds = Array.from(bulkSelectedIds)
      await api('/api/v1/repair-items/bulk-decline', {
        method: 'POST',
        token: session.accessToken,
        body: {
          repair_item_ids: repairItemIds,
          declined_reason_id: declinedReasonId,
          notes: notes || undefined
        }
      })

      toast.success(`${repairItemIds.length} item${repairItemIds.length !== 1 ? 's' : ''} declined`)
      clearBulkSelection()
      onUpdate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to decline items')
      throw err // Re-throw for modal to handle
    } finally {
      setBulkActionLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Pending Outcome Status Indicator */}
      {pendingOutcomeStats.totalItems > 0 && (
        <div className={`rounded-lg px-4 py-3 flex items-center justify-between ${
          pendingOutcomeStats.canComplete
            ? 'bg-green-50 border border-green-200'
            : 'bg-amber-50 border border-amber-200'
        }`}>
          <div className="flex items-center gap-3">
            {pendingOutcomeStats.canComplete ? (
              <>
                <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-green-800">
                  All items actioned - Ready to close
                </span>
              </>
            ) : (
              <>
                <div className="w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {pendingOutcomeStats.totalPending}
                </div>
                <div>
                  <span className="text-sm font-medium text-amber-800">
                    {pendingOutcomeStats.totalPending} item{pendingOutcomeStats.totalPending !== 1 ? 's' : ''} need an outcome
                  </span>
                  <div className="text-xs text-amber-600">
                    {pendingOutcomeStats.incompleteCount > 0 && (
                      <span>{pendingOutcomeStats.incompleteCount} incomplete (add L&P)</span>
                    )}
                    {pendingOutcomeStats.incompleteCount > 0 && pendingOutcomeStats.readyCount > 0 && ' • '}
                    {pendingOutcomeStats.readyCount > 0 && (
                      <span>{pendingOutcomeStats.readyCount} ready (awaiting decision)</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="text-sm text-gray-600">
            {pendingOutcomeStats.actionedCount} of {pendingOutcomeStats.totalItems} actioned
          </div>
        </div>
      )}

      {/* Bulk Outcome Select All Bar */}
      {readyItemIds.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={allReadySelected}
              ref={(el) => {
                if (el) el.indeterminate = someReadySelected
              }}
              onChange={toggleSelectAllReady}
              className="w-4 h-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
            />
            <span className="text-sm font-medium text-purple-800">
              Select all ready items ({readyItemIds.length})
            </span>
          </div>
          {bulkSelectedIds.size > 0 && (
            <span className="text-sm text-purple-600">
              {bulkSelectedIds.size} selected
            </span>
          )}
        </div>
      )}

      {/* Immediate Attention (Red) */}
      {redItems.length > 0 && (
        <SectionHeader
          title="Immediate Attention"
          ragStatus="red"
          itemCount={redItems.length}
          totalPrice={redTotal}
        >
          {redItems.map(item => {
            const result = getResultForRepairItem(item)
            const checkResultId = result?.id || item.check_result_id
            const isSelected = checkResultId ? selectedIds.has(checkResultId) : false
            const outcomeStatus = repairItemOutcomes.get(item.id)
            const isReady = outcomeStatus === 'ready'
            const isBulkSelected = bulkSelectedIds.has(item.id)
            return (
              <div key={item.id} className="flex items-start bg-white">
                {/* Selection checkbox - show bulk outcome checkbox for ready items, otherwise grouping checkbox */}
                <div className="flex-shrink-0 flex items-center pl-3 self-stretch">
                  {isReady ? (
                    <input
                      type="checkbox"
                      checked={isBulkSelected}
                      onChange={() => toggleBulkSelection(item.id)}
                      title="Select for bulk outcome action"
                      className="w-4 h-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                    />
                  ) : checkResultId ? (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(checkResultId)}
                      title="Select for grouping"
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <RepairItemRow
                    healthCheckId={healthCheckId}
                    item={item}
                    result={result}
                    onUpdate={onUpdate}
                    onPhotoClick={onPhotoClick}
                    onUngroup={item.is_group && item.children?.length ? () => handleUngroup(item.id) : undefined}
                    preloadedReasons={checkResultId ? reasonsByCheckResult[checkResultId] : undefined}
                    specialDisplay={renderSpecialDisplay(result)}
                  />
                </div>
              </div>
            )
          })}
        </SectionHeader>
      )}

      {/* Advisory (Amber) */}
      {amberItems.length > 0 && (
        <SectionHeader
          title="Advisory"
          ragStatus="amber"
          itemCount={amberItems.length}
          totalPrice={amberTotal}
        >
          {amberItems.map(item => {
            const result = getResultForRepairItem(item)
            const checkResultId = result?.id || item.check_result_id
            const isSelected = checkResultId ? selectedIds.has(checkResultId) : false
            const outcomeStatus = repairItemOutcomes.get(item.id)
            const isReady = outcomeStatus === 'ready'
            const isBulkSelected = bulkSelectedIds.has(item.id)
            return (
              <div key={item.id} className="flex items-start bg-white">
                {/* Selection checkbox - show bulk outcome checkbox for ready items, otherwise grouping checkbox */}
                <div className="flex-shrink-0 flex items-center pl-3 self-stretch">
                  {isReady ? (
                    <input
                      type="checkbox"
                      checked={isBulkSelected}
                      onChange={() => toggleBulkSelection(item.id)}
                      title="Select for bulk outcome action"
                      className="w-4 h-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                    />
                  ) : checkResultId ? (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(checkResultId)}
                      title="Select for grouping"
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <RepairItemRow
                    healthCheckId={healthCheckId}
                    item={item}
                    result={result}
                    onUpdate={onUpdate}
                    onPhotoClick={onPhotoClick}
                    onUngroup={item.is_group && item.children?.length ? () => handleUngroup(item.id) : undefined}
                    preloadedReasons={checkResultId ? reasonsByCheckResult[checkResultId] : undefined}
                    specialDisplay={renderSpecialDisplay(result)}
                  />
                </div>
              </div>
            )
          })}
        </SectionHeader>
      )}

      {/* Items OK (Green) - Collapsed by default */}
      {greenResults.length > 0 && (
        <SectionHeader
          title="Items OK"
          ragStatus="green"
          itemCount={greenResults.length}
          defaultExpanded={false}
          collapsible={true}
        >
          {greenResultsBySection.map(({ section, results: sectionResults }) => (
            <div key={section.id}>
              <SectionSubheader
                title={section.name}
                itemCount={sectionResults.length}
              />
              {sectionResults.map((result) => {
                // Check if this is a tyre or brake item that should show details
                const showDetails = isTyreItem(result) || isBrakeItem(result)

                // Build display name with instance number if duplicate
                // Get all results for this template item and find position
                const sameTemplateResults = sectionResults.filter(
                  r => r.template_item_id === result.template_item_id
                )
                const hasDuplicates = sameTemplateResults.length > 1

                // Use position in sorted list for display (1, 2, 3...) not raw instance_number
                const displayIndex = sameTemplateResults.findIndex(r => r.id === result.id)
                const displayNumber = displayIndex + 1

                const displayName = hasDuplicates
                  ? `${result.template_item?.name || 'Unknown Item'} (${displayNumber})`
                  : result.template_item?.name || 'Unknown Item'

                return (
                  <GreenItemRow
                    key={result.id}
                    title={displayName}
                    notes={result.notes}
                    value={result.value}
                    checkResultId={result.id}
                    preloadedReasons={reasonsByCheckResult[result.id]}
                    specialDisplay={showDetails ? renderSpecialDisplay(result) : undefined}
                  />
                )
              })}
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Authorised Work (Blue) */}
      {authorisedItems.length > 0 && (
        <SectionHeader
          title="Authorised Work"
          ragStatus="blue"
          itemCount={authorisedItems.length}
          totalPrice={authorisedTotal}
        >
          {/* Authorised summary */}
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 flex justify-between text-sm">
            <span className="text-blue-700">
              Work Completed: {authorisedItems.filter(i => i.work_completed_at).length} of {authorisedItems.length}
            </span>
            <span className="text-blue-700 font-medium">
              Completed Value: £{authorisedCompletedTotal.toFixed(2)}
            </span>
          </div>

          {authorisedItems.map(item => {
            const result = getResultForRepairItem(item)
            const checkResultId = result?.id || item.check_result_id
            return (
              <div key={item.id}>
                <RepairItemRow
                  healthCheckId={healthCheckId}
                  item={item}
                  result={result}
                  showWorkComplete={true}
                  onUpdate={onUpdate}
                  onPhotoClick={onPhotoClick}
                  onUngroup={item.is_group && item.children?.length ? () => handleUngroup(item.id) : undefined}
                  preloadedReasons={checkResultId ? reasonsByCheckResult[checkResultId] : undefined}
                />
              </div>
            )
          })}
        </SectionHeader>
      )}

      {/* Declined (Grey) */}
      {declinedItems.length > 0 && (
        <SectionHeader
          title="Declined"
          ragStatus="grey"
          itemCount={declinedItems.length}
          collapsible={true}
          defaultExpanded={false}
        >
          {declinedItems.map(item => (
            <div
              key={item.id}
              className="px-4 py-3 border-b border-gray-200 last:border-b-0 bg-white"
            >
              <div className="flex items-center gap-3">
                {/* Declined icon */}
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>

                {/* Item name */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-600 line-through">{item.title}</span>
                </div>

                {/* Original price */}
                <div className="text-sm text-gray-400">
                  £{(item.total_price || 0).toFixed(2)}
                </div>
              </div>
              {item.description && (
                <div className="ml-7 text-xs text-gray-400 mt-1">{item.description}</div>
              )}
            </div>
          ))}
        </SectionHeader>
      )}

      {/* No items message */}
      {redItems.length === 0 && amberItems.length === 0 && greenResults.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
          No inspection results available
        </div>
      )}

      {/* Selection action bar (for grouping) */}
      <SelectionActionBar
        selectedCount={selectedIds.size}
        onCreateGroup={() => setShowCreateModal(true)}
        onClearSelection={clearSelection}
      />

      {/* Bulk Outcome action bar (for authorise/defer/decline) */}
      <BulkOutcomeActionBar
        selectedCount={bulkSelectedIds.size}
        onAuthoriseAll={handleBulkAuthorise}
        onDeferAll={() => setShowBulkDeferModal(true)}
        onDeclineAll={() => setShowBulkDeclineModal(true)}
        onClearSelection={clearBulkSelection}
        loading={bulkActionLoading}
      />

      {/* Create repair group modal */}
      {showCreateModal && selectedItems.length > 0 && (
        <CreateRepairGroupModal
          healthCheckId={healthCheckId}
          selectedItems={selectedItems}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateGroupSuccess}
        />
      )}

      {/* Bulk Defer modal */}
      <BulkDeferModal
        isOpen={showBulkDeferModal}
        itemCount={bulkSelectedIds.size}
        onClose={() => setShowBulkDeferModal(false)}
        onConfirm={handleBulkDefer}
      />

      {/* Bulk Decline modal */}
      <BulkDeclineModal
        isOpen={showBulkDeclineModal}
        itemCount={bulkSelectedIds.size}
        onClose={() => setShowBulkDeclineModal(false)}
        onConfirm={handleBulkDecline}
      />
    </div>
  )
}
