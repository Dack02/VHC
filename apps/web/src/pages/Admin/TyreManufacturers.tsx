import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface TyreManufacturer {
  id: string
  name: string
  isActive: boolean
  sortOrder: number
}

export default function TyreManufacturers() {
  const { session } = useAuth()
  const [manufacturers, setManufacturers] = useState<TyreManufacturer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<TyreManufacturer | null>(null)

  useEffect(() => {
    fetchManufacturers()
  }, [])

  const fetchManufacturers = async () => {
    try {
      setLoading(true)
      const data = await api<{ manufacturers: TyreManufacturer[] }>('/api/v1/tyre-manufacturers', {
        token: session?.accessToken
      })
      setManufacturers(data.manufacturers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load manufacturers')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this manufacturer?')) return

    try {
      await api(`/api/v1/tyre-manufacturers/${id}`, {
        method: 'DELETE',
        token: session?.accessToken
      })
      fetchManufacturers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete manufacturer')
    }
  }

  const handleToggleActive = async (manufacturer: TyreManufacturer) => {
    try {
      await api(`/api/v1/tyre-manufacturers/${manufacturer.id}`, {
        method: 'PATCH',
        body: { isActive: !manufacturer.isActive },
        token: session?.accessToken
      })
      fetchManufacturers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update manufacturer')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tyre Manufacturers</h1>
          <p className="text-sm text-gray-500 mt-1">Manage tyre manufacturer options for inspections</p>
        </div>
        <button
          onClick={() => {
            setEditingItem(null)
            setShowModal(true)
          }}
          className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark"
        >
          Add Manufacturer
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-6">
          {error}
          <button onClick={() => setError('')} className="float-right text-red-700">&times;</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 shadow-sm">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Name</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Status</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : manufacturers.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                  No manufacturers found. Add your first one above.
                </td>
              </tr>
            ) : (
              manufacturers.map((manufacturer) => (
                <tr key={manufacturer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{manufacturer.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(manufacturer)}
                      className={`px-2 py-1 text-xs font-medium rounded ${
                        manufacturer.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {manufacturer.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingItem(manufacturer)
                          setShowModal(true)
                        }}
                        className="text-sm text-primary hover:text-primary-dark"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(manufacturer.id)}
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
        <ManufacturerModal
          manufacturer={editingItem}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false)
            fetchManufacturers()
          }}
        />
      )}
    </div>
  )
}

interface ManufacturerModalProps {
  manufacturer: TyreManufacturer | null
  onClose: () => void
  onSuccess: () => void
}

function ManufacturerModal({ manufacturer, onClose, onSuccess }: ManufacturerModalProps) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState(manufacturer?.name || '')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setError('')
    setLoading(true)

    try {
      if (manufacturer) {
        await api(`/api/v1/tyre-manufacturers/${manufacturer.id}`, {
          method: 'PATCH',
          body: { name: name.trim() },
          token: session?.accessToken
        })
      } else {
        await api('/api/v1/tyre-manufacturers', {
          method: 'POST',
          body: { name: name.trim() },
          token: session?.accessToken
        })
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save manufacturer')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {manufacturer ? 'Edit Manufacturer' : 'Add Manufacturer'}
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
              Manufacturer Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., Michelin, Pirelli, Continental"
              required
              autoFocus
            />
          </div>

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
              disabled={loading || !name.trim()}
              className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? 'Saving...' : manufacturer ? 'Update' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
