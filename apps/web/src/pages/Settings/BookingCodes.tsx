import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface LookupRow {
  id: string
  code: string
  label: string
  colour: string
  sortOrder: number
  isActive: boolean
}

const PRESET_COLOURS = [
  '#EF4444', '#F59E0B', '#16A34A', '#10B981', '#14B8A6',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7',
  '#EC4899', '#6B7280'
]

export default function BookingCodes() {
  const { session } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<LookupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<LookupRow> | null>(null)
  const [saving, setSaving] = useState(false)

  const token = session?.accessToken

  const fetchRows = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ bookingCodes: LookupRow[] }>('/api/v1/booking-codes', { token })
      setRows(data.bookingCodes)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load booking codes')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => { fetchRows() }, [fetchRows])

  const handleSave = async () => {
    if (!token || !editing?.code?.trim()) return
    setSaving(true)
    try {
      if (editing.id) {
        await api(`/api/v1/booking-codes/${editing.id}`, {
          method: 'PATCH', token,
          body: { code: editing.code.trim(), colour: editing.colour }
        })
        toast.success('Booking code updated')
      } else {
        await api('/api/v1/booking-codes', {
          method: 'POST', token,
          body: { code: editing.code.trim(), colour: editing.colour || '#6366F1' }
        })
        toast.success('Booking code created')
      }
      setEditing(null)
      fetchRows()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save booking code')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (row: LookupRow) => {
    if (!token) return
    try {
      await api(`/api/v1/booking-codes/${row.id}`, { method: 'PATCH', token, body: { isActive: !row.isActive } })
      fetchRows()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update booking code')
    }
  }

  const handleDelete = async (row: LookupRow) => {
    if (!token) return
    if (!window.confirm(`Delete "${row.code}"? It will be removed from any jobsheets using it.`)) return
    try {
      await api(`/api/v1/booking-codes/${row.id}`, { method: 'DELETE', token })
      toast.success('Booking code deleted')
      fetchRows()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete booking code')
    }
  }

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!token) return
    const target = index + direction
    if (target < 0 || target >= rows.length) return
    const reordered = [...rows]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    setRows(reordered)
    try {
      await Promise.all(reordered.map((s, i) =>
        api(`/api/v1/booking-codes/${s.id}`, { method: 'PATCH', token, body: { sortOrder: (i + 1) * 10 } })
      ))
    } catch {
      toast.error('Failed to reorder')
      fetchRows()
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Booking Codes</h1>
            <p className="text-gray-600 mt-1">Multi-select tags on a jobsheet (Waiting, Courtesy Car, Fleet…). You can also add codes inline while booking.</p>
          </div>
          <button onClick={() => setEditing({ colour: '#6366F1' })} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg">
            + New booking code
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
          {rows.map((row, index) => (
            <div key={row.id} className={`flex items-center gap-3 px-4 py-3 ${!row.isActive ? 'opacity-50' : ''}`}>
              <div className="flex flex-col gap-0.5">
                <button onClick={() => handleMove(index, -1)} disabled={index === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30" aria-label="Move up">▲</button>
                <button onClick={() => handleMove(index, 1)} disabled={index === rows.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30" aria-label="Move down">▼</button>
              </div>
              <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: row.colour }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">{row.code}</div>
              </div>
              <button onClick={() => setEditing({ ...row })} className="text-sm text-primary hover:underline">Edit</button>
              <button onClick={() => handleToggleActive(row)} className={`px-2 py-1 rounded-full text-xs font-medium ${row.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {row.isActive ? 'Active' : 'Inactive'}
              </button>
              <button onClick={() => handleDelete(row)} className="text-sm text-red-600 hover:underline">Delete</button>
            </div>
          ))}
          {rows.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">No booking codes yet.</div>}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-4">{editing.id ? 'Edit booking code' : 'New booking code'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={editing.code || ''}
                  onChange={e => setEditing({ ...editing, code: e.target.value })}
                  maxLength={50}
                  placeholder="e.g. Courtesy Car"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLOURS.map(colour => (
                    <button key={colour} onClick={() => setEditing({ ...editing, colour })}
                      className={`w-7 h-7 rounded-full border-2 ${editing.colour === colour ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: colour }} aria-label={`Colour ${colour}`} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleSave} disabled={saving || !editing.code?.trim()} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
