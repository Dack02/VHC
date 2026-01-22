import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface Supplier {
  id: string
  name: string
  code: string | null
  accountNumber: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  isQuickAdd: boolean
  sortOrder: number
  supplierTypeId: string | null
  supplierTypeName: string | null
}

interface SupplierType {
  id: string
  name: string
  description: string | null
  isActive: boolean
  isSystem: boolean
  sortOrder: number
}

interface SupplierFormData {
  name: string
  code: string
  accountNumber: string
  contactName: string
  contactEmail: string
  contactPhone: string
  address: string
  notes: string
  supplierTypeId: string
}

const initialFormData: SupplierFormData = {
  name: '',
  code: '',
  accountNumber: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  address: '',
  notes: '',
  supplierTypeId: '',
}

export default function Suppliers() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierTypes, setSupplierTypes] = useState<SupplierType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [formData, setFormData] = useState<SupplierFormData>(initialFormData)
  const [formError, setFormError] = useState('')

  const organizationId = user?.organization?.id

  useEffect(() => {
    if (organizationId) {
      fetchSuppliers()
      fetchSupplierTypes()
    }
  }, [organizationId])

  const fetchSupplierTypes = async () => {
    if (!organizationId) return

    try {
      const data = await api<{ supplierTypes: SupplierType[] }>(
        `/api/v1/organizations/${organizationId}/supplier-types`,
        { token: session?.accessToken }
      )
      setSupplierTypes(data.supplierTypes || [])
    } catch (err) {
      // Silently fail - types are optional
      console.error('Failed to load supplier types:', err)
    }
  }

  const fetchSuppliers = async () => {
    if (!organizationId) return

    try {
      setLoading(true)
      const data = await api<{ suppliers: Supplier[] }>(
        `/api/v1/organizations/${organizationId}/suppliers`,
        { token: session?.accessToken }
      )
      setSuppliers(data.suppliers || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load suppliers')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (supplier?: Supplier) => {
    if (supplier) {
      setEditingSupplier(supplier)
      setFormData({
        name: supplier.name,
        code: supplier.code || '',
        accountNumber: supplier.accountNumber || '',
        contactName: supplier.contactName || '',
        contactEmail: supplier.contactEmail || '',
        contactPhone: supplier.contactPhone || '',
        address: supplier.address || '',
        notes: supplier.notes || '',
        supplierTypeId: supplier.supplierTypeId || '',
      })
    } else {
      setEditingSupplier(null)
      setFormData(initialFormData)
    }
    setFormError('')
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingSupplier(null)
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
        code: formData.code.trim() || null,
        account_number: formData.accountNumber.trim() || null,
        contact_name: formData.contactName.trim() || null,
        contact_email: formData.contactEmail.trim() || null,
        contact_phone: formData.contactPhone.trim() || null,
        address: formData.address.trim() || null,
        notes: formData.notes.trim() || null,
        supplier_type_id: formData.supplierTypeId || null,
        is_quick_add: false, // Full add from settings page
      }

      if (editingSupplier) {
        // Update existing
        await api(
          `/api/v1/organizations/${organizationId}/suppliers/${editingSupplier.id}`,
          {
            method: 'PATCH',
            body: payload,
            token: session?.accessToken
          }
        )
        toast.success('Supplier updated')
      } else {
        // Create new
        await api(
          `/api/v1/organizations/${organizationId}/suppliers`,
          {
            method: 'POST',
            body: payload,
            token: session?.accessToken
          }
        )
        toast.success('Supplier created')
      }

      handleCloseModal()
      await fetchSuppliers()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save supplier')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (supplier: Supplier) => {
    if (!organizationId) return
    if (!confirm(`Are you sure you want to delete the supplier "${supplier.name}"?`)) return

    try {
      await api(
        `/api/v1/organizations/${organizationId}/suppliers/${supplier.id}`,
        {
          method: 'DELETE',
          token: session?.accessToken
        }
      )
      toast.success('Supplier deleted')
      await fetchSuppliers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete supplier')
    }
  }

  // Count quick-add suppliers that need full details
  const quickAddSuppliers = suppliers.filter(s => s.isQuickAdd)

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
          <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage parts suppliers for repair quotes
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

      {/* Quick-add warning */}
      {quickAddSuppliers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 px-4 py-3 mb-6 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm text-amber-800 font-medium">
              {quickAddSuppliers.length} supplier{quickAddSuppliers.length > 1 ? 's were' : ' was'} quick-added
            </p>
            <p className="text-sm text-amber-700">
              Consider adding full contact details for: {quickAddSuppliers.map(s => s.name).join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* Suppliers Table */}
      <div className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Code
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Account No.
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Contact
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  No suppliers found. Click "Add New" to create one.
                </td>
              </tr>
            ) : (
              suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{supplier.name}</span>
                      {supplier.isQuickAdd && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                          </svg>
                          Quick Add
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                    {supplier.supplierTypeName || <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                    {supplier.code || <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                    {supplier.accountNumber || <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                    {supplier.contactPhone || supplier.contactEmail || supplier.contactName || (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleOpenModal(supplier)}
                      className="text-primary hover:text-primary-dark mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(supplier)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal} />

            <div className="relative bg-white w-full max-w-lg p-6 text-left shadow-xl transform transition-all max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingSupplier ? 'Edit Supplier' : 'Add Supplier'}
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Supplier Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="GSF Car Parts"
                      maxLength={255}
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Type
                    </label>
                    <select
                      value={formData.supplierTypeId}
                      onChange={(e) => setFormData({ ...formData, supplierTypeId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select type...</option>
                      {supplierTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Code
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      placeholder="GSF"
                      maxLength={50}
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary font-mono uppercase"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Account Number
                    </label>
                    <input
                      type="text"
                      value={formData.accountNumber}
                      onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                      placeholder="ACC-12345"
                      maxLength={100}
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Contact Details</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contact Name
                      </label>
                      <input
                        type="text"
                        value={formData.contactName}
                        onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                        placeholder="John Smith"
                        maxLength={255}
                        className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email
                        </label>
                        <input
                          type="email"
                          value={formData.contactEmail}
                          onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                          placeholder="sales@gsf.co.uk"
                          maxLength={255}
                          className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Phone
                        </label>
                        <input
                          type="tel"
                          value={formData.contactPhone}
                          onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                          placeholder="0800 123 456"
                          maxLength={50}
                          className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Address
                      </label>
                      <textarea
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        placeholder="123 Trade Street&#10;Industrial Estate&#10;City, AB1 2CD"
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Additional notes about this supplier..."
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
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
                    {saving ? 'Saving...' : editingSupplier ? 'Update' : 'Add Supplier'}
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
