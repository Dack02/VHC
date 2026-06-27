/**
 * UK postcode → address lookup (provider-agnostic).
 *
 * Turns a postcode into a list of selectable, structured addresses for the
 * customer modal's "Find address" feature. The provider is pluggable; the
 * default implementation targets getAddress.io. Credentials resolve ENV-first
 * (managed in the platform secret store / Railway) then fall back to an
 * encrypted platform_settings row (id='postcode_lookup'), mirroring the DVSA
 * MOT lookup in services/mot-history.ts.
 *
 * The feature is INERT until a key is supplied: every entry point returns a
 * clean NOT_CONFIGURED so the UI silently falls back to manual address entry.
 *
 * See also: lib/encryption.ts, routes/postcode-lookup.ts.
 */

import { decrypt, isEncryptionConfigured } from '../lib/encryption.js'
import { logger } from '../lib/logger.js'
import { supabaseAdmin } from '../lib/supabase.js'

// ============================================
// Configuration
// ============================================

const DEFAULT_TIMEOUT = 12000 // 12s
const DEFAULT_PROVIDER = 'getaddress'

// ============================================
// Types
// ============================================

export type PostcodeProvider = 'getaddress' | 'ideal'

export interface PostcodeAddress {
  /** Single-line, human-readable address for display in the picker. */
  formatted: string
  line1: string
  line2: string
  town: string
  county: string
  postcode: string
}

export interface PostcodeLookupResult {
  success: boolean
  postcode: string
  addresses: PostcodeAddress[]
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

interface PostcodeConfig {
  configured: boolean
  enabled: boolean
  provider: PostcodeProvider
  apiKey: string | null
  source: 'env' | 'database' | 'none'
  error?: string
}

// ============================================
// Credential resolution
// ============================================

function normaliseProvider(value: string | null | undefined): PostcodeProvider {
  return value === 'ideal' ? 'ideal' : 'getaddress'
}

/** Read postcode-lookup config from environment variables, if a key is present. */
function readEnvConfig(): PostcodeConfig | null {
  const apiKey = process.env.POSTCODE_LOOKUP_API_KEY
  if (!apiKey) return null
  return {
    configured: true,
    enabled: process.env.POSTCODE_LOOKUP_ENABLED !== 'false',
    provider: normaliseProvider(process.env.POSTCODE_LOOKUP_PROVIDER) || DEFAULT_PROVIDER as PostcodeProvider,
    apiKey,
    source: 'env'
  }
}

/**
 * Resolve postcode-lookup config. Environment variables win over the encrypted
 * platform_settings row so the secret can live in Railway. Returns
 * `configured: false` (source 'none') when nothing is set up — callers should
 * surface NOT_CONFIGURED and fall back to manual entry.
 */
export async function getPostcodeConfig(): Promise<PostcodeConfig> {
  const envConfig = readEnvConfig()
  if (envConfig) return envConfig

  try {
    const { data: row, error } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'postcode_lookup')
      .maybeSingle()

    if (error || !row?.settings) {
      return { configured: false, enabled: false, provider: DEFAULT_PROVIDER as PostcodeProvider, apiKey: null, source: 'none', error: 'Postcode lookup is not configured' }
    }

    const s = row.settings as Record<string, unknown>
    const enabled = s.enabled === true
    const provider = normaliseProvider(s.provider as string)
    const apiKeyEnc = (s.api_key_encrypted as string) || ''

    if (!apiKeyEnc) {
      return { configured: false, enabled, provider, apiKey: null, source: 'none', error: 'Postcode lookup API key is not set' }
    }
    if (!isEncryptionConfigured()) {
      return { configured: false, enabled, provider, apiKey: null, source: 'none', error: 'Encryption is not configured on the server' }
    }

    let apiKey: string
    try {
      apiKey = decrypt(apiKeyEnc)
    } catch (decryptError) {
      logger.error('Failed to decrypt postcode-lookup key', {}, decryptError as Error)
      return { configured: false, enabled, provider, apiKey: null, source: 'none', error: 'Failed to decrypt postcode lookup key' }
    }

    return { configured: true, enabled, provider, apiKey, source: 'database' }
  } catch (err) {
    logger.error('Error fetching postcode-lookup config', {}, err as Error)
    return { configured: false, enabled: false, provider: DEFAULT_PROVIDER as PostcodeProvider, apiKey: null, source: 'none', error: 'Failed to fetch postcode lookup config' }
  }
}

