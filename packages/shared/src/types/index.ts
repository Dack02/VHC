// User roles
export type UserRole =
  | 'super_admin'
  | 'org_admin'
  | 'site_admin'
  | 'service_advisor'
  | 'technician'

// Health check status workflow
export type HealthCheckStatus =
  | 'awaiting_arrival'
  | 'awaiting_checkin'
  | 'created'
  | 'assigned'
  | 'in_progress'
  | 'paused'
  | 'tech_completed'
  | 'awaiting_review'
  | 'awaiting_pricing'
  | 'awaiting_parts'
  | 'ready_to_send'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'partial_response'
  | 'authorized'
  | 'declined'
  | 'expired'
  | 'completed'
  | 'cancelled'
  | 'no_show'

// RAG status for check items
export type RagStatus = 'green' | 'amber' | 'red' | 'not_checked'

// Check item types
export type ItemType =
  | 'rag'
  | 'measurement'
  | 'yes_no'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'tyre_depth'
  | 'brake_measurement'
  | 'fluid_level'

// Organization
export interface Organization {
  id: string
  name: string
  slug: string
  settings: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

// Site (location within an organization)
export interface Site {
  id: string
  organizationId: string
  name: string
  address?: string
  phone?: string
  email?: string
  settings: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

// User
export interface User {
  id: string
  authId?: string
  organizationId: string
  siteId?: string
  email: string
  firstName: string
  lastName: string
  phone?: string
  role: UserRole
  isActive: boolean
  settings: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

// Customer
export interface Customer {
  id: string
  organizationId: string
  siteId?: string
  externalId?: string
  firstName: string
  lastName: string
  email?: string
  mobile?: string
  address?: string
  createdAt: Date
  updatedAt: Date
}

// Vehicle
export interface Vehicle {
  id: string
  organizationId: string
  customerId?: string
  registration: string
  vin?: string
  make?: string
  model?: string
  year?: number
  color?: string
  fuelType?: string
  engineSize?: string
  createdAt: Date
  updatedAt: Date
}

// Check Template
export interface CheckTemplate {
  id: string
  organizationId: string
  siteId?: string
  name: string
  description?: string
  isActive: boolean
  isDefault: boolean
  version: number
  createdAt: Date
  updatedAt: Date
}

// Template Section
export interface TemplateSection {
  id: string
  templateId: string
  name: string
  description?: string
  sortOrder: number
  createdAt: Date
}

// Template Item
export interface TemplateItem {
  id: string
  sectionId: string
  name: string
  description?: string
  itemType: ItemType
  isRequired: boolean
  requiresLocation?: boolean
  sortOrder: number
  config: Record<string, unknown>
  createdAt: Date
}

// Health Check
export interface HealthCheck {
  id: string
  organizationId: string
  siteId: string
  templateId: string
  customerId?: string
  vehicleId: string
  technicianId?: string
  advisorId?: string
  jobNumber?: string
  jobType?: string
  bayNumber?: string
  mileageIn?: number
  status: HealthCheckStatus
  priority: string
  promisedAt?: Date
  blockedReason?: string
  blockedAt?: Date
  assignedAt?: Date
  techStartedAt?: Date
  techCompletedAt?: Date
  advisorReviewedAt?: Date
  pricingCompletedAt?: Date
  sentAt?: Date
  deliveredAt?: Date
  firstOpenedAt?: Date
  firstResponseAt?: Date
  fullyRespondedAt?: Date
  completedAt?: Date
  publicToken?: string
  tokenExpiresAt?: Date
  customerViewCount: number
  customerFirstViewedAt?: Date
  customerLastViewedAt?: Date
  remindersSent: number
  lastReminderAt?: Date
  activeTimeEntryId?: string
  totalTechTimeMinutes: number
  publishSettings: Record<string, unknown>
  greenCount: number
  amberCount: number
  redCount: number
  notCheckedCount: number
  technicianNotes?: string
  advisorNotes?: string
  createdAt: Date
  updatedAt: Date
}

// Check Result
export interface CheckResult {
  id: string
  healthCheckId: string
  templateItemId: string
  instanceNumber: number  // For duplicate items (e.g., two oil leaks), default 1
  vehicleLocationId?: string
  vehicleLocationName?: string
  ragStatus?: RagStatus
  value?: Record<string, unknown>
  notes?: string
  checkedAt?: Date
  checkedBy?: string
  createdAt: Date
  updatedAt: Date
}

// Vehicle Location
export interface VehicleLocation {
  id: string
  organizationId: string
  name: string
  shortName: string
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

// Result Media
export interface ResultMedia {
  id: string
  checkResultId: string
  mediaType: 'photo' | 'video'
  storagePath: string
  thumbnailPath?: string
  originalFilename?: string
  fileSize?: number
  mimeType?: string
  sortOrder: number
  caption?: string
  createdAt: Date
}

// Repair Item
export interface RepairItem {
  id: string
  healthCheckId: string
  checkResultId?: string
  title: string
  description?: string
  ragStatus: RagStatus
  partsCost: number
  laborCost: number
  totalPrice: number
  isVisible: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

// Authorization
export interface Authorization {
  id: string
  healthCheckId: string
  repairItemId: string
  decision: 'approved' | 'declined'
  decidedAt: Date
  signatureData?: string
  signatureIp?: string
  signatureUserAgent?: string
  customerNotes?: string
  createdAt: Date
}

// Time Entry
export interface TechnicianTimeEntry {
  id: string
  healthCheckId: string
  technicianId: string
  clockInAt: Date
  clockOutAt?: Date
  durationMinutes?: number
  workType: string
  notes?: string
  createdAt: Date
}

// Status History
export interface HealthCheckStatusHistory {
  id: string
  healthCheckId: string
  fromStatus?: HealthCheckStatus
  toStatus: HealthCheckStatus
  changedBy?: string
  changeSource: 'user' | 'system' | 'customer'
  notes?: string
  changedAt: Date
}

// Customer Activity
export interface CustomerActivity {
  id: string
  healthCheckId: string
  activityType: string
  repairItemId?: string
  metadata: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
  deviceType?: string
  createdAt: Date
}

// Staff Notification
export interface StaffNotification {
  id: string
  userId: string
  siteId: string
  healthCheckId?: string
  type: string
  title: string
  message: string
  priority: string
  readAt?: Date
  dismissedAt?: Date
  actionUrl?: string
  createdAt: Date
}

// Scheduled Job
export interface ScheduledJob {
  id: string
  jobType: string
  healthCheckId?: string
  scheduledFor: Date
  status: 'pending' | 'processing' | 'completed' | 'failed'
  startedAt?: Date
  completedAt?: Date
  error?: string
  attempts: number
  payload: Record<string, unknown>
  createdAt: Date
}
