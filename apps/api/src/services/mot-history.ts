/**
 * DVSA MOT History API client.
 *
 * Looks up vehicle details + full MOT test history by registration using the
 * DVSA MOT History API (OAuth2 client-credentials + API key). Platform-wide
 * credentials live in platform_settings row id='vehicle_lookup' (client secret
 * and API key AES-256-GCM encrypted; client id and tenant id non-secret).
 *
 * Token handling: OAuth2 access tokens (~1h TTL) are cached in-process and
 * refreshed shortly before expiry. DVSA rate-limits token requests harder than
 * data requests, so we fetch ~one token per hour, not one per lookup.
 *
 * See also: lib/encryption.ts (encrypt/decrypt), routes/vehicle-lookup.ts
 * (org-facing GET), routes/admin/platform.ts (credential management + test).
 */

import { decrypt, isEncryptionConfigured } from '../lib/encryption.js'
import { logger } from '../lib/logger.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { recomputeVehicleExpiries } from './vehicle-expiry.js'

// ============================================
// Configuration
// ============================================

const MOT_API_BASE = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration'
const MOT_SCOPE = 'https://tapi.dvsa.gov.uk/.default'
const tokenUrl = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`

const DEFAULT_TIMEOUT = 15000          // 15s
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000  // refresh 5 min before expiry

// ============================================
// Types
// ============================================

export interface MotCredentials {
  clientId: string
  clientSecret: string
  apiKey: string
  tenantId: string
}

export interface MotDefect {
  text: string
  type: string            // ADVISORY | MINOR | MAJOR | DANGEROUS | FAIL | USER ENTERED | PRS
  dangerous: boolean
}

export interface MotTest {
  motTestNumber: string | null
  completedDate: string | null   // ISO
  testResult: string | null      // PASSED | FAILED
  expiryDate: string | null      // YYYY-MM-DD when present
  odometerValue: number | null
  odometerUnit: string | null    // mi | km
  odometerResult: string | null  // READ | UNREADABLE | NO_ODOMETER
  dataSource: string | null
  defects: MotDefect[]
}

export interface MotVehicleDetails {
  registration: string
  make: string | null
  model: string | null
  primaryColour: string | null
  fuelType: string | null
  engineSize: string | null
  firstUsedDate: string | null
  manufactureDate: string | null
  registrationDate: string | null
  hasOutstandingRecall: string | null
}

export interface MotLookupResult {
  success: boolean
  found: boolean
  registration: string
  vehicle?: MotVehicleDetails
  motTests: MotTest[]
  /** Rolled-up summary derived from the most recent test / DVSA fields. */
  motStatus: string | null        // Valid | Expired | No details held | Not yet due
  motExpiryDate: string | null    // latest expiry (YYYY-MM-DD)
  /** Present only when the vehicle has no MOT yet (new car). */
  motTestDueDate?: string | null
  error?: string
  errorCode?: 'NOT_CONFIGURED' | 'DISABLED' | 'NOT_FOUND' | 'RATE_LIMITED' | 'AUTH_FAILED' | 'API_ERROR' | 'EXCEPTION'
}

// Raw DVSA response shapes (only the fields we consume)
interface RawMotTest {
  completedDate?: string
  testResult?: string
  expiryDate?: string
  odometerValue?: string | number
  odometerUnit?: string
  odometerResultType?: string
  motTestNumber?: string
  dataSource?: string
  defects?: Array<{ text?: string; type?: string; dangerous?: boolean }>
}
interface RawMotVehicle {
  registration?: string
  make?: string
  model?: string
  firstUsedDate?: string
  fuelType?: string
  primaryColour?: string
  registrationDate?: string
  manufactureDate?: string
  engineSize?: string
  hasOutstandingRecall?: string
  motTests?: RawMotTest[]
  motTestDueDate?: string
}

// ============================================
// Credential resolution
// ============================================

/**
 * Read DVSA MOT History credentials from environment variables, if all four are
 * present. Env vars take precedence over the database row so the secrets can be
 * managed in the platform secret store (Railway) rather than the admin UI.
 */
export function readMotEnvCredentials(): MotCredentials | null {
  const clientId = process.env.DVSA_MOT_CLIENT_ID
  const tenantId = process.env.DVSA_MOT_TENANT_ID
  const clientSecret = process.env.DVSA_MOT_CLIENT_SECRET
  const apiKey = process.env.DVSA_MOT_API_KEY
  if (clientId && tenantId && clientSecret && apiKey) {
    return { clientId, tenantId, clientSecret, apiKey }
  }
  return null
}

/** True when the DVSA credentials are supplied via environment variables. */
export function isMotManagedByEnv(): boolean {
  return readMotEnvCredentials() !== null
}

/**
 * Resolve the platform DVSA MOT History credentials. Environment variables take
 * precedence over the encrypted database row, so secrets can live in the
 * platform secret store (Railway). For the env path, `enabled` is implied by
 * the vars being present (unless DVSA_MOT_ENABLED=false); for the DB path it is
 * the super-admin toggle. `configured` means all required fields are present.
 */
export async function getMotCredentials(): Promise<{
  configured: boolean
  enabled: boolean
  credentials: MotCredentials | null
  source: 'env' | 'database' | 'none'
  error?: string
}> {
  // 1. Environment variables win (managed in Railway).
  const envCreds = readMotEnvCredentials()
  if (envCreds) {
    return {
      configured: true,
      enabled: process.env.DVSA_MOT_ENABLED !== 'false',
      credentials: envCreds,
      source: 'env'
    }
  }

  // 2. Fall back to the encrypted database row (admin UI).
  try {
    const { data: row, error } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'vehicle_lookup')
      .maybeSingle()

    if (error || !row?.settings) {
      return { configured: false, enabled: false, credentials: null, source: 'none', error: 'Vehicle lookup is not configured' }
    }

    const s = row.settings as Record<string, unknown>
    const enabled = s.enabled === true
    const clientId = (s.mot_client_id as string) || ''
    const tenantId = (s.mot_tenant_id as string) || ''
    const secretEnc = (s.mot_client_secret_encrypted as string) || ''
    const apiKeyEnc = (s.mot_api_key_encrypted as string) || ''

    if (!clientId || !tenantId || !secretEnc || !apiKeyEnc) {
      return { configured: false, enabled, credentials: null, source: 'none', error: 'Vehicle lookup credentials are incomplete' }
    }

    if (!isEncryptionConfigured()) {
      return { configured: false, enabled, credentials: null, source: 'none', error: 'Encryption is not configured on the server' }
    }

    let clientSecret: string
    let apiKey: string
    try {
      clientSecret = decrypt(secretEnc)
      apiKey = decrypt(apiKeyEnc)
    } catch (decryptError) {
      logger.error('Failed to decrypt vehicle-lookup credentials', {}, decryptError as Error)
      return { configured: false, enabled, credentials: null, source: 'none', error: 'Failed to decrypt vehicle lookup credentials' }
    }

    return { configured: true, enabled, credentials: { clientId, clientSecret, apiKey, tenantId }, source: 'database' }
  } catch (err) {
    logger.error('Error fetching vehicle-lookup credentials', {}, err as Error)
    return { configured: false, enabled: false, credentials: null, source: 'none', error: 'Failed to fetch vehicle lookup credentials' }
  }
}

// ============================================
// OAuth2 token cache
// ============================================

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

function tokenCacheKey(creds: MotCredentials): string {
  return `${creds.tenantId}:${creds.clientId}`
}

/** Fetch (and cache) an OAuth2 access token via the client-credentials flow. */
async function getAccessToken(creds: MotCredentials): Promise<string> {
  const key = tokenCacheKey(creds)
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return cached.token
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: MOT_SCOPE
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
  let res: Response
  try {
    res = await fetch(tokenUrl(creds.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`MOT token request failed (${res.status})${text ? ': ' + text.slice(0, 200) : ''}`)
  }

  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) {
    throw new Error('MOT token response did not include an access_token')
  }

  const ttlMs = (data.expires_in ?? 3599) * 1000
  tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + ttlMs })
  return data.access_token
}

// ============================================
// Lookup
// ============================================

function normalise(reg: string, raw: RawMotVehicle): MotLookupResult {
  const motTests: MotTest[] = (raw.motTests || []).map((t) => ({
    motTestNumber: t.motTestNumber ?? null,
    completedDate: t.completedDate ?? null,
    testResult: t.testResult ?? null,
    expiryDate: t.expiryDate ?? null,
    odometerValue: t.odometerValue != null && t.odometerValue !== ''
      ? parseInt(String(t.odometerValue), 10)
      : null,
    odometerUnit: t.odometerUnit ?? null,
    odometerResult: t.odometerResultType ?? null,
    dataSource: t.dataSource ?? null,
    defects: (t.defects || []).map((d) => ({
      text: d.text ?? '',
      type: d.type ?? 'UNKNOWN',
      dangerous: d.dangerous === true
    }))
  }))

  // DVSA returns newest-first; sort defensively by completedDate desc.
  motTests.sort((a, b) => (b.completedDate || '').localeCompare(a.completedDate || ''))

  const latest = motTests[0]
  const motExpiryDate = latest?.expiryDate ?? null
  let motStatus: string | null
  if (!motTests.length) {
    motStatus = raw.motTestDueDate ? 'Not yet due' : 'No details held'
  } else if (motExpiryDate) {
    motStatus = new Date(motExpiryDate).getTime() < Date.now() ? 'Expired' : 'Valid'
  } else {
    motStatus = latest?.testResult === 'PASSED' ? 'Valid' : 'No details held'
  }

  const vehicle: MotVehicleDetails = {
    registration: raw.registration || reg,
    make: raw.make ?? null,
    model: raw.model ?? null,
    primaryColour: raw.primaryColour ?? null,
    fuelType: raw.fuelType ?? null,
    engineSize: raw.engineSize ?? null,
    firstUsedDate: raw.firstUsedDate ?? null,
    manufactureDate: raw.manufactureDate ?? null,
    registrationDate: raw.registrationDate ?? null,
    hasOutstandingRecall: raw.hasOutstandingRecall ?? null
  }

  return {
    success: true,
    found: true,
    registration: vehicle.registration,
    vehicle,
    motTests,
    motStatus,
    motExpiryDate,
    motTestDueDate: raw.motTestDueDate ?? null
  }
}

/** Core HTTP lookup. Assumes credentials are resolved; no enabled-gate. */
async function performLookup(creds: MotCredentials, reg: string): Promise<MotLookupResult> {
  const empty: MotLookupResult = {
    success: false, found: false, registration: reg, motTests: [], motStatus: null, motExpiryDate: null
  }

  try {
    const token = await getAccessToken(creds)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
    let res: Response
    try {
      res = await fetch(`${MOT_API_BASE}/${encodeURIComponent(reg)}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-API-Key': creds.apiKey,
          'Accept': 'application/json'
        },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (res.status === 404) {
      return { ...empty, success: true, found: false, error: 'No vehicle found for that registration', errorCode: 'NOT_FOUND' }
    }
    if (res.status === 429) {
      return { ...empty, error: 'DVSA rate limit reached — please try again shortly', errorCode: 'RATE_LIMITED' }
    }
    if (res.status === 401 || res.status === 403) {
      // Token may be stale or the API key rejected; clear cache so we re-auth next time.
      tokenCache.delete(tokenCacheKey(creds))
      return { ...empty, error: 'DVSA authentication failed — check the platform credentials', errorCode: 'AUTH_FAILED' }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ...empty, error: `DVSA lookup failed (${res.status})${text ? ': ' + text.slice(0, 160) : ''}`, errorCode: 'API_ERROR' }
    }

    const raw = await res.json() as RawMotVehicle
    return normalise(reg, raw)
  } catch (err) {
    logger.error('MOT lookup failed', { registration: reg }, err as Error)
    return { ...empty, error: err instanceof Error ? err.message : 'Vehicle lookup failed', errorCode: 'EXCEPTION' }
  }
}

