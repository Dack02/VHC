// Tile Status page types + small presentation helpers.

export interface Tile {
  statusId: string | null
  name: string
  colour: string | null
  icon: string | null
  sortOrder: number
  count: number
  oldestDays: number | null
  vehicleStatus: Record<string, number>
  vhcState: Record<string, number>
}

export interface TilesResponse {
  siteId: string
  tiles: Tile[]
}

export interface TileJob {
  healthCheckId: string | null
  jobsheetId?: string | null   // set for VHC-less jobsheets (open the jobsheet, not a VHC)
  jobNumber: string | null     // jobsheet ref / DMS job number — the workshop identifier
  registration: string | null
  make: string | null
  model: string | null
  customerName: string | null
  advisorName: string | null
  technicianName: string | null
  jobState: string
  vhcStatus: string | null
  daysInStatus: number
  promiseTime: string | null
  dueDate: string | null
}

export interface TileJobsResponse {
  siteId: string
  jobs: TileJob[]
}

// Vehicle Status (the job_state axis) labels — ordered through the lifecycle.
export const VEHICLE_STATUS_ORDER = ['due_in', 'arrived', 'in_workshop', 'work_complete', 'collected'] as const

export const vehicleStatusLabels: Record<string, string> = {
  due_in: 'Due in',
  arrived: 'Arrived',
  in_workshop: 'In workshop',
  work_complete: 'Work complete',
  collected: 'Collected'
}

// Vehicle Status accent colours — drive the tile distribution bar + the status
// dots on the drill-in rows. Greys for the not-here-yet / gone states, blues for
// in-the-building, green for done.
export const vehicleStatusColours: Record<string, string> = {
  due_in: '#c4c8cf',
  arrived: '#8390f0',
  in_workshop: '#2f6bdf',
  work_complete: '#2c9367',
  collected: '#d3d6db'
}

const VEHICLE_STATUS_FALLBACK = '#c4c8cf'
export function vehicleStatusColour(key: string): string {
  return vehicleStatusColours[key] || VEHICLE_STATUS_FALLBACK
}

// Friendly short labels for the VHC pipeline status (mirrors the board chips).
export const vhcStateLabels: Record<string, string> = {
  awaiting_arrival: 'Due in',
  awaiting_checkin: 'Awaiting check-in',
  created: 'In queue',
  assigned: 'Assigned',
  in_progress: 'Inspecting',
  paused: 'Paused',
  tech_completed: 'Inspection done',
  awaiting_review: 'Advisor review',
  awaiting_pricing: 'Pricing',
  awaiting_parts: 'Parts pricing',
  ready_to_send: 'Ready to send',
  sent: 'Sent',
  delivered: 'Delivered',
  opened: 'Customer viewing',
  partial_response: 'Partial response',
  authorized: 'Authorised',
  declined: 'Declined',
  expired: 'Link expired',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show'
}

// Calendar-days marker text: "Today" / "1 day" / "N days". Null when untracked.
export function daysLabel(days: number | null): string | null {
  if (days == null) return null
  if (days <= 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

// ---- Ageing pill (threshold colours) -------------------------------------
// The pill colour escalates with the day count: green/neutral while fresh,
// amber once it's been waiting `warnDays`, red at `critDays`. Defaults are
// fine for v1; the natural follow-up is to read them from per-org settings.
export const AGE_WARN_DAYS = 3 // ≥ this → amber
export const AGE_CRIT_DAYS = 8 // ≥ this → red

export type AgeLevel = 'ok' | 'warn' | 'crit'

export interface AgePill {
  text: string
  level: AgeLevel
  color: string
  bg: string
}

const AGE_COLOURS: Record<AgeLevel, { color: string; bg: string }> = {
  ok: { color: '#7b7f88', bg: '#f0f0ee' },
  warn: { color: '#a9760f', bg: '#f6ead0' },
  crit: { color: '#c0403b', bg: '#f7e4e2' }
}

// Build the ageing-pill descriptor for a day count. Null mirrors `daysLabel`'s
// "untracked" return so callers can skip rendering. Same pill + thresholds are
// reused on tiles, the drill-in header, and the "Waiting" column.
export function agePill(
  days: number | null,
  opts: { warnDays?: number; critDays?: number } = {}
): AgePill | null {
  if (days == null) return null
  const warn = opts.warnDays ?? AGE_WARN_DAYS
  const crit = opts.critDays ?? AGE_CRIT_DAYS
  const level: AgeLevel = days >= crit ? 'crit' : days >= warn ? 'warn' : 'ok'
  return { text: daysLabel(days) ?? 'Today', level, ...AGE_COLOURS[level] }
}

// Relative countdown to a not-yet-arrived booking's due date, compared by calendar
// day: "Today" / "Tomorrow" / "in N days" (or "Yesterday" / "N days ago" if it slipped
// past). Used by the Future Bookings tile, where days-since-import is meaningless.
export function dueCountdownLabel(iso: string | null): string | null {
  if (!iso) return null
  const due = new Date(iso)
  if (isNaN(due.getTime())) return null
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfDue = new Date(due)
  startOfDue.setHours(0, 0, 0, 0)
  const days = Math.round((startOfDue.getTime() - startOfToday.getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days > 1) return `in ${days} days`
  if (days === -1) return 'Yesterday'
  return `${Math.abs(days)} days ago`
}

export function labelForVhc(status: string): string {
  return vhcStateLabels[status] || status.replace(/_/g, ' ')
}

export function labelForVehicle(jobState: string): string {
  return vehicleStatusLabels[jobState] || jobState.replace(/_/g, ' ')
}
