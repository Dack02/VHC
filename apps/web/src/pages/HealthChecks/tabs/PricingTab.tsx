import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, RepairItem } from '../../../lib/api'

interface PricingTabProps {
  healthCheckId: string
  repairItems: RepairItem[]
  onUpdate: () => void
}

export function PricingTab({ healthCheckId, repairItems, onUpdate }: PricingTabProps) {
  const { session } = useAuth()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    parts_cost: 0,
    labour_cost: 0,
    is_visible: true
  })

  const startEdit = (item: RepairItem) => {
    setEditingId(item.id)
    setEditForm({
      title: item.title,
      description: item.description || '',
      parts_cost: item.parts_cost,
      labour_cost: item.labour_cost,
      is_visible: item.is_visible
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setError(null)
  }

  const saveItem = async (itemId: string) => {
    if (!session?.accessToken) return

    setSaving(true)
    setError(null)

    try {
      await api(`/api/v1/health-checks/${healthCheckId}/repair-items/${itemId}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: editForm
      })
      setEditingId(null)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const toggleVisibility = async (item: RepairItem) => {
    if (!session?.accessToken) return

    try {
      await api(`/api/v1/health-checks/${healthCheckId}/repair-items/${item.id}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { is_visible: !item.is_visible }
      })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  const deleteItem = async (itemId: string) => {
    if (!session?.accessToken) return
    if (!confirm('Are you sure you want to delete this item?')) return

    try {
      await api(`/api/v1/health-checks/${healthCheckId}/repair-items/${itemId}`, {
        method: 'DELETE',
        token: session.accessToken
      })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const generateItems = async () => {
    if (!session?.accessToken) return

    try {
      await api(`/api/v1/health-checks/${healthCheckId}/repair-items/generate`, {
        method: 'POST',
        token: session.accessToken
      })
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate items')
    }
  }

  // Calculate totals
  const visibleItems = repairItems.filter(i => i.is_visible)
  const totalParts = visibleItems.reduce((sum, i) => sum + i.parts_cost, 0)
  const totalLabour = visibleItems.reduce((sum, i) => sum + i.labour_cost, 0)
  const totalAmount = totalParts + totalLabour

  // Group by RAG status
  const redItems = repairItems.filter(i => i.rag_status === 'red')
  const amberItems = repairItems.filter(i => i.rag_status === 'amber')

  return (
    <div>
      {error && (
        <div className="bg-red-50 text-red-700 p-4 mb-4">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Repair Items</h3>
        <button
          onClick={generateItems}
          className="px-3 py-1 text-sm border border-gray-300 hover:bg-gray-50"
        >
          Auto-Generate from Results
        </button>
      </div>

      {repairItems.length === 0 ? (
        <div className="bg-white border border-gray-200 shadow-sm p-8 text-center text-gray-500">
          No repair items yet. Click "Auto-Generate" to create items from red/amber results.
        </div>
      ) : (
        <>
          {/* Urgent Items (Red) */}
          {redItems.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-red-700 mb-2 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                Urgent Items ({redItems.length})
              </h4>
              <ItemList
                items={redItems}
                editingId={editingId}
                editForm={editForm}
                setEditForm={setEditForm}
                saving={saving}
                onStartEdit={startEdit}
                onCancelEdit={cancelEdit}
                onSave={saveItem}
                onToggleVisibility={toggleVisibility}
                onDelete={deleteItem}
              />
            </div>
          )}

          {/* Advisory Items (Amber) */}
          {amberItems.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-yellow-700 mb-2 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-500" />
                Advisory Items ({amberItems.length})
              </h4>
              <ItemList
                items={amberItems}
                editingId={editingId}
                editForm={editForm}
                setEditForm={setEditForm}
                saving={saving}
                onStartEdit={startEdit}
                onCancelEdit={cancelEdit}
                onSave={saveItem}
                onToggleVisibility={toggleVisibility}
                onDelete={deleteItem}
              />
            </div>
          )}

          {/* Totals */}
          <div className="bg-white border border-gray-200 shadow-sm p-6">
            <div className="flex justify-between mb-2">
              <span className="text-gray-500">Parts Total</span>
              <span className="font-medium">£{totalParts.toFixed(2)}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-gray-500">Labour Total</span>
              <span className="font-medium">£{totalLabour.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t border-gray-200 pt-2 mt-2">
              <span>Grand Total</span>
              <span>£{totalAmount.toFixed(2)}</span>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {visibleItems.length} of {repairItems.length} items visible to customer
            </p>
          </div>
        </>
      )}
    </div>
  )
}

interface ItemListProps {
  items: RepairItem[]
  editingId: string | null
  editForm: {
    title: string
    description: string
    parts_cost: number
    labour_cost: number
    is_visible: boolean
  }
  setEditForm: (form: any) => void
  saving: boolean
  onStartEdit: (item: RepairItem) => void
  onCancelEdit: () => void
  onSave: (id: string) => void
  onToggleVisibility: (item: RepairItem) => void
  onDelete: (id: string) => void
}

function ItemList({
  items,
  editingId,
  editForm,
  setEditForm,
  saving,
  onStartEdit,
  onCancelEdit,
  onSave,
  onToggleVisibility,
  onDelete
}: ItemListProps) {
  return (
    <div className="bg-white border border-gray-200 shadow-sm divide-y divide-gray-200">
      {items.map(item => (
        <div key={item.id} className={`p-4 ${!item.is_visible ? 'opacity-50' : ''}`}>
          {editingId === item.id ? (
            // Edit mode
            <div className="space-y-3">
              <input
                type="text"
                value={editForm.title}
                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Title"
              />
              <textarea
                value={editForm.description}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Description"
                rows={2}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Parts (£)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.parts_cost}
                    onChange={e => setEditForm({ ...editForm, parts_cost: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Labour (£)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.labour_cost}
                    onChange={e => setEditForm({ ...editForm, labour_cost: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editForm.is_visible}
                  onChange={e => setEditForm({ ...editForm, is_visible: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">Show to customer</span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => onSave(item.id)}
                  disabled={saving}
                  className="px-3 py-1 bg-primary text-white text-sm hover:bg-primary-dark disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={onCancelEdit}
                  className="px-3 py-1 border border-gray-300 text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            // View mode
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="font-medium text-gray-900">{item.title}</div>
                {item.description && (
                  <div className="text-sm text-gray-500 mt-1">{item.description}</div>
                )}
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-gray-500">Parts: £{item.parts_cost.toFixed(2)}</span>
                  <span className="text-gray-500">Labour: £{item.labour_cost.toFixed(2)}</span>
                  <span className="font-medium">Total: £{item.total_cost.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onToggleVisibility(item)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  title={item.is_visible ? 'Hide from customer' : 'Show to customer'}
                >
                  {item.is_visible ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => onStartEdit(item)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => onDelete(item.id)}
                  className="p-1 text-gray-400 hover:text-red-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
