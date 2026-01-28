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

interface ReasonType {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  isCustom: boolean
}

interface TemplateItem {
  id: string
  name: string
  description?: string
  itemType: string
  config: Record<string, unknown>
  isRequired: boolean
  sortOrder: number
  reasonType?: string | null
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
  const [itemReasonCounts, setItemReasonCounts] = useState<Record<string, { reasonCount: number; reasonType: string | null }>>({})
  const [generatingReasons, setGeneratingReasons] = useState(false)
  const [generateResult, setGenerateResult] = useState<{ success: boolean; message: string } | null>(null)
  const [reasonTypes, setReasonTypes] = useState<ReasonType[]>([])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  useEffect(() => {
    fetchTemplate()
    fetchReasonCounts()
    fetchReasonTypes()
  }, [id])

  const fetchReasonTypes = async () => {
    try {
      const data = await api<{ reasonTypes: ReasonType[] }>('/api/v1/reason-types', {
        token: session?.accessToken
      })
      setReasonTypes(data.reasonTypes || [])
    } catch (err) {
      console.error('Failed to fetch reason types:', err)
    }
  }

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

  const fetchReasonCounts = async () => {
    try {
      const data = await api<{ itemReasonCounts: Record<string, { reasonCount: number; reasonType: string | null }> }>(
        `/api/v1/templates/${id}/item-reason-counts`,
        { token: session?.accessToken }
      )
      setItemReasonCounts(data.itemReasonCounts || {})
    } catch (err) {
      console.error('Failed to fetch reason counts:', err)
    }
  }

