/**
 * CreateRepairGroupModal Component
 * Modal for creating a repair group from selected check results
 */

import { useState, useMemo } from 'react'
import { RepairItem, api } from '../../../lib/api'
import { useAuth } from '../../../contexts/AuthContext'

interface SelectedItemInfo {
  checkResultId: string
  name: string
  ragStatus: 'red' | 'amber'
  existingRepairItem?: RepairItem
}

interface CreateRepairGroupModalProps {
  healthCheckId: string
  selectedItems: SelectedItemInfo[]
  onClose: () => void
  onSuccess: () => void
}

export function CreateRepairGroupModal({
  healthCheckId,
  selectedItems,
  onClose,
  onSuccess
}: CreateRepairGroupModalProps) {
  const { session } = useAuth()
  const [name, setName] = useState(() => {
    // Auto-suggest name based on selected items
    if (selectedItems.length === 1) {
      return selectedItems[0].name
    }
    // Try to find common theme
    const names = selectedItems.map(i => i.name.toLowerCase())
    if (names.every(n => n.includes('brake'))) return 'Brake Service'
    if (names.every(n => n.includes('tyre') || n.includes('tire'))) return 'Tyre Service'
    if (names.every(n => n.includes('suspension') || n.includes('shock'))) return 'Suspension Service'
    if (names.every(n => n.includes('engine') || n.includes('oil'))) return 'Engine Service'
    return `Repair Group (${selectedItems.length} items)`
  })
  const [description, setDescription] = useState('')
  const [isGroup, setIsGroup] = useState(selectedItems.length > 1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check if any selected items have existing labour/parts
  const existingDataSummary = useMemo(() => {
    let labourCount = 0
    let partsCount = 0
    let totalValue = 0

    selectedItems.forEach(item => {
      if (item.existingRepairItem) {
        if (item.existingRepairItem.labor_cost > 0) labourCount++
        if (item.existingRepairItem.parts_cost > 0) partsCount++
        totalValue += item.existingRepairItem.total_price || 0
      }
    })

    return { labourCount, partsCount, totalValue, hasExisting: labourCount > 0 || partsCount > 0 }
  }, [selectedItems])

  const redCount = selectedItems.filter(i => i.ragStatus === 'red').length
  const amberCount = selectedItems.filter(i => i.ragStatus === 'amber').length

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken || !name.trim()) return

    setSaving(true)
    setError(null)

    try {
      const checkResultIds = selectedItems.map(i => i.checkResultId)

      await api(
        `/api/v1/health-checks/${healthCheckId}/repair-items`,
        {
          token: session.accessToken,
          method: 'POST',
          body: {
            name: name.trim(),
            description: description.trim() || null,
            is_group: isGroup,
            check_result_ids: checkResultIds
          }
        }
      )

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create repair group')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {selectedItems.length > 1 ? 'Create Repair Group' : 'Create Repair Item'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(90vh-130px)]">
          <div className="px-6 py-4 space-y-4">
            {/* Name field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Repair Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Front Brake Service"
                required
                autoFocus
              />
            </div>

            {/* Description field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                placeholder="Additional notes about this repair..."
              />
            </div>

            {/* Group toggle (only if multiple items) */}
            {selectedItems.length > 1 && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <input
                  type="checkbox"
                  id="isGroup"
                  checked={isGroup}
                  onChange={(e) => setIsGroup(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isGroup" className="text-sm text-gray-700">
                  <span className="font-medium">Create as group</span>
                  <span className="text-gray-500 ml-1">
                    (combines items into single quote line)
                  </span>
                </label>
              </div>
            )}

            {/* Selected items summary */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selected Items ({selectedItems.length})
              </label>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {selectedItems.map((item) => (
                  <div key={item.checkResultId} className="px-3 py-2 flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        item.ragStatus === 'red' ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                    />
                    <span className="text-sm text-gray-700 truncate flex-1">
                      {item.name}
                    </span>
                    {item.existingRepairItem && item.existingRepairItem.total_price > 0 && (
                      <span className="text-xs text-gray-500">
                        £{item.existingRepairItem.total_price.toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* RAG status summary */}
              <div className="mt-2 flex gap-4 text-xs text-gray-500">
                {redCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    {redCount} urgent
                  </span>
                )}
                {amberCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    {amberCount} advisory
                  </span>
                )}
              </div>
            </div>

            {/* Existing data warning */}
            {existingDataSummary.hasExisting && isGroup && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex gap-2">
                  <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm">
                    <p className="font-medium text-blue-800">
                      Existing pricing will be merged
                    </p>
                    <p className="text-blue-700 mt-1">
                      {existingDataSummary.labourCount > 0 && `${existingDataSummary.labourCount} items have labour. `}
                      {existingDataSummary.partsCount > 0 && `${existingDataSummary.partsCount} items have parts. `}
                      This pricing will be automatically migrated to a "Standard" option on the group.
                    </p>
                    <p className="text-blue-600 mt-2 text-xs">
                      Individual items will be preserved within the group - you can expand the group to see them, or ungroup later.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {saving ? 'Creating...' : isGroup ? 'Create Group' : 'Create Repair'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
