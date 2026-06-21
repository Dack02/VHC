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

// Short "14 Jun" label for the cadence stepper nodes.
export const fmtDayMonth = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''

// "in 4d" / "today" / "3d overdue" — used by the cadence "Next: …" summary.
export function inDaysLabel(d: string | null | undefined): string {
  if (!d) return ''
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'today'
  return `in ${days}d`
}

// ---------------------------------------------------------------------------
// Cadence stepper — derive per-step state by joining the timeline plan
// (timelineSteps) with what actually happened (events) + the case position.
// ---------------------------------------------------------------------------

export type CadenceAction = 'send_sms' | 'send_email' | 'send_both' | 'manual_call' | 'auto_close'
export type CadenceNodeState = 'done' | 'skipped' | 'due' | 'future'
export type CadenceIcon = 'flag' | 'sms' | 'email' | 'phone' | 'shield' | 'system'

export interface CadenceNode {
  key: string
  label: string
  icon: CadenceIcon
  offsetDays: number | null
  date: string | null
  state: CadenceNodeState
  detail: string | null
}

export const ACTION_META: Record<CadenceAction, { label: string; icon: CadenceIcon }> = {
  send_sms: { label: 'SMS reminder', icon: 'sms' },
  send_email: { label: 'Email reminder', icon: 'email' },
  send_both: { label: 'SMS & email', icon: 'sms' },
  manual_call: { label: 'Phone call', icon: 'phone' },
  auto_close: { label: 'Final notice', icon: 'shield' },
}

function addDaysIso(d: string, days: number): string {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + days)
  return dt.toISOString()
}

export interface Cadence {
  nodes: CadenceNode[]
  currentStep: number // 1-based position of the active step among timeline steps
  totalSteps: number
}

export function buildCadence(detail: FollowUpDetail): Cadence {
  const { case: c, events, timelineSteps } = detail
  const isClosed = c.status === 'closed'

  // Synthetic anchor node for when the case was opened.
  const createdEvent = events.find(
    (e) => e.type === 'system' && (e.body || '').toLowerCase().startsWith('follow-up case created')
  )
  const nodes: CadenceNode[] = [
    { key: 'opened', label: 'Case opened', icon: 'flag', offsetDays: null, date: createdEvent?.createdAt || c.createdAt, state: 'done', detail: null },
  ]

  // Which step is the case currently acting on? When parked at a manual-call
  // stage the engine leaves current_step_order *on* that step (status 'manual'),
  // so that step is the one due now. Otherwise it's the first step still ahead.
  const cur = c.currentStepOrder || 0
  const curStep = timelineSteps.find((s) => s.step_order === cur)
  const nextStep = timelineSteps.find((s) => s.step_order > cur)
  let dueOrder: number | null = null
  if (!isClosed) {
    if (curStep && curStep.action === 'manual_call') dueOrder = curStep.step_order
    else if (nextStep) dueOrder = nextStep.step_order
  }
  const dueStep = dueOrder != null ? timelineSteps.find((s) => s.step_order === dueOrder) : undefined
  const dueOffset = dueStep?.offset_days ?? 0

  for (const step of timelineSteps) {
    const meta = ACTION_META[step.action as CadenceAction] || { label: step.action, icon: 'system' as CadenceIcon }
    const sent = events.find((e) => e.type === 'step_sent' && e.stepOrder === step.step_order)
    const skip = events.find((e) => e.type === 'system' && e.stepOrder === step.step_order && /skip|suppress/i.test(e.body || ''))
    const statusEvt = events.find((e) => e.type === 'status_change' && e.stepOrder === step.step_order)

    let state: CadenceNodeState
    let date: string | null = null
    let detail: string | null = null
    let icon = meta.icon

    if (step.step_order === dueOrder) {
      state = 'due'
      date = c.nextActionAt
    } else if (sent) {
      state = 'done'
      date = sent.createdAt
      if (sent.channel === 'email') icon = 'email'
      else if (sent.channel === 'sms') icon = 'sms'
    } else if (skip) {
      state = 'skipped'
      date = skip.createdAt
      detail = skip.body
    } else if (step.step_order <= cur) {
      // Advanced past with no send event recorded.
      state = 'done'
      date = statusEvt?.createdAt || null
    } else {
      state = 'future'
      date = c.anchorDate
        ? addDaysIso(c.anchorDate, step.offset_days)
        : c.nextActionAt
        ? addDaysIso(c.nextActionAt, step.offset_days - dueOffset)
        : null
    }

    nodes.push({ key: `s${step.step_order}`, label: meta.label, icon, offsetDays: step.offset_days, date, state, detail })
  }

  const dueIdx = dueOrder != null ? timelineSteps.findIndex((s) => s.step_order === dueOrder) : -1
  return {
    nodes,
    currentStep: dueIdx >= 0 ? dueIdx + 1 : timelineSteps.length,
    totalSteps: timelineSteps.length,
  }
}
