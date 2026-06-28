/**
 * LabourTab Component
 * Inline-editable checklist workflow for managing labour entries on health check repair items
 *
 * Features:
 * - Inline editing with tab navigation for rapid data entry
 * - Auto-save on blur/Enter
 * - Keyboard navigation: Tab, Shift+Tab, Enter, Escape
 * - Expandable/collapsible group hierarchy
 * - Individual labour on group OR children
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, NewRepairItem, RepairLabour, LabourCode, RepairItemChild, PricingSettings } from '../../../lib/api'
import { Tooltip } from '../../../components/ui/Tooltip'

interface LabourTabProps {
  healthCheckId: string
  onUpdate: () => void
}

// Labour entry status
type LabourItemStatus = 'pending' | 'done' | 'na'

// Extended checklist item with hierarchy info
interface ChecklistItem {
  repairItem: NewRepairItem | RepairItemChild
  status: LabourItemStatus
  labourEntries: RepairLabour[]
  ragStatus: 'red' | 'amber' | null
  isGroupHeader?: boolean      // Is this the group's header row
  isGroupLabourRow?: boolean   // Is this the "Group Labour" sub-row
  isChild?: boolean            // Is this a child row
  parentId?: string            // Parent group ID if child
  isLastChild?: boolean        // For tree connector styling
  childIndex?: number          // Index among siblings
}

// Repair Type lookup option (drives the locked labour rate via its default labour code,
// plus the standing default discount % pre-filled onto new labour lines)
interface RepairTypeOpt { id: string; code: string; colour: string; defaultLabourCodeId: string | null; defaultDiscountPercent?: number }

// Row edit state for inline editing
interface RowEditState {
  repairItemId: string
  labourCodeId: string
  hours: string
  isDirty: boolean
  isSaving: boolean
  error: string | null
  saveSuccess: boolean
}

export function LabourTab({ healthCheckId, onUpdate }: LabourTabProps) {
  const { session, user, refreshSession } = useAuth()
  const [repairItems, setRepairItems] = useState<NewRepairItem[]>([])
  const [labourCodes, setLabourCodes] = useState<LabourCode[]>([])
  const [repairTypes, setRepairTypes] = useState<RepairTypeOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingComplete, setMarkingComplete] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showOtherLabourModal, setShowOtherLabourModal] = useState(false)
  const [pricingSettings, setPricingSettings] = useState<PricingSettings | null>(null)

  // Expand/collapse state for groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Row edit states for inline editing
  const [editStates, setEditStates] = useState<Map<string, RowEditState>>(new Map())

  // Refs for focus management
  const inputRefs = useRef<Map<string, HTMLElement>>(new Map())

  // Toggle group expansion
  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }, [])

  // Fetch repair items and labour codes
  useEffect(() => {
    const fetchData = async () => {
      if (!session?.accessToken || !user?.organization?.id) return

      setLoading(true)
      setError(null)

      try {
        const [itemsRes, codesRes, pricingRes, repairTypesRes] = await Promise.all([
          api<{ repairItems: NewRepairItem[] }>(
            `/api/v1/health-checks/${healthCheckId}/repair-items`,
            { token: session.accessToken }
          ),
          api<{ labourCodes: LabourCode[] }>(
            `/api/v1/organizations/${user.organization.id}/labour-codes`,
            { token: session.accessToken }
          ),
          api<{ settings: PricingSettings }>(
            `/api/v1/organizations/${user.organization.id}/pricing-settings`,
            { token: session.accessToken }
          ),
          api<{ repairTypes: RepairTypeOpt[] }>(
            `/api/v1/repair-types?active_only=true`,
            { token: session.accessToken }
          )
        ])

        setRepairItems(itemsRes.repairItems || [])
        setLabourCodes(codesRes.labourCodes || [])
        setPricingSettings(pricingRes.settings || null)
        setRepairTypes(repairTypesRes.repairTypes || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [session?.accessToken, healthCheckId, user?.organization?.id])

  // Helper to get RAG status from item
  const getRagStatus = (item: NewRepairItem | RepairItemChild): 'red' | 'amber' | null => {
    // First check linked check results (for inspection-sourced items)
    if (item.checkResults && item.checkResults.length > 0) {
      const hasRed = item.checkResults.some(cr => cr.ragStatus === 'red')
      const hasAmber = item.checkResults.some(cr => cr.ragStatus === 'amber')
      return hasRed ? 'red' : hasAmber ? 'amber' : null
    }
    // Fallback to direct ragStatus (for MRI-sourced items)
    if ('ragStatus' in item && item.ragStatus) {
      return item.ragStatus as 'red' | 'amber' | null
    }
    return null
  }

  // Helper to get status from item
  const getItemStatus = (item: NewRepairItem | RepairItemChild, labourEntries: RepairLabour[]): LabourItemStatus => {
    if ('noLabourRequired' in item && item.noLabourRequired) {
      return 'na'
    }
    return labourEntries.length > 0 ? 'done' : 'pending'
  }

  // Build flattened checklist items with hierarchy info
  const checklistItems = useMemo((): ChecklistItem[] => {
    const items: ChecklistItem[] = []

    repairItems.forEach(item => {
      const isGroup = item.isGroup && item.children && item.children.length > 0
      const isExpanded = expandedGroups.has(item.id)

      // Get group's own labour entries
      const groupLabourEntries: RepairLabour[] = []
      if (item.labour) {
        groupLabourEntries.push(...item.labour)
      }
      if (item.options) {
        item.options.forEach(option => {
          if (option.labour) {
            groupLabourEntries.push(...option.labour)
          }
        })
      }

      if (isGroup) {
        // GROUP HEADER ROW
        items.push({
          repairItem: item,
          status: getItemStatus(item, groupLabourEntries),
          labourEntries: groupLabourEntries,
          ragStatus: getRagStatus(item),
          isGroupHeader: true
        })

        // If expanded, show group labour row and children
        if (isExpanded) {
          // GROUP LABOUR ROW (for adding labour to the group itself)
          items.push({
            repairItem: item,
            status: getItemStatus(item, groupLabourEntries),
            labourEntries: groupLabourEntries,
            ragStatus: null, // Group labour row doesn't show RAG
            isGroupLabourRow: true
          })

          // CHILD ROWS
          const children = item.children || []
          children.forEach((child, idx) => {
            const childLabourEntries: RepairLabour[] = child.labour || []
            items.push({
              repairItem: child,
              status: getItemStatus(child, childLabourEntries),
              labourEntries: childLabourEntries,
              ragStatus: getRagStatus(child),
              isChild: true,
              parentId: item.id,
              isLastChild: idx === children.length - 1,
              childIndex: idx
            })
          })
        }
      } else {
        // REGULAR ITEM (non-group)
        items.push({
          repairItem: item,
          status: getItemStatus(item, groupLabourEntries),
          labourEntries: groupLabourEntries,
          ragStatus: getRagStatus(item)
        })
      }
    })

    return items
  }, [repairItems, expandedGroups])

  // Calculate progress (excluding expanded children from count to avoid confusion)
  const progress = useMemo(() => {
    let total = 0
    let completed = 0

    repairItems.forEach(item => {
      const isGroup = item.isGroup && item.children && item.children.length > 0

      if (isGroup) {
        // For groups, count group + all children
        const groupLabour = item.labour || []
        const groupDone = item.noLabourRequired || groupLabour.length > 0

        const children = item.children || []
        const allChildrenDone = children.every(child =>
          child.noLabourRequired || (child.labour && child.labour.length > 0)
        )

        // Group counts as 1 item
        total++
        // Group is complete if either: group has labour OR all children have labour
        if (groupDone || allChildrenDone) {
          completed++
        }
      } else {
        total++
        const labour = item.labour || []
        if (item.noLabourRequired || labour.length > 0) {
          completed++
        }
      }
    })

    return { completed, total }
  }, [repairItems])

  // Calculate totals including children's labour
  const totals = useMemo(() => {
    let totalLabourAmount = 0
    let vatExempt = 0
    let vatLiable = 0

    repairItems.forEach(item => {
      // Group's own labour
      const labourEntries = item.labour || []
      labourEntries.forEach((entry: RepairLabour) => {
        totalLabourAmount += entry.total
        if (entry.isVatExempt) vatExempt += entry.total
        else vatLiable += entry.total
      })

      // Options labour
      const options = item.options || []
      options.forEach(option => {
        const optionLabour = option.labour || []
        optionLabour.forEach((entry: RepairLabour) => {
          totalLabourAmount += entry.total
          if (entry.isVatExempt) vatExempt += entry.total
          else vatLiable += entry.total
        })
      })

      // Children's labour (for groups)
      if (item.isGroup && item.children) {
        item.children.forEach(child => {
          const childLabour = child.labour || []
          childLabour.forEach((entry: RepairLabour) => {
            totalLabourAmount += entry.total
            if (entry.isVatExempt) vatExempt += entry.total
            else vatLiable += entry.total
          })
        })
      }
    })

    const vatRate = pricingSettings?.vatRate || 20
    const vatAmount = Math.round(vatLiable * (vatRate / 100) * 100) / 100
    const totalIncVat = totalLabourAmount + vatAmount

    return { totalLabour: totalLabourAmount, vatExempt, vatLiable, vatRate, vatAmount, totalIncVat }
  }, [repairItems, pricingSettings])

  // Calculate group total (group labour + all children labour)
  const calculateGroupTotal = useCallback((item: NewRepairItem): number => {
    let groupTotal = 0

    // Group's own labour
    const itemLabour = item.labour || []
    itemLabour.forEach((entry: RepairLabour) => {
      groupTotal += entry.total
    })

    // Children's labour
    if (item.children) {
      item.children.forEach(child => {
        const childLabour = child.labour || []
        childLabour.forEach((entry: RepairLabour) => {
          groupTotal += entry.total
        })
      })
    }

    return groupTotal
  }, [])

  // Check if all items are actioned
  const allActioned = progress.completed === progress.total && progress.total > 0

  // Check if already marked complete
  const allLabourComplete = repairItems.every(item => item.labourStatus === 'complete')

  const refetchData = useCallback(async () => {
    if (!session?.accessToken) return
    console.log('Refetching repair items...')
    const itemsRes = await api<{ repairItems: NewRepairItem[] }>(
      `/api/v1/health-checks/${healthCheckId}/repair-items`,
      { token: session.accessToken }
    )
    console.log('Refetched items:', itemsRes.repairItems?.map(i => ({ id: i.id, name: i.name, noLabourRequired: i.noLabourRequired })))
    setRepairItems(itemsRes.repairItems || [])
    onUpdate()
  }, [session?.accessToken, healthCheckId, onUpdate])

  // Get or initialize edit state for a row
  const getEditState = useCallback((repairItemId: string, labour?: RepairLabour): RowEditState => {
    const existing = editStates.get(repairItemId)
    if (existing) return existing

    // Initialize from existing labour or empty
    return {
      repairItemId,
      labourCodeId: labour?.labourCodeId || '',
      hours: labour?.hours?.toString() || '',
      isDirty: false,
      isSaving: false,
      error: null,
      saveSuccess: false
    }
  }, [editStates])

  // Update edit state for a row
  const updateEditState = useCallback((repairItemId: string, updates: Partial<RowEditState>) => {
    setEditStates(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(repairItemId) || {
        repairItemId,
        labourCodeId: '',
        hours: '',
        isDirty: false,
        isSaving: false,
        error: null,
        saveSuccess: false
      }
      newMap.set(repairItemId, { ...existing, ...updates })
      return newMap
    })
  }, [])

  // Clear edit state for a row
  const clearEditState = useCallback((repairItemId: string) => {
    setEditStates(prev => {
      const newMap = new Map(prev)
      newMap.delete(repairItemId)
      return newMap
    })
  }, [])

  // Save labour for a row
  // Labour is locked to the work group's Repair Type — no labour code is sent; the server resolves
  // the rate from the type's default labour code (and 400s if the line has no resolvable type).
  const saveRowLabour = useCallback(async (
    repairItemId: string,
    hours: string,
    existingLabourId?: string,
    discountPercent: number = 0
  ) => {
    if (!session?.accessToken) return false

    const hoursNum = parseFloat(hours)
    if (isNaN(hoursNum) || hoursNum <= 0) {
      return false
    }

    updateEditState(repairItemId, { isSaving: true, error: null })

    try {
      if (existingLabourId) {
        // Update existing labour
        await api(`/api/v1/repair-labour/${existingLabourId}`, {
          method: 'PATCH',
          token: session.accessToken,
          body: {
            hours: hoursNum,
            discount_percent: discountPercent
          }
        })
      } else {
        // Create new labour
        await api(`/api/v1/repair-items/${repairItemId}/labour`, {
          method: 'POST',
          token: session.accessToken,
          body: {
            hours: hoursNum,
            discount_percent: discountPercent
          }
        })
      }

      // Show success state - Fix 2: Don't clear it automatically
      updateEditState(repairItemId, { isSaving: false, isDirty: false, saveSuccess: true })

      await refetchData()
      return true
    } catch (err) {
      updateEditState(repairItemId, {
        isSaving: false,
        error: err instanceof Error ? err.message : 'Failed to save'
      })
      return false
    }
  }, [session?.accessToken, updateEditState, refetchData])

  // Set the Repair Type on a top-level work group / single item. The server re-rates the group's
  // existing labour to the new type's rate; we refetch to reflect it.
  const setItemRepairType = useCallback(async (repairItemId: string, repairTypeId: string) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/repair-items/${repairItemId}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { repairTypeId: repairTypeId || null }
      })
      await refetchData()
    } catch (err) {
      console.error('Failed to set repair type:', err)
    }
  }, [session?.accessToken, refetchData])

  const handleMarkNoLabourRequired = async (repairItemId: string) => {
    console.log('handleMarkNoLabourRequired called with:', repairItemId)
    console.log('session exists:', !!session, 'accessToken exists:', !!session?.accessToken)

    if (!session?.accessToken) {
      console.error('No session token for marking no labour required')
      return
    }

    console.log('Setting action loading for:', repairItemId)
    setActionLoading(repairItemId)

    try {
      console.log('Making API call...')
      await api(`/api/v1/repair-items/${repairItemId}/no-labour-required`, {
        method: 'POST',
        token: session.accessToken
      })
      console.log('API call succeeded')
      clearEditState(repairItemId)
      await refetchData()
    } catch (err) {
      console.error('Mark no labour required error:', err)
      // If token expired, refresh session and let user retry
      if (err instanceof Error && (err.message.includes('expired') || err.message.includes('Invalid'))) {
        try {
          await refreshSession()
          setError('Session refreshed. Please try again.')
        } catch (refreshErr) {
          setError('Session expired. Please refresh the page.')
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to mark as no labour required')
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleRemoveNoLabourRequired = async (repairItemId: string) => {
    console.log('handleRemoveNoLabourRequired called with:', repairItemId)
    if (!session?.accessToken) {
      console.error('No session token')
      return
    }
    setActionLoading(repairItemId)

    try {
      console.log('Making DELETE API call...')
      await api(`/api/v1/repair-items/${repairItemId}/no-labour-required`, {
        method: 'DELETE',
        token: session.accessToken
      })
      console.log('DELETE succeeded')
      await refetchData()
    } catch (err) {
      console.error('Remove no labour required error:', err)
      setError(err instanceof Error ? err.message : 'Failed to remove no labour required')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteLabour = async (labourId: string, repairItemId: string) => {
    if (!session?.accessToken) return
    if (!confirm('Are you sure you want to delete this labour entry?')) return

    try {
      await api(`/api/v1/repair-labour/${labourId}`, {
        method: 'DELETE',
        token: session.accessToken
      })
      clearEditState(repairItemId)
      await refetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleMarkAllComplete = async () => {
    if (!session?.accessToken || !allActioned) return

    setMarkingComplete(true)
    try {
      await Promise.all(
        repairItems.map(item =>
          api(`/api/v1/repair-items/${item.id}/labour-complete`, {
            method: 'POST',
            token: session.accessToken
          })
        )
      )
      await refetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark complete')
    } finally {
      setMarkingComplete(false)
    }
  }

  const handleLabourSaved = async () => {
    await refetchData()
  }

  // Register input ref for focus management
  const registerRef = useCallback((key: string, element: HTMLElement | null) => {
    if (element) {
      inputRefs.current.set(key, element)
    } else {
      inputRefs.current.delete(key)
    }
  }, [])

  // Focus next input in sequence
  const focusNext = useCallback((currentKey: string) => {
    const keys = Array.from(inputRefs.current.keys()).sort()
    const currentIndex = keys.indexOf(currentKey)
    if (currentIndex >= 0 && currentIndex < keys.length - 1) {
      const nextKey = keys[currentIndex + 1]
      inputRefs.current.get(nextKey)?.focus()
    }
  }, [])

  // Focus previous input in sequence
  const focusPrev = useCallback((currentKey: string) => {
    const keys = Array.from(inputRefs.current.keys()).sort()
    const currentIndex = keys.indexOf(currentKey)
    if (currentIndex > 0) {
      const prevKey = keys[currentIndex - 1]
      inputRefs.current.get(prevKey)?.focus()
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    )
  }

  if (repairItems.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <div className="text-gray-400 mb-2">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-1">No Repair Items</h3>
        <p className="text-gray-500">
          There are no red or amber items requiring labour. All checks passed!
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with Progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium text-gray-900">Labour Checklist</h3>
          <span className={`text-sm px-2 py-1 rounded-full ${
            progress.completed === progress.total
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {progress.completed} of {progress.total} complete
          </span>
        </div>
        <div className="text-xs text-gray-500">
          Tab to navigate • Enter to save • Esc to cancel
        </div>
      </div>

      {/* Checklist Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">
                {/* RAG */}
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Item
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-36">
                Code
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                Hours
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                Rate
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                Disc %
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                Total
              </th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {checklistItems.map((item, rowIndex) => {
              const repairItem = item.repairItem

              // GROUP HEADER ROW
              if (item.isGroupHeader) {
                const isExpanded = expandedGroups.has(repairItem.id)
                const groupItem = repairItem as NewRepairItem
                const groupTotal = calculateGroupTotal(groupItem)
                const childCount = groupItem.children?.length || 0

                return (
                  <tr key={`group-header-${repairItem.id}`} className="bg-gray-50">
                    {/* RAG Status */}
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block w-3 h-3 rounded-full ${
                        item.ragStatus === 'red' ? 'bg-red-500' :
                        item.ragStatus === 'amber' ? 'bg-amber-500' :
                        'bg-gray-300'
                      }`} />
                    </td>

                    {/* Item Name with expand/collapse */}
                    <td className="px-3 py-2 text-sm text-gray-900">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleGroup(repairItem.id)}
                          className="p-0.5 hover:bg-gray-200 rounded transition-colors"
                        >
                          <svg
                            className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        <span className="font-medium">{repairItem.name}</span>
                        <span className="px-1.5 py-0.5 text-xs font-medium text-purple-700 bg-purple-100 rounded">
                          GROUP ({childCount})
                        </span>
                      </div>
                    </td>

                    {/* Repair Type — drives the locked labour rate for this group */}
                    <td className="px-3 py-2" colSpan={3}>
                      <select
                        value={groupItem.repairTypeId || ''}
                        onChange={(e) => setItemRepairType(groupItem.id, e.target.value)}
                        className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                      >
                        <option value="">Repair Type…</option>
                        {repairTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.code}</option>)}
                      </select>
                    </td>

                    {/* Aggregated total */}
                    <td className="px-3 py-2 text-sm font-semibold text-gray-900 text-right">
                      {groupTotal > 0 ? `£${groupTotal.toFixed(2)}` : '—'}
                    </td>

                    {/* Expand/collapse action */}
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggleGroup(repairItem.id)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </button>
                    </td>
                  </tr>
                )
              }

              // GROUP LABOUR ROW (editable row for group's own labour)
              if (item.isGroupLabourRow) {
                return (
                  <GroupLabourRow
                    key={`group-labour-${repairItem.id}`}
                    item={item}
                    rowIndex={rowIndex}
                    labourCodes={labourCodes}
                    repairTypes={repairTypes}
                    repairTypeId={(repairItem as NewRepairItem).repairTypeId ?? null}
                    editState={getEditState(repairItem.id, item.labourEntries[0])}
                    isLoading={actionLoading === repairItem.id}
                    onUpdateEditState={(updates) => updateEditState(repairItem.id, updates)}
                    onSave={(hours, existingLabourId, discountPercent) =>
                      saveRowLabour(repairItem.id, hours, existingLabourId, discountPercent)
                    }
                    onMarkNA={() => handleMarkNoLabourRequired(repairItem.id)}
                    onRemoveNA={() => handleRemoveNoLabourRequired(repairItem.id)}
                    onDelete={(labourId) => handleDeleteLabour(labourId, repairItem.id)}
                    onClear={() => clearEditState(repairItem.id)}
                    registerRef={registerRef}
                    focusNext={focusNext}
                    focusPrev={focusPrev}
                  />
                )
              }

              // CHILD ROW
              if (item.isChild) {
                return (
                  <ChildLabourRow
                    key={`child-${repairItem.id}`}
                    item={item}
                    rowIndex={rowIndex}
                    labourCodes={labourCodes}
                    repairTypes={repairTypes}
                    repairTypeId={repairItems.find(p => p.id === (repairItem as RepairItemChild).parentRepairItemId)?.repairTypeId ?? null}
                    editState={getEditState(repairItem.id, item.labourEntries[0])}
                    isLoading={actionLoading === repairItem.id}
                    onUpdateEditState={(updates) => updateEditState(repairItem.id, updates)}
                    onSave={(hours, existingLabourId, discountPercent) =>
                      saveRowLabour(repairItem.id, hours, existingLabourId, discountPercent)
                    }
                    onMarkNA={() => handleMarkNoLabourRequired(repairItem.id)}
                    onRemoveNA={() => handleRemoveNoLabourRequired(repairItem.id)}
                    onDelete={(labourId) => handleDeleteLabour(labourId, repairItem.id)}
                    onClear={() => clearEditState(repairItem.id)}
                    registerRef={registerRef}
                    focusNext={focusNext}
                    focusPrev={focusPrev}
                  />
                )
              }

              // REGULAR ROW (non-group)
              return (
                <InlineLabourRow
                  key={repairItem.id}
                  item={item}
                  rowIndex={rowIndex}
                  labourCodes={labourCodes}
                  repairTypes={repairTypes}
                  repairTypeId={(repairItem as NewRepairItem).repairTypeId ?? null}
                  onSetRepairType={(rtId) => setItemRepairType(repairItem.id, rtId)}
                  editState={getEditState(repairItem.id, item.labourEntries[0])}
                  isLoading={actionLoading === repairItem.id}
                  onUpdateEditState={(updates) => updateEditState(repairItem.id, updates)}
                  onSave={(hours, existingLabourId, discountPercent) =>
                    saveRowLabour(repairItem.id, hours, existingLabourId, discountPercent)
                  }
                  onMarkNA={() => handleMarkNoLabourRequired(repairItem.id)}
                  onRemoveNA={() => handleRemoveNoLabourRequired(repairItem.id)}
                  onDelete={(labourId) => handleDeleteLabour(labourId, repairItem.id)}
                  onClear={() => clearEditState(repairItem.id)}
                  registerRef={registerRef}
                  focusNext={focusNext}
                  focusPrev={focusPrev}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Totals & Actions */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div className="space-y-1">
            <div className="flex gap-8 flex-wrap">
              <div>
                <span className="text-sm text-gray-500">Total Labour:</span>
                <span className="ml-2 font-semibold">£{totals.totalLabour.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">VAT Exempt:</span>
                <span className="ml-2 text-gray-700">£{totals.vatExempt.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">VAT Liable:</span>
                <span className="ml-2 text-gray-700">£{totals.vatLiable.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">VAT ({totals.vatRate}%):</span>
                <span className="ml-2 text-gray-700">£{totals.vatAmount.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Total inc VAT:</span>
                <span className="ml-2 font-semibold">£{totals.totalIncVat.toFixed(2)}</span>
              </div>
            </div>
            {!allActioned && (
              <p className="text-sm text-amber-600">
                Action all items to enable "Mark All Complete"
              </p>
            )}
          </div>
          <button
            onClick={handleMarkAllComplete}
            disabled={markingComplete || allLabourComplete || !allActioned}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded transition-colors ${
              allLabourComplete
                ? 'bg-green-100 text-green-700 cursor-default'
                : allActioned
                  ? 'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {allLabourComplete ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Labour Complete
              </>
            ) : (
              <>
                {markingComplete ? 'Marking...' : 'Mark All Complete'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Add Other Labour Button */}
      <button
        onClick={() => setShowOtherLabourModal(true)}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add Other Labour
      </button>

      {/* Add Other Labour Modal */}
      {showOtherLabourModal && (
        <AddOtherLabourModal
          healthCheckId={healthCheckId}
          labourCodes={labourCodes}
          repairTypes={repairTypes}
          onClose={() => setShowOtherLabourModal(false)}
          onSaved={handleLabourSaved}
        />
      )}
    </div>
  )
}

// ============================================================================
// GROUP LABOUR ROW COMPONENT (Indented "Group Labour" row)
// ============================================================================

interface GroupLabourRowProps {
  item: ChecklistItem
  rowIndex: number
  labourCodes: LabourCode[]
  repairTypes: RepairTypeOpt[]
  repairTypeId: string | null
  editState: RowEditState
  isLoading: boolean
  onUpdateEditState: (updates: Partial<RowEditState>) => void
  onSave: (hours: string, existingLabourId?: string, discountPercent?: number) => Promise<boolean>
  onMarkNA: () => void
  onRemoveNA: () => void
  onDelete: (labourId: string) => void
  onClear: () => void
  registerRef: (key: string, element: HTMLElement | null) => void
  focusNext: (currentKey: string) => void
  focusPrev: (currentKey: string) => void
}

function GroupLabourRow({
  item,
  rowIndex,
  labourCodes,
  repairTypes,
  repairTypeId,
  editState,
  isLoading,
  onUpdateEditState,
  onSave,
  onMarkNA,
  onRemoveNA,
  onDelete,
  onClear,
  registerRef,
  focusNext,
  focusPrev: _focusPrev
}: GroupLabourRowProps) {
  const hasLabour = item.labourEntries.length > 0
  const existingLabour = item.labourEntries[0]
  const isNA = item.status === 'na'

  // Local state for inputs
  const repairType = repairTypes.find(rt => rt.id === repairTypeId) || null
  const lockedCode = repairType?.defaultLabourCodeId ? (labourCodes.find(c => c.id === repairType.defaultLabourCodeId) || null) : null
  const localCode = lockedCode?.id || ''
  // The Repair Type's standing discount pre-fills new labour lines (still overridable per line).
  const typeDefaultDiscountStr = String(repairType?.defaultDiscountPercent || 0)
  const [localHours, setLocalHours] = useState(existingLabour?.hours?.toString() || editState.hours)
  const [localDiscount, setLocalDiscount] = useState(existingLabour?.discountPercent?.toString() ?? typeDefaultDiscountStr)
  const saveTriggeredRef = useRef(false)

  const isDirty = hasLabour
    ? localHours !== existingLabour.hours.toString() || localDiscount !== (existingLabour.discountPercent?.toString() || '0')
    : localHours !== ''

  const rate = lockedCode?.hourlyRate || existingLabour?.rate || 0
  const hoursNum = parseFloat(localHours) || 0
  const discountPct = parseFloat(localDiscount) || 0
  const subtotal = hoursNum * rate
  const total = subtotal * (1 - discountPct / 100)

  const codeRefKey = `${rowIndex}-group-labour-code`
  const hoursRefKey = `${rowIndex}-group-labour-hours`

  useEffect(() => {
    if (existingLabour && !editState.isDirty) {
      setLocalHours(existingLabour.hours.toString())
      setLocalDiscount(existingLabour.discountPercent?.toString() || '0')
    } else if (!existingLabour && !editState.isDirty) {
      // New line: keep the discount synced to the Repair Type's default until the user edits it.
      setLocalDiscount(typeDefaultDiscountStr)
    }
  }, [existingLabour, editState.isDirty, typeDefaultDiscountStr])

  const handleHoursChange = (value: string) => {
    setLocalHours(value)
    onUpdateEditState({ hours: value, isDirty: true })
  }

  const handleDiscountChange = (value: string) => {
    setLocalDiscount(value)
    onUpdateEditState({ isDirty: true })
  }

  const handleSave = async (moveToNext = false) => {
    if (editState.isSaving) return
    if (!lockedCode || !localHours || parseFloat(localHours) <= 0) return

    saveTriggeredRef.current = true
    const success = await onSave(localHours, existingLabour?.id, parseFloat(localDiscount) || 0)

    if (success && moveToNext) {
      setTimeout(() => {
        focusNext(hoursRefKey)
      }, 50)
    }

    setTimeout(() => {
      saveTriggeredRef.current = false
    }, 100)
  }

  const handleClear = () => {
    if (existingLabour) {
      setLocalHours(existingLabour.hours.toString())
      setLocalDiscount(existingLabour.discountPercent?.toString() || '0')
    } else {
      setLocalHours('')
      setLocalDiscount(typeDefaultDiscountStr)
    }
    onClear()
  }

  const handleKeyDown = (e: React.KeyboardEvent, inputType: 'code' | 'hours') => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (localCode && localHours && parseFloat(localHours) > 0) {
        handleSave(true)
      } else if (inputType === 'code' && localCode) {
        focusNext(codeRefKey)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleClear()
    } else if (e.key === 'Tab' && !e.shiftKey && inputType === 'hours') {
      if (isDirty && localCode && localHours && parseFloat(localHours) > 0) {
        handleSave(false)
      }
    }
  }

  const handleBlur = () => {
    if (saveTriggeredRef.current || editState.isSaving) return
    if (isDirty && localCode && localHours && parseFloat(localHours) > 0) {
      handleSave(false)
    }
  }

  if (isNA) {
    return (
      <tr className="bg-white border-l-4 border-l-purple-200">
        <td className="px-3 py-2 text-center"></td>
        <td className="px-3 py-2 text-sm text-gray-600">
          <div className="flex items-center gap-2 pl-6">
            <span className="text-amber-500">★</span>
            <span className="italic">Group Labour</span>
            <span className="text-gray-400">(No labour required)</span>
          </div>
        </td>
        <td className="px-3 py-2 text-sm text-gray-400 italic" colSpan={5}>
          N/A
        </td>
        <td className="px-3 py-2 text-center">
          <button
            onClick={onRemoveNA}
            disabled={isLoading}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            {isLoading ? '...' : 'Undo'}
          </button>
        </td>
      </tr>
    )
  }

  const rowClass = editState.saveSuccess
    ? 'bg-green-50 transition-colors duration-500 border-l-4 border-l-purple-200'
    : editState.error
      ? 'bg-red-50 border-l-4 border-l-purple-200'
      : 'bg-white border-l-4 border-l-purple-200 hover:bg-gray-50'

  return (
    <tr className={rowClass}>
      <td className="px-3 py-2 text-center"></td>
      <td className="px-3 py-2 text-sm text-gray-600">
        <div className="flex items-center gap-2 pl-6">
          <span className="text-amber-500">★</span>
          <span>Group Labour</span>
        </div>
      </td>

      {/* Labour code (locked — derived from the work group's Repair Type) */}
      <td className="px-3 py-2 text-sm text-gray-600">
        {lockedCode ? lockedCode.code : <span className="text-amber-600 text-xs">Set type</span>}
      </td>

      {/* Hours Input */}
      <td className="px-3 py-2">
        <input
          ref={(el) => registerRef(hoursRefKey, el)}
          type="number"
          step="0.1"
          min="0"
          value={localHours}
          onChange={(e) => handleHoursChange(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'hours')}
          onBlur={handleBlur}
          disabled={editState.isSaving}
          placeholder="0.0"
          className={`w-full px-2 py-1.5 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Rate */}
      <td className="px-3 py-2 text-sm text-gray-600 text-right">
        {localCode ? `£${rate.toFixed(2)}` : '—'}
      </td>

      {/* Discount % */}
      <td className="px-3 py-2">
        <input
          type="number"
          step="1"
          min="0"
          max="100"
          value={localDiscount}
          onChange={(e) => handleDiscountChange(e.target.value)}
          onBlur={handleBlur}
          disabled={editState.isSaving || !localCode}
          placeholder="0"
          className={`w-full px-2 py-1.5 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving || !localCode ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Total */}
      <td className="px-3 py-2 text-sm font-medium text-gray-900 text-right">
        {localCode && hoursNum > 0 ? `£${total.toFixed(2)}` : '—'}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        <div className="flex items-center justify-center gap-1">
          {editState.isSaving ? (
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          ) : editState.saveSuccess || (hasLabour && !isDirty) ? (
            <>
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {hasLabour && !isDirty && (
                <button
                  onClick={() => onDelete(existingLabour.id)}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </>
          ) : isDirty ? (
            <>
              {localCode && localHours && parseFloat(localHours) > 0 && (
                <button
                  onClick={() => handleSave(false)}
                  className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                  title="Save (Enter)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
              <button
                onClick={handleClear}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                title="Clear (Esc)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {/* Fix 4: N/A button shown when no labour saved yet */}
              {!hasLabour && (
                <Tooltip content="No labour required">
                  <button
                    onClick={onMarkNA}
                    disabled={isLoading}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
                  >
                    {isLoading ? (
                      <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    )}
                  </button>
                </Tooltip>
              )}
            </>
          ) : (
            <Tooltip content="No labour required">
              <button
                onClick={onMarkNA}
                disabled={isLoading}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                )}
              </button>
            </Tooltip>
          )}
        </div>
        {editState.error && (
          <div className="text-xs text-red-600 mt-1">{editState.error}</div>
        )}
      </td>
    </tr>
  )
}

// ============================================================================
// CHILD LABOUR ROW COMPONENT (Indented child row with tree connectors)
// ============================================================================

interface ChildLabourRowProps {
  item: ChecklistItem
  rowIndex: number
  labourCodes: LabourCode[]
  repairTypes: RepairTypeOpt[]
  repairTypeId: string | null
  editState: RowEditState
  isLoading: boolean
  onUpdateEditState: (updates: Partial<RowEditState>) => void
  onSave: (hours: string, existingLabourId?: string, discountPercent?: number) => Promise<boolean>
  onMarkNA: () => void
  onRemoveNA: () => void
  onDelete: (labourId: string) => void
  onClear: () => void
  registerRef: (key: string, element: HTMLElement | null) => void
  focusNext: (currentKey: string) => void
  focusPrev: (currentKey: string) => void
}

function ChildLabourRow({
  item,
  rowIndex,
  labourCodes,
  repairTypes,
  repairTypeId,
  editState,
  isLoading,
  onUpdateEditState,
  onSave,
  onMarkNA,
  onRemoveNA,
  onDelete,
  onClear,
  registerRef,
  focusNext,
  focusPrev: _focusPrev
}: ChildLabourRowProps) {
  const hasLabour = item.labourEntries.length > 0
  const existingLabour = item.labourEntries[0]
  const isNA = item.status === 'na'
  const childItem = item.repairItem as RepairItemChild

  // Get display name from check result or item name
  const displayName = childItem.checkResults?.[0]?.templateItem?.name || childItem.name

  // Tree connector
  const treeConnector = item.isLastChild ? '└─' : '├─'

  // Local state for inputs
  const repairType = repairTypes.find(rt => rt.id === repairTypeId) || null
  const lockedCode = repairType?.defaultLabourCodeId ? (labourCodes.find(c => c.id === repairType.defaultLabourCodeId) || null) : null
  const localCode = lockedCode?.id || ''
  // The Repair Type's standing discount pre-fills new labour lines (still overridable per line).
  const typeDefaultDiscountStr = String(repairType?.defaultDiscountPercent || 0)
  const [localHours, setLocalHours] = useState(existingLabour?.hours?.toString() || editState.hours)
  const [localDiscount, setLocalDiscount] = useState(existingLabour?.discountPercent?.toString() ?? typeDefaultDiscountStr)
  const saveTriggeredRef = useRef(false)

  const isDirty = hasLabour
    ? localHours !== existingLabour.hours.toString() || localDiscount !== (existingLabour.discountPercent?.toString() || '0')
    : localHours !== ''

  const rate = lockedCode?.hourlyRate || existingLabour?.rate || 0
  const hoursNum = parseFloat(localHours) || 0
  const discountPct = parseFloat(localDiscount) || 0
  const subtotal = hoursNum * rate
  const total = subtotal * (1 - discountPct / 100)

  const codeRefKey = `${rowIndex}-child-code`
  const hoursRefKey = `${rowIndex}-child-hours`

  useEffect(() => {
    if (existingLabour && !editState.isDirty) {
      setLocalHours(existingLabour.hours.toString())
      setLocalDiscount(existingLabour.discountPercent?.toString() || '0')
    } else if (!existingLabour && !editState.isDirty) {
      // New line: keep the discount synced to the Repair Type's default until the user edits it.
      setLocalDiscount(typeDefaultDiscountStr)
    }
  }, [existingLabour, editState.isDirty, typeDefaultDiscountStr])

  const handleHoursChange = (value: string) => {
    setLocalHours(value)
    onUpdateEditState({ hours: value, isDirty: true })
  }

  const handleDiscountChange = (value: string) => {
    setLocalDiscount(value)
    onUpdateEditState({ isDirty: true })
  }

  const handleSave = async (moveToNext = false) => {
    if (editState.isSaving) return
    if (!lockedCode || !localHours || parseFloat(localHours) <= 0) return

    saveTriggeredRef.current = true
    const success = await onSave(localHours, existingLabour?.id, parseFloat(localDiscount) || 0)

    if (success && moveToNext) {
      setTimeout(() => {
        focusNext(hoursRefKey)
      }, 50)
    }

    setTimeout(() => {
      saveTriggeredRef.current = false
    }, 100)
  }

  const handleClear = () => {
    if (existingLabour) {
      setLocalHours(existingLabour.hours.toString())
      setLocalDiscount(existingLabour.discountPercent?.toString() || '0')
    } else {
      setLocalHours('')
      setLocalDiscount(typeDefaultDiscountStr)
    }
    onClear()
  }

  const handleKeyDown = (e: React.KeyboardEvent, inputType: 'code' | 'hours') => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (localCode && localHours && parseFloat(localHours) > 0) {
        handleSave(true)
      } else if (inputType === 'code' && localCode) {
        focusNext(codeRefKey)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleClear()
    } else if (e.key === 'Tab' && !e.shiftKey && inputType === 'hours') {
      if (isDirty && localCode && localHours && parseFloat(localHours) > 0) {
        handleSave(false)
      }
    }
  }

  const handleBlur = () => {
    if (saveTriggeredRef.current || editState.isSaving) return
    if (isDirty && localCode && localHours && parseFloat(localHours) > 0) {
      handleSave(false)
    }
  }

  if (isNA) {
    return (
      <tr className="bg-white border-l-4 border-l-purple-200">
        <td className="px-3 py-2 text-center">
          <span className={`inline-block w-3 h-3 rounded-full ${
            item.ragStatus === 'red' ? 'bg-red-500' :
            item.ragStatus === 'amber' ? 'bg-amber-500' :
            'bg-gray-300'
          }`} />
        </td>
        <td className="px-3 py-2 text-sm text-gray-600">
          <div className="flex items-center gap-2 pl-6">
            <span className="text-gray-400 font-mono text-xs">{treeConnector}</span>
            <span>{displayName}</span>
            <span className="text-gray-400">(N/A)</span>
          </div>
        </td>
        <td className="px-3 py-2 text-sm text-gray-400 italic" colSpan={5}>
          No labour required
        </td>
        <td className="px-3 py-2 text-center">
          <button
            onClick={onRemoveNA}
            disabled={isLoading}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            {isLoading ? '...' : 'Undo'}
          </button>
        </td>
      </tr>
    )
  }

  const rowClass = editState.saveSuccess
    ? 'bg-green-50 transition-colors duration-500 border-l-4 border-l-purple-200'
    : editState.error
      ? 'bg-red-50 border-l-4 border-l-purple-200'
      : 'bg-white border-l-4 border-l-purple-200 hover:bg-gray-50'

  return (
    <tr className={rowClass}>
      {/* RAG Status */}
      <td className="px-3 py-2 text-center">
        <span className={`inline-block w-3 h-3 rounded-full ${
          item.ragStatus === 'red' ? 'bg-red-500' :
          item.ragStatus === 'amber' ? 'bg-amber-500' :
          'bg-gray-300'
        }`} />
      </td>

      {/* Item Name with tree connector */}
      <td className="px-3 py-2 text-sm text-gray-600">
        <div className="flex items-center gap-2 pl-6">
          <span className="text-gray-400 font-mono text-xs">{treeConnector}</span>
          <span>{displayName}</span>
        </div>
      </td>

      {/* Labour code (locked — derived from the work group's Repair Type) */}
      <td className="px-3 py-2 text-sm text-gray-600">
        {lockedCode ? lockedCode.code : <span className="text-amber-600 text-xs">Set type</span>}
      </td>

      {/* Hours Input */}
      <td className="px-3 py-2">
        <input
          ref={(el) => registerRef(hoursRefKey, el)}
          type="number"
          step="0.1"
          min="0"
          value={localHours}
          onChange={(e) => handleHoursChange(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'hours')}
          onBlur={handleBlur}
          disabled={editState.isSaving}
          placeholder="0.0"
          className={`w-full px-2 py-1.5 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Rate */}
      <td className="px-3 py-2 text-sm text-gray-600 text-right">
        {localCode ? `£${rate.toFixed(2)}` : '—'}
      </td>

      {/* Discount % */}
      <td className="px-3 py-2">
        <input
          type="number"
          step="1"
          min="0"
          max="100"
          value={localDiscount}
          onChange={(e) => handleDiscountChange(e.target.value)}
          onBlur={handleBlur}
          disabled={editState.isSaving || !localCode}
          placeholder="0"
          className={`w-full px-2 py-1.5 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving || !localCode ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Total */}
      <td className="px-3 py-2 text-sm font-medium text-gray-900 text-right">
        {localCode && hoursNum > 0 ? `£${total.toFixed(2)}` : '—'}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        <div className="flex items-center justify-center gap-1">
          {editState.isSaving ? (
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          ) : editState.saveSuccess || (hasLabour && !isDirty) ? (
            <>
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {hasLabour && !isDirty && (
                <button
                  onClick={() => onDelete(existingLabour.id)}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </>
          ) : isDirty ? (
            <>
              {localCode && localHours && parseFloat(localHours) > 0 && (
                <button
                  onClick={() => handleSave(false)}
                  className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                  title="Save (Enter)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
              <button
                onClick={handleClear}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                title="Clear (Esc)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {/* Fix 4: N/A button shown when no labour saved yet */}
              {!hasLabour && (
                <Tooltip content="No labour required">
                  <button
                    onClick={onMarkNA}
                    disabled={isLoading}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
                  >
                    {isLoading ? (
                      <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    )}
                  </button>
                </Tooltip>
              )}
            </>
          ) : (
            <Tooltip content="No labour required">
              <button
                onClick={onMarkNA}
                disabled={isLoading}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                )}
              </button>
            </Tooltip>
          )}
        </div>
        {editState.error && (
          <div className="text-xs text-red-600 mt-1">{editState.error}</div>
        )}
      </td>
    </tr>
  )
}

// ============================================================================
// INLINE LABOUR ROW COMPONENT (Regular non-group row)
// ============================================================================

interface InlineLabourRowProps {
  onSetRepairType: (repairTypeId: string) => void
  item: ChecklistItem
  rowIndex: number
  labourCodes: LabourCode[]
  repairTypes: RepairTypeOpt[]
  repairTypeId: string | null
  editState: RowEditState
  isLoading: boolean
  onUpdateEditState: (updates: Partial<RowEditState>) => void
  onSave: (hours: string, existingLabourId?: string, discountPercent?: number) => Promise<boolean>
  onMarkNA: () => void
  onRemoveNA: () => void
  onDelete: (labourId: string) => void
  onClear: () => void
  registerRef: (key: string, element: HTMLElement | null) => void
  focusNext: (currentKey: string) => void
  focusPrev: (currentKey: string) => void
}

function InlineLabourRow({
  onSetRepairType,
  item,
  rowIndex,
  labourCodes,
  repairTypes,
  repairTypeId,
  editState,
  isLoading,
  onUpdateEditState,
  onSave,
  onMarkNA,
  onRemoveNA,
  onDelete,
  onClear,
  registerRef,
  focusNext,
  focusPrev
}: InlineLabourRowProps) {
  const hasLabour = item.labourEntries.length > 0
  const existingLabour = item.labourEntries[0]
  const isNA = item.status === 'na'

  // Local state for inputs (synced with editState but allows immediate updates)
  const repairType = repairTypes.find(rt => rt.id === repairTypeId) || null
  const lockedCode = repairType?.defaultLabourCodeId ? (labourCodes.find(c => c.id === repairType.defaultLabourCodeId) || null) : null
  const localCode = lockedCode?.id || ''
  // The Repair Type's standing discount pre-fills new labour lines (still overridable per line).
  const typeDefaultDiscountStr = String(repairType?.defaultDiscountPercent || 0)
  const [localHours, setLocalHours] = useState(existingLabour?.hours?.toString() || editState.hours)
  const [localDiscount, setLocalDiscount] = useState(existingLabour?.discountPercent?.toString() ?? typeDefaultDiscountStr)

  // Track if save was triggered by keyboard (to prevent double-save from blur)
  const saveTriggeredRef = useRef(false)

  // Track if we have unsaved changes
  const isDirty = hasLabour
    ? localHours !== existingLabour.hours.toString() || localDiscount !== (existingLabour.discountPercent?.toString() || '0')
    : localHours !== ''

  // Get selected labour code for rate calculation
  const rate = lockedCode?.hourlyRate || existingLabour?.rate || 0
  const hoursNum = parseFloat(localHours) || 0
  const discountPct = parseFloat(localDiscount) || 0
  const subtotal = hoursNum * rate
  const total = subtotal * (1 - discountPct / 100)

  // Ref keys for focus management
  const codeRefKey = `${rowIndex}-code`
  const hoursRefKey = `${rowIndex}-hours`

  // Sync local state with existing labour when data changes
  useEffect(() => {
    if (existingLabour && !editState.isDirty) {
      setLocalHours(existingLabour.hours.toString())
      setLocalDiscount(existingLabour.discountPercent?.toString() || '0')
    } else if (!existingLabour && !editState.isDirty) {
      // New line: keep the discount synced to the Repair Type's default until the user edits it.
      setLocalDiscount(typeDefaultDiscountStr)
    }
  }, [existingLabour, editState.isDirty, typeDefaultDiscountStr])

  const handleHoursChange = (value: string) => {
    setLocalHours(value)
    onUpdateEditState({ hours: value, isDirty: true })
  }

  const handleDiscountChange = (value: string) => {
    setLocalDiscount(value)
    onUpdateEditState({ isDirty: true })
  }

  const handleSave = async (moveToNext = false) => {
    // Prevent double-save if already saving
    if (editState.isSaving) return
    if (!lockedCode || !localHours || parseFloat(localHours) <= 0) return

    saveTriggeredRef.current = true
    const success = await onSave(localHours, existingLabour?.id, parseFloat(localDiscount) || 0)

    if (success && moveToNext) {
      // Use setTimeout to let React re-render first, then focus next
      setTimeout(() => {
        focusNext(hoursRefKey)
      }, 50)
    }

    // Reset flag after a short delay
    setTimeout(() => {
      saveTriggeredRef.current = false
    }, 100)
  }

  const handleClear = () => {
    if (existingLabour) {
      // Revert to saved values
      setLocalHours(existingLabour.hours.toString())
      setLocalDiscount(existingLabour.discountPercent?.toString() || '0')
    } else {
      // Clear inputs
      setLocalHours('')
      setLocalDiscount(typeDefaultDiscountStr)
    }
    onClear()
  }

  const handleKeyDown = (e: React.KeyboardEvent, inputType: 'code' | 'hours') => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (localCode && localHours && parseFloat(localHours) > 0) {
        handleSave(true)
      } else if (inputType === 'code' && localCode) {
        // Move to hours input
        focusNext(codeRefKey)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleClear()
    } else if (e.key === 'Tab') {
      if (e.shiftKey) {
        // Shift+Tab - move to previous input
        if (inputType === 'code') {
          // At code input, let browser handle to go to previous row's hours
          focusPrev(codeRefKey)
        }
        // From hours, let default Tab behavior move to code
      } else if (inputType === 'hours') {
        // Tab from hours - auto-save if valid before moving on
        if (isDirty && localCode && localHours && parseFloat(localHours) > 0) {
          // Don't prevent default - let tab navigate naturally
          // Save will happen, focus moves via browser Tab behavior
          handleSave(false)
        }
      }
    }
  }

  const handleBlur = () => {
    // Skip if save was already triggered by keyboard or if already saving
    if (saveTriggeredRef.current || editState.isSaving) return

    // Auto-save on blur if we have valid data and changes
    if (isDirty && localCode && localHours && parseFloat(localHours) > 0) {
      handleSave(false)
    }
  }

  // N/A state row
  if (isNA) {
    return (
      <tr className="bg-gray-50">
        <td className="px-3 py-3 text-center">
          <span className={`inline-block w-3 h-3 rounded-full ${
            item.ragStatus === 'red' ? 'bg-red-500' :
            item.ragStatus === 'amber' ? 'bg-amber-500' :
            'bg-gray-300'
          }`} />
        </td>
        <td className="px-3 py-3 text-sm text-gray-900">
          {item.repairItem.name}
        </td>
        <td className="px-3 py-3 text-sm text-gray-400 italic" colSpan={5}>
          No labour required
        </td>
        <td className="px-3 py-3 text-center">
          <button
            onClick={() => {
              console.log('Undo clicked')
              onRemoveNA()
            }}
            disabled={isLoading}
            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded border border-gray-300 disabled:opacity-50"
          >
            {isLoading ? '...' : 'Undo'}
          </button>
        </td>
      </tr>
    )
  }

  // Row with success animation
  const rowClass = editState.saveSuccess
    ? 'bg-green-50 transition-colors duration-500'
    : editState.error
      ? 'bg-red-50'
      : 'hover:bg-gray-50'

  return (
    <tr className={rowClass}>
      {/* RAG Status */}
      <td className="px-3 py-2 text-center">
        <span className={`inline-block w-3 h-3 rounded-full ${
          item.ragStatus === 'red' ? 'bg-red-500' :
          item.ragStatus === 'amber' ? 'bg-amber-500' :
          'bg-gray-300'
        }`} />
      </td>

      {/* Item Name + Repair Type (single item — drives the locked labour rate) */}
      <td className="px-3 py-2 text-sm text-gray-900">
        <div className="flex flex-col gap-1">
          <span>{item.repairItem.name}</span>
          <select
            value={repairTypeId || ''}
            onChange={(e) => onSetRepairType(e.target.value)}
            className="px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary bg-white w-fit"
          >
            <option value="">Repair Type…</option>
            {repairTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.code}</option>)}
          </select>
        </div>
      </td>

      {/* Labour code (locked — derived from the work group's Repair Type) */}
      <td className="px-3 py-2 text-sm text-gray-600">
        {lockedCode ? lockedCode.code : <span className="text-amber-600 text-xs">Set type</span>}
      </td>

      {/* Hours Input */}
      <td className="px-3 py-2">
        <input
          ref={(el) => registerRef(hoursRefKey, el)}
          type="number"
          step="0.1"
          min="0"
          value={localHours}
          onChange={(e) => handleHoursChange(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'hours')}
          onBlur={handleBlur}
          disabled={editState.isSaving}
          placeholder="0.0"
          className={`w-full px-2 py-1.5 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Rate */}
      <td className="px-3 py-2 text-sm text-gray-600 text-right">
        {localCode ? `£${rate.toFixed(2)}` : '—'}
      </td>

      {/* Discount % */}
      <td className="px-3 py-2">
        <input
          type="number"
          step="1"
          min="0"
          max="100"
          value={localDiscount}
          onChange={(e) => handleDiscountChange(e.target.value)}
          onBlur={handleBlur}
          disabled={editState.isSaving || !localCode}
          placeholder="0"
          className={`w-full px-2 py-1.5 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving || !localCode ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Total */}
      <td className="px-3 py-2 text-sm font-medium text-gray-900 text-right">
        {localCode && hoursNum > 0 ? `£${total.toFixed(2)}` : '—'}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        <div className="flex items-center justify-center gap-1">
          {editState.isSaving ? (
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          ) : editState.saveSuccess || (hasLabour && !isDirty) ? (
            // Fix 2: Persistent green tick when saved and no pending changes
            <>
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {/* Delete button next to green tick */}
              {hasLabour && !isDirty && (
                <button
                  onClick={() => onDelete(existingLabour.id)}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </>
          ) : isDirty ? (
            <>
              {/* Save button - shown when dirty */}
              {localCode && localHours && parseFloat(localHours) > 0 && (
                <button
                  onClick={() => handleSave(false)}
                  className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                  title="Save (Enter)"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
              {/* Clear button */}
              <button
                onClick={handleClear}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                title="Clear (Esc)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {/* Fix 4: N/A button shown when no labour saved yet */}
              {!hasLabour && (
                <Tooltip content="No labour required">
                  <button
                    onClick={() => {
                      console.log('N/A button clicked (isDirty branch)')
                      console.log('onMarkNA type:', typeof onMarkNA)
                      try {
                        onMarkNA()
                        console.log('onMarkNA called successfully')
                      } catch (err) {
                        console.error('Error calling onMarkNA:', err)
                      }
                    }}
                    disabled={isLoading}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
                  >
                    {isLoading ? (
                      <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    )}
                  </button>
                </Tooltip>
              )}
            </>
          ) : (
            /* N/A button shown when no activity */
            <Tooltip content="No labour required">
              <button
                onClick={() => {
                  console.log('N/A button clicked (else branch)')
                  onMarkNA()
                }}
                disabled={isLoading}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                )}
              </button>
            </Tooltip>
          )}
        </div>
        {/* Error tooltip */}
        {editState.error && (
          <div className="text-xs text-red-600 mt-1">{editState.error}</div>
        )}
      </td>
    </tr>
  )
}

// ============================================================================
// ADD OTHER LABOUR MODAL (Kept for items not in checklist)
// ============================================================================

interface AddOtherLabourModalProps {
  healthCheckId: string
  labourCodes: LabourCode[]
  repairTypes: RepairTypeOpt[]
  onClose: () => void
  onSaved: () => void
}

function AddOtherLabourModal({
  healthCheckId,
  labourCodes,
  repairTypes,
  onClose,
  onSaved
}: AddOtherLabourModalProps) {
  const { session } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [itemName, setItemName] = useState('')
  const [selectedRepairTypeId, setSelectedRepairTypeId] = useState('')
  const [hours, setHours] = useState('1.0')
  const [notes, setNotes] = useState('')

  // Rate is locked to the chosen Repair Type's default labour code (the server resolves it too).
  const selectedRepairType = repairTypes.find(rt => rt.id === selectedRepairTypeId) || null
  const lockedCode = selectedRepairType?.defaultLabourCodeId
    ? (labourCodes.find(c => c.id === selectedRepairType.defaultLabourCodeId) || null)
    : null
  const rate = lockedCode?.hourlyRate || 0
  // The line inherits the Repair Type's default discount server-side; mirror it in the preview.
  const typeDiscountPct = selectedRepairType?.defaultDiscountPercent || 0
  const total = parseFloat(hours) * rate * (1 - typeDiscountPct / 100)

  // Default to the first repair type
  useEffect(() => {
    if (repairTypes.length > 0 && !selectedRepairTypeId) {
      setSelectedRepairTypeId(repairTypes[0].id)
    }
  }, [repairTypes, selectedRepairTypeId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken || !itemName.trim() || !selectedRepairTypeId) return

    setSaving(true)
    setError(null)

    try {
      // Step 1: Create the repair item with its Repair Type (drives the labour rate)
      const itemRes = await api<{ id: string }>(`/api/v1/health-checks/${healthCheckId}/repair-items`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          name: itemName.trim(),
          description: 'Additional labour item',
          repairTypeId: selectedRepairTypeId
        }
      })

      // Step 2: Add labour — rate is resolved server-side from the item's Repair Type
      await api(`/api/v1/repair-items/${itemRes.id}/labour`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          hours: parseFloat(hours),
          notes: notes.trim() || null
        }
      })

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add labour')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Add Other Labour</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded text-sm">
              {error}
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-600">
            Use this to add labour for items not listed above (e.g., diagnostic time, additional work discovered).
          </div>

          {repairTypes.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 p-4 rounded text-sm">
              <p className="font-medium">No repair types configured</p>
              <p className="mt-1">Please create repair types in Settings &gt; Repair Types before adding labour entries.</p>
            </div>
          )}

          {/* Item Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={itemName}
              onChange={e => setItemName(e.target.value)}
              placeholder="e.g., Diagnostic Time, Additional Inspection"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* Labour Code and Rate */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Repair Type
              </label>
              <select
                value={selectedRepairTypeId}
                onChange={e => setSelectedRepairTypeId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                {repairTypes.map(rt => (
                  <option key={rt.id} value={rt.id}>
                    {rt.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rate
              </label>
              <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded text-gray-700">
                £{rate.toFixed(2)}/hr
              </div>
            </div>
          </div>

          {/* Hours and Total */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Hours
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={hours}
                onChange={e => setHours(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total
              </label>
              <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded font-medium text-gray-900">
                £{total.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Any additional notes..."
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || repairTypes.length === 0 || !selectedRepairTypeId || !itemName.trim()}
              className="flex-1 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Labour'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
