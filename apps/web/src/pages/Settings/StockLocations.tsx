import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

// Mirrors the parts-stock API rows (snake_case) — see apps/api/src/routes/parts-stock.ts.
interface StockLocation {
  id: string
  name: string
  code: string | null
  is_default: boolean
  is_active: boolean
  sort_order: number
}

interface LocationFormData {
  name: string
  code: string
}

const initialFormData: LocationFormData = { name: '', code: '' }

export default function StockLocations() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<StockLocation | null>(null)
  const [formData, setFormData] = useState<LocationFormData>(initialFormData)
  const [formError, setFormError] = useState('')

  const organizationId = user?.organization?.id

  useEffect(() => {
    if (organizationId) fetchLocations()
  }, [organizationId])

  const fetchLocations = async () => {
    try {
      setLoading(true)
      const data = await api<{ locations: StockLocation[] }>(
        '/api/v1/parts-stock/stock-locations',
        { token: session?.accessToken }
      )
      setLocations((data.locations || []).filter((loc) => loc.is_active !== false))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load stock locations')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (loc?: StockLocation) => {
    if (loc) {
      setEditing(loc)
      setFormData({ name: loc.name, code: loc.code || '' })
    } else {
      setEditing(null)
      setFormData(initialFormData)
    }
    setFormError('')
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditing(null)
    setFormData(initialFormData)
    setFormError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      setFormError('Name is required')
      return
    }
    try {
      setSaving(true)
      setFormError('')
      const payload = { name: formData.name.trim(), code: formData.code.trim() || null }
      if (editing) {
        await api(`/api/v1/parts-stock/stock-locations/${editing.id}`, {
          method: 'PATCH', body: payload, token: session?.accessToken,
        })
        toast.success('Location updated')
      } else {
        await api('/api/v1/parts-stock/stock-locations', {
          method: 'POST', body: payload, token: session?.accessToken,
        })
        toast.success('Location created')
      }
      handleCloseModal()
      await fetchLocations()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save location')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (loc: StockLocation) => {
    if (loc.is_default) {
      toast.error('The default location cannot be deleted')
      return
    }
    if (!confirm(`Delete "${loc.name}"?`)) return
    try {
      await api(`/api/v1/parts-stock/stock-locations/${loc.id}`, {
        method: 'DELETE', token: session?.accessToken,
      })
      toast.success('Location deleted')
      await fetchLocations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete location')
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
      <SettingsBackLink />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Locations</h1>
          <p className="text-sm text-gray-500 mt-1">
            Where stock physically lives (e.g., Main Store, Van, Mezzanine)
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

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {locations.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  No locations yet. Click "Add New" to create one.
                </td>
              </tr>
            ) : (
              locations.map((loc) => (
                <tr key={loc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="font-medium text-gray-900">{loc.name}</span>
                  </td>
                  <td className="px-6 py-4 text-gray-700">
                    {loc.code || <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    {loc.is_default ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Default</span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">Custom</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={() => handleOpenModal(loc)} className="text-primary hover:text-primary-dark mr-4">Edit</button>
                    {!loc.is_default && (
                      <button onClick={() => handleDelete(loc)} className="text-red-600 hover:text-red-800">Delete</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              <strong>The default location</strong> (Main) is created automatically and can't be deleted — stock always needs somewhere to live. Add more if you hold stock in vans or multiple stores.
            </p>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal} />
            <div className="relative bg-white w-full max-w-md p-6 text-left shadow-xl transform transition-all">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit Location' : 'Add Location'}</h3>
                <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-4 text-sm">{formError}</div>
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
                    placeholder="e.g., Main Store"
                    maxLength={100}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Code <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="Short code, e.g., MAIN"
                    maxLength={24}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={handleCloseModal} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50">
                    {saving ? 'Saving...' : editing ? 'Update' : 'Add Location'}
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
