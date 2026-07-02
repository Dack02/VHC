import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api, User } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { JobTimeSummary, type JobTimeData } from '../../components/JobTimeSummary'
import type { BoardCard, BoardData } from '../WorkshopBoard/types'
import { timeToMinutes, dayCapacityMinutes } from '../WorkshopBoard/types'
import { durationMinFor, busyIntervals, lunchInterval, firstFreeSlot } from '../WorkshopBoard/scheduling'
import { setPlannedStart } from '../WorkshopBoard/boardActions'

/**
 * Technician tab on the jobsheet (TECH_JOB_MODEL.md §14). The jobsheet is the unit of
 * work, so its owning technician, per-line techs, completion, and job-time breakdown live
 * here. Works for VHC-backed and VHC-less jobsheets alike.
 *
 * Assigning a technician auto-recommends a time on that tech's day (the first free slot on
 * the booking date, sized by the job's estimate) and places it on the workshop day timeline,
 * reusing the board's own scheduling primitives so "recommended here" === "where it lands
 * there". Fine-tuning happens on the Workshop Board (drag), reachable from the panel.
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
  isMot: boolean
  workCompletedAt: string | null
  assignedTechnicianId: string | null
}

interface MotTester {
  technicianId: string
  name: string
}

interface Props {
  jobsheetId: string
  healthCheckId: string | null
  assignedTechnician: { id: string; firstName: string; lastName: string } | null
  /** The booking day (jobsheets.dueInDate, YYYY-MM-DD) — the day we schedule against. */
  bookingDate: string
  token: string
  onChange: () => void
}

// The tech's day, once we know who's assigned: a placed slot, a recommendation, or why not.
type Sched =
  | { kind: 'idle' }
  | { kind: 'nohc' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'off' }
  | { kind: 'full'; durationMin: number; bookedHrs: number; capacityHrs: number }
  | { kind: 'recommended'; startMin: number; durationMin: number; bookedHrs: number; capacityHrs: number }
  | { kind: 'placed'; startMin: number; durationMin: number; bookedHrs: number; capacityHrs: number }

const btnDark =
  'inline-flex items-center justify-center px-4 h-[38px] rounded-[10px] bg-[#16191f] text-white text-sm font-semibold hover:bg-black disabled:opacity-50'
const selectCls =
  'border border-gray-300 rounded-[10px] px-3 h-[34px] text-sm focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'

