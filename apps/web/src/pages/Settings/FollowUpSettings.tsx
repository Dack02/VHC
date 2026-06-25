import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface SettingsData {
  enabled: boolean
  autoSweepEnabled: boolean
  simulationMode: boolean
  sendWindowEnabled: boolean
  sendWindowStart: string
  sendWindowEnd: string
  skipWeekends: boolean
  timezone: string
}

interface StatusData {
  lastSweptAt: string | null
  activeCases: number
  manualCases: number
  bookingFoundCases: number
  engagedCases: number
  openCases: number
}

interface RunResult {
  success?: boolean
  casesCreated?: number
  casesProcessed?: number
  orgsSwept?: number
  dryRun?: boolean
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-primary' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function FollowUpSettings() {
  const { session, user } = useAuth()
  const toast = useToast()
  const orgId = user?.organization?.id

  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [status, setStatus] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)

  const [testPhone, setTestPhone] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [testingSms, setTestingSms] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)

  useEffect(() => {
    if (orgId && session?.accessToken) fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, session?.accessToken])

  async function fetchAll() {
    setLoading(true)
    try {
      const data = await api<{ settings: SettingsData; status: StatusData }>(
        `/api/v1/organizations/${orgId}/follow-up-settings/settings`,
        { token: session!.accessToken }
      )
      setSettings(data.settings)
      setStatus(data.status)
    } catch {
      toast.error('Failed to load follow-up settings')
    } finally {
      setLoading(false)
    }
  }

  async function patchSettings(patch: Partial<SettingsData>, successMsg?: string) {
    if (!settings) return
    const prev = settings
    setSettings({ ...settings, ...patch }) // optimistic
    setSaving(true)
    try {
      await api(`/api/v1/organizations/${orgId}/follow-up-settings/settings`, {
        method: 'PATCH',
        token: session!.accessToken,
        body: patch,
      })
      if (successMsg) toast.success(successMsg)
    } catch (e) {
      setSettings(prev) // revert
      toast.error(e instanceof ApiError ? e.message : 'Failed to update setting')
    } finally {
      setSaving(false)
    }
  }

  async function handleRunNow() {
    setRunning(true)
    try {
      const res = await api<RunResult>(`/api/v1/follow-ups/run-sweep`, {
        method: 'POST',
        token: session!.accessToken,
      })
      const created = res.casesCreated ?? 0
      const processed = res.casesProcessed ?? 0
      if (res.dryRun) {
        toast.success(`Simulation run complete — ${processed} case(s) processed, ${created} new (no messages sent)`)
      } else {
        toast.success(`Sweep complete — ${created} new case(s), ${processed} processed`)
      }
      fetchAll()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to run sweep')
    } finally {
      setRunning(false)
    }
  }

  async function handleTestSms() {
    if (!testPhone.trim()) return
    setTestingSms(true)
    try {
      const res = await api<{ success: boolean; message?: string; error?: string }>(
        `/api/v1/organizations/${orgId}/follow-up-settings/test-sms`,
        { method: 'POST', token: session!.accessToken, body: { to: testPhone.trim() } }
      )
      if (res.success) toast.success(res.message || 'Test SMS sent')
      else toast.error(res.error || 'Failed to send test SMS')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to send test SMS')
    } finally {
      setTestingSms(false)
    }
  }

  async function handleTestEmail() {
    if (!testEmail.trim()) return
    setTestingEmail(true)
    try {
      const res = await api<{ success: boolean; message?: string; error?: string }>(
        `/api/v1/organizations/${orgId}/follow-up-settings/test-email`,
        { method: 'POST', token: session!.accessToken, body: { to: testEmail.trim() } }
      )
      if (res.success) toast.success(res.message || 'Test email sent')
      else toast.error(res.error || 'Failed to send test email')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to send test email')
    } finally {
      setTestingEmail(false)
    }
  }

  if (loading || !settings) {
    return (
      <div className="max-w-4xl mx-auto">
        <SettingsBackLink />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </div>
    )
  }

  const lastSwept = status?.lastSweptAt ? new Date(status.lastSweptAt).toLocaleString('en-GB') : 'Never'

  return (
    <div className="max-w-4xl mx-auto">
      <SettingsBackLink />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Follow-Up Settings</h1>
        <p className="text-gray-600 mt-1">
          Control the deferred-work recovery automation: when it runs, when it&apos;s allowed to message
          customers, and a safe way to preview what they receive. Edit the actual messages and cadence in{' '}
          <Link to="/settings/follow-up-timelines" className="text-primary hover:underline">Follow-Up Timelines</Link>.
        </p>
      </div>

      {/* Master enable */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Enable follow-up automation</h2>
            <p className="text-sm text-gray-500">
              When off, no follow-up cases are created or chased for this organisation.
            </p>
          </div>
          <Toggle
            on={settings.enabled}
            disabled={saving}
            onClick={() => patchSettings({ enabled: !settings.enabled }, !settings.enabled ? 'Follow-up automation enabled' : 'Follow-up automation disabled')}
          />
        </div>
        {settings.enabled && !settings.simulationMode && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Tip: turn on <strong>Simulation mode</strong> below first to preview what would be sent — without
            actually messaging any customers — before going live.
          </p>
        )}
      </div>

      {settings.enabled && (
        <>
          {/* Automation behaviour */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Automation</h2>

            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <div className="text-sm font-medium text-gray-700">Automatic daily sweep</div>
                <div className="text-xs text-gray-500">
                  Run the recovery automatically through the day. When off, cases are only created and chased
                  when you click <strong>Run sweep now</strong>.
                </div>
              </div>
              <Toggle
                on={settings.autoSweepEnabled}
                disabled={saving}
                onClick={() => patchSettings({ autoSweepEnabled: !settings.autoSweepEnabled }, 'Saved')}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-gray-700">Simulation mode (dry run)</div>
                <div className="text-xs text-gray-500">
                  The sweep renders and logs every message it would send, but never actually sends. Great for a
                  safe trial before going live.
                </div>
              </div>
              <Toggle
                on={settings.simulationMode}
                disabled={saving}
                onClick={() => patchSettings({ simulationMode: !settings.simulationMode }, settings.simulationMode ? 'Simulation mode off — messages will be sent' : 'Simulation mode on — no messages will be sent')}
              />
            </div>
          </div>

          {/* Send window / quiet hours */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Send window (quiet hours)</h2>
                <p className="text-sm text-gray-500">
                  Only message customers within set hours, in your timezone ({settings.timezone}). Outside the
                  window, sends wait until it next opens.
                </p>
              </div>
              <Toggle
                on={settings.sendWindowEnabled}
                disabled={saving}
                onClick={() => patchSettings({ sendWindowEnabled: !settings.sendWindowEnabled }, 'Saved')}
              />
            </div>

            {settings.sendWindowEnabled && (
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-sm font-medium text-gray-700 w-40">Allowed between</label>
                  <input
                    type="time"
                    value={settings.sendWindowStart}
                    onChange={e => setSettings({ ...settings, sendWindowStart: e.target.value })}
                    onBlur={e => patchSettings({ sendWindowStart: e.target.value }, 'Send window updated')}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    disabled={saving}
                  />
                  <span className="text-sm text-gray-500">and</span>
                  <input
                    type="time"
                    value={settings.sendWindowEnd}
                    onChange={e => setSettings({ ...settings, sendWindowEnd: e.target.value })}
                    onBlur={e => patchSettings({ sendWindowEnd: e.target.value }, 'Send window updated')}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    disabled={saving}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-700">Skip weekends</div>
                    <div className="text-xs text-gray-500">Don&apos;t message customers on Saturdays or Sundays</div>
                  </div>
                  <Toggle
                    on={settings.skipWeekends}
                    disabled={saving}
                    onClick={() => patchSettings({ skipWeekends: !settings.skipWeekends }, 'Saved')}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Status + run now */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Status</h2>
              <button
                onClick={handleRunNow}
                disabled={running}
                className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {running ? 'Running…' : 'Run sweep now'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Open cases" value={status?.openCases ?? 0} />
              <Stat label="Active" value={status?.activeCases ?? 0} />
              <Stat label="Awaiting call" value={status?.manualCases ?? 0} />
              <Stat label="Booking found" value={status?.bookingFoundCases ?? 0} />
            </div>
            <p className="text-xs text-gray-400 mt-4">
              Last run: {lastSwept}. The sweep runs automatically every ~30 minutes when enabled.
            </p>
          </div>

          {/* Test send */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900">Test send</h2>
            <p className="text-sm text-gray-500 mb-4">
              Sends a sample of your <em>actual</em> follow-up message (from your default timeline, with your
              branding and sample data) so you can verify templates, branding and credentials. Test sends ignore
              simulation mode and the send window.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sample SMS</label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={testPhone}
                    onChange={e => setTestPhone(e.target.value)}
                    placeholder="+447…"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    onClick={handleTestSms}
                    disabled={testingSms || !testPhone.trim()}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {testingSms ? 'Sending…' : 'Send test'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sample email</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    placeholder="you@dealership.co.uk"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    onClick={handleTestEmail}
                    disabled={testingEmail || !testEmail.trim()}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {testingEmail ? 'Sending…' : 'Send test'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}
