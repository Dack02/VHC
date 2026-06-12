import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface WorkshopStatusRow {
  id: string
  name: string
  colour: string
  icon: string | null
  smsMessage: string | null
  sortOrder: number
  isActive: boolean
}

const PRESET_COLOURS = [
  '#EF4444', '#F59E0B', '#16A34A', '#10B981', '#14B8A6',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7',
  '#EC4899', '#6B7280'
]

const PLACEHOLDER_HELP = '{customer_name} {registration} {site_name} {org_name}'

export default function WorkshopStatuses() {
  const { session } = useAuth()
  const toast = useToast()
  const [statuses, setStatuses] = useState<WorkshopStatusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<WorkshopStatusRow> | null>(null)
  const [saving, setSaving] = useState(false)

  const token = session?.accessToken

  const fetchStatuses = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ statuses: WorkshopStatusRow[] }>('/api/v1/workshop-board/statuses', { token })
      setStatuses(data.statuses)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load statuses')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    fetchStatuses()
  }, [fetchStatuses])

  const handleSave = async () => {
    if (!token || !editing?.name?.trim()) return
    setSaving(true)
    try {
      if (editing.id) {
        await api(`/api/v1/workshop-board/statuses/${editing.id}`, {
          method: 'PATCH',
          token,
          body: {
            name: editing.name.trim(),
            colour: editing.colour,
            smsMessage: editing.smsMessage || null
          }
        })
        toast.success('Status updated')
      } else {
        await api('/api/v1/workshop-board/statuses', {
          method: 'POST',
          token,
          body: {
            name: editing.name.trim(),
            colour: editing.colour || '#6366F1',
            smsMessage: editing.smsMessage || null
          }
        })
        toast.success('Status created')
      }
      setEditing(null)
      fetchStatuses()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save status')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (status: WorkshopStatusRow) => {
    if (!token) return
    try {
      await api(`/api/v1/workshop-board/statuses/${status.id}`, {
        method: 'PATCH',
        token,
        body: { isActive: !status.isActive }
      })
      fetchStatuses()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!token) return
    const target = index + direction
    if (target < 0 || target >= statuses.length) return
    const reordered = [...statuses]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    setStatuses(reordered)
    try {
      await Promise.all(
        reordered.map((s, i) =>
          api(`/api/v1/workshop-board/statuses/${s.id}`, {
            method: 'PATCH',
            token,
            body: { sortOrder: (i + 1) * 10 }
          })
        )
      )
    } catch {
      toast.error('Failed to reorder')
      fetchStatuses()
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Workshop Statuses</h1>
            <p className="text-gray-600 mt-1">
              Operational statuses shown as coloured flags on workshop board cards.
            </p>
          </div>
          <button
            onClick={() => setEditing({ colour: '#6366F1' })}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg"
          >
            + New status
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
          {statuses.map((status, index) => (
            <div key={status.id} className={`flex items-center gap-3 px-4 py-3 ${!status.isActive ? 'opacity-50' : ''}`}>
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMove(index, -1)}
                  disabled={index === 0}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                  aria-label="Move up"
                >▲</button>
                <button
                  onClick={() => handleMove(index, 1)}
                  disabled={index === statuses.length - 1}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                  aria-label="Move down"
                >▼</button>
              </div>
              <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: status.colour }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">{status.name}</div>
                {status.smsMessage && (
                  <div className="text-xs text-gray-400 truncate">✉ {status.smsMessage}</div>
                )}
              </div>
              <button
                onClick={() => setEditing({ ...status })}
                className="text-sm text-primary hover:underline"
              >
                Edit
              </button>
              <button
                onClick={() => handleToggleActive(status)}
                className={`px-2 py-1 rounded-full text-xs font-medium ${
                  status.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {status.isActive ? 'Active' : 'Inactive'}
              </button>
            </div>
          ))}
          {statuses.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">No statuses yet.</div>
          )}
        </div>
      )}

      {/* Edit / create modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {editing.id ? 'Edit status' : 'New status'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={editing.name || ''}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  maxLength={50}
                  placeholder="e.g. Awaiting Authorisation"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLOURS.map(colour => (
                    <button
                      key={colour}
                      onClick={() => setEditing({ ...editing, colour })}
                      className={`w-7 h-7 rounded-full border-2 ${
                        editing.colour === colour ? 'border-gray-900 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: colour }}
                      aria-label={`Colour ${colour}`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  SMS to customer (optional)
                </label>
                <textarea
                  value={editing.smsMessage || ''}
                  onChange={e => setEditing({ ...editing, smsMessage: e.target.value })}
                  rows={3}
                  maxLength={480}
                  placeholder="Leave empty for no SMS. When set, applying this status offers to text the customer - always with a confirmation popup first."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-gray-400 mt-1">Placeholders: {PLACEHOLDER_HELP}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editing.name?.trim()}
                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
