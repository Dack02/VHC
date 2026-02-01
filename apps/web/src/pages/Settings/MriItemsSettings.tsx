/**
 * MRI Items Settings
 * Configure Manufacturer Recommended Items for the check-in MRI scan
 */

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface MriItem {
  id: string
  name: string
  description: string | null
  category: string
  itemType: 'date_mileage' | 'yes_no'
  severityWhenDue: string | null
  severityWhenYes: string | null
  severityWhenNo: string | null
  isInformational: boolean
  enabled: boolean
  sortOrder: number
  isDefault: boolean
  salesDescription: string | null
  aiGenerated: boolean
  aiReviewed: boolean
}

interface MriItemsResponse {
  items: MriItem[]
  grouped: Record<string, MriItem[]>
}

const SEVERITY_OPTIONS = [
  { value: 'red', label: 'Red (Urgent)', color: 'bg-rag-red' },
  { value: 'amber', label: 'Amber (Attention)', color: 'bg-rag-amber' },
  { value: 'green', label: 'Green (OK)', color: 'bg-rag-green' },
]

const CATEGORIES = ['Service Items', 'Safety & Compliance', 'Other']

export default function MriItemsSettings() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [grouped, setGrouped] = useState<Record<string, MriItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [editingItem, setEditingItem] = useState<MriItem | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)

  const organizationId = user?.organization?.id

  const fetchItems = useCallback(async () => {
    if (!organizationId || !session?.accessToken) return

    try {
      setLoading(true)
      const data = await api<MriItemsResponse>(
        `/api/v1/organizations/${organizationId}/mri-items`,
        { token: session.accessToken }
      )
      setGrouped(data.grouped || {})
    } catch (err) {
      console.error('Failed to load MRI items:', err)
      toast.error('Failed to load MRI items')
    } finally {
      setLoading(false)
    }
  }, [organizationId, session?.accessToken, toast])

  useEffect(() => {
    if (organizationId) {
      fetchItems()
    }
  }, [organizationId, fetchItems])

  const handleToggleEnabled = async (item: MriItem) => {
    if (!organizationId || !session?.accessToken) return

    setSavingId(item.id)
    try {
      await api(
        `/api/v1/organizations/${organizationId}/mri-items/${item.id}`,
        {
          method: 'PATCH',
          body: { enabled: !item.enabled },
          token: session.accessToken
        }
      )
      // Update local state
      setGrouped(prev => {
        const newGrouped = { ...prev }
        for (const cat of Object.keys(newGrouped)) {
          newGrouped[cat] = newGrouped[cat].map(i =>
            i.id === item.id ? { ...i, enabled: !i.enabled } : i
          )
        }
        return newGrouped
      })
      toast.success(`${item.name} ${!item.enabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      toast.error('Failed to update item')
    } finally {
      setSavingId(null)
    }
  }

  const handleSaveItem = async (item: MriItem) => {
    if (!organizationId || !session?.accessToken) return

    setSavingId(item.id)
    try {
      await api(
        `/api/v1/organizations/${organizationId}/mri-items/${item.id}`,
        {
          method: 'PATCH',
          body: {
            name: item.name,
            description: item.description,
            severityWhenDue: item.severityWhenDue,
            severityWhenYes: item.severityWhenYes,
            severityWhenNo: item.severityWhenNo,
            isInformational: item.isInformational,
            salesDescription: item.salesDescription,
          },
          token: session.accessToken
        }
      )
      // Refresh items
      await fetchItems()
      setEditingItem(null)
      toast.success('Item saved')
    } catch (err) {
      toast.error('Failed to save item')
    } finally {
      setSavingId(null)
    }
  }

  const handleGenerateSalesDescription = async (item: MriItem) => {
    if (!organizationId || !session?.accessToken) return

    setGeneratingId(item.id)
    try {
      const result = await api<{ salesDescription: string }>(
        `/api/v1/organizations/${organizationId}/mri-items/${item.id}/generate-sales-description`,
        {
          method: 'POST',
          token: session.accessToken
        }
      )
      // Update the editing item with the new description
      if (editingItem?.id === item.id) {
        setEditingItem({
          ...editingItem,
          salesDescription: result.salesDescription,
          aiGenerated: true,
          aiReviewed: false
        })
      }
      toast.success('Sales description generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate description')
    } finally {
      setGeneratingId(null)
    }
  }

  const handleDeleteItem = async (item: MriItem) => {
    if (!organizationId || !session?.accessToken) return
    if (item.isDefault) {
      toast.error('Default items cannot be deleted. Disable them instead.')
      return
    }
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return

    setSavingId(item.id)
    try {
      await api(
        `/api/v1/organizations/${organizationId}/mri-items/${item.id}`,
        {
          method: 'DELETE',
          token: session.accessToken
        }
      )
      await fetchItems()
      toast.success('Item deleted')
    } catch (err) {
      toast.error('Failed to delete item')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  const categories = Object.keys(grouped).length > 0 ? Object.keys(grouped) : CATEGORIES

  return (
    <div>
      <SettingsBackLink />
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              to="/settings/workflow"
              className="text-gray-500 hover:text-gray-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">MRI Items</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Configure Manufacturer Recommended Items for the check-in MRI scan
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Item
        </button>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 p-4 mb-6">
        <p className="text-sm text-blue-700">
          <strong>How it works:</strong> MRI items are checked during the vehicle check-in process.
          Items flagged with Red or Amber severity automatically create repair items for technician review.
          Informational items are recorded but do not create repair items.
        </p>
      </div>

      {/* Items by Category */}
      <div className="space-y-6">
        {categories.map(category => {
          const categoryItems = grouped[category] || []
          if (categoryItems.length === 0) return null

          return (
            <div key={category} className="bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  {category}
                </h2>
              </div>
              <div className="divide-y divide-gray-100">
                {categoryItems.map(item => (
                  <MriItemRow
                    key={item.id}
                    item={item}
                    isEditing={editingItem?.id === item.id}
                    editingItem={editingItem}
                    setEditingItem={setEditingItem}
                    onToggleEnabled={() => handleToggleEnabled(item)}
                    onSave={() => editingItem && handleSaveItem(editingItem)}
                    onDelete={() => handleDeleteItem(item)}
                    onGenerateSalesDescription={() => handleGenerateSalesDescription(editingItem || item)}
                    saving={savingId === item.id}
                    generating={generatingId === item.id}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Item Modal */}
      {showAddModal && (
        <AddItemModal
          organizationId={organizationId!}
          token={session?.accessToken || ''}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false)
            fetchItems()
            toast.success('Item added')
          }}
        />
      )}
    </div>
  )
}

// MRI Item Row Component
interface MriItemRowProps {
  item: MriItem
  isEditing: boolean
  editingItem: MriItem | null
  setEditingItem: (item: MriItem | null) => void
  onToggleEnabled: () => void
  onSave: () => void
  onDelete: () => void
  onGenerateSalesDescription: () => void
  saving: boolean
  generating: boolean
}

function MriItemRow({
  item,
  isEditing,
  editingItem,
  setEditingItem,
  onToggleEnabled,
  onSave,
  onDelete,
  onGenerateSalesDescription,
  saving,
  generating,
}: MriItemRowProps) {
  const getSeverityBadge = (severity: string | null) => {
    if (!severity) return null
    const option = SEVERITY_OPTIONS.find(o => o.value === severity)
    if (!option) return null
    return (
      <span className={`px-2 py-0.5 text-xs font-medium text-white ${option.color}`}>
        {option.label.split(' ')[0]}
      </span>
    )
  }

  if (isEditing && editingItem) {
    return (
      <div className="px-6 py-4 bg-gray-50">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={editingItem.name}
              onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={editingItem.description || ''}
              onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value || null })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Optional description"
            />
          </div>

          {editingItem.itemType === 'date_mileage' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Severity When Due</label>
              <select
                value={editingItem.severityWhenDue || ''}
                onChange={(e) => setEditingItem({ ...editingItem, severityWhenDue: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">No severity (informational)</option>
                {SEVERITY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Severity applied when item is past due date or due mileage
              </p>
            </div>
          )}

          {editingItem.itemType === 'yes_no' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Severity When Yes</label>
                <select
                  value={editingItem.severityWhenYes || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, severityWhenYes: e.target.value || null })}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">No severity (informational)</option>
                  {SEVERITY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Severity When No</label>
                <select
                  value={editingItem.severityWhenNo || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, severityWhenNo: e.target.value || null })}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">No severity (informational)</option>
                  {SEVERITY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={editingItem.isInformational}
              onChange={(e) => setEditingItem({ ...editingItem, isInformational: e.target.checked })}
              className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <span className="text-sm text-gray-700">Informational only (never creates repair item)</span>
          </label>

          {/* Sales Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">
                Sales Description
                {editingItem.aiGenerated && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700">
                    AI Generated
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={onGenerateSalesDescription}
                disabled={generating}
                className="text-sm text-primary hover:text-primary-dark font-medium flex items-center gap-1 disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate with AI
                  </>
                )}
              </button>
            </div>
            <textarea
              value={editingItem.salesDescription || ''}
              onChange={(e) => setEditingItem({ ...editingItem, salesDescription: e.target.value || null })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Customer-facing sales description (40-80 words recommended)"
            />
            <p className="text-xs text-gray-500 mt-1">
              This description is shown to customers to explain why this item matters
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setEditingItem(null)}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="bg-primary text-white px-4 py-2 font-medium hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative px-6 py-4 ${!item.enabled ? 'bg-gray-50 opacity-60' : ''}`}>
      {/* Left: Toggle + Content */}
      <div className="flex items-start gap-4 pr-32">
        <label className="relative inline-flex items-center cursor-pointer mt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={onToggleEnabled}
            disabled={saving}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium ${item.enabled ? 'text-gray-900' : 'text-gray-500'}`}>
              {item.name}
            </span>
            {item.isDefault && (
              <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500">
                Default
              </span>
            )}
            {item.isInformational && (
              <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700">
                Info
              </span>
            )}
            <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500">
              {item.itemType === 'date_mileage' ? 'Date/Mileage' : 'Yes/No'}
            </span>
          </div>
          {item.description && (
            <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>
          )}
          {item.salesDescription && (
            <p className="text-sm text-gray-400 italic mt-1 truncate">
              {item.salesDescription.length > 100
                ? item.salesDescription.slice(0, 100) + '...'
                : item.salesDescription}
            </p>
          )}
        </div>
      </div>

      {/* Right: Severity + Actions - absolutely positioned for alignment */}
      <div style={{ position: 'absolute', right: '24px', top: '16px' }} className="flex items-center gap-3">
        {/* Severity badge */}
        <div className="w-14 flex justify-end">
          {item.itemType === 'date_mileage' && getSeverityBadge(item.severityWhenDue)}
          {item.itemType === 'yes_no' && (
            <div className="flex flex-col items-end gap-1">
              {item.severityWhenYes && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">Y:</span>
                  {getSeverityBadge(item.severityWhenYes)}
                </div>
              )}
              {item.severityWhenNo && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">N:</span>
                  {getSeverityBadge(item.severityWhenNo)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditingItem(item)}
            className="p-2 text-gray-400 hover:text-gray-600"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          {!item.isDefault && (
            <button
              onClick={onDelete}
              disabled={saving}
              className="p-2 text-gray-400 hover:text-red-600"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Add Item Modal
interface AddItemModalProps {
  organizationId: string
  token: string
  onClose: () => void
  onSaved: () => void
}

function AddItemModal({ organizationId, token, onClose, onSaved }: AddItemModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Other')
  const [itemType, setItemType] = useState<'date_mileage' | 'yes_no'>('date_mileage')
  const [severityWhenDue, setSeverityWhenDue] = useState<string>('')
  const [severityWhenYes, setSeverityWhenYes] = useState<string>('')
  const [severityWhenNo, setSeverityWhenNo] = useState<string>('')
  const [isInformational, setIsInformational] = useState(false)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }

    setSaving(true)
    try {
      await api(
        `/api/v1/organizations/${organizationId}/mri-items`,
        {
          method: 'POST',
          body: {
            name: name.trim(),
            description: description.trim() || null,
            category,
            itemType,
            severityWhenDue: itemType === 'date_mileage' && severityWhenDue ? severityWhenDue : null,
            severityWhenYes: itemType === 'yes_no' && severityWhenYes ? severityWhenYes : null,
            severityWhenNo: itemType === 'yes_no' && severityWhenNo ? severityWhenNo : null,
            isInformational,
          },
          token
        }
      )
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg mx-4 shadow-xl">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Add MRI Item</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., Battery Health Check"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Type</label>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value as 'date_mileage' | 'yes_no')}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="date_mileage">Date/Mileage (tracks next due date and mileage)</option>
              <option value="yes_no">Yes/No (simple toggle question)</option>
            </select>
          </div>

          {itemType === 'date_mileage' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Severity When Due</label>
              <select
                value={severityWhenDue}
                onChange={(e) => setSeverityWhenDue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">No severity (informational)</option>
                {SEVERITY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {itemType === 'yes_no' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Severity When Yes</label>
                <select
                  value={severityWhenYes}
                  onChange={(e) => setSeverityWhenYes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">No severity (informational)</option>
                  {SEVERITY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Severity When No</label>
                <select
                  value={severityWhenNo}
                  onChange={(e) => setSeverityWhenNo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">No severity (informational)</option>
                  {SEVERITY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isInformational}
              onChange={(e) => setIsInformational(e.target.checked)}
              className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <span className="text-sm text-gray-700">Informational only (never creates repair item)</span>
          </label>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="bg-primary text-white px-4 py-2 font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? 'Adding...' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}
