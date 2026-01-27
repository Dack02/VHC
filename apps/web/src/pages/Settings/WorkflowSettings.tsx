/**
 * Workflow Settings
 * Configure check-in procedures and MRI scan settings
 */

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface CheckinSettings {
  checkinEnabled: boolean
  showMileageIn: boolean
  showTimeRequired: boolean
  showKeyLocation: boolean
  checkinTimeoutMinutes: number
}

export default function WorkflowSettings() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [settings, setSettings] = useState<CheckinSettings>({
    checkinEnabled: false,
    showMileageIn: true,
    showTimeRequired: true,
    showKeyLocation: true,
    checkinTimeoutMinutes: 20,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [originalSettings, setOriginalSettings] = useState<CheckinSettings | null>(null)

  const organizationId = user?.organization?.id

  const fetchSettings = useCallback(async () => {
    if (!organizationId || !session?.accessToken) return

    try {
      setLoading(true)
      const data = await api<CheckinSettings>(
        `/api/v1/organizations/${organizationId}/checkin-settings`,
        { token: session.accessToken }
      )
      setSettings(data)
      setOriginalSettings(data)
    } catch (err) {
      console.error('Failed to load check-in settings:', err)
      toast.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [organizationId, session?.accessToken, toast])

  useEffect(() => {
    if (organizationId) {
      fetchSettings()
    }
  }, [organizationId, fetchSettings])

  useEffect(() => {
    if (originalSettings) {
      const changed =
        settings.checkinEnabled !== originalSettings.checkinEnabled ||
        settings.showMileageIn !== originalSettings.showMileageIn ||
        settings.showTimeRequired !== originalSettings.showTimeRequired ||
        settings.showKeyLocation !== originalSettings.showKeyLocation ||
        settings.checkinTimeoutMinutes !== originalSettings.checkinTimeoutMinutes
      setHasChanges(changed)
    }
  }, [settings, originalSettings])

  const handleSave = async () => {
    if (!organizationId || !session?.accessToken) return

    try {
      setSaving(true)
      const data = await api<CheckinSettings>(
        `/api/v1/organizations/${organizationId}/checkin-settings`,
        {
          method: 'PATCH',
          body: settings,
          token: session.accessToken
        }
      )
      setSettings(data)
      setOriginalSettings(data)
      setHasChanges(false)
      toast.success('Workflow settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflow Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure check-in procedures and vehicle inspection workflow
          </p>
        </div>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Check-In Procedure Toggle */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Check-In Procedure</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Enable vehicle check-in with MRI (Manufacturer Recommended Items) scan
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.checkinEnabled}
                  onChange={(e) => setSettings({
                    ...settings,
                    checkinEnabled: e.target.checked
                  })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
          <div className="p-6">
            <div className="bg-blue-50 border border-blue-200 p-4 mb-4">
              <h3 className="text-sm font-semibold text-blue-800 mb-2">What does this do?</h3>
              <ul className="text-sm text-blue-700 space-y-2 list-disc list-inside">
                <li>Adds an <strong>"Awaiting Check-In"</strong> status for vehicles that have arrived</li>
                <li>Service advisors complete a check-in form when the customer drops off the vehicle</li>
                <li>MRI scan captures manufacturer service intervals, recall status, and key items</li>
                <li>Flagged MRI items automatically create repair items for technician review</li>
                <li>Check-In and MRI tabs appear in the health check detail view</li>
              </ul>
            </div>

            {settings.checkinEnabled && (
              <Link
                to="/settings/mri-items"
                className="inline-flex items-center gap-2 text-primary hover:text-primary-dark font-medium"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Configure MRI Items
              </Link>
            )}
          </div>
        </div>

        {/* Check-In Form Options */}
        {settings.checkinEnabled && (
          <div className="bg-white border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Check-In Form Options</h2>
              <p className="text-sm text-gray-500 mt-1">
                Configure which fields appear on the check-in form
              </p>
            </div>
            <div className="p-6 space-y-4">
              <label className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-900">Show Mileage In</span>
                  <p className="text-sm text-gray-500">Record vehicle mileage at check-in</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showMileageIn}
                  onChange={(e) => setSettings({
                    ...settings,
                    showMileageIn: e.target.checked
                  })}
                  className="w-5 h-5 text-primary border-gray-300 rounded focus:ring-primary"
                />
              </label>

              <label className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-900">Show Time Required</span>
                  <p className="text-sm text-gray-500">Estimate time needed for the job</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showTimeRequired}
                  onChange={(e) => setSettings({
                    ...settings,
                    showTimeRequired: e.target.checked
                  })}
                  className="w-5 h-5 text-primary border-gray-300 rounded focus:ring-primary"
                />
              </label>

              <label className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-900">Show Key Location</span>
                  <p className="text-sm text-gray-500">Record where vehicle keys are stored</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showKeyLocation}
                  onChange={(e) => setSettings({
                    ...settings,
                    showKeyLocation: e.target.checked
                  })}
                  className="w-5 h-5 text-primary border-gray-300 rounded focus:ring-primary"
                />
              </label>
            </div>
          </div>
        )}

        {/* Dashboard Alert Timeout */}
        {settings.checkinEnabled && (
          <div className="bg-white border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Dashboard Alert Timeout</h2>
              <p className="text-sm text-gray-500 mt-1">
                Time before vehicles awaiting check-in show an alert on the dashboard
              </p>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="5"
                  max="120"
                  value={settings.checkinTimeoutMinutes}
                  onChange={(e) => setSettings({
                    ...settings,
                    checkinTimeoutMinutes: parseInt(e.target.value) || 20
                  })}
                  className="w-24 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary text-right"
                />
                <span className="text-gray-700 font-medium">minutes</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Vehicles awaiting check-in for longer than this time will be highlighted on the dashboard.
              </p>
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="flex justify-end gap-3">
          {hasChanges && (
            <button
              onClick={() => {
                if (originalSettings) {
                  setSettings(originalSettings)
                }
              }}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="bg-primary text-white px-6 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
