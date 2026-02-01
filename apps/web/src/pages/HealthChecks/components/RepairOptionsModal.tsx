/**
 * RepairOptionsModal Component
 * Simplified CRUD modal for managing repair options: create, delete, select, toggle recommended.
 * Parts editing is handled inline in the PartsTab via option sub-sections.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { api, RepairOption } from '../../../lib/api'

interface RepairOptionsModalProps {
  repairItemId: string
  repairItemTitle: string
  onClose: () => void
  onUpdate: () => void
}

export function RepairOptionsModal({
  repairItemId,
  repairItemTitle,
  onClose,
  onUpdate
}: RepairOptionsModalProps) {
  const { session } = useAuth()
  const toast = useToast()

  // Data
  const [options, setOptions] = useState<RepairOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add option form
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newIsRecommended, setNewIsRecommended] = useState(false)
  const [addingOption, setAddingOption] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  // Fetch options
  const fetchOptions = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const data = await api<{ options: RepairOption[] }>(
        `/api/v1/repair-items/${repairItemId}/options`,
        { token: session.accessToken }
      )
      setOptions(data.options || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load options')
    }
  }, [session?.accessToken, repairItemId])

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await fetchOptions()
      setLoading(false)
    }
    load()
  }, [fetchOptions])

  // ============================================================================
  // OPTION CRUD
  // ============================================================================

  const handleAddOption = async () => {
    if (!session?.accessToken || !newName.trim()) return
    setAddingOption(true)
    setError(null)
    try {
      await api(`/api/v1/repair-items/${repairItemId}/options`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          name: newName.trim(),
          description: newDescription.trim() || null,
          is_recommended: newIsRecommended
        }
      })
      setNewName('')
      setNewDescription('')
      setNewIsRecommended(false)
      setShowAddForm(false)
      await fetchOptions()
      onUpdate()
      toast.success('Option added')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add option')
    } finally {
      setAddingOption(false)
    }
  }

  const handleDeleteOption = async (optionId: string) => {
    if (!session?.accessToken) return
    if (!confirm('Delete this option? All associated labour and parts will also be removed.')) return
    try {
      await api(`/api/v1/repair-options/${optionId}`, {
        method: 'DELETE',
        token: session.accessToken
      })
      await fetchOptions()
      onUpdate()
      toast.success('Option deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete option')
    }
  }

  const handleSelectOption = async (optionId: string) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/repair-items/${repairItemId}/select-option`, {
        method: 'POST',
        token: session.accessToken,
        body: { option_id: optionId }
      })
      await fetchOptions()
      onUpdate()
      toast.success('Option selected')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to select option')
    }
  }

  const handleToggleRecommended = async (option: RepairOption) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/repair-options/${option.id}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { is_recommended: !option.isRecommended }
      })
      await fetchOptions()
      onUpdate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update option')
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold">Manage Options</h3>
            <p className="text-sm text-gray-500">{repairItemTitle}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>
          ) : (
            <div className="space-y-4">
              {options.length === 0 && !showAddForm ? (
                <div className="text-center py-8">
                  <div className="text-gray-400 mb-4">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-gray-500 mb-4">No options yet. Add repair options to offer choices like Standard vs Premium parts.</p>
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark"
                  >
                    Add First Option
                  </button>
                </div>
              ) : (
                <>
                  {/* Options list */}
                  {options.map(option => (
                    <div
                      key={option.id}
                      className="border border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">{option.name}</span>
                            {option.isRecommended && (
                              <span className="px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded-lg">
                                RECOMMENDED
                              </span>
                            )}
                          </div>
                          {option.description && (
                            <div className="text-sm text-gray-500 mt-1">{option.description}</div>
                          )}
                        </div>
                      </div>

                      {/* Read-only pricing summary */}
                      <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                        <span>Labour: {formatCurrency(option.labourTotal)}</span>
                        <span>Parts: {formatCurrency(option.partsTotal)}</span>
                        <span className="font-semibold text-gray-900">
                          Total: {formatCurrency(option.subtotal)} + VAT = {formatCurrency(option.totalIncVat)}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSelectOption(option.id)}
                          className="px-3 py-1.5 text-sm font-medium text-primary border border-primary rounded-lg hover:bg-primary hover:text-white"
                        >
                          Select
                        </button>
                        <button
                          onClick={() => handleToggleRecommended(option)}
                          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          {option.isRecommended ? 'Remove Recommended' : 'Mark Recommended'}
                        </button>
                        <button
                          onClick={() => handleDeleteOption(option.id)}
                          className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add option form */}
                  {showAddForm ? (
                    <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
                      <div className="text-sm font-medium text-gray-700">Add New Option</div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Name *</label>
                        <input
                          type="text"
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                          placeholder="e.g., Standard, Premium, Budget"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Description</label>
                        <input
                          type="text"
                          value={newDescription}
                          onChange={e => setNewDescription(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                          placeholder="e.g., OEM quality parts with 12 month warranty"
                        />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newIsRecommended}
                          onChange={e => setNewIsRecommended(e.target.checked)}
                          className="rounded-lg text-primary focus:ring-primary"
                        />
                        <span className="text-sm text-gray-700">Mark as recommended</span>
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setShowAddForm(false)
                            setNewName('')
                            setNewDescription('')
                            setNewIsRecommended(false)
                          }}
                          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleAddOption}
                          disabled={addingOption || !newName.trim()}
                          className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50"
                        >
                          {addingOption ? 'Adding...' : 'Add Option'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddForm(true)}
                      className="w-full py-3 border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-primary hover:text-primary rounded-lg"
                    >
                      + Add Option
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 flex-shrink-0">
          <p className="text-xs text-gray-400">Parts are managed inline in the Parts tab</p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function formatCurrency(amount: number): string {
  return `£${amount.toFixed(2)}`
}
