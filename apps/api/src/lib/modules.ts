/**
 * Feature/module registry — single source of truth for the modules that can be
 * enabled/disabled per organisation. Keep this list in sync with the web copy at
 * apps/web/src/lib/modules.ts (small static list; intentionally duplicated rather
 * than wiring up the unused @vhc/shared package across API + Vite).
 *
 * Resolution (see services/modules.ts): effective[key] =
 *   core            -> always true
 *   org override    -> organization_settings.module_overrides[key]   (super-admin)
 *   plan default    -> subscription_plans.features[key]
 *   registry default-> defaultOn
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

export interface ModuleDefinition {
  key: ModuleKey
  label: string
  description: string
  defaultOn: boolean
  /** Core modules can never be disabled by anyone (the product itself). */
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
  { key: 'ai_generation',      label: 'AI Generation',      description: 'AI-assisted reason & note generation', defaultOn: true }
]

export const MODULE_KEYS: ModuleKey[] = MODULES.map((m) => m.key)

export const MODULE_MAP: Record<ModuleKey, ModuleDefinition> =
  Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<ModuleKey, ModuleDefinition>

export function isModuleKey(key: string): key is ModuleKey {
  return Object.prototype.hasOwnProperty.call(MODULE_MAP, key)
}
