// Grouped list view — a single day, with its bookings segmented into sub-lanes
// by service advisor, job type, or technician. Each lane carries its own job
// count + booked-hours subtotal, so you can read loading per advisor/tech.
import { useMemo } from 'react'
import { useDiaryDay } from './useDiaryData'
import {
  Spinner, ErrorNote, LoadBar, CapacityFigures, CountPills, BookingRow,
  useBookingOpener, RefreshButton, ToolbarButton, type Density
} from './shared'
import {
  addDays, groupValue, GROUP_BY_LABELS,
  type DiaryBooking, type GroupBy
} from './types'

interface Lane {
  key: string
  label: string
  items: DiaryBooking[]
  hours: number
}

function buildLanes(bookings: DiaryBooking[], by: GroupBy): Lane[] {
  const map = new Map<string, Lane>()
  for (const b of bookings) {
    const { key, label } = groupValue(b, by)
    let lane = map.get(key)
    if (!lane) { lane = { key, label, items: [], hours: 0 }; map.set(key, lane) }
    lane.items.push(b)
    lane.hours += b.estimatedHours || 0
  }
  // Most-loaded lanes first; the catch-all (Unassigned / General) always last.
  const isCatchAll = (k: string) => k === 'unassigned' || k === 'type:general'
  return [...map.values()].sort((a, b) => {
    if (isCatchAll(a.key) !== isCatchAll(b.key)) return isCatchAll(a.key) ? 1 : -1
    return b.hours - a.hours
  })
}

export default function GroupedListView({ today, selectedDate, onChangeDate, groupBy, onChangeGroupBy, density }: {
  today: string
  selectedDate: string
  onChangeDate: (date: string) => void
  groupBy: GroupBy
  onChangeGroupBy: (g: GroupBy) => void
  density: Density
}) {
  const { detail, loading, error, refresh } = useDiaryDay(selectedDate)
  const { open, modal } = useBookingOpener()

  const lanes = useMemo(() => buildLanes(detail?.bookings || [], groupBy), [detail, groupBy])

  const heading = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <ToolbarButton onClick={() => onChangeDate(addDays(selectedDate, -1))} title="Previous day">‹</ToolbarButton>
          <ToolbarButton active={selectedDate === today} onClick={() => onChangeDate(today)}>Today</ToolbarButton>
          <ToolbarButton onClick={() => onChangeDate(addDays(selectedDate, 1))} title="Next day">›</ToolbarButton>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="px-2 text-xs text-gray-500">Group by</span>
            {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map(g => (
              <ToolbarButton key={g} active={groupBy === g} onClick={() => onChangeGroupBy(g)}>{GROUP_BY_LABELS[g]}</ToolbarButton>
            ))}
          </div>
          <RefreshButton onClick={() => refresh()} />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
          {detail && (
            <div className="flex items-center gap-3 flex-wrap">
              <LoadBar pct={detail.capacity.bookedPct} className="w-40 shrink-0" />
              <CapacityFigures
                bookedHours={detail.capacity.bookedHours}
                availableHours={detail.capacity.availableHours}
                bookedPct={detail.capacity.bookedPct}
                freeHours={detail.capacity.freeHours}
              />
              <CountPills
                mots={detail.capacity.totalMots}
                waiting={detail.capacity.totalWaiting}
                loans={detail.capacity.totalLoans}
                outreach={detail.capacity.totalOutreach}
              />
            </div>
          )}
        </div>

        {loading && !detail ? (
          <Spinner />
        ) : error ? (
          <ErrorNote message={error} />
        ) : lanes.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">No bookings for this day.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {lanes.map(lane => (
              <div key={lane.key}>
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50 rounded-lg mb-1.5">
                  <span className="text-sm font-medium text-gray-700 truncate">{lane.label}</span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {lane.items.length} {lane.items.length === 1 ? 'job' : 'jobs'} · {Math.round(lane.hours * 100) / 100}h
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {lane.items.map(b => <BookingRow key={b.bookingId} booking={b} onOpen={() => open(b)} density={density} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {modal}
    </div>
  )
}
