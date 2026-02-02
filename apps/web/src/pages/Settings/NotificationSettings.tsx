import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'
import {
  isPushSupported,
  getPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  hasActivePushSubscription
} from '../../lib/push-notifications'

interface NotificationSettingsData {
  id?: string
  usePlatformSms: boolean
  usePlatformEmail: boolean
  smsEnabled: boolean
  emailEnabled: boolean
  twilioAccountSid?: string
  twilioPhoneNumber?: string
  resendFromEmail?: string
  resendFromName?: string
  defaultLinkExpiryHours: number
  defaultReminderEnabled: boolean
  defaultReminderIntervals: number[]
  hasTwilioCredentials: boolean
  hasResendCredentials: boolean
  twilioAccountSidMasked?: string
  resendApiKeyMasked?: string
}

const EXPIRY_OPTIONS = [
  { value: 24, label: '24 hours' },
  { value: 48, label: '48 hours' },
  { value: 72, label: '72 hours (default)' },
  { value: 168, label: '1 week' },
  { value: 720, label: '30 days' }
]

export default function NotificationSettings() {
  const { session, user } = useAuth()
  const [settings, setSettings] = useState<NotificationSettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingSms, setTestingSms] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Credential form state
  const [twilioAccountSid, setTwilioAccountSid] = useState('')
  const [twilioAuthToken, setTwilioAuthToken] = useState('')
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState('')
  const [resendApiKey, setResendApiKey] = useState('')
  const [resendFromEmail, setResendFromEmail] = useState('')
  const [resendFromName, setResendFromName] = useState('')
  const [showTwilioToken, setShowTwilioToken] = useState(false)
  const [showResendKey, setShowResendKey] = useState(false)

  // Test form state
  const [testPhoneNumber, setTestPhoneNumber] = useState('')
  const [testEmailAddress, setTestEmailAddress] = useState('')

  // Browser push state
  const [pushSupported] = useState(() => isPushSupported())
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(() => getPushPermission())
  const [pushActive, setPushActive] = useState(false)
  const [pushToggling, setPushToggling] = useState(false)

  const organizationId = user?.organization?.id

  useEffect(() => {
    if (organizationId) {
      fetchSettings()
    }
  }, [organizationId])

  useEffect(() => {
    if (pushSupported) {
      hasActivePushSubscription().then(setPushActive)
    }
  }, [pushSupported])

  const fetchSettings = async () => {
    if (!organizationId) return

    try {
      setLoading(true)
      const data = await api<NotificationSettingsData>(
        `/api/v1/organizations/${organizationId}/notification-settings`,
        { token: session?.accessToken }
      )
      setSettings(data)
      setTwilioPhoneNumber(data.twilioPhoneNumber || '')
      setResendFromEmail(data.resendFromEmail || '')
      setResendFromName(data.resendFromName || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notification settings')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = async () => {
    if (!organizationId || !settings) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      const updateData: Record<string, unknown> = {
        use_platform_sms: settings.usePlatformSms,
        use_platform_email: settings.usePlatformEmail,
        sms_enabled: settings.smsEnabled,
        email_enabled: settings.emailEnabled,
        default_link_expiry_hours: settings.defaultLinkExpiryHours,
        default_reminder_enabled: settings.defaultReminderEnabled
      }

      // Only include credentials if provided (new or changed)
      if (!settings.usePlatformSms) {
        if (twilioAccountSid) updateData.twilio_account_sid = twilioAccountSid
        if (twilioAuthToken) updateData.twilio_auth_token = twilioAuthToken
        if (twilioPhoneNumber) updateData.twilio_phone_number = twilioPhoneNumber
      }

      if (!settings.usePlatformEmail) {
        if (resendApiKey) updateData.resend_api_key = resendApiKey
        if (resendFromEmail) updateData.resend_from_email = resendFromEmail
        if (resendFromName) updateData.resend_from_name = resendFromName
      }

      const data = await api<NotificationSettingsData>(
        `/api/v1/organizations/${organizationId}/notification-settings`,
        {
          method: 'PATCH',
          body: updateData,
          token: session?.accessToken
        }
      )

      setSettings(data)
      // Clear sensitive fields after save
      setTwilioAccountSid('')
      setTwilioAuthToken('')
      setResendApiKey('')
      setSuccess('Notification settings saved successfully')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTestSms = async () => {
    if (!organizationId || !testPhoneNumber) return

    try {
      setTestingSms(true)
      setError('')
      setSuccess('')

      const result = await api<{ success: boolean; message?: string; error?: string }>(
        `/api/v1/organizations/${organizationId}/notification-settings/test-sms`,
        {
          method: 'POST',
          body: { phone_number: testPhoneNumber },
          token: session?.accessToken
        }
      )

      if (result.success) {
        setSuccess(result.message || 'Test SMS sent successfully')
      } else {
        setError(result.error || 'Failed to send test SMS')
      }
      setTimeout(() => {
        setSuccess('')
        setError('')
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test SMS')
    } finally {
      setTestingSms(false)
    }
  }

  const handleTestEmail = async () => {
    if (!organizationId || !testEmailAddress) return

    try {
      setTestingEmail(true)
      setError('')
      setSuccess('')

      const result = await api<{ success: boolean; message?: string; error?: string }>(
        `/api/v1/organizations/${organizationId}/notification-settings/test-email`,
        {
          method: 'POST',
          body: { email: testEmailAddress },
          token: session?.accessToken
        }
      )

      if (result.success) {
        setSuccess(result.message || 'Test email sent successfully')
      } else {
        setError(result.error || 'Failed to send test email')
      }
      setTimeout(() => {
        setSuccess('')
        setError('')
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test email')
    } finally {
      setTestingEmail(false)
    }
  }

  const handleClearSmsCredentials = async () => {
    if (!organizationId) return
    if (!confirm('Are you sure you want to remove your custom Twilio credentials? SMS will use platform defaults.')) return

    try {
      setSaving(true)
      await api(
        `/api/v1/organizations/${organizationId}/notification-settings/sms-credentials`,
        {
          method: 'DELETE',
          token: session?.accessToken
        }
      )
      await fetchSettings()
      setTwilioAccountSid('')
      setTwilioAuthToken('')
      setTwilioPhoneNumber('')
      setSuccess('Twilio credentials removed')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove credentials')
    } finally {
      setSaving(false)
    }
  }

  const handleClearEmailCredentials = async () => {
    if (!organizationId) return
    if (!confirm('Are you sure you want to remove your custom Resend credentials? Email will use platform defaults.')) return

    try {
      setSaving(true)
      await api(
        `/api/v1/organizations/${organizationId}/notification-settings/email-credentials`,
        {
          method: 'DELETE',
          token: session?.accessToken
        }
      )
      await fetchSettings()
      setResendApiKey('')
      setResendFromEmail('')
      setResendFromName('')
      setSuccess('Resend credentials removed')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove credentials')
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePush = async () => {
    if (!session?.accessToken) return
    setPushToggling(true)
    try {
      if (pushActive) {
        await unsubscribeFromPush(session.accessToken)
        setPushActive(false)
      } else {
        const ok = await subscribeToPush(session.accessToken)
        setPushActive(ok)
        setPushPermission(getPushPermission())
      }
    } finally {
      setPushToggling(false)
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
          <h1 className="text-2xl font-bold text-gray-900">Notification Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure how SMS and email notifications are sent to customers
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
        {/* Browser Push Notifications */}
        {pushSupported && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Browser Push Notifications</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Receive desktop notifications even when this tab isn't active
                </p>
                {pushPermission === 'denied' && (
                  <p className="text-xs text-red-600 mt-2">
                    Notifications are blocked in your browser. Please update your browser settings to allow notifications for this site.
                  </p>
                )}
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={pushActive}
                  onChange={handleTogglePush}
                  disabled={pushToggling || pushPermission === 'denied'}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-disabled:opacity-50"></div>
              </label>
            </div>
          </div>
        )}

        {/* SMS Settings */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">SMS Notifications (Twilio)</h2>
              <p className="text-sm text-gray-500 mt-1">
                Configure SMS notifications sent to customers
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings?.smsEnabled || false}
                onChange={(e) => settings && setSettings({ ...settings, smsEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {settings?.smsEnabled && (
            <div className="p-6 space-y-4">
              {/* Platform vs Custom toggle */}
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={settings?.usePlatformSms || false}
                    onChange={() => settings && setSettings({ ...settings, usePlatformSms: true })}
                    className="w-4 h-4 text-primary"
                  />
                  <span className="font-medium">Use Platform SMS</span>
                  <span className="text-sm text-gray-500">(recommended)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!settings?.usePlatformSms}
                    onChange={() => settings && setSettings({ ...settings, usePlatformSms: false })}
                    className="w-4 h-4 text-primary"
                  />
                  <span className="font-medium">Use Custom Twilio Account</span>
                </label>
              </div>

              {/* Custom Twilio credentials */}
              {!settings?.usePlatformSms && (
                <div className="space-y-4 pt-4 border-t border-gray-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Twilio Account SID
                    </label>
                    <input
                      type="text"
                      value={twilioAccountSid}
                      onChange={(e) => setTwilioAccountSid(e.target.value)}
                      placeholder={settings?.twilioAccountSidMasked || 'AC...'}
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {settings?.hasTwilioCredentials && (
                      <p className="text-xs text-gray-500 mt-1">Leave blank to keep existing credentials</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Twilio Auth Token
                    </label>
                    <div className="relative">
                      <input
                        type={showTwilioToken ? 'text' : 'password'}
                        value={twilioAuthToken}
                        onChange={(e) => setTwilioAuthToken(e.target.value)}
                        placeholder={settings?.hasTwilioCredentials ? '••••••••' : 'Enter auth token'}
                        className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowTwilioToken(!showTwilioToken)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                      >
                        {showTwilioToken ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Twilio Phone Number
                    </label>
                    <input
                      type="tel"
                      value={twilioPhoneNumber}
                      onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                      placeholder="+44..."
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {settings?.hasTwilioCredentials && (
                    <button
                      onClick={handleClearSmsCredentials}
                      disabled={saving}
                      className="px-4 py-2 text-red-700 border border-red-300 font-medium hover:bg-red-50 disabled:opacity-50"
                    >
                      Remove Custom Credentials
                    </button>
                  )}
                </div>
              )}

              {/* Test SMS */}
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Test SMS</h3>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={testPhoneNumber}
                    onChange={(e) => setTestPhoneNumber(e.target.value)}
                    placeholder="+447..."
                    className="flex-1 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={handleTestSms}
                    disabled={testingSms || !testPhoneNumber}
                    className="px-4 py-2 text-gray-700 border border-gray-300 font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    {testingSms ? 'Sending...' : 'Send Test'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Email Settings */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Email Notifications (Resend)</h2>
              <p className="text-sm text-gray-500 mt-1">
                Configure email notifications sent to customers
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings?.emailEnabled || false}
                onChange={(e) => settings && setSettings({ ...settings, emailEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {settings?.emailEnabled && (
            <div className="p-6 space-y-4">
              {/* Platform vs Custom toggle */}
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={settings?.usePlatformEmail || false}
                    onChange={() => settings && setSettings({ ...settings, usePlatformEmail: true })}
                    className="w-4 h-4 text-primary"
                  />
                  <span className="font-medium">Use Platform Email</span>
                  <span className="text-sm text-gray-500">(recommended)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!settings?.usePlatformEmail}
                    onChange={() => settings && setSettings({ ...settings, usePlatformEmail: false })}
                    className="w-4 h-4 text-primary"
                  />
                  <span className="font-medium">Use Custom Resend Account</span>
                </label>
              </div>

              {/* Custom Resend credentials */}
              {!settings?.usePlatformEmail && (
                <div className="space-y-4 pt-4 border-t border-gray-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Resend API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showResendKey ? 'text' : 'password'}
                        value={resendApiKey}
                        onChange={(e) => setResendApiKey(e.target.value)}
                        placeholder={settings?.hasResendCredentials ? '••••••••' : 're_...'}
                        className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowResendKey(!showResendKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                      >
                        {showResendKey ? '🙈' : '👁️'}
                      </button>
                    </div>
                    {settings?.hasResendCredentials && (
                      <p className="text-xs text-gray-500 mt-1">Leave blank to keep existing credentials</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      From Email Address
                    </label>
                    <input
                      type="email"
                      value={resendFromEmail}
                      onChange={(e) => setResendFromEmail(e.target.value)}
                      placeholder="noreply@yourdomain.com"
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      From Name
                    </label>
                    <input
                      type="text"
                      value={resendFromName}
                      onChange={(e) => setResendFromName(e.target.value)}
                      placeholder="Your Company Name"
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {settings?.hasResendCredentials && (
                    <button
                      onClick={handleClearEmailCredentials}
                      disabled={saving}
                      className="px-4 py-2 text-red-700 border border-red-300 font-medium hover:bg-red-50 disabled:opacity-50"
                    >
                      Remove Custom Credentials
                    </button>
                  )}
                </div>
              )}

              {/* Test Email */}
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Test Email</h3>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={testEmailAddress}
                    onChange={(e) => setTestEmailAddress(e.target.value)}
                    placeholder="test@example.com"
                    className="flex-1 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={handleTestEmail}
                    disabled={testingEmail || !testEmailAddress}
                    className="px-4 py-2 text-gray-700 border border-gray-300 font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    {testingEmail ? 'Sending...' : 'Send Test'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Default Notification Settings */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Default Settings</h2>
            <p className="text-sm text-gray-500 mt-1">
              Configure default behavior for customer notifications
            </p>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Link Expiry Time
              </label>
              <select
                value={settings?.defaultLinkExpiryHours || 72}
                onChange={(e) => settings && setSettings({
                  ...settings,
                  defaultLinkExpiryHours: parseInt(e.target.value)
                })}
                className="w-full max-w-xs px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {EXPIRY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                How long customer links remain valid
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="reminderEnabled"
                checked={settings?.defaultReminderEnabled || false}
                onChange={(e) => settings && setSettings({
                  ...settings,
                  defaultReminderEnabled: e.target.checked
                })}
                className="w-4 h-4 text-primary rounded"
              />
              <label htmlFor="reminderEnabled" className="text-sm font-medium text-gray-700">
                Enable automatic reminders
              </label>
            </div>
            <p className="text-xs text-gray-500 ml-7">
              Send reminder notifications if customer hasn't responded
            </p>
          </div>
        </div>

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
