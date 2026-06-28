import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface RepairTypeRow {
  id: string
  code: string
  label: string
  colour: string
  defaultLabourCodeId: string | null
  defaultDiscountPercent: number
  sortOrder: number
  isActive: boolean
  isMot: boolean
}

interface LabourCodeLite {
  id: string
  code: string
  description: string
  hourlyRate: number
}

const PRESET_COLOURS = [
  '#EF4444', '#F59E0B', '#16A34A', '#10B981', '#14B8A6',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7',
  '#EC4899', '#6B7280'
]

export default function RepairTypes() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<RepairTypeRow[]>([])
  const [labourCodes, setLabourCodes] = useState<LabourCodeLite[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<RepairTypeRow> | null>(null)
  const [saving, setSaving] = useState(false)

  const token = session?.accessToken
  const organizationId = user?.organization?.id

  const fetchRows = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ repairTypes: RepairTypeRow[] }>('/api/v1/repair-types', { token })
      setRows(data.repairTypes)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load repair types')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const fetchLabourCodes = useCallback(async () => {
    if (!token || !organizationId) return
    try {
      const data = await api<{ labourCodes: LabourCodeLite[] }>(
        `/api/v1/organizations/${organizationId}/labour-codes`,
        { token }
      )
      setLabourCodes(data.labourCodes || [])
    } catch {
      // Non-fatal — the type list still works without the rate dropdown populated.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, organizationId])

  useEffect(() => { fetchRows(); fetchLabourCodes() }, [fetchRows, fetchLabourCodes])

  const labourCodeLabel = (id: string | null) => {
    if (!id) return null
    const lc = labourCodes.find(c => c.id === id)
    if (!lc) return null
    return `${lc.code} · £${lc.hourlyRate.toFixed(2)}/hr`
  }

  const handleSave = async () => {
    if (!token || !editing?.code?.trim()) return
    setSaving(true)
    try {
      const payload = {
        code: editing.code.trim(),
        colour: editing.colour || '#6366F1',
        defaultLabourCodeId: editing.defaultLabourCodeId || null,
        defaultDiscountPercent: Math.min(100, Math.max(0, Number(editing.defaultDiscountPercent) || 0)),
        isMot: Boolean(editing.isMot)
      }
      if (editing.id) {
        await api(`/api/v1/repair-types/${editing.id}`, { method: 'PATCH', token, body: payload })
        toast.success('Repair type updated')
      } else {
        await api('/api/v1/repair-types', { method: 'POST', token, body: payload })
        toast.success('Repair type created')
      }
      setEditing(null)
      fetchRows()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save repair type')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (row: RepairTypeRow) => {
    if (!token) return
    try {
      await api(`/api/v1/repair-types/${row.id}`, { method: 'PATCH', token, body: { isActive: !row.isActive } })
      fetchRows()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update repair type')
    }
  }

  const handleDelete = async (row: RepairTypeRow) => {
    if (!token) return
    if (!window.confirm(`Deactivate "${row.code}"? It stays on past work for reporting but won't be selectable on new work.`)) return
    try {
      await api(`/api/v1/repair-types/${row.id}`, { method: 'DELETE', token })
      toast.success('Repair type deactivated')
      fetchRows()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete repair type')
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
        api(`/api/v1/repair-types/${s.id}`, { method: 'PATCH', token, body: { sortOrder: (i + 1) * 10 } })
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
            <h1 className="text-2xl font-bold text-gray-900">Repair Types</h1>
            <p className="text-gray-600 mt-1">Classify each work group (Clutch, Service, MOT…). The type sets the labour rate and powers repair-type reporting.</p>
          </div>
          <button onClick={() => setEditing({ colour: '#6366F1' })} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg">
            + New repair type
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
          {rows.map((row, index) => {
            const rate = labourCodeLabel(row.defaultLabourCodeId)
            return (
              <div key={row.id} className={`flex items-center gap-3 px-4 py-3 ${!row.isActive ? 'opacity-50' : ''}`}>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => handleMove(index, -1)} disabled={index === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30" aria-label="Move up">▲</button>
                  <button onClick={() => handleMove(index, 1)} disabled={index === rows.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30" aria-label="Move down">▼</button>
                </div>
                <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: row.colour }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    {row.code}
                    {row.isMot && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">MOT</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {rate ? <>Labour: {rate}</> : <span className="text-amber-600">No labour code set</span>}
                    {row.defaultDiscountPercent > 0 && (
                      <span className="ml-1 text-emerald-600">· {row.defaultDiscountPercent}% off</span>
                    )}
                  </div>
                </div>
                <button onClick={() => setEditing({ ...row })} className="text-sm text-primary hover:underline">Edit</button>
                <button onClick={() => handleToggleActive(row)} className={`px-2 py-1 rounded-full text-xs font-medium ${row.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {row.isActive ? 'Active' : 'Inactive'}
                </button>
                <button onClick={() => handleDelete(row)} className="text-sm text-red-600 hover:underline">Delete</button>
              </div>
            )
          })}
          {rows.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">No repair types yet.</div>}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-4">{editing.id ? 'Edit repair type' : 'New repair type'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={editing.code || ''}
                  onChange={e => setEditing({ ...editing, code: e.target.value })}
                  maxLength={50}
                  placeholder="e.g. Clutch"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Default labour code (sets the rate)</label>
                <select
                  value={editing.defaultLabourCodeId || ''}
                  onChange={e => setEditing({ ...editing, defaultLabourCodeId: e.target.value || null })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                >
                  <option value="">— None —</option>
                  {labourCodes.map(lc => (
                    <option key={lc.id} value={lc.id}>{lc.code} · {lc.description} · £{lc.hourlyRate.toFixed(2)}/hr</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Labour on this type's work groups bills at this code's rate. Manage codes under Settings → Labour Codes.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Default discount %</label>
                <div className="relative w-32">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={editing.defaultDiscountPercent ?? 0}
                    onChange={e => setEditing({ ...editing, defaultDiscountPercent: e.target.value === '' ? 0 : Number(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Discounts this type's labour off the code's rate so you can stay competitively priced (e.g. Clutch at 10% off). Applied to new labour lines by default — advisors can still adjust it per line.</p>
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
              <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(editing.isMot)}
                  onChange={e => setEditing({ ...editing, isMot: e.target.checked })}
                  className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700">This is an MOT</span>
                  <span className="block text-xs text-gray-400">Counts against the MOT bay cap and loads at the MOT capacity-hours set on the Resource Manager — Settings → Capacity.</span>
                </span>
              </label>
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
