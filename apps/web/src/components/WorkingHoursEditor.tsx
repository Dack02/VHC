import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useToast } from '../contexts/ToastContext'

interface ShiftRow { technicianId: string; weekday: number; startTime: string; endTime: string }
interface DayEdit { on: boolean; start: string; end: string }

// Mon=0 … Sun=6 — matches workshop_tech_shifts.weekday and the board's convention.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const OFF_DEFAULT = { start: '08:00', end: '17:30' }

interface Props {
  siteId: string | undefined
  technicianId: string
  token: string
  /** Fired after a successful save — e.g. to refresh a board that reads these hours. */
  onSaved?: () => void
}

/**
 * Per-technician weekly working-hours editor and the single source of truth for a
 * tech's normal week (`workshop_tech_shifts`) — read by the Workshop Board and the
 * capacity engine. Shared by the board's Shifts modal and the Technician settings
 * page so "set hours here" === "what the board schedules against". Omitted weekdays
 * mean a day off; a tech with no pattern falls back to the site default (flagged below).
 */
export default function WorkingHoursEditor({ siteId, technicianId, token, onSaved }: Props) {
  const toast = useToast()
  const [days, setDays] = useState<DayEdit[]>(WEEKDAYS.map(() => ({ on: false, ...OFF_DEFAULT })))
  const [hasPattern, setHasPattern] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!token || !technicianId) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (siteId) params.set('siteId', siteId)
      const res = await api<{ shifts: ShiftRow[] }>(`/api/v1/workshop-board/shifts?${params}`, { token })
      const mine = (res.shifts || []).filter(s => s.technicianId === technicianId)
      setHasPattern(mine.length > 0)
      setDays(WEEKDAYS.map((_, wd) => {
        const row = mine.find(s => s.weekday === wd)
        return row ? { on: true, start: row.startTime, end: row.endTime } : { on: false, ...OFF_DEFAULT }
      }))
    } catch {
      toast.error('Failed to load working hours')
    } finally {
      setLoading(false)
    }
  }, [token, technicianId, siteId, toast])

  useEffect(() => { load() }, [load])

  const setDay = (i: number, patch: Partial<DayEdit>) =>
    setDays(d => d.map((day, idx) => (idx === i ? { ...day, ...patch } : day)))

  const copyMonToWeekdays = () => setDays(d => d.map((day, i) => (i >= 1 && i <= 4 ? { ...d[0] } : day)))

  const save = async () => {
    if (!token || !technicianId) return
    for (const d of days) {
      if (d.on && d.start >= d.end) { toast.error('Each working day must start before it ends'); return }
    }
    setSaving(true)
    try {
      const payload = days.flatMap((d, wd) => (d.on ? [{ weekday: wd, startTime: d.start, endTime: d.end }] : []))
      await api(`/api/v1/workshop-board/shifts/${technicianId}`, { method: 'PUT', token, body: { shifts: payload } })
      toast.success('Working hours saved')
      setHasPattern(payload.length > 0)
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save working hours')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-gray-400 py-2">Loading…</p>

  const timeCls = 'border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  return (
    <div className="space-y-3">
      {!hasPattern && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          No working hours set — this technician falls back to the site default on the Workshop Board and in
          capacity. Set their week below so scheduling knows when they&apos;re in.
        </div>
      )}
      <div className="space-y-1.5">
        {WEEKDAYS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 w-20 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={days[i].on} onChange={e => setDay(i, { on: e.target.checked })}
                className="rounded border-gray-300 text-primary focus:ring-primary" />
              {label}
            </label>
            {days[i].on ? (
              <>
                <input type="time" value={days[i].start} onChange={e => setDay(i, { start: e.target.value })} className={timeCls} />
                <span className="text-gray-400 text-sm">–</span>
                <input type="time" value={days[i].end} onChange={e => setDay(i, { end: e.target.value })} className={timeCls} />
              </>
            ) : (
              <span className="text-sm text-gray-400">Day off</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={copyMonToWeekdays} className="text-xs text-primary hover:underline">
          Copy Monday to Tue–Fri
        </button>
        <button type="button" onClick={save} disabled={saving}
          className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : 'Save hours'}
        </button>
      </div>
    </div>
  )
}