/** Lightweight status for the UI (whether to show the "Find address" button). */
export async function getPostcodeLookupStatus(): Promise<{ configured: boolean; enabled: boolean; provider: PostcodeProvider }> {
  const cfg = await getPostcodeConfig()
  return { configured: cfg.configured, enabled: cfg.enabled, provider: cfg.provider }
}

// ============================================
// Provider implementations
// ============================================

// getAddress.io /find with expand=true returns structured address objects.
interface GetAddressExpanded {
  line_1?: string
  line_2?: string
  line_3?: string
  line_4?: string
  locality?: string
  town_or_city?: string
  county?: string
  formatted_address?: string[]
}

function buildFormatted(parts: Array<string | undefined>): string {
  return parts.map((p) => (p || '').trim()).filter(Boolean).join(', ')
}

async function lookupGetAddress(apiKey: string, postcode: string): Promise<PostcodeLookupResult> {
  const clean = postcode.toUpperCase().replace(/\s+/g, '')
  const url = `https://api.getaddress.io/find/${encodeURIComponent(clean)}?expand=true&api-key=${encodeURIComponent(apiKey)}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }

  const empty: PostcodeLookupResult = { success: false, postcode, addresses: [] }

  if (res.status === 404) {
    return { ...empty, success: true, error: 'No addresses found for that postcode', errorCode: 'NOT_FOUND' }
  }
  if (res.status === 429) {
    return { ...empty, error: 'Postcode lookup rate limit reached — please try again shortly', errorCode: 'RATE_LIMITED' }
  }
  if (res.status === 401 || res.status === 403) {
    return { ...empty, error: 'Postcode lookup authentication failed — check the API key', errorCode: 'AUTH_FAILED' }
  }
  if (res.status === 400) {
    return { ...empty, error: 'That does not look like a valid postcode', errorCode: 'INVALID' }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ...empty, error: `Postcode lookup failed (${res.status})${text ? ': ' + text.slice(0, 160) : ''}`, errorCode: 'API_ERROR' }
  }

  const data = (await res.json()) as { postcode?: string; addresses?: GetAddressExpanded[] }
  const formattedPostcode = data.postcode || postcode.toUpperCase()
  const addresses: PostcodeAddress[] = (data.addresses || []).map((a) => {
    const line1 = buildFormatted([a.line_1, a.line_2]) || (a.line_1 || '')
    const line2 = buildFormatted([a.line_3, a.line_4, a.locality])
    const town = a.town_or_city || ''
    const county = a.county || ''
    const formatted = buildFormatted([a.line_1, a.line_2, a.line_3, a.line_4, town, formattedPostcode])
    return { formatted, line1, line2, town, county, postcode: formattedPostcode }
  })

  return { success: true, postcode: formattedPostcode, addresses }
}

// ============================================
// Public API
// ============================================

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i

/**
 * Look up addresses for a UK postcode. Resolves config + enforces the enabled
 * toggle, then dispatches to the configured provider. Always returns a result
 * object (never throws); inspect `success` / `errorCode`.
 */
export async function lookupAddressesByPostcode(postcode: string): Promise<PostcodeLookupResult> {
  const trimmed = (postcode || '').trim()
  const empty: PostcodeLookupResult = { success: false, postcode: trimmed, addresses: [] }

  if (!trimmed) {
    return { ...empty, error: 'A postcode is required', errorCode: 'INVALID' }
  }
  if (!UK_POSTCODE_RE.test(trimmed)) {
    return { ...empty, error: 'That does not look like a valid UK postcode', errorCode: 'INVALID' }
  }

  const cfg = await getPostcodeConfig()
  if (!cfg.configured || !cfg.apiKey) {
    return { ...empty, error: cfg.error || 'Postcode lookup is not configured', errorCode: 'NOT_CONFIGURED' }
  }
  if (!cfg.enabled) {
    return { ...empty, error: 'Postcode lookup is not enabled', errorCode: 'DISABLED' }
  }

  try {
    switch (cfg.provider) {
      case 'getaddress':
        return await lookupGetAddress(cfg.apiKey, trimmed)
      // 'ideal' (and any future provider) can be added here; until then it is
      // treated as not configured rather than silently failing.
      default:
        return { ...empty, error: `Postcode provider "${cfg.provider}" is not implemented`, errorCode: 'NOT_CONFIGURED' }
    }
  } catch (err) {
    logger.error('Postcode lookup failed', { postcode: trimmed }, err as Error)
    return { ...empty, error: err instanceof Error ? err.message : 'Postcode lookup failed', errorCode: 'EXCEPTION' }
  }
}
