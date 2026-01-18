/**
 * PartsTab Component
 * Displays and manages parts entries for all repair items in a health check
 */

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, NewRepairItem, RepairPart, Supplier, PricingSettings } from '../../../lib/api'

interface PartsTabProps {
  healthCheckId: string
  onUpdate: () => void
}

interface PartEntry extends RepairPart {
  repairItemId: string
  repairItemName: string
  repairOptionId?: string
  repairOptionName?: string
}

export function PartsTab({ healthCheckId, onUpdate }: PartsTabProps) {
  const { session, user } = useAuth()
  const [repairItems, setRepairItems] = useState<NewRepairItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [pricingSettings, setPricingSettings] = useState<PricingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingPart, setEditingPart] = useState<PartEntry | null>(null)
  const [markingComplete, setMarkingComplete] = useState(false)

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
            `/api/v1/organizations/${user?.organization?.id}/suppliers`,
            { token: session.accessToken }
          ),
          api<{ settings: PricingSettings }>(
            `/api/v1/organizations/${user?.organization?.id}/pricing-settings`,
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

  // Flatten all part entries from repair items and their options
  const allPartEntries = useMemo(() => {
    const entries: PartEntry[] = []

    repairItems.forEach(item => {
      // Direct parts on repair item
      if (item.parts) {
        item.parts.forEach(part => {
          entries.push({
            ...part,
            repairItemId: item.id,
            repairItemName: item.name
          })
        })
      }

      // Parts on options
      if (item.options) {
        item.options.forEach(option => {
          if (option.parts) {
            option.parts.forEach(part => {
              entries.push({
                ...part,
                repairItemId: item.id,
                repairItemName: item.name,
                repairOptionId: option.id,
                repairOptionName: option.name
              })
            })
          }
        })
      }
    })

    return entries
  }, [repairItems])

  // Group parts by repair item
  const partsByRepairItem = useMemo(() => {
    const grouped = new Map<string, PartEntry[]>()

    allPartEntries.forEach(entry => {
      const key = entry.repairOptionId
        ? `${entry.repairItemId}:${entry.repairOptionId}`
        : entry.repairItemId

      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push(entry)
    })

    return grouped
  }, [allPartEntries])

  // Calculate totals
  const totals = useMemo(() => {
    let totalCost = 0
    let totalSell = 0

    allPartEntries.forEach(entry => {
      totalCost += entry.costPrice * entry.quantity
      totalSell += entry.lineTotal
    })

    const margin = totalSell - totalCost
    const marginPercent = totalSell > 0 ? (margin / totalSell) * 100 : 0

    return { totalCost, totalSell, margin, marginPercent }
  }, [allPartEntries])

  // Check if all items have parts completed
  const allPartsComplete = repairItems.every(
    item => item.partsStatus === 'complete'
  )

  // Get completion info
  const completionInfo = useMemo(() => {
    const completedItem = repairItems.find(item => item.partsCompletedAt)
    return completedItem
      ? {
          completedBy: completedItem.partsCompletedBy,
          completedAt: completedItem.partsCompletedAt
        }
      : null
  }, [repairItems])

  const handleMarkPartsComplete = async () => {
    if (!session?.accessToken) return

    setMarkingComplete(true)
    try {
      // Mark all repair items as parts complete
      await Promise.all(
        repairItems.map(item =>
          api(`/api/v1/repair-items/${item.id}/parts-complete`, {
            method: 'POST',
            token: session.accessToken
          })
        )
      )
      onUpdate()
      // Refetch data
      const itemsRes = await api<{ repairItems: NewRepairItem[] }>(
        `/api/v1/health-checks/${healthCheckId}/repair-items`,
        { token: session.accessToken }
      )
      setRepairItems(itemsRes.repairItems || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark complete')
    } finally {
      setMarkingComplete(false)
    }
  }

  const handleDeletePart = async (partId: string) => {
    if (!session?.accessToken) return
    if (!confirm('Are you sure you want to delete this part?')) return

    try {
      await api(`/api/v1/repair-parts/${partId}`, {
        method: 'DELETE',
        token: session.accessToken
      })
      // Refetch data
      const itemsRes = await api<{ repairItems: NewRepairItem[] }>(
        `/api/v1/health-checks/${healthCheckId}/repair-items`,
        { token: session.accessToken }
      )
      setRepairItems(itemsRes.repairItems || [])
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handlePartSaved = async () => {
    if (!session?.accessToken) return
    // Refetch data
    const itemsRes = await api<{ repairItems: NewRepairItem[] }>(
      `/api/v1/health-checks/${healthCheckId}/repair-items`,
      { token: session.accessToken }
    )
    setRepairItems(itemsRes.repairItems || [])
    onUpdate()
  }

  const handleSupplierAdded = async (newSupplier: Supplier) => {
    setSuppliers(prev => [...prev, newSupplier])
  }

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

  return (
    <div className="space-y-4">
      {/* Parts Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Part No.
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Description
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Qty
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Supplier
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cost
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Sell
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {allPartEntries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No parts added yet. Click "+ Add Part" to add parts.
                </td>
              </tr>
            ) : (
              Array.from(partsByRepairItem.entries()).map(([groupKey, entries]) => {
                const firstEntry = entries[0]
                const groupName = firstEntry.repairOptionName
                  ? `${firstEntry.repairItemName} - ${firstEntry.repairOptionName}`
                  : firstEntry.repairItemName

                // Find the repair item to check if it's a group with children
                const repairItem = repairItems.find(ri => ri.id === firstEntry.repairItemId)
                const isGroupWithChildren = repairItem?.isGroup && repairItem?.children && repairItem.children.length > 0

                return (
                  <>
                    {/* Group header row */}
                    <tr key={`header-${groupKey}`} className="bg-gray-50">
                      <td colSpan={8} className="px-4 py-2 text-sm font-medium text-gray-700">
                        <div className="flex items-center gap-2">
                          <span>{groupName}</span>
                          {isGroupWithChildren && (
                            <span className="px-1.5 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded">
                              GROUP ({repairItem.children!.length})
                            </span>
                          )}
                        </div>
                        {isGroupWithChildren && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {repairItem!.children!.map(c => c.checkResults?.[0]?.templateItem?.name || c.name).join(', ')}
                          </div>
                        )}
                      </td>
                    </tr>
                    {/* Part rows */}
                    {entries.map(entry => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {entry.partNumber || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {entry.description}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right">
                          {entry.quantity}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {entry.supplierName || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right">
                          £{entry.costPrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right">
                          £{entry.sellPrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">
                          £{entry.lineTotal.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditingPart(entry)}
                              className="text-gray-400 hover:text-gray-600"
                              title="Edit"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeletePart(entry.id)}
                              className="text-gray-400 hover:text-red-600"
                              title="Delete"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add Button */}
      <button
        onClick={() => setShowAddModal(true)}
        disabled={repairItems.length === 0}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary border border-primary rounded hover:bg-primary hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add Part
      </button>

      {repairItems.length === 0 && (
        <p className="text-sm text-gray-500">
          Create repair items first before adding parts.
        </p>
      )}

      {/* Footer Totals */}
      {allPartEntries.length > 0 && (
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
              {completionInfo?.completedAt && (
                <div className="text-sm text-green-600">
                  Completed at {new Date(completionInfo.completedAt).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              )}
            </div>
            <button
              onClick={handleMarkPartsComplete}
              disabled={markingComplete || allPartsComplete || allPartEntries.length === 0}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded transition-colors ${
                allPartsComplete
                  ? 'bg-green-100 text-green-700 cursor-default'
                  : 'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
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
                  {markingComplete ? 'Marking...' : 'Mark Parts Complete'} ✓
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Add Part Modal */}
      {showAddModal && (
        <AddPartModal
          healthCheckId={healthCheckId}
          repairItems={repairItems}
          suppliers={suppliers}
          defaultMarginPercent={pricingSettings?.defaultMarginPercent || 40}
          onClose={() => setShowAddModal(false)}
          onSaved={handlePartSaved}
          onSupplierAdded={handleSupplierAdded}
        />
      )}

      {/* Edit Part Modal */}
      {editingPart && (
        <EditPartModal
          partEntry={editingPart}
          suppliers={suppliers}
          defaultMarginPercent={pricingSettings?.defaultMarginPercent || 40}
          onClose={() => setEditingPart(null)}
          onSaved={handlePartSaved}
          onSupplierAdded={handleSupplierAdded}
        />
      )}
    </div>
  )
}

// ============================================================================
// MARGIN CALCULATOR COMPONENT
// ============================================================================

interface MarginCalculatorProps {
  costPrice: number
  defaultMargin: number
  onApply: (sellPrice: number) => void
}

function MarginCalculator({ costPrice, defaultMargin, onApply }: MarginCalculatorProps) {
  const [marginPercent, setMarginPercent] = useState(defaultMargin.toString())

  const margin = parseFloat(marginPercent) || 0
  const sellPrice = costPrice / (1 - margin / 100)
  const markupPercent = costPrice > 0 ? ((sellPrice - costPrice) / costPrice) * 100 : 0
  const profit = sellPrice - costPrice

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-amber-800 font-medium">
        <span>💰</span>
        <span>MARGIN CALCULATOR</span>
      </div>

      <div className="text-sm text-gray-700">
        <span className="text-gray-500">Cost Price:</span>
        <span className="ml-2 font-medium">£{costPrice.toFixed(2)}</span>
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-1">
          Desired Margin:
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            min="0"
            max="99"
            value={marginPercent}
            onChange={e => setMarginPercent(e.target.value)}
            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <span className="text-sm text-gray-500">%</span>
          <span className="text-xs text-gray-400 ml-2">← Default from settings</span>
        </div>
      </div>

      <div className="border-t border-amber-200 pt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Calculated Sell Price:</span>
          <span className="font-semibold">£{sellPrice.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Markup:</span>
          <span>{markupPercent.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Profit:</span>
          <span className="text-green-600">£{profit.toFixed(2)}</span>
        </div>
      </div>

      <button
        onClick={() => onApply(sellPrice)}
        className="w-full px-3 py-2 bg-amber-600 text-white text-sm font-medium rounded hover:bg-amber-700"
      >
        Apply £{sellPrice.toFixed(2)}
      </button>
    </div>
  )
}

// ============================================================================
// ADD PART MODAL
// ============================================================================

interface AddPartModalProps {
  healthCheckId: string
  repairItems: NewRepairItem[]
  suppliers: Supplier[]
  defaultMarginPercent: number
  onClose: () => void
  onSaved: () => void
  onSupplierAdded: (supplier: Supplier) => void
}

function AddPartModal({
  repairItems,
  suppliers,
  defaultMarginPercent,
  onClose,
  onSaved,
  onSupplierAdded
}: AddPartModalProps) {
  const { session, user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCalculator, setShowCalculator] = useState(false)
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false)
  const [quickAddName, setQuickAddName] = useState('')
  const [addingSupplier, setAddingSupplier] = useState(false)

  // Form state
  const [selectedTarget, setSelectedTarget] = useState('')
  const [partNumber, setPartNumber] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [supplierId, setSupplierId] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [notes, setNotes] = useState('')

  const lineTotal = (parseFloat(quantity) || 1) * (parseFloat(sellPrice) || 0)

  // Build dropdown options for repair items and their options
  const targetOptions = useMemo(() => {
    const options: { value: string; label: string }[] = []

    repairItems.forEach(item => {
      if (item.options && item.options.length > 0) {
        item.options.forEach(opt => {
          options.push({
            value: `option:${opt.id}`,
            label: `${item.name} - ${opt.name}`
          })
        })
      } else {
        options.push({
          value: `item:${item.id}`,
          label: item.name
        })
      }
    })

    return options
  }, [repairItems])

  // Set default target
  useEffect(() => {
    if (targetOptions.length > 0 && !selectedTarget) {
      setSelectedTarget(targetOptions[0].value)
    }
  }, [targetOptions, selectedTarget])

  const handleQuickAddSupplier = async () => {
    if (!session?.accessToken || !user?.organization?.id || !quickAddName.trim()) return

    setAddingSupplier(true)
    try {
      const res = await api<Supplier>(
        `/api/v1/organizations/${user?.organization?.id}/suppliers`,
        {
          method: 'POST',
          token: session.accessToken,
          body: {
            name: quickAddName.trim(),
            is_quick_add: true
          }
        }
      )
      onSupplierAdded(res)
      setSupplierId(res.id)
      setQuickAddName('')
      setShowQuickAddSupplier(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add supplier')
    } finally {
      setAddingSupplier(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken || !selectedTarget || !description.trim() || !costPrice || !sellPrice) return

    setSaving(true)
    setError(null)

    try {
      const [type, id] = selectedTarget.split(':')
      const endpoint = type === 'option'
        ? `/api/v1/repair-options/${id}/parts`
        : `/api/v1/repair-items/${id}/parts`

      await api(endpoint, {
        method: 'POST',
        token: session.accessToken,
        body: {
          part_number: partNumber.trim() || null,
          description: description.trim(),
          quantity: parseFloat(quantity) || 1,
          supplier_id: supplierId || null,
          cost_price: parseFloat(costPrice),
          sell_price: parseFloat(sellPrice),
          notes: notes.trim() || null
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
          <h3 className="text-lg font-semibold">Add Part</h3>
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

          {/* Repair Item */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Repair Item
            </label>
            <select
              value={selectedTarget}
              onChange={e => setSelectedTarget(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              {targetOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
                Description *
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
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">-- Select supplier --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.isQuickAdd && '⚠️'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowQuickAddSupplier(true)}
                className="text-xs text-primary hover:underline mt-1"
              >
                + Quick Add Supplier
              </button>
            </div>
          </div>

          {/* Quick Add Supplier */}
          {showQuickAddSupplier && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quickAddName}
                  onChange={e => setQuickAddName(e.target.value)}
                  placeholder="Supplier name"
                  className="flex-1 px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={handleQuickAddSupplier}
                  disabled={addingSupplier || !quickAddName.trim()}
                  className="px-3 py-1 text-sm bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
                >
                  {addingSupplier ? '...' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickAddSupplier(false)}
                  className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Pricing */}
          <div className="border-t border-gray-200 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cost Price *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">£</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costPrice}
                    onChange={e => setCostPrice(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sell Price *
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

            <button
              type="button"
              onClick={() => setShowCalculator(!showCalculator)}
              className="text-sm text-amber-600 hover:text-amber-700 mt-2 flex items-center gap-1"
            >
              <span>{showCalculator ? '▼' : '▶'}</span>
              Margin Calculator
            </button>

            {showCalculator && parseFloat(costPrice) > 0 && (
              <div className="mt-3">
                <MarginCalculator
                  costPrice={parseFloat(costPrice) || 0}
                  defaultMargin={defaultMarginPercent}
                  onApply={price => setSellPrice(price.toFixed(2))}
                />
              </div>
            )}
          </div>

          {/* Line Total */}
          <div className="flex justify-between items-center py-2 px-3 bg-gray-100 rounded">
            <span className="text-sm text-gray-600">Line Total:</span>
            <span className="font-semibold">£{lineTotal.toFixed(2)}</span>
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
              disabled={saving}
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

// ============================================================================
// EDIT PART MODAL
// ============================================================================

interface EditPartModalProps {
  partEntry: PartEntry
  suppliers: Supplier[]
  defaultMarginPercent: number
  onClose: () => void
  onSaved: () => void
  onSupplierAdded: (supplier: Supplier) => void
}

function EditPartModal({
  partEntry,
  suppliers,
  defaultMarginPercent,
  onClose,
  onSaved,
  onSupplierAdded
}: EditPartModalProps) {
  const { session, user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCalculator, setShowCalculator] = useState(false)
  const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false)
  const [quickAddName, setQuickAddName] = useState('')
  const [addingSupplier, setAddingSupplier] = useState(false)

  // Form state
  const [partNumber, setPartNumber] = useState(partEntry.partNumber || '')
  const [description, setDescription] = useState(partEntry.description)
  const [quantity, setQuantity] = useState(partEntry.quantity.toString())
  const [supplierId, setSupplierId] = useState(partEntry.supplierId || '')
  const [costPrice, setCostPrice] = useState(partEntry.costPrice.toString())
  const [sellPrice, setSellPrice] = useState(partEntry.sellPrice.toString())
  const [notes, setNotes] = useState(partEntry.notes || '')

  const lineTotal = (parseFloat(quantity) || 1) * (parseFloat(sellPrice) || 0)

  const displayName = partEntry.repairOptionName
    ? `${partEntry.repairItemName} - ${partEntry.repairOptionName}`
    : partEntry.repairItemName

  const handleQuickAddSupplier = async () => {
    if (!session?.accessToken || !user?.organization?.id || !quickAddName.trim()) return

    setAddingSupplier(true)
    try {
      const res = await api<Supplier>(
        `/api/v1/organizations/${user?.organization?.id}/suppliers`,
        {
          method: 'POST',
          token: session.accessToken,
          body: {
            name: quickAddName.trim(),
            is_quick_add: true
          }
        }
      )
      onSupplierAdded(res)
      setSupplierId(res.id)
      setQuickAddName('')
      setShowQuickAddSupplier(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add supplier')
    } finally {
      setAddingSupplier(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken || !description.trim() || !costPrice || !sellPrice) return

    setSaving(true)
    setError(null)

    try {
      await api(`/api/v1/repair-parts/${partEntry.id}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: {
          part_number: partNumber.trim() || null,
          description: description.trim(),
          quantity: parseFloat(quantity) || 1,
          supplier_id: supplierId || null,
          cost_price: parseFloat(costPrice),
          sell_price: parseFloat(sellPrice),
          notes: notes.trim() || null
        }
      })

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update part')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Edit Part</h3>
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

          {/* Repair Item (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Repair Item
            </label>
            <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded text-gray-700">
              {displayName}
            </div>
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
                Description *
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
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">-- Select supplier --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.isQuickAdd && '⚠️'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowQuickAddSupplier(true)}
                className="text-xs text-primary hover:underline mt-1"
              >
                + Quick Add Supplier
              </button>
            </div>
          </div>

          {/* Quick Add Supplier */}
          {showQuickAddSupplier && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quickAddName}
                  onChange={e => setQuickAddName(e.target.value)}
                  placeholder="Supplier name"
                  className="flex-1 px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={handleQuickAddSupplier}
                  disabled={addingSupplier || !quickAddName.trim()}
                  className="px-3 py-1 text-sm bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
                >
                  {addingSupplier ? '...' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickAddSupplier(false)}
                  className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Pricing */}
          <div className="border-t border-gray-200 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cost Price *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">£</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costPrice}
                    onChange={e => setCostPrice(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sell Price *
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

            <button
              type="button"
              onClick={() => setShowCalculator(!showCalculator)}
              className="text-sm text-amber-600 hover:text-amber-700 mt-2 flex items-center gap-1"
            >
              <span>{showCalculator ? '▼' : '▶'}</span>
              Margin Calculator
            </button>

            {showCalculator && parseFloat(costPrice) > 0 && (
              <div className="mt-3">
                <MarginCalculator
                  costPrice={parseFloat(costPrice) || 0}
                  defaultMargin={defaultMarginPercent}
                  onApply={price => setSellPrice(price.toFixed(2))}
                />
              </div>
            )}
          </div>

          {/* Line Total */}
          <div className="flex justify-between items-center py-2 px-3 bg-gray-100 rounded">
            <span className="text-sm text-gray-600">Line Total:</span>
            <span className="font-semibold">£{lineTotal.toFixed(2)}</span>
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
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
