// Agenda list view — the default. Every day from today forward is its own
// stacked card with a sticky header that doubles as a mini loading board
// (date, job count, booked-vs-available bar, MOT/Wait/Loan counts), bookings
// listed beneath. Designed so you can scan several days of detail at once.
//
// NB: no `overflow-hidden` on any ancestor of the sticky headers — that would
// silently disable position:sticky. Corners are rounded per-child instead.
import { useMemo, useState, useCallback } from 'react'
import { useDiaryRange } from './useDiaryData'
import {
  Spinner, ErrorNote, LoadBar, CapacityFigures, CountPills, BookingRow,
  useBookingOpener, RefreshButton, ToolbarButton, type Density
} from './shared'
import { addDays, isoDow, ALL_DOWS, type DiaryDay, type DiaryBooking } from './types'

const COLLAPSED_KEY = 'vhc_diary_agenda_collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`}
         fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short'
  })
}

function AgendaDay({ day, bookings, isToday, collapsed, onToggle, density, onOpen }: {
  day: DiaryDay
  bookings: DiaryBooking[]
  isToday: boolean
  collapsed: boolean
  onToggle: () => void
  density: Density
  onOpen: (b: DiaryBooking) => void
}) {
  const empty = day.totalJobs === 0
  const showRows = !empty && !collapsed
  return (
    <div className={`bg-white rounded-xl border shadow-sm ${isToday ? 'border-primary' : 'border-gray-200'}`}>
      <div className={`sticky top-0 z-10 bg-white/95 backdrop-blur rounded-t-xl ${showRows ? 'border-b border-gray-200' : 'rounded-b-xl'}`}>
        <button onClick={onToggle} className="w-full text-left px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {!empty && <Chevron open={!collapsed} />}
              <span className={`text-[15px] font-medium ${isToday ? 'text-primary' : 'text-gray-900'}`}>{dayLabel(day.date)}</span>
              {isToday && <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-primary text-white">Today</span>}
              <span className="text-xs text-gray-500">{empty ? 'No bookings' : `${day.totalJobs} ${day.totalJobs === 1 ? 'job' : 'jobs'}`}</span>
            </div>
            {!empty && (
              <CountPills mots={day.totalMots} waiting={day.totalWaiting} loans={day.totalLoans} outreach={day.totalOutreach} />
            )}
          </div>
          {!empty && (
            <div className="flex items-center gap-3 mt-2">
              <LoadBar pct={day.bookedPct} className="w-44 shrink-0" />
              <CapacityFigures
                bookedHours={day.bookedHours}
                availableHours={day.availableHours}
                bookedPct={day.bookedPct}
                freeHours={day.freeHours}
              />
            </div>
          )}
        </button>
      </div>

      {showRows && (
        <div className="flex flex-col gap-1.5 p-3">
          {bookings.map(b => <BookingRow key={b.bookingId} booking={b} onOpen={() => onOpen(b)} density={density} />)}
        </div>
      )}
    </div>
  )
}

export default function AgendaListView({ today, windowDays, onChangeWindow, density, onChangeDensity }: {
  today: string
  windowDays: number
  onChangeWindow: (n: number) => void
  density: Density
  onChangeDensity: (d: Density) => void
}) {
  const from = today
  const to = useMemo(() => addDays(today, windowDays - 1), [today, windowDays])
  const { days, bookings, operatingDays, loading, error, refresh } = useDiaryRange(from, to)

  // Skip non-operating weekdays (closed days), but keep any day that has bookings.
  const opSet = useMemo(() => new Set(operatingDays && operatingDays.length ? operatingDays : ALL_DOWS), [operatingDays])
  const visibleDays = useMemo(
    () => (days || []).filter(d => opSet.has(isoDow(d.date)) || d.totalJobs > 0),
    [days, opSet]
  )
  const { open, modal } = useBookingOpener()

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)

  const toggle = useCallback((date: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date); else next.add(date)
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  const byDate = useMemo(() => {
    const m = new Map<string, DiaryBooking[]>()
    for (const b of bookings || []) {
      const arr = m.get(b.apptDate)
      if (arr) arr.push(b); else m.set(b.apptDate, [b])
    }
    return m
  }, [bookings])

  return (
    <div>
      <div className="flex items-center justify-end gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <ToolbarButton active={windowDays === 14} onClick={() => onChangeWindow(14)}>2 weeks</ToolbarButton>
          <ToolbarButton active={windowDays === 28} onClick={() => onChangeWindow(28)}>4 weeks</ToolbarButton>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <ToolbarButton active={density === 'normal'} onClick={() => onChangeDensity('normal')}>Comfortable</ToolbarButton>
          <ToolbarButton active={density === 'compact'} onClick={() => onChangeDensity('compact')}>Compact</ToolbarButton>
        </div>
        <RefreshButton onClick={() => refresh()} />
      </div>

      {loading && !days ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleDays.map(day => (
            <AgendaDay
              key={day.date}
              day={day}
              bookings={byDate.get(day.date) || []}
              isToday={day.date === today}
              collapsed={collapsed.has(day.date)}
              onToggle={() => toggle(day.date)}
              density={density}
              onOpen={open}
            />
          ))}
        </div>
      )}
      {modal}
    </div>
  )
}
