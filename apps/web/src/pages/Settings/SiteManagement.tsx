import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Site {
  id: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  isActive: boolean
  usersCount: number
  healthChecksCount: number
  createdAt: string
  updatedAt: string | null
}

export default function SiteManagement() {
  const { session } = useAuth()
  const toast = useToast()
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [showAddRow, setShowAddRow] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)

  useEffect(() => {
    fetchSites()
  }, [])

  const fetchSites = async () => {
    try {
      setLoading(true)
      const data = await api<{ sites: Site[] }>(
        '/api/v1/sites?include_inactive=true',
        { token: session?.accessToken }
      )
      setSites(data.sites || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load sites')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async () => {
    if (!newName.trim()) return

    try {
      setSaving(true)
      await api(
        '/api/v1/sites',
        {
          method: 'POST',
          body: {
            name: newName.trim(),
            address: newAddress.trim() || null,
            phone: newPhone.trim() || null,
            email: newEmail.trim() || null
          },
          token: session?.accessToken
        }
      )
      toast.success('Site added')
      setNewName('')
      setNewAddress('')
      setNewPhone('')
      setNewEmail('')
      setShowAddRow(false)
      await fetchSites()
    } catch (err) {
      if (err instanceof ApiError && err.isForbidden) {
        toast.error('Site limit reached for your current plan. Upgrade to add more sites.')
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to add site')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleStartEdit = (site: Site) => {
    setEditingId(site.id)
    setEditName(site.name)
    setEditAddress(site.address || '')
    setEditPhone(site.phone || '')
    setEditEmail(site.email || '')
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return

    try {
      setSaving(true)
      await api(
        `/api/v1/sites/${editingId}`,
        {
          method: 'PATCH',
          body: {
            name: editName.trim(),
            address: editAddress.trim() || null,
            phone: editPhone.trim() || null,
            email: editEmail.trim() || null
          },
          token: session?.accessToken
        }
      )
      toast.success('Site updated')
      setEditingId(null)
      await fetchSites()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update site')
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (site: Site) => {
    setDeactivatingId(site.id)
    try {
      await api(
        `/api/v1/sites/${site.id}`,
        {
          method: 'DELETE',
          token: session?.accessToken
        }
      )
      toast.success('Site deactivated')
      await fetchSites()
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        const { usersCount, healthChecksCount } = err.details as { usersCount?: number; healthChecksCount?: number }
        const parts = []
        if (usersCount && usersCount > 0) parts.push(`${usersCount} user${usersCount > 1 ? 's' : ''}`)
        if (healthChecksCount && healthChecksCount > 0) parts.push(`${healthChecksCount} health check${healthChecksCount > 1 ? 's' : ''}`)
        toast.error(`Cannot deactivate: site has ${parts.join(' and ')}. Reassign them first.`)
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to deactivate site')
      }
    } finally {
      setDeactivatingId(null)
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
          <h1 className="text-2xl font-bold text-gray-900">Sites</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your branches and locations
          </p>
        </div>
        {!showAddRow && (
          <button
            onClick={() => setShowAddRow(true)}
            className="bg-primary text-white px-4 py-2 rounded-none font-semibold hover:bg-primary-dark flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Site
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 shadow-sm overflow-hidden rounded-none">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Address
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-36">
                Phone
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-44">
                Email
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                Users
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-44">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sites.length === 0 && !showAddRow ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                  No sites found. Click "Add Site" to create one.
                </td>
              </tr>
            ) : (
              sites.map((site) => (
                <tr key={site.id} className={`hover:bg-gray-50 ${!site.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-6 py-3 whitespace-nowrap">
                    {editingId === site.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium text-gray-900">{site.name}</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    {editingId === site.id ? (
                      <input
                        type="text"
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    ) : (
                      <span className="text-gray-600 text-sm">{site.address || '-'}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    {editingId === site.id ? (
                      <input
                        type="text"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    ) : (
                      <span className="text-gray-600 text-sm">{site.phone || '-'}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    {editingId === site.id ? (
                      <input
                        type="text"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    ) : (
                      <span className="text-gray-600 text-sm">{site.email || '-'}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-center">
                    <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-none">
                      {site.usersCount}
                    </span>
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-center">
                    {site.isActive ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-none">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-none">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-sm font-medium">
                    {editingId === site.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={saving || !editName.trim()}
                          className="text-xs px-3 py-1 bg-primary text-white font-medium rounded-none disabled:opacity-50"
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
                          onClick={() => handleStartEdit(site)}
                          className="text-primary hover:text-primary-dark mr-4"
                        >
                          Edit
                        </button>
                        {site.isActive && (
                          <button
                            onClick={() => handleDeactivate(site)}
                            disabled={deactivatingId === site.id}
                            className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          >
                            {deactivatingId === site.id ? 'Deactivating...' : 'Deactivate'}
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
                <td className="px-6 py-3">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Site name"
                    className="w-full px-2 py-1 border border-gray-300 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="Address"
                    className="w-full px-2 py-1 border border-gray-300 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd()
                      if (e.key === 'Escape') setShowAddRow(false)
                    }}
                  />
                </td>
                <td className="px-6 py-3">
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="Phone"
                    className="w-full px-2 py-1 border border-gray-300 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd()
                      if (e.key === 'Escape') setShowAddRow(false)
                    }}
                  />
                </td>
                <td className="px-6 py-3">
                  <input
                    type="text"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Email"
                    className="w-full px-2 py-1 border border-gray-300 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd()
                      if (e.key === 'Escape') setShowAddRow(false)
                    }}
                  />
                </td>
                <td></td>
                <td></td>
                <td className="px-6 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={handleAdd}
                      disabled={saving || !newName.trim()}
                      className="text-xs px-3 py-1 bg-primary text-white font-medium rounded-none disabled:opacity-50"
                    >
                      {saving ? 'Adding...' : 'Add'}
                    </button>
                    <button
                      onClick={() => { setShowAddRow(false); setNewName(''); setNewAddress(''); setNewPhone(''); setNewEmail('') }}
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

      <div className="mt-4 bg-blue-50 border border-blue-200 p-4 rounded-none">
        <div className="flex">
          <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              Users and health checks must be reassigned to another site before a site can be deactivated. You can manage user assignments from the Users page.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
