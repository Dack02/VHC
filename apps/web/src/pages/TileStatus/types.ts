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

export function labelForVhc(status: string): string {
  return vhcStateLabels[status] || status.replace(/_/g, ' ')
}

export function labelForVehicle(jobState: string): string {
  return vehicleStatusLabels[jobState] || jobState.replace(/_/g, ' ')
}
