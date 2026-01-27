/**
 * RepairItemRow Component
 * Displays a repair item with inline editing, pricing, and action controls
 */

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { api, RepairItem, CheckResult } from '../../../lib/api'
import { ItemReasonsDisplay, GreenReasonsDisplay } from './ItemReasonsDisplay'
import { OutcomeButton, calculateOutcomeStatus, OutcomeStatus } from './OutcomeButton'
import { DeferModal, DeclineModal, DeleteModal } from './OutcomeModals'

interface RepairItemRowProps {
  healthCheckId: string
  item: RepairItem
  result?: CheckResult | null
  showFollowUp?: boolean     // Show follow-up date picker (for amber items)
  showWorkComplete?: boolean // Show work complete checkbox (for authorised items)
  onUpdate: () => void
  onPhotoClick?: (resultId: string) => void
  onUngroup?: () => void     // Callback to ungroup a grouped item
  preloadedReasons?: Array<{
    id: string
    itemReasonId: string
    reasonText: string
    technicalDescription?: string
    customerDescription?: string
  }>
  specialDisplay?: React.ReactNode  // Tyre/brake display shown when expanded
}

export function RepairItemRow({
  healthCheckId,
  item: initialItem,
  result,
  showFollowUp: _showFollowUp = false,
  showWorkComplete = false,
  onUpdate,
  onPhotoClick,
  onUngroup,
  preloadedReasons,
  specialDisplay
}: RepairItemRowProps) {
  const { session } = useAuth()
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingField, setSavingField] = useState<string | null>(null) // Track which field is saving
  const [error, setError] = useState<string | null>(null)

  // Outcome modal states
  const [showDeferModal, setShowDeferModal] = useState(false)
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [outcomeLoading, setOutcomeLoading] = useState(false)

  // Local copy of item for optimistic updates
  const [item, setItem] = useState(initialItem)

  // Sync with props when item changes from parent
  useEffect(() => {
    setItem(initialItem)
    setPartsPrice(initialItem.parts_cost?.toString() || '0')
    setLaborPrice(initialItem.labor_cost?.toString() || '0')
    setTotalPrice(initialItem.total_price?.toString() || '0')
  }, [initialItem])

  // Editable values
  const [partsPrice, setPartsPrice] = useState(initialItem.parts_cost?.toString() || '0')
  const [laborPrice, setLaborPrice] = useState(initialItem.labor_cost?.toString() || '0')
  const [totalPrice, setTotalPrice] = useState(initialItem.total_price?.toString() || '0')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingField])

  const mediaCount = result?.media?.length || 0

  // Calculate total
  const calculatedTotal = (parseFloat(partsPrice) || 0) + (parseFloat(laborPrice) || 0)

  const saveField = async (field: string, value: unknown, optimisticUpdate?: Partial<RepairItem>) => {
    if (!session?.accessToken) return

    // Apply optimistic update immediately
    if (optimisticUpdate) {
      setItem(prev => ({ ...prev, ...optimisticUpdate }))
    }

    setSaving(true)
    setSavingField(field)
    setError(null)

    try {
      await api(`/api/v1/health-checks/${healthCheckId}/repair-items/${item.id}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { [field]: value }
      })
      // Don't call onUpdate() - use optimistic update instead
    } catch (err) {
      // Revert optimistic update on error
      setItem(initialItem)
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
      setSavingField(null)
      setEditingField(null)
    }
  }

  const handlePriceBlur = (field: 'parts_cost' | 'labor_cost' | 'total_price') => {
    let value: number
    let originalValue: number

    if (field === 'parts_cost') {
      value = parseFloat(partsPrice) || 0
      originalValue = item.parts_cost || 0
    } else if (field === 'labor_cost') {
      value = parseFloat(laborPrice) || 0
      originalValue = item.labor_cost || 0
    } else {
      value = parseFloat(totalPrice) || 0
      originalValue = item.total_price || 0
    }

    if (value !== originalValue) {
      // Build optimistic update
      const optimisticUpdate: Partial<RepairItem> = { [field]: value }

      // For parts/labour changes, also update total
      if (field === 'parts_cost') {
        const newTotal = value + (item.labor_cost || 0)
        optimisticUpdate.total_price = newTotal
        setTotalPrice(newTotal.toString())
      } else if (field === 'labor_cost') {
        const newTotal = (item.parts_cost || 0) + value
        optimisticUpdate.total_price = newTotal
        setTotalPrice(newTotal.toString())
      }

      saveField(field, value, optimisticUpdate)
    } else {
      setEditingField(null)
    }
  }

  const handlePriceKeyDown = (e: React.KeyboardEvent, field: 'parts_cost' | 'labor_cost' | 'total_price') => {
    if (e.key === 'Enter') {
      handlePriceBlur(field)
    } else if (e.key === 'Escape') {
      // Reset to original value
      if (field === 'parts_cost') {
        setPartsPrice(item.parts_cost?.toString() || '0')
      } else if (field === 'labor_cost') {
        setLaborPrice(item.labor_cost?.toString() || '0')
      } else {
        setTotalPrice(item.total_price?.toString() || '0')
      }
      setEditingField(null)
    }
  }

  const toggleMOTFail = async () => {
    const newValue = !item.is_mot_failure
    setSavingField('mot')
    await saveField('is_mot_failure', newValue, { is_mot_failure: newValue })
  }

  const toggleWorkComplete = async () => {
    if (!session?.accessToken) return

    const isCompleting = !item.work_completed_at
    const optimisticValue = isCompleting ? new Date().toISOString() : null

    // Optimistic update
    setItem(prev => ({ ...prev, work_completed_at: optimisticValue }))

    setSaving(true)
    setSavingField('work_complete')
    setError(null)

    try {
      if (item.work_completed_at) {
        // Uncomplete
        await api(`/api/v1/health-checks/${healthCheckId}/repair-items/${item.id}/work-done`, {
          method: 'DELETE',
          token: session.accessToken
        })
      } else {
        // Complete
        await api(`/api/v1/health-checks/${healthCheckId}/repair-items/${item.id}/work-done`, {
          method: 'POST',
          token: session.accessToken
        })
      }
      // Refresh parent data so Close Health Check modal shows correct counts
      onUpdate()
    } catch (err) {
      // Revert on error
      setItem(initialItem)
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setSaving(false)
      setSavingField(null)
    }
  }

  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`

  // Calculate outcome status
  const outcomeStatus: OutcomeStatus = calculateOutcomeStatus({
    deletedAt: item.deleted_at,
    outcomeStatus: item.outcome_status,
    isApproved: item.is_approved, // Legacy field for backward compatibility
    labourStatus: item.labour_status,
    partsStatus: item.parts_status,
    noLabourRequired: item.no_labour_required,
    noPartsRequired: item.no_parts_required
  })

  // Get outcome set by name
  const getOutcomeSetByName = () => {
    if (item.outcome_source === 'online') return 'Customer online'
    if (item.outcome_set_by_user) {
      return `${item.outcome_set_by_user.first_name} ${item.outcome_set_by_user.last_name}`
    }
    return null
  }

  // Outcome action handlers
  const handleAuthorise = async () => {
    if (!session?.accessToken) return
    setOutcomeLoading(true)
    try {
      await api(`/api/v1/repair-items/${item.id}/authorise`, {
        method: 'POST',
        token: session.accessToken,
        body: {}
      })
      // Optimistic update
      setItem(prev => ({
        ...prev,
        outcome_status: 'authorised',
        outcome_set_at: new Date().toISOString(),
        outcome_source: 'manual'
      }))
      toast.success('Item authorised')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to authorise')
    } finally {
      setOutcomeLoading(false)
    }
  }

  const handleDefer = async (deferredUntil: string, notes: string) => {
    if (!session?.accessToken) return
    setOutcomeLoading(true)
    try {
      await api(`/api/v1/repair-items/${item.id}/defer`, {
        method: 'POST',
        token: session.accessToken,
        body: { deferred_until: deferredUntil, notes }
      })
      // Optimistic update
      setItem(prev => ({
        ...prev,
        outcome_status: 'deferred',
        outcome_set_at: new Date().toISOString(),
        outcome_source: 'manual',
        deferred_until: deferredUntil,
        deferred_notes: notes
      }))
      toast.success('Item deferred')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to defer')
      throw err
    } finally {
      setOutcomeLoading(false)
    }
  }

  const handleDecline = async (declinedReasonId: string, notes: string) => {
    if (!session?.accessToken) return
    setOutcomeLoading(true)
    try {
      await api(`/api/v1/repair-items/${item.id}/decline`, {
        method: 'POST',
        token: session.accessToken,
        body: { declined_reason_id: declinedReasonId, notes }
      })
      // Optimistic update
      setItem(prev => ({
        ...prev,
        outcome_status: 'declined',
        outcome_set_at: new Date().toISOString(),
        outcome_source: 'manual',
        declined_reason_id: declinedReasonId,
        declined_notes: notes
      }))
      toast.success('Item declined')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to decline')
      throw err
    } finally {
      setOutcomeLoading(false)
    }
  }

  const handleDelete = async (deletedReasonId: string, notes: string) => {
    if (!session?.accessToken) return
    setOutcomeLoading(true)
    try {
      await api(`/api/v1/repair-items/${item.id}/delete`, {
        method: 'POST',
        token: session.accessToken,
        body: { deleted_reason_id: deletedReasonId, notes }
      })
      // Optimistic update
      setItem(prev => ({
        ...prev,
        outcome_status: 'deleted',
        deleted_at: new Date().toISOString(),
        deleted_reason_id: deletedReasonId,
        deleted_notes: notes
      }))
      toast.success('Item deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
      throw err
    } finally {
      setOutcomeLoading(false)
    }
  }

  const handleReset = async () => {
    if (!session?.accessToken) return
    if (!confirm('Are you sure you want to reset this item? This will clear the outcome status.')) return
    setOutcomeLoading(true)
    try {
      await api(`/api/v1/repair-items/${item.id}/reset`, {
        method: 'POST',
        token: session.accessToken
      })
      // Optimistic update - recalculate status based on L&P
      const labourComplete = item.labour_status === 'complete' || item.no_labour_required
      const partsComplete = item.parts_status === 'complete' || item.no_parts_required
      const newStatus = labourComplete && partsComplete ? 'ready' : 'incomplete'
      setItem(prev => ({
        ...prev,
        outcome_status: newStatus as OutcomeStatus,
        outcome_set_at: new Date().toISOString(),
        outcome_source: 'manual',
        deferred_until: null,
        deferred_notes: null,
        declined_reason_id: null,
        declined_notes: null,
        deleted_at: null,
        deleted_reason_id: null,
        deleted_notes: null
      }))
      toast.success('Item reset')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset')
    } finally {
      setOutcomeLoading(false)
    }
  }

  // Hide deleted items
  if (item.deleted_at || outcomeStatus === 'deleted') {
    return null
  }

  // Loading spinner component
  const LoadingSpinner = () => (
    <svg className="animate-spin h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )

  return (
    <div className="border-b border-gray-200 last:border-b-0">
      {/* Main row - responsive layout */}
      <div className="px-4 py-3 bg-white hover:bg-gray-50">
        {/* Desktop layout */}
        <div className="hidden lg:flex items-center gap-4">
          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? 'transform rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Item name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 truncate">{item.title}</span>
              {item.source === 'mri_scan' && (
                <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-none">
                  MRI
                </span>
              )}
              {item.is_group && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                  GROUP{item.children && item.children.length > 0 && ` (${item.children.length})`}
                </span>
              )}
            </div>
            {item.description && !expanded && (
              <div className="text-sm text-gray-500 truncate">{item.description}</div>
            )}
          </div>

          {/* Photo count */}
          {mediaCount > 0 && (
            <button
              onClick={() => result && onPhotoClick?.(result.id)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-primary"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{mediaCount}</span>
            </button>
          )}

          {/* MOT Fail checkbox */}
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            {savingField === 'mot' ? (
              <LoadingSpinner />
            ) : (
              <input
                type="checkbox"
                checked={item.is_mot_failure || false}
                onChange={toggleMOTFail}
                disabled={saving}
                className="rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
            )}
            <span className={`${item.is_mot_failure ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              MOT
            </span>
          </label>

          {/* Parts price */}
          <div className="w-20 text-right">
            {savingField === 'parts_cost' ? (
              <div className="flex justify-end"><LoadingSpinner /></div>
            ) : editingField === 'parts_cost' ? (
              <input
                ref={inputRef}
                type="number"
                step="0.01"
                value={partsPrice}
                onChange={(e) => setPartsPrice(e.target.value)}
                onBlur={() => handlePriceBlur('parts_cost')}
                onKeyDown={(e) => handlePriceKeyDown(e, 'parts_cost')}
                className="w-full px-2 py-1 text-right text-sm border border-primary rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <button
                onClick={() => setEditingField('parts_cost')}
                className="text-sm text-gray-700 hover:text-primary hover:underline"
                title="Click to edit parts price"
              >
                {formatCurrency(item.parts_cost || 0)}
              </button>
            )}
            <div className="text-xs text-gray-400">Parts</div>
          </div>

          {/* Labour price */}
          <div className="w-20 text-right">
            {savingField === 'labor_cost' ? (
              <div className="flex justify-end"><LoadingSpinner /></div>
            ) : editingField === 'labor_cost' ? (
              <input
                ref={inputRef}
                type="number"
                step="0.01"
                value={laborPrice}
                onChange={(e) => setLaborPrice(e.target.value)}
                onBlur={() => handlePriceBlur('labor_cost')}
                onKeyDown={(e) => handlePriceKeyDown(e, 'labor_cost')}
                className="w-full px-2 py-1 text-right text-sm border border-primary rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <button
                onClick={() => setEditingField('labor_cost')}
                className="text-sm text-gray-700 hover:text-primary hover:underline"
                title="Click to edit labour price"
              >
                {formatCurrency(item.labor_cost || 0)}
              </button>
            )}
            <div className="text-xs text-gray-400">Labour</div>
          </div>

          {/* Total price (editable) */}
          <div className="w-24 text-right">
            {savingField === 'total_price' ? (
              <div className="flex justify-end"><LoadingSpinner /></div>
            ) : editingField === 'total_price' ? (
              <input
                ref={inputRef}
                type="number"
                step="0.01"
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
                onBlur={() => handlePriceBlur('total_price')}
                onKeyDown={(e) => handlePriceKeyDown(e, 'total_price')}
                className="w-full px-2 py-1 text-right text-sm border border-primary rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <button
                onClick={() => setEditingField('total_price')}
                className="text-sm font-semibold text-gray-900 hover:text-primary hover:underline"
                title="Click to edit total price"
              >
                {formatCurrency(item.total_price || calculatedTotal)}
              </button>
            )}
            <div className="text-xs text-gray-400">Total</div>
          </div>

          {/* Work complete checkbox (for authorised items) */}
          {showWorkComplete && (
            <label className="flex flex-col items-center gap-0.5 cursor-pointer">
              {savingField === 'work_complete' ? (
                <LoadingSpinner />
              ) : (
                <input
                  type="checkbox"
                  checked={!!item.work_completed_at}
                  onChange={toggleWorkComplete}
                  disabled={saving}
                  className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
              )}
              <span className="text-xs text-gray-400">Done</span>
            </label>
          )}

          {/* Outcome Button - only for parent items (not children within groups) */}
          {!item.parent_repair_item_id && (
            <OutcomeButton
              status={outcomeStatus}
              outcomeSetBy={getOutcomeSetByName()}
              outcomeSetAt={item.outcome_set_at}
              outcomeSource={item.outcome_source}
              deferredUntil={item.deferred_until}
              declinedReason={item.declined_reason?.reason}
              onAuthorise={handleAuthorise}
              onDefer={() => setShowDeferModal(true)}
              onDecline={() => setShowDeclineModal(true)}
              onDelete={() => setShowDeleteModal(true)}
              onReset={handleReset}
              loading={outcomeLoading}
            />
          )}
        </div>

        {/* Tablet/Mobile layout - stacked */}
        <div className="lg:hidden">
          {/* Top row: expand, title, photos, MOT */}
          <div className="flex items-start gap-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-1"
            >
              <svg
                className={`w-4 h-4 transition-transform ${expanded ? 'transform rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900">{item.title}</span>
                {item.source === 'mri_scan' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-none">
                    MRI
                  </span>
                )}
                {item.is_group && (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                    GROUP{item.children && item.children.length > 0 && ` (${item.children.length})`}
                  </span>
                )}
              </div>
              {item.description && !expanded && (
                <div className="text-sm text-gray-500 mt-0.5">{item.description}</div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {mediaCount > 0 && (
                <button
                  onClick={() => result && onPhotoClick?.(result.id)}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-primary"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{mediaCount}</span>
                </button>
              )}

              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                {savingField === 'mot' ? (
                  <LoadingSpinner />
                ) : (
                  <input
                    type="checkbox"
                    checked={item.is_mot_failure || false}
                    onChange={toggleMOTFail}
                    disabled={saving}
                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                )}
                <span className={`${item.is_mot_failure ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                  MOT
                </span>
              </label>
            </div>
          </div>

          {/* Bottom row: pricing */}
          <div className="flex items-center gap-4 mt-3 ml-7">
            {/* Pricing grid */}
            <div className="flex-1 grid grid-cols-3 gap-2">
              {/* Parts */}
              <div className="text-center">
                {savingField === 'parts_cost' ? (
                  <div className="flex justify-center"><LoadingSpinner /></div>
                ) : editingField === 'parts_cost' ? (
                  <input
                    ref={inputRef}
                    type="number"
                    step="0.01"
                    value={partsPrice}
                    onChange={(e) => setPartsPrice(e.target.value)}
                    onBlur={() => handlePriceBlur('parts_cost')}
                    onKeyDown={(e) => handlePriceKeyDown(e, 'parts_cost')}
                    className="w-full px-2 py-1 text-center text-sm border border-primary rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <button
                    onClick={() => setEditingField('parts_cost')}
                    className="text-sm text-gray-700 hover:text-primary"
                  >
                    {formatCurrency(item.parts_cost || 0)}
                  </button>
                )}
                <div className="text-xs text-gray-400">Parts</div>
              </div>

              {/* Labour */}
              <div className="text-center">
                {savingField === 'labor_cost' ? (
                  <div className="flex justify-center"><LoadingSpinner /></div>
                ) : editingField === 'labor_cost' ? (
                  <input
                    ref={inputRef}
                    type="number"
                    step="0.01"
                    value={laborPrice}
                    onChange={(e) => setLaborPrice(e.target.value)}
                    onBlur={() => handlePriceBlur('labor_cost')}
                    onKeyDown={(e) => handlePriceKeyDown(e, 'labor_cost')}
                    className="w-full px-2 py-1 text-center text-sm border border-primary rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <button
                    onClick={() => setEditingField('labor_cost')}
                    className="text-sm text-gray-700 hover:text-primary"
                  >
                    {formatCurrency(item.labor_cost || 0)}
                  </button>
                )}
                <div className="text-xs text-gray-400">Labour</div>
              </div>

              {/* Total */}
              <div className="text-center">
                {savingField === 'total_price' ? (
                  <div className="flex justify-center"><LoadingSpinner /></div>
                ) : editingField === 'total_price' ? (
                  <input
                    ref={inputRef}
                    type="number"
                    step="0.01"
                    value={totalPrice}
                    onChange={(e) => setTotalPrice(e.target.value)}
                    onBlur={() => handlePriceBlur('total_price')}
                    onKeyDown={(e) => handlePriceKeyDown(e, 'total_price')}
                    className="w-full px-2 py-1 text-center text-sm border border-primary rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <button
                    onClick={() => setEditingField('total_price')}
                    className="text-sm font-semibold text-gray-900 hover:text-primary"
                  >
                    {formatCurrency(item.total_price || calculatedTotal)}
                  </button>
                )}
                <div className="text-xs text-gray-400">Total</div>
              </div>
            </div>

            {/* Work complete checkbox (for authorised items) */}
            {showWorkComplete && (
              <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                {savingField === 'work_complete' ? (
                  <LoadingSpinner />
                ) : (
                  <input
                    type="checkbox"
                    checked={!!item.work_completed_at}
                    onChange={toggleWorkComplete}
                    disabled={saving}
                    className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                )}
                <span className="text-xs text-gray-400">Done</span>
              </label>
            )}

            {/* Outcome Button - only for parent items (not children within groups) */}
            {!item.parent_repair_item_id && (
              <OutcomeButton
                status={outcomeStatus}
                outcomeSetBy={getOutcomeSetByName()}
                outcomeSetAt={item.outcome_set_at}
                outcomeSource={item.outcome_source}
                deferredUntil={item.deferred_until}
                declinedReason={item.declined_reason?.reason}
                onAuthorise={handleAuthorise}
                onDefer={() => setShowDeferModal(true)}
                onDecline={() => setShowDeclineModal(true)}
                onDelete={() => setShowDeleteModal(true)}
                onReset={handleReset}
                loading={outcomeLoading}
              />
            )}
          </div>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          {/* Grouped items (for groups) */}
          {item.is_group && item.children && item.children.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium text-gray-500 uppercase mb-2">Grouped Items</div>
              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                {item.children.map((child) => (
                  <div key={child.id} className="px-3 py-2 flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        child.rag_status === 'red' ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                    />
                    <span className="text-sm text-gray-700 flex-1">{child.title}</span>
                    {child.is_mot_failure && (
                      <span className="text-xs text-red-600 font-medium">MOT</span>
                    )}
                  </div>
                ))}
              </div>
              {onUngroup && (
                <button
                  onClick={onUngroup}
                  className="mt-2 px-3 py-1.5 text-sm text-amber-600 border border-amber-300 rounded hover:bg-amber-50"
                >
                  Ungroup Items
                </button>
              )}
            </div>
          )}

          {/* Description */}
          {item.description && (
            <div className="mb-3">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Description</div>
              <div className="text-sm text-gray-700">{item.description}</div>
            </div>
          )}

          {/* Tech notes from result */}
          {result?.notes && (
            <div className="mb-3">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Technician Notes</div>
              <div className="text-sm text-gray-700 bg-white p-2 rounded border border-gray-200">
                {result.notes}
              </div>
            </div>
          )}

          {/* Selected reasons */}
          {result?.id && (
            <div className="mb-3">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Reasons</div>
              <ItemReasonsDisplay
                checkResultId={result.id}
                ragStatus={item.rag_status as 'red' | 'amber' | 'green'}
                itemName={item.title}
                preloadedReasons={preloadedReasons}
              />
            </div>
          )}

          {/* Special display (tyre/brake measurements) */}
          {specialDisplay && (
            <div className="mb-3">
              {specialDisplay}
            </div>
          )}

          {/* Work completion info */}
          {item.work_completed_at && (
            <div className="text-xs text-green-600">
              Completed on {new Date(item.work_completed_at).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
              {item.work_completed_by_user && (
                <> by {item.work_completed_by_user.first_name} {item.work_completed_by_user.last_name}</>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-2 text-sm text-red-600">{error}</div>
          )}
        </div>
      )}

      {/* Outcome Modals */}
      <DeferModal
        isOpen={showDeferModal}
        itemName={item.title}
        onClose={() => setShowDeferModal(false)}
        onConfirm={handleDefer}
      />
      <DeclineModal
        isOpen={showDeclineModal}
        itemName={item.title}
        onClose={() => setShowDeclineModal(false)}
        onConfirm={handleDecline}
      />
      <DeleteModal
        isOpen={showDeleteModal}
        itemName={item.title}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

/**
 * GreenItemRow - Simplified row for passed items
 * Supports expandable tyre/brake displays
 */
interface GreenItemRowProps {
  title: string
  notes?: string | null
  value?: unknown
  checkResultId?: string
  preloadedReasons?: Array<{
    id: string
    itemReasonId: string
    reasonText: string
    technicalDescription?: string
    customerDescription?: string
  }>
  specialDisplay?: React.ReactNode  // Tyre/brake display shown when expanded
}

export function GreenItemRow({ title, notes, value: _value, checkResultId, preloadedReasons, specialDisplay }: GreenItemRowProps) {
  // value reserved for displaying measurement data in future
  void _value

  const [expanded, setExpanded] = useState(false)
  const hasExpandableContent = !!specialDisplay

  return (
    <div className="px-4 py-2 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-3">
        {/* Expand toggle (only for items with special display) */}
        {hasExpandableContent ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? 'transform rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          /* Check icon for non-expandable items */
          <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )}

        {/* Item name */}
        <span className="text-sm text-gray-700 flex-1">{title}</span>

        {/* Green check for expandable items (shown inline) */}
        {hasExpandableContent && (
          <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )}

        {/* Notes indicator */}
        {notes && (
          <span className="text-xs text-gray-400" title={notes}>
            (note)
          </span>
        )}
      </div>

      {/* Green reasons - positive findings */}
      {checkResultId && (
        <div className="ml-7">
          <GreenReasonsDisplay checkResultId={checkResultId} compact={false} preloadedReasons={preloadedReasons} />
        </div>
      )}

      {/* Expanded section with special display */}
      {expanded && specialDisplay && (
        <div className="mt-2 ml-7 bg-gray-50 rounded-lg p-3 border border-gray-200">
          {specialDisplay}
        </div>
      )}
    </div>
  )
}
