import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface VehicleLocation {
  id: string
  name: string
  shortName: string
  sortOrder: number
  isActive: boolean
}

export default function VehicleLocations() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [locations, setLocations] = useState<VehicleLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editShortName, setEditShortName] = useState('')
  const [showAddRow, setShowAddRow] = useState(false)
  const [newName, setNewName] = useState('')
  const [newShortName, setNewShortName] = useState('')

  const organizationId = user?.organization?.id

  useEffect(() => {
    if (organizationId) {
      fetchLocations()
    }
  }, [organizationId])

  const fetchLocations = async () => {
    if (!organizationId) return

    try {
      setLoading(true)
      const data = await api<{ locations: VehicleLocation[] }>(
        `/api/v1/organizations/${organizationId}/vehicle-locations?include_inactive=true`,
        { token: session?.accessToken }
      )
      setLocations(data.locations || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load vehicle locations')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async () => {
    if (!organizationId || !newName.trim() || !newShortName.trim()) return

    try {
      setSaving(true)
      await api(
        `/api/v1/organizations/${organizationId}/vehicle-locations`,
        {
          method: 'POST',
          body: { name: newName.trim(), short_name: newShortName.trim() },
          token: session?.accessToken
        }
      )
      toast.success('Location added')
      setNewName('')
      setNewShortName('')
      setShowAddRow(false)
      await fetchLocations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add location')
    } finally {
      setSaving(false)
    }
  }

  const handleStartEdit = (loc: VehicleLocation) => {
    setEditingId(loc.id)
    setEditName(loc.name)
    setEditShortName(loc.shortName)
  }

  const handleSaveEdit = async () => {
    if (!organizationId || !editingId || !editName.trim() || !editShortName.trim()) return

    try {
      setSaving(true)
      await api(
        `/api/v1/organizations/${organizationId}/vehicle-locations/${editingId}`,
        {
          method: 'PATCH',
          body: { name: editName.trim(), short_name: editShortName.trim() },
          token: session?.accessToken
        }
      )
      toast.success('Location updated')
      setEditingId(null)
      await fetchLocations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update location')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (loc: VehicleLocation) => {
    if (!organizationId) return
    if (!confirm(`Are you sure you want to remove "${loc.name}"?`)) return

    try {
      await api(
        `/api/v1/organizations/${organizationId}/vehicle-locations/${loc.id}`,
        {
          method: 'DELETE',
          token: session?.accessToken
        }
      )
      toast.success('Location removed')
      await fetchLocations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove location')
    }
  }

  const handleMoveUp = async (index: number) => {
    if (index === 0 || !organizationId) return
    const newOrder = [...locations]
    const [moved] = newOrder.splice(index, 1)
    newOrder.splice(index - 1, 0, moved)
    setLocations(newOrder)

    try {
      await api(
        `/api/v1/organizations/${organizationId}/vehicle-locations/reorder`,
        {
          method: 'POST',
          body: { locationIds: newOrder.map(l => l.id) },
          token: session?.accessToken
        }
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reorder')
      await fetchLocations()
    }
  }

  const handleMoveDown = async (index: number) => {
    if (index === locations.length - 1 || !organizationId) return
    const newOrder = [...locations]
    const [moved] = newOrder.splice(index, 1)
    newOrder.splice(index + 1, 0, moved)
    setLocations(newOrder)

    try {
      await api(
        `/api/v1/organizations/${organizationId}/vehicle-locations/reorder`,
        {
          method: 'POST',
          body: { locationIds: newOrder.map(l => l.id) },
          token: session?.accessToken
        }
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reorder')
      await fetchLocations()
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
          <h1 className="text-2xl font-bold text-gray-900">Vehicle Locations</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage location labels used for inspection items (e.g., Front Left, Rear Right)
          </p>
        </div>
        {!showAddRow && (
          <button
            onClick={() => setShowAddRow(true)}
            className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Location
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                Short Name
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {locations.length === 0 && !showAddRow ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  No vehicle locations found. Click "Add Location" to create one.
                </td>
              </tr>
            ) : (
              locations.map((loc, index) => (
                <tr key={loc.id} className={`hover:bg-gray-50 ${!loc.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMoveDown(index)}
                        disabled={index === locations.length - 1}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    {editingId === loc.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium text-gray-900">{loc.name}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    {editingId === loc.id ? (
                      <input
                        type="text"
                        value={editShortName}
                        onChange={(e) => setEditShortName(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        maxLength={10}
                      />
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 text-xs font-mono font-medium">
                        {loc.shortName}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-center">
                    {loc.isActive ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-sm font-medium">
                    {editingId === loc.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={saving || !editName.trim() || !editShortName.trim()}
                          className="text-xs px-3 py-1 bg-primary text-white font-medium disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs px-2 py-1 text-gray-600 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStartEdit(loc)}
                          className="text-primary hover:text-primary-dark mr-4"
                        >
                          Edit
                        </button>
                        {loc.isActive && (
                          <button
                            onClick={() => handleDelete(loc)}
                            className="text-red-600 hover:text-red-800"
                          >
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}

            {/* Add new row */}
            {showAddRow && (
              <tr className="bg-blue-50/40">
                <td className="px-4 py-3"></td>
                <td className="px-6 py-3">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., Front Left"
                    className="w-full px-2 py-1 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd()
                      if (e.key === 'Escape') setShowAddRow(false)
                    }}
                  />
                </td>
                <td className="px-6 py-3">
                  <input
                    type="text"
                    value={newShortName}
                    onChange={(e) => setNewShortName(e.target.value)}
                    placeholder="e.g., FL"
                    maxLength={10}
                    className="w-full px-2 py-1 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd()
                      if (e.key === 'Escape') setShowAddRow(false)
                    }}
                  />
                </td>
                <td></td>
                <td className="px-6 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={handleAdd}
                      disabled={saving || !newName.trim() || !newShortName.trim()}
                      className="text-xs px-3 py-1 bg-primary text-white font-medium disabled:opacity-50"
                    >
                      {saving ? 'Adding...' : 'Add'}
                    </button>
                    <button
                      onClick={() => { setShowAddRow(false); setNewName(''); setNewShortName('') }}
                      className="text-xs px-2 py-1 text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 bg-blue-50 border border-blue-200 p-4">
        <div className="flex">
          <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              Vehicle locations are used when a template item has "Requires Location" enabled. During inspection, the technician selects which locations to check and a separate result is created for each.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
