/**
 * Vehicle Data Global — VehicleDetails API client.
 *
 * Looks up DVLA-sourced vehicle identity, full manufacturer spec, and provenance
 * (keeper/V5/colour history, import/export/scrap status) by registration. This
 * is a PAID, per-lookup enrichment layer that COMPLEMENTS the free DVSA MOT
 * History lookup (services/mot-history.ts) — it returns no MOT data, and MOT
 * remains the sole source for MOT expiry/status/history.
 *
 * Credentials resolve ENV-first (platform secret store / Railway) then fall back
 * to an encrypted platform_settings row (id='vehicle_details'), mirroring the
 * DVSA MOT and postcode lookups. The feature is INERT until a key is supplied:
 * every entry point returns a clean NOT_CONFIGURED.
 *
 * See also: lib/encryption.ts, routes/vehicle-details.ts, routes/vehicles.ts
 * (enrich-on-create + on-demand refresh), routes/admin/platform.ts (credential
 * management + test). Field map + design: docs/vehicle-details-integration-plan.md.
 */

import { decrypt, isEncryptionConfigured } from '../lib/encryption.js'
import { logger } from '../lib/logger.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { notifyVehicleCreditLow } from './super-admin-alerts.js'

// ============================================
// Configuration
// ============================================

const DEFAULT_TIMEOUT = 12000 // 12s
const DEFAULT_BASE_URL = 'https://uk.api.vehicledataglobal.com/r2/lookup'
const PACKAGE_NAME = 'VehicleDetails'
const DEFAULT_LOW_CREDIT_THRESHOLD = 10 // GBP — warn super admins below this VDGL balance

// ============================================
// Types
// ============================================

export type VehicleLifecycleStatus = 'active' | 'sold' | 'scrapped' | 'exported' | 'destroyed'

export interface VehicleDetailsResult {
  success: boolean
  found: boolean
  registration: string
  /** VDGL internal unique model code (results.vehicleCodes.uvc). */
  uvc: string | null

  // Identity / spec
  vin: string | null
  make: string | null
  model: string | null
  derivative: string | null
  color: string | null
  fuelType: string | null
  /** Engine capacity in CC, stringified to match the existing engine_size column. */
  engineSize: string | null
  year: number | null
  bodyType: string | null
  transmission: string | null
  driveType: string | null
  powerBhp: number | null
  co2: number | null
  euroStatus: string | null
  powertrainType: string | null     // ICE | BEV | PHEV | REEV
  taxationClass: string | null      // Car | PVC | LCV | HCV | Quad
  vehicleClass: string | null
  dateFirstRegistered: string | null // YYYY-MM-DD

  // Lifecycle facts (DVLA)
  isScrapped: boolean | null
  isExported: boolean | null
  isImported: boolean | null
  certificateOfDestructionIssued: boolean | null

  // Keeper / V5 provenance
  keeperStartDate: string | null
  numberOfPreviousKeepers: number | null
  previousKeeperDisposalDate: string | null
  latestV5cIssueDate: string | null

  /** Full results payload — everything not promoted to a column. */
  raw: unknown

  // Billing (from VDGL billingInformation) — our actual cost for this call.
  cost: number | null              // transactionCost (GBP); null when not billed
  billed: boolean                  // a real charge occurred (billingTransactionId present)
  billingTransactionId: string | null
  accountBalance: number | null    // remaining VDGL platform credit
  responseId: string | null        // responseInformation.responseId (support queries)

  error?: string
  errorCode?:
    | 'NOT_CONFIGURED'
    | 'DISABLED'
    | 'INVALID'
    | 'NOT_FOUND'
    | 'RATE_LIMITED'
    | 'AUTH_FAILED'
    | 'API_ERROR'
    | 'EXCEPTION'
}

interface VehicleDetailsConfig {
  configured: boolean
  enabled: boolean
  apiKey: string | null
  baseUrl: string
  source: 'env' | 'database' | 'none'
  error?: string
}

// Raw VDGL response shapes (only the fields we consume)
interface RawVehicleDetailsResponse {
  responseInformation?: { isSuccessStatusCode?: boolean; statusCode?: number; statusMessage?: string; responseId?: string }
  billingInformation?: { billingTransactionId?: string | null; transactionCost?: number | null; accountBalance?: number | null; billingResult?: number }
  results?: {
    vehicleCodes?: { uvc?: string }
    vehicleDetails?: {
      vehicleIdentification?: Record<string, unknown>
      vehicleStatus?: Record<string, unknown>
      vehicleHistory?: Record<string, unknown>
      dvlaTechnicalDetails?: Record<string, unknown>
    }
    modelDetails?: Record<string, unknown>
  }
}

