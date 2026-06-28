// Month view — a calendar grid (Mon–Sun) for the whole month, each day cell a
// mini loading tile (job count, RAG load bar, booked %, MOT/Wait/Loan counts).
// Click a day to drill into its bookings below (shared DayDetail). Adjacent-month
// padding cells are dimmed. Only the month's own days are fetched (≤31, within the
// summary range cap); padding cells render blank.
//
// Non-operating weekday columns (per the site's Operating days setting) are
// hidden — but a weekday that actually has bookings is always shown, so no data
// can disappear. Density (comfortable/compact) controls tile size.
import { useMemo } from 'react'
import { useDiarySummary } from './useDiaryData'
import {
  Spinner, ErrorNote, LoadBar, DayDetail, RefreshButton, ToolbarButton, type Density
} from './shared'
import { addDays, weekStart, addMonths, monthFirst, bandTextClass, isoDow, ALL_DOWS, type DiaryDay } from './types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000)
}

function MonthCell({ date, day, inMonth, isToday, isSelected, roomy, onClick }: {
  date: string
  day: DiaryDay | undefined
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  roomy: boolean
  onClick: () => void
}) {
  const dayNum = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric' })
  const jobs = day?.totalJobs ?? 0
  const pct = day?.bookedPct ?? null
  const pctLabel = pct == null ? '' : `${Math.round(pct * 100)}%`
  const pctTextClass = bandTextClass(day?.band) || 'text-gray-400'

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg flex flex-col transition-colors ${roomy ? 'p-3 min-h-[120px] gap-1.5' : 'p-2 min-h-[88px] gap-1'} ${
        isSelected
          ? 'border-2 border-primary'
          : isToday
            ? 'border border-primary/40 hover:border-primary'
            : 'border border-gray-200 hover:border-gray-300'
      } ${inMonth ? 'bg-white' : 'bg-gray-50'}`}
    >
      <div className="flex items-center justify-between">
        <span className={`${roomy ? 'text-[15px]' : 'text-sm'} ${isToday ? 'text-primary font-bold' : inMonth ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
          {dayNum}
        </span>
        {jobs > 0 && <span className={`text-[11px] ${pctTextClass}`}>{pctLabel}</span>}
      </div>

      {jobs > 0 ? (
        <>
          <LoadBar pct={pct} band={day?.band} />
          <div className={`${roomy ? 'text-xs' : 'text-[11px]'} text-gray-500`}>{jobs} {jobs === 1 ? 'job' : 'jobs'}</div>
          {(day!.totalMots > 0 || day!.totalWaiting > 0 || day!.totalLoans > 0) && (
            <div className="flex flex-wrap gap-1 mt-auto">
              {day!.totalMots > 0 && <span className="px-1 rounded text-[11px] bg-blue-50 text-blue-700">MOT {day!.totalMots}</span>}
              {day!.totalWaiting > 0 && <span className="px-1 rounded text-[11px] bg-amber-50 text-amber-700">Wait {day!.totalWaiting}</span>}
              {day!.totalLoans > 0 && <span className="px-1 rounded text-[11px] bg-indigo-50 text-indigo-700">Loan {day!.totalLoans}</span>}
            </div>
          )}
        </>
      ) : null}
    </button>
  )
}

export default function MonthView({ today, monthOffset, onMonth, selectedDate, onSelectDate, density, onChangeDensity }: {
  today: string
  monthOffset: number
  onMonth: (delta: number) => void
  selectedDate: string
  onSelectDate: (date: string) => void
  density: Density
  onChangeDensity: (d: Density) => void
}) {
  const anchor = useMemo(() => addMonths(monthFirst(today), monthOffset), [today, monthOffset])
  const monthLast = useMemo(() => addDays(addMonths(anchor, 1), -1), [anchor])
  const monthKey = anchor.slice(0, 7)
  const roomy = density === 'normal'

  const { days, operatingDays, loading, error, refresh } = useDiarySummary(anchor, monthLast)

  const byDate = useMemo(() => {
    const m = new Map<string, DiaryDay>()
    for (const d of days || []) m.set(d.date, d)
    return m
  }, [days])

  // Visible weekday columns = operating days, plus any weekday that has bookings
  // this month (so a stray booking on a "closed" day is never hidden).
  const visibleDows = useMemo(() => {
    const op = new Set(operatingDays && operatingDays.length ? operatingDays : ALL_DOWS)
    const jobDows = new Set<number>()
    for (const d of days || []) if (d.totalJobs > 0) jobDows.add(isoDow(d.date))
    return ALL_DOWS.filter(dow => op.has(dow) || jobDows.has(dow))
  }, [operatingDays, days])

  const cells = useMemo(() => {
    const gridStart = weekStart(anchor)
    const weeks = Math.ceil((diffDays(gridStart, monthLast) + 1) / 7)
    const out: string[] = []
    for (let w = 0; w < weeks; w++) {
      for (const dow of visibleDows) out.push(addDays(gridStart, w * 7 + (dow - 1)))
    }
    return out
  }, [anchor, monthLast, visibleDows])

  const gridCols = { gridTemplateColumns: `repeat(${visibleDows.length}, minmax(0, 1fr))` }
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
        <>
          <div className="grid gap-2 mb-2" style={gridCols}>
            {visibleDows.map(dow => (
              <div key={dow} className="text-xs font-medium text-gray-500 px-1">{WEEKDAYS[dow - 1]}</div>
            ))}
          </div>
          <div className="grid gap-2 mb-6" style={gridCols}>
            {cells.map(date => (
              <MonthCell
                key={date}
                date={date}
                day={byDate.get(date)}
                inMonth={date.slice(0, 7) === monthKey}
                isToday={date === today}
                isSelected={date === selectedDate}
                roomy={roomy}
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
