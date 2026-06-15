/**
 * AdminStarterTemplates - Super Admin page for managing the starter INSPECTION
 * template that is deep-copied into each new organization on creation, so a
 * freshly-onboarded org can immediately create a health check.
 */

import { useState, useEffect } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface Organization {
  id: string
  name: string
}

interface StarterTemplate {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  isStarter: boolean
  sectionCount: number
  itemCount: number
}

interface TemplatesResponse {
  templates: StarterTemplate[]
  total: number
  markedAsStarter: number
}

interface StarterSettings {
  sourceOrganizationId: string | null
  autoCopyOnCreate: boolean
}

export default function AdminStarterTemplates() {
  const { session } = useSuperAdmin()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [templates, setTemplates] = useState<StarterTemplate[]>([])
  const [settings, setSettings] = useState<StarterSettings>({ sourceOrganizationId: null, autoCopyOnCreate: true })
  const [loading, setLoading] = useState(true)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [togglingId, setTogglingId] = useState<string>('')
  const [savingSettings, setSavingSettings] = useState(false)
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
      fetchTemplates()
    }
  }, [selectedOrgId])

  const fetchOrganizations = async () => {
    try {
      const data = await api<{ organizations: Organization[] }>(
        '/api/v1/admin/organizations?limit=100',
        { token: session?.accessToken }
      )
      setOrganizations(data.organizations || [])
      if (data.organizations?.length > 0 && !selectedOrgId) {
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
        '/api/v1/admin/starter-templates/platform/starter-settings',
        { token: session?.accessToken }
      )
      setSettings(data)
      if (data.sourceOrganizationId) {
        setSelectedOrgId(data.sourceOrganizationId)
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    }
  }

  const fetchTemplates = async () => {
    if (!selectedOrgId) return
    setLoadingTemplates(true)
    try {
      const data = await api<TemplatesResponse>(
        `/api/v1/admin/starter-templates?organization_id=${selectedOrgId}`,
        { token: session?.accessToken }
      )
      setTemplates(data.templates || [])
    } catch (error) {
      console.error('Failed to fetch templates:', error)
      setTemplates([])
    } finally {
      setLoadingTemplates(false)
    }
  }

  const handleToggleStarter = async (template: StarterTemplate) => {
    if (togglingId) return
    setTogglingId(template.id)
    setErrorMessage('')
    try {
      const endpoint = template.isStarter
        ? '/api/v1/admin/starter-templates/unmark'
        : '/api/v1/admin/starter-templates/mark-as-starter'
      await api(endpoint, {
        method: 'POST',
        body: { organization_id: selectedOrgId, template_ids: [template.id] },
        token: session?.accessToken
      })
      setSuccessMessage(template.isStarter ? 'Removed from starter set' : 'Added to starter set')
      setTimeout(() => setSuccessMessage(''), 3000)
      fetchTemplates()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update template')
    } finally {
      setTogglingId('')
    }
  }

  const handleSaveSettings = async () => {
    if (savingSettings) return
    setSavingSettings(true)
    setErrorMessage('')
    try {
      await api('/api/v1/admin/starter-templates/platform/starter-settings', {
        method: 'PATCH',
        body: {
          source_organization_id: selectedOrgId || null,
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

  const markedCount = templates.filter((t) => t.isStarter).length

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
          <p className="text-gray-500 mt-1">
            Choose the inspection template copied into every new organisation so they can run their first health check immediately.
          </p>
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
        {/* Source org + template list */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Source Organisation</h2>
          <p className="text-sm text-gray-600 mb-4">
            Select the organisation whose template(s) will be used as the starter. Mark one or more templates below.
          </p>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Organisation</label>
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

          {loadingTemplates ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              This organisation has no active inspection templates.
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    t.isStarter ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {t.name}
                      {t.isDefault && (
                        <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">Default</span>
                      )}
                      {t.isStarter && (
                        <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700">Starter</span>
                      )}
                    </p>
                    <p className="text-sm text-gray-500">
                      {t.sectionCount} section{t.sectionCount !== 1 ? 's' : ''} · {t.itemCount} item{t.itemCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleStarter(t)}
                    disabled={togglingId === t.id}
                    className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                      t.isStarter
                        ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {togglingId === t.id ? '...' : t.isStarter ? 'Remove' : 'Set as starter'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Global settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Global Settings</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Auto-copy on Create</p>
                <p className="text-sm text-gray-500">Copy the starter template when a new organization is created</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoCopyOnCreate}
                  onChange={(e) => setSettings((prev) => ({ ...prev, autoCopyOnCreate: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
              <p className="font-medium mb-1">{markedCount} template{markedCount !== 1 ? 's' : ''} marked as starter</p>
              <p>Remember to <strong>Save Settings</strong> to set the selected organisation as the starter source.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