/**
 * Look up a vehicle + MOT history by registration. Resolves platform
 * credentials and enforces the super-admin `enabled` toggle. Used by the
 * org-facing route and the create-vehicle MOT sync.
 */
export async function lookupVehicleByRegistration(registration: string): Promise<MotLookupResult> {
  const reg = (registration || '').toUpperCase().replace(/\s/g, '')
  const empty: MotLookupResult = {
    success: false, found: false, registration: reg, motTests: [], motStatus: null, motExpiryDate: null
  }

  if (!reg) {
    return { ...empty, error: 'A registration is required', errorCode: 'API_ERROR' }
  }

  const credResult = await getMotCredentials()
  if (!credResult.configured || !credResult.credentials) {
    return { ...empty, error: credResult.error || 'Vehicle lookup is not configured', errorCode: 'NOT_CONFIGURED' }
  }
  if (!credResult.enabled) {
    return { ...empty, error: 'Vehicle lookup is not enabled', errorCode: 'DISABLED' }
  }

  return performLookup(credResult.credentials, reg)
}

/**
 * Super-admin connection test. Validates the token (client id/secret/tenant)
 * and, when a sample registration is supplied, a full data call (API key).
 * Does NOT require the `enabled` toggle — you test before enabling.
 */
export async function testMotConnection(sampleReg?: string): Promise<{ success: boolean; message: string }> {
  const credResult = await getMotCredentials()
  if (!credResult.configured || !credResult.credentials) {
    return { success: false, message: credResult.error || 'Vehicle lookup credentials are not configured' }
  }

  try {
    await getAccessToken(credResult.credentials)
  } catch (err) {
    return { success: false, message: `Authentication failed: ${err instanceof Error ? err.message : 'token request failed'}` }
  }

  const reg = (sampleReg || '').toUpperCase().replace(/\s/g, '')
  if (!reg) {
    return { success: true, message: 'Authentication successful — token issued. Enter a sample registration to test a full vehicle lookup.' }
  }

  const result = await performLookup(credResult.credentials, reg)
  if (result.errorCode === 'AUTH_FAILED') {
    return { success: false, message: result.error || 'API key rejected by DVSA' }
  }
  if (!result.success && result.error) {
    return { success: false, message: result.error }
  }
  if (result.found && result.vehicle) {
    const name = [result.vehicle.make, result.vehicle.model].filter(Boolean).join(' ') || reg
    const n = result.motTests.length
    return { success: true, message: `Success — found ${name} with ${n} MOT test${n === 1 ? '' : 's'}.` }
  }
  return { success: true, message: `Credentials valid — DVSA accepted the request but holds no record for ${reg}.` }
}

