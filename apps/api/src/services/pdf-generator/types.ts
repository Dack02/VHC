/**
 * PDF Generator Types
 * All interfaces used across the PDF generation system
 */

export interface OrganizationBranding {
  logoUrl?: string | null
  primaryColor?: string
  organizationName?: string
}

export interface HealthCheckPDFData {
  // Health check details
  id: string
  status: string
  created_at: string
  completed_at?: string | null
  closed_at?: string | null
  mileage?: number | null
  vhc_reference?: string | null

  // Vehicle
  vehicle: {
    registration: string
    make?: string
    model?: string
    year?: number
    vin?: string
  }

  // Customer
  customer: {
    first_name: string
    last_name: string
    email?: string
    phone?: string
  }

  // Technician
  technician?: {
    first_name: string
    last_name: string
  }

  // Technician signature (base64 PNG)
  technician_signature?: string | null

  // Site/Dealer
  site?: {
    name: string
    address?: string
    phone?: string
    email?: string
  }

  // Organization branding
  branding?: OrganizationBranding

  // Results and items
  results: ResultData[]
  repairItems: RepairItemData[]
  authorizations: AuthorizationData[]

  // Selected reasons by check result ID
  reasonsByCheckResult?: CheckResultReasonsMap

  // New Repair Items (Phase 6+)
  newRepairItems?: NewRepairItem[]
  hasNewRepairItems?: boolean
  vatRate?: number // Default 20%
  showDetailedBreakdown?: boolean // Show labour/parts detail

  // Summary
  summary: {
    red_count: number
    amber_count: number
    green_count: number
    total_identified: number
    total_authorised: number
    work_completed_value: number
  }
}

export interface ResultData {
  id: string
  rag_status: 'red' | 'amber' | 'green'
  notes?: string | null
  value?: Record<string, unknown> | null
  template_item?: {
    id: string
    name: string
    item_type: string
    section?: { name: string }
  }
  media?: MediaData[]
}

export interface RepairItemData {
  id: string
  check_result_id: string
  title: string
  description?: string | null
  rag_status: 'red' | 'amber' | 'green'
  parts_cost?: number | null
  labor_cost?: number | null
  total_price?: number | null
  is_mot_failure?: boolean
  follow_up_date?: string | null
  work_completed_at?: string | null
  // Group info for rendering grouped items
  is_group?: boolean
  children?: Array<{ name: string; rag_status: string }>
}

export interface MediaData {
  id: string
  url: string
  thumbnail_url?: string | null
  type: string
}

export interface AuthorizationData {
  repair_item_id: string
  decision: 'approved' | 'declined'
  signature_data?: string | null
  signed_at?: string | null
}

export interface SelectedReasonData {
  id: string
  reasonText: string
  customerDescription?: string | null
  followUpDays?: number | null
  followUpText?: string | null
}

export interface CheckResultReasonsMap {
  [checkResultId: string]: SelectedReasonData[]
}

// New Repair Items (Phase 6+)
export interface NewRepairOption {
  id: string
  name: string
  description?: string | null
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
  description?: string | null
  isGroup: boolean
  labourTotal: number
  partsTotal: number
  subtotal: number
  vatAmount: number
  totalIncVat: number
  customerApproved: boolean | null
  customerApprovedAt?: string | null
  customerDeclinedReason?: string | null
  customerSignatureData?: string | null
  customerNotes?: string | null
  selectedOptionId?: string | null
  options: NewRepairOption[]
  linkedCheckResults: string[]
  // Children items for groups
  children?: NewRepairItem[]
  // Labour and parts details for optional breakdown
  labourEntries?: Array<{
    code: string
    description: string
    hours: number
    rate: number
    total: number
    isVatExempt: boolean
  }>
  partsEntries?: Array<{
    partNumber?: string
    description: string
    quantity: number
    sellPrice: number
    lineTotal: number
  }>
}

// Customer Approval Confirmation PDF Types
export interface ApprovalConfirmationPDFData {
  healthCheckId: string
  vehicleReg: string
  vehicleMakeModel: string
  customerName: string
  customerEmail?: string
  approvedAt: string
  approvedItems: Array<{
    name: string
    description?: string | null
    selectedOption?: string | null
    totalIncVat: number
  }>
  declinedItems: Array<{
    name: string
    reason?: string | null
  }>
  totalApproved: number
  totalDeclined: number
  branding?: OrganizationBranding
  siteName?: string
  sitePhone?: string
}

// Unified signature data for rendering
export interface CustomerSignatureData {
  signatureData: string | null | undefined
  signedAt: string | null | undefined
}
