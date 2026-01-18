/**
 * EditReasons - Edit reasons for a specific type or item
 * Shows reasons grouped by RAG status with drag-and-drop reordering
 */

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface Category {
  id: string
  name: string
  color: string
  typicalRag: string
}

interface Reason {
  id: string
  reasonText: string
  technicalDescription: string | null
  customerDescription: string | null
  defaultRag: 'red' | 'amber' | 'green'
  categoryId: string | null
  categoryName: string | null
  categoryColor: string | null
  suggestedFollowUpDays: number | null
  suggestedFollowUpText: string | null
  usageCount: number
  timesApproved: number
  timesDeclined: number
  aiGenerated: boolean
  aiReviewed: boolean
  isActive: boolean
  sortOrder: number
}

interface ModalState {
  isOpen: boolean
  mode: 'add' | 'edit'
  reason: Reason | null
}

export default function EditReasons() {
  const { type, itemId } = useParams<{ type?: string; itemId?: string }>()
  const { session } = useAuth()

  const [reasons, setReasons] = useState<Reason[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [headerInfo, setHeaderInfo] = useState<{ title: string; subtitle: string }>({
    title: '',
    subtitle: ''
  })
  const [modal, setModal] = useState<ModalState>({ isOpen: false, mode: 'add', reason: null })

  const isTypeView = !!type

  useEffect(() => {
    fetchCategories()
    fetchReasons()
  }, [type, itemId])

  const fetchCategories = async () => {
    try {
      const data = await api<{ categories: Category[] }>('/api/v1/reason-categories', {
        token: session?.accessToken
      })
      setCategories(data.categories || [])
    } catch (err) {
      console.error('Failed to fetch categories:', err)
    }
  }

  const fetchReasons = async () => {
    setLoading(true)
    try {
      if (isTypeView) {
        console.log('[EditReasons] Fetching by type:', type)
        const data = await api<{ reasons: Reason[] }>(
          `/api/v1/reasons/by-type/${type}`,
          { token: session?.accessToken }
        )
        console.log('[EditReasons] Response for type:', type, data)
        setReasons(data.reasons || [])
        setHeaderInfo({
          title: type!.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          subtitle: 'Applies to all items of this type'
        })
      } else if (itemId) {
        console.log('[EditReasons] Fetching by itemId:', itemId)
        // Fetch item info first
        const itemData = await api<{ id: string; name: string; reasonType?: string }>(
          `/api/v1/template-items/${itemId}`,
          { token: session?.accessToken }
        )
        console.log('[EditReasons] Item data:', itemData)
        // Then fetch reasons
        const data = await api<{ reasons: Reason[] }>(
          `/api/v1/template-items/${itemId}/reasons`,
          { token: session?.accessToken }
        )
        console.log('[EditReasons] Response for itemId:', itemId, data)
        setReasons(data.reasons || [])
        setHeaderInfo({
          title: itemData.name,
          subtitle: 'Specific item reasons'
        })
      }
    } catch (err) {
      console.error('Failed to fetch reasons:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (generating) return
    setGenerating(true)
    try {
      const endpoint = isTypeView
        ? `/api/v1/reasons/by-type/${type}/generate`
        : `/api/v1/template-items/${itemId}/reasons/generate`

      await api(endpoint, {
        method: 'POST',
        token: session?.accessToken
      })
      fetchReasons()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate')
    } finally {
      setGenerating(false)
    }
  }

  const handleMarkReviewed = async (reasonId: string) => {
    try {
      await api(`/api/v1/item-reasons/${reasonId}/mark-reviewed`, {
        method: 'POST',
        token: session?.accessToken
      })
      setReasons(prev => prev.map(r =>
        r.id === reasonId ? { ...r, aiReviewed: true } : r
      ))
    } catch (err) {
      console.error('Failed to mark reviewed:', err)
    }
  }

  const handleDelete = async (reasonId: string) => {
    if (!confirm('Are you sure you want to delete this reason?')) return
    try {
      await api(`/api/v1/item-reasons/${reasonId}`, {
        method: 'DELETE',
        token: session?.accessToken
      })
      setReasons(prev => prev.filter(r => r.id !== reasonId))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleSaveReason = async (data: Partial<Reason>) => {
    try {
      if (modal.mode === 'edit' && modal.reason) {
        await api(`/api/v1/item-reasons/${modal.reason.id}`, {
          method: 'PATCH',
          body: data,
          token: session?.accessToken
        })
      } else {
        const endpoint = isTypeView
          ? `/api/v1/reasons/by-type/${type}`
          : `/api/v1/template-items/${itemId}/reasons`
        await api(endpoint, {
          method: 'POST',
          body: data,
          token: session?.accessToken
        })
      }
      setModal({ isOpen: false, mode: 'add', reason: null })
      fetchReasons()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  // Group reasons by RAG status
  const redReasons = reasons.filter(r => r.defaultRag === 'red')
  const amberReasons = reasons.filter(r => r.defaultRag === 'amber')
  const greenReasons = reasons.filter(r => r.defaultRag === 'green')
  const unusedReasons = reasons.filter(r => r.usageCount === 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link to="/settings/reasons" className="hover:text-gray-700">Reason Library</Link>
          <span>/</span>
          <span>{headerInfo.title}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{headerInfo.title} — Reasons</h1>
            <p className="text-gray-600">{headerInfo.subtitle}</p>
          </div>
          <button
            onClick={() => setModal({ isOpen: true, mode: 'add', reason: null })}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add New
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
        >
          {generating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate with AI
            </>
          )}
        </button>
      </div>

      {/* Unused Warning */}
      {unusedReasons.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 p-4 rounded-lg mb-6 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          {unusedReasons.length} reason{unusedReasons.length > 1 ? 's' : ''} never used — consider removing
        </div>
      )}

      {/* Red Reasons */}
      <ReasonSection
        title="Safety Critical"
        ragColor="red"
        reasons={redReasons}
        onEdit={(r) => setModal({ isOpen: true, mode: 'edit', reason: r })}
        onDelete={handleDelete}
        onMarkReviewed={handleMarkReviewed}
      />

      {/* Amber Reasons */}
      <ReasonSection
        title="Wear / Maintenance / Advisory"
        ragColor="amber"
        reasons={amberReasons}
        onEdit={(r) => setModal({ isOpen: true, mode: 'edit', reason: r })}
        onDelete={handleDelete}
        onMarkReviewed={handleMarkReviewed}
      />

      {/* Green Reasons */}
      <ReasonSection
        title="Positive"
        ragColor="green"
        reasons={greenReasons}
        onEdit={(r) => setModal({ isOpen: true, mode: 'edit', reason: r })}
        onDelete={handleDelete}
        onMarkReviewed={handleMarkReviewed}
      />

      {/* Add/Edit Modal */}
      {modal.isOpen && (
        <ReasonModal
          mode={modal.mode}
          reason={modal.reason}
          categories={categories}
          isTypeView={isTypeView}
          onSave={handleSaveReason}
          onClose={() => setModal({ isOpen: false, mode: 'add', reason: null })}
        />
      )}
    </div>
  )
}

// Reason Section Component
function ReasonSection({
  title,
  ragColor,
  reasons,
  onEdit,
  onDelete,
  onMarkReviewed
}: {
  title: string
  ragColor: 'red' | 'amber' | 'green'
  reasons: Reason[]
  onEdit: (reason: Reason) => void
  onDelete: (id: string) => void
  onMarkReviewed: (id: string) => void
}) {
  const bgColor = ragColor === 'red' ? 'bg-red-500' :
                  ragColor === 'amber' ? 'bg-amber-500' : 'bg-green-500'
  const titleColor = ragColor === 'red' ? 'text-red-700' :
                     ragColor === 'amber' ? 'text-amber-700' : 'text-green-700'

  return (
    <div className="mb-6">
      <h2 className={`text-lg font-semibold ${titleColor} flex items-center gap-2 mb-3`}>
        <span className={`w-4 h-4 ${bgColor} rounded-full`} />
        {title}
      </h2>

      {reasons.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg text-gray-500 text-center">
          No {ragColor} reasons yet
        </div>
      ) : (
        <div className="space-y-2">
          {reasons.map((reason) => {
            const approvalRate = (reason.timesApproved + reason.timesDeclined) > 0
              ? Math.round((reason.timesApproved / (reason.timesApproved + reason.timesDeclined)) * 100)
              : null

            return (
              <div
                key={reason.id}
                className="bg-white border border-gray-200 p-4 rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center gap-3 flex-1">
                  {/* Drag Handle (placeholder - would need DnD library) */}
                  <div className="text-gray-400 cursor-move">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </div>

                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{reason.reasonText}</div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        reason.defaultRag === 'red' ? 'bg-red-100 text-red-700' :
                        reason.defaultRag === 'amber' ? 'bg-amber-100 text-amber-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {reason.defaultRag.toUpperCase()}
                      </span>

                      {reason.aiGenerated && !reason.aiReviewed && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                          AI
                        </span>
                      )}

                      {reason.aiReviewed && (
                        <span className="text-green-600 flex items-center gap-1">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Reviewed
                        </span>
                      )}

                      <span>{reason.usageCount} uses</span>

                      {approvalRate !== null && (
                        <span>{approvalRate}% approved</span>
                      )}

                      {reason.suggestedFollowUpDays && (
                        <span>Follow-up: {reason.suggestedFollowUpDays} days</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {reason.aiGenerated && !reason.aiReviewed && (
                    <button
                      onClick={() => onMarkReviewed(reason.id)}
                      className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded"
                    >
                      Mark Reviewed
                    </button>
                  )}
                  <button
                    onClick={() => onEdit(reason)}
                    className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 rounded border border-gray-300"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(reason.id)}
                    className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded border border-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Add/Edit Reason Modal
function ReasonModal({
  mode,
  reason,
  categories,
  isTypeView,
  onSave,
  onClose
}: {
  mode: 'add' | 'edit'
  reason: Reason | null
  categories: Category[]
  isTypeView: boolean
  onSave: (data: Partial<Reason>) => void
  onClose: () => void
}) {
  const { session } = useAuth()

  const [formData, setFormData] = useState({
    reasonText: reason?.reasonText || '',
    categoryId: reason?.categoryId || '',
    defaultRag: reason?.defaultRag || 'amber',
    technicalDescription: reason?.technicalDescription || '',
    customerDescription: reason?.customerDescription || '',
    suggestedFollowUpDays: reason?.suggestedFollowUpDays?.toString() || '',
    suggestedFollowUpText: reason?.suggestedFollowUpText || ''
  })
  const [regenerating, setRegenerating] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleRegenerateDescription = async () => {
    if (!reason?.id || regenerating) return
    setRegenerating(true)
    try {
      const result = await api<{
        technicalDescription: string
        customerDescription: string
      }>(`/api/v1/item-reasons/${reason.id}/regenerate-descriptions`, {
        method: 'POST',
        token: session?.accessToken
      })
      setFormData(prev => ({
        ...prev,
        technicalDescription: result.technicalDescription,
        customerDescription: result.customerDescription
      }))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.reasonText.trim()) return

    setSaving(true)
    await onSave({
      reasonText: formData.reasonText,
      categoryId: formData.categoryId || null,
      defaultRag: formData.defaultRag as 'red' | 'amber' | 'green',
      technicalDescription: formData.technicalDescription || null,
      customerDescription: formData.customerDescription || null,
      suggestedFollowUpDays: formData.suggestedFollowUpDays ? parseInt(formData.suggestedFollowUpDays) : null,
      suggestedFollowUpText: formData.suggestedFollowUpText || null
    })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {mode === 'add' ? 'Add Reason' : 'Edit Reason'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Scope (for type view in add mode) */}
          {isTypeView && mode === 'add' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Applies to</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" value="type" defaultChecked />
                  <span>All items of this type</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" value="specific" />
                  <span>Specific item only</span>
                </label>
              </div>
            </div>
          )}

          {/* Reason Text */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason Text (what technician sees) *
            </label>
            <input
              type="text"
              value={formData.reasonText}
              onChange={(e) => setFormData({ ...formData, reasonText: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              required
            />
          </div>

          {/* Category and RAG */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">Select category...</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Status</label>
              <select
                value={formData.defaultRag}
                onChange={(e) => setFormData({ ...formData, defaultRag: e.target.value as 'red' | 'amber' | 'green' })}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="red">Red</option>
                <option value="amber">Amber</option>
                <option value="green">Green</option>
              </select>
            </div>
          </div>

          {/* Technical Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Technical Description (for service advisor)
            </label>
            <textarea
              value={formData.technicalDescription}
              onChange={(e) => setFormData({ ...formData, technicalDescription: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            />
          </div>

          {/* Customer Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer Description (sent to customer)
            </label>
            <textarea
              value={formData.customerDescription}
              onChange={(e) => setFormData({ ...formData, customerDescription: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            />
            {mode === 'edit' && reason?.id && (
              <button
                type="button"
                onClick={handleRegenerateDescription}
                disabled={regenerating}
                className="mt-2 text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1"
              >
                {regenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Regenerate with AI
                  </>
                )}
              </button>
            )}
          </div>

          {/* Follow-up */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Follow-up Suggestion (tech can override)
            </label>
            <div className="grid grid-cols-2 gap-4">
              <select
                value={formData.suggestedFollowUpDays}
                onChange={(e) => setFormData({ ...formData, suggestedFollowUpDays: e.target.value })}
                className="border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">None</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">365 days</option>
              </select>
              <input
                type="text"
                value={formData.suggestedFollowUpText}
                onChange={(e) => setFormData({ ...formData, suggestedFollowUpText: e.target.value })}
                placeholder="Custom text..."
                className="border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
          </div>

          {/* Usage Stats (if editing) */}
          {mode === 'edit' && reason && (
            <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-600">
              <div className="flex items-center gap-4">
                <span>Usage: {reason.usageCount} times</span>
                {reason.timesApproved + reason.timesDeclined > 0 && (
                  <span>
                    Approval rate: {Math.round((reason.timesApproved / (reason.timesApproved + reason.timesDeclined)) * 100)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !formData.reasonText.trim()}
              className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
