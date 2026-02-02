import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, type PartsCatalogEntry } from '../../lib/api'

interface PartFormData {
  partNumber: string
  description: string
  costPrice: string
}

const initialFormData: PartFormData = {
  partNumber: '',
  description: '',
  costPrice: '',
}

export default function PartsCatalog() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [parts, setParts] = useState<PartsCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingPart, setEditingPart] = useState<PartsCatalogEntry | null>(null)
  const [formData, setFormData] = useState<PartFormData>(initialFormData)
  const [formError, setFormError] = useState('')

  const organizationId = user?.organization?.id
  const limit = 25

  const fetchParts = useCallback(async () => {
    if (!organizationId) return

    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        include_inactive: String(showInactive),
      })
      if (search) params.set('q', search)

      const data = await api<{ parts: PartsCatalogEntry[]; total: number; page: number; limit: number }>(
        `/api/v1/organizations/${organizationId}/parts-catalog?${params}`,
        { token: session?.accessToken }
      )
      setParts(data.parts || [])
      setTotal(data.total || 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load parts')
    } finally {
      setLoading(false)
    }
  }, [organizationId, page, search, showInactive, session?.accessToken])

  useEffect(() => {
    fetchParts()
  }, [fetchParts])

  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setPage(1)
  }, [search, showInactive])

  const handleOpenModal = (part?: PartsCatalogEntry) => {
    if (part) {
      setEditingPart(part)
      setFormData({
        partNumber: part.partNumber,
        description: part.description,
        costPrice: String(part.costPrice),
      })
    } else {
      setEditingPart(null)
      setFormData(initialFormData)
    }
    setFormError('')
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingPart(null)
    setFormData(initialFormData)
    setFormError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!organizationId) return

    if (!formData.partNumber.trim()) {
      setFormError('Part number is required')
      return
    }
    if (!formData.description.trim()) {
      setFormError('Description is required')
      return
    }
    if (!formData.costPrice || isNaN(parseFloat(formData.costPrice))) {
      setFormError('Valid cost price is required')
      return
    }

    try {
      setSaving(true)
      setFormError('')

      if (editingPart) {
        await api(
          `/api/v1/organizations/${organizationId}/parts-catalog/${editingPart.id}`,
          {
            method: 'PATCH',
            body: {
              description: formData.description.trim(),
              cost_price: parseFloat(formData.costPrice),
            },
            token: session?.accessToken,
          }
        )
        toast.success('Part updated')
      } else {
        await api(
          `/api/v1/organizations/${organizationId}/parts-catalog`,
          {
            method: 'POST',
            body: {
              part_number: formData.partNumber.trim(),
              description: formData.description.trim(),
              cost_price: parseFloat(formData.costPrice),
            },
            token: session?.accessToken,
          }
        )
        toast.success('Part added')
      }

      handleCloseModal()
      await fetchParts()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save part')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (part: PartsCatalogEntry) => {
    if (!organizationId) return

    try {
      await api(
        `/api/v1/organizations/${organizationId}/parts-catalog/${part.id}/toggle-active`,
        {
          method: 'PATCH',
          token: session?.accessToken,
        }
      )
      toast.success(part.isActive ? 'Part deactivated' : 'Part activated')
      await fetchParts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle part status')
    }
  }

  const totalPages = Math.ceil(total / limit)
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1
  const endItem = Math.min(page * limit, total)

  if (loading && parts.length === 0) {
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
          <h1 className="text-2xl font-bold text-gray-900">Parts Catalog</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your organisation's parts inventory and pricing
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-primary text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-dark flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Part
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by part number or description..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-gray-300 text-primary focus:ring-primary"
          />
          Show inactive
        </label>
      </div>

      {/* Parts Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Part Number
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cost Price
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
            {parts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  {search ? 'No parts match your search.' : 'No parts found. Click "Add Part" to create one.'}
                </td>
              </tr>
            ) : (
              parts.map((part) => (
                <tr key={part.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="font-mono font-medium text-gray-900">{part.partNumber}</span>
                  </td>
                  <td className="px-6 py-4 text-gray-700">
                    {part.description}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                    {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(part.costPrice)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {part.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleOpenModal(part)}
                      className="text-primary hover:text-primary-dark mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(part)}
                      className={part.isActive ? 'text-gray-500 hover:text-gray-700' : 'text-green-600 hover:text-green-800'}
                    >
                      {part.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-600">
            Showing {startItem}–{endItem} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal} />

            <div className="relative bg-white rounded-xl w-full max-w-md p-6 text-left shadow-xl transform transition-all">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingPart ? 'Edit Part' : 'Add Part'}
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
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Part Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.partNumber}
                    onChange={(e) => setFormData({ ...formData, partNumber: e.target.value.toUpperCase() })}
                    placeholder="e.g. BRK-PAD-001"
                    maxLength={100}
                    disabled={!!editingPart}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono disabled:bg-gray-100 disabled:text-gray-500"
                  />
                  {editingPart && (
                    <p className="text-xs text-gray-400 mt-1">Part number cannot be changed</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g. Front brake pad set"
                    maxLength={500}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cost Price <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">£</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.costPrice}
                      onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                      placeholder="0.00"
                      className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-primary text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-dark disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingPart ? 'Update' : 'Add Part'}
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
