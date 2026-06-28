// Booking Diary types + small presentation helpers.
// Date math (addDays / weekStart, noon-anchored for DST safety) is reused from
// the Workshop Board so the two stay consistent.
export { addDays, weekStart } from '../WorkshopBoard/types'

// Month helpers (noon-anchored, like addDays/weekStart, to stay DST-safe).
export function addMonths(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00`)
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}
export function monthFirst(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`
}

// ISO day-of-week for a YYYY-MM-DD string: 1=Mon .. 7=Sun.
export function isoDow(ymd: string): number {
  const day = new Date(`${ymd}T12:00:00`).getDay() // 0=Sun..6=Sat
  return ((day + 6) % 7) + 1
}

export const ALL_DOWS = [1, 2, 3, 4, 5, 6, 7]

// RAG-ish capacity band for a day, computed server-side against the site's
// configurable target_loading_pct (Resource Manager). Supersedes the hard-coded
// 85% loadTone for colouring when present.
export type CapacityBand = 'closed' | 'low' | 'healthy' | 'high' | 'over'

export interface DiaryDay {
  date: string
  totalJobs: number
  bookedHours: number
  availableHours: number
  ceilingHours?: number        // available × target_loading_pct (the line we book to)
  band?: CapacityBand          // server-computed RAG band (config-driven)
  bookedPct: number | null   // null when the site has no capacity that day
  freeHours: number
  totalMots: number
  totalWaiting: number
  totalLoans: number
  totalOutreach: number
}

export interface DiarySummaryResponse {
  siteId: string
  from: string
  to: string
  days: DiaryDay[]
  operatingDays?: number[]   // ISO dow (1=Mon..7=Sun) the site is open
}

// Whole-window payload (per-day headers + every booking across the range) used by
// the Agenda and Table list views — one round-trip, grouped client-side.
export interface DiaryRangeResponse {
  siteId: string
  from: string
  to: string
  days: DiaryDay[]
  bookings: DiaryBooking[]
  operatingDays?: number[]   // ISO dow (1=Mon..7=Sun) the site is open
}

export interface DiaryPerson {
  id: string
  name: string | null
}

export interface DiaryBooking {
  bookingId: string
  source: 'gms' | 'dms'
  apptDate: string           // YYYY-MM-DD (the day this booking sits on)
  apptTime: string | null
  registration: string | null
  customerName: string | null
  serviceType: string | null
  description: string | null
  estimatedHours: number
  isMot: boolean
  isWaiting: boolean
  isLoan: boolean
  isOutreach: boolean
  followUpCaseId: string | null
  status: string | null
  jobState: string | null
  technician: DiaryPerson | null   // assigned tech (NULL = unassigned / future booking)
  advisor: DiaryPerson | null      // service advisor who took the booking
  bayNumber: string | null
  routeTarget: { jobsheetId: string | null; healthCheckId: string | null }
}

export interface DiaryDayDetail {
  date: string
  siteId: string
  capacity: {
    bookedHours: number
    availableHours: number
    ceilingHours?: number
    band?: CapacityBand
    bookedPct: number | null
    freeHours: number
    totalJobs: number
    totalMots: number
    totalWaiting: number
    totalLoans: number
    totalOutreach: number
  }
  bookings: DiaryBooking[]
  // Cars dropped in on this day but scheduled to be worked on a later day.
  arrivals?: DiaryDropOffArrival[]
}

export interface DiaryDropOffArrival {
  jobsheetId: string
  reference: string | null
  registration: string | null
  customerName: string | null
  dropOffTime: string | null
  scheduledDate: string
  serviceTypeLabel: string | null
}

export interface DmsBookingLabour {
  description: string | null
  units: number | null
  price: number | null
  fitter: string | null
}

export interface DmsBookingRepair {
  code: string | null
  description: string | null
  notes: string | null
  labour: DmsBookingLabour[]
}

export interface DmsBookingDetail {
  bookingId: string | null
  source: string
  status: string | null
  jobState: string | null
  dueDate: string | null
  promiseTime: string | null
  bookedDate: string | null
  mileageIn: number | null
  keyLocation: string | null
  jobsheetNumber: string | null
  jobsheetStatus: string | null
  serviceType: string | null
  estimatedHours: number | null
  isMot: boolean
  isWaiting: boolean
  isLoan: boolean
  isInternal: boolean
  isOutreach: boolean
  followUpCaseId: string | null
  notes: string | null
  customer: {
    name: string | null
    contactName: string | null
    email: string | null
    mobile: string | null
    phone: string | null
    address: string[]
  } | null
  vehicle: {
    registration: string | null
    make: string | null
    model: string | null
    year: number | null
    color: string | null
    fuelType: string | null
    vin: string | null
    mileage: number | null
  } | null
  bookedRepairs: DmsBookingRepair[]
}

