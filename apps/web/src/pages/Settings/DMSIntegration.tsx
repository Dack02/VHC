import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface DmsSettings {
  enabled: boolean
  provider: string
  apiUrl: string
  defaultTemplateId: string | null
  autoImportEnabled: boolean
  importScheduleHour: number
  importScheduleDays: number[]
  importServiceTypes: string[]
  lastImportAt: string | null
  lastImportStatus: string | null
  lastError: string | null
  credentialsConfigured: boolean
  usernameMasked: string | null
}

interface ImportHistory {
  id: string
  importType: 'manual' | 'scheduled' | 'test'
  importDate: string
  status: 'running' | 'completed' | 'partial' | 'failed'
  bookingsFound: number
  bookingsImported: number
  bookingsSkipped: number
  bookingsFailed: number
  customersCreated: number
  vehiclesCreated: number
  healthChecksCreated: number
  errors: Array<{ bookingId: string; error: string }>
  triggeredBy: string | null
  createdAt: string
  completedAt: string | null
}

interface Template {
  id: string
  name: string
}

interface UnactionedHealthCheck {
  id: string
  registration: string
  make: string
  model: string
  customerName: string
  promiseTime: string | null
  importedAt: string
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' }
]

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, '0') + ':00'
}))

export default function DMSIntegration() {
  const { session, user } = useAuth()
  const [settings, setSettings] = useState<DmsSettings | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [importHistory, setImportHistory] = useState<ImportHistory[]>([])
  const [unactionedHealthChecks, setUnactionedHealthChecks] = useState<UnactionedHealthCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Credential form state
  const [apiUrl, setApiUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    fetchSettings()
    fetchTemplates()
    fetchImportHistory()
    fetchUnactionedHealthChecks()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const data = await api<DmsSettings>('/api/v1/dms-settings/settings', {
        token: session?.accessToken
      })
      setSettings(data)
      setApiUrl(data.apiUrl || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load DMS settings')
    } finally {
      setLoading(false)
    }
  }

  const fetchTemplates = async () => {
    if (!user?.organization?.id) return
    try {
      const data = await api<{ templates: Template[] }>(`/api/v1/templates?organizationId=${user.organization.id}`, {
        token: session?.accessToken
      })
      setTemplates(data.templates || [])
    } catch (err) {
      console.error('Failed to load templates:', err)
    }
  }

  const fetchImportHistory = async () => {
    try {
      const data = await api<{ imports: ImportHistory[] }>('/api/v1/dms-settings/import/history?limit=10', {
        token: session?.accessToken
      })
      setImportHistory(data.imports || [])
    } catch (err) {
      console.error('Failed to load import history:', err)
    }
  }

  const fetchUnactionedHealthChecks = async () => {
    try {
      const data = await api<{ healthChecks: UnactionedHealthCheck[]; total: number }>(
        '/api/v1/dms-settings/unactioned?limit=10',
        { token: session?.accessToken }
      )
      setUnactionedHealthChecks(data.healthChecks || [])
    } catch (err) {
      console.error('Failed to load unactioned health checks:', err)
    }
  }

  const handleSaveSettings = async () => {
    if (!settings) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      const updateData: Partial<DmsSettings> & { username?: string; password?: string } = {
        enabled: settings.enabled,
        apiUrl,
        defaultTemplateId: settings.defaultTemplateId,
        autoImportEnabled: settings.autoImportEnabled,
        importScheduleHour: settings.importScheduleHour,
        importScheduleDays: settings.importScheduleDays,
        importServiceTypes: settings.importServiceTypes
      }

      // Only include credentials if they were changed
      if (username) {
        updateData.username = username
      }
      if (password) {
        updateData.password = password
      }

      const data = await api<DmsSettings>('/api/v1/dms-settings/settings', {
        method: 'PATCH',
        body: updateData,
        token: session?.accessToken
      })

      setSettings(data)
      // Update local form state from response
      setApiUrl(data.apiUrl || '')
      setUsername('') // Clear credentials after save
      setPassword('') // Clear credentials after save
      setSuccess('DMS settings saved successfully')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    try {
      setTesting(true)
      setError('')
      setSuccess('')

      // Send current form values for testing (allows testing before save)
      const testData: { apiUrl?: string; username?: string; password?: string } = {}
      if (apiUrl) testData.apiUrl = apiUrl
      if (username) testData.username = username
      if (password) testData.password = password

      const result = await api<{ success: boolean; message?: string; error?: string }>(
        '/api/v1/dms-settings/test-connection',
        {
          method: 'POST',
          body: testData,
          token: session?.accessToken
        }
      )

      if (result.success) {
        setSuccess(result.message || 'Connection successful')
      } else {
        setError(result.message || result.error || 'Connection failed')
      }
      setTimeout(() => {
        setSuccess('')
        setError('')
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleManualImport = async () => {
    try {
      setImporting(true)
      setError('')
      setSuccess('')

      const today = new Date().toISOString().split('T')[0]
      const result = await api<{ success: boolean; message?: string; importId?: string }>(
        '/api/v1/dms-settings/import',
        {
          method: 'POST',
          body: { date: today },
          token: session?.accessToken
        }
      )

      if (result.success) {
        setSuccess(result.message || 'Import started')
        // Refresh import history after a delay
        setTimeout(() => {
          fetchImportHistory()
          setSuccess('')
        }, 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import')
    } finally {
      setImporting(false)
    }
  }

  const handleClearCredentials = async () => {
    if (!confirm('Are you sure you want to remove your DMS credentials?')) return

    try {
      setSaving(true)
      await api('/api/v1/dms-settings/settings/credentials', {
        method: 'DELETE',
        token: session?.accessToken
      })
      setUsername('')
      setPassword('')
      setApiUrl('')
      await fetchSettings()
      setSuccess('Credentials removed')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove credentials')
    } finally {
      setSaving(false)
    }
  }

  const toggleDay = (day: number) => {
    if (!settings) return
    const days = [...settings.importScheduleDays]
    const index = days.indexOf(day)
    if (index > -1) {
      days.splice(index, 1)
    } else {
      days.push(day)
      days.sort()
    }
    setSettings({ ...settings, importScheduleDays: days })
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">DMS Integration</h1>
          <p className="text-sm text-gray-500 mt-1">
            Connect to your Dealer Management System to auto-import bookings
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-6">
          {error}
          <button onClick={() => setError('')} className="float-right text-red-700">&times;</button>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 mb-6">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">DMS Integration</h2>
              <p className="text-sm text-gray-500 mt-1">
                {settings?.enabled ? 'Integration is active' : 'Integration is disabled'}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings?.enabled || false}
                onChange={(e) => settings && setSettings({ ...settings, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>

        {/* Credentials Section */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Connection Settings</h2>
            <p className="text-sm text-gray-500 mt-1">
              Enter your Gemini API credentials (Basic Auth)
            </p>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API URL
              </label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://your-gemini-instance.com/api"
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={settings?.credentialsConfigured ? settings.usernameMasked || '••••••••' : 'Enter your username'}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={settings?.credentialsConfigured ? '••••••••' : 'Enter your password'}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
            {settings?.credentialsConfigured && (
              <p className="text-xs text-gray-500">Leave blank to keep existing credentials</p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleTestConnection}
                disabled={testing || (!apiUrl && !settings?.credentialsConfigured)}
                className="px-4 py-2 text-gray-700 border border-gray-300 font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {settings?.credentialsConfigured && (
                <button
                  onClick={handleClearCredentials}
                  disabled={saving}
                  className="px-4 py-2 text-red-700 border border-red-300 font-medium hover:bg-red-50 disabled:opacity-50"
                >
                  Remove Credentials
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Import Settings */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Import Settings</h2>
            <p className="text-sm text-gray-500 mt-1">
              Configure how bookings are imported from your DMS
            </p>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Template
              </label>
              <select
                value={settings?.defaultTemplateId || ''}
                onChange={(e) => settings && setSettings({ ...settings, defaultTemplateId: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Use first available template</option>
                {templates.map(template => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Template to use for imported health checks
              </p>
            </div>
          </div>
        </div>

        {/* Auto Import Schedule */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Automatic Import</h2>
              <p className="text-sm text-gray-500 mt-1">
                Schedule automatic daily imports from your DMS
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings?.autoImportEnabled || false}
                onChange={(e) => settings && setSettings({ ...settings, autoImportEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {settings?.autoImportEnabled && (
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Import Time
                </label>
                <select
                  value={settings?.importScheduleHour || 20}
                  onChange={(e) => settings && setSettings({ ...settings, importScheduleHour: parseInt(e.target.value) })}
                  className="w-48 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {HOURS.map(hour => (
                    <option key={hour.value} value={hour.value}>{hour.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Time to run the daily import (UK timezone)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Days to Import
                </label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map(day => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`px-3 py-1.5 text-sm font-medium border ${
                        settings?.importScheduleDays.includes(day.value)
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Select which days to automatically import bookings
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Manual Import */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Manual Import</h2>
            <p className="text-sm text-gray-500 mt-1">
              Manually trigger an import for today's bookings
            </p>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                {settings?.lastImportAt && (
                  <p className="text-sm text-gray-600">
                    Last import: {new Date(settings.lastImportAt).toLocaleString()}
                    <span className={`ml-2 inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                      settings.lastImportStatus === 'completed' ? 'bg-green-100 text-green-800' :
                      settings.lastImportStatus === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                      settings.lastImportStatus === 'failed' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {settings.lastImportStatus}
                    </span>
                  </p>
                )}
                {settings?.lastError && (
                  <p className="text-sm text-red-600 mt-1">{settings.lastError}</p>
                )}
              </div>
              <button
                onClick={handleManualImport}
                disabled={importing || !settings?.credentialsConfigured}
                className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import Now'}
              </button>
            </div>
          </div>
        </div>

        {/* Unactioned Health Checks */}
        {unactionedHealthChecks.length > 0 && (
          <div className="bg-white border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Unactioned Health Checks</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    DMS-imported health checks that haven't been started
                  </p>
                </div>
                <a
                  href="/health-checks?status=created"
                  className="text-primary hover:underline text-sm font-medium"
                >
                  View All
                </a>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Registration</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vehicle</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Promise Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Imported</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {unactionedHealthChecks.map((hc) => (
                    <tr key={hc.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {hc.registration}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {hc.make} {hc.model}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {hc.customerName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {hc.promiseTime ? new Date(hc.promiseTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(hc.importedAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <a
                          href={`/health-checks/${hc.id}`}
                          className="text-primary hover:underline font-medium"
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Import History */}
        {importHistory.length > 0 && (
          <div className="bg-white border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Import History</h2>
              <p className="text-sm text-gray-500 mt-1">
                Recent import activity
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Found</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Imported</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Skipped</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Failed</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {importHistory.map((record) => (
                    <tr key={record.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(record.createdAt).toLocaleDateString()}
                        <span className="text-gray-500 ml-1">
                          {new Date(record.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 capitalize">
                        {record.importType}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                          record.status === 'completed' ? 'bg-green-100 text-green-800' :
                          record.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                          record.status === 'failed' ? 'bg-red-100 text-red-800' :
                          record.status === 'running' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {record.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {record.bookingsFound}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">
                        {record.bookingsImported}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {record.bookingsSkipped}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                        {record.bookingsFailed > 0 ? record.bookingsFailed : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="bg-primary text-white px-6 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
