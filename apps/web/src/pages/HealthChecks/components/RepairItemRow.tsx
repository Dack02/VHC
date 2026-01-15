/**
 * RepairItemRow Component
 * Displays a repair item with inline editing, pricing, and action controls
 */

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, RepairItem, CheckResult } from '../../../lib/api'

interface RepairItemRowProps {
  healthCheckId: string
  item: RepairItem
  result?: CheckResult | null
  showFollowUp?: boolean     // Show follow-up date picker (for amber items)
  showWorkComplete?: boolean // Show work complete checkbox (for authorised items)
  onUpdate: () => void
  onPhotoClick?: (resultId: string) => void
}

export function RepairItemRow({
  healthCheckId,
  item: initialItem,
  result,
  showFollowUp = false,
  showWorkComplete = false,
  onUpdate: _onUpdate,
  onPhotoClick
}: RepairItemRowProps) {
  void _onUpdate // Reserved for full refresh scenarios (e.g., error recovery)
  const { session } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingField, setSavingField] = useState<string | null>(null) // Track which field is saving
  const [error, setError] = useState<string | null>(null)

  // Local copy of item for optimistic updates
  const [item, setItem] = useState(initialItem)

  // Sync with props when item changes from parent
  useEffect(() => {
    setItem(initialItem)
    setPartsPrice(initialItem.parts_cost?.toString() || '0')
    setLaborPrice(initialItem.labor_cost?.toString() || '0')
    setTotalPrice(initialItem.total_price?.toString() || '0')
    setFollowUpDate(initialItem.follow_up_date || '')
  }, [initialItem])

  // Editable values
  const [partsPrice, setPartsPrice] = useState(initialItem.parts_cost?.toString() || '0')
  const [laborPrice, setLaborPrice] = useState(initialItem.labor_cost?.toString() || '0')
  const [totalPrice, setTotalPrice] = useState(initialItem.total_price?.toString() || '0')
  const [followUpDate, setFollowUpDate] = useState(initialItem.follow_up_date || '')
  const [showDatePicker, setShowDatePicker] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const datePickerRef = useRef<HTMLDivElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingField])

  // Close date picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setShowDatePicker(false)
      }
    }
    if (showDatePicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDatePicker])

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
        await api(`/api/v1/health-checks/${healthCheckId}/repair-items/${item.id}/complete`, {
          method: 'DELETE',
          token: session.accessToken
        })
      } else {
        // Complete
        await api(`/api/v1/health-checks/${healthCheckId}/repair-items/${item.id}/complete`, {
          method: 'POST',
          token: session.accessToken
        })
      }
      // Don't call onUpdate() - use optimistic update instead
    } catch (err) {
      // Revert on error
      setItem(initialItem)
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setSaving(false)
      setSavingField(null)
    }
  }

  const handleFollowUpChange = async (date: string) => {
    setFollowUpDate(date)
    setShowDatePicker(false)
    setSavingField('follow_up')
    await saveField('follow_up_date', date || null, { follow_up_date: date || null })
  }

  // Quick date options
  const getQuickDateOptions = () => {
    const today = new Date()
    const options = [
      { label: '1 Month', date: new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()) },
      { label: '3 Months', date: new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()) },
      { label: '6 Months', date: new Date(today.getFullYear(), today.getMonth() + 6, today.getDate()) },
      { label: '1 Year', date: new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()) }
    ]
    return options.map(opt => ({
      ...opt,
      dateStr: opt.date.toISOString().split('T')[0]
    }))
  }

  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`

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
            <div className="font-medium text-gray-900 truncate">{item.title}</div>
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

          {/* Follow-up date (for amber items) */}
          {showFollowUp && (
            <div className="w-36 relative" ref={datePickerRef}>
              {savingField === 'follow_up' ? (
                <div className="flex justify-center py-1"><LoadingSpinner /></div>
              ) : (
                <>
                  <button
                    onClick={() => setShowDatePicker(!showDatePicker)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded hover:border-primary focus:outline-none focus:ring-1 focus:ring-primary text-left"
                  >
                    {followUpDate ? new Date(followUpDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Set date'}
                  </button>

                  {/* Date picker dropdown */}
                  {showDatePicker && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 p-2 w-48">
                      {/* Quick options */}
                      <div className="space-y-1 mb-2">
                        {getQuickDateOptions().map(opt => (
                          <button
                            key={opt.label}
                            onClick={() => handleFollowUpChange(opt.dateStr)}
                            className="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 rounded"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="border-t border-gray-200 pt-2">
                        <input
                          type="date"
                          value={followUpDate}
                          onChange={(e) => handleFollowUpChange(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                        />
                      </div>
                      {followUpDate && (
                        <button
                          onClick={() => handleFollowUpChange('')}
                          className="w-full mt-2 px-2 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="text-xs text-gray-400 text-center">Follow-up</div>
            </div>
          )}

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
              <div className="font-medium text-gray-900">{item.title}</div>
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

            {/* Follow-up date (for amber items) */}
            {showFollowUp && (
              <div className="relative" ref={datePickerRef}>
                {savingField === 'follow_up' ? (
                  <div className="flex justify-center py-1"><LoadingSpinner /></div>
                ) : (
                  <>
                    <button
                      onClick={() => setShowDatePicker(!showDatePicker)}
                      className="px-2 py-1 text-sm border border-gray-300 rounded hover:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {followUpDate ? new Date(followUpDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Set date'}
                    </button>

                    {showDatePicker && (
                      <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 p-2 w-48">
                        <div className="space-y-1 mb-2">
                          {getQuickDateOptions().map(opt => (
                            <button
                              key={opt.label}
                              onClick={() => handleFollowUpChange(opt.dateStr)}
                              className="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 rounded"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <div className="border-t border-gray-200 pt-2">
                          <input
                            type="date"
                            value={followUpDate}
                            onChange={(e) => handleFollowUpChange(e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                          />
                        </div>
                        {followUpDate && (
                          <button
                            onClick={() => handleFollowUpChange('')}
                            className="w-full mt-2 px-2 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
                <div className="text-xs text-gray-400 text-center">Follow-up</div>
              </div>
            )}

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
          </div>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
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
    </div>
  )
}

/**
 * GreenItemRow - Simplified row for passed items
 */
interface GreenItemRowProps {
  title: string
  notes?: string | null
  value?: unknown
}

export function GreenItemRow({ title, notes, value: _value }: GreenItemRowProps) {
  // value reserved for displaying measurement data in future
  void _value
  return (
    <div className="px-4 py-2 flex items-center gap-3 border-b border-gray-100 last:border-b-0">
      {/* Check icon */}
      <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>

      {/* Item name */}
      <span className="text-sm text-gray-700 flex-1">{title}</span>

      {/* Notes indicator */}
      {notes && (
        <span className="text-xs text-gray-400" title={notes}>
          (note)
        </span>
      )}
    </div>
  )
}