export type LoadTone = 'green' | 'amber' | 'red' | 'none'

// RAG band for a "booked %" — matches the app convention: green < 85%,
// amber 85–100%, red over 100% (overbooked). `none` = no capacity to load against.
export function loadTone(pct: number | null): LoadTone {
  if (pct == null) return 'none'
  if (pct > 1) return 'red'
  if (pct >= 0.85) return 'amber'
  return 'green'
}

export function toneBarClass(tone: LoadTone): string {
  switch (tone) {
    case 'red': return 'bg-rag-red'
    case 'amber': return 'bg-rag-amber'
    case 'green': return 'bg-rag-green'
    default: return 'bg-gray-300'
  }
}

// Config-driven band → load-bar fill colour. 'low' (well under target) gets a
// distinct blue to flag "room to fill"; otherwise mirrors the RAG convention.
export function bandBarClass(band: CapacityBand | undefined): string {
  switch (band) {
    case 'over': return 'bg-rag-red'
    case 'high': return 'bg-rag-amber'
    case 'healthy': return 'bg-rag-green'
    case 'low': return 'bg-blue-400'
    default: return 'bg-gray-300'   // closed / unknown
  }
}

// Band → emphasis text colour for the capacity figures.
export function bandTextClass(band: CapacityBand | undefined): string {
  switch (band) {
    case 'over': return 'text-rag-red'
    case 'high': return 'text-rag-amber'
    case 'low': return 'text-blue-600'
    default: return ''
  }
}

// A booked % resolved from either the server band (preferred) or the legacy
// 85% loadTone — lets LoadBar/CapacityFigures colour correctly during rollout.
export function barClassFor(band: CapacityBand | undefined, pct: number | null): string {
  return band ? bandBarClass(band) : toneBarClass(loadTone(pct))
}

// 'HH:MM:SS' (or 'HH:MM') → 'HH:MM'; null or midnight (date-only imports with no
// real time) → '—' so the row reads "no time set" rather than a misleading 00:00.
export function formatTime(t: string | null): string {
  if (!t) return '—'
  const hhmm = t.slice(0, 5)
  return hhmm === '00:00' ? '—' : hhmm
}

// ---------------------------------------------------------------------------
// List-view grouping + status helpers
// ---------------------------------------------------------------------------

// Secondary grouping dimension for the Grouped list view (the primary grouping
// is always the day).
export type GroupBy = 'advisor' | 'type' | 'technician'

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  advisor: 'Advisor',
  type: 'Job type',
  technician: 'Technician'
}

// A booking's primary job type. MOT wins (it's a hard capacity/lane concept);
// otherwise the booking's service-type label, falling back to 'General'.
// While-you-wait / loan stay as flags (a job can be MOT *and* a waiter).
export function jobTypeOf(b: DiaryBooking): string {
  if (b.isMot) return 'MOT'
  const st = b.serviceType?.trim()
  return st && st.length ? st : 'General'
}

// Resolve a booking's { key, label } for a grouping dimension. Unassigned
// advisor/technician collapse into a single trailing 'Unassigned' bucket.
export function groupValue(b: DiaryBooking, by: GroupBy): { key: string; label: string } {
  if (by === 'type') {
    const label = jobTypeOf(b)
    return { key: `type:${label.toLowerCase()}`, label }
  }
  const person = by === 'advisor' ? b.advisor : b.technician
  if (!person) return { key: 'unassigned', label: 'Unassigned' }
  return { key: person.id, label: person.name || 'Unknown' }
}

// Left status stripe colour for a booking row: amber while it's being worked,
// green once complete, otherwise neutral. Reads job_state first (workshop board
// state) then falls back to the VHC pipeline status.
export function statusStripeClass(b: DiaryBooking): string {
  const s = (b.jobState || b.status || '').toLowerCase()
  if (['in_workshop', 'work_in_progress', 'in_progress', 'paused'].includes(s)) return 'bg-rag-amber'
  if (['work_complete', 'collected', 'completed'].includes(s)) return 'bg-rag-green'
  return 'bg-gray-300'
}

// Humanise a workshop/VHC state token for display ('in_workshop' → 'In workshop').
export function humanizeState(s: string | null): string {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
}
