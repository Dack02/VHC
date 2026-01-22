import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface SupplierType {
  id: string
  name: string
  description: string | null
  isActive: boolean
  isSystem: boolean
  sortOrder: number
}

interface TypeFormData {
  name: string
  description: string
}

const initialFormData: TypeFormData = {
  name: '',
  description: '',
}

export default function SupplierTypes() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [supplierTypes, setSupplierTypes] = useState<SupplierType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingType, setEditingType] = useState<SupplierType | null>(null)
  const [formData, setFormData] = useState<TypeFormData>(initialFormData)
  const [formError, setFormError] = useState('')

  const organizationId = user?.organization?.id

  useEffect(() => {
    if (organizationId) {
      fetchSupplierTypes()
    }
  }, [organizationId])

  const fetchSupplierTypes = async () => {
    if (!organizationId) return

    try {
      setLoading(true)
      const data = await api<{ supplierTypes: SupplierType[] }>(
        `/api/v1/organizations/${organizationId}/supplier-types`,
        { token: session?.accessToken }
      )
      setSupplierTypes(data.supplierTypes || [])

      // If no types exist, seed defaults
      if (!data.supplierTypes || data.supplierTypes.length === 0) {
        await seedDefaultTypes()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load supplier types')
    } finally {
      setLoading(false)
    }
  }

  const seedDefaultTypes = async () => {
    if (!organizationId) return

    try {
      await api(
        `/api/v1/organizations/${organizationId}/supplier-types/seed-defaults`,
        {
          method: 'POST',
          token: session?.accessToken
        }
      )
      toast.success('Default supplier types created')
      await fetchSupplierTypes()
    } catch (err) {
      // Silently fail if seeding fails - types may already exist
      console.error('Failed to seed default supplier types:', err)
    }
  }

  const handleOpenModal = (type?: SupplierType) => {
    if (type) {
      setEditingType(type)
      setFormData({
        name: type.name,
        description: type.description || '',
      })
    } else {
      setEditingType(null)
      setFormData(initialFormData)
    }
    setFormError('')
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingType(null)
    setFormData(initialFormData)
    setFormError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!organizationId) return

    // Validation
    if (!formData.name.trim()) {
      setFormError('Name is required')
      return
    }

    try {
      setSaving(true)
      setFormError('')

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
      }

      if (editingType) {
        // Update existing
        await api(
          `/api/v1/organizations/${organizationId}/supplier-types/${editingType.id}`,
          {
            method: 'PATCH',
            body: payload,
            token: session?.accessToken
          }
        )
        toast.success('Supplier type updated')
      } else {
        // Create new
        await api(
          `/api/v1/organizations/${organizationId}/supplier-types`,
          {
            method: 'POST',
            body: payload,
            token: session?.accessToken
          }
        )
        toast.success('Supplier type created')
      }

      handleCloseModal()
      await fetchSupplierTypes()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save supplier type')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (type: SupplierType) => {
    if (!organizationId) return
    if (type.isSystem) {
      toast.error('System types cannot be deleted')
      return
    }
    if (!confirm(`Are you sure you want to delete "${type.name}"?`)) return

    try {
      await api(
        `/api/v1/organizations/${organizationId}/supplier-types/${type.id}`,
        {
          method: 'DELETE',
          token: session?.accessToken
        }
      )
      toast.success('Supplier type deleted')
      await fetchSupplierTypes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete supplier type')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Supplier Types</h1>
          <p className="text-sm text-gray-500 mt-1">
            Categorize suppliers (e.g., Dealer, Factor, Tyres)
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add New
        </button>
      </div>

      {/* Supplier Types Table */}
      <div className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Description
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {supplierTypes.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  No supplier types found. Click "Add New" to create one.
                </td>
              </tr>
            ) : (
              supplierTypes.map((type) => (
                <tr key={type.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="font-medium text-gray-900">{type.name}</span>
                  </td>
                  <td className="px-6 py-4 text-gray-700">
                    {type.description || <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    {type.isSystem ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        System
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        Custom
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleOpenModal(type)}
                      className="text-primary hover:text-primary-dark mr-4"
                    >
                      Edit
                    </button>
                    {!type.isSystem && (
                      <button
                        onClick={() => handleDelete(type)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Info box */}
      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              <strong>System types</strong> (like "Other") cannot be deleted. Supplier types help categorize your suppliers for better organization and reporting.
            </p>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal} />

            <div className="relative bg-white w-full max-w-md p-6 text-left shadow-xl transform transition-all">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingType ? 'Edit Supplier Type' : 'Add Supplier Type'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-4 text-sm">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Dealer"
                    maxLength={100}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description <span className="text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Optional description for internal reference"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingType ? 'Update' : 'Add Type'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
