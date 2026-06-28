// Shared presentation pieces for the Booking Diary views (Week / Agenda /
// Grouped / Table). Kept in one place so every view renders bookings, badges,
// load bars and capacity figures identically.
import { useState, useEffect, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { jobPath } from '../../lib/jobLink'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import DmsBookingModal from './DmsBookingModal'
import { useDiaryDay } from './useDiaryData'
import {
  formatTime, loadTone, barClassFor, bandTextClass, statusStripeClass,
  type DiaryBooking, type CapacityBand
} from './types'

// Per-category capacity for a day (Resource Manager). Counter chips show booked
// vs the category's job cap (or hours), so a day filling with one job type shows.
interface DayCatChip {
  repairTypeId: string
  label: string
  colour: string
  bookedHours: number
  bookedJobs: number
  hoursCeiling: number
  jobCeiling: number | null
  hardCapJobs: number | null
}

function chipTone(ratio: number): string {
  if (ratio >= 1) return 'bg-rag-red/10 text-rag-red'
  if (ratio >= 0.85) return 'bg-rag-amber/10 text-rag-amber'
  return 'bg-gray-100 text-gray-600'
}

// Category counter chips for a day's drill-in (e.g. "MOT 4/16 · Diag 9/15").
function CategoryCounters({ date }: { date: string }) {
  const { session, user } = useAuth()
  const [cats, setCats] = useState<DayCatChip[] | null>(null)

  useEffect(() => {
    const token = session?.accessToken
    if (!token) return
    let cancelled = false
    const params = new URLSearchParams({ date })
    if (user?.site?.id) params.set('siteId', user.site.id)
    api<{ capacity: { categories: DayCatChip[] } }>(`/api/v1/resource-manager/capacity/day?${params}`, { token })
      .then(r => { if (!cancelled) setCats(r.capacity.categories) })
      .catch(() => { if (!cancelled) setCats([]) })
    return () => { cancelled = true }
  }, [date, session?.accessToken, user?.site?.id])

  if (!cats) return null
  const shown = cats.filter(c => c.bookedJobs > 0 || c.jobCeiling != null || c.hardCapJobs != null)
  if (!shown.length) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(c => {
        const cap = c.hardCapJobs ?? c.jobCeiling
        const label = cap != null
          ? `${c.label} ${c.bookedJobs}/${cap}`
          : c.hoursCeiling > 0 ? `${c.label} ${c.bookedHours}/${c.hoursCeiling}h` : `${c.label} ${c.bookedHours}h`
        const ratio = cap != null ? (cap > 0 ? c.bookedJobs / cap : 0) : (c.hoursCeiling > 0 ? c.bookedHours / c.hoursCeiling : 0)
        return (
          <span key={c.repairTypeId} className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium ${chipTone(ratio)}`}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

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

// Horizontal "booked %" bar. Colour from the server `band` (config-driven target)
// when present, else the legacy 85% loadTone. Overbooked fill capped at 100% width.
export function LoadBar({ pct, band, className = '' }: { pct: number | null; band?: CapacityBand; className?: string }) {
  const width = pct == null ? 0 : Math.min(pct, 1) * 100
  return (
    <div className={`h-1.5 bg-gray-100 rounded-full overflow-hidden ${className}`}>
      <div className={`h-full ${barClassFor(band, pct)}`} style={{ width: `${width}%` }} />
    </div>
  )
}

// "12.5 / 16h · 78%" + "3.5h free" — the per-day capacity figures, band-aware
// (over = red, low = blue "room to fill"). Falls back to loadTone when no band.
export function CapacityFigures({ bookedHours, availableHours, bookedPct, freeHours, band }: {
  bookedHours: number; availableHours: number; bookedPct: number | null; freeHours: number; band?: CapacityBand
}) {
  const tone = loadTone(bookedPct)
  const effBand: CapacityBand = band ?? (tone === 'red' ? 'over' : tone === 'amber' ? 'high' : tone === 'green' ? 'healthy' : 'closed')
  const pctLabel = bookedPct == null ? '—' : `${Math.round(bookedPct * 100)}%`
  const over = effBand === 'over'
  return (
    <span className="text-[13px] text-gray-500 whitespace-nowrap">
      {bookedHours} / {availableHours}h ·{' '}
      <span className={`${bandTextClass(effBand)} ${over ? 'font-medium' : ''}`}>{pctLabel}{over ? ' over' : ''}</span>
      {!over && freeHours > 0 && (
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

// One booking row, reused by the Week / Agenda / Grouped views. Columns: status
// stripe, time, reg, customer, "booked for" (what the job is — the widest column),
// type badges, hours, source. `compact` density only tightens row padding.
export function BookingRow({ booking, onOpen, density = 'normal' }: {
  booking: DiaryBooking; onOpen: () => void; density?: Density
}) {
  const customer = booking.customerName || '—'
  // "Booked for": the work summary. Prefix the service type when it adds info
  // beyond the description. Collapse the CR/LF the DMS notes carry.
  const desc = (booking.description || '').replace(/\s+/g, ' ').trim()
  const svc = (booking.serviceType || '').trim()
  const bookedFor = desc && svc && desc.toLowerCase() !== svc.toLowerCase()
    ? `${svc} · ${desc}`
    : (desc || svc || '—')
  const pad = density === 'compact' ? 'py-1.5' : 'py-2'
  return (
    <button
      onClick={onOpen}
      className={`relative w-full text-left flex items-center gap-3 pl-4 pr-3 ${pad} border border-gray-200 rounded-lg hover:bg-gray-50`}
    >
      <span className={`absolute left-1 top-2 bottom-2 w-1 rounded-full ${statusStripeClass(booking)}`} aria-hidden="true" />
      <span className="text-sm font-medium text-gray-900 w-12 shrink-0">{formatTime(booking.apptTime)}</span>
      <span className="text-sm font-mono text-gray-700 w-20 shrink-0">{booking.registration || '—'}</span>
      <span className="text-sm text-gray-700 w-40 shrink-0 truncate" title={customer}>{customer}</span>
      <span className="flex-1 min-w-0 text-sm text-gray-600 truncate" title={bookedFor}>{bookedFor}</span>
      <BadgeStrip booking={booking} />
      <span className="text-sm text-gray-700 w-12 text-right shrink-0">{booking.estimatedHours}h</span>
      <span className="text-[10px] uppercase tracking-wide text-gray-400 w-9 text-right shrink-0">{booking.source}</span>
    </button>
  )
}

// Small column headers aligned to BookingRow's columns (same widths/padding/gap).
// The status stripe sits in BookingRow's pl-4 gutter, so the header starts at pl-4 too.
export function BookingListHeader() {
  return (
    <div className="flex items-center gap-3 pl-4 pr-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
      <span className="w-12 shrink-0">Time</span>
      <span className="w-20 shrink-0">Reg</span>
      <span className="w-40 shrink-0">Customer</span>
      <span className="flex-1 min-w-0">Booked for</span>
      <span className="shrink-0">Type</span>
      <span className="w-12 text-right shrink-0">Hrs</span>
      <span className="w-9 text-right shrink-0">Src</span>
    </div>
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
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
        {detail && (
          <CapacityFigures
            bookedHours={detail.capacity.bookedHours}
            availableHours={detail.capacity.availableHours}
            bookedPct={detail.capacity.bookedPct}
            freeHours={detail.capacity.freeHours}
            band={detail.capacity.band}
          />
        )}
      </div>
      <div className="mb-4"><CategoryCounters date={date} /></div>

      {loading && !detail ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : !detail || detail.bookings.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-gray-400">No bookings for this day.</div>
      ) : (
        <>
          <BookingListHeader />
          <div className="flex flex-col gap-1.5">
            {detail.bookings.map(b => <BookingRow key={b.bookingId} booking={b} onOpen={() => open(b)} density={density} />)}
          </div>
        </>
      )}
      {modal}
    </div>
  )
}