// ============================================
// Credential resolution
// ============================================

/** Read VehicleDetails config from environment variables, if a key is present. */
function readEnvConfig(): VehicleDetailsConfig | null {
  const apiKey = process.env.VEHICLE_DETAILS_API_KEY
  if (!apiKey) return null
  return {
    configured: true,
    enabled: process.env.VEHICLE_DETAILS_ENABLED !== 'false',
    apiKey,
    baseUrl: process.env.VEHICLE_DETAILS_BASE_URL || DEFAULT_BASE_URL,
    source: 'env'
  }
}

/** True when the VehicleDetails key is supplied via environment variables. */
export function isVehicleDetailsManagedByEnv(): boolean {
  return !!process.env.VEHICLE_DETAILS_API_KEY
}

/**
 * Resolve VehicleDetails config. Environment variables win over the encrypted
 * platform_settings row so the secret can live in Railway. Returns
 * `configured: false` (source 'none') when nothing is set up.
 */
export async function getVehicleDetailsConfig(): Promise<VehicleDetailsConfig> {
  const envConfig = readEnvConfig()
  if (envConfig) return envConfig

  try {
    const { data: row, error } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'vehicle_details')
      .maybeSingle()

    if (error || !row?.settings) {
      return { configured: false, enabled: false, apiKey: null, baseUrl: DEFAULT_BASE_URL, source: 'none', error: 'Vehicle details lookup is not configured' }
    }

    const s = row.settings as Record<string, unknown>
    const enabled = s.enabled === true
    const baseUrl = (s.base_url as string) || DEFAULT_BASE_URL
    const apiKeyEnc = (s.api_key_encrypted as string) || ''

    if (!apiKeyEnc) {
      return { configured: false, enabled, apiKey: null, baseUrl, source: 'none', error: 'Vehicle details API key is not set' }
    }
    if (!isEncryptionConfigured()) {
      return { configured: false, enabled, apiKey: null, baseUrl, source: 'none', error: 'Encryption is not configured on the server' }
    }

    let apiKey: string
    try {
      apiKey = decrypt(apiKeyEnc)
    } catch (decryptError) {
      logger.error('Failed to decrypt vehicle-details key', {}, decryptError as Error)
      return { configured: false, enabled, apiKey: null, baseUrl, source: 'none', error: 'Failed to decrypt vehicle details key' }
    }

    return { configured: true, enabled, apiKey, baseUrl, source: 'database' }
  } catch (err) {
    logger.error('Error fetching vehicle-details config', {}, err as Error)
    return { configured: false, enabled: false, apiKey: null, baseUrl: DEFAULT_BASE_URL, source: 'none', error: 'Failed to fetch vehicle details config' }
  }
}

/** Lightweight status for the UI (whether to offer the enrich/refresh action). */
export async function getVehicleDetailsStatus(): Promise<{ configured: boolean; enabled: boolean; source: string }> {
  const cfg = await getVehicleDetailsConfig()
  return { configured: cfg.configured, enabled: cfg.enabled, source: cfg.source }
}

// ============================================
// Mapping helpers
// ============================================

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function bool(v: unknown): boolean | null {
  if (v === true || v === false) return v
  return null
}

