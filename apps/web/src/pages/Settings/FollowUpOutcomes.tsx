import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Outcome {
  id: string
  name: string
  description: string | null
  isWon: boolean
  isActive: boolean
  isSystem: boolean
  sortOrder: number
}

export default function FollowUpOutcomes() {
  const { session, user } = useAuth()
  const toast = useToast()
  const organizationId = user?.organization?.id

  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Outcome | null>(null)
  const [form, setForm] = useState({ name: '', description: '', isWon: false })
  const [formError, setFormError] = useState('')

  useEffect(() => { if (organizationId) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId])

  const load = async () => {
    if (!organizationId) return
    try {
      setLoading(true)
      const data = await api<{ outcomes: Outcome[] }>(`/api/v1/organizations/${organizationId}/follow-up-outcomes`, { token: session?.accessToken })
      if (!data.outcomes || data.outcomes.length === 0) {
        await api(`/api/v1/organizations/${organizationId}/follow-up-outcomes/seed-defaults`, { method: 'POST', token: session?.accessToken })
        const seeded = await api<{ outcomes: Outcome[] }>(`/api/v1/organizations/${organizationId}/follow-up-outcomes`, { token: session?.accessToken })
        setOutcomes(seeded.outcomes || [])
      } else {
        setOutcomes(data.outcomes)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load outcomes')
    } finally {
      setLoading(false)
    }
  }

  const openModal = (o?: Outcome) => {
    setEditing(o || null)
    setForm(o ? { name: o.name, description: o.description || '', isWon: o.isWon } : { name: '', description: '', isWon: false })
    setFormError('')
    setShowModal(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!organizationId) return
    if (!form.name.trim()) { setFormError('Name is required'); return }
    try {
      setSaving(true)
      const body = { name: form.name.trim(), description: form.description.trim() || null, is_won: form.isWon }
      if (editing) {
        await api(`/api/v1/organizations/${organizationId}/follow-up-outcomes/${editing.id}`, { method: 'PATCH', body, token: session?.accessToken })
        toast.success('Outcome updated')
      } else {
        await api(`/api/v1/organizations/${organizationId}/follow-up-outcomes`, { method: 'POST', body, token: session?.accessToken })
        toast.success('Outcome created')
      }
      setShowModal(false)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (o: Outcome) => {
    if (!organizationId || o.isSystem) return
    if (!confirm(`Delete "${o.name}"?`)) return
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-outcomes/${o.id}`, { method: 'DELETE', token: session?.accessToken })
      toast.success('Outcome deleted')
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
          <h1 className="text-2xl font-bold text-gray-900">Follow-Up Outcomes</h1>
          <p className="text-sm text-gray-500 mt-1">Closing reasons for follow-up cases. Mark the ones that count as recovered work.</p>
        </div>
        <button onClick={() => openModal()} className="bg-primary text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-dark">Add Outcome</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Recovered?</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {outcomes.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">{o.name}{o.isSystem && <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">System</span>}</td>
                <td className="px-6 py-4 text-gray-700">{o.description || <span className="text-gray-400">-</span>}</td>
                <td className="px-6 py-4 text-center">{o.isWon ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Won</span> : <span className="text-gray-300">—</span>}</td>
                <td className="px-6 py-4 text-right text-sm font-medium">
                  <button onClick={() => openModal(o)} className="text-primary hover:text-primary-dark mr-4">Edit</button>
                  {!o.isSystem && <button onClick={() => remove(o)} className="text-red-600 hover:text-red-800">Delete</button>}
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editing ? 'Edit' : 'Add'} Outcome</h3>
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
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isWon} onChange={(e) => setForm({ ...form, isWon: e.target.checked })} className="rounded" />
                Counts as recovered work (e.g. Booked)
              </label>
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
