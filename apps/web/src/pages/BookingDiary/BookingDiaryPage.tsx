import { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { jobPath } from '../../lib/jobLink'
import { useDiarySummary, useDiaryDay } from './useDiaryData'
import DmsBookingModal from './DmsBookingModal'
import {
  addDays, weekStart, loadTone, toneBarClass, formatTime,
  type DiaryDay, type DiaryBooking
} from './types'

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  )
}

// Horizontal "booked %" bar (RAG coloured, overbooked fill capped at 100% width).
function LoadBar({ pct }: { pct: number | null }) {
  const tone = loadTone(pct)
  const width = pct == null ? 0 : Math.min(pct, 1) * 100
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${toneBarClass(tone)}`} style={{ width: `${width}%` }} />
    </div>
  )
}

function CountPill({ label, count, classes }: { label: string; count: number; classes: string }) {
  const active = count > 0
  return (
    <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium ${active ? classes : 'bg-gray-50 text-gray-400'}`}>
      {label} {count}
    </span>
  )
}

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

      <div className="flex flex-wrap gap-1">
        <CountPill label="MOT" count={day.totalMots} classes="bg-blue-50 text-blue-700" />
        <CountPill label="Wait" count={day.totalWaiting} classes="bg-amber-50 text-amber-700" />
        <CountPill label="Loan" count={day.totalLoans} classes="bg-indigo-50 text-indigo-700" />
      </div>
    </button>
  )
}

function Badge({ label, classes }: { label: string; classes: string }) {
  return <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium ${classes}`}>{label}</span>
}

function BookingRow({ booking, onOpen }: { booking: DiaryBooking; onOpen: () => void }) {
  const subtitle = [booking.customerName, booking.serviceType].filter(Boolean).join(' · ')
  return (
    <button
      onClick={onOpen}
      className="w-full text-left flex items-center gap-3 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
    >
      <span className="text-sm font-medium text-gray-900 w-12 shrink-0">{formatTime(booking.apptTime)}</span>
      <span className="text-sm font-mono text-gray-700 w-20 shrink-0">{booking.registration || '—'}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-gray-700 truncate">{subtitle || '—'}</span>
        {booking.description && (
          <span className="block text-xs text-gray-400 truncate" title={booking.description}>{booking.description}</span>
        )}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        {booking.isMot && <Badge label="MOT" classes="bg-blue-50 text-blue-700" />}
        {booking.isWaiting && <Badge label="Wait" classes="bg-amber-50 text-amber-700" />}
        {booking.isLoan && <Badge label="Loan" classes="bg-indigo-50 text-indigo-700" />}
      </span>
      <span className="text-sm text-gray-700 w-12 text-right shrink-0">{booking.estimatedHours}h</span>
      <span className="text-[10px] uppercase tracking-wide text-gray-400 w-9 text-right shrink-0">{booking.source}</span>
    </button>
  )
}

function DayDetail({ date }: { date: string }) {
  const navigate = useNavigate()
  const { detail, loading, error } = useDiaryDay(date)
  const [modalHcId, setModalHcId] = useState<string | null>(null)

  // DMS bookings open a rich detail modal; GMS bookings open their jobsheet.
  const openBooking = (b: DiaryBooking) => {
    if (b.source === 'dms' && b.routeTarget.healthCheckId) {
      setModalHcId(b.routeTarget.healthCheckId)
    } else {
      navigate(jobPath({ jobsheetId: b.routeTarget.jobsheetId, healthCheckId: b.routeTarget.healthCheckId }))
    }
  }

  const heading = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
        {detail && (
          <span className="text-sm text-gray-500">
            {detail.capacity.bookedHours} / {detail.capacity.availableHours}h loaded
            {detail.capacity.freeHours > 0 && (
              <span className="text-rag-green"> · {detail.capacity.freeHours}h free</span>
            )}
          </span>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-xl px-4 py-3 text-sm">{error}</div>
      ) : !detail || detail.bookings.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-gray-400">No bookings for this day.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {detail.bookings.map(b => (
            <BookingRow
              key={b.bookingId}
              booking={b}
              onOpen={() => openBooking(b)}
            />
          ))}
        </div>
      )}

      {modalHcId && (
        <DmsBookingModal
          healthCheckId={modalHcId}
          onClose={() => setModalHcId(null)}
          onOpenFull={() => { const id = modalHcId; setModalHcId(null); navigate(jobPath({ healthCheckId: id })) }}
        />
      )}
    </div>
  )
}

export default function BookingDiaryPage() {
  const { user } = useAuth()
  const today = todayStr()
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(today)

  const weekFrom = useMemo(() => weekStart(addDays(today, weekOffset * 7)), [today, weekOffset])
  const weekTo = useMemo(() => addDays(weekFrom, 6), [weekFrom])

  const { days, loading, error, refresh } = useDiarySummary(weekFrom, weekTo)

  const goWeek = useCallback((delta: number) => {
    const next = weekOffset + delta
    setWeekOffset(next)
    setSelectedDate(next === 0 ? today : weekStart(addDays(today, next * 7)))
  }, [weekOffset, today])

  const rangeLabel = `${new Date(`${weekFrom}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(`${weekTo}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Booking Diary</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Jobs, workshop loading &amp; job types per day{user?.site?.name ? ` · ${user.site.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => goWeek(-1)} className="px-2.5 py-1.5 text-sm font-medium rounded-md text-gray-500 hover:text-gray-900" title="Previous week">‹ Prev</button>
            <button onClick={() => goWeek(-weekOffset)} className={`px-2.5 py-1.5 text-sm font-medium rounded-md ${weekOffset === 0 ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>This week</button>
            <button onClick={() => goWeek(1)} className="px-2.5 py-1.5 text-sm font-medium rounded-md text-gray-500 hover:text-gray-900" title="Next week">Next ›</button>
          </div>
          <span className="text-sm font-medium text-gray-600 hidden sm:inline">{rangeLabel}</span>
          <button
            onClick={() => refresh()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-xl px-4 py-3 text-sm">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
            {(days || []).map(day => (
              <DayCard
                key={day.date}
                day={day}
                isSelected={day.date === selectedDate}
                isToday={day.date === today}
                onClick={() => setSelectedDate(day.date)}
              />
            ))}
          </div>

          <DayDetail date={selectedDate} />
        </>
      )}
    </div>
  )
}
