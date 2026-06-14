import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface TimeCategory {
  id: string
  key: string
  label: string
  kind: 'productive' | 'indirect'
  isHealthCheck: boolean
  countsTowardJob: boolean
  colour: string | null
  sortOrder: number
  isActive: boolean
  isSystem: boolean
}

interface TimeTrackingSettingsResponse {
  indirectTimeEnabled: boolean
  openSegmentStaleMinutes: number
  autoCloseAtEod: boolean
  categories: TimeCategory[]
}

export default function TimeTrackingSettings() {
  const { session, user } = useAuth()
  const toast = useToast()
  const token = session?.accessToken
  const orgId = user?.organization?.id

  const [indirectEnabled, setIndirectEnabled] = useState(false)
  const [autoClose, setAutoClose] = useState(true)
  const [staleMinutes, setStaleMinutes] = useState('600')
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [loading, setLoading] = useState(true)

  const [newLabel, setNewLabel] = useState('')
  const [newKind, setNewKind] = useState<'productive' | 'indirect'>('indirect')
  const [newColour, setNewColour] = useState('#64748B')

  const base = orgId ? `/api/v1/organizations/${orgId}/time-tracking-settings` : ''
  const catBase = orgId ? `/api/v1/organizations/${orgId}/time-entry-categories` : ''

  const fetchSettings = useCallback(async () => {
    if (!token || !orgId) return
    try {
      const data = await api<TimeTrackingSettingsResponse>(base, { token })
      setIndirectEnabled(data.indirectTimeEnabled)
      setAutoClose(data.autoCloseAtEod)
      setStaleMinutes(String(data.openSegmentStaleMinutes))
      setCategories(data.categories)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [token, orgId, base, toast])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const saveSettings = async (patch: Record<string, unknown>) => {
    if (!token || !orgId) return
    try {
      await api(base, { method: 'PATCH', token, body: patch })
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
      fetchSettings()
    }
  }

  const updateCategory = async (id: string, patch: Record<string, unknown>) => {
    if (!token) return
    setCategories(cs => cs.map(c => c.id === id ? { ...c, ...patch } as TimeCategory : c))
    try {
      await api(`${catBase}/${id}`, { method: 'PATCH', token, body: patch })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update category')
      fetchSettings()
    }
  }

  const addCategory = async () => {
    if (!token || !newLabel.trim()) return
    try {
      const created = await api<TimeCategory>(catBase, { method: 'POST', token, body: { label: newLabel.trim(), kind: newKind, colour: newColour } })
      setCategories(cs => [...cs, created])
      setNewLabel('')
      toast.success('Category added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add category')
    }
  }

  const deleteCategory = async (id: string) => {
    if (!token) return
    try {
      await api(`${catBase}/${id}`, { method: 'DELETE', token })
      setCategories(cs => cs.filter(c => c.id !== id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete category')
    }
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>

  const productive = categories.filter(c => c.kind === 'productive')
  const indirect = categories.filter(c => c.kind === 'indirect')

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Time Tracking</h1>
        <p className="text-sm text-gray-500 mt-1">How technician clocking, time categories, and stale-clock auto-close behave.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
        <Toggle
          label="Indirect time tracking"
          description="Let technicians log non-job time (waiting for parts, breaks, training). When off, only job time is tracked."
          checked={indirectEnabled}
          onChange={v => { setIndirectEnabled(v); saveSettings({ indirectTimeEnabled: v }) }}
        />
        <Toggle
          label="Auto-close at end of day"
          description="Close any clock-on left running overnight, so a forgotten clock-off can't inflate job times."
          checked={autoClose}
          onChange={v => { setAutoClose(v); saveSettings({ autoCloseAtEod: v }) }}
        />
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium text-gray-800">Stale clock threshold</div>
            <div className="text-sm text-gray-500">An open clock older than this (minutes) is treated as forgotten and excluded from live totals.</div>
          </div>
          <input
            type="number"
            min={1}
            value={staleMinutes}
            onChange={e => setStaleMinutes(e.target.value)}
            onBlur={() => saveSettings({ openSegmentStaleMinutes: Number(staleMinutes) })}
            className="border border-gray-300 rounded-lg px-3 py-2 w-24 text-right"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Categories</h2>
        <p className="text-sm text-gray-500 mb-4">Productive categories count toward job time; indirect ones don't. Inspection and Repair are built in.</p>

        <CategoryGroup title="Productive" cats={productive} onUpdate={updateCategory} onDelete={deleteCategory} dimmed={false} />
        <CategoryGroup title="Indirect" cats={indirect} onUpdate={updateCategory} onDelete={deleteCategory} dimmed={!indirectEnabled} />

        <div className="mt-4 pt-4 border-t border-gray-100 flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-gray-500">New category</label>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Road test" className="w-full border border-gray-300 rounded-lg px-3 py-2" />
          </div>
          <select value={newKind} onChange={e => setNewKind(e.target.value as 'productive' | 'indirect')} className="border border-gray-300 rounded-lg px-3 py-2">
            <option value="productive">Productive</option>
            <option value="indirect">Indirect</option>
          </select>
          <input type="color" value={newColour} onChange={e => setNewColour(e.target.value)} className="w-10 h-10 rounded-lg border border-gray-300" title="Colour" />
          <button onClick={addCategory} disabled={!newLabel.trim()} className="px-4 py-2 bg-primary text-white rounded-lg disabled:opacity-50">Add</button>
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="font-medium text-gray-800">{label}</div>
        <div className="text-sm text-gray-500">{description}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-gray-300'}`}
        aria-pressed={checked}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}

function CategoryGroup({ title, cats, onUpdate, onDelete, dimmed }: {
  title: string
  cats: TimeCategory[]
  onUpdate: (id: string, patch: Record<string, unknown>) => void
  onDelete: (id: string) => void
  dimmed: boolean
}) {
  if (cats.length === 0) return null
  return (
    <div className={`mb-3 ${dimmed ? 'opacity-50' : ''}`}>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{title}</div>
      <div className="space-y-1">
        {cats.map(cat => (
          <div key={cat.id} className="flex items-center gap-2 py-1.5">
            <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.colour || '#94A3B8' }} />
            <input
              defaultValue={cat.label}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== cat.label) onUpdate(cat.id, { label: v }) }}
              className="flex-1 border border-transparent hover:border-gray-200 focus:border-gray-300 rounded px-2 py-1 text-sm text-gray-800"
            />
            {cat.isHealthCheck && <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">Health check</span>}
            {cat.isSystem && <span className="text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">Built-in</span>}
            <button
              type="button"
              onClick={() => onUpdate(cat.id, { isActive: !cat.isActive })}
              className={`text-xs px-2 py-1 rounded-lg ${cat.isActive ? 'text-green-700 bg-green-50' : 'text-gray-400 bg-gray-100'}`}
            >
              {cat.isActive ? 'Active' : 'Off'}
            </button>
            {!cat.isSystem && (
              <button type="button" onClick={() => onDelete(cat.id)} className="text-xs text-red-500 hover:text-red-700 px-1" title="Delete">✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
