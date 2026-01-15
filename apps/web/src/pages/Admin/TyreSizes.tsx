import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface TyreSize {
  id: string
  size: string
  width: number | null
  profile: number | null
  rimSize: number | null
  isActive: boolean
  sortOrder: number
}

export default function TyreSizes() {
  const { session } = useAuth()
  const [sizes, setSizes] = useState<TyreSize[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<TyreSize | null>(null)
  const [filterRimSize, setFilterRimSize] = useState('')

  useEffect(() => {
    fetchSizes()
  }, [filterRimSize])

  const fetchSizes = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filterRimSize) params.set('rim_size', filterRimSize)

      const data = await api<{ sizes: TyreSize[] }>(`/api/v1/tyre-sizes?${params}`, {
        token: session?.accessToken
      })
      setSizes(data.sizes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tyre sizes')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this tyre size?')) return

    try {
      await api(`/api/v1/tyre-sizes/${id}`, {
        method: 'DELETE',
        token: session?.accessToken
      })
      fetchSizes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tyre size')
    }
  }

  const handleToggleActive = async (size: TyreSize) => {
    try {
      await api(`/api/v1/tyre-sizes/${size.id}`, {
        method: 'PATCH',
        body: { isActive: !size.isActive },
        token: session?.accessToken
      })
      fetchSizes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tyre size')
    }
  }

  // Get unique rim sizes for filter
  const rimSizes = [...new Set(sizes.map(s => s.rimSize).filter(Boolean))].sort((a, b) => (a || 0) - (b || 0))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tyre Sizes</h1>
          <p className="text-sm text-gray-500 mt-1">Manage tyre size options for inspections</p>
        </div>
        <button
          onClick={() => {
            setEditingItem(null)
            setShowModal(true)
          }}
          className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark"
        >
          Add Tyre Size
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-6">
          {error}
          <button onClick={() => setError('')} className="float-right text-red-700">&times;</button>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4">
        <label className="text-sm font-medium text-gray-700 mr-2">Filter by Rim Size:</label>
        <select
          value={filterRimSize}
          onChange={(e) => setFilterRimSize(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 text-sm"
        >
          <option value="">All Sizes</option>
          {rimSizes.map((rim) => (
            <option key={rim} value={rim || ''}>
              {rim}"
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 shadow-sm">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Size</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Width</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Profile</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Rim</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Status</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : sizes.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No tyre sizes found. Add your first one above.
                </td>
              </tr>
            ) : (
              sizes.map((size) => (
                <tr key={size.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{size.size}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {size.width ? `${size.width}mm` : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {size.profile ? `${size.profile}%` : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {size.rimSize ? `${size.rimSize}"` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(size)}
                      className={`px-2 py-1 text-xs font-medium rounded ${
                        size.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {size.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingItem(size)
                          setShowModal(true)
                        }}
                        className="text-sm text-primary hover:text-primary-dark"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(size.id)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <TyreSizeModal
          tyreSize={editingItem}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false)
            fetchSizes()
          }}
        />
      )}
    </div>
  )
}

interface TyreSizeModalProps {
  tyreSize: TyreSize | null
  onClose: () => void
  onSuccess: () => void
}

function TyreSizeModal({ tyreSize, onClose, onSuccess }: TyreSizeModalProps) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    size: tyreSize?.size || '',
    width: tyreSize?.width?.toString() || '',
    profile: tyreSize?.profile?.toString() || '',
    rimSize: tyreSize?.rimSize?.toString() || ''
  })

  // Auto-generate size string from components
  const generateSizeString = () => {
    if (formData.width && formData.profile && formData.rimSize) {
      return `${formData.width}/${formData.profile}R${formData.rimSize}`
    }
    return formData.size
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const sizeString = formData.size || generateSizeString()
    if (!sizeString.trim()) {
      setError('Please enter a size or fill in width, profile, and rim size')
      return
    }

    setError('')
    setLoading(true)

    const body = {
      size: sizeString.trim(),
      width: formData.width ? parseInt(formData.width) : null,
      profile: formData.profile ? parseInt(formData.profile) : null,
      rimSize: formData.rimSize ? parseInt(formData.rimSize) : null
    }

    try {
      if (tyreSize) {
        await api(`/api/v1/tyre-sizes/${tyreSize.id}`, {
          method: 'PATCH',
          body,
          token: session?.accessToken
        })
      } else {
        await api('/api/v1/tyre-sizes', {
          method: 'POST',
          body,
          token: session?.accessToken
        })
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tyre size')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {tyreSize ? 'Edit Tyre Size' : 'Add Tyre Size'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Size String
            </label>
            <input
              type="text"
              value={formData.size}
              onChange={(e) => setFormData({ ...formData, size: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., 205/55R16"
            />
            <p className="text-xs text-gray-500 mt-1">
              Or fill in the components below to auto-generate
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Width (mm)
              </label>
              <input
                type="number"
                value={formData.width}
                onChange={(e) => setFormData({ ...formData, width: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="205"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Profile (%)
              </label>
              <input
                type="number"
                value={formData.profile}
                onChange={(e) => setFormData({ ...formData, profile: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="55"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rim (")
              </label>
              <input
                type="number"
                value={formData.rimSize}
                onChange={(e) => setFormData({ ...formData, rimSize: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="16"
              />
            </div>
          </div>

          {formData.width && formData.profile && formData.rimSize && !formData.size && (
            <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
              Generated size: <strong>{generateSizeString()}</strong>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? 'Saving...' : tyreSize ? 'Update' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