const ymd = (d: string) => d.slice(0, 10)
function fmtClock(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24
  const m = Math.round(totalMin % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const fmtHrs = (h: number) => `${Math.round(h * 10) / 10}h`
// Build/read the local wall-clock time exactly as the board does, so both agree.
const isoAt = (date: string, min: number) => new Date(`${date}T${fmtClock(min)}:00`).toISOString()
function minutesOfIso(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}
const sameDay = (iso: string, date: string) =>
  new Date(iso).toDateString() === new Date(`${date}T12:00:00`).toDateString()
const fmtDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function JobsheetTechnicianTab({ jobsheetId, healthCheckId, assignedTechnician, bookingDate, token, onChange }: Props) {
  const toast = useToast()
  const { user } = useAuth()
  const siteId = user?.site?.id
  const [technicians, setTechnicians] = useState<User[]>([])
  const [motTesters, setMotTesters] = useState<MotTester[]>([])
  const [suggestions, setSuggestions] = useState<TechSuggestion[]>([])
  const [selected, setSelected] = useState<string>(assignedTechnician?.id || '')
  const [saving, setSaving] = useState(false)
  const [workLines, setWorkLines] = useState<WorkLine[]>([])
  const [timeData, setTimeData] = useState<JobTimeData | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [sched, setSched] = useState<Sched>({ kind: 'idle' })
  const [placing, setPlacing] = useState(false)

  useEffect(() => { setSelected(assignedTechnician?.id || '') }, [assignedTechnician?.id])

  useEffect(() => {
    api<{ users: User[] }>('/api/v1/users', { token })
      .then(d => setTechnicians((d.users || []).filter(u => u.role === 'technician')))
      .catch(() => {})
  }, [token])

  // The site's designated MOT tester pool (priority order) — scopes the MOT line's picker.
  useEffect(() => {
    if (!siteId) { setMotTesters([]); return }
    api<{ testers: MotTester[] }>(`/api/v1/resource-manager/mot-testers?siteId=${siteId}`, { token })
      .then(d => setMotTesters(d.testers || []))
      .catch(() => setMotTesters([]))
  }, [token, siteId])

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

  // Read the workshop day and work out this job's slot on the given tech's timeline.
  const refreshSchedule = useCallback(async (techId: string, place: boolean) => {
    if (!healthCheckId) { setSched({ kind: 'nohc' }); return }
    if (!bookingDate) { setSched({ kind: 'idle' }); return }
    setSched({ kind: 'loading' })
    try {
      const params = new URLSearchParams({ date: ymd(bookingDate) })
      if (siteId) params.set('siteId', siteId)
      const board = await api<BoardData>(`/api/v1/workshop-board?${params}`, { token })
      const cfg = board.config
      const date = ymd(bookingDate)
      const shifts = board.shiftsByTech?.[techId] || []
      const absences = board.absencesByTech?.[techId] || []
      const weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7 // Mon=0 … Sun=6
      const shiftForDay = shifts.find(s => s.weekday === weekday)
      const isOff = shifts.length > 0 && !shiftForDay
      const winStart = shiftForDay ? timeToMinutes(shiftForDay.startTime) : timeToMinutes(cfg.dayStartTime)
      const winEnd = shiftForDay ? timeToMinutes(shiftForDay.endTime) : timeToMinutes(cfg.dayEndTime)
      const col = board.columns.find(c => c.columnType === 'technician' && c.technicianId === techId)
      const flatHours = col?.availableHours ?? cfg.defaultTechHours
      const capacityHrs = dayCapacityMinutes({
        date, shifts, absences,
        lunchStartTime: cfg.lunchStartTime, lunchEndTime: cfg.lunchEndTime,
        flatHours, dayStartTime: cfg.dayStartTime,
      }) / 60

      const thisCard = board.cards.find(c => c.healthCheckId === healthCheckId)
      const durationMin = thisCard ? durationMinFor(thisCard) : 60
      const otherBlocks = board.cards
        .filter((c): c is BoardCard & { plannedStartAt: string } =>
          c.technician?.id === techId && c.healthCheckId !== healthCheckId && !!c.plannedStartAt && sameDay(c.plannedStartAt, date))
        .map(c => ({ startMin: minutesOfIso(c.plannedStartAt), durationMin: durationMinFor(c) }))
      const otherHrs = otherBlocks.reduce((s, b) => s + b.durationMin / 60, 0)
      const existingPlanned = thisCard?.plannedStartAt && sameDay(thisCard.plannedStartAt, date)
        ? minutesOfIso(thisCard.plannedStartAt) : null

      // Passive load respects a slot already set (e.g. dragged on the board); a fresh
      // assign (place=true) re-slots onto the newly chosen technician.
      if (!place && existingPlanned != null) {
        setSched({ kind: 'placed', startMin: existingPlanned, durationMin, bookedHrs: otherHrs + durationMin / 60, capacityHrs })
        return
      }
      const clearStale = async () => { if (place && existingPlanned != null) await setPlannedStart(token, healthCheckId, null) }
      if (isOff) { await clearStale(); setSched({ kind: 'off' }); return }

      const slot = firstFreeSlot(durationMin, busyIntervals(otherBlocks), {
        fromMin: winStart, dayStartMin: winStart, dayEndMin: winEnd, lunch: lunchInterval(cfg),
      })
      if (slot == null) { await clearStale(); setSched({ kind: 'full', durationMin, bookedHrs: otherHrs, capacityHrs }); return }

      if (place) {
        await setPlannedStart(token, healthCheckId, isoAt(date, slot))
        setSched({ kind: 'placed', startMin: slot, durationMin, bookedHrs: otherHrs + durationMin / 60, capacityHrs })
      } else {
        setSched({ kind: 'recommended', startMin: slot, durationMin, bookedHrs: otherHrs, capacityHrs })
      }
    } catch {
      setSched({ kind: 'error' })
    }
  }, [healthCheckId, bookingDate, siteId, token])

  // Passive read on open / when the assigned tech (or booking day) changes.
  useEffect(() => {
    if (assignedTechnician?.id) refreshSchedule(assignedTechnician.id, false)
    else setSched({ kind: 'idle' })
  }, [assignedTechnician?.id, refreshSchedule])

  const assign = async (techId: string | null) => {
    const changed = (techId || null) !== (assignedTechnician?.id || null)
    setSaving(true)
    try {
      await api(`/api/v1/jobsheets/${jobsheetId}`, { method: 'PATCH', token, body: { assignedTechnicianId: techId } })
      toast.success(techId ? 'Technician assigned' : 'Technician cleared')
      setSelected(techId || '')
      // Fresh assignment → auto-recommend + place on that tech's day.
      if (techId) await refreshSchedule(techId, changed)
      else setSched({ kind: 'idle' })
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign technician')
    } finally {
      setSaving(false)
    }
  }

  // Commit a recommended slot the user chose not to auto-accept (passive-load case).
  const placeRecommended = async (startMin: number, durationMin: number, bookedHrs: number, capacityHrs: number) => {
    if (!healthCheckId) return
    setPlacing(true)
    try {
      await setPlannedStart(token, healthCheckId, isoAt(ymd(bookingDate), startMin))
      setSched({ kind: 'placed', startMin, durationMin, bookedHrs: bookedHrs + durationMin / 60, capacityHrs })
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule')
    } finally {
      setPlacing(false)
    }
  }

  const clearTime = async () => {
    if (!healthCheckId) return
    setPlacing(true)
    try {
      await setPlannedStart(token, healthCheckId, null)
      if (assignedTechnician?.id) await refreshSchedule(assignedTechnician.id, false)
      else setSched({ kind: 'idle' })
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear time')
    } finally {
      setPlacing(false)
    }
  }

  const dirty = selected !== (assignedTechnician?.id || '')
  const doneCount = workLines.filter(l => l.workCompletedAt).length
  const timed = sched.kind === 'placed' || sched.kind === 'recommended' ? sched : null
  const boardLink = `/workshop-board?date=${ymd(bookingDate)}&view=timeline${assignedTechnician ? `&tech=${assignedTechnician.id}` : ''}`

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

      {/* Scheduled time — the assigned tech's day, with this job's slot */}
      {assignedTechnician && sched.kind !== 'idle' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Scheduled time</h2>
              <p className="text-xs text-gray-500">{assignedTechnician.firstName}&apos;s day · {fmtDay(bookingDate)}</p>
            </div>
            {healthCheckId && sched.kind !== 'nohc' && (
              <Link to={boardLink} className="text-xs font-semibold text-primary hover:underline whitespace-nowrap mt-0.5">
                Adjust on Workshop Board →
              </Link>
            )}
          </div>

          {sched.kind === 'loading' && (
            <p className="text-sm text-gray-400">Checking {assignedTechnician.firstName}&apos;s day…</p>
          )}
          {sched.kind === 'error' && (
            <p className="text-sm text-gray-400">Couldn&apos;t load the technician&apos;s day. It can still be scheduled on the Workshop Board.</p>
          )}
          {sched.kind === 'nohc' && (
            <p className="text-sm text-gray-400">This job needs a workshop visit (check-in) before it can be placed on a technician&apos;s day.</p>
          )}
          {sched.kind === 'off' && (
            <p className="text-sm text-gray-600">
              🌙 {assignedTechnician.firstName} isn&apos;t rostered to work on {fmtDay(bookingDate)}. Pick another technician or schedule manually on the board.
            </p>
          )}
          {sched.kind === 'full' && (
            <p className="text-sm text-gray-600">
              No free {fmtHrs(sched.durationMin / 60)} slot on {fmtDay(bookingDate)} — {assignedTechnician.firstName}&apos;s day is full
              (<span className="text-red-600 font-medium">{fmtHrs(sched.bookedHrs)} / {fmtHrs(sched.capacityHrs)}</span>). Schedule manually on the board.
            </p>
          )}

          {timed && (() => {
            const placed = timed.kind === 'placed'
            const over = timed.bookedHrs > timed.capacityHrs + 1e-6
            const free = Math.max(0, timed.capacityHrs - timed.bookedHrs)
            return (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-[10px] text-lg ${placed ? 'bg-green-50 text-green-700' : 'bg-indigo-50 text-primary'}`}>
                      {placed ? '✓' : '🕑'}
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-gray-900 tabular-nums">
                        {fmtClock(timed.startMin)}–{fmtClock(timed.startMin + timed.durationMin)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {placed ? 'Scheduled' : 'Recommended — first free slot'} · {fmtHrs(timed.durationMin / 60)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-medium ${over ? 'text-red-600' : 'text-gray-700'}`}>
                      {fmtHrs(timed.bookedHrs)} / {fmtHrs(timed.capacityHrs)} booked{over ? ' ⚠' : ''}
                    </div>
                    <div className="text-xs text-gray-400">{over ? 'over capacity' : `${fmtHrs(free)} free`}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  {timed.kind === 'recommended' && (
                    <button
                      type="button"
                      className={btnDark}
                      disabled={placing}
                      onClick={() => placeRecommended(timed.startMin, timed.durationMin, timed.bookedHrs, timed.capacityHrs)}
                    >
                      {placing ? 'Scheduling…' : `Schedule ${fmtClock(timed.startMin)}`}
                    </button>
                  )}
                  {timed.kind === 'placed' && (
                    <button type="button" className="text-xs font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50" disabled={placing} onClick={clearTime}>
                      Clear time
                    </button>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      )}

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
                  <div className="flex items-center gap-1.5">
                    {line.isMot && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase tracking-wide">MOT</span>
                    )}
                    <div className={`text-sm truncate ${line.workCompletedAt ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{line.name}</div>
                  </div>
                  {line.assignedTechnicianId && <div className="text-xs text-gray-500">🔧 {techName(line.assignedTechnicianId)}</div>}
                </div>
                <select
                  value={line.assignedTechnicianId || ''}
                  onChange={(e) => assignLine(line, e.target.value)}
                  className={selectCls}
                  title={line.isMot ? 'Assign an MOT tester' : 'Assign a technician'}
                >
                  <option value="">{line.isMot ? 'No tester' : 'Unclaimed'}</option>
                  {lineOptions(line).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  function toggleDone(line: WorkLine) {
    const wasDone = !!line.workCompletedAt
    setWorkLines(prev => prev.map(l => l.id === line.id ? { ...l, workCompletedAt: wasDone ? null : new Date().toISOString() } : l))
    api(`/api/v1/jobsheets/${jobsheetId}/repair-items/${line.id}/work-done`, { method: wasDone ? 'DELETE' : 'POST', token })
      .catch(err => {
        toast.error(err instanceof Error ? err.message : 'Failed to update line')
        setReloadKey(k => k + 1)
      })
  }

  function assignLine(line: WorkLine, techId: string) {
    setWorkLines(prev => prev.map(l => l.id === line.id ? { ...l, assignedTechnicianId: techId || null } : l))
    api(`/api/v1/jobsheets/${jobsheetId}/repair-items/${line.id}/claim`, {
      method: 'POST', token, body: techId ? { technicianId: techId } : { unassign: true },
    }).catch(err => {
      toast.error(err instanceof Error ? err.message : 'Failed to assign line')
      setReloadKey(k => k + 1)
    })
  }

  // Options for a line's technician picker: MOT lines are scoped to the designated
  // tester pool (priority order); everything else lists all technicians. A pre-existing
  // assignee no longer in the pool stays visible so a save doesn't silently drop them.
  function lineOptions(line: WorkLine): { value: string; label: string }[] {
    if (line.isMot && motTesters.length > 0) {
      const opts = motTesters.map(t => ({ value: t.technicianId, label: t.name }))
      if (line.assignedTechnicianId && !opts.some(o => o.value === line.assignedTechnicianId)) {
        opts.push({ value: line.assignedTechnicianId, label: `${techName(line.assignedTechnicianId) || 'Technician'} (not a tester)` })
      }
      return opts
    }
    return technicians.map(t => ({ value: t.id, label: `${t.firstName} ${t.lastName}` }))
  }
}
