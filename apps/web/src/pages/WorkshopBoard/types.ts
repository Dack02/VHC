// Workshop board API payload types

export type BoardPosition = 'due_in' | 'checked_in' | 'in_workshop' | 'column' | 'work_complete'
export type CardPriority = 'normal' | 'high' | 'urgent'

// The workshop lifecycle axis - independent of the VHC pipeline (`status`).
// Drives which board column a card sits in.
export type JobState = 'due_in' | 'arrived' | 'in_workshop' | 'work_complete' | 'collected'

export interface BoardStatus {
  id: string
  name: string
  colour: string
  icon: string | null
  smsMessage: string | null
  sortOrder: number
  isActive: boolean
}

export interface BoardColumnDef {
  id: string
  columnType: 'technician' | 'queue'
  technicianId: string | null
  technician: { id: string; first_name: string; last_name: string; is_active?: boolean } | null
  name: string
  colour: string | null
  availableHours: number
  sortOrder: number
  isVisible: boolean
}

export interface BookedRepair {
  code?: string
  description?: string
  notes?: string
  labourItems?: Array<{ description?: string; price?: number; units?: number; fitter?: string }>
}

export interface BoardNotePreview {
  content: string
  createdAt: string
  user: { id: string; first_name: string; last_name: string } | null
  /** True while the note is flagged for advisor attention and not yet actioned */
  advisorAttention?: boolean
}

export interface BoardCard {
  /** null for VHC-less jobsheets (estimate conversions / "Requires VHC" unticked). Use cardKey() for a stable id. */
  healthCheckId: string | null
  position: BoardPosition
  columnId: string | null
  status: string | null
  jobState: JobState
  sortPosition: number
  workshopStatusId: string | null
  priority: CardPriority
  estimatedHours: number | null
  plannedStartAt: string | null
  totalTechTimeMinutes: number
  workCompletedAt: string | null
  promiseTime: string | null
  dueDate: string | null
  arrivedAt: string | null
  createdAt: string
  customerWaiting: boolean
  loanCarRequired: boolean
  isInternal: boolean
  jobsheetId: string | null
  jobsheetReference: string | null
  jobsheetNumber: string | null
  jobNumber: string | null
  mileageIn: number | null
  keyLocation: string | null
  checkinNotes: string | null
  advisorNotes: string | null
  bookedRepairs: BookedRepair[]
  ragCounts: { red: number; amber: number; green: number }
  techStartedAt: string | null
  techCompletedAt: string | null
  isClockedOn: boolean
  clockedOnSince: string | null
  /** Name of the technician holding the open productive segment (cross-tech attribution) */
  clockedOnBy: string | null
  /** All technicians currently clocked on (multi-tech, TECH_JOB_MODEL.md §7) */
  clockedOnTechs?: { name: string; since: string }[]
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null; color: string | null } | null
  customer: { id: string; first_name: string; last_name: string; mobile: string | null } | null
  technician: { id: string; first_name: string; last_name: string } | null
  advisor: { id: string; first_name: string; last_name: string } | null
  latestNote: BoardNotePreview | null
  notesCount: number
}

/** Stable per-card id for React keys / dnd: the VHC id when present, else the jobsheet id. */
export const cardKey = (c: BoardCard): string => c.healthCheckId ?? c.jobsheetId ?? ''

/** A VHC-backed card (healthCheckId guaranteed). Sub-views that don't yet support VHC-less
 *  jobsheets (timeline planner, drag/reorder) narrow to this. */
export type BoardCardWithHc = BoardCard & { healthCheckId: string }

export interface BoardConfig {
  defaultTechHours: number
  dayStartTime: string
  dayEndTime: string
  lunchStartTime: string | null
  lunchEndTime: string | null
  /** Open clock-ons older than this many minutes are treated as stale (forgotten clock-off) */
  staleClockMinutes: number
  /** Whether the org has indirect (non-productive) time tracking enabled */
  indirectTimeEnabled: boolean
}

export interface BoardData {
  siteId: string
  date: string
  config: BoardConfig
  statuses: BoardStatus[]
  columns: BoardColumnDef[]
  cards: BoardCard[]
  /** The day's per-technician shift pattern + absences (timeline lane shading) */
  shiftsByTech?: Record<string, TechShift[]>
  absencesByTech?: Record<string, TechAbsence[]>
}

// Minutes since midnight for an HH:MM string
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// ---- Multi-day planner (week view) -----------------------------------------

