import { useState, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useDiarySummary, useDiaryDay } from './useDiaryData'
import {
  Spinner, ErrorNote, LoadBar, CapacityFigures, CountPills, BookingRow,
  useBookingOpener, RefreshButton, type Density
} from './shared'
import { addDays, weekStart, loadTone, type DiaryDay, type GroupBy } from './types'
import AgendaListView from './AgendaListView'
import GroupedListView from './GroupedListView'
import TableListView from './TableListView'

type ViewMode = 'agenda' | 'grouped' | 'table' | 'week'

const VIEW_KEY = 'vhc_diary_view'
const GROUP_KEY = 'vhc_diary_groupby'
const DENSITY_KEY = 'vhc_diary_density'

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'grouped', label: 'Grouped' },
  { key: 'table', label: 'Table' },
  { key: 'week', label: 'Week' }
]

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    return allowed.includes(saved as T) ? (saved as T) : fallback
  } catch { return fallback }
}

function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

// One day in the Week strip.
function DayCard({ day, isSelected, isToday, onClick }: {
  day: DiaryDay; isSelected: boolean; isToday: boolean; onClick: () => void
}) {
  const d = new Date(`${day.date}T12:00:00`)
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' })
  const dayNum = d.toLocaleDateString('en-GB', { day: 'numeric' })
  const pct = day.bookedPct
  const tone = loadTone(pct)
  const pctLabel = pct == null ? '—' : `${Math.round(pct * 100)}%`
  const pctTextClass = tone === 'red' ? 'text-rag-red' : 'text-gray-500'

  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-xl p-3 shadow-sm transition-colors ${
        isSelected ? 'border-2 border-primary' : 'border border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className={`text-xs ${isToday ? 'text-primary font-medium' : 'text-gray-500'}`}>
        {weekday}{isToday ? ' · today' : ''}
      </div>
      <div className="text-lg font-bold text-gray-900 leading-tight">{dayNum}</div>
      <div className="text-xs text-gray-500 mb-2">{day.totalJobs} {day.totalJobs === 1 ? 'job' : 'jobs'}</div>

      <LoadBar pct={pct} />
      <div className={`text-[11px] mt-1 mb-2 ${pctTextClass}`}>
        {day.bookedHours} / {day.availableHours}h · {pctLabel}
      </div>

      <CountPills mots={day.totalMots} waiting={day.totalWaiting} loans={day.totalLoans} outreach={day.totalOutreach} />
    </button>
  )
}

// The selected day's bookings (under the Week strip).
function DayDetail({ date, density }: { date: string; density: Density }) {
  const { detail, loading, error } = useDiaryDay(date)
  const { open, modal } = useBookingOpener()

  const heading = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
        {detail && (
          <CapacityFigures
            bookedHours={detail.capacity.bookedHours}
            availableHours={detail.capacity.availableHours}
            bookedPct={detail.capacity.bookedPct}
            freeHours={detail.capacity.freeHours}
          />
        )}
      </div>

      {loading && !detail ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : !detail || detail.bookings.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-gray-400">No bookings for this day.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {detail.bookings.map(b => <BookingRow key={b.bookingId} booking={b} onOpen={() => open(b)} density={density} />)}
        </div>
      )}
      {modal}
    </div>
  )
}

// The original week strip + day drill-in.
function WeekView({ today, weekOffset, onWeek, selectedDate, onSelectDate, density }: {
  today: string
  weekOffset: number
  onWeek: (delta: number) => void
  selectedDate: string
  onSelectDate: (date: string) => void
  density: Density
}) {
  const weekFrom = weekStart(addDays(today, weekOffset * 7))
  const weekTo = addDays(weekFrom, 6)
  const { days, loading, error, refresh } = useDiarySummary(weekFrom, weekTo)

  const rangeLabel = `${new Date(`${weekFrom}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(`${weekTo}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  return (
    <div>
      <div className="flex items-center justify-end gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={() => onWeek(-1)} className="px-2.5 py-1.5 text-sm font-medium rounded-md text-gray-500 hover:text-gray-900" title="Previous week">‹ Prev</button>
          <button onClick={() => onWeek(-weekOffset)} className={`px-2.5 py-1.5 text-sm font-medium rounded-md ${weekOffset === 0 ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>This week</button>
          <button onClick={() => onWeek(1)} className="px-2.5 py-1.5 text-sm font-medium rounded-md text-gray-500 hover:text-gray-900" title="Next week">Next ›</button>
        </div>
        <span className="text-sm font-medium text-gray-600 hidden sm:inline">{rangeLabel}</span>
        <RefreshButton onClick={() => refresh()} />
      </div>

      {loading && !days ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
            {(days || []).map(day => (
              <DayCard
                key={day.date}
                day={day}
                isSelected={day.date === selectedDate}
                isToday={day.date === today}
                onClick={() => onSelectDate(day.date)}
              />
            ))}
          </div>
          <DayDetail date={selectedDate} density={density} />
        </>
      )}
    </div>
  )
}

export default function BookingDiaryPage() {
  const { user } = useAuth()
  const today = todayStr()

  const [view, setView] = useState<ViewMode>(() => loadPref(VIEW_KEY, ['agenda', 'grouped', 'table', 'week'] as const, 'agenda'))
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(today)
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadPref(GROUP_KEY, ['advisor', 'type', 'technician'] as const, 'advisor'))
  const [density, setDensity] = useState<Density>(() => loadPref(DENSITY_KEY, ['normal', 'compact'] as const, 'normal'))
  const [agendaWindow, setAgendaWindow] = useState(14)

  const changeView = (v: ViewMode) => { setView(v); savePref(VIEW_KEY, v) }
  const changeGroupBy = (g: GroupBy) => { setGroupBy(g); savePref(GROUP_KEY, g) }
  const changeDensity = (d: Density) => { setDensity(d); savePref(DENSITY_KEY, d) }

  // Stepping weeks keeps the day drill-in pointed at the new week.
  const goWeek = useCallback((delta: number) => {
    const next = weekOffset + delta
    setWeekOffset(next)
    setSelectedDate(next === 0 ? today : weekStart(addDays(today, next * 7)))
  }, [weekOffset, today])

  return (
    <div className={`${view === 'table' ? 'max-w-7xl' : 'max-w-6xl'} mx-auto`}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Booking Diary</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Jobs, workshop loading &amp; job types per day{user?.site?.name ? ` · ${user.site.name}` : ''}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {VIEWS.map(v => (
            <button
              key={v.key}
              onClick={() => changeView(v.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                view === v.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'agenda' && (
        <AgendaListView
          today={today}
          windowDays={agendaWindow}
          onChangeWindow={setAgendaWindow}
          density={density}
          onChangeDensity={changeDensity}
        />
      )}
      {view === 'grouped' && (
        <GroupedListView
          today={today}
          selectedDate={selectedDate}
          onChangeDate={setSelectedDate}
          groupBy={groupBy}
          onChangeGroupBy={changeGroupBy}
          density={density}
        />
      )}
      {view === 'table' && (
        <TableListView
          today={today}
          weekOffset={weekOffset}
          onWeek={goWeek}
          density={density}
          onChangeDensity={changeDensity}
        />
      )}
      {view === 'week' && (
        <WeekView
          today={today}
          weekOffset={weekOffset}
          onWeek={goWeek}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          density={density}
        />
      )}
    </div>
  )
}
