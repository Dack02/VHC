import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface DmsSettings {
  enabled: boolean
  provider: string
  apiUrl: string
  defaultTemplateId: string | null
  autoImportEnabled: boolean
  importScheduleHours: number[]
  importScheduleDays: number[]
  importServiceTypes: string[]
  dailyImportLimit: number
  lastImportAt: string | null
  lastImportStatus: string | null
  lastSyncAt: string | null
  lastError: string | null
  credentialsConfigured: boolean
  usernameMasked: string | null
}

interface PreviewBooking {
  bookingId: string
  vehicleReg: string
  customerName: string
  scheduledTime?: string
  serviceType?: string
  reason?: string
}

interface PreviewResponse {
  success: boolean
  date: string
  summary: {
    totalBookings: number
    willImport: number
    willSkip: number
    alreadyImportedToday: number
    dailyLimit: number
    remainingCapacity: number
    limitWouldBeExceeded: boolean
  }
  willImport: PreviewBooking[]
  willSkip: PreviewBooking[]
  warnings: string[]
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

/**
 * Get the next N working days from a given date.
 * Working days = Mon-Sat (skips Sunday).
 */
function getNextWorkingDays(fromDate: Date, count: number): string[] {
  const days: string[] = []
  const d = new Date(fromDate)
  d.setHours(12, 0, 0, 0)

  while (days.length < count) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0) {
      days.push(d.toISOString().split('T')[0])
    }
  }
  return days
}

