import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Recipient {
  id: string
  name: string
  phoneNumber: string
  siteId: string | null
  siteName: string | null
  isActive: boolean
}

interface Site {
  id: string
  name: string
}

interface Settings {
  enabled: boolean
  time: string
}

export default function DailySmsOverview() {
  const { session, user } = useAuth()
  const toast = useToast()
  const orgId = user?.organization?.id

  const [settings, setSettings] = useState<Settings>({ enabled: false, time: '18:00' })
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  // Add/Edit modal state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formSiteId, setFormSiteId] = useState<string>('')
  const [formSaving, setFormSaving] = useState(false)

  useEffect(() => {
    if (orgId && session?.accessToken) {
      fetchAll()
    }
  }, [orgId, session?.accessToken])

  async function fetchAll() {
    setLoading(true)
    try {
      const [settingsData, recipientsData, sitesData] = await Promise.all([
        api<Settings>(`/api/v1/organizations/${orgId}/daily-sms-overview/settings`, { token: session!.accessToken }),
        api<{ recipients: Recipient[] }>(`/api/v1/organizations/${orgId}/daily-sms-overview/recipients`, { token: session!.accessToken }),
        api<{ sites: Site[] }>(`/api/v1/sites`, { token: session!.accessToken })
      ])
      setSettings(settingsData)
      setRecipients(recipientsData.recipients)
      setSites(sitesData.sites || [])
    } catch {
      toast.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleEnabled() {
    const newEnabled = !settings.enabled
    setSaving(true)
    try {
      await api(`/api/v1/organizations/${orgId}/daily-sms-overview/settings`, {
        method: 'PATCH',
        token: session!.accessToken,
        body: { enabled: newEnabled }
      })
      setSettings(prev => ({ ...prev, enabled: newEnabled }))
      toast.success(newEnabled ? 'Daily SMS overview enabled' : 'Daily SMS overview disabled')
    } catch {
      toast.error('Failed to update setting')
    } finally {
      setSaving(false)
    }
  }

  async function handleTimeChange(newTime: string) {
    setSaving(true)
    try {
      await api(`/api/v1/organizations/${orgId}/daily-sms-overview/settings`, {
        method: 'PATCH',
        token: session!.accessToken,
        body: { time: newTime }
      })
      setSettings(prev => ({ ...prev, time: newTime }))
      toast.success('Send time updated')
    } catch {
      toast.error('Failed to update send time')
    } finally {
      setSaving(false)
    }
  }

  async function handleSendNow() {
    setSending(true)
    try {
      await api(`/api/v1/organizations/${orgId}/daily-sms-overview/send-now`, {
        method: 'POST',
        token: session!.accessToken
      })
      toast.success('Daily SMS overview sent')
    } catch {
      toast.error('Failed to send daily SMS overview')
    } finally {
      setSending(false)
    }
  }

  function openAddModal() {
    setEditingId(null)
    setFormName('')
    setFormPhone('')
    setFormSiteId('')
    setShowModal(true)
  }

  function openEditModal(recipient: Recipient) {
    setEditingId(recipient.id)
    setFormName(recipient.name)
    setFormPhone(recipient.phoneNumber)
    setFormSiteId(recipient.siteId || '')
    setShowModal(true)
  }

  async function handleSaveRecipient() {
    if (!formName.trim() || !formPhone.trim()) {
      toast.error('Name and phone number are required')
      return
    }

    setFormSaving(true)
    try {
      if (editingId) {
        await api(`/api/v1/organizations/${orgId}/daily-sms-overview/recipients/${editingId}`, {
          method: 'PATCH',
          token: session!.accessToken,
          body: { name: formName, phoneNumber: formPhone, siteId: formSiteId || null }
        })
        toast.success('Recipient updated')
      } else {
        await api(`/api/v1/organizations/${orgId}/daily-sms-overview/recipients`, {
          method: 'POST',
          token: session!.accessToken,
          body: { name: formName, phoneNumber: formPhone, siteId: formSiteId || null }
        })
        toast.success('Recipient added')
      }
      setShowModal(false)
      fetchAll()
    } catch {
      toast.error('Failed to save recipient')
    } finally {
      setFormSaving(false)
    }
  }

  async function handleToggleActive(recipient: Recipient) {
    try {
      await api(`/api/v1/organizations/${orgId}/daily-sms-overview/recipients/${recipient.id}`, {
        method: 'PATCH',
        token: session!.accessToken,
        body: { isActive: !recipient.isActive }
      })
      setRecipients(prev => prev.map(r => r.id === recipient.id ? { ...r, isActive: !r.isActive } : r))
    } catch {
      toast.error('Failed to update recipient')
    }
  }

  async function handleDelete(recipientId: string) {
    if (!confirm('Remove this recipient?')) return
    try {
      await api(`/api/v1/organizations/${orgId}/daily-sms-overview/recipients/${recipientId}`, {
        method: 'DELETE',
        token: session!.accessToken
      })
      setRecipients(prev => prev.filter(r => r.id !== recipientId))
      toast.success('Recipient removed')
    } catch {
      toast.error('Failed to remove recipient')
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <SettingsBackLink />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <SettingsBackLink />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Daily SMS Overview</h1>
        <p className="text-gray-600 mt-1">Configure end-of-day SMS summary sent to managers with per-site VHC metrics.</p>
      </div>

      {/* Enable toggle + time */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Enable Daily SMS</h2>
            <p className="text-sm text-gray-500">Send an end-of-day SMS summary Mon-Sat</p>
          </div>
          <button
            onClick={handleToggleEnabled}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.enabled ? 'bg-primary' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {settings.enabled && (
          <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
            <label className="text-sm font-medium text-gray-700">Send time</label>
            <input
              type="time"
              value={settings.time}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              disabled={saving}
            />
            <span className="text-xs text-gray-400">Europe/London timezone</span>
          </div>
        )}
      </div>

      {/* Recipients */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recipients</h2>
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Add Recipient
          </button>
        </div>

        {recipients.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No recipients configured. Add a recipient to start receiving daily SMS summaries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-600">Name</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-600">Phone</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-600">Site</th>
                  <th className="text-center py-3 px-2 font-medium text-gray-600">Active</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 px-2 font-medium text-gray-900">{r.name}</td>
                    <td className="py-3 px-2 text-gray-600">{r.phoneNumber}</td>
                    <td className="py-3 px-2 text-gray-600">{r.siteName || 'All Sites'}</td>
                    <td className="py-3 px-2 text-center">
                      <button
                        onClick={() => handleToggleActive(r)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          r.isActive ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            r.isActive ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <button onClick={() => openEditModal(r)} className="text-primary hover:text-primary/80 mr-3 text-sm">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:text-red-700 text-sm">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Send Now */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Test Send</h2>
            <p className="text-sm text-gray-500">Manually trigger the daily SMS overview now for testing</p>
          </div>
          <button
            onClick={handleSendNow}
            disabled={sending || recipients.length === 0}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending...' : 'Send Now'}
          </button>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {editingId ? 'Edit Recipient' : 'Add Recipient'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. John Smith"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={e => setFormPhone(e.target.value)}
                    placeholder="e.g. 07700 900123"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Site</label>
                  <select
                    value={formSiteId}
                    onChange={e => setFormSiteId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">All Sites</option>
                    {sites.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRecipient}
                  disabled={formSaving}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {formSaving ? 'Saving...' : editingId ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
