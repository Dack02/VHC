import { useState, useEffect } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface PlatformSettings {
  general: {
    platformName: string
    supportEmail: string
    termsUrl: string
    privacyUrl: string
  }
  defaults: {
    defaultPlanId: string
    trialDays: number
    requireEmailVerification: boolean
  }
  features: {
    allowSelfSignup: boolean
    enableDmsIntegration: boolean
    enableNotifications: boolean
  }
  credentials: {
    // Email - Resend
    resendApiKey: string
    resendFromEmail: string
    resendFromName: string
    // SMS - Twilio
    twilioAccountSid: string
    twilioAuthToken: string
    twilioFromNumber: string
    // Other
    dvlaApiKey: string
  }
}

interface Plan {
  id: string
  name: string
}

export default function AdminSettings() {
  const { session } = useSuperAdmin()
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState('general')
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  // Test notification modal state
  const [showTestSmsModal, setShowTestSmsModal] = useState(false)
  const [showTestEmailModal, setShowTestEmailModal] = useState(false)
  const [testPhoneNumber, setTestPhoneNumber] = useState('')
  const [testEmailAddress, setTestEmailAddress] = useState('')
  const [testingSms, setTestingSms] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)

  useEffect(() => {
    fetchData()
  }, [session])

  const fetchData = async () => {
    if (!session?.accessToken) return

    try {
      const [settingsData, plansData] = await Promise.all([
        api<PlatformSettings>('/api/v1/admin/platform/settings', { token: session.accessToken }),
        api<{ plans: Plan[] }>('/api/v1/admin/plans', { token: session.accessToken })
      ])
      setSettings(settingsData)
      setPlans(plansData.plans)
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!session?.accessToken || !settings) return

    setSaving(true)
    setSuccessMessage('')
    try {
      await api('/api/v1/admin/platform/settings', {
        method: 'PATCH',
        token: session.accessToken,
        body: settings
      })
      setSuccessMessage('Settings saved successfully')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (error) {
      console.error('Failed to save settings:', error)
    } finally {
      setSaving(false)
    }
  }

  const updateSettings = <K extends keyof PlatformSettings, T extends keyof PlatformSettings[K]>(
    section: K,
    key: T,
    value: PlatformSettings[K][T]
  ) => {
    if (!settings) return
    setSettings({
      ...settings,
      [section]: {
        ...settings[section],
        [key]: value
      }
    })
  }

  const handleTestSms = async () => {
    if (!session?.accessToken || !testPhoneNumber) return

    setTestingSms(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await api<{ success: boolean; message?: string; error?: string }>(
        '/api/v1/admin/platform/notifications/test-sms',
        {
          method: 'POST',
          body: { to: testPhoneNumber },
          token: session.accessToken
        }
      )

      if (result.success) {
        setSuccessMessage(result.message || 'Test SMS sent successfully')
        setShowTestSmsModal(false)
        setTestPhoneNumber('')
      } else {
        setErrorMessage(result.error || 'Failed to send test SMS')
      }
      setTimeout(() => {
        setSuccessMessage('')
        setErrorMessage('')
      }, 5000)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send test SMS')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setTestingSms(false)
    }
  }

  const handleTestEmail = async () => {
    if (!session?.accessToken || !testEmailAddress) return

    setTestingEmail(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await api<{ success: boolean; message?: string; error?: string }>(
        '/api/v1/admin/platform/notifications/test-email',
        {
          method: 'POST',
          body: { to: testEmailAddress },
          token: session.accessToken
        }
      )

      if (result.success) {
        setSuccessMessage(result.message || 'Test email sent successfully')
        setShowTestEmailModal(false)
        setTestEmailAddress('')
      } else {
        setErrorMessage(result.error || 'Failed to send test email')
      }
      setTimeout(() => {
        setSuccessMessage('')
        setErrorMessage('')
      }, 5000)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send test email')
      setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setTestingEmail(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Failed to load settings</p>
      </div>
    )
  }

  const sections = [
    { id: 'general', label: 'General', icon: '⚙️' },
    { id: 'defaults', label: 'Defaults', icon: '📋' },
    { id: 'features', label: 'Features', icon: '✨' },
    { id: 'credentials', label: 'Credentials', icon: '🔑' }
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Settings</h1>
          <p className="text-gray-500 mt-1">Configure platform-wide settings and defaults</p>
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

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0">
          <nav className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeSection === section.id
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="mr-2">{section.icon}</span>
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {activeSection === 'general' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">General Settings</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Platform Name</label>
                <input
                  type="text"
                  value={settings.general.platformName}
                  onChange={(e) => updateSettings('general', 'platformName', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Support Email</label>
                <input
                  type="email"
                  value={settings.general.supportEmail}
                  onChange={(e) => updateSettings('general', 'supportEmail', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Terms of Service URL</label>
                <input
                  type="url"
                  value={settings.general.termsUrl}
                  onChange={(e) => updateSettings('general', 'termsUrl', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Privacy Policy URL</label>
                <input
                  type="url"
                  value={settings.general.privacyUrl}
                  onChange={(e) => updateSettings('general', 'privacyUrl', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          {activeSection === 'defaults' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Default Settings</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Plan</label>
                <select
                  value={settings.defaults.defaultPlanId}
                  onChange={(e) => updateSettings('defaults', 'defaultPlanId', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a plan</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  New organizations will be assigned this plan by default
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trial Period (days)</label>
                <input
                  type="number"
                  value={settings.defaults.trialDays}
                  onChange={(e) => updateSettings('defaults', 'trialDays', parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="requireEmailVerification"
                  checked={settings.defaults.requireEmailVerification}
                  onChange={(e) => updateSettings('defaults', 'requireEmailVerification', e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="requireEmailVerification" className="ml-2 text-sm text-gray-700">
                  Require email verification for new users
                </label>
              </div>
            </div>
          )}

          {activeSection === 'features' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Feature Flags</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">Self-Signup</p>
                    <p className="text-sm text-gray-500">Allow organizations to sign up without admin approval</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.features.allowSelfSignup}
                      onChange={(e) => updateSettings('features', 'allowSelfSignup', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">DMS Integration</p>
                    <p className="text-sm text-gray-500">Enable dealer management system integrations</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.features.enableDmsIntegration}
                      onChange={(e) => updateSettings('features', 'enableDmsIntegration', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">Notifications</p>
                    <p className="text-sm text-gray-500">Enable email and SMS notifications</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.features.enableNotifications}
                      onChange={(e) => updateSettings('features', 'enableNotifications', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'credentials' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Platform Credentials</h2>
              <p className="text-sm text-gray-500">
                These credentials are used as defaults when organizations don't provide their own.
              </p>

              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>Security Notice:</strong> Credentials are stored securely but displayed masked.
                  Only enter new values when you need to update them.
                </p>
              </div>

              {/* Resend Email Settings */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-3">Email Settings (Resend)</h3>
                <p className="text-xs text-gray-500 mb-3">
                  Platform default email credentials for organizations that don't have their own.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Resend API Key</label>
                    <input
                      type="password"
                      value={settings.credentials.resendApiKey}
                      onChange={(e) => updateSettings('credentials', 'resendApiKey', e.target.value)}
                      placeholder="re_••••••••••••••••"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">From Email</label>
                      <input
                        type="email"
                        value={settings.credentials.resendFromEmail}
                        onChange={(e) => updateSettings('credentials', 'resendFromEmail', e.target.value)}
                        placeholder="noreply@vhc-platform.com"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">From Name</label>
                      <input
                        type="text"
                        value={settings.credentials.resendFromName}
                        onChange={(e) => updateSettings('credentials', 'resendFromName', e.target.value)}
                        placeholder="VHC Platform"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Twilio SMS Settings */}
              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-3">SMS Settings (Twilio)</h3>
                <p className="text-xs text-gray-500 mb-3">
                  Platform default SMS credentials for organizations that don't have their own.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account SID</label>
                    <input
                      type="text"
                      value={settings.credentials.twilioAccountSid}
                      onChange={(e) => updateSettings('credentials', 'twilioAccountSid', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Auth Token</label>
                    <input
                      type="password"
                      value={settings.credentials.twilioAuthToken}
                      onChange={(e) => updateSettings('credentials', 'twilioAuthToken', e.target.value)}
                      placeholder="••••••••••••••••"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">From Number</label>
                  <input
                    type="text"
                    value={settings.credentials.twilioFromNumber}
                    onChange={(e) => updateSettings('credentials', 'twilioFromNumber', e.target.value)}
                    placeholder="+1234567890"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">DVLA API Key</label>
                <input
                  type="password"
                  value={settings.credentials.dvlaApiKey}
                  onChange={(e) => updateSettings('credentials', 'dvlaApiKey', e.target.value)}
                  placeholder="••••••••••••••••"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Test Notification Buttons */}
              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Test Notifications</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Send test messages to verify platform credentials are working correctly.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowTestSmsModal(true)}
                    className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
                  >
                    Test SMS
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTestEmailModal(true)}
                    className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
                  >
                    Test Email
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Test SMS Modal */}
      {showTestSmsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Test SMS</h2>
              <button
                onClick={() => {
                  setShowTestSmsModal(false)
                  setTestPhoneNumber('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                Enter a phone number to send a test SMS using the platform Twilio credentials.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={testPhoneNumber}
                  onChange={(e) => setTestPhoneNumber(e.target.value)}
                  placeholder="+447..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500">
                  Include country code (e.g., +44 for UK)
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowTestSmsModal(false)
                  setTestPhoneNumber('')
                }}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleTestSms}
                disabled={testingSms || !testPhoneNumber}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {testingSms ? 'Sending...' : 'Send Test SMS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Email Modal */}
      {showTestEmailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Test Email</h2>
              <button
                onClick={() => {
                  setShowTestEmailModal(false)
                  setTestEmailAddress('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                Enter an email address to send a test email using the platform Resend credentials.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={testEmailAddress}
                  onChange={(e) => setTestEmailAddress(e.target.value)}
                  placeholder="test@example.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowTestEmailModal(false)
                  setTestEmailAddress('')
                }}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleTestEmail}
                disabled={testingEmail || !testEmailAddress}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {testingEmail ? 'Sending...' : 'Send Test Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
