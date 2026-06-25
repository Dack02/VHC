// Booking Diary types + small presentation helpers.
// Date math (addDays / weekStart, noon-anchored for DST safety) is reused from
// the Workshop Board so the two stay consistent.
export { addDays, weekStart } from '../WorkshopBoard/types'

export interface DiaryDay {
  date: string
  totalJobs: number
  bookedHours: number
  availableHours: number
  bookedPct: number | null   // null when the site has no capacity that day
  freeHours: number
  totalMots: number
  totalWaiting: number
  totalLoans: number
}

export interface DiarySummaryResponse {
  siteId: string
  from: string
  to: string
  days: DiaryDay[]
}

export interface DiaryBooking {
  bookingId: string
  source: 'gms' | 'dms'
  apptTime: string | null
  registration: string | null
  customerName: string | null
  serviceType: string | null
  description: string | null
  estimatedHours: number
  isMot: boolean
  isWaiting: boolean
  isLoan: boolean
  status: string | null
  jobState: string | null
  routeTarget: { jobsheetId: string | null; healthCheckId: string | null }
}

export interface DiaryDayDetail {
  date: string
  siteId: string
  capacity: {
    bookedHours: number
    availableHours: number
    bookedPct: number | null
    freeHours: number
    totalJobs: number
    totalMots: number
    totalWaiting: number
    totalLoans: number
  }
  bookings: DiaryBooking[]
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

// 'HH:MM:SS' (or 'HH:MM') → 'HH:MM'; null or midnight (date-only imports with no
// real time) → '—' so the row reads "no time set" rather than a misleading 00:00.
export function formatTime(t: string | null): string {
  if (!t) return '—'
  const hhmm = t.slice(0, 5)
  return hhmm === '00:00' ? '—' : hhmm
}