// Shift a YYYY-MM-DD string by n days. Noon anchor avoids DST/midnight slips.
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

// Monday of the week containing `date` (UK week start).
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  const mondayIndex = (d.getDay() + 6) % 7 // Sun=0 → 6, Mon=1 → 0 …
  return addDays(date, -mondayIndex)
}

// Lean per-card projection returned by GET /workshop-board/week.
export interface WeekCard {
  // null for VHC-less jobsheets (TECH_JOB_MODEL.md §7) — those carry jobsheetId and
  // open /jobsheets/:id; they have no workshop_cards meta so they sit in the tray.
  healthCheckId: string | null
  jobsheetId: string | null
  technicianId: string | null
  plannedStartAt: string | null
  estimatedHours: number | null
  status: string | null
  jobState: JobState
  registration: string | null
  customerName: string | null
  customerWaiting: boolean
  promiseTime: string | null
  dueDate: string | null
  isClockedOn: boolean
}

// Stable key / dnd id for a week card (VHC-backed → HC id; VHC-less → jobsheet id).
export const weekCardKey = (c: WeekCard): string => c.healthCheckId ?? c.jobsheetId ?? ''

export interface WeekColumn {
  id: string
  technicianId: string | null
  name: string
  availableHours: number
  sortOrder: number
  isVisible: boolean
}

// Recurring weekly working pattern (weekday 0=Mon … 6=Sun).
export interface TechShift {
  weekday: number
  startTime: string
  endTime: string
}

// One-off absence (holiday/sick/training). All-day unless start/end times given.
export interface TechAbsence {
  id: string
  technicianId: string
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
  reason: string | null
}

export interface WeekData {
  siteId: string
  from: string
  to: string
  config: { dayStartTime: string; dayEndTime: string; lunchStartTime: string | null; lunchEndTime: string | null; defaultTechHours: number }
  columns: WeekColumn[]
  cards: WeekCard[]
  shiftsByTech: Record<string, TechShift[]>
  absencesByTech: Record<string, TechAbsence[]>
}

// Available working minutes for a technician on a given date, derived from their
// shift for that weekday (minus lunch, minus any absence overlap). Falls back to
// the flat column hours anchored at the day start when no shift is defined, so a
// tech with no shift behaves exactly as before. A whole-day absence returns 0.
export function dayCapacityMinutes(opts: {
  date: string
  shifts: TechShift[]
  absences: TechAbsence[]
  lunchStartTime: string | null
  lunchEndTime: string | null
  flatHours: number
  dayStartTime: string
}): number {
  const { date, shifts, absences, flatHours, dayStartTime } = opts
  const weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7
  const shift = shifts.find(s => s.weekday === weekday) || null
  // A tech with a weekly pattern but no row for this weekday isn't working today.
  if (!shift && shifts.length > 0) return 0
  let startMin: number
  let endMin: number
  if (shift) {
    startMin = timeToMinutes(shift.startTime)
    endMin = timeToMinutes(shift.endTime)
  } else {
    startMin = timeToMinutes(dayStartTime)
    endMin = startMin + Math.round(flatHours * 60)
  }
  let mins = Math.max(0, endMin - startMin)
  const overlap = (s: number, e: number) => Math.max(0, Math.min(endMin, e) - Math.max(startMin, s))
  if (opts.lunchStartTime && opts.lunchEndTime) {
    mins -= overlap(timeToMinutes(opts.lunchStartTime), timeToMinutes(opts.lunchEndTime))
  }
  for (const a of absences) {
    if (date < a.startDate || date > a.endDate) continue
    if (a.allDay || !a.startTime || !a.endTime) return 0 // whole day off
    mins -= overlap(timeToMinutes(a.startTime), timeToMinutes(a.endTime))
  }
  return Math.max(0, mins)
}

// Default ceiling (minutes) for an open clock-on's live contribution, used when
// the board config hasn't supplied the org's configured open_segment_stale_minutes.
export const DEFAULT_STALE_CLOCK_MIN = 600 // 10h

// True when a card's open clock-on is older than `staleMinutes` — almost always a
// forgotten clock-off rather than genuine work. Surface a "check clock" flag
// instead of letting the live timer run to hundreds of hours.
export function isClockStale(card: BoardCard, now: Date, staleMinutes = DEFAULT_STALE_CLOCK_MIN): boolean {
  if (!card.isClockedOn || !card.clockedOnSince) return false
  const openMin = (now.getTime() - new Date(card.clockedOnSince).getTime()) / 60000
  return openMin > staleMinutes
}

