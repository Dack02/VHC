import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

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

// Full payload of the time-entries endpoint (breakdown computed server-side —
// the single source of truth shared with the workshop board and HC detail).
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
// the displayed total past this (matches the board's stale-clock guard, §5.3).
const STALE_CLOCK_MIN = 600
const STALE_CLOCK_SEC = STALE_CLOCK_MIN * 60

function fmtMins(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${r}m`
}

// Live running timer for the open segment — h:mm:ss so it visibly ticks.
function fmtHMS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

function fmtClock(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' })
}

/**
 * Self-contained job-time display for the technician (inspection + repair
 * screens). Fetches GET /:id/time-entries, ticks a live timer for the open
 * segment, and shows the Job / Health-check / Indirect breakdown plus an
 * expandable per-segment history. Internal only — clocking time never appears
 * on the customer report. See docs/technician-job-clocking-spec.md §6.
 *
 * Drop in with either `healthCheckId` (VHC-anchored) or `jobsheetId` (the GMS
 * jobsheet-first screen) — the two endpoints return the identical payload. Pass
 * `refreshKey` to force a re-fetch after a clock action, and `onData` to let a
 * parent observe the breakdown (e.g. the Repair screen reads `activeClockInAt`
 * to pick its clock-on/off button) without a second fetch of the same endpoint.
 */
export function JobTimeSummary({
  healthCheckId,
  jobsheetId,
  refreshKey = 0,
  onData,
  className = ''
}: {
  healthCheckId?: string
  jobsheetId?: string
  refreshKey?: number
  onData?: (data: JobTimeData) => void
  className?: string
}) {
  const { session } = useAuth()
  const token = session?.access_token

  // Exactly one of the two anchors drives the endpoint; jobsheet takes precedence.
  const timeEntriesPath = jobsheetId
    ? `/api/v1/jobsheets/${jobsheetId}/time-entries`
    : healthCheckId
    ? `/api/v1/health-checks/${healthCheckId}/time-entries`
    : null

  const [data, setData] = useState<JobTimeData | null>(null)
  const [liveSec, setLiveSec] = useState(0)
  const [showHistory, setShowHistory] = useState(false)

  // Keep onData out of the load dependency so an unmemoised callback can't
  // restart the poll loop on every parent render.
  const onDataRef = useRef(onData)
  useEffect(() => { onDataRef.current = onData }, [onData])

  const load = useCallback(async () => {
    if (!token || !timeEntriesPath) return
    try {
      const d = await api<JobTimeData>(timeEntriesPath, { token })
      setData(d)
      onDataRef.current?.(d)
    } catch {
      /* non-critical display — leave the last known data on screen */
    }
  }, [token, timeEntriesPath])

  // Load on mount, when refreshKey changes, and poll while mounted.
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load, refreshKey])

  // Tick the open productive segment every second, capped by the stale guard.
  const activeClockInAt = data?.activeClockInAt ?? null
  useEffect(() => {
    if (!activeClockInAt) {
      setLiveSec(0)
      return
    }
    const clockIn = new Date(activeClockInAt).getTime()
    const calc = () => Math.min(STALE_CLOCK_SEC, Math.max(0, Math.floor((Date.now() - clockIn) / 1000)))
    setLiveSec(calc())
    const t = setInterval(() => setLiveSec(calc()), 1000)
    return () => clearInterval(t)
  }, [activeClockInAt])

  if (!data) return null

  const active = !!data.activeClockInAt
  const stale = active && liveSec >= STALE_CLOCK_SEC
  const jobLive = data.jobMinutes + (active ? liveSec / 60 : 0)

  return (
    <div className={`bg-gray-50 border border-gray-200 rounded-lg p-3 ${className}`}>
      {/* Header: label + live state, and the running/total figure */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Job time</span>
          {active && !stale && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-rag-green truncate">
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rag-green opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rag-green" />
              </span>
              <span className="truncate">{data.activeCategory?.label || 'Clocked on'}</span>
            </span>
          )}
          {stale && (
            <span className="text-xs font-bold text-white bg-rag-amber rounded-full px-1.5 py-px flex-shrink-0">CHECK CLOCK</span>
          )}
        </div>
        {active && !stale ? (
          <span className="text-xl font-bold tabular-nums text-rag-green">{fmtHMS(liveSec)}</span>
        ) : (
          <span className="text-lg font-bold text-gray-900">{fmtMins(jobLive)}</span>
        )}
      </div>

      {/* Breakdown: health-check vs job total vs indirect */}
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

      {/* Expandable per-segment history */}
      {data.entries.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="text-xs text-primary font-medium"
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
                    {seg.autoClosed && <span className="text-rag-amber" title="Auto-closed at end of day">⏱</span>}
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

export default JobTimeSummary
