/**
 * Feature/module registry (web copy). Keep in sync with apps/api/src/lib/modules.ts.
 * Used by ModulesContext (frontend gating) and the admin Modules UI.
 */

export type ModuleKey =
  | 'health_checks'
  | 'workshop_board'
  | 'follow_up'
  | 'job_clocking'
  | 'library_gap_report'
  | 'dms_integration'
  | 'customer_comms'
  | 'reports'
  | 'ai_generation'
  | 'vehicle_lookup'
  | 'vehicle_details'
  | 'jobsheets'
  | 'estimates'
  | 'booking_diary'
  | 'vehicles'
  | 'vehicle_reminders'

export interface ModuleDefinition {
  key: ModuleKey
  label: string
  description: string
  defaultOn: boolean
  core?: boolean
}

export const MODULES: ModuleDefinition[] = [
  { key: 'health_checks',      label: 'Health Checks',      description: 'Core inspection workflow', defaultOn: true, core: true },
  { key: 'workshop_board',     label: 'Workshop Board',     description: 'Kanban workshop management board', defaultOn: true },
  { key: 'follow_up',          label: 'Follow-Up Recovery', description: 'Deferred-work recovery automation', defaultOn: true },
  { key: 'job_clocking',       label: 'Job Clocking',       description: 'Technician job & indirect time tracking', defaultOn: true },
  { key: 'library_gap_report', label: 'Library Gap Report', description: 'Daily digest of manually-typed inspection notes', defaultOn: true },
  { key: 'dms_integration',    label: 'DMS Integration',    description: 'Booking import from dealer management systems', defaultOn: true },
  { key: 'customer_comms',     label: 'Customer Messaging', description: 'SMS & email customer communications', defaultOn: true },
  { key: 'reports',            label: 'Reports',            description: 'Reporting & analytics dashboards', defaultOn: true },
  { key: 'ai_generation',      label: 'AI Generation',      description: 'AI-assisted reason & note generation', defaultOn: true },
  { key: 'vehicle_lookup',     label: 'Vehicle Data Lookup', description: 'DVSA MOT history & vehicle lookup by registration', defaultOn: true },
  { key: 'vehicle_details',    label: 'Vehicle Data (DVLA spec)', description: 'Paid DVLA spec, provenance & keeper/V5 enrichment (Vehicle Data Global)', defaultOn: true },
  { key: 'jobsheets',          label: 'Jobsheets (GMS)',    description: 'Top-level booking document with attached health checks', defaultOn: false },
  { key: 'estimates',          label: 'Estimates (GMS)',    description: 'Standalone pre-booking priced quotes that convert into jobsheets', defaultOn: true },
  { key: 'booking_diary',      label: 'Booking Diary',      description: 'Daily/weekly booking diary with workshop capacity and job-type counts', defaultOn: true },
  { key: 'vehicles',           label: 'Vehicles',           description: 'Vehicle asset register with owners/drivers, notes, MOT/service/custom expiry tracking', defaultOn: true },
  { key: 'vehicle_reminders',  label: 'Expiry Reminders',   description: 'Expiry-driven (MOT/Service/custom) reminder campaigns via the Follow-Up engine', defaultOn: false }
]

export const MODULE_KEYS: ModuleKey[] = MODULES.map((m) => m.key)

export const MODULE_MAP: Record<ModuleKey, ModuleDefinition> =
  Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<ModuleKey, ModuleDefinition>
