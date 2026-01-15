import { useState } from 'react'
import { api } from '../../../lib/api'

interface Props {
  token: string
  onNext: () => void
  onBack: () => void
}

export default function Step4Notifications({ token, onNext, onBack }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    usePlatformSms: true,
    usePlatformEmail: true,
    defaultLinkExpiryHours: 72,
    defaultReminderEnabled: true
  })

  const handleSubmit = async () => {
    setSaving(true)
    setError('')

    try {
      await api('/api/v1/onboarding/notifications', {
        method: 'POST',
        token,
        body: form
      })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save notification settings')
      setSaving(false)
    }
  }

  const handleSkip = () => {
    onNext()
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Notification Settings</h2>
        <p className="text-gray-500 mt-1">
          Configure how customers receive health check reports. You can adjust these later in Settings.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* SMS Settings */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">SMS Notifications</h3>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.usePlatformSms}
                    onChange={(e) => setForm({ ...form, usePlatformSms: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {form.usePlatformSms
                  ? 'Using VHC platform SMS service (included in your plan)'
                  : 'SMS notifications disabled. You can configure your own Twilio account later.'}
              </p>
            </div>
          </div>
        </div>

        {/* Email Settings */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Email Notifications</h3>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.usePlatformEmail}
                    onChange={(e) => setForm({ ...form, usePlatformEmail: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {form.usePlatformEmail
                  ? 'Using VHC platform email service (included in your plan)'
                  : 'Email notifications disabled. You can configure your own email provider later.'}
              </p>
            </div>
          </div>
        </div>

        {/* Link Expiry */}
        <div className="border-t pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Default Settings</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Health Check Link Expiry
              </label>
              <select
                value={form.defaultLinkExpiryHours}
                onChange={(e) => setForm({ ...form, defaultLinkExpiryHours: parseInt(e.target.value) })}
                className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={72}>72 hours (recommended)</option>
                <option value={168}>1 week</option>
                <option value={720}>30 days</option>
              </select>
              <p className="text-sm text-gray-500 mt-1">
                How long customers can view their health check report
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="reminderEnabled"
                checked={form.defaultReminderEnabled}
                onChange={(e) => setForm({ ...form, defaultReminderEnabled: e.target.checked })}
                className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
              />
              <label htmlFor="reminderEnabled" className="text-sm text-gray-700">
                Send reminder notifications to customers who haven't viewed their report
              </label>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="flex items-start space-x-3">
            <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-800">
              <p className="font-medium">Want to use your own SMS or email provider?</p>
              <p className="mt-1">
                You can configure custom Twilio (SMS) or Resend (email) credentials in Settings after completing onboarding.
                This allows emails to come from your domain and gives you more control.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-6 border-t mt-6">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={handleSkip}
            className="px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
