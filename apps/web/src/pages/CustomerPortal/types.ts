/**
 * Shared types for CustomerPortal and CustomerPortalContent
 * These mirror the shape returned by the public API GET /api/public/vhc/:token
 */

export interface Vehicle {
  registration: string
  make: string | null
  model: string | null
  year: number | null
  vin: string | null
}

export interface Customer {
  first_name: string
  last_name: string
}

export interface OrganizationSettings {
  logoUrl?: string | null
  primaryColor?: string | null
  secondaryColor?: string | null
  legalName?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  addressLine1?: string | null
  city?: string | null
  postcode?: string | null
}

export interface Site {
  name: string
  phone: string | null
  email: string | null
  organization?: {
    name: string
    settings?: OrganizationSettings
  }
}

export interface HealthCheckData {
  id: string
  status: string
  sentAt: string | null
  expiresAt: string | null
  redCount: number
  amberCount: number
  greenCount: number
  technicianNotes: string | null
  mileageIn: number | null
}

export interface SelectedReason {
  id: string
  reasonText: string
  customerDescription: string | null
  followUpDays: number | null
  followUpText: string | null
}

export interface CheckResult {
  id: string
  rag_status: string
  notes: string | null
  value: unknown
  reasons?: SelectedReason[]
  template_item?: {
    id: string
    name: string
    item_type: string
    section?: {
      name: string
    }
  }
  media?: Array<{
    id: string
    url: string
    thumbnail_url: string | null
    caption: string | null
  }>
}

export interface Authorization {
  repair_item_id: string
  decision: 'approved' | 'declined'
  decided_at: string
  signature_data: string | null
}

export interface RepairItem {
  id: string
  title: string
  description: string | null
  rag_status: 'red' | 'amber'
  parts_cost: number
  labor_cost: number
  total_price: number
  is_mot_failure: boolean
  follow_up_date: string | null
  check_result?: CheckResult
  authorization: Authorization | null
  reasons?: SelectedReason[]
}

export interface RepairOption {
  id: string
  name: string
  description: string | null
  labourTotal: number
  partsTotal: number
  subtotal: number
  vatAmount: number
  totalIncVat: number
  isRecommended: boolean
}

export interface NewRepairItem {
  id: string
  name: string
  description: string | null
  isGroup: boolean
  ragStatus: 'red' | 'amber' | null
  labourTotal: number
  partsTotal: number
  subtotal: number
  vatAmount: number
  totalIncVat: number
  labourStatus: string
  partsStatus: string
  quoteStatus: string
  customerApproved: boolean | null
  customerApprovedAt: string | null
  customerDeclinedReason: string | null
  selectedOptionId: string | null
  outcomeStatus: string | null
  deferredUntil: string | null
  deferredNotes: string | null
  options: RepairOption[]
  linkedCheckResults: string[]
  children?: Array<{
    name: string
    ragStatus: 'red' | 'amber' | null
    vhcReason?: string | null
  }>
}

export interface PortalData {
  healthCheck: HealthCheckData
  vehicle: Vehicle
  customer: Customer
  site: Site
  repairItems: RepairItem[]
  checkResults: CheckResult[]
  isFirstView: boolean
  newRepairItems?: NewRepairItem[]
  hasNewRepairItems?: boolean
}