// ============================================
// Persistence
// ============================================

/**
 * Persist a lookup result to a vehicle: upsert the MOT test history (idempotent
 * on vehicle_id + mot_test_number) and roll summary fields onto the vehicle.
 * Best-effort — logs and continues on error.
 */
export async function persistMotHistory(
  organizationId: string,
  vehicleId: string,
  result: MotLookupResult
): Promise<{ persisted: number }> {
  const summary = {
    mot_status: result.motStatus,
    mot_expiry_date: result.motExpiryDate,
    first_used_date: result.vehicle?.firstUsedDate ?? null,
    mot_last_synced_at: new Date().toISOString()
  }

  if (result.found && result.motTests.length) {
    const rows = result.motTests.map((t) => ({
      organization_id: organizationId,
      vehicle_id: vehicleId,
      mot_test_number: t.motTestNumber,
      completed_date: t.completedDate,
      test_result: t.testResult,
      expiry_date: t.expiryDate,
      odometer_value: t.odometerValue,
      odometer_unit: t.odometerUnit,
      odometer_result: t.odometerResult,
      data_source: t.dataSource,
      defects: t.defects,
      updated_at: new Date().toISOString()
    }))

    const { error } = await supabaseAdmin
      .from('vehicle_mot_tests')
      .upsert(rows, { onConflict: 'vehicle_id,mot_test_number' })

    if (error) {
      logger.error('Failed to persist MOT history', { vehicleId }, new Error(error.message))
    }
  }

  await supabaseAdmin
    .from('vehicles')
    .update(summary)
    .eq('id', vehicleId)
    .eq('organization_id', organizationId)

  // Project the MOT expiry into the typed expiry surface (powers campaigns).
  await recomputeVehicleExpiries(organizationId, vehicleId)

  return { persisted: result.found ? result.motTests.length : 0 }
}