  const handleGenerateAllReasons = async () => {
    if (!confirm('Generate reasons for all items that don\'t have any? This may take a moment.')) return

    setGeneratingReasons(true)
    setGenerateResult(null)
    try {
      const data = await api<{
        success: boolean
        itemsProcessed: number
        typesProcessed: number
        reasonsCreated: number
      }>(`/api/v1/templates/${id}/generate-all-reasons`, {
        method: 'POST',
        token: session?.accessToken
      })
      setGenerateResult({
        success: true,
        message: `Generated ${data.reasonsCreated} reasons for ${data.itemsProcessed} items and ${data.typesProcessed} types`
      })
      fetchReasonCounts()
    } catch (err) {
      setGenerateResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to generate reasons'
      })
    } finally {
      setGeneratingReasons(false)
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

  const handleAddItem = async (sectionId: string, itemData: { name: string; itemType: string; reasonType?: string; config?: Record<string, unknown>; isRequired?: boolean }) => {
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
      fetchReasonCounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item')
    }
  }

  const handleUpdateItem = async (itemId: string, updates: { name?: string; itemType?: string; config?: Record<string, unknown>; reasonType?: string | null; isRequired?: boolean }) => {
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
      // Refresh reason counts if reason type changed
      if (updates.reasonType !== undefined) {
        fetchReasonCounts()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item')
    }
  }

  const handleGenerateReasonsForItem = async (itemId: string, reasonType?: string | null) => {
    try {
      if (reasonType) {
        // Generate for the reason type
        await api(`/api/v1/reasons/by-type/${reasonType}/generate`, {
          method: 'POST',
          token: session?.accessToken
        })
      } else {
        // Generate for the specific item
        await api(`/api/v1/template-items/${itemId}/reasons/generate`, {
          method: 'POST',
          token: session?.accessToken
        })
      }
      fetchReasonCounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate reasons')
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
            onClick={handleGenerateAllReasons}
            disabled={generatingReasons}
            className="px-3 py-1.5 text-sm font-medium border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
          >
            {generatingReasons ? 'Generating...' : 'Generate All Missing Reasons'}
          </button>
          <button
            onClick={() => navigate(`/settings/reason-library?templateId=${id}`)}
            className="px-3 py-1.5 text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            Reason Library
          </button>
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

      {/* Generate Result Banner */}
      {generateResult && (
        <div className={`mb-4 px-4 py-3 border ${generateResult.success ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {generateResult.message}
          <button onClick={() => setGenerateResult(null)} className="ml-2 font-semibold">
            Dismiss
          </button>
        </div>
      )}

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
                itemReasonCounts={itemReasonCounts}
                onGenerateReasons={handleGenerateReasonsForItem}
                templateId={id!}
                reasonTypes={reasonTypes}
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
          reasonTypes={reasonTypes}
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
  onSaveItem: (itemId: string, updates: { name?: string; itemType?: string; config?: Record<string, unknown>; reasonType?: string | null }) => void
  onCancelEditItem: () => void
  onDeleteItem: (itemId: string) => void
  onItemDragEnd: (event: DragEndEvent) => void
  sensors: ReturnType<typeof useSensors>
  itemReasonCounts: Record<string, { reasonCount: number; reasonType: string | null }>
  onGenerateReasons: (itemId: string, reasonType?: string | null) => Promise<void>
  templateId: string
  reasonTypes: ReasonType[]
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
  sensors,
  itemReasonCounts,
  onGenerateReasons,
  templateId,
  reasonTypes
}: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id })
  const [editName, setEditName] = useState(section.name)
  const [editDescription, setEditDescription] = useState(section.description || '')
  const [showMenu, setShowMenu] = useState(false)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  return (
    <div ref={setNodeRef} style={style} className="bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden">
      {/* Section Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button {...attributes} {...listeners} className="cursor-grab text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-12a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
            </svg>
          </button>
          {isEditing ? (
            <div className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="px-2 py-1 border border-gray-300 text-sm font-semibold rounded"
                autoFocus
              />
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="px-2 py-1 border border-gray-300 text-sm rounded"
                placeholder="Description (optional)"
              />
              <button
                onClick={() => {
                  onSave({ name: editName, description: editDescription || undefined })
                }}
                className="text-xs px-3 py-1 bg-primary text-white rounded"
              >
                Save
              </button>
              <button onClick={onCancel} className="text-xs px-2 py-1 text-gray-600">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">{section.name}</h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {section.items.length} {section.items.length === 1 ? 'item' : 'items'}
              </span>
              {section.description && (
                <span className="text-xs text-gray-500">— {section.description}</span>
              )}
            </div>
          )}
        </div>
        {!isEditing && (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  <button
                    onClick={() => { onEdit(); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit Section
                  </button>
                  <button
                    onClick={() => { onDelete(); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Section
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Column Headers */}
      {section.items.length > 0 && (
        <div className="hidden sm:grid grid-cols-[32px_1fr_120px_100px_140px] gap-2 px-4 py-2 bg-gray-100 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <div></div>
          <div>Item Name</div>
          <div>Type</div>
          <div>Reasons</div>
          <div className="text-right">Actions</div>
        </div>
      )}

      {/* Section Items */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
        <SortableContext items={section.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div>
            {section.items.map((item, index) => (
              <SortableItem
                key={item.id}
                item={item}
                isEditing={editingItemId === item.id}
                onEdit={() => onEditItem(item.id)}
                onSave={(updates) => onSaveItem(item.id, updates)}
                onCancel={onCancelEditItem}
                onDelete={() => onDeleteItem(item.id)}
                reasonInfo={itemReasonCounts[item.id]}
                onGenerateReasons={() => onGenerateReasons(item.id, item.reasonType)}
                templateId={templateId}
                isEven={index % 2 === 0}
                reasonTypes={reasonTypes}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add Item Button */}
      <div className="px-4 py-3 border-t border-gray-100">
        <button
          onClick={onAddItem}
          className="text-sm text-primary hover:text-primary-dark font-medium"
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
  onSave: (updates: { name?: string; itemType?: string; config?: Record<string, unknown>; reasonType?: string | null; isRequired?: boolean }) => void
  onCancel: () => void
  onDelete: () => void
  reasonInfo?: { reasonCount: number; reasonType: string | null }
  onGenerateReasons: () => Promise<void>
  templateId: string
  isEven?: boolean
  reasonTypes: ReasonType[]
}

function SortableItem({ item, isEditing, onEdit, onSave, onCancel, onDelete, reasonInfo, onGenerateReasons, isEven, reasonTypes }: SortableItemProps) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id })
  const [editName, setEditName] = useState(item.name)
  const [editReasonType, setEditReasonType] = useState(item.reasonType || '')
  const [editIsRequired, setEditIsRequired] = useState(item.isRequired || false)
  const [generating, setGenerating] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  const handleSave = () => {
    const oldReasonType = item.reasonType
    const newReasonType = editReasonType || null

    // Warn if changing from blank to a type and item has specific reasons
    if (!oldReasonType && newReasonType && reasonInfo && reasonInfo.reasonCount > 0 && !reasonInfo.reasonType) {
      const confirmed = confirm(
        `This item has ${reasonInfo.reasonCount} specific reasons. Changing to '${newReasonType}' will use shared reasons instead. Continue?`
      )
      if (!confirmed) return
    }

    onSave({ name: editName, reasonType: newReasonType, isRequired: editIsRequired })
  }

  const handleManageReasons = () => {
    if (item.reasonType) {
      navigate(`/settings/reason-library?reasonType=${item.reasonType}`)
    } else {
      navigate(`/settings/reason-library?templateItemId=${item.id}`)
    }
  }

  const handleGenerateReasons = async () => {
    setGenerating(true)
    try {
      await onGenerateReasons()
    } finally {
      setGenerating(false)
    }
  }

  const reasonCount = reasonInfo?.reasonCount ?? 0
  const hasNoReasons = reasonCount === 0

  // Get reason type display label
  const getReasonTypeLabel = (type: string) => {
    const found = reasonTypes.find(rt => rt.id === type)
    return found?.name || type
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`h-12 px-4 flex sm:grid sm:grid-cols-[32px_1fr_120px_100px_140px] gap-2 items-center border-b border-gray-100 last:border-b-0 ${
        isEven ? 'bg-white' : 'bg-gray-50/50'
      } ${hasNoReasons ? '!bg-amber-50/50' : ''} hover:bg-blue-50/30`}
    >
      {/* Drag Handle */}
      <button {...attributes} {...listeners} className="cursor-grab text-gray-300 hover:text-gray-500 flex-shrink-0">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-12a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
        </svg>
      </button>

      {isEditing ? (
        /* Inline Edit Mode - spans remaining columns */
        <div className="col-span-4 flex items-center gap-2 flex-1 min-w-0">
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 border border-gray-300 text-sm rounded"
            placeholder="Item name"
            autoFocus
          />
          <select
            value={editReasonType}
            onChange={(e) => setEditReasonType(e.target.value)}
            className="w-32 px-2 py-1 border border-gray-300 text-sm rounded"
          >
            <option value="">None (unique)</option>
            {reasonTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
            <input
              type="checkbox"
              checked={editIsRequired}
              onChange={(e) => setEditIsRequired(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            Required
          </label>
          <button
            onClick={handleSave}
            className="text-xs px-3 py-1.5 bg-primary text-white rounded font-medium"
          >
            Save
          </button>
          <button onClick={onCancel} className="text-xs px-2 py-1.5 text-gray-600 hover:text-gray-800">
            Cancel
          </button>
        </div>
      ) : (
        <>
          {/* Item Name */}
          <div className="flex-1 min-w-0 truncate flex items-center gap-2">
            <span className="text-sm text-gray-800">{item.name}</span>
            {item.isRequired && (
              <span className="text-xs px-1.5 py-0.5 bg-rag-red text-white font-medium">
                Required
              </span>
            )}
          </div>

          {/* Reason Type - muted pill badge */}
          <div className="hidden sm:flex items-center">
            {item.reasonType ? (
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                {getReasonTypeLabel(item.reasonType)}
              </span>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </div>

          {/* Reasons Count with icon */}
          <div className="hidden sm:flex items-center">
            {hasNoReasons ? (
              <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full inline-flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                0
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full inline-flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {reasonCount}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-1 flex-shrink-0">
            {/* Mobile: Show reasons badge inline */}
            <span className="sm:hidden text-xs">
              {hasNoReasons ? (
                <span className="text-amber-600">0</span>
              ) : (
                <span className="text-green-600">{reasonCount}</span>
              )}
            </span>

            {hasNoReasons ? (
              <button
                onClick={handleGenerateReasons}
                disabled={generating}
                className="text-xs px-2 py-1 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded disabled:opacity-50 font-medium"
              >
                {generating ? '...' : 'Generate'}
              </button>
            ) : null}

            <button
              onClick={onEdit}
              className="text-xs px-2 py-1 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
            >
              Edit
            </button>

            {/* Overflow menu for additional actions */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                    {!hasNoReasons && (
                      <button
                        onClick={() => { handleManageReasons(); setShowMenu(false); }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                        </svg>
                        Manage Reasons
                      </button>
                    )}
                    {hasNoReasons && (
                      <button
                        onClick={() => { handleGenerateReasons(); setShowMenu(false); }}
                        disabled={generating}
                        className="w-full px-3 py-2 text-left text-sm text-purple-700 hover:bg-purple-50 flex items-center gap-2 disabled:opacity-50"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Generate Reasons
                      </button>
                    )}
                    <button
                      onClick={() => { onDelete(); setShowMenu(false); }}
                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete Item
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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

function AddItemModal({ onClose, onSave, reasonTypes }: { onClose: () => void; onSave: (itemData: { name: string; itemType: string; reasonType?: string; config?: Record<string, unknown>; isRequired?: boolean }) => void; reasonTypes: ReasonType[] }) {
  const [name, setName] = useState('')
  const [itemType, setItemType] = useState('rag')
  const [reasonType, setReasonType] = useState('')
  const [isRequired, setIsRequired] = useState(false)

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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason Type</label>
            <select
              value={reasonType}
              onChange={(e) => setReasonType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300"
            >
              <option value="">None (unique item reasons)</option>
              {reasonTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Items with the same reason type share the same reason library
            </p>
          </div>
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="w-4 h-4 text-primary border-gray-300"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Required Item</span>
                <p className="text-xs text-gray-500">
                  Technicians must complete this item before submitting
                </p>
              </div>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-gray-600">
              Cancel
            </button>
            <button
              onClick={() => onSave({ name, itemType, reasonType: reasonType || undefined, isRequired })}
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
