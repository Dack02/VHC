/**
 * Ollo Dev integration client.
 *
 * Pushes in-app feedback tickets (and end-user replies) into Ollo Dev — the
 * shared dev/issue tracker — and exposes the shared webhook secret used by the
 * inbound receiver (routes/webhooks/ollo-dev.ts) to verify status/comment
 * callbacks. Credentials resolve ENV-first (OLLO_DEV_*) then the encrypted
 * platform_settings row id='ollo_dev', mirroring services/mot-history.ts.
 *
 * Never logs the API key. All network calls are time-boxed.
 */

import { decrypt, isEncryptionConfigured } from '../lib/encryption.js'
import { logger } from '../lib/logger.js'
import { supabaseAdmin } from '../lib/supabase.js'

const DEFAULT_TIMEOUT = 15000 // 15s
const INGEST_PATH = '/api/v1/integrations/tickets'

// Identifies this product to Ollo Dev (the API key may also be bound to it).
const SOURCE_APP = process.env.OLLO_DEV_SOURCE_APP || 'ollo-inspect'

export interface OlloDevCredentials {
  apiUrl: string        // base origin, e.g. https://ollo-dev-api.example.com
  apiKey: string
  webhookSecret: string // shared HMAC secret for inbound callbacks ('' if unset)
  projectId: string
  sourceApp: string
}

export interface OlloDevTicketInput {
  externalRef: string                                    // local feedback_tickets.id
  type: 'bug' | 'feature' | 'question'
  subject: string
  description: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  reporter: { email?: string; name?: string; role?: string; org?: string }
  attachments: Array<{ url: string; name: string; type: string; size: number }>
  diagnostics: Record<string, unknown>
}

export interface OlloDevCommentInput {
  externalRef: string   // local feedback_comments.id (dedup + echo guard)
  body: string
  author: { name?: string; email?: string }
}

// ============================================
// Credential resolution (ENV-first, then DB)
// ============================================

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Read Ollo Dev credentials from env vars (api_url + api_key required). */
export function readOlloDevEnv(): OlloDevCredentials | null {
  const apiUrl = process.env.OLLO_DEV_API_URL
  const apiKey = process.env.OLLO_DEV_API_KEY
  if (apiUrl && apiKey) {
    return {
      apiUrl: stripTrailingSlash(apiUrl),
      apiKey,
      webhookSecret: process.env.OLLO_DEV_WEBHOOK_SECRET || '',
      projectId: process.env.OLLO_DEV_PROJECT_ID || '',
      sourceApp: SOURCE_APP,
    }
  }
  return null
}

/**
 * Resolve Ollo Dev credentials. Env vars take precedence over the encrypted
 * platform_settings row so secrets can live in the Railway secret store (and
 * the known ENCRYPTION_KEY dev gotcha is sidestepped). `configured` means the
 * api_url + api_key are present; `enabled` is the super-admin/env toggle.
 */
export async function getOlloDevCredentials(): Promise<{
  configured: boolean
  enabled: boolean
  credentials: OlloDevCredentials | null
  source: 'env' | 'database' | 'none'
  error?: string
}> {
  const env = readOlloDevEnv()
  if (env) {
    return {
      configured: true,
      enabled: process.env.OLLO_DEV_ENABLED !== 'false',
      credentials: env,
      source: 'env',
    }
  }

  try {
    const { data: row, error } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'ollo_dev')
      .maybeSingle()

    if (error || !row?.settings) {
      return { configured: false, enabled: false, credentials: null, source: 'none', error: 'Ollo Dev integration is not configured' }
    }

    const s = row.settings as Record<string, unknown>
    const enabled = s.enabled === true
    const apiUrl = stripTrailingSlash((s.api_url as string) || '')
    const projectId = (s.project_id as string) || ''
    const apiKeyEnc = (s.api_key_encrypted as string) || ''
    const webhookEnc = (s.webhook_secret_encrypted as string) || ''

    if (!apiUrl || !apiKeyEnc) {
      return { configured: false, enabled, credentials: null, source: 'none', error: 'Ollo Dev credentials are incomplete' }
    }
    if (!isEncryptionConfigured()) {
      return { configured: false, enabled, credentials: null, source: 'none', error: 'Encryption is not configured on the server' }
    }

    let apiKey: string
    let webhookSecret: string
    try {
      apiKey = decrypt(apiKeyEnc)
      webhookSecret = webhookEnc ? decrypt(webhookEnc) : ''
    } catch (decryptError) {
      logger.error('Failed to decrypt Ollo Dev credentials', {}, decryptError as Error)
      return { configured: false, enabled, credentials: null, source: 'none', error: 'Failed to decrypt Ollo Dev credentials' }
    }

    return { configured: true, enabled, credentials: { apiUrl, apiKey, webhookSecret, projectId, sourceApp: SOURCE_APP }, source: 'database' }
  } catch (err) {
    logger.error('Error fetching Ollo Dev credentials', {}, err as Error)
    return { configured: false, enabled: false, credentials: null, source: 'none', error: 'Failed to fetch Ollo Dev credentials' }
  }
}

