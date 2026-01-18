/**
 * ReasonTypes - Admin page for managing reason types
 * System types can be deleted by super admins
 * Custom types can be added, edited, and deleted by org admins
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useSuperAdminSafe } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface ReasonType {
  id: string
  name: string
  description: string | null
  organizationId: string | null
  isSystem: boolean
  isCustom: boolean
  itemCount: number
  reasonCount: number
  createdAt: string
  updatedAt?: string
}

interface ReasonTypeItem {
  id: string
  name: string
  description: string | null
  sectionId: string
  sectionName: string
  templateId: string
  templateName: string
}

export default function ReasonTypes() {
  const { session: authSession, user } = useAuth()
  const { session: superAdminSession, isSuperAdmin: isSuperAdminContext } = useSuperAdminSafe()

  // Use super admin session if available, otherwise use regular auth session
  const session = superAdminSession || authSession
  const isSuperAdmin = isSuperAdminContext || user?.role === 'super_admin'

  const [reasonTypes, setReasonTypes] = useState<ReasonType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false)
  const [showItemsModal, setShowItemsModal] = useState<string | null>(null)
  const [editingType, setEditingType] = useState<ReasonType | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Items modal state
  const [typeItems, setTypeItems] = useState<ReasonTypeItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)

  // Fetch reason types on mount
  useEffect(() => {
    if (session?.accessToken) {
      fetchReasonTypes()
    }
  }, [session?.accessToken, isSuperAdmin])

  const fetchReasonTypes = async () => {
    try {
      setLoading(true)
      // Use admin endpoint for super admins to see global counts
      const endpoint = isSuperAdmin ? '/api/v1/admin/reason-types' : '/api/v1/reason-types'
      const data = await api<{ reasonTypes: ReasonType[] }>(endpoint, {
        token: session?.accessToken
      })
      setReasonTypes(data.reasonTypes || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reason types')
    } finally {
      setLoading(false)
    }
  }

  const fetchTypeItems = async (typeId: string) => {
    try {
      setLoadingItems(true)
      const data = await api<{ items: ReasonTypeItem[]; count: number }>(
        `/api/v1/reason-types/${typeId}/items`,
        { token: session?.accessToken }
      )
      setTypeItems(data.items || [])
    } catch (err) {
      console.error('Failed to fetch type items:', err)
      setTypeItems([])
    } finally {
      setLoadingItems(false)
    }
  }

  const handleAddType = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) {
      setFormError('Name is required')
      return
    }

    setFormSubmitting(true)
    setFormError(null)

    try {
      const newType = await api<ReasonType>('/api/v1/reason-types', {
        method: 'POST',
        body: {
          name: formName.trim(),
          description: formDescription.trim() || null
        },
        token: session?.accessToken
      })

      setReasonTypes([...reasonTypes, newType])
      setShowAddModal(false)
      setFormName('')
      setFormDescription('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create reason type')
    } finally {
      setFormSubmitting(false)
    }
  }

  const handleUpdateType = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingType || !formName.trim()) {
      setFormError('Name is required')
      return
    }

    setFormSubmitting(true)
    setFormError(null)

    try {
      const updated = await api<ReasonType>(`/api/v1/reason-types/${editingType.id}`, {
        method: 'PATCH',
        body: {
          name: formName.trim(),
          description: formDescription.trim() || null
        },
        token: session?.accessToken
      })

      setReasonTypes(reasonTypes.map(rt => rt.id === editingType.id ? { ...rt, ...updated } : rt))
      setEditingType(null)
      setFormName('')
      setFormDescription('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update reason type')
    } finally {
      setFormSubmitting(false)
    }
  }

  const handleDeleteType = async (typeId: string) => {
    try {
      // Use admin API endpoint for super admins (especially for system types)
      const endpoint = isSuperAdmin
        ? `/api/v1/admin/reason-types/${typeId}`
        : `/api/v1/reason-types/${typeId}`

      await api(endpoint, {
        method: 'DELETE',
        token: session?.accessToken
      })

      setReasonTypes(reasonTypes.filter(rt => rt.id !== typeId))
      setDeleteConfirm(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete reason type')
    }
  }

  const openEditModal = (type: ReasonType) => {
    setEditingType(type)
    setFormName(type.name)
    setFormDescription(type.description || '')
    setFormError(null)
  }

  const openItemsModal = (typeId: string) => {
    setShowItemsModal(typeId)
    fetchTypeItems(typeId)
  }

  const closeModal = () => {
    setShowAddModal(false)
    setEditingType(null)
    setShowItemsModal(null)
    setDeleteConfirm(null)
    setFormName('')
    setFormDescription('')
    setFormError(null)
    setTypeItems([])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reason Types</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage shared reason types for grouping similar inspection items
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Type
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      {/* Types Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Items Using
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Reasons
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {reasonTypes.map((type) => (
              <tr key={type.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{type.name}</div>
                      {type.description && (
                        <div className="text-sm text-gray-500 truncate max-w-xs">{type.description}</div>
                      )}
                      <div className="text-xs text-gray-400 font-mono">{type.id}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => openItemsModal(type.id)}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {type.itemCount} item{type.itemCount !== 1 ? 's' : ''}
                  </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <span className="text-sm text-gray-900">{type.reasonCount}</span>
                    {type.reasonCount === 0 && (
                      <Link
                        to={`/settings/reasons/type/${type.id}`}
                        className="ml-2 text-xs text-amber-600 hover:text-amber-700"
                      >
                        Generate
                      </Link>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {type.isSystem ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      System
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      Custom
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      to={`/settings/reasons/type/${type.id}`}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                      </svg>
                      <span>Reasons</span>
                    </Link>
                    <button
                      onClick={() => openEditModal(type)}
                      className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-800"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      <span>Edit</span>
                    </button>
                    {/* Delete button: show for custom types, or for system types if super admin */}
                    {((!type.isSystem) || (type.isSystem && isSuperAdmin)) && type.itemCount === 0 && type.reasonCount === 0 ? (
                      <button
                        onClick={() => setDeleteConfirm(type.id)}
                        className="inline-flex items-center gap-1 text-red-600 hover:text-red-800"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Delete</span>
                      </button>
                    ) : (type.itemCount > 0 || type.reasonCount > 0) && ((!type.isSystem) || isSuperAdmin) ? (
                      <span className="text-gray-400 text-xs" title="Remove all items and reasons first">
                        In use
                      </span>
                    ) : type.isSystem && !isSuperAdmin ? (
                      <span className="text-gray-400 text-xs" title="System types can only be deleted by super admins">
                        System
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {reasonTypes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  No reason types found. Click "Add Type" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingType) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {editingType ? 'Edit Reason Type' : 'Add New Reason Type'}
              </h3>
            </div>
            <form onSubmit={editingType ? handleUpdateType : handleAddType}>
              <div className="px-6 py-4 space-y-4">
                {formError && (
                  <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">
                    {formError}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., Wheel Bearing"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                    disabled={editingType?.isSystem}
                  />
                  {!editingType && formName && (
                    <p className="text-xs text-gray-500 mt-1">
                      ID will be: <code className="bg-gray-100 px-1 rounded">
                        {formName.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 50)}
                      </code>
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Brief description of what items this type covers..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting || (editingType?.isSystem && !formDescription)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {formSubmitting ? 'Saving...' : editingType ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Items Modal */}
      {showItemsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">
                Items Using "{reasonTypes.find(rt => rt.id === showItemsModal)?.name}"
              </h3>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {loadingItems ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : typeItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No items are currently using this reason type.
                </div>
              ) : (
                <div className="space-y-3">
                  {typeItems.map((item) => (
                    <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="font-medium text-gray-900">{item.name}</div>
                      {item.description && (
                        <div className="text-sm text-gray-500 mt-1">{item.description}</div>
                      )}
                      <div className="text-xs text-gray-400 mt-2">
                        {item.templateName} &gt; {item.sectionName}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (() => {
        const typeToDelete = reasonTypes.find(rt => rt.id === deleteConfirm)
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
              <div className="px-6 py-4">
                <h3 className="text-lg font-medium text-gray-900 mb-2">Delete Reason Type?</h3>
                <p className="text-sm text-gray-500">
                  Are you sure you want to delete "{typeToDelete?.name}"?
                  This action cannot be undone.
                </p>
                {typeToDelete?.isSystem && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-800 font-medium">Warning: System Type</p>
                    <p className="text-sm text-amber-700 mt-1">
                      This is a built-in system type. Deleting it will remove it for all organizations.
                    </p>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteType(deleteConfirm)}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
