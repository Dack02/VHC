import { useState, useEffect, useCallback } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface AlertItem {
  id: string
  type: string
  source: string
  organizationName: string | null
  thresholdValue: number | null
  currentValue: number | null
  message: string | null
  createdAt: string
}

interface AlertSetting {
  alertType: string
  isEnabled: boolean
  threshold: number | null
  windowMinutes: number | null
}

interface Recipient {
  id: string
  email: string
  alertTypes: string[]
  isActive: boolean
}

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())

export default function AdminAlerts() {
  const { session } = useSuperAdmin()
  const [view, setView] = useState<'inbox' | 'settings'>('inbox')
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [settings, setSettings] = useState<AlertSetting[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const flash = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text }); setTimeout(() => setMessage(null), 3500)
  }

  const fetchInbox = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const d = await api<{ alerts: AlertItem[] }>('/api/v1/admin/alerts', { token: session.accessToken })
      setAlerts(d.alerts || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [session])

  const fetchSettings = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const d = await api<{ settings: AlertSetting[]; recipients: Recipient[] }>('/api/v1/admin/alerts/settings', { token: session.accessToken })
      setSettings(d.settings || [])
      setRecipients(d.recipients || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [session])

  useEffect(() => {
    setLoading(true)
    if (view === 'inbox') fetchInbox(); else fetchSettings()
  }, [view, fetchInbox, fetchSettings])

  const acknowledge = async (id: string) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/admin/alerts/${id}/acknowledge`, { method: 'POST', token: session.accessToken })
      setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch { flash('error', 'Failed to acknowledge') }
  }

  const updateSetting = (alertType: string, patch: Partial<AlertSetting>) => {
    setSettings((prev) => prev.map((s) => s.alertType === alertType ? { ...s, ...patch } : s))
  }

  const saveSetting = async (s: AlertSetting) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/admin/alerts/settings/${s.alertType}`, {
        method: 'PATCH', token: session.accessToken,
        body: { isEnabled: s.isEnabled, threshold: s.threshold, windowMinutes: s.windowMinutes }
      })
      flash('success', `${humanize(s.alertType)} saved`)
    } catch { flash('error', 'Failed to save') }
  }

  const addRecipient = async () => {
    if (!session?.accessToken || !newEmail) return
    try {
      const r = await api<Recipient>('/api/v1/admin/alerts/recipients', { method: 'POST', token: session.accessToken, body: { email: newEmail } })
      setRecipients((prev) => [...prev, r])
      setNewEmail('')
    } catch (e) { flash('error', e instanceof Error ? e.message : 'Failed to add recipient') }
  }

  const removeRecipient = async (id: string) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/admin/alerts/recipients/${id}`, { method: 'DELETE', token: session.accessToken })
      setRecipients((prev) => prev.filter((r) => r.id !== id))
    } catch { flash('error', 'Failed to remove recipient') }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
        <p className="text-gray-500 mt-1">Platform alert inbox and configuration</p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg ${message.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{message.text}</div>
      )}

      <div className="flex gap-2">
        {([['inbox', 'Inbox'], ['settings', 'Settings']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`px-4 py-2 rounded-lg text-sm font-medium ${view === id ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-500">Loading...</div>
      ) : view === 'inbox' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {alerts.length === 0 ? (
            <div className="py-16 text-center text-gray-500">No unacknowledged alerts 🎉</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {alerts.map((a) => (
                <div key={a.id} className="px-6 py-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">{humanize(a.type)}</span>
                      <span className="text-xs text-gray-400">{a.source}</span>
                    </div>
                    <p className="text-sm text-gray-900 mt-1">{a.message || `${a.currentValue ?? '?'} / threshold ${a.thresholdValue ?? '?'}`}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{a.organizationName || 'Platform'} • {new Date(a.createdAt).toLocaleString('en-GB')}</p>
                  </div>
                  <button onClick={() => acknowledge(a.id)} className="text-sm text-indigo-600 hover:text-indigo-900 whitespace-nowrap">Acknowledge</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Alert type settings */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200"><h2 className="font-semibold text-gray-900">Alert Types</h2></div>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enabled</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Threshold</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Window (min)</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {settings.map((s) => (
                  <tr key={s.alertType}>
                    <td className="px-6 py-3 font-medium text-gray-900">{humanize(s.alertType)}</td>
                    <td className="px-6 py-3">
                      <input type="checkbox" checked={s.isEnabled} onChange={(e) => updateSetting(s.alertType, { isEnabled: e.target.checked })} className="h-4 w-4 text-indigo-600 rounded border-gray-300" />
                    </td>
                    <td className="px-6 py-3">
                      <input type="number" value={s.threshold ?? ''} onChange={(e) => updateSetting(s.alertType, { threshold: e.target.value ? parseFloat(e.target.value) : null })} className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
                    </td>
                    <td className="px-6 py-3">
                      <input type="number" value={s.windowMinutes ?? ''} onChange={(e) => updateSetting(s.alertType, { windowMinutes: e.target.value ? parseInt(e.target.value) : null })} className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => saveSetting(s)} className="text-sm text-indigo-600 hover:text-indigo-900">Save</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recipients */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Alert Recipients</h2>
            <p className="text-sm text-gray-500 mb-4">Emails notified when alerts fire (empty types = all alerts).</p>
            <div className="flex gap-2 mb-4">
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="alerts@example.com" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <button onClick={addRecipient} disabled={!newEmail} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">Add</button>
            </div>
            {recipients.length === 0 ? (
              <p className="text-sm text-gray-400">No recipients configured.</p>
            ) : (
              <div className="space-y-2">
                {recipients.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-700">{r.email}</span>
                    <button onClick={() => removeRecipient(r.id)} className="text-sm text-red-600 hover:text-red-900">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
