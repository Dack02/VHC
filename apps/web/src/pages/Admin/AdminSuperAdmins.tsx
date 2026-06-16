import { useState, useEffect } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'
import CreateSuperAdminModal from '../../components/admin/CreateSuperAdminModal'

interface SuperAdminRow {
  id: string
  email: string
  name: string
  phone: string | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  deactivatedAt: string | null
  isYou: boolean
}

interface ImpSession {
  id: string
  superAdmin: { name: string; email: string } | null
  targetName: string | null
  targetEmail: string | null
  organizationName: string | null
  reason: string
  startedAt: string
  status: string
  active: boolean
}

export default function AdminSuperAdmins() {
  const { session } = useSuperAdmin()
  const [admins, setAdmins] = useState<SuperAdminRow[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [sessions, setSessions] = useState<ImpSession[]>([])
  const [editingPhone, setEditingPhone] = useState<string | null>(null)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)

  const fetchAdmins = async () => {
    if (!session?.accessToken) return
    try {
      const data = await api<{ superAdmins: SuperAdminRow[]; activeCount: number }>('/api/v1/admin/super-admins', { token: session.accessToken })
      setAdmins(data.superAdmins || [])
      setActiveCount(data.activeCount || 0)
    } catch (e) {
      console.error('Failed to fetch super admins:', e)
    } finally {
      setLoading(false)
    }
  }

  const fetchSessions = async () => {
    if (!session?.accessToken) return
    try {
      const data = await api<{ sessions: ImpSession[] }>('/api/v1/admin/impersonate/sessions', { token: session.accessToken })
      setSessions(data.sessions || [])
    } catch (e) {
      console.error('Failed to fetch impersonation sessions:', e)
    }
  }

  const revokeSession = async (id: string) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/admin/impersonate/sessions/${id}/revoke`, { method: 'POST', token: session.accessToken })
      flash('success', 'Session revoked')
      fetchSessions()
    } catch {
      flash('error', 'Failed to revoke')
    }
  }

  useEffect(() => { fetchAdmins(); fetchSessions() }, [session])

  const flash = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const doAction = async (id: string, action: 'deactivate' | 'reactivate' | 'resend-invite') => {
    if (!session?.accessToken) return
    setActioning(id)
    try {
      await api(`/api/v1/admin/super-admins/${id}/${action}`, { method: 'POST', token: session.accessToken })
      flash('success', action === 'resend-invite' ? 'Invite re-sent' : action === 'reactivate' ? 'Reactivated' : 'Deactivated')
      fetchAdmins()
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActioning(null)
    }
  }

  const startEditPhone = (a: SuperAdminRow) => {
    setEditingPhone(a.id)
    setPhoneDraft(a.phone || '')
  }

  const savePhone = async (id: string) => {
    if (!session?.accessToken) return
    setSavingPhone(true)
    try {
      await api(`/api/v1/admin/super-admins/${id}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { phone: phoneDraft.trim() }
      })
      setEditingPhone(null)
      flash('success', phoneDraft.trim() ? 'Mobile number saved' : 'Mobile number removed')
      fetchAdmins()
    } catch (e) {
      flash('error', e instanceof Error ? e.message : 'Failed to save mobile number')
    } finally {
      setSavingPhone(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-500">Loading super admins...</div></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Super Admins</h1>
          <p className="text-gray-500 mt-1">Manage platform super-administrator accounts</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
          New Super Admin
        </button>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg ${message.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mobile</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Login</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {admins.map((a) => {
              const cannotDeactivate = a.isYou || (a.isActive && activeCount <= 1)
              return (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className="font-medium text-gray-900">{a.name}</span>
                    {a.isYou && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">You</span>}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{a.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {editingPhone === a.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="tel"
                          value={phoneDraft}
                          onChange={(e) => setPhoneDraft(e.target.value)}
                          placeholder="+447700900123"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') savePhone(a.id); if (e.key === 'Escape') setEditingPhone(null) }}
                          className="w-40 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button onClick={() => savePhone(a.id)} disabled={savingPhone} className="text-indigo-600 hover:text-indigo-900 text-xs font-medium disabled:opacity-50">Save</button>
                        <button onClick={() => setEditingPhone(null)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={a.phone ? 'text-gray-700' : 'text-gray-400'}>{a.phone || '—'}</span>
                        <button onClick={() => startEditPhone(a)} className="text-indigo-600 hover:text-indigo-900 text-xs">{a.phone ? 'Edit' : 'Add'}</button>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${a.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {a.isActive ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('en-GB') : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-right text-sm space-x-3 whitespace-nowrap">
                    <button
                      onClick={() => doAction(a.id, 'resend-invite')}
                      disabled={actioning === a.id}
                      className="text-indigo-600 hover:text-indigo-900 disabled:opacity-50"
                    >
                      Resend invite
                    </button>
                    {a.isActive ? (
                      <button
                        onClick={() => doAction(a.id, 'deactivate')}
                        disabled={actioning === a.id || cannotDeactivate}
                        title={cannotDeactivate ? (a.isYou ? 'You cannot deactivate yourself' : 'Cannot deactivate the last active super admin') : ''}
                        className="text-red-600 hover:text-red-900 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => doAction(a.id, 'reactivate')}
                        disabled={actioning === a.id}
                        className="text-green-600 hover:text-green-900 disabled:opacity-50"
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 -mt-3">
        Mobile numbers above receive an SMS whenever a new organisation signs up.
      </p>

      {sessions.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Impersonation Sessions</h2>
            <p className="text-sm text-gray-500 mt-0.5">Active and recent (last 50). Expiry is client-enforced; revoke ends a session server-side.</p>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="px-6 py-3 text-sm text-gray-700">{s.superAdmin?.name || '—'}</td>
                  <td className="px-6 py-3 text-sm text-gray-900">{s.targetName || s.targetEmail}<div className="text-xs text-gray-400">{s.organizationName}</div></td>
                  <td className="px-6 py-3 text-sm text-gray-500 max-w-xs truncate" title={s.reason}>{s.reason}</td>
                  <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">{new Date(s.startedAt).toLocaleString('en-GB')}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{s.status}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    {s.active && <button onClick={() => revokeSession(s.id)} className="text-sm text-red-600 hover:text-red-900">Revoke</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateSuperAdminModal
          onClose={() => setShowCreate(false)}
          onCreated={(inviteSent) => {
            setShowCreate(false)
            flash('success', inviteSent ? 'Super admin created — invite email sent' : 'Super admin created (invite not sent; check server logs for the set-password link)')
            fetchAdmins()
          }}
        />
      )}
    </div>
  )
}
