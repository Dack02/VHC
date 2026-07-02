import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import WorkingHoursEditor from '../../components/WorkingHoursEditor'

interface ShiftsModalProps {
  siteId: string
  onClose: () => void
  onChanged: () => void
}

interface OrgUser {
  id: string
  first_name?: string; last_name?: string
  firstName?: string; lastName?: string
  role: string
  is_active?: boolean; isActive?: boolean
}
interface Absence {
  id: string; technicianId: string; startDate: string; endDate: string
  startTime: string | null; endTime: string | null; allDay: boolean; reason: string | null
}

export default function ShiftsModal({ siteId, onClose, onChanged }: ShiftsModalProps) {
  const { session } = useAuth()
  const toast = useToast()
  const token = session?.accessToken
  const [tab, setTab] = useState<'hours' | 'absence'>('hours')
  const [technicians, setTechnicians] = useState<OrgUser[]>([])
  const [absences, setAbsences] = useState<Absence[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTechId, setSelectedTechId] = useState('')
  const [saving, setSaving] = useState(false)
  // Absence form
  const [absTech, setAbsTech] = useState('')
  const [absFrom, setAbsFrom] = useState('')
  const [absTo, setAbsTo] = useState('')
  const [absReason, setAbsReason] = useState('')

  const userName = (id: string) => {
    const u = technicians.find(t => t.id === id)
    return u ? `${u.first_name ?? u.firstName ?? ''} ${u.last_name ?? u.lastName ?? ''}`.trim() : 'Unknown'
  }

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      // Hours (workshop_tech_shifts) are owned by WorkingHoursEditor now; here we only
      // need the technician list and the absence calendar.
      const [usersRes, shiftsRes] = await Promise.all([
        api<{ users: OrgUser[] }>('/api/v1/users', { token }),
        api<{ absences: Absence[] }>(`/api/v1/workshop-board/shifts?siteId=${siteId}`, { token }),
      ])
      const techs = (usersRes.users || []).filter(u => u.role === 'technician' && (u.is_active ?? u.isActive ?? true))
      setTechnicians(techs)
      setAbsences(shiftsRes.absences || [])
      const firstTech = techs[0]?.id || ''
      setSelectedTechId(prev => prev || firstTech)
      setAbsTech(prev => prev || firstTech)
    } catch {
      toast.error('Failed to load shifts')
    } finally {
      setLoading(false)
    }
  }, [token, siteId, toast])

  useEffect(() => { load() }, [load])

  const addAbsence = async () => {
    if (!token || !absTech || !absFrom || !absTo) { toast.error('Pick a technician and dates'); return }
    if (absTo < absFrom) { toast.error('End date is before start date'); return }
    setSaving(true)
    try {
      await api('/api/v1/workshop-board/absences', {
        method: 'POST', token,
        body: { technicianId: absTech, startDate: absFrom, endDate: absTo, allDay: true, reason: absReason.trim() || null },
      })
      toast.success('Absence added')
      setAbsFrom(''); setAbsTo(''); setAbsReason('')
      onChanged()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add absence')
    } finally {
      setSaving(false)
    }
  }

  const removeAbsence = async (id: string) => {
    if (!token) return
    try {
      await api(`/api/v1/workshop-board/absences/${id}`, { method: 'DELETE', token })
      onChanged()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove absence')
    }
  }

  const fmtRange = (a: Absence) => a.startDate === a.endDate ? a.startDate : `${a.startDate} → ${a.endDate}`

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Shifts &amp; absence</h3>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
          <button onClick={() => setTab('hours')} className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md ${tab === 'hours' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Working hours</button>
          <button onClick={() => setTab('absence')} className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md ${tab === 'absence' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Absence</button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-6 text-center">Loading…</div>
        ) : technicians.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">No technicians found for this site.</div>
        ) : tab === 'hours' ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Technician</label>
              <select value={selectedTechId} onChange={e => setSelectedTechId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                {technicians.map(t => <option key={t.id} value={t.id}>{userName(t.id)}</option>)}
              </select>
            </div>
            {selectedTechId && token && (
              <WorkingHoursEditor siteId={siteId} technicianId={selectedTechId} token={token} onSaved={onChanged} />
            )}
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Add absence */}
            <div className="space-y-2 border border-gray-200 rounded-lg p-3">
              <div className="text-xs font-medium text-gray-500">Add absence (holiday / sick / training)</div>
              <select value={absTech} onChange={e => setAbsTech(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {technicians.map(t => <option key={t.id} value={t.id}>{userName(t.id)}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <input type="date" value={absFrom} onChange={e => setAbsFrom(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" aria-label="From" />
                <span className="text-gray-400 text-sm">→</span>
                <input type="date" value={absTo} onChange={e => setAbsTo(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" aria-label="To" />
              </div>
              <input type="text" value={absReason} onChange={e => setAbsReason(e.target.value)} maxLength={40} placeholder="Reason (optional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <div className="flex justify-end">
                <button onClick={addAbsence} disabled={saving} className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">Add absence</button>
              </div>
            </div>
            {/* Existing absences */}
            <div className="space-y-1.5">
              {absences.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-2">No upcoming absences.</div>
              ) : (
                absences.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-sm border border-gray-100 rounded-lg px-3 py-1.5">
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-gray-900">{userName(a.technicianId)}</span>
                      <span className="text-gray-500"> · {fmtRange(a)}{a.reason ? ` · ${a.reason}` : ''}</span>
                    </span>
                    <button onClick={() => removeAbsence(a.id)} className="text-gray-400 hover:text-rag-red flex-shrink-0" title="Remove" aria-label="Remove absence">✕</button>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
