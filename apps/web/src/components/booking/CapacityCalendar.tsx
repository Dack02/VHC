import { useState, useEffect, useMemo } from 'react'
import { api } from '../../lib/api'

/**
 * Capacity-coloured month calendar (Resource Manager) — the booking picker's
 * "pick any date" surface, replacing a raw <input type="date">. Each day is tinted
 * by its workshop load so far-future and customer-demanded dates are still chosen
 * through the capacity surface. Unbounded by the booking window. When the site has
 * no technician shifts configured it degrades to a plain calendar + a setup nudge.
 */

type Band = 'closed' | 'low' | 'healthy' | 'high' | 'over'
interface CalDay { date: string; band: Band; bookedPct: number | null; availableHours: number; freeHours: number; isOpen: boolean }
interface CalResponse { siteId: string; configured: boolean; days: CalDay[] }

const BAND_DOT: Record<Band, string> = {
  closed: 'bg-transparent', low: 'bg-blue-400', healthy: 'bg-rag-green', high: 'bg-rag-amber', over: 'bg-rag-red'
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => new Date(`${s}T12:00:00`)
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d) }
const isoDow = (s: string) => { const d = parse(s).getDay(); return ((d + 6) % 7) + 1 }
const monthLabel = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

export default function CapacityCalendar({
  token, siteId, jobsheetId, estimateId, healthCheckId, value, minDate, onSelect, refreshKey = 0
}: {
  token: string
  siteId?: string
  jobsheetId?: string; estimateId?: string; healthCheckId?: string
  value: string
  minDate?: string
  onSelect: (date: string) => void
  refreshKey?: number
}) {
  const today = ymd(new Date())
  const floor = minDate || today
  const [viewMonth, setViewMonth] = useState(() => {
    const base = value && value >= floor ? value : floor
    const d = parse(base)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [data, setData] = useState<CalResponse | null>(null)
  const [loading, setLoading] = useState(false)

  // 6-week grid starting on the Monday on/before the 1st of the visible month.
  const cells = useMemo(() => {
    const first = ymd(viewMonth)
    const gridStart = addDays(first, -(isoDow(first) - 1))
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  }, [viewMonth])

  useEffect(() => {
    const hasTarget = !!(siteId || jobsheetId || estimateId || healthCheckId)
    if (!token || !hasTarget) { setData(null); return }
    let cancelled = false
    setLoading(true)
    const qs = siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''
    api<CalResponse>(`/api/v1/resource-manager/calendar${qs}`, {
      method: 'POST', token, body: { from: cells[0], to: cells[41], jobsheetId, estimateId, healthCheckId }
    })
      .then(r => { if (!cancelled) setData(r) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token, siteId, cells, jobsheetId, estimateId, healthCheckId, refreshKey])

  const byDate = useMemo(() => {
    const m = new Map<string, CalDay>()
    for (const d of data?.days || []) m.set(d.date, d)
    return m
  }, [data])
  const configured = data?.configured !== false
  const viewMonthIdx = viewMonth.getMonth()
  const navBtn = 'h-7 w-7 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100'

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className={navBtn} aria-label="Previous month">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-sm font-semibold text-gray-900">{monthLabel(viewMonth)}</span>
        <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className={navBtn} aria-label="Next month">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[10px] font-medium text-gray-400">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(c => {
          const inMonth = parse(c).getMonth() === viewMonthIdx
          const day = byDate.get(c)
          const disabled = c < floor || !day || !day.isOpen
          const sel = c === value
          const isToday = c === today
          const pct = day?.bookedPct != null ? `${Math.round(day.bookedPct * 100)}% loaded` : ''
          return (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(c)}
              title={configured && day && day.isOpen ? [pct, day.freeHours ? `${day.freeHours}h free` : ''].filter(Boolean).join(' · ') : undefined}
              className={`relative h-9 rounded-lg text-xs flex flex-col items-center justify-center transition-colors ${
                sel ? 'bg-gray-900 text-white'
                  : disabled ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-700 hover:bg-gray-100'
              } ${!inMonth && !sel ? 'opacity-40' : ''} ${isToday && !sel ? 'ring-1 ring-gray-300' : ''}`}
            >
              <span className="leading-none">{parse(c).getDate()}</span>
              {configured && day && day.isOpen && !sel && (
                <span className={`mt-1 h-1 w-1 rounded-full ${BAND_DOT[day.band]}`} />
              )}
            </button>
          )
        })}
      </div>
      {!configured && (
        <p className="mt-2 text-[11px] text-gray-400">Set up Workshop Capacity (Settings → Capacity) to colour days by how busy they are.</p>
      )}
      {loading && !data && <p className="mt-2 text-[11px] text-gray-400">Loading workshop load…</p>}
    </div>
  )
}
