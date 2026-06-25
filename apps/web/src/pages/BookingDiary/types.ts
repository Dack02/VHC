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

// 'HH:MM:SS' (or 'HH:MM') → 'HH:MM'; null → '—'
export function formatTime(t: string | null): string {
  if (!t) return '—'
  return t.slice(0, 5)
}
