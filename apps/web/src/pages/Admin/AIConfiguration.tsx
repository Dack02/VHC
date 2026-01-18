import { useState, useEffect } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface AISettings {
  apiKey: string
  apiKeyMasked: string
  model: string
  aiEnabled: boolean
  defaultMonthlyLimit: number
  costAlertThreshold: number
  lastTested: string | null
  isConnected: boolean
}

interface ModelOption {
  id: string
  name: string
  description: string
  inputCostPer1M: number
  outputCostPer1M: number
}

export default function AIConfiguration() {
  const { session } = useSuperAdmin()
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showChangeKeyModal, setShowChangeKeyModal] = useState(false)
  const [newApiKey, setNewApiKey] = useState('')

  useEffect(() => {
    fetchSettings()
  }, [session])

  const fetchSettings = async () => {
    if (!session?.accessToken) return

    try {
      const [settingsData, modelsData] = await Promise.all([
        api<AISettings>('/api/v1/admin/ai-settings', { token: session.accessToken }),
        api<{ models: ModelOption[] }>('/api/v1/admin/ai-settings/models', { token: session.accessToken })
      ])
      setSettings(settingsData)
      setModels(modelsData.models || [])
    } catch (error) {
      console.error('Failed to fetch AI settings:', error)
      setErrorMessage('Failed to load AI settings')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!session?.accessToken || !settings) return

    setSaving(true)
    setSuccessMessage('')
    setErrorMessage('')

    try {
      await api('/api/v1/admin/ai-settings', {
        method: 'PATCH',
        token: session.accessToken,
        body: {
          ai_model: settings.model,
          ai_enabled: settings.aiEnabled,
          default_monthly_ai_limit: settings.defaultMonthlyLimit,
          ai_cost_alert_threshold_usd: settings.costAlertThreshold
        }
      })
      setSuccessMessage('Settings saved successfully')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      console.error('Failed to save settings:', error)
      setErrorMessage('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    if (!session?.accessToken) return

    setTesting(true)
    setErrorMessage('')

    try {
      const result = await api<{ success: boolean; message?: string; model?: string }>('/api/v1/admin/ai-settings/test', {
        method: 'POST',
        token: session.accessToken
      })

      if (result.success) {
        setSuccessMessage(`Connection successful! Model: ${result.model}`)
        fetchSettings() // Refresh to get updated lastTested
      } else {
        setErrorMessage(result.message || 'Connection test failed')
      }
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (error) {
      console.error('Failed to test connection:', error)
      setErrorMessage('Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleUpdateApiKey = async () => {
    if (!session?.accessToken || !newApiKey.trim()) return

    setSaving(true)
    setErrorMessage('')

    try {
      await api('/api/v1/admin/ai-settings', {
        method: 'PATCH',
        token: session.accessToken,
        body: { anthropic_api_key: newApiKey }
      })
      setSuccessMessage('API key updated successfully')
      setShowChangeKeyModal(false)
      setNewApiKey('')
      fetchSettings()
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      console.error('Failed to update API key:', error)
      setErrorMessage('Failed to update API key')
    } finally {
      setSaving(false)
    }
  }

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  }

  const selectedModel = models.find(m => m.id === settings?.model)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading AI settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Failed to load AI settings</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Configuration</h1>
          <p className="text-gray-500 mt-1">Configure platform-wide AI settings and API keys</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
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

      {/* Status Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">AI Service Status</h2>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <div className="flex items-center">
              <span className={`inline-flex items-center justify-center w-3 h-3 rounded-full mr-2 ${
                settings.isConnected ? 'bg-green-500' : 'bg-gray-400'
              }`} />
              <span className={`font-medium ${settings.isConnected ? 'text-green-700' : 'text-gray-600'}`}>
                {settings.isConnected ? 'Connected' : 'Not Configured'}
              </span>
            </div>
            <div className="text-sm text-gray-500">
              <span className="font-medium">Model:</span> {selectedModel?.name || settings.model || 'Not set'}
            </div>
            <div className="text-sm text-gray-500">
              <span className="font-medium">Last tested:</span> {formatTimeAgo(settings.lastTested)}
            </div>
          </div>
          <button
            onClick={handleTestConnection}
            disabled={testing || !settings.apiKeyMasked}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>

      {/* API Configuration */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">API Configuration</h2>

        <div className="space-y-6">
          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Anthropic API Key</label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={settings.apiKeyMasked || 'Not configured'}
                disabled
                className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-500"
              />
              <button
                onClick={() => setShowChangeKeyModal(true)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Change Key
              </button>
            </div>
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AI Model</label>
            <select
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            {selectedModel && (
              <p className="mt-1 text-sm text-gray-500">
                {selectedModel.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Global Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Global Controls</h2>

        <div className="space-y-6">
          {/* Enable AI Features */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Enable AI Features</p>
              <p className="text-sm text-gray-500">Turn off to disable all AI generation across platform</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.aiEnabled}
                onChange={(e) => setSettings({ ...settings, aiEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {/* Default Monthly Limit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Monthly Limit (per organization)
            </label>
            <input
              type="number"
              min={0}
              value={settings.defaultMonthlyLimit}
              onChange={(e) => setSettings({ ...settings, defaultMonthlyLimit: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              generations per month. Can be overridden per organization.
            </p>
          </div>

          {/* Cost Alert Threshold */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cost Alert Threshold
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={settings.costAlertThreshold}
                onChange={(e) => setSettings({ ...settings, costAlertThreshold: parseFloat(e.target.value) || 0 })}
                className="w-full pl-7 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Alert when monthly platform cost exceeds this amount.
            </p>
          </div>
        </div>
      </div>

      {/* Model Pricing Info */}
      {selectedModel && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-800 mb-2">Current Model Pricing</h3>
          <div className="flex gap-8 text-sm text-blue-700">
            <div>
              <span className="font-medium">Input:</span> ${selectedModel.inputCostPer1M.toFixed(2)} per 1M tokens
            </div>
            <div>
              <span className="font-medium">Output:</span> ${selectedModel.outputCostPer1M.toFixed(2)} per 1M tokens
            </div>
          </div>
        </div>
      )}

      {/* Change API Key Modal */}
      {showChangeKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Change API Key</h2>
              <button
                onClick={() => {
                  setShowChangeKeyModal(false)
                  setNewApiKey('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-800">
                  <strong>Warning:</strong> Changing the API key will affect all AI operations across the platform.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Anthropic API Key</label>
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowChangeKeyModal(false)
                  setNewApiKey('')
                }}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateApiKey}
                disabled={saving || !newApiKey.trim()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Updating...' : 'Update Key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
