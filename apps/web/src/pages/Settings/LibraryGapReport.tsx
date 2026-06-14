import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Recipient {
  id: string
  name: string
  email: string
  userId: string | null
  isActive: boolean
}

interface OrgUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
}

interface Settings {
  enabled: boolean
  time: string
  skipEmpty: boolean
}

export default function LibraryGapReport() {
  const { session, user } = useAuth()
  const toast = useToast()
  const orgId = user?.organization?.id

  const [settings, setSettings] = useState<Settings>({ enabled: false, time: '07:00', skipEmpty: true })
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  // Add/Edit modal state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [mode, setMode] = useState<'staff' | 'email'>('staff')
  const [formUserId, setFormUserId] = useState('')
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formSaving, setFormSaving] = useState(false)

  useEffect(() => {
    if (orgId && session?.accessToken) fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, session?.accessToken])

  async function fetchAll() {
    setLoading(true)
    try {
      const [settingsData, recipientsData, usersData] = await Promise.all([
        api<Settings>(`/api/v1/organizations/${orgId}/library-gap-report/settings`, { token: session!.accessToken }),
        api<{ recipients: Recipient[] }>(`/api/v1/organizations/${orgId}/library-gap-report/recipients`, { token: session!.accessToken }),
        api<{ users: OrgUser[] }>(`/api/v1/users?limit=200`, { token: session!.accessToken })
      ])
      setSettings(settingsData)
      setRecipients(recipientsData.recipients)
      setOrgUsers(usersData.users || [])
    } catch {
      toast.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  async function patchSettings(patch: Partial<Settings>, successMsg?: string) {
    setSaving(true)
    try {
      await api(`/api/v1/organizations/${orgId}/library-gap-report/settings`, {
        method: 'PATCH',
        token: session!.accessToken,
        body: patch
      })
      setSettings(prev => ({ ...prev, ...patch }))
      if (successMsg) toast.success(successMsg)
    } catch {
      toast.error('Failed to update setting')
    } finally {
      setSaving(false)
    }
  }

  function openAddModal() {
    setEditingId(null)
    setMode(orgUsers.length > 0 ? 'staff' : 'email')
    setFormUserId('')
    setFormName('')
    setFormEmail('')
    setShowModal(true)
  }

  function openEditModal(r: Recipient) {
    setEditingId(r.id)
    setMode('email')
    setFormUserId('')
    setFormName(r.name)
    setFormEmail(r.email)
    setShowModal(true)
  }

  async function handleSaveRecipient() {
    let name = formName.trim()
    let email = formEmail.trim()
    let userId: string | null = null

    if (!editingId && mode === 'staff') {
      const u = orgUsers.find(x => x.id === formUserId)
      if (!u) {
        toast.error('Please select a staff member')
        return
      }
      name = `${u.firstName} ${u.lastName}`.trim()
      email = u.email
      userId = u.id
    }

    if (!name || !email) {
      toast.error('Name and email are required')
      return
    }

    setFormSaving(true)
    try {
      if (editingId) {
        await api(`/api/v1/organizations/${orgId}/library-gap-report/recipients/${editingId}`, {
          method: 'PATCH',
          token: session!.accessToken,
          body: { name, email }
        })
        toast.success('Recipient updated')
      } else {
        await api(`/api/v1/organizations/${orgId}/library-gap-report/recipients`, {
          method: 'POST',
          token: session!.accessToken,
          body: { name, email, userId }
        })
        toast.success('Recipient added')
      }
      setShowModal(false)
      fetchAll()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save recipient')
    } finally {
      setFormSaving(false)
    }
  }

  async function handleToggleActive(r: Recipient) {
    try {
      await api(`/api/v1/organizations/${orgId}/library-gap-report/recipients/${r.id}`, {
        method: 'PATCH',
        token: session!.accessToken,
        body: { isActive: !r.isActive }
      })
      setRecipients(prev => prev.map(x => (x.id === r.id ? { ...x, isActive: !x.isActive } : x)))
    } catch {
      toast.error('Failed to update recipient')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this recipient?')) return
    try {
      await api(`/api/v1/organizations/${orgId}/library-gap-report/recipients/${id}`, {
        method: 'DELETE',
        token: session!.accessToken
      })
      setRecipients(prev => prev.filter(x => x.id !== id))
      toast.success('Recipient removed')
    } catch {
      toast.error('Failed to remove recipient')
    }
  }

  async function handleSendNow() {
    setSending(true)
    try {
      await api(`/api/v1/organizations/${orgId}/library-gap-report/send-now`, {
        method: 'POST',
        token: session!.accessToken
      })
      toast.success('Test report sent to active recipients')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to send report')
    } finally {
      setSending(false)
    }
  }

  // Staff already chosen as a recipient (by user_id) shouldn't appear again in the picker.
  const usedUserIds = new Set(recipients.map(r => r.userId).filter(Boolean) as string[])
  const availableUsers = orgUsers.filter(u => !usedUserIds.has(u.id))

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
        <h1 className="text-2xl font-bold text-gray-900">Library Gap Report</h1>
        <p className="text-gray-600 mt-1">
          A daily email of red/amber findings where a technician typed notes manually instead of using the
          Reason Library, plus any reasons submitted for review. Covers the previous day &mdash; use it to spot
          new library entries and coach the team.
        </p>
      </div>

      {/* Enable toggle + time + skip-empty */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Enable daily report</h2>
            <p className="text-sm text-gray-500">Email the digest each morning to the recipients below</p>
          </div>
          <button
            onClick={() => patchSettings({ enabled: !settings.enabled }, !settings.enabled ? 'Library Gap Report enabled' : 'Library Gap Report disabled')}
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
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 w-40">Send time</label>
              <input
                type="time"
                value={settings.time}
                onChange={e => patchSettings({ time: e.target.value })}
                onBlur={() => toast.success('Send time updated')}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                disabled={saving}
              />
              <span className="text-xs text-gray-400">Organisation timezone</span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Skip empty days</div>
                <div className="text-xs text-gray-500">Don&apos;t send an email on days with nothing to report</div>
              </div>
              <button
                onClick={() => patchSettings({ skipEmpty: !settings.skipEmpty })}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.skipEmpty ? 'bg-primary' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.skipEmpty ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
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
          <p className="text-gray-500 text-sm py-8 text-center">
            No recipients configured. Add a workshop manager to start receiving the daily report.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-600">Name</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-600">Email</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-600">Type</th>
                  <th className="text-center py-3 px-2 font-medium text-gray-600">Active</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 px-2 font-medium text-gray-900">{r.name}</td>
                    <td className="py-3 px-2 text-gray-600">{r.email}</td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.userId ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                        {r.userId ? 'Staff' : 'Email'}
                      </span>
                    </td>
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

      {/* Test Send */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Test Send</h2>
            <p className="text-sm text-gray-500">Send the report now (covering yesterday) to active recipients</p>
          </div>
          <button
            onClick={handleSendNow}
            disabled={sending || recipients.filter(r => r.isActive).length === 0}
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

              {/* Mode toggle (add only) */}
              {!editingId && (
                <div className="flex rounded-lg border border-gray-200 p-1 mb-4">
                  <button
                    onClick={() => setMode('staff')}
                    className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'staff' ? 'bg-primary text-white' : 'text-gray-600'}`}
                  >
                    Staff member
                  </button>
                  <button
                    onClick={() => setMode('email')}
                    className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'email' ? 'bg-primary text-white' : 'text-gray-600'}`}
                  >
                    Email address
                  </button>
                </div>
              )}

              <div className="space-y-4">
                {!editingId && mode === 'staff' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Staff member</label>
                    <select
                      value={formUserId}
                      onChange={e => setFormUserId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Select a staff member…</option>
                      {availableUsers.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName} ({u.email})
                        </option>
                      ))}
                    </select>
                    {availableUsers.length === 0 && (
                      <p className="text-xs text-gray-400 mt-1">All staff are already recipients. Use &ldquo;Email address&rdquo; to add others.</p>
                    )}
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                      <input
                        type="text"
                        value={formName}
                        onChange={e => setFormName(e.target.value)}
                        placeholder="e.g. Workshop Manager"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={formEmail}
                        onChange={e => setFormEmail(e.target.value)}
                        placeholder="e.g. manager@dealership.co.uk"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                )}
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