function getImportEndDate(): string {
  const futureDays = getNextWorkingDays(new Date(), 2)
  return futureDays[futureDays.length - 1]
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

// Default import hours (6am, 10am, 2pm, 8pm)
const DEFAULT_IMPORT_HOURS = [6, 10, 14, 20]

const IMPORT_HOUR_OPTIONS = [
  { value: 6, label: '06:00 (Early morning)' },
  { value: 10, label: '10:00 (Mid-morning)' },
  { value: 14, label: '14:00 (Afternoon)' },
  { value: 20, label: '20:00 (Evening)' }
]

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
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null)
  const [previewConfirmed, setPreviewConfirmed] = useState(false)

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
        importScheduleHours: settings.importScheduleHours,
        importScheduleDays: settings.importScheduleDays,
        importServiceTypes: settings.importServiceTypes,
        dailyImportLimit: settings.dailyImportLimit
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

  const handlePreviewImport = async () => {
    try {
      setPreviewLoading(true)
      setError('')
      setPreviewConfirmed(false)

      const today = new Date().toISOString().split('T')[0]
      const endDate = getImportEndDate()
      const data = await api<PreviewResponse>(`/api/v1/dms-settings/preview?date=${today}&endDate=${endDate}`, {
        token: session?.accessToken
      })

      setPreviewData(data)
      setShowPreviewModal(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!previewConfirmed) return

    try {
      setImporting(true)
      setShowPreviewModal(false)
      setError('')
      setSuccess('')

      const today = new Date().toISOString().split('T')[0]
      const endDate = getImportEndDate()
      const result = await api<{ success: boolean; message?: string; importId?: string }>(
        '/api/v1/dms-settings/import',
        {
          method: 'POST',
          body: { date: today, endDate },
          token: session?.accessToken
        }
      )

      if (result.success) {
        setSuccess(result.message || 'Import started')
        setTimeout(() => {
          fetchImportHistory()
          fetchUnactionedHealthChecks()
          setSuccess('')
        }, 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import')
    } finally {
      setImporting(false)
      setPreviewData(null)
      setPreviewConfirmed(false)
    }
  }

  const handleRefreshAwaiting = async () => {
    try {
      setRefreshing(true)
      setError('')

      const today = new Date().toISOString().split('T')[0]
      const endDate = getImportEndDate()
      const result = await api<{ success: boolean; message?: string }>(
        '/api/v1/dms-settings/import',
        {
          method: 'POST',
          body: { date: today, endDate },
          token: session?.accessToken
        }
      )

      if (result.success) {
        setSuccess('Syncing bookings from DMS...')
        setTimeout(() => {
          fetchUnactionedHealthChecks()
          fetchSettings()
          setSuccess('')
        }, 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh bookings')
    } finally {
      setRefreshing(false)
    }
  }

  // Mark a vehicle as arrived (DMS workflow)
  const handleMarkArrived = async (healthCheckId: string) => {
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/mark-arrived`, {
        method: 'POST',
        token: session?.accessToken
      })
      setSuccess('Vehicle marked as arrived')
      fetchUnactionedHealthChecks()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark vehicle as arrived')
    }
  }

  // Mark a vehicle as no-show (DMS workflow)
  const handleMarkNoShow = async (healthCheckId: string) => {
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/mark-no-show`, {
        method: 'POST',
        token: session?.accessToken
      })
      setSuccess('Vehicle marked as no-show')
      fetchUnactionedHealthChecks()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark vehicle as no-show')
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

  const toggleImportHour = (hour: number) => {
    if (!settings) return
    const hours = [...(settings.importScheduleHours || DEFAULT_IMPORT_HOURS)]
    const index = hours.indexOf(hour)
    if (index > -1) {
      hours.splice(index, 1)
    } else {
      hours.push(hour)
      hours.sort((a, b) => a - b)
    }
    setSettings({ ...settings, importScheduleHours: hours })
  }

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
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
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
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
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
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
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
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

          {/* Warning when enabling auto-import */}
          {settings?.autoImportEnabled && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Automatic imports enabled</p>
                  <p className="mt-1">
                    Health checks will be automatically created from DMS bookings at the scheduled times.
                    Use Preview Import to see what will be imported before enabling.
                  </p>
                </div>
              </div>
            </div>
          )}

          {settings?.autoImportEnabled && (
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Import Times
                </label>
                <div className="flex flex-wrap gap-2">
                  {IMPORT_HOUR_OPTIONS.map(hour => (
                    <button
                      key={hour.value}
                      type="button"
                      onClick={() => toggleImportHour(hour.value)}
                      className={`px-3 py-1.5 text-sm font-medium border ${
                        (settings?.importScheduleHours || DEFAULT_IMPORT_HOURS).includes(hour.value)
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {hour.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Select when to automatically import bookings (UK timezone)
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Daily Import Limit
                </label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={settings?.dailyImportLimit || 100}
                  onChange={(e) => settings && setSettings({ ...settings, dailyImportLimit: parseInt(e.target.value) || 100 })}
                  className="w-24 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maximum health checks to import per day (safety limit)
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Manual Import */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Manual Import</h2>
            <p className="text-sm text-gray-500 mt-1">
              Preview and import today's bookings from your DMS
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
                onClick={handlePreviewImport}
                disabled={previewLoading || importing || !settings?.credentialsConfigured}
                className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
              >
                {previewLoading ? 'Loading...' : importing ? 'Importing...' : 'Preview Import'}
              </button>
            </div>
          </div>
        </div>

        {/* Awaiting Arrival */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Awaiting Arrival</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {unactionedHealthChecks.length > 0
                    ? `${unactionedHealthChecks.length} health check${unactionedHealthChecks.length !== 1 ? 's' : ''} waiting for vehicle arrival`
                    : 'No vehicles awaiting arrival'
                  }
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Last synced: {formatLastSync(settings?.lastSyncAt || null)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleRefreshAwaiting}
                  disabled={refreshing || !settings?.credentialsConfigured}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                >
                  <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {refreshing ? 'Syncing...' : 'Refresh'}
                </button>
                {unactionedHealthChecks.length > 0 && (
                  <a
                    href="/health-checks?status=created"
                    className="text-primary hover:underline text-sm font-medium"
                  >
                    View All
                  </a>
                )}
              </div>
            </div>
          </div>
          {unactionedHealthChecks.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Registration</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vehicle</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Promise Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Imported</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
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
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleMarkArrived(hc.id)}
                            className="px-2 py-1 bg-green-600 text-white text-xs font-medium hover:bg-green-700"
                            title="Mark vehicle as arrived"
                          >
                            Arrived
                          </button>
                          <button
                            onClick={() => handleMarkNoShow(hc.id)}
                            className="px-2 py-1 bg-gray-500 text-white text-xs font-medium hover:bg-gray-600"
                            title="Mark as no-show"
                          >
                            No Show
                          </button>
                          <a
                            href={`/health-checks/${hc.id}`}
                            className="text-primary hover:underline font-medium"
                          >
                            Open
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <p className="mt-2 text-sm">No vehicles awaiting arrival</p>
              <p className="text-xs text-gray-400 mt-1">Import bookings from your DMS to see them here</p>
            </div>
          )}
        </div>

        {/* Import History */}
        {importHistory.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
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

      {/* Preview Import Modal */}
      {showPreviewModal && previewData && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
              onClick={() => setShowPreviewModal(false)}
            />

            {/* Modal */}
            <div className="relative bg-white w-full max-w-2xl shadow-xl">
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Preview Import</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Bookings for {new Date(previewData.date).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Summary */}
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{previewData.summary.totalBookings}</p>
                    <p className="text-xs text-gray-500">Total in DMS</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{previewData.summary.willImport}</p>
                    <p className="text-xs text-gray-500">Will Import</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-400">{previewData.summary.willSkip}</p>
                    <p className="text-xs text-gray-500">Will Skip</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-primary">{previewData.summary.alreadyImportedToday}</p>
                    <p className="text-xs text-gray-500">Already Imported</p>
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {previewData.warnings.length > 0 && (
                <div className="px-6 py-3 bg-amber-50 border-b border-amber-200">
                  {previewData.warnings.map((warning, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-amber-800">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {warning}
                    </div>
                  ))}
                </div>
              )}

              {/* Content */}
              <div className="px-6 py-4 max-h-80 overflow-y-auto">
                {/* Will Import Section */}
                {previewData.willImport.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Will Import ({previewData.willImport.length})
                    </h4>
                    <div className="space-y-1">
                      {previewData.willImport.map((booking) => (
                        <div key={booking.bookingId} className="flex items-center justify-between text-sm py-1 px-2 bg-green-50 border border-green-100">
                          <span className="font-medium text-gray-900">{booking.vehicleReg}</span>
                          <span className="text-gray-600">{booking.customerName}</span>
                          <span className="text-gray-500 text-xs">{booking.scheduledTime}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Will Skip Section */}
                {previewData.willSkip.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                      Will Skip ({previewData.willSkip.length})
                    </h4>
                    <div className="space-y-1">
                      {previewData.willSkip.map((booking) => (
                        <div key={booking.bookingId} className="flex items-center justify-between text-sm py-1 px-2 bg-gray-50 border border-gray-100">
                          <span className="font-medium text-gray-500">{booking.vehicleReg}</span>
                          <span className="text-gray-400">{booking.customerName}</span>
                          <span className="text-xs text-gray-400 italic">{booking.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewData.willImport.length === 0 && previewData.willSkip.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="mt-2">No bookings found for today</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                {previewData.willImport.length > 0 && (
                  <label className="flex items-center gap-3 mb-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={previewConfirmed}
                      onChange={(e) => setPreviewConfirmed(e.target.checked)}
                      className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                    />
                    <span className="text-sm text-gray-700">
                      I confirm I want to import {previewData.willImport.length} booking{previewData.willImport.length !== 1 ? 's' : ''} as health checks
                    </span>
                  </label>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowPreviewModal(false)}
                    className="px-4 py-2 text-gray-700 border border-gray-300 font-medium hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmImport}
                    disabled={!previewConfirmed || previewData.willImport.length === 0}
                    className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Import {previewData.willImport.length} Booking{previewData.willImport.length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
