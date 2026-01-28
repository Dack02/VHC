const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

interface FetchOptions extends RequestInit {
  token?: string
}

export async function api<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { token, ...fetchOptions } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>)
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...fetchOptions,
    headers
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }

  return response.json()
}

// Types
export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'super_admin' | 'org_admin' | 'site_admin' | 'service_advisor' | 'technician'
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
  assigned_technician_id: string | null
  assigned_advisor_id: string | null
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
  // VHC Reference Number (format: VHC00001)
  vhc_reference?: string | null
  vehicle?: Vehicle
  customer?: Customer
  template?: Template
  // Service advisor assigned to the job
  advisor?: {
    id: string
    first_name: string
    last_name: string
  } | null
  // Pre-booked work from DMS
  booked_repairs?: Array<{
    code?: string
    description?: string
    notes?: string
  }> | null
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
}

export interface Customer {
  id: string
  first_name: string
  last_name: string
  email: string | null
  mobile: string | null
}

export interface Template {
  id: string
  name: string
  sections?: TemplateSection[]
}

export interface TemplateSection {
  id: string
  name: string
  sortOrder: number
  items: TemplateItem[]
}

export interface TemplateItem {
  id: string
  name: string
  description: string | null
  itemType: 'rag' | 'tyre_depth' | 'tyre_details' | 'brake_measurement' | 'brake_fluid' | 'fluid_level' | 'yes_no' | 'select' | 'measurement' | 'text' | 'number' | 'multi_select'
  config: Record<string, unknown>
  sortOrder: number
  isRequired: boolean
}

export interface CheckResult {
  id: string
  templateItemId: string
  instanceNumber?: number  // For duplicate items (e.g., two oil leaks), default 1
  status: 'green' | 'amber' | 'red' | null
  value: unknown
  notes: string | null
  media?: ResultMedia[]
  is_mot_failure?: boolean
  // Aliases for backwards compatibility with local storage
  health_check_id?: string
  template_item_id?: string
  instance_number?: number
  rag_status?: 'green' | 'amber' | 'red' | null
}

export interface ResultMedia {
  id: string
  url: string
  thumbnail_url: string | null
  thumbnailUrl?: string | null
  annotation_data: unknown | null
  caption?: string | null
}

export interface InspectionThresholds {
  tyreRedBelowMm: number
  tyreAmberBelowMm: number
  brakePadRedBelowMm: number
  brakePadAmberBelowMm: number
}

export const DEFAULT_THRESHOLDS: InspectionThresholds = {
  tyreRedBelowMm: 1.6,
  tyreAmberBelowMm: 3.0,
  brakePadRedBelowMm: 3.0,
  brakePadAmberBelowMm: 5.0
}

// MRI Scan Types
export interface MriItem {
  id: string
  name: string
  description: string | null
  itemType: 'date_mileage' | 'yes_no'
  severityWhenDue: string | null
  severityWhenYes: string | null
  severityWhenNo: string | null
  isInformational: boolean
  sortOrder: number
  isDeleted?: boolean
  result: MriResult | null
}

export interface MriResult {
  id?: string
  nextDueDate: string | null
  nextDueMileage: number | null
  dueIfNotReplaced: boolean
  recommendedThisVisit: boolean
  notDueYet: boolean
  yesNoValue: boolean | null
  notes: string | null
  ragStatus: 'red' | 'amber' | 'green' | null
  completedAt: string | null
  dateNa: boolean
  mileageNa: boolean
}

export interface MriResultsResponse {
  healthCheckId: string
  items: Record<string, MriItem[]>  // grouped by category
  progress: {
    completed: number
    total: number
  }
  isMriComplete: boolean
  hasArchivedItems: boolean
}

export interface CheckinSettings {
  checkinEnabled: boolean
  showMileageIn: boolean
  showTimeRequired: boolean
  showKeyLocation: boolean
  checkinTimeoutMinutes: number
}

export interface CheckinData {
  customerWaiting: boolean | null
  mileageIn: number | null
  timeRequired: string | null
  keyLocation: string | null
  checkinNotes: string | null
  checkinNotesVisibleToTech: boolean
  checkedInAt: string | null
}