/** Coerce a DVLA DateTime/ISO string to a YYYY-MM-DD date, or null. */
function dateOnly(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  // Already date-like (YYYY-MM-DD...) — slice the date portion.
  const m = s.match(/^\d{4}-\d{2}-\d{2}/)
  if (m) return m[0]
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function yearFrom(...values: unknown[]): number | null {
  for (const v of values) {
    const n = num(v)
    if (n && n > 1900 && n < 3000) return n
    const d = dateOnly(v)
    if (d) return Number(d.slice(0, 4))
  }
  return null
}

function mapVehicleDetails(reg: string, raw: RawVehicleDetailsResponse): VehicleDetailsResult {
  const results = raw.results || {}
  const vd = results.vehicleDetails || {}
  const ident = (vd.vehicleIdentification || {}) as Record<string, unknown>
  const status = (vd.vehicleStatus || {}) as Record<string, unknown>
  const history = (vd.vehicleHistory || {}) as Record<string, unknown>
  const tech = (vd.dvlaTechnicalDetails || {}) as Record<string, unknown>
  const md = (results.modelDetails || {}) as Record<string, unknown>
  const modelIdent = (md.modelIdentification || {}) as Record<string, unknown>
  const modelClass = (md.modelClassification || {}) as Record<string, unknown>
  const bodyDetails = (md.bodyDetails || {}) as Record<string, unknown>
  const powertrain = (md.powertrain || {}) as Record<string, unknown>
  const transmissionObj = (powertrain.transmission || {}) as Record<string, unknown>
  const performance = (md.performance || {}) as Record<string, unknown>
  const power = (performance.power || {}) as Record<string, unknown>
  const emissions = (md.emissions || {}) as Record<string, unknown>
  const ved = (status.vehicleExciseDutyDetails || {}) as Record<string, unknown>
  const colour = (history.colourDetails || {}) as Record<string, unknown>

  // Keeper: pick the most recent change (max keeperStartDate), fall back to first.
  const keeperList = Array.isArray(history.keeperChangeList) ? (history.keeperChangeList as Record<string, unknown>[]) : []
  const latestKeeper = keeperList.slice().sort((a, b) =>
    (dateOnly(b.keeperStartDate) || '').localeCompare(dateOnly(a.keeperStartDate) || ''))[0] || {}

  // V5C: most recent issue date across the list.
  const v5cList = Array.isArray(history.v5cCertificateList) ? (history.v5cCertificateList as Record<string, unknown>[]) : []
  const latestV5c = v5cList
    .map((c) => dateOnly(c.issueDate))
    .filter((d): d is string => !!d)
    .sort((a, b) => b.localeCompare(a))[0] || null

  const cc = num(tech.engineCapacityCc) ?? num((powertrain.iceDetails as Record<string, unknown> | undefined)?.engineCapacityCc)

  return {
    success: true,
    found: true,
    registration: str(ident.vrm) || reg,
    uvc: str((results.vehicleCodes || {}).uvc),

    vin: str(ident.vin),
    make: str(ident.dvlaMake) || str(modelIdent.make),
    model: str(modelIdent.model) || str(ident.dvlaModel),
    derivative: str(modelIdent.modelVariant) || str(modelIdent.series),
    color: str(colour.currentColour),
    fuelType: str(ident.dvlaFuelType) || str(powertrain.fuelType),
    engineSize: cc != null ? String(cc) : null,
    year: yearFrom(ident.yearOfManufacture, ident.dateFirstRegisteredInUk, ident.dateOfManufacture),
    bodyType: str(bodyDetails.bodyStyle) || str(ident.dvlaBodyType),
    transmission: str(transmissionObj.transmissionType),
    driveType: str(transmissionObj.driveType),
    powerBhp: num(power.bhp),
    co2: num(ved.dvlaCo2) ?? num(emissions.manufacturerCo2),
    euroStatus: str(emissions.euroStatus),
    powertrainType: str(powertrain.powertrainType),
    taxationClass: str(modelClass.taxationClass),
    vehicleClass: str(modelClass.vehicleClass),
    dateFirstRegistered: dateOnly(ident.dateFirstRegisteredInUk) || dateOnly(ident.dateFirstRegistered),

    isScrapped: bool(status.isScrapped),
    isExported: bool(status.isExported),
    isImported: bool(status.isImported),
    certificateOfDestructionIssued: bool(status.certificateOfDestructionIssued),

    keeperStartDate: dateOnly(latestKeeper.keeperStartDate),
    numberOfPreviousKeepers: num(latestKeeper.numberOfPreviousKeepers),
    previousKeeperDisposalDate: dateOnly(latestKeeper.previousKeeperDisposalDate),
    latestV5cIssueDate: latestV5c,

    raw: results,
    // Billing defaults — overlaid with real values by performLookup via extractBilling.
    cost: null, billed: false, billingTransactionId: null, accountBalance: null, responseId: null
  }
}

// ============================================
// Lookup
// ============================================

function emptyResult(reg: string): VehicleDetailsResult {
  return {
    success: false, found: false, registration: reg, uvc: null,
    vin: null, make: null, model: null, derivative: null, color: null, fuelType: null,
    engineSize: null, year: null, bodyType: null, transmission: null, driveType: null,
    powerBhp: null, co2: null, euroStatus: null, powertrainType: null, taxationClass: null,
    vehicleClass: null, dateFirstRegistered: null, isScrapped: null, isExported: null,
    isImported: null, certificateOfDestructionIssued: null, keeperStartDate: null,
    numberOfPreviousKeepers: null, previousKeeperDisposalDate: null, latestV5cIssueDate: null,
    raw: null,
    cost: null, billed: false, billingTransactionId: null, accountBalance: null, responseId: null
  }
}

/** Extract the billing/response metadata VDGL returns on (almost) every call. */
function extractBilling(raw: RawVehicleDetailsResponse) {
  const b = raw.billingInformation || {}
  return {
    cost: num(b.transactionCost),
    billed: !!b.billingTransactionId,
    billingTransactionId: str(b.billingTransactionId),
    accountBalance: num(b.accountBalance),
    responseId: str(raw.responseInformation?.responseId)
  }
}

/** Core HTTP lookup. Assumes config is resolved; no enabled-gate. */
async function performLookup(cfg: VehicleDetailsConfig, reg: string): Promise<VehicleDetailsResult> {
  const empty = emptyResult(reg)
  const url = `${cfg.baseUrl}?packageName=${encodeURIComponent(PACKAGE_NAME)}&vrm=${encodeURIComponent(reg)}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timeoutId)
    logger.error('Vehicle details lookup failed', { registration: reg }, err as Error)
    return { ...empty, error: err instanceof Error ? err.message : 'Vehicle details lookup failed', errorCode: 'EXCEPTION' }
  } finally {
    clearTimeout(timeoutId)
  }

  if (res.status === 429) {
    return { ...empty, error: 'Vehicle details rate limit reached — please try again shortly', errorCode: 'RATE_LIMITED' }
  }
  if (res.status === 401 || res.status === 403) {
    return { ...empty, error: 'Vehicle details authentication failed — check the API key', errorCode: 'AUTH_FAILED' }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ...empty, error: `Vehicle details lookup failed (${res.status})${text ? ': ' + text.slice(0, 160) : ''}`, errorCode: 'API_ERROR' }
  }

  let raw: RawVehicleDetailsResponse
  try {
    raw = (await res.json()) as RawVehicleDetailsResponse
  } catch (err) {
    return { ...empty, error: 'Vehicle details returned an invalid response', errorCode: 'API_ERROR' }
  }

  // Billing/response metadata is present even on not-found/refund responses.
  const billing = extractBilling(raw)

  // VDGL returns 200 with an unsuccessful response body for not-found / no-data.
  if (raw.responseInformation?.isSuccessStatusCode === false) {
    const code = raw.responseInformation.statusCode
    if (code === 404) {
      return { ...empty, ...billing, success: true, found: false, error: 'No vehicle found for that registration', errorCode: 'NOT_FOUND' }
    }
    return { ...empty, ...billing, error: raw.responseInformation.statusMessage || 'Vehicle details lookup was unsuccessful', errorCode: 'API_ERROR' }
  }

  if (!raw.results?.vehicleDetails) {
    return { ...empty, ...billing, success: true, found: false, error: 'No vehicle details held for that registration', errorCode: 'NOT_FOUND' }
  }

  return { ...mapVehicleDetails(reg, raw), ...billing }
}

/**
 * Look up DVLA vehicle details by registration. Resolves config + enforces the
 * enabled toggle. Always returns a result object (never throws); inspect
 * `success` / `found` / `errorCode`.
 */
export async function lookupVehicleDetailsByRegistration(registration: string): Promise<VehicleDetailsResult> {
  const reg = (registration || '').toUpperCase().replace(/\s/g, '')
  const empty = emptyResult(reg)

  if (!reg || reg.length < 2) {
    return { ...empty, error: 'A valid registration is required', errorCode: 'INVALID' }
  }

  const cfg = await getVehicleDetailsConfig()
  if (!cfg.configured || !cfg.apiKey) {
    return { ...empty, error: cfg.error || 'Vehicle details lookup is not configured', errorCode: 'NOT_CONFIGURED' }
  }
  if (!cfg.enabled) {
    return { ...empty, error: 'Vehicle details lookup is not enabled', errorCode: 'DISABLED' }
  }

  return performLookup(cfg, reg)
}

/**
 * Super-admin connection test. Requires a sample registration (the API has no
 * auth-only endpoint). Does NOT require the `enabled` toggle — you test before
 * enabling.
 */
export async function testVehicleDetailsConnection(sampleReg?: string): Promise<{ success: boolean; message: string }> {
  const cfg = await getVehicleDetailsConfig()
  if (!cfg.configured || !cfg.apiKey) {
    return { success: false, message: cfg.error || 'Vehicle details credentials are not configured' }
  }

  const reg = (sampleReg || '').toUpperCase().replace(/\s/g, '')
  if (!reg) {
    return { success: true, message: 'API key is set. Enter a sample registration to test a full lookup (sandbox keys require a VRM containing "A").' }
  }

  const result = await performLookup(cfg, reg)
  // Meter the test call too (platform-level, no org) so credit/cost stays accurate.
  if (result.success) await logVehicleDetailsUsage(null, null, reg, 'admin_test', result)
  if (result.errorCode === 'AUTH_FAILED') {
    return { success: false, message: result.error || 'API key rejected' }
  }
  if (!result.success && result.error) {
    return { success: false, message: result.error }
  }
  if (result.found) {
    const name = [result.make, result.model].filter(Boolean).join(' ') || reg
    return { success: true, message: `Success — found ${name}${result.derivative ? ` (${result.derivative})` : ''}.` }
  }
  return { success: true, message: `Credentials valid — no vehicle details held for ${reg}.` }
}

// ============================================
// Persistence
// ============================================

/** Derive the lifecycle status, honouring DVLA-fact precedence over the derived sold inference. */
function deriveLifecycleStatus(result: VehicleDetailsResult, sold: boolean): VehicleLifecycleStatus {
  if (result.certificateOfDestructionIssued) return 'destroyed'
  if (result.isScrapped) return 'scrapped'
  if (result.isExported) return 'exported'
  if (sold) return 'sold'
  return 'active'
}

/**
 * Persist a VehicleDetails result onto a vehicle: write the promoted columns +
 * full spec blob, and run "customer sold the vehicle" detection.
 *
 * On the first enrichment we capture a keeper baseline (start date + count). On
 * later refreshes we flag `lifecycle_status = 'sold'` when the keeper start date
 * advances past the baseline or the previous-keeper count increases. Hard DVLA
 * facts (scrapped/exported/destroyed) take precedence. Best-effort — logs and
 * continues on error.
 */
export async function persistVehicleDetails(
  organizationId: string,
  vehicleId: string,
  result: VehicleDetailsResult,
  opts: { overwriteIdentity?: boolean } = {}
): Promise<{ persisted: boolean; lifecycleStatus: VehicleLifecycleStatus | null }> {
  if (!result.found) return { persisted: false, lifecycleStatus: null }

  // Read the existing baseline to detect ownership change on refresh.
  const { data: existing } = await supabaseAdmin
    .from('vehicles')
    .select('keeper_baseline_start_date, keeper_baseline_count, lifecycle_status')
    .eq('id', vehicleId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  const hasBaseline = existing?.keeper_baseline_start_date != null || existing?.keeper_baseline_count != null
  let sold = false
  if (hasBaseline) {
    const baseStart = existing?.keeper_baseline_start_date as string | null
    const baseCount = existing?.keeper_baseline_count as number | null
    if (result.keeperStartDate && baseStart && result.keeperStartDate > baseStart) sold = true
    if (result.numberOfPreviousKeepers != null && baseCount != null && result.numberOfPreviousKeepers > baseCount) sold = true
  }

  const lifecycleStatus = deriveLifecycleStatus(result, sold)
  const now = new Date().toISOString()
  const prevStatus = (existing?.lifecycle_status as string | null) || 'active'

  const update: Record<string, unknown> = {
    derivative: result.derivative,
    body_type: result.bodyType,
    transmission: result.transmission,
    drive_type: result.driveType,
    power_bhp: result.powerBhp,
    co2_gkm: result.co2,
    euro_status: result.euroStatus,
    date_first_registered: result.dateFirstRegistered,
    powertrain_type: result.powertrainType,
    taxation_class: result.taxationClass,
    vehicle_class: result.vehicleClass,
    is_scrapped: result.isScrapped,
    is_exported: result.isExported,
    is_imported: result.isImported,
    certificate_of_destruction_issued: result.certificateOfDestructionIssued,
    keeper_start_date: result.keeperStartDate,
    number_of_previous_keepers: result.numberOfPreviousKeepers,
    previous_keeper_disposal_date: result.previousKeeperDisposalDate,
    latest_v5c_issue_date: result.latestV5cIssueDate,
    lifecycle_status: lifecycleStatus,
    vehicle_spec: result.raw,
    vehicle_data_synced_at: now,
    updated_at: now
  }

  // Capture the baseline on first enrichment (while the customer is the known owner).
  if (!hasBaseline) {
    update.keeper_baseline_start_date = result.keeperStartDate
    update.keeper_baseline_count = result.numberOfPreviousKeepers
  }

  // Stamp when the lifecycle status actually changes (sold/scrapped/etc.).
  if (lifecycleStatus !== prevStatus) {
    update.lifecycle_changed_at = now
  }

  // Identity overwrite: VehicleDetails (DVLA) wins on identity fields. Only write
  // non-null values so a sparse response never blanks existing data.
  if (opts.overwriteIdentity) {
    if (result.vin) update.vin = result.vin
    if (result.make) update.make = result.make
    if (result.model) update.model = result.model
    if (result.color) update.color = result.color
    if (result.fuelType) update.fuel_type = result.fuelType
    if (result.engineSize) update.engine_size = result.engineSize
    if (result.year) update.year = result.year
  }

  const { error } = await supabaseAdmin
    .from('vehicles')
    .update(update)
    .eq('id', vehicleId)
    .eq('organization_id', organizationId)

  if (error) {
    logger.error('Failed to persist vehicle details', { vehicleId }, new Error(error.message))
    return { persisted: false, lifecycleStatus: null }
  }

  return { persisted: true, lifecycleStatus }
}

// ============================================
// Usage metering + credit tracking
// ============================================

export type VehicleLookupContext = 'lookup' | 'create' | 'refresh' | 'admin_test'

/**
 * Record the remaining VDGL credit on the platform_settings 'vehicle_details' row
 * and, on the transition below the configured threshold, alert super admins once.
 * Best-effort.
 */
async function recordAccountBalance(balance: number): Promise<void> {
  try {
    const { data: row } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'vehicle_details')
      .maybeSingle()

    const s = (row?.settings as Record<string, unknown>) || {}
    const rawThr = s.low_credit_threshold
    const thr = Number.isFinite(Number(rawThr)) ? Number(rawThr) : DEFAULT_LOW_CREDIT_THRESHOLD
    const wasLow = s.credit_low_alerted === true
    const isLow = balance < thr

    await supabaseAdmin.from('platform_settings').upsert({
      id: 'vehicle_details',
      settings: { ...s, last_account_balance: balance, last_balance_at: new Date().toISOString(), credit_low_alerted: isLow },
      updated_at: new Date().toISOString()
    })

    // Fire once on the way down; the flag resets when a top-up lifts the balance.
    if (isLow && !wasLow) {
      await notifyVehicleCreditLow(balance, thr)
    }
  } catch (err) {
    logger.error('Failed to record vehicle-details account balance', {}, err as Error)
  }
}

/**
 * Log one VehicleDetails API call to vehicle_data_lookups for per-tenant usage +
 * billing. Call this ONLY where the API was actually hit (never on the create
 * reuse path, which doesn't re-bill). Best-effort — never throws.
 */
export async function logVehicleDetailsUsage(
  organizationId: string | null,
  userId: string | null,
  registration: string,
  context: VehicleLookupContext,
  result: VehicleDetailsResult
): Promise<void> {
  try {
    await supabaseAdmin.from('vehicle_data_lookups').insert({
      organization_id: organizationId,
      user_id: userId,
      registration: (registration || '').toUpperCase().replace(/\s/g, '') || null,
      context,
      success: result.success,
      found: result.found,
      billed: result.billed,
      cost: result.cost,
      billing_transaction_id: result.billingTransactionId,
      response_id: result.responseId
    })
    if (result.accountBalance != null) {
      await recordAccountBalance(result.accountBalance)
    }
  } catch (err) {
    logger.error('Failed to log vehicle details usage', { organizationId }, err as Error)
  }
}
