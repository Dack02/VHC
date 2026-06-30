import { useState, useEffect, useCallback } from 'react'
import { api, User } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'
import { JobTimeSummary, type JobTimeData } from '../../components/JobTimeSummary'

/**
 * Technician tab on the jobsheet (TECH_JOB_MODEL.md §14). The jobsheet is the unit of
 * work, so its owning technician, per-line techs, completion, and job-time breakdown live
 * here. Works for VHC-backed and VHC-less jobsheets alike.
 */

interface TechSuggestion {
  technicianId: string
  name: string
  isPrimary: boolean
  proficiency: number
  reasons: string[]
}

interface WorkLine {
  id: string
  name: string
  origin: 'booking' | 'inspection' | 'estimate'
  workCompletedAt: string | null
  assignedTechnicianId: string | null
}

interface Props {
  jobsheetId: string
  healthCheckId: string | null
  assignedTechnician: { id: string; firstName: string; lastName: string } | null
  token: string
  onChange: () => void
}

const btnDark =
  'inline-flex items-center justify-center px-4 h-[38px] rounded-[10px] bg-[#16191f] text-white text-sm font-semibold hover:bg-black disabled:opacity-50'
const selectCls =
  'border border-gray-300 rounded-[10px] px-3 h-[34px] text-sm focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'

export default function JobsheetTechnicianTab({ jobsheetId, healthCheckId, assignedTechnician, token, onChange }: Props) {
  const toast = useToast()
  const [technicians, setTechnicians] = useState<User[]>([])
  const [suggestions, setSuggestions] = useState<TechSuggestion[]>([])
  const [selected, setSelected] = useState<string>(assignedTechnician?.id || '')
  const [saving, setSaving] = useState(false)
  const [workLines, setWorkLines] = useState<WorkLine[]>([])
  const [timeData, setTimeData] = useState<JobTimeData | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => { setSelected(assignedTechnician?.id || '') }, [assignedTechnician?.id])

  useEffect(() => {
    api<{ users: User[] }>('/api/v1/users', { token })
      .then(d => setTechnicians((d.users || []).filter(u => u.role === 'technician')))
      .catch(() => {})
  }, [token])

  // Advisory ranking — server resolves the repair type from the jobsheet's lines or the VHC.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    api<{ suggestions?: TechSuggestion[] }>('/api/v1/resource-manager/suggest-technician', {
      method: 'POST',
      token,
      body: { jobsheetId, healthCheckId: healthCheckId || undefined, date: today },
    })
      .then(r => setSuggestions(r.suggestions || []))
      .catch(() => setSuggestions([]))
  }, [token, jobsheetId, healthCheckId])

  useEffect(() => {
    api<{ workLines: WorkLine[] }>(`/api/v1/jobsheets/${jobsheetId}/work-lines`, { token })
      .then(d => setWorkLines(d.workLines || []))
      .catch(() => setWorkLines([]))
    api<JobTimeData>(`/api/v1/jobsheets/${jobsheetId}/time-entries`, { token })
      .then(setTimeData)
      .catch(() => setTimeData(null))
  }, [token, jobsheetId, reloadKey])

  const techName = useCallback((id: string | null) => {
    if (!id) return null
    const t = technicians.find(u => u.id === id)
    return t ? `${t.firstName} ${t.lastName}` : 'Technician'
  }, [technicians])

  const assign = async (techId: string | null) => {
    setSaving(true)
    try {
      await api(`/api/v1/jobsheets/${jobsheetId}`, { method: 'PATCH', token, body: { assignedTechnicianId: techId } })
      toast.success(techId ? 'Technician assigned' : 'Technician cleared')
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign technician')
    } finally {
      setSaving(false)
    }
  }

  const toggleDone = async (line: WorkLine) => {
    const wasDone = !!line.workCompletedAt
    setWorkLines(prev => prev.map(l => l.id === line.id ? { ...l, workCompletedAt: wasDone ? null : new Date().toISOString() } : l))
    try {
      await api(`/api/v1/jobsheets/${jobsheetId}/repair-items/${line.id}/work-done`, { method: wasDone ? 'DELETE' : 'POST', token })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update line')
      setReloadKey(k => k + 1)
    }
  }

  const assignLine = async (line: WorkLine, techId: string) => {
    setWorkLines(prev => prev.map(l => l.id === line.id ? { ...l, assignedTechnicianId: techId || null } : l))
    try {
      await api(`/api/v1/jobsheets/${jobsheetId}/repair-items/${line.id}/claim`, {
        method: 'POST', token, body: techId ? { technicianId: techId } : { unassign: true },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign line')
      setReloadKey(k => k + 1)
    }
  }

  const dirty = selected !== (assignedTechnician?.id || '')
  const doneCount = workLines.filter(l => l.workCompletedAt).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Primary technician */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Primary Technician</h2>
          <p className="text-xs text-gray-500 mb-4">The technician who owns this job — their whole time clocks against the job sheet.</p>

          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-gray-500">Assigned:</span>
            <span className="font-medium text-gray-900">
              {assignedTechnician ? `${assignedTechnician.firstName} ${assignedTechnician.lastName}` : 'Unassigned'}
            </span>
          </div>

          <label className="block text-xs font-medium text-gray-500 mb-1">Assign technician</label>
          <div className="flex items-center gap-2">
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className={`flex-1 ${selectCls} h-[38px]`}>
              <option value="">Unassigned</option>
              {technicians.map(t => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
            </select>
            <button type="button" className={btnDark} disabled={saving || !dirty} onClick={() => assign(selected || null)}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Suggested */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Suggested</h2>
          <p className="text-xs text-gray-500 mb-4">Ranked by skill fit for this job&apos;s repair type. Tap to assign.</p>
          {suggestions.length === 0 ? (
            <p className="text-sm text-gray-400">No suggestions — set a repair type on a work line to get ranked technicians.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, 6).map(s => (
                <button
                  key={s.technicianId}
                  type="button"
                  disabled={saving}
                  title={s.reasons.join(' · ')}
                  onClick={() => { setSelected(s.technicianId); assign(s.technicianId) }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition disabled:opacity-50 ${
                    s.technicianId === assignedTechnician?.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:border-gray-400'
                  }`}
                >
                  {s.isPrimary && '★ '}{s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Job time breakdown */}
      {timeData && (timeData.entries.length > 0 || timeData.activeClockInAt) && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Job Time</h2>
          <JobTimeSummary data={timeData} />
        </div>
      )}

      {/* Per-line completion + tech */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Work Lines</h2>
          {workLines.length > 0 && (
            <span className="text-xs text-gray-500">{doneCount}/{workLines.length} complete</span>
          )}
        </div>
        {workLines.length === 0 ? (
          <p className="text-sm text-gray-400">No work lines yet. Add them on the Work tab.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {workLines.map(line => (
              <div key={line.id} className="flex items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={!!line.workCompletedAt}
                  onChange={() => toggleDone(line)}
                  className="h-4 w-4 rounded border-gray-300 text-[#16191f] focus:ring-[#16191f]"
                  title="Mark this line complete"
                />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate ${line.workCompletedAt ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{line.name}</div>
                  {line.assignedTechnicianId && <div className="text-xs text-gray-500">🔧 {techName(line.assignedTechnicianId)}</div>}
                </div>
                <select
                  value={line.assignedTechnicianId || ''}
                  onChange={(e) => assignLine(line, e.target.value)}
                  className={selectCls}
                >
                  <option value="">Unclaimed</option>
                  {technicians.map(t => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
