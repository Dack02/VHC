const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

interface ApiOptions {
  method?: string
  body?: unknown
  token?: string | null
  retry?: boolean
  retryCount?: number
  retryDelay?: number
  timeout?: number
}

// API Error with additional context
export class ApiError extends Error {
  public readonly status: number
  public readonly code?: string
  public readonly details?: Record<string, unknown>

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  get isNetworkError(): boolean {
    return this.status === 0
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  get isRateLimited(): boolean {
    return this.status === 429
  }

  get isServerError(): boolean {
    return this.status >= 500
  }
}

// Helper to check if error is retryable
function isRetryableError(status: number): boolean {
  // Retry on network errors (0), server errors (5xx), and rate limits (429)
  return status === 0 || status >= 500 || status === 429
}

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    token,
    retry = true,
    retryCount = 3,
    retryDelay = 1000,
    timeout = 30000,
  } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let lastError: ApiError | null = null
  const attempts = retry ? retryCount : 1

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(`${API_URL}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Try to parse JSON response
      let data: Record<string, unknown> = {}
      const contentType = response.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        data = await response.json()
      }

      if (!response.ok) {
        const error = new ApiError(
          (data.error as string) || `Request failed with status ${response.status}`,
          response.status,
          data.code as string | undefined,
          data.details as Record<string, unknown> | undefined
        )

        // Check if we should retry
        if (retry && attempt < attempts && isRetryableError(response.status)) {
          lastError = error
          // Exponential backoff with jitter
          const delay = retryDelay * Math.pow(2, attempt - 1) + Math.random() * 1000
          console.warn(`API request failed (attempt ${attempt}/${attempts}), retrying in ${Math.round(delay)}ms...`)
          await sleep(delay)
          continue
        }

        throw error
      }

      return data as T
    } catch (err) {
      // Handle abort/timeout
      if (err instanceof Error && err.name === 'AbortError') {
        const error = new ApiError('Request timed out', 0)
        if (retry && attempt < attempts) {
          lastError = error
          const delay = retryDelay * Math.pow(2, attempt - 1)
          console.warn(`API request timed out (attempt ${attempt}/${attempts}), retrying in ${delay}ms...`)
          await sleep(delay)
          continue
        }
        throw error
      }

      // Handle network errors
      if (err instanceof TypeError && err.message.includes('fetch')) {
        const error = new ApiError('Network error - please check your connection', 0)
        if (retry && attempt < attempts) {
          lastError = error
          const delay = retryDelay * Math.pow(2, attempt - 1)
          console.warn(`Network error (attempt ${attempt}/${attempts}), retrying in ${delay}ms...`)
          await sleep(delay)
          continue
        }
        throw error
      }

      // Re-throw ApiError directly
      if (err instanceof ApiError) {
        throw err
      }

      // Wrap unknown errors
      throw new ApiError(
        err instanceof Error ? err.message : 'An unexpected error occurred',
        0
      )
    }
  }

  // Should never reach here, but just in case
  throw lastError || new ApiError('Request failed after all retries', 0)
}

// Types
export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  organizationId: string
  siteId: string | null
  isActive: boolean
}

export interface HealthCheck {
  id: string
  organization_id: string
  site_id: string | null
  vehicle_id: string
  customer_id: string
  template_id: string
  technician_id: string | null
  advisor_id: string | null
  status: string
  created_at: string
  updated_at: string
  mileage_in: number | null
  mileage_out: number | null
  promise_time: string | null
  notes: string | null
  technician_notes: string | null
  advisor_notes: string | null
  green_count: number
  amber_count: number
  red_count: number
  total_labour: number
  total_parts: number
  total_amount: number
  public_token: string | null
  public_expires_at: string | null
  sent_at: string | null
  first_opened_at: string | null
  closed_at: string | null
  closed_by: string | null
  closed_by_user?: { id: string; first_name: string; last_name: string } | null
  vehicle?: Vehicle
  customer?: Customer
  technician?: { id: string; first_name: string; last_name: string }
  advisor?: { id: string; first_name: string; last_name: string }
  template?: Template
  // Phase 1 Quick Wins - DMS Integration fields
  arrived_at?: string | null
  due_date?: string | null
  booked_date?: string | null
  customer_waiting?: boolean
  loan_car_required?: boolean
  is_internal?: boolean
  booked_repairs?: Array<{ code?: string; description?: string; notes?: string }>
  jobsheet_number?: string | null
  jobsheet_status?: string | null
  external_id?: string | null
  external_source?: string | null
}

export interface Vehicle {
  id: string
  registration: string
  vin: string | null
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  fuel_type: string | null
  mileage: number | null
  customer_id: string
  customer?: Customer
}

export interface Customer {
  id: string
  first_name: string
  last_name: string
  email: string | null
  mobile: string | null
  external_id: string | null
  // Phase 1 Quick Wins - Address fields
  title?: string | null
  address_line1?: string | null
  address_line2?: string | null
  town?: string | null
  county?: string | null
  postcode?: string | null
}

export interface Site {
  id: string
  name: string
}

export interface Template {
  id: string
  name: string
  sections?: TemplateSection[]
}

export interface TemplateSection {
  id: string
  name: string
  sort_order: number
  items: TemplateItem[]
}

export interface TemplateItem {
  id: string
  name: string
  description: string | null
  item_type: string
  config: Record<string, unknown>
  sort_order: number
  is_required: boolean
}

export interface CheckResult {
  id: string
  health_check_id: string
  template_item_id: string
  instance_number?: number  // For duplicate items (e.g., two oil leaks), default 1
  rag_status: 'green' | 'amber' | 'red' | null
  value: unknown
  notes: string | null
  is_mot_failure?: boolean
  checked_at?: string | null
  checked_by?: string | null
  media?: ResultMedia[]
  template_item?: {
    id: string
    name: string
    description: string | null
    item_type: string
    config: Record<string, unknown>
    section?: {
      id: string
      name: string
      sort_order: number
    }
  }
}

export interface ResultMedia {
  id: string
  url: string
  thumbnail_url: string | null
  annotation_data: unknown | null
  caption?: string | null
  sort_order?: number
  include_in_report?: boolean
}

export interface RepairItem {
  id: string
  health_check_id: string
  check_result_id: string | null
  title: string
  description: string | null
  rag_status: 'amber' | 'red'
  parts_cost: number
  labor_cost: number
  total_price: number
  is_approved: boolean | null
  is_visible: boolean
  is_mot_failure: boolean
  follow_up_date: string | null
  work_completed_at: string | null
  work_completed_by: string | null
  work_completed_by_user?: { id: string; first_name: string; last_name: string } | null
  sort_order: number
  created_at: string
  // Group/parent-child fields
  is_group?: boolean
  parent_repair_item_id?: string | null
  children?: RepairItem[]
}

export interface StatusHistoryEntry {
  id: string
  health_check_id: string
  from_status: string | null
  to_status: string
  changed_by: string
  notes: string | null
  created_at: string
  user?: { first_name: string; last_name: string }
}

export interface Authorization {
  id: string
  repair_item_id: string
  decision: 'approved' | 'declined'
  decided_at: string
  customer_notes: string | null
  signature_data: boolean
}

export interface HealthCheckSummary {
  total_items: number
  red_count: number
  amber_count: number
  green_count: number
  total_identified: number
  total_authorised: number
  total_declined: number
  work_completed_count: number
  work_outstanding_count: number
  work_completed_value: number
  work_outstanding_value: number
  media_count: number
}

export interface FullHealthCheckResponse {
  healthCheck: HealthCheck
  check_results?: CheckResult[]
  repair_items?: RepairItem[]
  authorizations?: Authorization[]
  summary?: HealthCheckSummary
}

// ============================================================================
// REPAIR GROUPS & PRICING TYPES
// ============================================================================

export interface LabourCode {
  id: string
  code: string
  description: string
  hourlyRate: number
  isVatExempt: boolean
  isActive: boolean
  isDefault: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface Supplier {
  id: string
  name: string
  code: string | null
  accountNumber: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  isQuickAdd: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface RepairLabour {
  id: string
  labourCodeId: string
  labourCode?: {
    id: string
    code: string
    description: string
  }
  hours: number
  rate: number
  discountPercent: number
  total: number
  isVatExempt: boolean
  notes: string | null
  createdAt?: string
}

export interface RepairPart {
  id: string
  partNumber: string | null
  description: string
  quantity: number
  supplierId: string | null
  supplierName: string | null
  costPrice: number
  sellPrice: number
  lineTotal: number
  marginPercent: number | null
  markupPercent: number | null
  notes: string | null
  createdAt?: string
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
  sortOrder: number
  labour?: RepairLabour[]
  parts?: RepairPart[]
}

// Child item interface for grouped items
export interface RepairItemChild {
  id: string
  healthCheckId: string
  name: string
  description: string | null
  isGroup: boolean
  parentRepairItemId: string | null
  labourStatus: 'pending' | 'in_progress' | 'complete'
  noLabourRequired: boolean
  labour?: RepairLabour[]
  checkResults?: Array<{
    id: string
    ragStatus: string
    notes: string | null
    templateItem?: { id: string; name: string }
  }>
}

export interface NewRepairItem {
  id: string
  healthCheckId: string
  name: string
  description: string | null
  isGroup: boolean
  parentRepairItemId: string | null
  labourTotal: number
  partsTotal: number
  subtotal: number
  vatAmount: number
  totalIncVat: number
  priceOverride: number | null
  priceOverrideReason: string | null
  labourStatus: 'pending' | 'in_progress' | 'complete'
  partsStatus: 'pending' | 'in_progress' | 'complete'
  quoteStatus: 'pending' | 'ready'
  customerApproved: boolean | null
  customerApprovedAt: string | null
  customerDeclinedReason: string | null
  selectedOptionId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  labourCompletedBy: string | null
  labourCompletedAt: string | null
  partsCompletedBy: string | null
  partsCompletedAt: string | null
  noLabourRequired: boolean
  noLabourRequiredBy: string | null
  noLabourRequiredAt: string | null
  checkResults?: Array<{
    id: string
    ragStatus: string
    notes: string | null
    templateItem?: { id: string; name: string }
  }>
  options?: RepairOption[]
  labour?: RepairLabour[]
  parts?: RepairPart[]
  children?: RepairItemChild[]
}

export interface PricingSettings {
  defaultMarginPercent: number
  vatRate: number
}

export interface PricingCalculation {
  costPrice: number
  sellPrice: number
  marginPercent: number
  markupPercent: number
  profit: number
}
