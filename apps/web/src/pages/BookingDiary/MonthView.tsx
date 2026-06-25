// Month view — a calendar grid (Mon–Sun) for the whole month, each day cell a
// mini loading tile (job count, RAG load bar, booked %, MOT/Wait/Loan counts).
// Click a day to drill into its bookings below (shared DayDetail). Adjacent-month
// padding cells are dimmed. Only the month's own days are fetched (≤31, within the
// summary range cap); padding cells render blank.
import { useMemo } from 'react'
import { useDiarySummary } from './useDiaryData'
import {
  Spinner, ErrorNote, LoadBar, DayDetail, RefreshButton, ToolbarButton, type Density
} from './shared'
import { addDays, weekStart, addMonths, monthFirst, loadTone, type DiaryDay } from './types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000)
}

function MonthCell({ date, day, inMonth, isToday, isSelected, onClick }: {
  date: string
  day: DiaryDay | undefined
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  onClick: () => void
}) {
  const dayNum = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric' })
  const jobs = day?.totalJobs ?? 0
  const pct = day?.bookedPct ?? null
  const tone = loadTone(pct)
  const pctLabel = pct == null ? '' : `${Math.round(pct * 100)}%`
  const pctTextClass = tone === 'red' ? 'text-rag-red' : 'text-gray-400'

  return (
    <button
      onClick={onClick}
      className={`text-left p-2 min-h-[96px] rounded-lg flex flex-col gap-1 transition-colors ${
        isSelected
          ? 'border-2 border-primary'
          : isToday
            ? 'border border-primary/40 hover:border-primary'
            : 'border border-gray-200 hover:border-gray-300'
      } ${inMonth ? 'bg-white' : 'bg-gray-50'}`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm ${isToday ? 'text-primary font-bold' : inMonth ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
          {dayNum}
        </span>
        {jobs > 0 && <span className={`text-[10px] ${pctTextClass}`}>{pctLabel}</span>}
      </div>

      {jobs > 0 ? (
        <>
          <LoadBar pct={pct} />
          <div className="text-[11px] text-gray-500">{jobs} {jobs === 1 ? 'job' : 'jobs'}</div>
          {(day!.totalMots > 0 || day!.totalWaiting > 0 || day!.totalLoans > 0) && (
            <div className="flex flex-wrap gap-1 mt-auto">
              {day!.totalMots > 0 && <span className="px-1 rounded text-[10px] bg-blue-50 text-blue-700">MOT {day!.totalMots}</span>}
              {day!.totalWaiting > 0 && <span className="px-1 rounded text-[10px] bg-amber-50 text-amber-700">Wait {day!.totalWaiting}</span>}
              {day!.totalLoans > 0 && <span className="px-1 rounded text-[10px] bg-indigo-50 text-indigo-700">Loan {day!.totalLoans}</span>}
            </div>
          )}
        </>
      ) : null}
    </button>
  )
}

export default function MonthView({ today, monthOffset, onMonth, selectedDate, onSelectDate, density }: {
  today: string
  monthOffset: number
  onMonth: (delta: number) => void
  selectedDate: string
  onSelectDate: (date: string) => void
  density: Density
}) {
  const anchor = useMemo(() => addMonths(monthFirst(today), monthOffset), [today, monthOffset])
  const monthLast = useMemo(() => addDays(addMonths(anchor, 1), -1), [anchor])
  const monthKey = anchor.slice(0, 7)

  const { days, loading, error, refresh } = useDiarySummary(anchor, monthLast)

  const byDate = useMemo(() => {
    const m = new Map<string, DiaryDay>()
    for (const d of days || []) m.set(d.date, d)
    return m
  }, [days])

  const cells = useMemo(() => {
    const gridStart = weekStart(anchor)
    const weeks = Math.ceil((diffDays(gridStart, monthLast) + 1) / 7)
    return Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i))
  }, [anchor, monthLast])

  const monthLabel = new Date(`${anchor}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="flex items-center justify-end gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <ToolbarButton onClick={() => onMonth(-1)} title="Previous month">‹ Prev</ToolbarButton>
          <ToolbarButton active={monthOffset === 0} onClick={() => onMonth(-monthOffset)}>This month</ToolbarButton>
          <ToolbarButton onClick={() => onMonth(1)} title="Next month">Next ›</ToolbarButton>
        </div>
        <span className="text-sm font-medium text-gray-600 hidden sm:inline">{monthLabel}</span>
        <RefreshButton onClick={() => refresh()} />
      </div>

      {loading && !days ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : (
        <>
          <div className="grid grid-cols-7 gap-2 mb-2">
            {WEEKDAYS.map(w => (
              <div key={w} className="text-xs font-medium text-gray-500 px-1">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2 mb-6">
            {cells.map(date => (
              <MonthCell
                key={date}
                date={date}
                day={byDate.get(date)}
                inMonth={date.slice(0, 7) === monthKey}
                isToday={date === today}
                isSelected={date === selectedDate}
                onClick={() => onSelectDate(date)}
              />
            ))}
          </div>
          <DayDetail date={selectedDate} density={density} />
        </>
      )}
    </div>
  )
}
