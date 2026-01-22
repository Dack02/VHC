/**
 * PartsTab Component
 * Inline-editable checklist workflow for managing parts entries on health check repair items
 *
 * Features:
 * - Inline editing with tab navigation for rapid data entry
 * - Auto-save on blur/Enter
 * - Keyboard navigation: Tab, Shift+Tab, Enter, Escape
 * - Expandable/collapsible group hierarchy
 * - Individual parts on group OR children
 * - Margin calculation per line
 * - "No parts required" functionality
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, NewRepairItem, RepairPart, Supplier, PricingSettings, RepairItemChild } from '../../../lib/api'
import { Tooltip } from '../../../components/ui/Tooltip'

interface PartsTabProps {
  healthCheckId: string
  onUpdate: () => void
}

// Row edit state for inline editing - keyed by partId or new row key
interface RowEditState {
  rowKey: string                    // Key matching PartRow.rowKey
  repairItemId: string
  partNumber: string
  description: string
  quantity: string
  supplierId: string
  costPrice: string
  sellPrice: string
  allocationType: 'shared' | 'direct'  // For new parts
  isDirty: boolean
  isSaving: boolean
  error: string | null
  saveSuccess: boolean
}

export function PartsTab({ healthCheckId, onUpdate }: PartsTabProps) {
  const { session, user, refreshSession } = useAuth()
  const [repairItems, setRepairItems] = useState<NewRepairItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [pricingSettings, setPricingSettings] = useState<PricingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingComplete, setMarkingComplete] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showOtherPartModal, setShowOtherPartModal] = useState(false)

  // Expand/collapse state for groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Expand/collapse state for sections within a group (shared parts, individual concerns)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  // New part entry rows - keyed by repairItemId-sectionType, value is count of new rows
  const [newPartRows, setNewPartRows] = useState<Map<string, number>>(new Map())

  // Row edit states for inline editing - keyed by partId or new-{repairItemId}-{sectionType}-{index}
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

  // Toggle section expansion (within a group: shared parts, individual concerns)
  const toggleSection = useCallback((sectionKey: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionKey)) {
        next.delete(sectionKey)
      } else {
        next.add(sectionKey)
      }
      return next
    })
  }, [])

  // Add a new part row for a specific section
  const addNewPartRow = useCallback((repairItemId: string, sectionType: 'shared' | 'direct' | 'standalone') => {
    const key = `${repairItemId}-${sectionType}`
    setNewPartRows(prev => {
      const next = new Map(prev)
      const current = next.get(key) || 0
      next.set(key, current + 1)
      return next
    })
    // Auto-expand the section when adding a part
    const sectionKey = `${repairItemId}-${sectionType}`
    setExpandedSections(prev => new Set(prev).add(sectionKey))
  }, [])

  // Remove a new part row (cancel without saving)
  const removeNewPartRow = useCallback((repairItemId: string, sectionType: 'shared' | 'direct' | 'standalone', index: number) => {
    const key = `${repairItemId}-${sectionType}`
    setNewPartRows(prev => {
      const next = new Map(prev)
      const current = next.get(key) || 0
      if (current > 0) {
        next.set(key, current - 1)
      }
      return next
    })
    // Clear the edit state for this new row
    const rowKey = `new-${repairItemId}-${sectionType}-${index}`
    setEditStates(prev => {
      const next = new Map(prev)
      next.delete(rowKey)
      return next
    })
  }, [])

  // Clear all new part rows after successful save/refetch
  const clearNewPartRows = useCallback(() => {
    setNewPartRows(new Map())
  }, [])

  // Fetch repair items, suppliers, and pricing settings
  useEffect(() => {
    const fetchData = async () => {
      if (!session?.accessToken || !user?.organization?.id) return

      setLoading(true)
      setError(null)

      try {
        const [itemsRes, suppliersRes, pricingRes] = await Promise.all([
          api<{ repairItems: NewRepairItem[] }>(
            `/api/v1/health-checks/${healthCheckId}/repair-items`,
            { token: session.accessToken }
          ),
          api<{ suppliers: Supplier[] }>(
            `/api/v1/organizations/${user.organization.id}/suppliers`,
            { token: session.accessToken }
          ),
          api<{ settings: PricingSettings }>(
            `/api/v1/organizations/${user.organization.id}/pricing-settings`,
            { token: session.accessToken }
          )
        ])

        setRepairItems(itemsRes.repairItems || [])
        setSuppliers(suppliersRes.suppliers || [])
        setPricingSettings(pricingRes.settings || null)
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
    if (item.checkResults && item.checkResults.length > 0) {
      const hasRed = item.checkResults.some(cr => cr.ragStatus === 'red')
      const hasAmber = item.checkResults.some(cr => cr.ragStatus === 'amber')
      return hasRed ? 'red' : hasAmber ? 'amber' : null
    }
    return null
  }

  // Calculate progress (excluding expanded children from count to avoid confusion)
  const progress = useMemo(() => {
    let total = 0
    let completed = 0

    repairItems.forEach(item => {
      const isGroup = item.isGroup && item.children && item.children.length > 0

      if (isGroup) {
        // For groups, count group + all children
        const groupParts = item.parts || []
        const groupDone = item.noPartsRequired || groupParts.length > 0

        const children = item.children || []
        const allChildrenDone = children.every(child =>
          child.noPartsRequired || (child.parts && child.parts.length > 0)
        )

        // Group counts as 1 item
        total++
        // Group is complete if either: group has parts OR all children have parts
        if (groupDone || allChildrenDone) {
          completed++
        }
      } else {
        total++
        const parts = item.parts || []
        if (item.noPartsRequired || parts.length > 0) {
          completed++
        }
      }
    })

    return { completed, total }
  }, [repairItems])

  // Calculate totals including children's parts
  const totals = useMemo(() => {
    let totalCost = 0
    let totalSell = 0

    repairItems.forEach(item => {
      // Group's own parts
      const partEntries = item.parts || []
      partEntries.forEach((entry: RepairPart) => {
        totalCost += entry.costPrice * entry.quantity
        totalSell += entry.lineTotal
      })

      // Options parts
      const options = item.options || []
      options.forEach(option => {
        const optionParts = option.parts || []
        optionParts.forEach((entry: RepairPart) => {
          totalCost += entry.costPrice * entry.quantity
          totalSell += entry.lineTotal
        })
      })

      // Children's parts (for groups)
      if (item.isGroup && item.children) {
        item.children.forEach(child => {
          const childParts = child.parts || []
          childParts.forEach((entry: RepairPart) => {
            totalCost += entry.costPrice * entry.quantity
            totalSell += entry.lineTotal
          })
        })
      }
    })

    const margin = totalSell - totalCost
    const marginPercent = totalSell > 0 ? (margin / totalSell) * 100 : 0

    return { totalCost, totalSell, margin, marginPercent }
  }, [repairItems])

  // Calculate group total (group parts + all children parts)
  const calculateGroupTotal = useCallback((item: NewRepairItem): number => {
    let groupTotal = 0

    // Group's own parts
    const itemParts = item.parts || []
    itemParts.forEach((entry: RepairPart) => {
      groupTotal += entry.lineTotal
    })

    // Children's parts
    if (item.children) {
      item.children.forEach(child => {
        const childParts = child.parts || []
        childParts.forEach((entry: RepairPart) => {
          groupTotal += entry.lineTotal
        })
      })
    }

    return groupTotal
  }, [])

  // Check if all items are actioned
  const allActioned = progress.completed === progress.total && progress.total > 0

  // Check if already marked complete
  const allPartsComplete = repairItems.every(item => item.partsStatus === 'complete')

  const refetchData = useCallback(async () => {
    if (!session?.accessToken) return
    const itemsRes = await api<{ repairItems: NewRepairItem[] }>(
      `/api/v1/health-checks/${healthCheckId}/repair-items`,
      { token: session.accessToken }
    )
    setRepairItems(itemsRes.repairItems || [])
    // Clear new part rows after successful refetch
    clearNewPartRows()
    onUpdate()
  }, [session?.accessToken, healthCheckId, onUpdate, clearNewPartRows])

  // Get or initialize edit state for a row (keyed by rowKey)
  const getEditState = useCallback((rowKey: string, repairItemId: string, part?: RepairPart, allocationType: 'shared' | 'direct' = 'direct'): RowEditState => {
    const existing = editStates.get(rowKey)
    if (existing) return existing

    // Initialize from existing part or empty
    return {
      rowKey,
      repairItemId,
      partNumber: part?.partNumber || '',
      description: part?.description || '',
      quantity: part?.quantity?.toString() || '1',
      supplierId: part?.supplierId || '',
      costPrice: part?.costPrice?.toString() || '',
      sellPrice: part?.sellPrice?.toString() || '',
      allocationType: part?.allocationType || allocationType,
      isDirty: false,
      isSaving: false,
      error: null,
      saveSuccess: false
    }
  }, [editStates])

  // Update edit state for a row (keyed by rowKey)
  const updateEditState = useCallback((rowKey: string, repairItemId: string, updates: Partial<RowEditState>) => {
    setEditStates(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(rowKey) || {
        rowKey,
        repairItemId,
        partNumber: '',
        description: '',
        quantity: '1',
        supplierId: '',
        costPrice: '',
        sellPrice: '',
        allocationType: 'direct' as const,
        isDirty: false,
        isSaving: false,
        error: null,
        saveSuccess: false
      }
      newMap.set(rowKey, { ...existing, ...updates })
      return newMap
    })
  }, [])

  // Clear edit state for a row (keyed by rowKey)
  const clearEditState = useCallback((rowKey: string) => {
    setEditStates(prev => {
      const newMap = new Map(prev)
      newMap.delete(rowKey)
      return newMap
    })
  }, [])

  // Save part for a row
  const saveRowPart = useCallback(async (
    rowKey: string,
    repairItemId: string,
    partData: {
      partNumber: string
      description: string
      quantity: string
      supplierId: string
      costPrice: string
      sellPrice: string
      allocationType?: 'shared' | 'direct'
    },
    existingPartId?: string
  ) => {
    if (!session?.accessToken) return false

    const qty = parseFloat(partData.quantity) || 1
    const costPriceNum = parseFloat(partData.costPrice)
    const sellPriceNum = parseFloat(partData.sellPrice)

    if (!partData.description || isNaN(costPriceNum) || isNaN(sellPriceNum)) {
      return false
    }

    updateEditState(rowKey, repairItemId, { isSaving: true, error: null })

    try {
      if (existingPartId) {
        // Update existing part
        await api(`/api/v1/repair-parts/${existingPartId}`, {
          method: 'PATCH',
          token: session.accessToken,
          body: {
            part_number: partData.partNumber?.trim() || null,
            description: partData.description.trim(),
            quantity: qty,
            supplier_id: partData.supplierId || null,
            cost_price: costPriceNum,
            sell_price: sellPriceNum,
            allocation_type: partData.allocationType || 'direct'
          }
        })
      } else {
        // Create new part
        await api(`/api/v1/repair-items/${repairItemId}/parts`, {
          method: 'POST',
          token: session.accessToken,
          body: {
            part_number: partData.partNumber?.trim() || null,
            description: partData.description.trim(),
            quantity: qty,
            supplier_id: partData.supplierId || null,
            cost_price: costPriceNum,
            sell_price: sellPriceNum,
            allocation_type: partData.allocationType || 'direct'
          }
        })
      }

      // Show success state
      updateEditState(rowKey, repairItemId, { isSaving: false, isDirty: false, saveSuccess: true })

      await refetchData()
      return true
    } catch (err) {
      updateEditState(rowKey, repairItemId, {
        isSaving: false,
        error: err instanceof Error ? err.message : 'Failed to save'
      })
      return false
    }
  }, [session?.accessToken, updateEditState, refetchData])

  const handleMarkNoPartsRequired = async (repairItemId: string) => {
    if (!session?.accessToken) {
      return
    }

    setActionLoading(repairItemId)

    try {
      await api(`/api/v1/repair-items/${repairItemId}/no-parts-required`, {
        method: 'POST',
        token: session.accessToken
      })
      clearEditState(repairItemId)
      await refetchData()
    } catch (err) {
      if (err instanceof Error && (err.message.includes('expired') || err.message.includes('Invalid'))) {
        try {
          await refreshSession()
          setError('Session refreshed. Please try again.')
        } catch {
          setError('Session expired. Please refresh the page.')
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to mark as no parts required')
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleRemoveNoPartsRequired = async (repairItemId: string) => {
    if (!session?.accessToken) {
      return
    }
    setActionLoading(repairItemId)

    try {
      await api(`/api/v1/repair-items/${repairItemId}/no-parts-required`, {
        method: 'DELETE',
        token: session.accessToken
      })
      await refetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove no parts required')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeletePart = async (partId: string, rowKey: string) => {
    if (!session?.accessToken) return
    if (!confirm('Are you sure you want to delete this part?')) return

    try {
      await api(`/api/v1/repair-parts/${partId}`, {
        method: 'DELETE',
        token: session.accessToken
      })
      clearEditState(rowKey)
      await refetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  // Change part allocation type (move between shared and direct)
  const handleChangeAllocation = async (
    partId: string,
    newAllocationType: 'shared' | 'direct',
    targetRepairItemId?: string
  ) => {
    if (!session?.accessToken) return

    setActionLoading(partId)
    try {
      await api(`/api/v1/repair-parts/${partId}/allocation`, {
        method: 'PATCH',
        token: session.accessToken,
        body: {
          allocation_type: newAllocationType,
          target_repair_item_id: targetRepairItemId
        }
      })
      await refetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change allocation')
    } finally {
      setActionLoading(null)
    }
  }

  const handleMarkAllComplete = async () => {
    if (!session?.accessToken || !allActioned) return

    setMarkingComplete(true)
    try {
      await Promise.all(
        repairItems.map(item =>
          api(`/api/v1/repair-items/${item.id}/parts-complete`, {
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

  const handlePartSaved = async () => {
    await refetchData()
  }

  const handleSupplierAdded = async (newSupplier: Supplier) => {
    setSuppliers(prev => [...prev, newSupplier])
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-1">No Repair Items</h3>
        <p className="text-gray-500">
          There are no red or amber items requiring parts. All checks passed!
        </p>
      </div>
    )
  }

  const defaultMargin = pricingSettings?.defaultMarginPercent || 40

  return (
    <div className="space-y-4">
      {/* Header with Progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium text-gray-900">Parts Checklist</h3>
          <span className={`text-sm px-2 py-1 rounded-full ${
            progress.completed === progress.total
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {progress.completed} of {progress.total} complete
          </span>
        </div>
        <div className="text-xs text-gray-500">
          Tab to navigate | Enter to save | Esc to cancel
        </div>
      </div>

      {/* Checklist Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[1100px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8">
                {/* RAG */}
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                Item
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                Part No
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                Description
              </th>
              <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                Qty
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                Supplier
              </th>
              <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                Cost
              </th>
              <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                Sell
              </th>
              <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                Margin
              </th>
              <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                Total
              </th>
              <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {repairItems.map((item, itemIndex) => {
              const isGroup = item.isGroup && item.children && item.children.length > 0
              const isExpanded = expandedGroups.has(item.id)
              const groupTotal = calculateGroupTotal(item)

              // Get all parts for group (shared) and count
              const sharedParts = (item.parts || []).filter(p => p.allocationType === 'shared' || !p.allocationType)
              const totalPartsCount = (item.parts?.length || 0) +
                (item.children?.reduce((acc, child) => acc + (child.parts?.length || 0), 0) || 0)

              if (isGroup) {
                // GROUP WITH CHILDREN
                const childCount = item.children?.length || 0
                const sharedSectionKey = `${item.id}-shared`
                const isSharedExpanded = expandedSections.has(sharedSectionKey)
                const newSharedRowCount = newPartRows.get(`${item.id}-shared`) || 0

                return (
                  <React.Fragment key={`group-${item.id}`}>
                    {/* GROUP HEADER ROW */}
                    <tr className="bg-gray-50">
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-block w-3 h-3 rounded-full ${
                          getRagStatus(item) === 'red' ? 'bg-red-500' :
                          getRagStatus(item) === 'amber' ? 'bg-amber-500' :
                          'bg-gray-300'
                        }`} />
                      </td>
                      <td className="px-2 py-2 text-sm text-gray-900" colSpan={8}>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleGroup(item.id)}
                            className="p-0.5 hover:bg-gray-200 rounded transition-colors"
                          >
                            <svg
                              className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          <span className="font-medium">{item.name}</span>
                          <span className="px-1.5 py-0.5 text-xs font-medium text-purple-700 bg-purple-100 rounded">
                            GROUP ({childCount})
                          </span>
                          <span className="text-xs text-gray-500">
                            {totalPartsCount} part{totalPartsCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-sm font-semibold text-gray-900 text-right">
                        {groupTotal > 0 ? `£${groupTotal.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => toggleGroup(item.id)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </button>
                      </td>
                    </tr>

                    {/* EXPANDED CONTENT */}
                    {isExpanded && (
                      <>
                        {/* SHARED PARTS SECTION */}
                        <tr className="bg-purple-50 border-l-4 border-l-purple-300">
                          <td className="px-2 py-2"></td>
                          <td className="px-2 py-2 text-sm" colSpan={8}>
                            <div className="flex items-center gap-2 pl-4">
                              <button
                                onClick={() => toggleSection(sharedSectionKey)}
                                className="p-0.5 hover:bg-purple-100 rounded transition-colors"
                              >
                                <svg
                                  className={`w-3 h-3 text-purple-600 transition-transform ${isSharedExpanded ? 'rotate-90' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                              <span className="text-purple-700 font-medium">Shared Parts</span>
                              <span className="px-1.5 py-0.5 text-xs text-purple-600 bg-purple-100 rounded">
                                {sharedParts.length}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-sm text-purple-700 text-right">
                            £{sharedParts.reduce((sum, p) => sum + p.lineTotal, 0).toFixed(2)}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              onClick={() => addNewPartRow(item.id, 'shared')}
                              className="text-xs text-purple-600 hover:text-purple-800 font-medium"
                            >
                              + Add
                            </button>
                          </td>
                        </tr>

                        {/* SHARED PARTS ROWS */}
                        {isSharedExpanded && (
                          <>
                            {sharedParts.map((part, partIdx) => {
                              const rowKey = part.id
                              return (
                                <MultiPartRow
                                  key={rowKey}
                                  rowKey={rowKey}
                                  repairItemId={item.id}
                                  part={part}
                                  isNew={false}
                                  sectionType="shared"
                                  rowIndex={itemIndex * 100 + partIdx}
                                  suppliers={suppliers}
                                  defaultMargin={defaultMargin}
                                  editState={getEditState(rowKey, item.id, part, 'shared')}
                                  isLoading={actionLoading === part.id}
                                  onUpdateEditState={(updates) => updateEditState(rowKey, item.id, updates)}
                                  onSave={(partData, existingPartId) => saveRowPart(rowKey, item.id, partData, existingPartId)}
                                  onDelete={() => handleDeletePart(part.id, rowKey)}
                                  onClear={() => clearEditState(rowKey)}
                                  onSupplierAdded={handleSupplierAdded}
                                  registerRef={registerRef}
                                  focusNext={focusNext}
                                  focusPrev={focusPrev}
                                  children={item.children}
                                  onChangeAllocation={handleChangeAllocation}
                                  indent={2}
                                />
                              )
                            })}
                            {/* New shared part rows */}
                            {Array.from({ length: newSharedRowCount }).map((_, idx) => {
                              const rowKey = `new-${item.id}-shared-${idx}`
                              return (
                                <MultiPartRow
                                  key={rowKey}
                                  rowKey={rowKey}
                                  repairItemId={item.id}
                                  part={null}
                                  isNew={true}
                                  sectionType="shared"
                                  rowIndex={itemIndex * 100 + sharedParts.length + idx}
                                  suppliers={suppliers}
                                  defaultMargin={defaultMargin}
                                  editState={getEditState(rowKey, item.id, undefined, 'shared')}
                                  isLoading={false}
                                  onUpdateEditState={(updates) => updateEditState(rowKey, item.id, updates)}
                                  onSave={(partData) => saveRowPart(rowKey, item.id, { ...partData, allocationType: 'shared' })}
                                  onDelete={() => removeNewPartRow(item.id, 'shared', idx)}
                                  onSupplierAdded={handleSupplierAdded}
                                  onClear={() => {
                                    clearEditState(rowKey)
                                    removeNewPartRow(item.id, 'shared', idx)
                                  }}
                                  registerRef={registerRef}
                                  focusNext={focusNext}
                                  focusPrev={focusPrev}
                                  indent={2}
                                />
                              )
                            })}
                          </>
                        )}

                        {/* CHILD CONCERN SECTIONS */}
                        {item.children?.map((child, childIdx) => {
                          const childSectionKey = `${child.id}-direct`
                          const isChildExpanded = expandedSections.has(childSectionKey)
                          const childParts = child.parts || []
                          const newChildRowCount = newPartRows.get(`${child.id}-direct`) || 0
                          const childTotal = childParts.reduce((sum, p) => sum + p.lineTotal, 0)
                          const childRag = getRagStatus(child)
                          const displayName = child.checkResults?.[0]?.templateItem?.name || child.name

                          return (
                            <React.Fragment key={`child-section-${child.id}`}>
                              {/* Child Section Header */}
                              <tr className="bg-gray-50 border-l-4 border-l-gray-200">
                                <td className="px-2 py-2 text-center">
                                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                                    childRag === 'red' ? 'bg-red-500' :
                                    childRag === 'amber' ? 'bg-amber-500' :
                                    'bg-gray-300'
                                  }`} />
                                </td>
                                <td className="px-2 py-2 text-sm" colSpan={8}>
                                  <div className="flex items-center gap-2 pl-4">
                                    <span className="text-gray-400">{childIdx === (item.children?.length || 0) - 1 ? '└─' : '├─'}</span>
                                    <button
                                      onClick={() => toggleSection(childSectionKey)}
                                      className="p-0.5 hover:bg-gray-200 rounded transition-colors"
                                    >
                                      <svg
                                        className={`w-3 h-3 text-gray-500 transition-transform ${isChildExpanded ? 'rotate-90' : ''}`}
                                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                      >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                    <span className="text-gray-700">{displayName}</span>
                                    <span className="px-1.5 py-0.5 text-xs text-gray-500 bg-gray-100 rounded">
                                      {childParts.length} part{childParts.length !== 1 ? 's' : ''}
                                    </span>
                                    {child.noPartsRequired && (
                                      <span className="px-1.5 py-0.5 text-xs text-gray-500 bg-gray-200 rounded italic">
                                        N/A
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-sm text-gray-700 text-right">
                                  {childTotal > 0 ? `£${childTotal.toFixed(2)}` : '—'}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {!child.noPartsRequired && (
                                      <button
                                        onClick={() => addNewPartRow(child.id, 'direct')}
                                        className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                                      >
                                        + Add
                                      </button>
                                    )}
                                    <Tooltip content={child.noPartsRequired ? "Undo no parts required" : "No parts required"}>
                                      <button
                                        onClick={() => child.noPartsRequired ? handleRemoveNoPartsRequired(child.id) : handleMarkNoPartsRequired(child.id)}
                                        disabled={actionLoading === child.id}
                                        className={`p-1 rounded disabled:opacity-50 ${
                                          child.noPartsRequired
                                            ? 'text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200'
                                            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                        }`}
                                      >
                                        {actionLoading === child.id ? (
                                          <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                                        ) : (
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                          </svg>
                                        )}
                                      </button>
                                    </Tooltip>
                                  </div>
                                </td>
                              </tr>

                              {/* Child Parts Rows */}
                              {isChildExpanded && !child.noPartsRequired && (
                                <>
                                  {childParts.map((part, partIdx) => {
                                    const rowKey = part.id
                                    return (
                                      <MultiPartRow
                                        key={rowKey}
                                        rowKey={rowKey}
                                        repairItemId={child.id}
                                        part={part}
                                        isNew={false}
                                        sectionType="direct"
                                        rowIndex={itemIndex * 100 + childIdx * 10 + partIdx}
                                        suppliers={suppliers}
                                        defaultMargin={defaultMargin}
                                        editState={getEditState(rowKey, child.id, part, 'direct')}
                                        isLoading={actionLoading === part.id}
                                        onUpdateEditState={(updates) => updateEditState(rowKey, child.id, updates)}
                                        onSave={(partData, existingPartId) => saveRowPart(rowKey, child.id, partData, existingPartId)}
                                        onDelete={() => handleDeletePart(part.id, rowKey)}
                                        onClear={() => clearEditState(rowKey)}
                                        onSupplierAdded={handleSupplierAdded}
                                        registerRef={registerRef}
                                        focusNext={focusNext}
                                        focusPrev={focusPrev}
                                        parentGroupId={item.id}
                                        onChangeAllocation={handleChangeAllocation}
                                        indent={3}
                                      />
                                    )
                                  })}
                                  {/* New child part rows */}
                                  {Array.from({ length: newChildRowCount }).map((_, idx) => {
                                    const rowKey = `new-${child.id}-direct-${idx}`
                                    return (
                                      <MultiPartRow
                                        key={rowKey}
                                        rowKey={rowKey}
                                        repairItemId={child.id}
                                        part={null}
                                        isNew={true}
                                        sectionType="direct"
                                        rowIndex={itemIndex * 100 + childIdx * 10 + childParts.length + idx}
                                        suppliers={suppliers}
                                        defaultMargin={defaultMargin}
                                        editState={getEditState(rowKey, child.id, undefined, 'direct')}
                                        isLoading={false}
                                        onUpdateEditState={(updates) => updateEditState(rowKey, child.id, updates)}
                                        onSave={(partData) => saveRowPart(rowKey, child.id, { ...partData, allocationType: 'direct' })}
                                        onDelete={() => removeNewPartRow(child.id, 'direct', idx)}
                                        onSupplierAdded={handleSupplierAdded}
                                        onClear={() => {
                                          clearEditState(rowKey)
                                          removeNewPartRow(child.id, 'direct', idx)
                                        }}
                                        registerRef={registerRef}
                                        focusNext={focusNext}
                                        focusPrev={focusPrev}
                                        indent={3}
                                      />
                                    )
                                  })}
                                </>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </>
                    )}
                  </React.Fragment>
                )
              } else {
                // NON-GROUP ITEM (Standalone)
                const standaloneKey = `${item.id}-standalone`
                const isStandaloneExpanded = expandedSections.has(standaloneKey)
                const standaloneParts = item.parts || []
                const newStandaloneRowCount = newPartRows.get(`${item.id}-standalone`) || 0
                const standaloneTotal = standaloneParts.reduce((sum, p) => sum + p.lineTotal, 0)
                const standaloneRag = getRagStatus(item)

                return (
                  <React.Fragment key={`standalone-${item.id}`}>
                    {/* Standalone Item Header */}
                    <tr className={`${item.noPartsRequired ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'}`}>
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-block w-3 h-3 rounded-full ${
                          standaloneRag === 'red' ? 'bg-red-500' :
                          standaloneRag === 'amber' ? 'bg-amber-500' :
                          'bg-gray-300'
                        }`} />
                      </td>
                      <td className="px-2 py-2 text-sm" colSpan={8}>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleSection(standaloneKey)}
                            className="p-0.5 hover:bg-gray-200 rounded transition-colors"
                          >
                            <svg
                              className={`w-4 h-4 text-gray-500 transition-transform ${isStandaloneExpanded ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          <span className="font-medium text-gray-900">{item.name}</span>
                          <span className="px-1.5 py-0.5 text-xs text-gray-500 bg-gray-100 rounded">
                            {standaloneParts.length} part{standaloneParts.length !== 1 ? 's' : ''}
                          </span>
                          {item.noPartsRequired && (
                            <span className="px-1.5 py-0.5 text-xs text-gray-500 bg-gray-200 rounded italic">
                              N/A
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-sm font-medium text-gray-900 text-right">
                        {standaloneTotal > 0 ? `£${standaloneTotal.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {!item.noPartsRequired && (
                            <button
                              onClick={() => addNewPartRow(item.id, 'standalone')}
                              className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                            >
                              + Add
                            </button>
                          )}
                          <Tooltip content={item.noPartsRequired ? "Undo no parts required" : "No parts required"}>
                            <button
                              onClick={() => item.noPartsRequired ? handleRemoveNoPartsRequired(item.id) : handleMarkNoPartsRequired(item.id)}
                              disabled={actionLoading === item.id}
                              className={`p-1 rounded disabled:opacity-50 ${
                                item.noPartsRequired
                                  ? 'text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200'
                                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                              }`}
                            >
                              {actionLoading === item.id ? (
                                <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                              )}
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>

                    {/* Standalone Parts Rows */}
                    {isStandaloneExpanded && !item.noPartsRequired && (
                      <>
                        {standaloneParts.map((part, partIdx) => {
                          const rowKey = part.id
                          return (
                            <MultiPartRow
                              key={rowKey}
                              rowKey={rowKey}
                              repairItemId={item.id}
                              part={part}
                              isNew={false}
                              sectionType="standalone"
                              rowIndex={itemIndex * 100 + partIdx}
                              suppliers={suppliers}
                              defaultMargin={defaultMargin}
                              editState={getEditState(rowKey, item.id, part, 'direct')}
                              isLoading={actionLoading === part.id}
                              onUpdateEditState={(updates) => updateEditState(rowKey, item.id, updates)}
                              onSave={(partData, existingPartId) => saveRowPart(rowKey, item.id, partData, existingPartId)}
                              onDelete={() => handleDeletePart(part.id, rowKey)}
                              onClear={() => clearEditState(rowKey)}
                              onSupplierAdded={handleSupplierAdded}
                              registerRef={registerRef}
                              focusNext={focusNext}
                              focusPrev={focusPrev}
                              indent={1}
                            />
                          )
                        })}
                        {/* New standalone part rows */}
                        {Array.from({ length: newStandaloneRowCount }).map((_, idx) => {
                          const rowKey = `new-${item.id}-standalone-${idx}`
                          return (
                            <MultiPartRow
                              key={rowKey}
                              rowKey={rowKey}
                              repairItemId={item.id}
                              part={null}
                              isNew={true}
                              sectionType="standalone"
                              rowIndex={itemIndex * 100 + standaloneParts.length + idx}
                              suppliers={suppliers}
                              defaultMargin={defaultMargin}
                              editState={getEditState(rowKey, item.id, undefined, 'direct')}
                              isLoading={false}
                              onUpdateEditState={(updates) => updateEditState(rowKey, item.id, updates)}
                              onSave={(partData) => saveRowPart(rowKey, item.id, { ...partData, allocationType: 'direct' })}
                              onDelete={() => removeNewPartRow(item.id, 'standalone', idx)}
                              onSupplierAdded={handleSupplierAdded}
                              onClear={() => {
                                clearEditState(rowKey)
                                removeNewPartRow(item.id, 'standalone', idx)
                              }}
                              registerRef={registerRef}
                              focusNext={focusNext}
                              focusPrev={focusPrev}
                              indent={1}
                            />
                          )
                        })}
                      </>
                    )}
                  </React.Fragment>
                )
              }
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Totals & Actions */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div className="space-y-1">
            <div className="flex gap-8">
              <div>
                <span className="text-sm text-gray-500">Total Cost:</span>
                <span className="ml-2 text-gray-700">£{totals.totalCost.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Total Sell:</span>
                <span className="ml-2 font-semibold">£{totals.totalSell.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-sm text-gray-500">Margin:</span>
                <span className="ml-2 text-green-600 font-medium">
                  £{totals.margin.toFixed(2)} ({totals.marginPercent.toFixed(1)}%)
                </span>
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
            disabled={markingComplete || allPartsComplete || !allActioned}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded transition-colors ${
              allPartsComplete
                ? 'bg-green-100 text-green-700 cursor-default'
                : allActioned
                  ? 'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {allPartsComplete ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Parts Complete
              </>
            ) : (
              <>
                {markingComplete ? 'Marking...' : 'Mark All Complete'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Add Other Part Button */}
      <button
        onClick={() => setShowOtherPartModal(true)}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add Other Part
      </button>

      {/* Add Other Part Modal */}
      {showOtherPartModal && (
        <AddOtherPartModal
          healthCheckId={healthCheckId}
          suppliers={suppliers}
          defaultMargin={defaultMargin}
          onClose={() => setShowOtherPartModal(false)}
          onSaved={handlePartSaved}
          onSupplierAdded={handleSupplierAdded}
        />
      )}
    </div>
  )
}

// ============================================================================
// PART DATA TYPE
// ============================================================================

interface PartData {
  partNumber: string
  description: string
  quantity: string
  supplierId: string
  costPrice: string
  sellPrice: string
}

// ============================================================================
// MULTI-PART ROW COMPONENT (For displaying/editing individual parts)
// ============================================================================

interface MultiPartRowProps {
  rowKey: string
  repairItemId: string
  part: RepairPart | null
  isNew: boolean
  sectionType: 'shared' | 'direct' | 'standalone'
  rowIndex: number
  suppliers: Supplier[]
  defaultMargin: number
  editState: RowEditState
  isLoading: boolean
  onUpdateEditState: (updates: Partial<RowEditState>) => void
  onSave: (partData: PartData & { allocationType?: 'shared' | 'direct' }, existingPartId?: string) => Promise<boolean>
  onDelete: () => void
  onClear: () => void
  registerRef: (key: string, element: HTMLElement | null) => void
  focusNext: (currentKey: string) => void
  focusPrev: (currentKey: string) => void
  indent?: number // Indentation level (1-3)
  children?: RepairItemChild[] // For allocation dropdown (move to specific concern)
  parentGroupId?: string // Parent group ID (for moving to shared)
  onChangeAllocation?: (partId: string, newType: 'shared' | 'direct', targetRepairItemId?: string) => void
  onSupplierAdded?: (supplier: Supplier) => void
}

function MultiPartRow({
  rowKey: _rowKey,
  repairItemId: _repairItemId,
  part,
  isNew,
  sectionType,
  rowIndex,
  suppliers,
  defaultMargin,
  editState,
  isLoading,
  onUpdateEditState,
  onSave,
  onDelete,
  onClear,
  registerRef,
  focusNext,
  focusPrev,
  indent = 1,
  children,
  parentGroupId,
  onChangeAllocation,
  onSupplierAdded
}: MultiPartRowProps) {
  const [localPartNumber, setLocalPartNumber] = useState(part?.partNumber || editState.partNumber || '')
  const [localDescription, setLocalDescription] = useState(part?.description || editState.description || '')
  const [localQuantity, setLocalQuantity] = useState(part?.quantity?.toString() || editState.quantity || '1')
  const [localSupplierId, setLocalSupplierId] = useState(part?.supplierId || editState.supplierId || '')
  const [localCostPrice, setLocalCostPrice] = useState(part?.costPrice?.toString() || editState.costPrice || '')
  const [localSellPrice, setLocalSellPrice] = useState(part?.sellPrice?.toString() || editState.sellPrice || '')
  const saveTriggeredRef = useRef(false)
  const [showAllocationMenu, setShowAllocationMenu] = useState(false)
  const [showQuickAddSupplierModal, setShowQuickAddSupplierModal] = useState(false)

  // Auto-calculate sell price when cost changes (if new part)
  useEffect(() => {
    if (!part && localCostPrice && !localSellPrice) {
      const cost = parseFloat(localCostPrice)
      if (!isNaN(cost) && cost > 0) {
        const sell = cost / (1 - defaultMargin / 100)
        setLocalSellPrice(sell.toFixed(2))
      }
    }
  }, [localCostPrice, localSellPrice, defaultMargin, part])

  // Sync with existing part data
  useEffect(() => {
    if (part && !editState.isDirty) {
      setLocalPartNumber(part.partNumber || '')
      setLocalDescription(part.description)
      setLocalQuantity(part.quantity.toString())
      setLocalSupplierId(part.supplierId || '')
      setLocalCostPrice(part.costPrice.toString())
      setLocalSellPrice(part.sellPrice.toString())
    }
  }, [part, editState.isDirty])

  const isDirty = part
    ? localPartNumber !== (part.partNumber || '') ||
      localDescription !== part.description ||
      localQuantity !== part.quantity.toString() ||
      localSupplierId !== (part.supplierId || '') ||
      localCostPrice !== part.costPrice.toString() ||
      localSellPrice !== part.sellPrice.toString()
    : localDescription !== '' || localCostPrice !== '' || localSellPrice !== ''

  const costNum = parseFloat(localCostPrice) || 0
  const sellNum = parseFloat(localSellPrice) || 0
  const qtyNum = parseFloat(localQuantity) || 1
  const marginPercent = sellNum > 0 ? ((sellNum - costNum) / sellNum) * 100 : 0
  const lineTotal = qtyNum * sellNum

  const descRefKey = `${rowIndex}-multipart-desc`
  const costRefKey = `${rowIndex}-multipart-cost`
  const sellRefKey = `${rowIndex}-multipart-sell`

  const handleChange = (field: keyof PartData, value: string) => {
    switch (field) {
      case 'partNumber':
        setLocalPartNumber(value)
        break
      case 'description':
        setLocalDescription(value)
        break
      case 'quantity':
        setLocalQuantity(value)
        break
      case 'supplierId':
        setLocalSupplierId(value)
        break
      case 'costPrice':
        setLocalCostPrice(value)
        const cost = parseFloat(value)
        if (!isNaN(cost) && cost > 0) {
          const sell = cost / (1 - defaultMargin / 100)
          setLocalSellPrice(sell.toFixed(2))
        }
        break
      case 'sellPrice':
        setLocalSellPrice(value)
        break
    }
    onUpdateEditState({ isDirty: true })
  }

  const handleSave = async (moveToNext = false) => {
    if (editState.isSaving) return
    if (!localDescription || !localCostPrice || !localSellPrice) return

    saveTriggeredRef.current = true
    const success = await onSave({
      partNumber: localPartNumber,
      description: localDescription,
      quantity: localQuantity,
      supplierId: localSupplierId,
      costPrice: localCostPrice,
      sellPrice: localSellPrice,
      allocationType: sectionType === 'shared' ? 'shared' : 'direct'
    }, part?.id)

    if (success && moveToNext) {
      setTimeout(() => focusNext(sellRefKey), 50)
    }

    setTimeout(() => {
      saveTriggeredRef.current = false
    }, 100)
  }

  const handleClear = () => {
    if (part) {
      setLocalPartNumber(part.partNumber || '')
      setLocalDescription(part.description)
      setLocalQuantity(part.quantity.toString())
      setLocalSupplierId(part.supplierId || '')
      setLocalCostPrice(part.costPrice.toString())
      setLocalSellPrice(part.sellPrice.toString())
    } else {
      setLocalPartNumber('')
      setLocalDescription('')
      setLocalQuantity('1')
      setLocalSupplierId('')
      setLocalCostPrice('')
      setLocalSellPrice('')
    }
    onClear()
  }

  const handleSupplierAddedFromModal = (newSupplier: Supplier) => {
    if (onSupplierAdded) {
      onSupplierAdded(newSupplier)
    }
    setLocalSupplierId(newSupplier.id)
  }

  const handleKeyDown = (e: React.KeyboardEvent, inputType: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (localDescription && localCostPrice && localSellPrice) {
        handleSave(true)
      } else if (inputType === 'desc' && localDescription) {
        focusNext(descRefKey)
      } else if (inputType === 'cost' && localCostPrice) {
        focusNext(costRefKey)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleClear()
    } else if (e.key === 'Tab' && !e.shiftKey && inputType === 'sell') {
      if (isDirty && localDescription && localCostPrice && localSellPrice) {
        handleSave(false)
      }
    } else if (e.key === 'Tab' && e.shiftKey && inputType === 'desc') {
      focusPrev(descRefKey)
    }
  }

  const handleBlur = () => {
    if (saveTriggeredRef.current || editState.isSaving) return
    if (isDirty && localDescription && localCostPrice && localSellPrice) {
      handleSave(false)
    }
  }

  // Indentation padding
  const indentClass = indent === 1 ? 'pl-4' : indent === 2 ? 'pl-8' : 'pl-12'
  const borderColor = sectionType === 'shared' ? 'border-l-purple-200' : 'border-l-gray-100'

  const rowClass = editState.saveSuccess
    ? `bg-green-50 transition-colors duration-500 border-l-4 ${borderColor}`
    : editState.error
      ? `bg-red-50 border-l-4 ${borderColor}`
      : `bg-white border-l-4 ${borderColor} hover:bg-gray-50`

  return (
    <tr className={rowClass}>
      {/* Indent spacer */}
      <td className="px-2 py-2"></td>

      {/* Part # with indentation */}
      <td className={`px-2 py-2 text-sm ${indentClass}`}>
        <input
          type="text"
          value={localPartNumber}
          onChange={(e) => handleChange('partNumber', e.target.value)}
          disabled={editState.isSaving}
          placeholder="Part #"
          className={`w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Description */}
      <td className="px-2 py-2" colSpan={2}>
        <input
          ref={(el) => registerRef(descRefKey, el)}
          type="text"
          value={localDescription}
          onChange={(e) => handleChange('description', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'desc')}
          disabled={editState.isSaving}
          placeholder="Description *"
          className={`w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Quantity */}
      <td className="px-2 py-2">
        <input
          type="number"
          step="1"
          min="1"
          value={localQuantity}
          onChange={(e) => handleChange('quantity', e.target.value)}
          disabled={editState.isSaving}
          className={`w-16 px-2 py-1 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Supplier */}
      <td className="px-2 py-2">
        <SupplierDropdown
          suppliers={suppliers}
          value={localSupplierId}
          onChange={(id) => handleChange('supplierId', id)}
          onAddNew={onSupplierAdded ? () => setShowQuickAddSupplierModal(true) : undefined}
          disabled={editState.isSaving}
          error={!!editState.error}
          compact
        />
        {showQuickAddSupplierModal && (
          <QuickAddSupplierModal
            onClose={() => setShowQuickAddSupplierModal(false)}
            onSupplierAdded={handleSupplierAddedFromModal}
          />
        )}
      </td>

      {/* Cost Price */}
      <td className="px-2 py-2">
        <input
          ref={(el) => registerRef(costRefKey, el)}
          type="number"
          step="0.01"
          min="0"
          value={localCostPrice}
          onChange={(e) => handleChange('costPrice', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'cost')}
          disabled={editState.isSaving}
          placeholder="0.00"
          className={`w-20 px-2 py-1 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Sell Price */}
      <td className="px-2 py-2">
        <input
          ref={(el) => registerRef(sellRefKey, el)}
          type="number"
          step="0.01"
          min="0"
          value={localSellPrice}
          onChange={(e) => handleChange('sellPrice', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'sell')}
          onBlur={handleBlur}
          disabled={editState.isSaving}
          placeholder="0.00"
          className={`w-20 px-2 py-1 text-sm border rounded text-right focus:outline-none focus:ring-2 focus:ring-primary ${
            editState.error ? 'border-red-300' : 'border-gray-300'
          } ${editState.isSaving ? 'bg-gray-100' : ''}`}
        />
      </td>

      {/* Margin % */}
      <td className="px-2 py-2 text-sm text-gray-600 text-right">
        {costNum > 0 && sellNum > 0 ? `${marginPercent.toFixed(1)}%` : '—'}
      </td>

      {/* Total */}
      <td className="px-2 py-2 text-sm font-medium text-gray-900 text-right">
        {localDescription && sellNum > 0 ? `£${lineTotal.toFixed(2)}` : '—'}
      </td>

      {/* Actions */}
      <td className="px-2 py-2">
        <div className="flex items-center justify-center gap-1 relative">
          {editState.isSaving ? (
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          ) : editState.saveSuccess || (part && !isDirty) ? (
            <>
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {part && !isDirty && (
                <>
                  {/* Allocation dropdown for groups */}
                  {onChangeAllocation && sectionType !== 'standalone' && (
                    <div className="relative">
                      <button
                        onClick={() => setShowAllocationMenu(!showAllocationMenu)}
                        className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                        title="Change allocation"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                      </button>
                      {showAllocationMenu && (
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-10 min-w-[160px]">
                          {sectionType === 'direct' && parentGroupId && (
                            <button
                              onClick={() => {
                                onChangeAllocation(part.id, 'shared', parentGroupId)
                                setShowAllocationMenu(false)
                              }}
                              className="block w-full px-3 py-2 text-left text-sm text-purple-700 hover:bg-purple-50"
                            >
                              Move to Shared
                            </button>
                          )}
                          {sectionType === 'shared' && children && children.length > 0 && (
                            <>
                              <div className="px-3 py-1 text-xs text-gray-500 border-b">Move to:</div>
                              {children.map(child => (
                                <button
                                  key={child.id}
                                  onClick={() => {
                                    onChangeAllocation(part.id, 'direct', child.id)
                                    setShowAllocationMenu(false)
                                  }}
                                  className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 truncate"
                                >
                                  {child.checkResults?.[0]?.templateItem?.name || child.name}
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={onDelete}
                    disabled={isLoading}
                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </>
              )}
            </>
          ) : isDirty ? (
            <>
              {localDescription && localCostPrice && localSellPrice && (
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
                title={isNew ? "Cancel" : "Clear (Esc)"}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          ) : isNew ? (
            <button
              onClick={handleClear}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="Cancel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
        {editState.error && (
          <div className="text-xs text-red-600 mt-1">{editState.error}</div>
        )}
      </td>
    </tr>
  )
}

// ============================================================================
// SEARCHABLE SUPPLIER DROPDOWN
// ============================================================================

interface SupplierDropdownProps {
  suppliers: Supplier[]
  value: string
  onChange: (supplierId: string) => void
  onAddNew?: () => void
  disabled?: boolean
  error?: boolean
  compact?: boolean // For inline table use
}

function SupplierDropdown({ suppliers, value, onChange, onAddNew, disabled, error, compact }: SupplierDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedSupplier = suppliers.find(s => s.id === value)

  const filteredSuppliers = useMemo(() => {
    if (!search.trim()) return suppliers
    const lower = search.toLowerCase()
    return suppliers.filter(s => s.name.toLowerCase().includes(lower))
  }, [suppliers, search])

  // Calculate dropdown position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      })
    }
  }, [isOpen])

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false)
        setSearch('')
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  const handleSelect = (supplierId: string) => {
    onChange(supplierId)
    setIsOpen(false)
    setSearch('')
  }

  const handleAddNew = () => {
    setIsOpen(false)
    setSearch('')
    onAddNew?.()
  }

  const baseClasses = compact
    ? 'w-full px-2 py-1 text-sm border rounded'
    : 'w-full px-3 py-2 border rounded'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`${baseClasses} text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-primary ${
          error ? 'border-red-300' : 'border-gray-300'
        } ${disabled ? 'bg-gray-100' : 'bg-white'}`}
      >
        <span className={selectedSupplier ? 'text-gray-900' : 'text-gray-500'}>
          {selectedSupplier?.name || 'Select...'}
        </span>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          className="bg-white border border-gray-200 rounded shadow-lg max-h-64 overflow-hidden"
        >
          {/* Search input */}
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search suppliers..."
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setIsOpen(false)
                  setSearch('')
                } else if (e.key === 'Enter' && filteredSuppliers.length === 1) {
                  handleSelect(filteredSuppliers[0].id)
                }
              }}
            />
          </div>

          {/* Options list */}
          <div className="max-h-44 overflow-y-auto">
            {/* Clear option */}
            {value && (
              <button
                type="button"
                onClick={() => handleSelect('')}
                className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 border-b border-gray-100"
              >
                Clear selection
              </button>
            )}

            {filteredSuppliers.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">No suppliers found</div>
            ) : (
              filteredSuppliers.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSelect(s.id)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                    s.id === value ? 'bg-primary/10 text-primary' : 'text-gray-900'
                  }`}
                >
                  {s.name}
                  {s.supplierTypeName && (
                    <span className="ml-2 text-xs text-gray-400">({s.supplierTypeName})</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Add new option */}
          {onAddNew && (
            <button
              type="button"
              onClick={handleAddNew}
              className="w-full px-3 py-2 text-left text-sm text-primary font-medium hover:bg-primary/5 border-t border-gray-100"
            >
              + Add new supplier...
            </button>
          )}
        </div>
      )}
    </>
  )
}

// ============================================================================
// QUICK ADD SUPPLIER MODAL
// ============================================================================

interface SupplierType {
  id: string
  name: string
  description: string | null
  isActive: boolean
  isSystem: boolean
  sortOrder: number
}

interface QuickAddSupplierModalProps {
  onClose: () => void
  onSupplierAdded: (supplier: Supplier) => void
}

function QuickAddSupplierModal({ onClose, onSupplierAdded }: QuickAddSupplierModalProps) {
  const { session, user } = useAuth()
  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  const [supplierTypes, setSupplierTypes] = useState<SupplierType[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch supplier types on mount
  useEffect(() => {
    const fetchTypes = async () => {
      if (!session?.accessToken || !user?.organization?.id) return
      try {
        const data = await api<{ supplierTypes: SupplierType[] }>(
          `/api/v1/organizations/${user.organization.id}/supplier-types`,
          { token: session.accessToken }
        )
        setSupplierTypes(data.supplierTypes || [])
      } catch {
        // Silently fail - types are optional
      }
    }
    fetchTypes()
  }, [session?.accessToken, user?.organization?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken || !user?.organization?.id || !name.trim()) return

    setSaving(true)
    setError(null)

    try {
      const res = await api<Supplier>(
        `/api/v1/organizations/${user.organization.id}/suppliers`,
        {
          method: 'POST',
          token: session.accessToken,
          body: {
            name: name.trim(),
            supplier_type_id: typeId || null,
            is_quick_add: true
          }
        }
      )
      onSupplierAdded(res)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add supplier')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Quick Add Supplier</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-2 rounded text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Supplier Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., GSF Car Parts"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
              required
            />
          </div>

          {supplierTypes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <span className="text-gray-400">(optional)</span>
              </label>
              <select
                value={typeId}
                onChange={e => setTypeId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select type...</option>
                {supplierTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Supplier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// ADD OTHER PART MODAL (For items not in checklist)
// ============================================================================

interface AddOtherPartModalProps {
  healthCheckId: string
  suppliers: Supplier[]
  defaultMargin: number
  onClose: () => void
  onSaved: () => void
  onSupplierAdded: (supplier: Supplier) => void
}

function AddOtherPartModal({
  healthCheckId,
  suppliers,
  defaultMargin,
  onClose,
  onSaved,
  onSupplierAdded
}: AddOtherPartModalProps) {
  const { session } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQuickAddSupplierModal, setShowQuickAddSupplierModal] = useState(false)

  // Form state
  const [itemName, setItemName] = useState('')
  const [partNumber, setPartNumber] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [supplierId, setSupplierId] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [sellPrice, setSellPrice] = useState('')

  // Auto-calculate sell price when cost changes
  useEffect(() => {
    if (costPrice && !sellPrice) {
      const cost = parseFloat(costPrice)
      if (!isNaN(cost) && cost > 0) {
        const sell = cost / (1 - defaultMargin / 100)
        setSellPrice(sell.toFixed(2))
      }
    }
  }, [costPrice, sellPrice, defaultMargin])

  const costNum = parseFloat(costPrice) || 0
  const sellNum = parseFloat(sellPrice) || 0
  const qtyNum = parseFloat(quantity) || 1
  const lineTotal = qtyNum * sellNum
  const marginPercent = sellNum > 0 ? ((sellNum - costNum) / sellNum) * 100 : 0

  const handleSupplierAddedFromModal = (newSupplier: Supplier) => {
    onSupplierAdded(newSupplier)
    setSupplierId(newSupplier.id)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken || !itemName.trim() || !description.trim() || !costPrice || !sellPrice) return

    setSaving(true)
    setError(null)

    try {
      // Step 1: Create the repair item
      const itemRes = await api<{ id: string }>(`/api/v1/health-checks/${healthCheckId}/repair-items`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          name: itemName.trim(),
          description: 'Additional part item'
        }
      })

      // Step 2: Add part to the repair item
      await api(`/api/v1/repair-items/${itemRes.id}/parts`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          part_number: partNumber.trim() || null,
          description: description.trim(),
          quantity: qtyNum,
          supplier_id: supplierId || null,
          cost_price: costNum,
          sell_price: sellNum
        }
      })

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add part')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Add Other Part</h3>
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
            Use this to add parts for items not listed above (e.g., additional work discovered).
          </div>

          {/* Item Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Item Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={itemName}
              onChange={e => setItemName(e.target.value)}
              placeholder="e.g., Additional Repair, Customer Request"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* Part Number and Description */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Part Number
              </label>
              <input
                type="text"
                value={partNumber}
                onChange={e => setPartNumber(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Optional"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Part description"
                required
              />
            </div>
          </div>

          {/* Quantity and Supplier */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity
              </label>
              <input
                type="number"
                step="1"
                min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supplier
              </label>
              <SupplierDropdown
                suppliers={suppliers}
                value={supplierId}
                onChange={setSupplierId}
                onAddNew={() => setShowQuickAddSupplierModal(true)}
              />
              {showQuickAddSupplierModal && (
                <QuickAddSupplierModal
                  onClose={() => setShowQuickAddSupplierModal(false)}
                  onSupplierAdded={handleSupplierAddedFromModal}
                />
              )}
            </div>
          </div>

          {/* Pricing */}
          <div className="border-t border-gray-200 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cost Price <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">£</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costPrice}
                    onChange={e => {
                      setCostPrice(e.target.value)
                      // Auto-calculate sell price
                      const cost = parseFloat(e.target.value)
                      if (!isNaN(cost) && cost > 0) {
                        const sell = cost / (1 - defaultMargin / 100)
                        setSellPrice(sell.toFixed(2))
                      }
                    }}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sell Price <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">£</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sellPrice}
                    onChange={e => setSellPrice(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Calculated values */}
          <div className="bg-gray-100 rounded p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Margin:</span>
              <span className="font-medium">{marginPercent.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Line Total:</span>
              <span className="font-semibold">£{lineTotal.toFixed(2)}</span>
            </div>
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
              disabled={saving || !itemName.trim() || !description.trim() || !costPrice || !sellPrice}
              className="flex-1 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Part'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
