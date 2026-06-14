import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Step {
  id?: string
  stepOrder: number
  action: string
  offsetDays: number
  smsBody: string | null
  emailSubject: string | null
  emailBody: string | null
  defaultOutcomeId: string | null
}
interface Timeline {
  id: string
  name: string
  description: string | null
  anchor: string
  isDefault: boolean
  isActive: boolean
  steps: Step[]
}
interface Outcome { id: string; name: string }

const ACTIONS = [
  { value: 'send_both', label: 'Send SMS + Email' },
  { value: 'send_sms', label: 'Send SMS' },
  { value: 'send_email', label: 'Send Email' },
  { value: 'manual_call', label: 'Manual call (park for human)' },
  { value: 'auto_close', label: 'Auto-close' },
]

const PLACEHOLDERS = '{{customerFirstName}} {{vehicleReg}} {{vehicleMakeModel}} {{deferredTotal}} {{dueDate}} {{followUpUrl}} {{dealershipName}} {{dealershipPhone}} {{deferredItemsTable}}'

export default function FollowUpTimelines() {
  const { session, user } = useAuth()
  const toast = useToast()
  const organizationId = user?.organization?.id
  const token = session?.accessToken

  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  useEffect(() => { if (organizationId) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId])

  const load = async () => {
    if (!organizationId) return
    try {
      setLoading(true)
      const [tl, oc] = await Promise.all([
        api<{ timelines: Timeline[] }>(`/api/v1/organizations/${organizationId}/follow-up-timelines`, { token }),
        api<{ outcomes: Outcome[] }>(`/api/v1/organizations/${organizationId}/follow-up-outcomes`, { token }),
      ])
      setTimelines(tl.timelines || [])
      setOutcomes(oc.outcomes || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load timelines')
    } finally {
      setLoading(false)
    }
  }

  const createTimeline = async () => {
    if (!organizationId || !newName.trim()) return
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-timelines`, { method: 'POST', body: { name: newName.trim(), anchor: 'due_date' }, token })
      setNewName('')
      toast.success('Timeline created')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create timeline')
    }
  }

  const setDefault = async (tl: Timeline) => {
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-timelines/${tl.id}`, { method: 'PATCH', body: { is_default: true }, token })
      toast.success(`"${tl.name}" is now the default`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set default')
    }
  }

  const remove = async (tl: Timeline) => {
    if (!confirm(`Delete timeline "${tl.name}"?`)) return
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-timelines/${tl.id}`, { method: 'DELETE', token })
      toast.success('Timeline deleted')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const saveSteps = async (tl: Timeline) => {
    try {
      setSavingId(tl.id)
      const steps = tl.steps.map((s) => ({
        action: s.action,
        offset_days: s.offsetDays,
        sms_body: s.smsBody,
        email_subject: s.emailSubject,
        email_body: s.emailBody,
        default_outcome_id: s.defaultOutcomeId,
      }))
      await api(`/api/v1/organizations/${organizationId}/follow-up-timelines/${tl.id}/steps`, { method: 'PUT', body: { steps }, token })
      toast.success('Steps saved')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save steps')
    } finally {
      setSavingId(null)
    }
  }

  const mutate = (tlId: string, fn: (steps: Step[]) => Step[]) => {
    setTimelines((prev) => prev.map((t) => (t.id === tlId ? { ...t, steps: fn(t.steps) } : t)))
  }
  const addStep = (tlId: string) => mutate(tlId, (s) => [...s, { stepOrder: s.length + 1, action: 'send_sms', offsetDays: 0, smsBody: '', emailSubject: '', emailBody: '', defaultOutcomeId: null }])
  const removeStep = (tlId: string, i: number) => mutate(tlId, (s) => s.filter((_, idx) => idx !== i))
  const moveStep = (tlId: string, i: number, dir: -1 | 1) => mutate(tlId, (s) => {
    const j = i + dir
    if (j < 0 || j >= s.length) return s
    const copy = [...s]; const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp; return copy
  })
  const updateStep = (tlId: string, i: number, patch: Partial<Step>) => mutate(tlId, (s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)))

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }

  return (
    <div>
      <SettingsBackLink />
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-Up Timelines</h1>
          <p className="text-sm text-gray-500 mt-1">Cadences of steps. Offsets are days relative to the work's due date (negative = before due).</p>
        </div>
      </div>
      <div className="text-xs text-gray-400 mb-6">Placeholders: <code className="bg-gray-100 px-1 rounded">{PLACEHOLDERS}</code></div>

      <div className="flex gap-2 mb-6">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New timeline name…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        <button onClick={createTimeline} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-dark">Create timeline</button>
      </div>

      <div className="space-y-6">
        {timelines.map((tl) => (
          <div key={tl.id} className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">{tl.name}</h2>
                {tl.isDefault && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">Default</span>}
                <span className="text-xs text-gray-400">anchor: {tl.anchor === 'due_date' ? 'due date' : 'deferral date'}</span>
              </div>
              <div className="flex items-center gap-2">
                {!tl.isDefault && <button onClick={() => setDefault(tl)} className="text-sm text-primary hover:text-primary-dark">Set default</button>}
                {!tl.isDefault && <button onClick={() => remove(tl)} className="text-sm text-red-600 hover:text-red-800">Delete</button>}
              </div>
            </div>

            <div className="space-y-3">
              {tl.steps.map((s, i) => {
                const isSms = s.action === 'send_sms' || s.action === 'send_both'
                const isEmail = s.action === 'send_email' || s.action === 'send_both'
                return (
                  <div key={i} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-gray-400 w-6">{i + 1}</span>
                      <select value={s.action} onChange={(e) => updateStep(tl.id, i, { action: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                        {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                      <label className="text-sm text-gray-500 flex items-center gap-1">
                        offset
                        <input type="number" value={s.offsetDays} onChange={(e) => updateStep(tl.id, i, { offsetDays: Number(e.target.value) })} className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                        days
                      </label>
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => moveStep(tl.id, i, -1)} className="px-2 py-1 text-gray-400 hover:text-gray-700">↑</button>
                        <button onClick={() => moveStep(tl.id, i, 1)} className="px-2 py-1 text-gray-400 hover:text-gray-700">↓</button>
                        <button onClick={() => removeStep(tl.id, i)} className="px-2 py-1 text-red-500 hover:text-red-700">✕</button>
                      </div>
                    </div>
                    {isSms && (
                      <textarea value={s.smsBody || ''} onChange={(e) => updateStep(tl.id, i, { smsBody: e.target.value })} rows={2} placeholder="SMS message…" className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    )}
                    {isEmail && (
                      <>
                        <input value={s.emailSubject || ''} onChange={(e) => updateStep(tl.id, i, { emailSubject: e.target.value })} placeholder="Email subject…" className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        <textarea value={s.emailBody || ''} onChange={(e) => updateStep(tl.id, i, { emailBody: e.target.value })} rows={4} placeholder="Email body… (include {{deferredItemsTable}} for the work list)" className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      </>
                    )}
                    {s.action === 'auto_close' && (
                      <select value={s.defaultOutcomeId || ''} onChange={(e) => updateStep(tl.id, i, { defaultOutcomeId: e.target.value || null })} className="mt-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                        <option value="">Close with outcome…</option>
                        {outcomes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-2 mt-4">
              <button onClick={() => addStep(tl.id)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">+ Add step</button>
              <button onClick={() => saveSteps(tl)} disabled={savingId === tl.id} className="px-4 py-1.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 ml-auto">{savingId === tl.id ? 'Saving…' : 'Save steps'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
