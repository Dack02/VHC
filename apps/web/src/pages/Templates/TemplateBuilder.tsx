import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface TemplateItem {
  id: string
  name: string
  description?: string
  itemType: string
  config: Record<string, unknown>
  isRequired: boolean
  sortOrder: number
}

interface TemplateSection {
  id: string
  name: string
  description?: string
  sortOrder: number
  items: TemplateItem[]
}

interface Template {
  id: string
  name: string
  description?: string
  isActive: boolean
  isDefault: boolean
  sections: TemplateSection[]
}

export default function TemplateBuilder() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [template, setTemplate] = useState<Template | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [showAddSectionModal, setShowAddSectionModal] = useState(false)
  const [addItemToSection, setAddItemToSection] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  useEffect(() => {
    fetchTemplate()
  }, [id])

  const fetchTemplate = async () => {
    try {
      setLoading(true)
      const data = await api<Template>(`/api/v1/templates/${id}`, {
        token: session?.accessToken
      })
      setTemplate(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template')
    } finally {
      setLoading(false)
    }
  }

  const handleSectionDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !template) return

    const oldIndex = template.sections.findIndex((s) => s.id === active.id)
    const newIndex = template.sections.findIndex((s) => s.id === over.id)

    const newSections = arrayMove(template.sections, oldIndex, newIndex)
    setTemplate({ ...template, sections: newSections })

    // Save to API
    try {
      await api(`/api/v1/templates/${id}/sections/reorder`, {
        method: 'POST',
        body: { sectionIds: newSections.map((s) => s.id) },
        token: session?.accessToken
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder sections')
      fetchTemplate() // Revert on error
    }
  }

  const handleItemDragEnd = async (sectionId: string, event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !template) return

    const section = template.sections.find((s) => s.id === sectionId)
    if (!section) return

    const oldIndex = section.items.findIndex((i) => i.id === active.id)
    const newIndex = section.items.findIndex((i) => i.id === over.id)

    const newItems = arrayMove(section.items, oldIndex, newIndex)
    const newSections = template.sections.map((s) =>
      s.id === sectionId ? { ...s, items: newItems } : s
    )
    setTemplate({ ...template, sections: newSections })

    // Save to API
    try {
      await api(`/api/v1/sections/${sectionId}/items/reorder`, {
        method: 'POST',
        body: { itemIds: newItems.map((i) => i.id) },
        token: session?.accessToken
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder items')
      fetchTemplate() // Revert on error
    }
  }

  const handleUpdateTemplate = async (updates: Partial<Template>) => {
    setSaving(true)
    try {
      await api(`/api/v1/templates/${id}`, {
        method: 'PATCH',
        body: updates,
        token: session?.accessToken
      })
      setTemplate({ ...template!, ...updates })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update template')
    } finally {
      setSaving(false)
    }
  }

  const handleAddSection = async (name: string, description?: string) => {
    try {
      const section = await api<TemplateSection>(`/api/v1/templates/${id}/sections`, {
        method: 'POST',
        body: { name, description },
        token: session?.accessToken
      })
      setTemplate({
        ...template!,
        sections: [...template!.sections, { ...section, items: [] }]
      })
      setShowAddSectionModal(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add section')
    }
  }

  const handleUpdateSection = async (sectionId: string, updates: { name?: string; description?: string }) => {
    try {
      await api(`/api/v1/templates/${id}/sections/${sectionId}`, {
        method: 'PATCH',
        body: updates,
        token: session?.accessToken
      })
      setTemplate({
        ...template!,
        sections: template!.sections.map((s) =>
          s.id === sectionId ? { ...s, ...updates } : s
        )
      })
      setEditingSection(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update section')
    }
  }

  const handleDeleteSection = async (sectionId: string) => {
    if (!confirm('Are you sure you want to delete this section and all its items?')) return

    try {
      await api(`/api/v1/templates/${id}/sections/${sectionId}`, {
        method: 'DELETE',
        token: session?.accessToken
      })
      setTemplate({
        ...template!,
        sections: template!.sections.filter((s) => s.id !== sectionId)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete section')
    }
  }

  const handleAddItem = async (sectionId: string, itemData: { name: string; itemType: string; config?: Record<string, unknown> }) => {
    try {
      const item = await api<TemplateItem>(`/api/v1/sections/${sectionId}/items`, {
        method: 'POST',
        body: itemData,
        token: session?.accessToken
      })
      setTemplate({
        ...template!,
        sections: template!.sections.map((s) =>
          s.id === sectionId ? { ...s, items: [...s.items, item] } : s
        )
      })
      setAddItemToSection(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item')
    }
  }

  const handleUpdateItem = async (itemId: string, updates: { name?: string; itemType?: string; config?: Record<string, unknown> }) => {
    try {
      await api(`/api/v1/items/${itemId}`, {
        method: 'PATCH',
        body: updates,
        token: session?.accessToken
      })
      setTemplate({
        ...template!,
        sections: template!.sections.map((s) => ({
          ...s,
          items: s.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i))
        }))
      })
      setEditingItem(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item')
    }
  }

  const handleDeleteItem = async (sectionId: string, itemId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return

    try {
      await api(`/api/v1/items/${itemId}`, {
        method: 'DELETE',
        token: session?.accessToken
      })
      setTemplate({
        ...template!,
        sections: template!.sections.map((s) =>
          s.id === sectionId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s
        )
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading template...</div>
      </div>
    )
  }

  if (!template) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">
        Template not found
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/templates')}
            className="text-gray-600 hover:text-gray-900"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
            {template.description && (
              <p className="text-sm text-gray-600">{template.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleUpdateTemplate({ isDefault: !template.isDefault })}
            disabled={saving}
            className={`px-3 py-1.5 text-sm font-medium border ${
              template.isDefault
                ? 'bg-blue-50 text-blue-700 border-blue-300'
                : 'text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {template.isDefault ? 'Default' : 'Set as Default'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-6">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-800 font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Sections */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
        <SortableContext items={template.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {template.sections.map((section) => (
              <SortableSection
                key={section.id}
                section={section}
                isEditing={editingSection === section.id}
                onEdit={() => setEditingSection(section.id)}
                onSave={(updates) => handleUpdateSection(section.id, updates)}
                onCancel={() => setEditingSection(null)}
                onDelete={() => handleDeleteSection(section.id)}
                onAddItem={() => setAddItemToSection(section.id)}
                editingItemId={editingItem}
                onEditItem={(itemId) => setEditingItem(itemId)}
                onSaveItem={(itemId, updates) => handleUpdateItem(itemId, updates)}
                onCancelEditItem={() => setEditingItem(null)}
                onDeleteItem={(itemId) => handleDeleteItem(section.id, itemId)}
                onItemDragEnd={(event) => handleItemDragEnd(section.id, event)}
                sensors={sensors}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add Section Button */}
      <div className="mt-4">
        <button
          onClick={() => setShowAddSectionModal(true)}
          className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-500 hover:border-primary hover:text-primary"
        >
          + Add Section
        </button>
      </div>

      {/* Add Section Modal */}
      {showAddSectionModal && (
        <AddSectionModal
          onClose={() => setShowAddSectionModal(false)}
          onSave={handleAddSection}
        />
      )}

      {/* Add Item Modal */}
      {addItemToSection && (
        <AddItemModal
          onClose={() => setAddItemToSection(null)}
          onSave={(itemData) => handleAddItem(addItemToSection, itemData)}
        />
      )}
    </div>
  )
}

interface SortableSectionProps {
  section: TemplateSection
  isEditing: boolean
  onEdit: () => void
  onSave: (updates: { name?: string; description?: string }) => void
  onCancel: () => void
  onDelete: () => void
  onAddItem: () => void
  editingItemId: string | null
  onEditItem: (itemId: string) => void
  onSaveItem: (itemId: string, updates: { name?: string; itemType?: string; config?: Record<string, unknown> }) => void
  onCancelEditItem: () => void
  onDeleteItem: (itemId: string) => void
  onItemDragEnd: (event: DragEndEvent) => void
  sensors: ReturnType<typeof useSensors>
}

function SortableSection({
  section,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onAddItem,
  editingItemId,
  onEditItem,
  onSaveItem,
  onCancelEditItem,
  onDeleteItem,
  onItemDragEnd,
  sensors
}: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id })
  const [editName, setEditName] = useState(section.name)
  const [editDescription, setEditDescription] = useState(section.description || '')

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  return (
    <div ref={setNodeRef} style={style} className="bg-white border border-gray-200 shadow-sm">
      {/* Section Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button {...attributes} {...listeners} className="cursor-grab text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-12a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
            </svg>
          </button>
          {isEditing ? (
            <div className="flex-1">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-2 py-1 border border-gray-300 text-sm font-semibold"
                autoFocus
              />
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full px-2 py-1 border border-gray-300 text-sm mt-1"
                placeholder="Description (optional)"
              />
            </div>
          ) : (
            <div>
              <h3 className="font-semibold text-gray-900">{section.name}</h3>
              {section.description && (
                <p className="text-xs text-gray-500">{section.description}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                onClick={() => {
                  onSave({ name: editName, description: editDescription || undefined })
                }}
                className="text-xs px-2 py-1 bg-primary text-white"
              >
                Save
              </button>
              <button onClick={onCancel} className="text-xs px-2 py-1 text-gray-600">
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-gray-400">{section.items.length} items</span>
              <button onClick={onEdit} className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100">
                Edit
              </button>
              <button onClick={onDelete} className="text-xs px-2 py-1 text-red-600 hover:bg-red-50">
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Section Items */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
        <SortableContext items={section.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="divide-y divide-gray-100">
            {section.items.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                isEditing={editingItemId === item.id}
                onEdit={() => onEditItem(item.id)}
                onSave={(updates) => onSaveItem(item.id, updates)}
                onCancel={onCancelEditItem}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add Item Button */}
      <div className="px-4 py-2 border-t border-gray-100">
        <button
          onClick={onAddItem}
          className="text-sm text-primary hover:text-primary-dark"
        >
          + Add Item
        </button>
      </div>
    </div>
  )
}

interface SortableItemProps {
  item: TemplateItem
  isEditing: boolean
  onEdit: () => void
  onSave: (updates: { name?: string; itemType?: string; config?: Record<string, unknown> }) => void
  onCancel: () => void
  onDelete: () => void
}

function SortableItem({ item, isEditing, onEdit, onSave, onCancel, onDelete }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id })
  const [editName, setEditName] = useState(item.name)
  const [editType, setEditType] = useState(item.itemType)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  const getItemTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      rag: 'bg-green-100 text-green-800',
      tyre_depth: 'bg-blue-100 text-blue-800',
      brake_measurement: 'bg-orange-100 text-orange-800',
      fluid_level: 'bg-purple-100 text-purple-800',
      measurement: 'bg-yellow-100 text-yellow-800',
      yes_no: 'bg-gray-100 text-gray-800'
    }
    return colors[type] || 'bg-gray-100 text-gray-800'
  }

  return (
    <div ref={setNodeRef} style={style} className="px-4 py-2 flex items-center gap-3 hover:bg-gray-50">
      <button {...attributes} {...listeners} className="cursor-grab text-gray-300 hover:text-gray-500">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-12a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
        </svg>
      </button>

      {isEditing ? (
        <div className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="flex-1 px-2 py-1 border border-gray-300 text-sm"
            autoFocus
          />
          <select
            value={editType}
            onChange={(e) => setEditType(e.target.value)}
            className="px-2 py-1 border border-gray-300 text-sm"
          >
            <option value="rag">RAG</option>
            <option value="tyre_depth">Tyre Depth</option>
            <option value="brake_measurement">Brake Measurement</option>
            <option value="fluid_level">Fluid Level</option>
            <option value="measurement">Measurement</option>
            <option value="yes_no">Yes/No</option>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="select">Select</option>
          </select>
          <button
            onClick={() => onSave({ name: editName, itemType: editType })}
            className="text-xs px-2 py-1 bg-primary text-white"
          >
            Save
          </button>
          <button onClick={onCancel} className="text-xs px-2 py-1 text-gray-600">
            Cancel
          </button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm text-gray-700">{item.name}</span>
          <span className={`text-xs px-2 py-0.5 ${getItemTypeBadge(item.itemType)}`}>
            {item.itemType.replace('_', ' ')}
          </span>
          <button onClick={onEdit} className="text-xs text-gray-500 hover:text-gray-700">
            Edit
          </button>
          <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700">
            Delete
          </button>
        </>
      )}
    </div>
  )
}

function AddSectionModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, description?: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Add New Section</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Section Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300"
              placeholder="e.g., Under Bonnet"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300"
              placeholder="Optional description"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-gray-600">
              Cancel
            </button>
            <button
              onClick={() => onSave(name, description || undefined)}
              disabled={!name.trim()}
              className="px-4 py-2 bg-primary text-white font-semibold disabled:opacity-50"
            >
              Add Section
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AddItemModal({ onClose, onSave }: { onClose: () => void; onSave: (itemData: { name: string; itemType: string; config?: Record<string, unknown> }) => void }) {
  const [name, setName] = useState('')
  const [itemType, setItemType] = useState('rag')

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Add New Item</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300"
              placeholder="e.g., Engine Oil Level"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Type</label>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300"
            >
              <option value="rag">RAG (Red/Amber/Green)</option>
              <option value="tyre_depth">Tyre Depth</option>
              <option value="brake_measurement">Brake Measurement</option>
              <option value="fluid_level">Fluid Level</option>
              <option value="measurement">Measurement</option>
              <option value="yes_no">Yes/No</option>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="select">Select</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-gray-600">
              Cancel
            </button>
            <button
              onClick={() => onSave({ name, itemType })}
              disabled={!name.trim()}
              className="px-4 py-2 bg-primary text-white font-semibold disabled:opacity-50"
            >
              Add Item
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
