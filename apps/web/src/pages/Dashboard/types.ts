// Types for the /api/v1/dashboard/overview payload and dashboard widgets

export interface DashboardMetrics {
  totalToday: number
  completedToday: number
  conversionRate: number
  presentedCount: number
  convertedCount: number
  avgResponseTimeMinutes: number
  totalValueSent: number
  totalValueAuthorized: number
  totalValueDeclined: number
}

export interface ColumnCounts {
  technician: number
  tech_done: number
  advisor: number
  customer: number
  actioned: number
}

export interface Alerts {
  overdueCount: number
  expiringLinksCount: number
}

export interface QueueItem {
  id: string
  status: string
  promised_at?: string | null
  token_expires_at?: string | null
  created_at: string
  vehicle?: { registration: string; make: string; model: string }
  customer?: { first_name: string; last_name: string }
  technician?: { first_name: string; last_name: string }
  advisor?: { first_name: string; last_name: string }
  alertType?: 'overdue' | 'expiring'
}

export interface QueuesData {
  needsAttention: { items: QueueItem[]; total: number }
  technicianQueue: { items: QueueItem[]; total: number }
  advisorQueue: { items: QueueItem[]; total: number }
  customerQueue: { items: QueueItem[]; total: number }
}

export interface TechnicianWorkloadEntry {
  id: string
  firstName: string
  lastName: string
  status: 'working' | 'available' | 'idle'
  currentJob: { id: string; vehicle: { registration: string }; timeElapsedMinutes: number } | null
  queueCount: number
  completedToday: number
  isClockedIn: boolean
}

export interface MonthlyKpiMonth {
  label: string
  hcCount: number
  completedCount: number
  /** Inspection (technician-flagged) red/amber sold %, count-based */
  redSoldPct: number | null
  amberSoldPct: number | null
  /** Manufacturer-recommended items sold %, count-based, all RAG levels */
  mriSoldPct: number | null
  mriIdentifiedCount: number
  mriAuthorisedCount: number
  avgIdentified: number | null
  avgSold: number | null
  avgPerDay: number
  topAdvisor: { advisorId: string; name: string; redSoldPct: number; totalSold: number; score: number } | null
}

export interface MonthlyKpiData {
  currentMonth: MonthlyKpiMonth
  previousMonth: MonthlyKpiMonth
  deltas: {
    redSoldPct: number | null
    amberSoldPct: number | null
    mriSoldPct: number | null
    avgIdentified: number | null
    avgSold: number | null
    avgPerDay: number | null
  }
}

export interface RagBucket {
  identifiedValue: number
  authorizedValue: number
  itemCount: number
  authorizedCount: number
}

export interface TodayRagData {
  ragBreakdown: {
    /** Technician-flagged inspection items, split by RAG */
    inspection: {
      red: RagBucket
      amber: RagBucket
      green: RagBucket
    }
    /** Manufacturer-recommended items, combined across RAG levels */
    mri: RagBucket
  }
}

export interface DashboardOverview {
  metrics: DashboardMetrics
  statusCounts: Record<string, number>
  period: { from: string; to: string }
  columnCounts: ColumnCounts
  alerts: Alerts
  queues: QueuesData
  technicians: TechnicianWorkloadEntry[]
  techniciansSummary: { total: number; working: number; available: number; idle: number }
  monthlyKpis: MonthlyKpiData
  todayRag: TodayRagData
}

export interface AwaitingArrivalItem {
  id: string
  registration: string
  make: string
  model: string
  customerName: string
  promiseTime: string | null
  dueDate: string | null
  importedAt: string
  customerWaiting: boolean
  loanCarRequired: boolean
  bookedRepairs: Array<{ code?: string; description?: string; notes?: string }>
  jobsheetNumber: string | null
}

export interface AwaitingCheckinItem {
  id: string
  registration: string
  make: string
  model: string
  customerName: string
  arrivedAt: string
  customerWaiting: boolean
}

export type DateRange = 'today' | 'week' | 'month'

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)

export const formatStatusLabel = (status: string) => status.replace(/_/g, ' ')