/** The shared HMAC secret used to verify inbound Ollo Dev webhooks. */
export async function getOlloDevWebhookSecret(): Promise<string | null> {
  const result = await getOlloDevCredentials()
  return result.credentials?.webhookSecret || null
}

// ============================================
// API calls
// ============================================

async function postJson(
  creds: OlloDevCredentials,
  path: string,
  payload: unknown
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
  try {
    const res = await fetch(`${creds.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${creds.apiKey}`,
        'X-Ollo-Source-App': creds.sourceApp,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    let json: unknown = null
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, json: null, error: `Ollo Dev responded ${res.status}${text ? ': ' + text.slice(0, 200) : ''}` }
    }
    json = await res.json().catch(() => null)
    return { ok: true, status: res.status, json }
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Create (or idempotently match) a ticket in Ollo Dev. Returns its ticket id. */
export async function createOlloDevTicket(
  input: OlloDevTicketInput
): Promise<{ success: boolean; olloDevTicketId?: string; error?: string }> {
  const cr = await getOlloDevCredentials()
  if (!cr.configured || !cr.credentials) {
    return { success: false, error: cr.error || 'Ollo Dev integration is not configured' }
  }
  if (!cr.enabled) {
    return { success: false, error: 'Ollo Dev integration is not enabled' }
  }

  try {
    const result = await postJson(cr.credentials, INGEST_PATH, {
      external_ref: input.externalRef,
      type: input.type,
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      reporter: input.reporter,
      attachments: input.attachments,
      diagnostics: input.diagnostics,
    })
    if (!result.ok) return { success: false, error: result.error }

    const data = (result.json as { data?: { id?: string } } | null)?.data
    if (!data?.id) return { success: false, error: 'Ollo Dev did not return a ticket id' }
    return { success: true, olloDevTicketId: data.id }
  } catch (err) {
    logger.error('Ollo Dev createTicket failed', { externalRef: input.externalRef }, err as Error)
    return { success: false, error: err instanceof Error ? err.message : 'Ollo Dev request failed' }
  }
}

/** Append an end-user reply to an Ollo Dev ticket. */
export async function appendOlloDevComment(
  olloDevTicketId: string,
  input: OlloDevCommentInput
): Promise<{ success: boolean; error?: string }> {
  const cr = await getOlloDevCredentials()
  if (!cr.configured || !cr.credentials) {
    return { success: false, error: cr.error || 'Ollo Dev integration is not configured' }
  }
  if (!cr.enabled) {
    return { success: false, error: 'Ollo Dev integration is not enabled' }
  }

  try {
    const result = await postJson(cr.credentials, `${INGEST_PATH}/${encodeURIComponent(olloDevTicketId)}/comments`, {
      external_ref: input.externalRef,
      body: input.body,
      author: input.author,
    })
    if (!result.ok) return { success: false, error: result.error }
    return { success: true }
  } catch (err) {
    logger.error('Ollo Dev appendComment failed', { olloDevTicketId }, err as Error)
    return { success: false, error: err instanceof Error ? err.message : 'Ollo Dev request failed' }
  }
}
