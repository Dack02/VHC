// Shared types for the Vehicles module (web). Mirrors the API responses in
// apps/api/src/routes/vehicles.ts.

export interface VehicleCustomerRef {
  id: string
  first_name: string
  last_name: string
  email?: string | null
  mobile?: string | null
  company_name?: string | null
}

export interface VehicleListRow {
  id: string
  registration: string
  make: string | null
  model: string | null
  year: number | null
  derivative: string | null
  body_type: string | null
  fuel_type: string | null
  color: string | null
  mot_status: string | null
  mot_expiry_date: string | null
  lifecycle_status: string | null
  number_of_previous_keepers: number | null
  last_activity_at: string | null
  customer: VehicleCustomerRef | null
}

export type VehicleRole = 'owner' | 'driver' | 'keeper' | 'fleet_account'

export interface VehicleLink {
  id: string
  customer_id: string
  role: VehicleRole
  is_primary: boolean
  is_reminder_recipient: boolean
  start_date: string | null
  end_date: string | null
  notes: string | null
  customer: VehicleCustomerRef | null
}

export type NoteCategory = 'general' | 'warning' | 'blocked' | 'internal'

export interface VehicleNote {
  id: string
  body: string
  category: NoteCategory
  is_pinned: boolean
  created_at: string
  updated_at?: string
  author: { id: string; first_name: string; last_name: string } | null
}

export interface VehicleExpiry {
  id: string
  type_code: string
  due_date: string | null
  due_mileage: number | null
  source: string
  is_active: boolean
  snoozed_until: string | null
  last_notified_at?: string | null
  notes: string | null
  expiry_type: { id: string; code: string; label: string; is_mileage_based: boolean } | null
}

export interface VehicleDetailData {
  id: string
  registration: string
  vin: string | null
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  fuel_type: string | null
  engine_size: string | null
  mileage: number | null
  derivative: string | null
  body_type: string | null
  transmission: string | null
  drive_type: string | null
  power_bhp: number | null
  co2_gkm: number | null
  euro_status: string | null
  powertrain_type: string | null
  taxation_class: string | null
  vehicle_class: string | null
  date_first_registered: string | null
  mot_status: string | null
  mot_expiry_date: string | null
  mot_last_synced_at: string | null
  first_used_date: string | null
  lifecycle_status: string | null
  lifecycle_changed_at: string | null
  keeper_start_date: string | null
  number_of_previous_keepers: number | null
  previous_keeper_disposal_date: string | null
  latest_v5c_issue_date: string | null
  vehicle_data_synced_at: string | null
  vehicle_spec: Record<string, unknown> | null
  last_activity_at: string | null
  customer: VehicleCustomerRef | null
  links: VehicleLink[]
  notes: VehicleNote[]
  expiries: VehicleExpiry[]
  created_at: string
  updated_at: string | null
}

export interface MotTest {
  id: string
  completedDate: string | null
  testResult: string | null
  expiryDate: string | null
  odometerValue: number | null
  odometerUnit: string | null
  defects: Array<{ text: string; type: string; dangerous: boolean }>
}

export interface MotHistory {
  motStatus: string | null
  motExpiryDate: string | null
  lastSyncedAt: string | null
  firstUsedDate: string | null
  tests: MotTest[]
}

export interface OwnershipHistoryRow {
  id: string
  reason: string | null
  notes: string | null
  changed_at: string
  from_customer: VehicleCustomerRef | null
  to_customer: VehicleCustomerRef | null
  changed_by_user: { id: string; first_name: string; last_name: string } | null
}

export interface ExpiryType {
  id: string
  code: string
  label: string
  is_system: boolean
  is_mileage_based: boolean
  default_interval_months: number | null
  default_interval_miles: number | null
  default_channel: string
  default_lead_days: number
  is_active: boolean
  sort_order: number
}

// ---- display helpers ----

export function customerName(c?: VehicleCustomerRef | null): string {
  if (!c) return 'No customer'
  if (c.company_name) return c.company_name
  return `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unnamed'
}

export const ROLE_LABELS: Record<VehicleRole, string> = {
  owner: 'Owner',
  driver: 'Driver',
  keeper: 'Registered keeper',
  fleet_account: 'Fleet account'
}

export const LIFECYCLE_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  sold: 'bg-amber-100 text-amber-700',
  scrapped: 'bg-red-100 text-red-700',
  exported: 'bg-orange-100 text-orange-700',
  destroyed: 'bg-red-100 text-red-700'
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** RAG tone for a due date relative to today. */
export function dueTone(due: string | null): { label: string; cls: string } {
  if (!due) return { label: 'Not set', cls: 'bg-gray-100 text-gray-500' }
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86400000)
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, cls: 'bg-rag-red text-white' }
  if (days <= 30) return { label: `Due in ${days}d`, cls: 'bg-rag-amber text-white' }
  return { label: `${days}d`, cls: 'bg-rag-green text-white' }
}
