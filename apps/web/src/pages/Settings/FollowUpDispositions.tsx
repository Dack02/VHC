import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Disposition {
  id: string
  name: string
  description: string | null
  snoozeDays: number | null
  isActive: boolean
  isSystem: boolean
  sortOrder: number
}

export default function FollowUpDispositions() {
  const { session, user } = useAuth()
  const toast = useToast()
  const organizationId = user?.organization?.id

  const [items, setItems] = useState<Disposition[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Disposition | null>(null)
  const [form, setForm] = useState({ name: '', description: '', snoozeDays: '' })
  const [formError, setFormError] = useState('')

  useEffect(() => { if (organizationId) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId])

  const load = async () => {
    if (!organizationId) return
    try {
      setLoading(true)
      const data = await api<{ dispositions: Disposition[] }>(`/api/v1/organizations/${organizationId}/follow-up-dispositions`, { token: session?.accessToken })
      if (!data.dispositions || data.dispositions.length === 0) {
        // The seed RPC (exposed on the outcomes route) seeds dispositions too
        await api(`/api/v1/organizations/${organizationId}/follow-up-outcomes/seed-defaults`, { method: 'POST', token: session?.accessToken }).catch(() => {})
        const seeded = await api<{ dispositions: Disposition[] }>(`/api/v1/organizations/${organizationId}/follow-up-dispositions`, { token: session?.accessToken })
        setItems(seeded.dispositions || [])
      } else {
        setItems(data.dispositions)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load dispositions')
    } finally {
      setLoading(false)
    }
  }

  const openModal = (d?: Disposition) => {
    setEditing(d || null)
    setForm(d ? { name: d.name, description: d.description || '', snoozeDays: d.snoozeDays != null ? String(d.snoozeDays) : '' } : { name: '', description: '', snoozeDays: '' })
    setFormError('')
    setShowModal(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!organizationId) return
    if (!form.name.trim()) { setFormError('Name is required'); return }
    try {
      setSaving(true)
      const body = { name: form.name.trim(), description: form.description.trim() || null, snooze_days: form.snoozeDays === '' ? null : Number(form.snoozeDays) }
      if (editing) {
        await api(`/api/v1/organizations/${organizationId}/follow-up-dispositions/${editing.id}`, { method: 'PATCH', body, token: session?.accessToken })
        toast.success('Disposition updated')
      } else {
        await api(`/api/v1/organizations/${organizationId}/follow-up-dispositions`, { method: 'POST', body, token: session?.accessToken })
        toast.success('Disposition created')
      }
      setShowModal(false)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (d: Disposition) => {
    if (!organizationId || d.isSystem) return
    if (!confirm(`Delete "${d.name}"?`)) return
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-dispositions/${d.id}`, { method: 'DELETE', token: session?.accessToken })
      toast.success('Disposition deleted')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }

  return (
    <div>
      <SettingsBackLink />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Call Dispositions</h1>
          <p className="text-sm text-gray-500 mt-1">Interim outcomes of a follow-up call. A snooze re-surfaces the case after N days.</p>
        </div>
        <button onClick={() => openModal()} className="bg-primary text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-dark">Add Disposition</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Snooze</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">{d.name}</td>
                <td className="px-6 py-4 text-gray-700">{d.description || <span className="text-gray-400">-</span>}</td>
                <td className="px-6 py-4 text-center text-gray-700">{d.snoozeDays != null ? `${d.snoozeDays}d` : <span className="text-gray-300">—</span>}</td>
                <td className="px-6 py-4 text-right text-sm font-medium">
                  <button onClick={() => openModal(d)} className="text-primary hover:text-primary-dark mr-4">Edit</button>
                  {!d.isSystem && <button onClick={() => remove(d)} className="text-red-600 hover:text-red-800">Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-gray-500/75" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editing ? 'Edit' : 'Add'} Disposition</h3>
            {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-4 text-sm rounded-lg">{formError}</div>}
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={255} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400">(optional)</span></label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Snooze days <span className="text-gray-400">(optional)</span></label>
                <input type="number" min={0} value={form.snoozeDays} onChange={(e) => setForm({ ...form, snoozeDays: e.target.value })} placeholder="e.g. 3" className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-primary text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-dark disabled:opacity-50">{saving ? 'Saving…' : editing ? 'Update' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