// Actual minutes worked on a job, live (closed entries + open clock-in). The open
// segment's live contribution is ignored once it goes stale (see isClockStale) so
// a forgotten clock-off can't run the timer away — the board then shows the closed
// total plus a "check clock" flag rather than e.g. +407h.
export function actualWorkedMinutes(card: BoardCard, now: Date, staleMinutes = DEFAULT_STALE_CLOCK_MIN): number {
  let minutes = card.totalTechTimeMinutes || 0
  if (card.isClockedOn && card.clockedOnSince && !isClockStale(card, now, staleMinutes)) {
    minutes += Math.max(0, (now.getTime() - new Date(card.clockedOnSince).getTime()) / 60000)
  }
  return minutes
}

// Friendly pipeline stage chip derived from the health check status
export function pipelineStage(status: string | null): { label: string; tone: 'grey' | 'blue' | 'amber' | 'green' | 'red' | 'indigo' } {
  switch (status) {
    case 'awaiting_arrival': return { label: 'Due In', tone: 'grey' }
    case 'awaiting_checkin': return { label: 'Awaiting Check-in', tone: 'amber' }
    case 'created': return { label: 'In Queue', tone: 'grey' }
    case 'assigned': return { label: 'Assigned', tone: 'blue' }
    case 'in_progress': return { label: 'Inspection Underway', tone: 'indigo' }
    case 'paused': return { label: 'Paused', tone: 'amber' }
    case 'tech_completed': return { label: 'Inspection Done', tone: 'blue' }
    case 'awaiting_review': return { label: 'Advisor Review', tone: 'amber' }
    case 'awaiting_pricing': return { label: 'Pricing', tone: 'amber' }
    case 'awaiting_parts': return { label: 'Parts Pricing', tone: 'amber' }
    case 'ready_to_send': return { label: 'Ready to Send', tone: 'blue' }
    case 'sent':
    case 'delivered': return { label: 'Sent to Customer', tone: 'indigo' }
    case 'opened': return { label: 'Customer Viewing', tone: 'indigo' }
    case 'partial_response': return { label: 'Partial Response', tone: 'amber' }
    case 'authorized': return { label: 'Work Authorised', tone: 'green' }
    case 'declined': return { label: 'Work Declined', tone: 'red' }
    case 'expired': return { label: 'Link Expired', tone: 'red' }
    case 'completed': return { label: 'Completed', tone: 'green' }
    default: return { label: (status ?? '').replace(/_/g, ' '), tone: 'grey' }
  }
}

export function renderSmsTemplate(
  template: string,
  card: BoardCard,
  siteName: string,
  orgName: string
): string {
  const customerName = card.customer ? `${card.customer.first_name}`.trim() : 'there'
  return template
    .replace(/\{customer_name\}/g, customerName)
    .replace(/\{registration\}/g, card.vehicle?.registration || 'your vehicle')
    .replace(/\{site_name\}/g, siteName)
    .replace(/\{org_name\}/g, orgName)
}

// Sort cards within a column. Manually ordered cards (sortPosition > 0, set
// by drag-to-reorder) come first in their dragged order - the tech works top
// to bottom. Cards never manually placed follow, auto-sorted: waiters first,
// then priority, promise time, age.
export function sortCards(cards: BoardCard[]): BoardCard[] {
  const priorityWeight: Record<CardPriority, number> = { urgent: 0, high: 1, normal: 2 }
  const autoCompare = (a: BoardCard, b: BoardCard): number => {
    if (a.customerWaiting !== b.customerWaiting) return a.customerWaiting ? -1 : 1
    const pw = priorityWeight[a.priority] - priorityWeight[b.priority]
    if (pw !== 0) return pw
    const aPromise = a.promiseTime || a.dueDate
    const bPromise = b.promiseTime || b.dueDate
    if (aPromise && bPromise && aPromise !== bPromise) return aPromise < bPromise ? -1 : 1
    if (!!aPromise !== !!bPromise) return aPromise ? -1 : 1
    return a.createdAt < b.createdAt ? -1 : 1
  }
  return [...cards].sort((a, b) => {
    const aOrdered = a.sortPosition > 0
    const bOrdered = b.sortPosition > 0
    if (aOrdered !== bOrdered) return aOrdered ? -1 : 1
    if (aOrdered && bOrdered && a.sortPosition !== b.sortPosition) return a.sortPosition - b.sortPosition
    return autoCompare(a, b)
  })
}
