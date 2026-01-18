import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface Organization {
  id: string
  name: string
  slug: string
  status: string
  settings: Record<string, unknown>
  createdAt: string
  subscription: {
    planId: string
    planName: string
    limits: {
      maxSites: number
      maxUsersPerSite: number
      maxHealthChecksPerMonth: number
      maxStorageGb: number
    }
  }
}

interface UsageData {
  sitesCount: number
  usersCount: number
  healthChecksThisMonth: number
  storageUsedBytes: number
}

interface Site {
  id: string
  name: string
  address: string
  isActive: boolean
  usersCount: number
}

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  siteName: string
}

interface ActivityItem {
  id: string
  action: string
  entityType: string
  metadata: Record<string, unknown>
  performedByName: string
  createdAt: string
}

interface AISettings {
  id: string
  organizationId: string
  aiEnabled: boolean
  monthlyLimit: number | null
  effectiveLimit: number
  currentPeriodGenerations: number
  currentPeriodTokens: number
  currentPeriodCost: number
  lifetimeGenerations: number
  lifetimeTokens: number
  lifetimeCost: number
  periodStart: string
  periodEnd: string
}

type TabType = 'overview' | 'sites' | 'users' | 'billing' | 'activity' | 'ai'

export default function AdminOrganizationDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useSuperAdmin()
  const [org, setOrg] = useState<Organization | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [aiSettings, setAiSettings] = useState<AISettings | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiMessage, setAiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetchOrganization()
  }, [id, session])

  useEffect(() => {
    if (activeTab === 'sites') fetchSites()
    if (activeTab === 'users') fetchUsers()
    if (activeTab === 'activity') fetchActivity()
    if (activeTab === 'ai') fetchAiSettings()
  }, [activeTab])

  const fetchOrganization = async () => {
    if (!session?.accessToken || !id) return

    try {
      const [orgData, usageData] = await Promise.all([
        api<Organization>(`/api/v1/admin/organizations/${id}`, { token: session.accessToken }),
        api<UsageData>(`/api/v1/admin/organizations/${id}/usage`, { token: session.accessToken })
      ])
      setOrg(orgData)
      setUsage(usageData)
    } catch (error) {
      console.error('Failed to fetch organization:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchSites = async () => {
    if (!session?.accessToken || !id) return
    try {
      const data = await api<{ sites: Site[] }>(`/api/v1/admin/organizations/${id}/sites`, { token: session.accessToken })
      setSites(data.sites || [])
    } catch (error) {
      console.error('Failed to fetch sites:', error)
    }
  }

  const fetchUsers = async () => {
    if (!session?.accessToken || !id) return
    try {
      const data = await api<{ users: User[] }>(`/api/v1/admin/organizations/${id}/users`, { token: session.accessToken })
      setUsers(data.users || [])
    } catch (error) {
      console.error('Failed to fetch users:', error)
    }
  }

  const fetchActivity = async () => {
    if (!session?.accessToken || !id) return
    try {
      const data = await api<{ activities: ActivityItem[] }>(`/api/v1/admin/activity?organizationId=${id}&limit=20`, { token: session.accessToken })
      setActivity(data.activities || [])
    } catch (error) {
      console.error('Failed to fetch activity:', error)
    }
  }

  const fetchAiSettings = async () => {
    if (!session?.accessToken || !id) return
    try {
      const data = await api<AISettings>(`/api/v1/admin/organizations/${id}/ai-settings`, { token: session.accessToken })
      setAiSettings(data)
    } catch (error) {
      console.error('Failed to fetch AI settings:', error)
    }
  }

  const handleSaveAiSettings = async () => {
    if (!session?.accessToken || !id || !aiSettings) return

    setAiSaving(true)
    setAiMessage(null)

    try {
      await api(`/api/v1/admin/organizations/${id}/ai-settings`, {
        method: 'PATCH',
        token: session.accessToken,
        body: {
          aiEnabled: aiSettings.aiEnabled,
          monthlyLimit: aiSettings.monthlyLimit
        }
      })
      setAiMessage({ type: 'success', text: 'AI settings saved successfully' })
      fetchAiSettings()
      setTimeout(() => setAiMessage(null), 3000)
    } catch (error) {
      console.error('Failed to save AI settings:', error)
      setAiMessage({ type: 'error', text: 'Failed to save AI settings' })
    } finally {
      setAiSaving(false)
    }
  }

  const handleResetAiPeriod = async () => {
    if (!session?.accessToken || !id || !confirm('Reset the current AI usage period? This will set the generation count back to 0.')) return

    setAiSaving(true)
    setAiMessage(null)

    try {
      await api(`/api/v1/admin/organizations/${id}/ai-settings/reset-period`, {
        method: 'POST',
        token: session.accessToken
      })
      setAiMessage({ type: 'success', text: 'Period reset successfully' })
      fetchAiSettings()
      setTimeout(() => setAiMessage(null), 3000)
    } catch (error) {
      console.error('Failed to reset period:', error)
      setAiMessage({ type: 'error', text: 'Failed to reset period' })
    } finally {
      setAiSaving(false)
    }
  }

  const handleSuspend = async () => {
    if (!session?.accessToken || !id || !confirm('Are you sure you want to suspend this organization?')) return

    setActionLoading(true)
    try {
      await api(`/api/v1/admin/organizations/${id}/suspend`, {
        method: 'POST',
        token: session.accessToken
      })
      fetchOrganization()
    } catch (error) {
      console.error('Failed to suspend organization:', error)
    } finally {
      setActionLoading(false)
    }
  }

  const handleActivate = async () => {
    if (!session?.accessToken || !id) return

    setActionLoading(true)
    try {
      await api(`/api/v1/admin/organizations/${id}/activate`, {
        method: 'POST',
        token: session.accessToken
      })
      fetchOrganization()
    } catch (error) {
      console.error('Failed to activate organization:', error)
    } finally {
      setActionLoading(false)
    }
  }

  const handleImpersonate = async (userId: string) => {
    if (!session?.accessToken || !confirm('Start impersonating this user?')) return

    try {
      const data = await api<{ token: string; user: { email: string } }>(`/api/v1/admin/impersonate/${userId}`, {
        method: 'POST',
        token: session.accessToken
      })
      // Store impersonation session and redirect
      localStorage.setItem('vhc_impersonation', JSON.stringify({
        token: data.token,
        userEmail: data.user.email,
        returnUrl: window.location.pathname
      }))
      window.location.href = '/'
    } catch (error) {
      console.error('Failed to start impersonation:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading organization...</div>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Organization not found</p>
        <button
          onClick={() => navigate('/admin/organizations')}
          className="mt-4 text-indigo-600 hover:text-indigo-700"
        >
          Back to Organizations
        </button>
      </div>
    )
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'sites', label: 'Sites' },
    { id: 'users', label: 'Users' },
    { id: 'billing', label: 'Billing' },
    { id: 'ai', label: 'AI Settings' },
    { id: 'activity', label: 'Activity' }
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate('/admin/organizations')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Organizations
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              org.status === 'active' ? 'bg-green-100 text-green-800' :
              org.status === 'suspended' ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {org.status}
            </span>
          </div>
          <p className="text-gray-500 mt-1">{org.slug}</p>
        </div>
        <div className="flex gap-2">
          {org.status === 'active' ? (
            <button
              onClick={handleSuspend}
              disabled={actionLoading}
              className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              Suspend
            </button>
          ) : (
            <button
              onClick={handleActivate}
              disabled={actionLoading}
              className="px-4 py-2 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-50"
            >
              Activate
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Usage Stats */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Usage Overview</h3>
            <div className="space-y-4">
              <UsageBar
                label="Sites"
                current={usage?.sitesCount || 0}
                max={org.subscription?.limits?.maxSites || 0}
              />
              <UsageBar
                label="Users"
                current={usage?.usersCount || 0}
                max={(org.subscription?.limits?.maxUsersPerSite || 0) * (org.subscription?.limits?.maxSites || 0)}
              />
              <UsageBar
                label="Health Checks (this month)"
                current={usage?.healthChecksThisMonth || 0}
                max={org.subscription?.limits?.maxHealthChecksPerMonth || 0}
              />
              <UsageBar
                label="Storage"
                current={Math.round((usage?.storageUsedBytes || 0) / (1024 * 1024 * 1024) * 10) / 10}
                max={org.subscription?.limits?.maxStorageGb || 0}
                unit="GB"
              />
            </div>
          </div>

          {/* Organization Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Organization Info</h3>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-500">Created</dt>
                <dd className="text-gray-900">{new Date(org.createdAt).toLocaleDateString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Plan</dt>
                <dd className="text-gray-900">{org.subscription?.planName || 'No plan'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Status</dt>
                <dd className="text-gray-900 capitalize">{org.status}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {activeTab === 'sites' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Site</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Address</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Users</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sites.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-500">No sites found</td>
                </tr>
              ) : (
                sites.map((site) => (
                  <tr key={site.id}>
                    <td className="px-6 py-4 font-medium text-gray-900">{site.name}</td>
                    <td className="px-6 py-4 text-gray-500">{site.address || '-'}</td>
                    <td className="px-6 py-4 text-gray-500">{site.usersCount}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        site.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {site.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Site</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">No users found</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{user.firstName} {user.lastName}</div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-500 capitalize">{user.role.replace('_', ' ')}</td>
                    <td className="px-6 py-4 text-gray-500">{user.siteName || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        user.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleImpersonate(user.id)}
                        className="text-sm text-indigo-600 hover:text-indigo-900"
                      >
                        Impersonate
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'billing' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Subscription Details</h3>
          <dl className="space-y-4">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <dt className="text-gray-500">Current Plan</dt>
              <dd className="font-medium text-gray-900">{org.subscription?.planName || 'No plan'}</dd>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <dt className="text-gray-500">Max Sites</dt>
              <dd className="text-gray-900">{org.subscription?.limits?.maxSites || 0}</dd>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <dt className="text-gray-500">Max Users per Site</dt>
              <dd className="text-gray-900">{org.subscription?.limits?.maxUsersPerSite || 0}</dd>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <dt className="text-gray-500">Health Checks / Month</dt>
              <dd className="text-gray-900">{org.subscription?.limits?.maxHealthChecksPerMonth?.toLocaleString() || 0}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-gray-500">Storage Limit</dt>
              <dd className="text-gray-900">{org.subscription?.limits?.maxStorageGb || 0} GB</dd>
            </div>
          </dl>
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="space-y-6">
          {aiMessage && (
            <div className={`px-4 py-3 rounded-lg ${
              aiMessage.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {aiMessage.text}
            </div>
          )}

          {/* Current Period Usage */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">
              Current Period ({aiSettings?.periodStart ? new Date(aiSettings.periodStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'Loading...'})
            </h3>
            {aiSettings && (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">AI Generations</span>
                    <span className={`font-medium ${
                      aiSettings.currentPeriodGenerations / aiSettings.effectiveLimit >= 0.9 ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {aiSettings.currentPeriodGenerations} / {aiSettings.effectiveLimit}
                    </span>
                  </div>
                  <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        aiSettings.currentPeriodGenerations / aiSettings.effectiveLimit >= 0.9 ? 'bg-red-500' :
                        aiSettings.currentPeriodGenerations / aiSettings.effectiveLimit >= 0.7 ? 'bg-amber-500' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${Math.min((aiSettings.currentPeriodGenerations / aiSettings.effectiveLimit) * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {Math.round((aiSettings.currentPeriodGenerations / aiSettings.effectiveLimit) * 100)}% used
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                  <div>
                    <p className="text-sm text-gray-500">Generations</p>
                    <p className="text-xl font-semibold text-gray-900">{aiSettings.currentPeriodGenerations}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Tokens</p>
                    <p className="text-xl font-semibold text-gray-900">{aiSettings.currentPeriodTokens.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Est. Cost</p>
                    <p className="text-xl font-semibold text-gray-900">${aiSettings.currentPeriodCost.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Limits Configuration */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Limits</h3>
            {aiSettings && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Generation Limit</label>
                  <input
                    type="number"
                    min={0}
                    value={aiSettings.monthlyLimit ?? ''}
                    onChange={(e) => setAiSettings({
                      ...aiSettings,
                      monthlyLimit: e.target.value ? parseInt(e.target.value) : null
                    })}
                    placeholder={`Platform default (${aiSettings.effectiveLimit})`}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Leave blank to use platform default ({aiSettings.effectiveLimit})
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">AI Features Enabled</p>
                    <p className="text-sm text-gray-500">Uncheck to disable AI for this organization</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiSettings.aiEnabled}
                      onChange={(e) => setAiSettings({ ...aiSettings, aiEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Lifetime Totals */}
          {aiSettings && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Lifetime Totals</h4>
              <div className="flex gap-8 text-sm">
                <div>
                  <span className="text-gray-500">Generations:</span>{' '}
                  <span className="font-medium text-gray-900">{aiSettings.lifetimeGenerations}</span>
                </div>
                <div>
                  <span className="text-gray-500">Tokens:</span>{' '}
                  <span className="font-medium text-gray-900">{aiSettings.lifetimeTokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-500">Est. Cost:</span>{' '}
                  <span className="font-medium text-gray-900">${aiSettings.lifetimeCost.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleResetAiPeriod}
              disabled={aiSaving}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Reset Current Period
            </button>
            <button
              onClick={handleSaveAiSettings}
              disabled={aiSaving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {aiSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="divide-y divide-gray-100">
            {activity.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500">No activity found</div>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="px-6 py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{item.performedByName}</span>
                        {' '}{item.action}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {item.entityType} • {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function UsageBar({ label, current, max, unit = '' }: { label: string; current: number; max: number; unit?: string }) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0
  const isHigh = percentage > 80

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className={isHigh ? 'text-red-600 font-medium' : 'text-gray-900'}>
          {current}{unit} / {max}{unit}
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isHigh ? 'bg-red-500' : 'bg-indigo-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
