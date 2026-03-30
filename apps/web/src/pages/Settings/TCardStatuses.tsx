import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface TCardStatus {
  id: string
  name: string
  colour: string
  icon?: string
  sortOrder: number
  isActive: boolean
}

const ICON_OPTIONS = [
  'clock', 'package', 'package-x', 'calendar', 'external-link',
  'phone', 'check-circle', 'droplets', 'car', 'alert-triangle',
  'wrench', 'shield', 'star', 'flag', 'zap',
]

const COLOUR_PRESETS = [
  '#EF4444', '#DC2626', '#F59E0B', '#D97706', '#10B981',
  '#16A34A', '#3B82F6', '#6366F1', '#8B5CF6', '#06B6D4',
  '#EC4899', '#F97316',
]

export default function TCardStatuses() {
  const { session } = useAuth()
  const toast = useToast()

  const [statuses, setStatuses] = useState<TCardStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', colour: '#3B82F6', icon: '' })

  const fetchStatuses = async () => {
    if (!session?.accessToken) return
    try {
      const data = await api<{ statuses: TCardStatus[] }>('/api/v1/tcard/statuses?include_inactive=true', {
        token: session.accessToken,
      })
      setStatuses(data.statuses || [])
    } catch {
      toast.error('Failed to load statuses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatuses()
  }, [session?.accessToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Status name is required')
      return
    }
    if (!form.colour) {
      toast.error('Colour is required')
      return
    }
    if (!session?.accessToken) return

    try {
      if (editId) {
        await api(`/api/v1/tcard/statuses/${editId}`, {
          method: 'PATCH',
          token: session.accessToken,
          body: { name: form.name, colour: form.colour, icon: form.icon || null },
        })
        toast.success('Status updated')
      } else {
        await api('/api/v1/tcard/statuses', {
          method: 'POST',
          token: session.accessToken,
          body: { name: form.name, colour: form.colour, icon: form.icon || null },
        })
        toast.success('Status created')
      }
      setShowForm(false)
      setEditId(null)
      setForm({ name: '', colour: '#3B82F6', icon: '' })
      fetchStatuses()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save status')
    }
  }

  const handleToggleActive = async (status: TCardStatus) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/tcard/statuses/${status.id}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { isActive: !status.isActive },
      })
      fetchStatuses()
    } catch {
      toast.error('Failed to update status')
    }
  }

  const handleEdit = (status: TCardStatus) => {
    setEditId(status.id)
    setForm({ name: status.name, colour: status.colour, icon: status.icon || '' })
    setShowForm(true)
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">&larr; Back to Settings</Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Workshop Board — Job Statuses</h1>
            <p className="text-sm text-gray-600 mt-1">Define operational statuses that can be applied to jobs on the workshop board.</p>
          </div>
          <button
            onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', colour: '#3B82F6', icon: '' }) }}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90"
          >
            Add Status
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">{editId ? 'Edit Status' : 'New Status'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-700 mb-1 block">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Awaiting Authorisation"
                maxLength={50}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 mb-1 block">Icon (optional)</label>
              <select
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">No icon</option>
                {ICON_OPTIONS.map(icon => (
                  <option key={icon} value={icon}>{icon}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium text-gray-700 mb-1 block">Colour</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {COLOUR_PRESETS.map(c => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setForm({ ...form, colour: c })}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${form.colour === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <input
              type="text"
              value={form.colour}
              onChange={(e) => setForm({ ...form, colour: e.target.value })}
              placeholder="#3B82F6"
              maxLength={7}
              className="w-32 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={handleSave} className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90">
              {editId ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null) }} className="px-4 py-2 text-gray-700 text-sm hover:bg-gray-50 rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Status list */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : statuses.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">No statuses configured yet.</p>
          <p className="text-xs mt-1">Visit the Workshop Board to auto-seed defaults, or add them manually above.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {statuses.map(status => (
            <div key={status.id} className="flex items-center gap-3 px-5 py-3">
              <span
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: status.colour }}
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${status.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                  {status.name}
                </span>
                {status.icon && (
                  <span className="text-xs text-gray-400 ml-2">{status.icon}</span>
                )}
              </div>
              <button
                onClick={() => handleToggleActive(status)}
                className={`text-xs px-2 py-1 rounded-full ${status.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
              >
                {status.isActive ? 'Active' : 'Inactive'}
              </button>
              <button
                onClick={() => handleEdit(status)}
                className="text-xs text-primary hover:underline"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
