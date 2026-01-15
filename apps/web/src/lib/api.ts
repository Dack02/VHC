const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

interface ApiOptions {
  method?: string
  body?: unknown
  token?: string | null
}

export async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'API request failed')
  }

  return data
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
