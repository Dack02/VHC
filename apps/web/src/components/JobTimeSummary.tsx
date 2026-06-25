import { useState, useEffect } from 'react'

// One clocked segment, as returned by GET /api/v1/health-checks/:id/time-entries
export interface TimeSegment {
  id: string
  technician: { id: string; firstName: string; lastName: string } | null
  clockIn: string
  clockOut: string | null
  durationMinutes: number | null
  autoClosed: boolean
  category: { key?: string; label?: string; kind?: string; isHealthCheck?: boolean; colour?: string } | null
}

// Full payload of the time-entries endpoint (segment breakdown, computed server-side)
export interface JobTimeData {
  entries: TimeSegment[]
  totalMinutes: number
  jobMinutes: number
  healthCheckMinutes: number
  indirectMinutes: number
  activeClockInAt: string | null
  activeCategory: { key: string; label: string } | null
}

// Cap an open segment's live contribution: a forgotten clock-off can't inflate
// the displayed total past this (matches the board's stale-clock guard).
const STALE_CLOCK_MIN = 600

function fmtMins(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${r}m`
}

function fmtClock(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' })
}

/**
 * Job time / health-check time / indirect time, with a live-ticking total and an
 * expandable per-segment history. Internal advisor/manager view — never customer
 * facing. See docs/technician-job-clocking-spec.md §6.
 */
export function JobTimeSummary({
  data,
  estimateMinutes,
  className = ''
}: {
  data: JobTimeData
  estimateMinutes?: number | null
  className?: string
}) {
  const [liveMin, setLiveMin] = useState(0)
  const [showHistory, setShowHistory] = useState(false)

  const active = !!data.activeClockInAt
  useEffect(() => {
    if (!data.activeClockInAt) {
      setLiveMin(0)
      return
    }
    const clockIn = new Date(data.activeClockInAt).getTime()
    const calc = () => Math.min(STALE_CLOCK_MIN, Math.max(0, (Date.now() - clockIn) / 60000))
    calc()
    setLiveMin(calc())
    const t = setInterval(() => setLiveMin(calc()), 30000)
    return () => clearInterval(t)
  }, [data.activeClockInAt])

  // Live job time = closed productive + (capped) live productive segment
  const jobLive = data.jobMinutes + (active ? liveMin : 0)
  const overMin = estimateMinutes != null && estimateMinutes > 0 && jobLive > estimateMinutes
    ? jobLive - estimateMinutes
    : 0
  const stale = active && liveMin >= STALE_CLOCK_MIN

  return (
    <div className={`bg-gray-50 border border-gray-200 rounded-xl p-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Time</span>
          {active && !stale && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              {data.activeCategory?.label || 'Clocked on'}
            </span>
          )}
          {stale && (
            <span className="text-xs font-bold text-white bg-amber-500 rounded-full px-1.5 py-px">CHECK CLOCK</span>
          )}
        </div>
        <div className="text-right">
          <span className={`text-lg font-bold ${overMin > 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmtMins(jobLive)}</span>
          {estimateMinutes != null && estimateMinutes > 0 && (
            <span className="text-xs text-gray-400 ml-1">/ {fmtMins(estimateMinutes)} est</span>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="bg-white rounded-lg py-1.5 border border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase">Health check</div>
          <div className="text-sm font-semibold text-gray-800">{fmtMins(data.healthCheckMinutes)}</div>
        </div>
        <div className="bg-white rounded-lg py-1.5 border border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase">Job total</div>
          <div className="text-sm font-semibold text-gray-800">{fmtMins(jobLive)}</div>
        </div>
        <div className="bg-white rounded-lg py-1.5 border border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase">Indirect</div>
          <div className="text-sm font-semibold text-gray-800">{data.indirectMinutes > 0 ? fmtMins(data.indirectMinutes) : '—'}</div>
        </div>
      </div>

      {overMin > 0 && (
        <div className="mt-1.5 text-xs font-semibold text-red-600 text-center">+{fmtMins(overMin)} over estimate</div>
      )}

      {data.entries.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="text-xs text-primary hover:underline"
          >
            {showHistory ? 'Hide' : 'View'} segments ({data.entries.length})
          </button>
          {showHistory && (
            <div className="mt-1.5 space-y-1">
              {data.entries.map(seg => (
                <div key={seg.id} className="flex items-center justify-between text-xs bg-white border border-gray-100 rounded-lg px-2 py-1">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: seg.category?.colour || '#94A3B8' }}
                    />
                    <span className="text-gray-700 truncate">
                      {seg.category?.label || 'Time'}
                      {seg.technician && <span className="text-gray-400"> · {seg.technician.firstName} {seg.technician.lastName}</span>}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 flex-shrink-0 text-gray-500">
                    <span>{fmtDay(seg.clockIn)} {fmtClock(seg.clockIn)}–{fmtClock(seg.clockOut)}</span>
                    <span className="font-medium text-gray-700">{seg.durationMinutes != null ? fmtMins(seg.durationMinutes) : '· · ·'}</span>
                    {seg.autoClosed && <span className="text-amber-600" title="Auto-closed at end of day">⏱</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
