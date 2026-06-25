// Shared presentation pieces for the Booking Diary views (Week / Agenda /
// Grouped / Table). Kept in one place so every view renders bookings, badges,
// load bars and capacity figures identically.
import { useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { jobPath } from '../../lib/jobLink'
import DmsBookingModal from './DmsBookingModal'
import { useDiaryDay } from './useDiaryData'
import {
  formatTime, loadTone, toneBarClass, statusStripeClass,
  type DiaryBooking
} from './types'

export type Density = 'normal' | 'compact'

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-xl px-4 py-3 text-sm">{message}</div>
  )
}

// Horizontal "booked %" bar (RAG coloured, overbooked fill capped at 100% width).
export function LoadBar({ pct, className = '' }: { pct: number | null; className?: string }) {
  const tone = loadTone(pct)
  const width = pct == null ? 0 : Math.min(pct, 1) * 100
  return (
    <div className={`h-1.5 bg-gray-100 rounded-full overflow-hidden ${className}`}>
      <div className={`h-full ${toneBarClass(tone)}`} style={{ width: `${width}%` }} />
    </div>
  )
}

// "12.5 / 16h · 78%" + "3.5h free" — the per-day capacity figures, RAG-aware.
export function CapacityFigures({ bookedHours, availableHours, bookedPct, freeHours }: {
  bookedHours: number; availableHours: number; bookedPct: number | null; freeHours: number
}) {
  const tone = loadTone(bookedPct)
  const pctLabel = bookedPct == null ? '—' : `${Math.round(bookedPct * 100)}%`
  return (
    <span className="text-[13px] text-gray-500 whitespace-nowrap">
      {bookedHours} / {availableHours}h ·{' '}
      <span className={tone === 'red' ? 'text-rag-red font-medium' : ''}>{pctLabel}{tone === 'red' ? ' over' : ''}</span>
      {bookedPct != null && tone !== 'red' && freeHours > 0 && (
        <span className="text-rag-green"> · {freeHours}h free</span>
      )}
    </span>
  )
}

export function Badge({ label, classes }: { label: string; classes: string }) {
  return <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium ${classes}`}>{label}</span>
}

// Outreach / MOT / Wait / Loan flag badges for one booking (only the active ones).
export function BadgeStrip({ booking }: { booking: DiaryBooking }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {booking.isOutreach && <Badge label="Outreach" classes="bg-emerald-50 text-emerald-700" />}
      {booking.isMot && <Badge label="MOT" classes="bg-blue-50 text-blue-700" />}
      {booking.isWaiting && <Badge label="Wait" classes="bg-amber-50 text-amber-700" />}
      {booking.isLoan && <Badge label="Loan" classes="bg-indigo-50 text-indigo-700" />}
    </span>
  )
}

export function CountPill({ label, count, classes }: { label: string; count: number; classes: string }) {
  const active = count > 0
  return (
    <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium ${active ? classes : 'bg-gray-50 text-gray-400'}`}>
      {label} {count}
    </span>
  )
}

// MOT / Wait / Loan (and Outreach when present) counts for a day header.
export function CountPills({ mots, waiting, loans, outreach }: {
  mots: number; waiting: number; loans: number; outreach: number
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <CountPill label="MOT" count={mots} classes="bg-blue-50 text-blue-700" />
      <CountPill label="Wait" count={waiting} classes="bg-amber-50 text-amber-700" />
      <CountPill label="Loan" count={loans} classes="bg-indigo-50 text-indigo-700" />
      {outreach > 0 && <CountPill label="Outreach" count={outreach} classes="bg-emerald-50 text-emerald-700" />}
    </div>
  )
}

// One booking row, reused by the Week / Agenda / Grouped views. A left status
// stripe surfaces live workshop state; `compact` density drops the description.
export function BookingRow({ booking, onOpen, density = 'normal' }: {
  booking: DiaryBooking; onOpen: () => void; density?: Density
}) {
  const subtitle = [booking.customerName, booking.serviceType].filter(Boolean).join(' · ')
  const pad = density === 'compact' ? 'py-1.5' : 'py-2'
  return (
    <button
      onClick={onOpen}
      className={`relative w-full text-left flex items-center gap-3 pl-4 pr-3 ${pad} border border-gray-200 rounded-lg hover:bg-gray-50`}
    >
      <span className={`absolute left-1 top-2 bottom-2 w-1 rounded-full ${statusStripeClass(booking)}`} aria-hidden="true" />
      <span className="text-sm font-medium text-gray-900 w-12 shrink-0">{formatTime(booking.apptTime)}</span>
      <span className="text-sm font-mono text-gray-700 w-20 shrink-0">{booking.registration || '—'}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-gray-700 truncate">{subtitle || '—'}</span>
        {booking.description && density !== 'compact' && (
          <span className="block text-xs text-gray-400 truncate" title={booking.description}>{booking.description}</span>
        )}
      </span>
      <BadgeStrip booking={booking} />
      <span className="text-sm text-gray-700 w-12 text-right shrink-0">{booking.estimatedHours}h</span>
      <span className="text-[10px] uppercase tracking-wide text-gray-400 w-9 text-right shrink-0">{booking.source}</span>
    </button>
  )
}

/**
 * Opens a booking the same way everywhere: DMS imports show the rich detail
 * modal, GMS jobsheets navigate to the job card. Returns the click handler plus
 * the modal node to drop once into the view.
 */
export function useBookingOpener(): { open: (b: DiaryBooking) => void; modal: ReactNode } {
  const navigate = useNavigate()
  const location = useLocation()
  const [modalHcId, setModalHcId] = useState<string | null>(null)

  // Carry the diary as the origin so the job card / VHC can offer a "back to diary"
  // link. Lives in the query string (not router state) so it survives tab switches.
  const go = (path: string) => {
    const q = new URLSearchParams({ from: location.pathname, fromLabel: 'Diary' }).toString()
    navigate(`${path}${path.includes('?') ? '&' : '?'}${q}`)
  }

  const open = (b: DiaryBooking) => {
    if (b.source === 'dms' && b.routeTarget.healthCheckId) {
      setModalHcId(b.routeTarget.healthCheckId)
    } else {
      go(jobPath({ jobsheetId: b.routeTarget.jobsheetId, healthCheckId: b.routeTarget.healthCheckId }))
    }
  }

  const modal = modalHcId ? (
    <DmsBookingModal
      healthCheckId={modalHcId}
      onClose={() => setModalHcId(null)}
      onOpenFull={() => { const id = modalHcId; setModalHcId(null); go(jobPath({ healthCheckId: id })) }}
    />
  ) : null

  return { open, modal }
}

// A small outline pill button used in the view sub-toolbars.
export function ToolbarButton({ children, onClick, active, title }: {
  children: ReactNode; onClick?: () => void; active?: boolean; title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2.5 py-1.5 text-sm font-medium rounded-md ${
        active ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  )
}

export function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Refresh
    </button>
  )
}

// The selected day's bookings + capacity header. Shared by the Week and Month views.
export function DayDetail({ date, density }: { date: string; density: Density }) {
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
