import { useState, useEffect, useMemo } from 'react'
import { api } from '../../lib/api'
import CapacityCalendar from './CapacityCalendar'

/**
 * Capacity-aware booking date picker (Resource Manager).
 *
 * Reusable across the advisor booking surfaces (New Jobsheet first; New Health
 * Check + estimate-convert next). Given a job source — a draft parent
 * (jobsheetId/estimateId/healthCheckId) or an explicit repairTypeId — it calls
 * POST /resource-manager/availability and renders a fuel-gauge week strip, a
 * recommended-day hero with a plain-English "why", alternatives, a manual date
 * with "jump to first available", and a mode-adaptive time control.
 *
 * P1 is READ-ONLY: it only sets the booking date/time on the parent form. The
 * commit-time canBook guard + override capture is P2 (see GMS/BOOKING_FLOW.md).
 * The picker never blocks the advisor from setting a date — capacity is advice.
 */

type Verdict = 'OK' | 'WARN' | 'DENY_SOFT' | 'DENY_HARD'
type Band = 'closed' | 'low' | 'healthy' | 'high' | 'over'

interface StripDay {
  date: string
  status: Verdict
  reason: string
  availableHours: number
  bookedHours: number
  bookedPct: number | null
  freeHours: number
  ceilingHours: number
  band: Band
}
interface AvailJob {
  repairTypeId: string
  label: string | null
  colour: string | null
  hours: number
  bookingMode: 'drop_off' | 'timed_slot'
  slotMinutes: number
}
interface AvailResponse {
  resolved: boolean
  /** Site-level load strip with no job resolved yet (no category/skill enforcement). */
  capacityOnly?: boolean
  reason?: string
  siteId?: string
  job?: AvailJob | null
  dropoffWindow?: { start: string; end: string; intervalMinutes: number }
  leadTimeDays?: number
  days?: StripDay[]
  recommended?: StripDay | null
  alternatives?: StripDay[]
  softHints?: StripDay[]
}

export interface BookingDateValue { date: string; time: string }

const BAND_BAR: Record<Band, string> = {
  closed: 'bg-gray-300', low: 'bg-blue-500', healthy: 'bg-rag-green', high: 'bg-rag-amber', over: 'bg-rag-red'
}
const BAND_TXT: Record<Band, string> = {
  closed: 'text-gray-400', low: 'text-blue-600', healthy: 'text-rag-green', high: 'text-rag-amber', over: 'text-rag-red'
}

const d12 = (ymd: string) => new Date(`${ymd}T12:00:00`)
const weekday = (ymd: string) => d12(ymd).toLocaleDateString('en-GB', { weekday: 'short' })
const dayNum = (ymd: string) => d12(ymd).toLocaleDateString('en-GB', { day: 'numeric' })
const monShort = (ymd: string) => d12(ymd).toLocaleDateString('en-GB', { month: 'short' })
const longDate = (ymd: string) => d12(ymd).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

function buildTimes(start: string, end: string, stepMin: number): string[] {
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const out: string[] = []
  for (let m = toMin(start); m <= toMin(end) && out.length < 64; m += Math.max(5, stepMin)) out.push(fmt(m))
  return out
}

function cellLabel(d: StripDay): string {
  if (d.band === 'closed' || d.reason === 'Closed') return 'Closed'
  if (d.status === 'DENY_HARD') return 'Full'
  return d.bookedPct == null ? '—' : `${Math.round(d.bookedPct * 100)}%`
}

function whyLine(d: StripDay): string {
  const pct = d.bookedPct == null ? null : Math.round(d.bookedPct * 100)
  const parts: string[] = []
  if (pct != null) parts.push(`${pct}% loaded`)
  if (d.freeHours > 0) parts.push(`${d.freeHours}h free`)
  if (d.band === 'low') parts.push('plenty of room')
  if (d.status === 'WARN') parts.push('tighter than usual')
  return parts.join(' · ') || 'Within capacity'
}

