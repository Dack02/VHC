// Workshop board API payload types

export type BoardPosition = 'due_in' | 'checked_in' | 'column' | 'work_complete'
export type CardPriority = 'normal' | 'high' | 'urgent'

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
}

export interface BoardCard {
  healthCheckId: string
  position: BoardPosition
  columnId: string | null
  status: string
  sortPosition: number
  workshopStatusId: string | null
  priority: CardPriority
  estimatedHours: number | null
  workCompletedAt: string | null
  promiseTime: string | null
  dueDate: string | null
  arrivedAt: string | null
  createdAt: string
  customerWaiting: boolean
  loanCarRequired: boolean
  isInternal: boolean
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
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null; color: string | null } | null
  customer: { id: string; first_name: string; last_name: string; mobile: string | null } | null
  technician: { id: string; first_name: string; last_name: string } | null
  advisor: { id: string; first_name: string; last_name: string } | null
  latestNote: BoardNotePreview | null
  notesCount: number
}

export interface BoardData {
  siteId: string
  date: string
  config: { defaultTechHours: number }
  statuses: BoardStatus[]
  columns: BoardColumnDef[]
  cards: BoardCard[]
}

export interface WorkshopNoteEntry {
  id: string
  content: string
  createdAt: string
  user: { id: string; first_name: string; last_name: string; role?: string } | null
}

// Friendly pipeline stage chip derived from the health check status
export function pipelineStage(status: string): { label: string; tone: 'grey' | 'blue' | 'amber' | 'green' | 'red' | 'indigo' } {
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
    default: return { label: status.replace(/_/g, ' '), tone: 'grey' }
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

// Sort cards within a column: waiters first, then priority, promise time, age
export function sortCards(cards: BoardCard[]): BoardCard[] {
  const priorityWeight: Record<CardPriority, number> = { urgent: 0, high: 1, normal: 2 }
  return [...cards].sort((a, b) => {
    if (a.customerWaiting !== b.customerWaiting) return a.customerWaiting ? -1 : 1
    const pw = priorityWeight[a.priority] - priorityWeight[b.priority]
    if (pw !== 0) return pw
    const aPromise = a.promiseTime || a.dueDate
    const bPromise = b.promiseTime || b.dueDate
    if (aPromise && bPromise && aPromise !== bPromise) return aPromise < bPromise ? -1 : 1
    if (!!aPromise !== !!bPromise) return aPromise ? -1 : 1
    return a.createdAt < b.createdAt ? -1 : 1
  })
}
