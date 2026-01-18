/**
 * AdminStarterTemplate - Super Admin page for managing starter reason templates
 */

import { useState, useEffect } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface Organization {
  id: string
  name: string
}

interface StarterStats {
  totalReasons: number
  markedAsStarter: number
  pendingReview: number
  byReasonType: Array<{
    reasonType: string
    displayName: string
    count: number
  }>
}

interface StarterReason {
  id: string
  reasonText: string
  reasonType: string | null
  defaultRag: string
  customerDescription: string | null
  followUpDays: number | null
  categoryName: string | null
  categoryColor: string | null
  itemName: string | null
}

interface StarterReasonsPreview {
  byReasonType: Array<{
    reasonType: string
    displayName: string
    reasons: StarterReason[]
  }>
  uniqueItems: StarterReason[]
  total: number
}

interface StarterSettings {
  sourceOrganizationId: string | null
  autoCopyOnCreate: boolean
}

export default function AdminStarterTemplate() {
  const { session } = useSuperAdmin()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [stats, setStats] = useState<StarterStats | null>(null)
  const [settings, setSettings] = useState<StarterSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [preview, setPreview] = useState<StarterReasonsPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (session?.accessToken) {
      fetchOrganizations()
      fetchSettings()
    }
  }, [session?.accessToken])

  useEffect(() => {
    if (selectedOrgId) {
      fetchStats()
    }
  }, [selectedOrgId])

  const fetchOrganizations = async () => {
    try {
      const data = await api<{ organizations: Organization[] }>(
        '/api/v1/admin/organizations?limit=100',
        { token: session?.accessToken }
      )
      setOrganizations(data.organizations || [])

      // Auto-select first org or the one saved in settings
      if (data.organizations?.length > 0) {
        setSelectedOrgId(data.organizations[0].id)
      }
    } catch (error) {
      console.error('Failed to fetch organizations:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchSettings = async () => {
    try {
      const data = await api<StarterSettings>(
        '/api/v1/admin/starter-reasons/platform/starter-settings',
        { token: session?.accessToken }
      )
      setSettings(data)

      // If there's a saved source org, select it
      if (data.sourceOrganizationId) {
        setSelectedOrgId(data.sourceOrganizationId)
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    }
  }

  const fetchStats = async () => {
    if (!selectedOrgId) return
    try {
      const data = await api<StarterStats>(
        `/api/v1/admin/starter-reasons/stats?organization_id=${selectedOrgId}`,
        { token: session?.accessToken }
      )
      setStats(data)
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }

  const handleMarkAllReviewed = async () => {
    if (!selectedOrgId || marking) return
    setMarking(true)
    setErrorMessage('')

    try {
      const result = await api<{ marked: number }>(
        '/api/v1/admin/starter-reasons/mark-as-starter',
        {
          method: 'POST',
          body: { organization_id: selectedOrgId, mark_all_reviewed: true },
          token: session?.accessToken
        }
      )

      setSuccessMessage(`Marked ${result.marked} reasons as starter templates`)
      fetchStats()
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to mark reasons')
    } finally {
      setMarking(false)
    }
  }

  const handleSaveSettings = async () => {
    if (!settings || savingSettings) return
    setSavingSettings(true)
    setErrorMessage('')

    try {
      await api('/api/v1/admin/starter-reasons/platform/starter-settings', {
        method: 'PATCH',
        body: {
          source_organization_id: selectedOrgId,
          auto_copy_on_create: settings.autoCopyOnCreate
        },
        token: session?.accessToken
      })

      setSuccessMessage('Settings saved successfully')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  const handlePreview = async () => {
    if (!selectedOrgId) return
    setLoadingPreview(true)
    setShowPreview(true)

    try {
      const data = await api<StarterReasonsPreview>(
        `/api/v1/admin/starter-reasons?organization_id=${selectedOrgId}`,
        { token: session?.accessToken }
      )
      setPreview(data)
    } catch (error) {
      console.error('Failed to fetch preview:', error)
      setShowPreview(false)
    } finally {
      setLoadingPreview(false)
    }
  }

  const getRagBadge = (rag: string) => {
    const colors: Record<string, string> = {
      red: 'bg-red-100 text-red-700',
      amber: 'bg-amber-100 text-amber-700',
      green: 'bg-green-100 text-green-700'
    }
    return colors[rag] || 'bg-gray-100 text-gray-700'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Starter Template</h1>
          <p className="text-gray-500 mt-1">Manage starter reasons for new organizations</p>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={savingSettings}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {savingSettings ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-red-700 hover:text-red-900">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Source Organization Selection */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Source Organization</h2>
          <p className="text-sm text-gray-600 mb-4">
            Select the organization whose reasons will be used as starter templates for new organizations.
          </p>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Organization</label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select an organization</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>

          {stats && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{stats.totalReasons}</div>
                <div className="text-sm text-gray-500">Total Reasons</div>
              </div>
              <div className="bg-indigo-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-indigo-600">{stats.markedAsStarter}</div>
                <div className="text-sm text-gray-500">Marked as Starter</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-amber-600">{stats.pendingReview}</div>
                <div className="text-sm text-gray-500">Pending Review</div>
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={handleMarkAllReviewed}
              disabled={marking || !selectedOrgId || !stats?.pendingReview}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {marking ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Marking...
                </span>
              ) : (
                `Mark All Reviewed as Starter (${stats?.pendingReview || 0})`
              )}
            </button>
            <button
              onClick={handlePreview}
              disabled={!selectedOrgId || !stats?.markedAsStarter}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Preview Starter Set
            </button>
          </div>
        </div>

        {/* Global Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Global Settings</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Auto-copy on Create</p>
                <p className="text-sm text-gray-500">Copy starter reasons when new organization is created</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings?.autoCopyOnCreate ?? true}
                  onChange={(e) => setSettings(prev => prev ? { ...prev, autoCopyOnCreate: e.target.checked } : null)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {stats?.byReasonType && stats.byReasonType.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Starter Reasons by Type</h3>
                <div className="space-y-2">
                  {stats.byReasonType.map((type) => (
                    <div key={type.reasonType} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{type.displayName}</span>
                      <span className="font-medium text-gray-900">{type.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Starter Reasons Preview</h2>
                <p className="text-sm text-gray-500">
                  {preview?.total || 0} reasons will be copied to new organizations
                </p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {loadingPreview ? (
                <div className="flex items-center justify-center h-64">
                  <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Grouped by Type */}
                  {preview?.byReasonType.map((group) => (
                    <div key={group.reasonType}>
                      <h3 className="text-md font-medium text-gray-900 mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-500 rounded-full" />
                        {group.displayName}
                        <span className="text-sm text-gray-500">({group.reasons.length} reasons)</span>
                      </h3>
                      <div className="space-y-2 ml-4">
                        {group.reasons.map((reason) => (
                          <ReasonRow key={reason.id} reason={reason} getRagBadge={getRagBadge} />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Unique Items */}
                  {preview?.uniqueItems && preview.uniqueItems.length > 0 && (
                    <div>
                      <h3 className="text-md font-medium text-gray-900 mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 bg-gray-500 rounded-full" />
                        Unique Items
                        <span className="text-sm text-gray-500">({preview.uniqueItems.length} reasons)</span>
                      </h3>
                      <div className="space-y-2 ml-4">
                        {preview.uniqueItems.map((reason) => (
                          <ReasonRow key={reason.id} reason={reason} getRagBadge={getRagBadge} />
                        ))}
                      </div>
                    </div>
                  )}

                  {(!preview?.byReasonType?.length && !preview?.uniqueItems?.length) && (
                    <div className="text-center py-12 text-gray-500">
                      No starter reasons found. Mark some reasons as starter templates first.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  Total: <strong>{preview?.total || 0} reasons</strong> will be copied
                </span>
                <button
                  onClick={() => setShowPreview(false)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Reason Row Component
function ReasonRow({ reason, getRagBadge }: { reason: StarterReason; getRagBadge: (rag: string) => string }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
      <span className={`px-2 py-0.5 text-xs font-medium rounded ${getRagBadge(reason.defaultRag)}`}>
        {reason.defaultRag.toUpperCase()}
      </span>
      <div className="flex-1">
        <p className="text-sm text-gray-900">{reason.reasonText}</p>
        {reason.customerDescription && (
          <p className="text-xs text-gray-500 mt-1">Customer: {reason.customerDescription}</p>
        )}
        {reason.categoryName && (
          <span
            className="inline-block mt-1 px-2 py-0.5 text-xs rounded"
            style={{
              backgroundColor: reason.categoryColor ? `${reason.categoryColor}20` : '#f3f4f6',
              color: reason.categoryColor || '#6b7280'
            }}
          >
            {reason.categoryName}
          </span>
        )}
      </div>
      {reason.itemName && (
        <span className="text-xs text-gray-500">{reason.itemName}</span>
      )}
    </div>
  )
}
