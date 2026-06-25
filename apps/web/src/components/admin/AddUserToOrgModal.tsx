import { useState, useEffect } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface Site {
  id: string
  name: string
}

interface AddUserToOrgModalProps {
  organizationId: string
  onClose: () => void
  onCreated: () => void
}

export default function AddUserToOrgModal({ organizationId, onClose, onCreated }: AddUserToOrgModalProps) {
  const { session } = useSuperAdmin()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sites, setSites] = useState<Site[]>([])
  const [created, setCreated] = useState(false)
  const [tempPassword, setTempPassword] = useState('')
  const [emailSent, setEmailSent] = useState<boolean | undefined>(undefined)
  const [linkedExisting, setLinkedExisting] = useState(false)

  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('technician')
  const [siteId, setSiteId] = useState('')

  useEffect(() => {
    const fetchSites = async () => {
      if (!session?.accessToken) return
      try {
        const data = await api<{ sites: Site[] }>(`/api/v1/admin/organizations/${organizationId}/sites`, { token: session.accessToken })
        setSites(data.sites || [])
      } catch (err) {
        console.error('Failed to fetch sites:', err)
      }
    }
    fetchSites()
  }, [session, organizationId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken) return

    setLoading(true)
    setError('')

    try {
      const data = await api<{ id: string; temporaryPassword?: string; emailSent?: boolean; note?: string }>(`/api/v1/admin/organizations/${organizationId}/users`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          email,
          firstName,
          lastName,
          phone: phone || undefined,
          role,
          siteId: siteId || undefined
        }
      })

      setTempPassword(data.temporaryPassword || '')
      setEmailSent(data.emailSent)
      setLinkedExisting(!!data.note)
      setCreated(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  // Success screen after creation: report whether the invite email went out, and
  // keep the temporary password visible as a fallback the admin can hand over.
  if (created) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">User Created</h2>

          {emailSent ? (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg p-3 mb-4">
              {linkedExisting
                ? <>We've emailed <strong>{email}</strong> to let them know they've been added.</>
                : <>An invite email with a set-password link was sent to <strong>{email}</strong>.</>}
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 mb-4">
              {linkedExisting
                ? <>The user was added, but we couldn't email them. Let them know they can sign in with their existing VHC account.</>
                : <>The user was created, but the invite email couldn't be sent. Share the temporary password below instead.</>}
            </div>
          )}

          {tempPassword && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
              <p className="text-xs text-gray-500 mb-1">Temporary Password (fallback)</p>
              <p className="font-mono text-sm text-gray-900 select-all break-all">{tempPassword}</p>
              <p className="text-xs text-gray-400 mt-2">Won't be shown again. The user can also set their own password from the invite link.</p>
            </div>
          )}

          {linkedExisting && (
            <p className="text-xs text-gray-500 mb-4">
              This email already had a VHC account, so they keep their existing password — no new password is needed.
            </p>
          )}

          <button
            onClick={() => { onCreated() }}
            className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Add User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="technician">Technician</option>
              <option value="service_advisor">Service Advisor</option>
              <option value="site_admin">Site Admin</option>
              <option value="org_admin">Org Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Site</label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">No site assigned</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
