// Shared types + small formatters for the Follow-Up module.

export type FollowUpStatus = 'active' | 'booking_found' | 'engaged' | 'manual' | 'closed'

export interface FollowUpCase {
  id: string
  status: FollowUpStatus
  anchorDate: string | null
  nextActionAt: string | null
  deferredValue: number
  itemCount: number
  lastContactedAt: string | null
  manualAttempts: number
  currentStepOrder: number
  healthCheckId: string
  linkedBookingId: string | null
  outcome: { id: string; name: string; isWon: boolean } | null
  outcomeNotes: string | null
  closedAt: string | null
  customer: { id: string; name: string; mobile: string | null; email: string | null } | null
  vehicle: { id: string; registration: string; makeModel: string } | null
  assignee: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface FollowUpSummary {
  open: number
  manual: number
  overdue: number
  dueToday: number
  bookingFound: number
  engaged: number
  // Automation state (org-level Follow-Up Settings). Optional so the page stays
  // safe if the API hasn't been deployed with these fields yet.
  enabled?: boolean
  autoSweepEnabled?: boolean
  simulationMode?: boolean
}

export interface FollowUpItem {
  id: string
  repairItemId: string
  name: string | null
  value: number
  dueDate: string | null
  rag: string | null
  currentOutcomeStatus: string | null
  itemOutcome: { id: string; name: string } | null
}

export interface FollowUpEvent {
  id: string
  type: string
  channel: string | null
  stepOrder: number | null
  body: string | null
  metadata: Record<string, unknown> | null
  disposition: string | null
  actor: string | null
  createdAt: string
}

export interface FollowUpBooking {
  id: string
  due_date: string | null
  promise_time: string | null
  booked_repairs: Array<{ code?: string; description?: string }> | null
  jobsheet_number?: string | null
}

export interface FollowUpDetail {
  case: FollowUpCase
  items: FollowUpItem[]
  events: FollowUpEvent[]
  timelineSteps: Array<{ step_order: number; action: string; offset_days: number }>
  booking: FollowUpBooking | null
}

export interface FollowUpOutcome {
  id: string
  name: string
  description: string | null
  isWon: boolean
  isActive: boolean
  isSystem: boolean
  sortOrder: number
}

export interface FollowUpDisposition {
  id: string
  name: string
  description: string | null
  snoozeDays: number | null
  isActive: boolean
  isSystem: boolean
  sortOrder: number
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export const fmtMoney = (n: number | null | undefined): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0)

export const fmtDate = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const fmtDateTime = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export function relativeDue(d: string | null | undefined): { label: string; tone: 'overdue' | 'today' | 'soon' | 'future' | 'none' } {
  if (!d) return { label: '—', tone: 'none' }
  const target = new Date(d)
  const now = new Date()
  const days = Math.round((target.getTime() - now.setHours(0, 0, 0, 0)) / 86400000)
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'overdue' }
  if (days === 0) return { label: 'Today', tone: 'today' }
  if (days <= 7) return { label: `in ${days}d`, tone: 'soon' }
  return { label: fmtDate(d), tone: 'future' }
}

export const STATUS_META: Record<FollowUpStatus, { label: string; cls: string }> = {
  active: { label: 'In cadence', cls: 'bg-indigo-100 text-indigo-700' },
  booking_found: { label: 'Booking found', cls: 'bg-green-100 text-green-700' },
  engaged: { label: 'Replied', cls: 'bg-purple-100 text-purple-700' },
  manual: { label: 'Call list', cls: 'bg-amber-100 text-amber-700' },
  closed: { label: 'Closed', cls: 'bg-gray-100 text-gray-600' },
}
