/**
 * AdvisorSelectionModal Component
 * Modal for selecting/changing the service advisor assigned to a health check
 */

import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

interface User {
  id: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
}

interface Advisor {
  id: string
  first_name: string
  last_name: string
}

interface AdvisorSelectionModalProps {
  healthCheckId: string
  currentAdvisor: Advisor | null
  onClose: () => void
  onAdvisorChanged: (advisor: Advisor | null) => void
}

export function AdvisorSelectionModal({
  healthCheckId,
  currentAdvisor,
  onClose,
  onAdvisorChanged
}: AdvisorSelectionModalProps) {
  const { session } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(currentAdvisor?.id || null)

  useEffect(() => {
    const fetchUsers = async () => {
      if (!session?.accessToken) return

      try {
        const data = await api<{ users: User[] }>(
          '/api/v1/users?limit=100',
          { token: session.accessToken }
        )

        // Filter to only show users who can be advisors (service_advisor, site_admin, org_admin)
        const advisorRoles = ['service_advisor', 'site_admin', 'org_admin', 'super_admin']
        const eligibleUsers = (data.users || []).filter(
          user => advisorRoles.includes(user.role) && user.isActive
        )

        setUsers(eligibleUsers)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users')
      } finally {
        setLoading(false)
      }
    }

    fetchUsers()
  }, [session?.accessToken])

  const handleSave = async () => {
    if (!session?.accessToken) return

    setSaving(true)
    setError(null)

    try {
      const response = await api<{ advisor: Advisor | null }>(
        `/api/v1/health-checks/${healthCheckId}`,
        {
          method: 'PATCH',
          token: session.accessToken,
          body: { advisorId: selectedUserId }
        }
      )

      onAdvisorChanged(response.advisor || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update advisor')
      setSaving(false)
    }
  }

  const handleUnassign = async () => {
    if (!session?.accessToken) return

    setSaving(true)
    setError(null)

    try {
      await api(
        `/api/v1/health-checks/${healthCheckId}`,
        {
          method: 'PATCH',
          token: session.accessToken,
          body: { advisorId: null }
        }
      )

      onAdvisorChanged(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unassign advisor')
      setSaving(false)
    }
  }

  const roleLabels: Record<string, string> = {
    service_advisor: 'Service Advisor',
    site_admin: 'Site Admin',
    org_admin: 'Org Admin',
    super_admin: 'Super Admin'
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-none shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Change Service Advisor</h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <svg className="animate-spin h-8 w-8 text-orange-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">
              {error}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Current Advisor */}
              {currentAdvisor && (
                <div className="text-sm text-gray-600">
                  Current: <span className="font-medium text-gray-900">
                    {currentAdvisor.first_name} {currentAdvisor.last_name}
                  </span>
                </div>
              )}

              {/* User List */}
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded">
                {users.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    No eligible users found
                  </div>
                ) : (
                  users.map(user => (
                    <label
                      key={user.id}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${
                        selectedUserId === user.id ? 'bg-orange-50' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="advisor"
                        checked={selectedUserId === user.id}
                        onChange={() => setSelectedUserId(user.id)}
                        className="w-4 h-4 text-orange-600 focus:ring-orange-500"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {user.firstName} {user.lastName}
                        </div>
                        <div className="text-xs text-gray-500">
                          {roleLabels[user.role] || user.role}
                        </div>
                      </div>
                      {currentAdvisor?.id === user.id && (
                        <span className="text-xs text-orange-600 font-medium">Current</span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
          <div>
            {currentAdvisor && (
              <button
                onClick={handleUnassign}
                disabled={saving}
                className="px-4 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-none"
              >
                Unassign
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-none hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !selectedUserId || selectedUserId === currentAdvisor?.id}
              className={`px-4 py-2 rounded-none font-medium ${
                saving || !selectedUserId || selectedUserId === currentAdvisor?.id
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-orange-600 text-white hover:bg-orange-700'
              }`}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