export default function BookingDatePicker({
  token, siteId, jobsheetId, estimateId, healthCheckId, repairTypeId, hours,
  refreshKey = 0, value, onChange, required = false, bare = false,
  overrideReason, onOverrideReasonChange, onVerdictChange,
  enableDropOff = false, dropOffDate, onDropOffDateChange
}: {
  token: string
  siteId?: string
  jobsheetId?: string
  estimateId?: string
  healthCheckId?: string
  repairTypeId?: string
  hours?: number
  refreshKey?: number
  value: BookingDateValue
  onChange: (v: BookingDateValue) => void
  required?: boolean
  /** Drop the card chrome (border/shadow/padding) when embedding inside another card or modal. */
  bare?: boolean
  /** Override reason for a tight (WARN/soft) day — captured inline; required to book over target. */
  overrideReason?: string
  onOverrideReasonChange?: (reason: string) => void
  /** Fires with the selected date's verdict so the parent can gate submit / stamp the override. */
  onVerdictChange?: (status: Verdict | null) => void
  /** Advisor-only: show the "drop-off date ≠ workshop date" toggle + earlier-date picker. */
  enableDropOff?: boolean
  /** Drop-off date (YYYY-MM-DD); '' = same as the workshop schedule date. */
  dropOffDate?: string
  onDropOffDateChange?: (date: string) => void
}) {
  const hasSource = !!(jobsheetId || estimateId || healthCheckId || repairTypeId)
  const [data, setData] = useState<AvailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [manualVerdict, setManualVerdict] = useState<{ status: Verdict; reason: string } | null>(null)
  // The capacity calendar (replaces the raw "pick any date" input) is opened on demand.
  const [calOpen, setCalOpen] = useState(false)

  const setDate = (date: string) => onChange({ date, time: value.time })
  const setTime = (time: string) => onChange({ date: value.date, time })

  // Load availability whenever the job source / site / work lines change. With a
  // site but no job source we still query — the engine returns a capacity-only
  // strip — so the picker always has a fuel gauge instead of a bare date field.
  useEffect(() => {
    if (!token || (!hasSource && !siteId)) { setData(null); return }
    let cancelled = false
    setLoading(true)
    const body: Record<string, unknown> = {}
    if (jobsheetId) body.jobsheetId = jobsheetId
    else if (estimateId) body.estimateId = estimateId
    else if (healthCheckId) body.healthCheckId = healthCheckId
    else if (repairTypeId) { body.repairTypeId = repairTypeId; if (hours) body.hours = hours }
    const qs = siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''
    api<AvailResponse>(`/api/v1/resource-manager/availability${qs}`, { method: 'POST', token, body })
      .then(r => { if (!cancelled) setData(r) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, hasSource, jobsheetId, estimateId, healthCheckId, repairTypeId, hours, siteId, refreshKey])

  const job = data?.resolved ? data.job : undefined
  const days = data?.days || []
  const recommended = data?.recommended || null
  const selectedDay = useMemo(() => days.find(d => d.date === value.date) || null, [days, value.date])

  // Show the fuel-gauge strip whenever the engine returns days — either a fully
  // resolved job, or a capacity-only site strip before work is added. Only the
  // residual (no site / unconfigured / fetch error) falls back to a manual date.
  const showStrip = !!data && (data.resolved || !!data.capacityOnly)
  const emptyMsg = data?.reason || 'Add work with a repair type to see workshop availability.'

  // Verdict for a manually-typed date that's beyond the shown strip.
  useEffect(() => {
    if (!token || !job || !value.date || selectedDay) { setManualVerdict(null); return }
    let cancelled = false
    const qs = data?.siteId ? `?siteId=${encodeURIComponent(data.siteId)}` : ''
    api<{ status: Verdict; reason: string }>(`/api/v1/resource-manager/can-book${qs}`, {
      method: 'POST', token, body: { repairTypeId: job.repairTypeId, hours: job.hours, date: value.date }
    })
      .then(r => { if (!cancelled) setManualVerdict(r) })
      .catch(() => { if (!cancelled) setManualVerdict(null) })
    return () => { cancelled = true }
  }, [token, job, value.date, selectedDay, data?.siteId])

  const verdict = selectedDay ? { status: selectedDay.status, reason: selectedDay.reason } : manualVerdict

  // Surface the selected date's verdict so the parent can gate submit + stamp the override.
  useEffect(() => { onVerdictChange?.(verdict?.status ?? null) }, [verdict?.status, onVerdictChange])

  const timeOptions = useMemo(() => {
    if (job?.bookingMode === 'drop_off' && data?.dropoffWindow) {
      return buildTimes(data.dropoffWindow.start, data.dropoffWindow.end, data.dropoffWindow.intervalMinutes)
    }
    return []
  }, [job?.bookingMode, data?.dropoffWindow])

  const cardCls = 'bg-white border border-gray-200 rounded-xl shadow-sm p-6'
  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5'

  return (
    <div className={bare ? '' : cardCls}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{enableDropOff ? 'Workshop schedule date' : 'Booking date'} {required && <span className="text-rag-red">*</span>}</h2>
        {job && (
          <span className="inline-flex items-center gap-2 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium text-white" style={{ backgroundColor: job.colour || '#6366f1' }}>
              {job.label || 'Work'}
            </span>
            {job.hours}h · {job.bookingMode === 'timed_slot' ? `~${job.slotMinutes} min slot` : 'drop-off'}
          </span>
        )}
      </div>

      {showStrip ? (
        <>
          {/* Fuel-gauge week strip */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3" style={{ scrollbarWidth: 'thin' }}>
            {days.map(d => {
              const isSel = d.date === value.date
              const isRec = recommended?.date === d.date
              const disabled = d.status === 'DENY_HARD'
              return (
                <button
                  key={d.date}
                  type="button"
                  disabled={disabled}
                  onClick={() => setDate(d.date)}
                  title={d.reason}
                  className={`shrink-0 w-[60px] rounded-xl border px-1 py-2 text-center transition-colors ${
                    isSel ? 'border-gray-900 ring-2 ring-gray-900/10'
                      : isRec ? 'border-rag-green ring-1 ring-rag-green/30'
                      : 'border-gray-200 hover:border-gray-300'
                  } ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'bg-white'}`}
                >
                  <div className="text-[10px] font-medium text-gray-400">{weekday(d.date)}</div>
                  <div className="text-base font-bold leading-tight text-gray-900">{dayNum(d.date)}</div>
                  <div className="h-1 my-1 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full ${BAND_BAR[d.band]}`} style={{ width: `${Math.min(1, d.bookedPct ?? 0) * 100}%` }} />
                  </div>
                  <div className={`text-[10px] font-medium ${BAND_TXT[d.band]}`}>{cellLabel(d)}</div>
                </button>
              )
            })}
            {days.length === 0 && <p className="text-sm text-gray-400 py-2">No open days in the booking window.</p>}
          </div>

          {/* Recommended-day hero */}
          {recommended && (
            <div className="rounded-xl bg-rag-green/10 border border-rag-green/30 p-3 flex items-center gap-3 flex-wrap mb-3">
              <div className="flex-1 min-w-[180px]">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{longDate(recommended.date)}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-rag-green text-white">Next available</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{whyLine(recommended)}</div>
              </div>
              <button
                type="button"
                onClick={() => setDate(recommended.date)}
                className="h-9 px-4 rounded-lg bg-[#16191f] text-white text-sm font-medium hover:bg-black disabled:opacity-50"
                disabled={value.date === recommended.date}
              >
                {value.date === recommended.date ? 'Selected' : 'Use this date'}
              </button>
            </div>
          )}

          {/* Other good days */}
          {data?.alternatives && data.alternatives.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="text-xs text-gray-400">Other good days</span>
              {data.alternatives.map(a => (
                <button key={a.date} type="button" onClick={() => setDate(a.date)}
                  className={`text-xs rounded-full border px-3 py-1 ${a.date === value.date ? 'border-gray-900 text-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
                  {weekday(a.date)} {dayNum(a.date)} {monShort(a.date)} · {a.bookedPct == null ? '—' : `${Math.round(a.bookedPct * 100)}%`}
                </button>
              ))}
            </div>
          )}

          {/* Pick any date (capacity calendar) + time — secondary once availability resolves */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelCls.replace(' mb-1.5', '')}>Or pick any date</label>
                {recommended && value.date !== recommended.date && (
                  <button type="button" onClick={() => { setDate(recommended.date); setCalOpen(false) }} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    Jump to first available
                  </button>
                )}
              </div>
              <button type="button" onClick={() => setCalOpen(o => !o)} className={`${inputCls} flex items-center justify-between text-left`}>
                <span className={value.date ? 'text-gray-900' : 'text-gray-400'}>{value.date ? longDate(value.date) : 'Pick a date'}</span>
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </button>
            </div>
            <div>
              <label className={labelCls}>
                {job?.bookingMode === 'timed_slot' ? 'Appointment time' : 'Drop-off time'}
                <span className="text-gray-400 font-normal"> {job?.bookingMode === 'timed_slot' ? `(~${job.slotMinutes} min)` : '(optional)'}</span>
              </label>
              {timeOptions.length > 0 ? (
                <select value={value.time} onChange={e => setTime(e.target.value)} className={inputCls}>
                  <option value="">Flexible — any time</option>
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : (
                <input type="time" value={value.time} onChange={e => setTime(e.target.value)} className={inputCls} />
              )}
            </div>
          </div>
        </>
      ) : loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
          <span className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" /> Checking workshop availability…
        </div>
      ) : (
        <>
          {/* Empty state — capacity can't resolve yet: lead with the prompt, demote the manual date */}
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-5 text-center">
            <svg className="w-5 h-5 mx-auto text-gray-300 mb-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <p className="text-sm text-gray-500">{emptyMsg}</p>
            <p className="text-xs text-gray-400 mt-1">We’ll recommend the best day to book once there’s work to schedule.</p>
          </div>

          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Pick a date</label>
              <button type="button" onClick={() => setCalOpen(o => !o)} className={`${inputCls} flex items-center justify-between text-left`}>
                <span className={value.date ? 'text-gray-900' : 'text-gray-400'}>{value.date ? longDate(value.date) : 'Pick a date'}</span>
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Drop-off time <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="time" value={value.time} onChange={e => setTime(e.target.value)} className={inputCls} />
            </div>
          </div>
        </>
      )}

      {/* Capacity calendar — pick any date through the load surface (not a raw input) */}
      {calOpen && (
        <CapacityCalendar
          token={token}
          siteId={siteId || data?.siteId}
          jobsheetId={jobsheetId}
          estimateId={estimateId}
          healthCheckId={healthCheckId}
          value={value.date}
          refreshKey={refreshKey}
          onSelect={(d) => { setDate(d); setCalOpen(false) }}
        />
      )}

      {/* Advisor-only: drop-off date when the car comes in EARLIER than the workshop date */}
      {enableDropOff && value.date && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-700">Drop-off date same as workshop date?</span>
            <button
              type="button"
              role="switch"
              aria-checked={!dropOffDate}
              onClick={() => onDropOffDateChange?.(dropOffDate ? '' : value.date)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${!dropOffDate ? 'bg-rag-green' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${!dropOffDate ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {dropOffDate ? (
            <div className="mt-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Drop-off date <span className="text-gray-400 font-normal">(when the car comes in)</span></label>
              <input
                type="date"
                value={dropOffDate}
                max={value.date}
                onChange={e => onDropOffDateChange?.(e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-gray-400">
                Customer drops the car in on this day; work is scheduled for {longDate(value.date)}. Shows in Today and the diary as an arrival.
              </p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-gray-400">On — the car arrives on the workshop date.</p>
          )}
        </div>
      )}

      {/* Inline verdict for the selected date */}
      {verdict && verdict.status !== 'OK' && value.date && (
        verdict.status === 'DENY_HARD' ? (
          <div className="mt-3 rounded-lg px-3 py-2.5 text-xs bg-rag-red/10 text-rag-red flex items-start gap-2">
            <svg className="w-4 h-4 shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
            <span>
              {verdict.reason}. Pick another day
              {recommended && <> — <button type="button" onClick={() => setDate(recommended.date)} className="underline font-medium">use {weekday(recommended.date)} {dayNum(recommended.date)} {monShort(recommended.date)}</button></>}.
            </span>
          </div>
        ) : (
          <div className="mt-3 rounded-lg p-3 bg-rag-amber/10">
            <div className="flex items-start gap-2 text-xs text-rag-amber">
              <svg className="w-4 h-4 shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
              <span>Tighter than recommended — {verdict.reason}. Add a reason to book over the target.</span>
            </div>
            {onOverrideReasonChange && (
              <textarea
                value={overrideReason || ''}
                onChange={e => onOverrideReasonChange(e.target.value)}
                rows={2}
                placeholder="Reason for booking over the loading target (required)…"
                className="mt-2 w-full text-xs px-2.5 py-2 border border-rag-amber/40 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-rag-amber/30"
              />
            )}
          </div>
        )
      )}
    </div>
  )
}
