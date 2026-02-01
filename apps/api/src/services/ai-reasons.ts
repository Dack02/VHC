/**
 * AI Reasons Generation Service
 *
 * Generates predefined reason lists for inspection items using Claude AI.
 * Supports both item-specific and reason-type-based generation.
 * Integrates with platform AI settings for API key management and usage tracking.
 */

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { decrypt } from '../lib/encryption.js'
import { checkAlertsAfterGeneration } from './ai-alerts.js'

// Types
export interface TemplateItemInfo {
  id: string
  name: string
  description?: string
  section_name?: string
  reason_type?: string
}

export interface GeneratedReason {
  reason_text: string
  technical_description: string
  customer_description: string
  default_rag: 'red' | 'amber' | 'green'
  category: 'safety' | 'wear' | 'maintenance' | 'advisory' | 'positive'
  suggested_follow_up_days: number | null
  suggested_follow_up_text: string | null
}

export type Tone = 'premium' | 'friendly'

interface AIGenerationResult<T> {
  result: T
  inputTokens: number
  outputTokens: number
}

interface GenerationContext {
  templateId?: string
  templateItemId?: string
  reasonType?: string
  itemReasonId?: string
}

// Cached Anthropic client (will be initialized with dynamic API key)
let anthropicClient: Anthropic | null = null
let cachedApiKey: string | null = null

// Platform settings cache (5 minute TTL)
interface CachedSetting {
  value: string
  expiresAt: number
}
const settingsCache: Map<string, CachedSetting> = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Rate limiting helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Retry configuration
const MAX_RETRIES = 2
const INITIAL_RETRY_DELAY_MS = 1000

// =============================================================================
// API KEY & MODEL MANAGEMENT
// =============================================================================

/**
 * Get a cached platform setting
 */
function getCachedSetting(key: string): string | null {
  const cached = settingsCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  settingsCache.delete(key)
  return null
}

/**
 * Set a cached platform setting
 */
function setCachedSetting(key: string, value: string): void {
  settingsCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  })
}

/**
 * Clear the settings cache (call when settings are updated)
 */
export function clearSettingsCache(): void {
  settingsCache.clear()
  anthropicClient = null
  cachedApiKey = null
}

/**
 * Get the Anthropic API key from database or environment
 * Uses AES-256-GCM encryption for secure storage
 * Includes caching with 5 minute TTL
 */
export async function getApiKey(): Promise<string> {
  // Check cache first
  const cachedKey = getCachedSetting('anthropic_api_key')
  if (cachedKey) {
    return cachedKey
  }

  try {
    // Try to get from database first
    const { data, error } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value, is_encrypted')
      .eq('key', 'anthropic_api_key')
      .single()

    if (!error && data?.value) {
      let apiKey = data.value

      // Decrypt using AES-256-GCM
      if (data.is_encrypted) {
        try {
          apiKey = decrypt(data.value)
        } catch (decryptError) {
          logger.error('Failed to decrypt API key', { error: decryptError })
          throw new Error('Failed to decrypt API key. Please reconfigure in Super Admin settings.')
        }
      }

      // Cache the decrypted key
      setCachedSetting('anthropic_api_key', apiKey)
      return apiKey
    }
  } catch (err) {
    // Only log as debug if it's a "not found" type error
    if (err instanceof Error && !err.message.includes('decrypt')) {
      logger.debug('Could not fetch API key from database', { error: err })
    } else {
      throw err
    }
  }

  // Fallback to environment variable
  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey) {
    setCachedSetting('anthropic_api_key', envKey)
    return envKey
  }

  throw new Error('AI API key not configured. Please configure in Super Admin settings or set ANTHROPIC_API_KEY environment variable.')
}

/**
 * Get the AI model to use from database settings
 * Includes caching with 5 minute TTL
 */
export async function getModel(): Promise<string> {
  // Check cache first
  const cachedModel = getCachedSetting('ai_model')
  if (cachedModel) {
    return cachedModel
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value')
      .eq('key', 'ai_model')
      .single()

    if (!error && data?.value) {
      setCachedSetting('ai_model', data.value)
      return data.value
    }
  } catch (err) {
    logger.debug('Could not fetch AI model from database', { error: err })
  }

  // Default model
  const defaultModel = 'claude-sonnet-4-20250514'
  setCachedSetting('ai_model', defaultModel)
  return defaultModel
}

/**
 * Get or create Anthropic client with current API key
 */
async function getAnthropicClient(): Promise<Anthropic> {
  const apiKey = await getApiKey()

  // Reuse client if API key hasn't changed
  if (anthropicClient && cachedApiKey === apiKey) {
    return anthropicClient
  }

  // Create new client
  anthropicClient = new Anthropic({ apiKey })
  cachedApiKey = apiKey

  return anthropicClient
}

// =============================================================================
// USAGE LIMITS & TRACKING
// =============================================================================

/**
 * Check if an organization is allowed to generate AI content
 * Throws error with user-friendly message if not allowed
 */
export async function checkGenerationAllowed(organizationId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('can_org_generate_ai', {
    p_organization_id: organizationId
  })

  if (error) {
    logger.error('Failed to check AI generation limits', { error: error.message, organizationId })
    throw new Error('Failed to verify AI generation limits. Please try again.')
  }

  const result = data?.[0]
  if (!result) {
    throw new Error('Failed to verify AI generation limits. Please try again.')
  }

  if (!result.allowed) {
    const reason = result.reason || 'AI generation is not available'

    // Add context about usage if available
    if (result.current_usage !== undefined && result.limit_value) {
      throw new Error(`${reason}. You've used ${result.current_usage} of ${result.limit_value} generations this month (${result.percentage_used}%).`)
    }

    throw new Error(reason)
  }
}

/**
 * Record AI usage in the database
 */
async function recordUsage(
  organizationId: string,
  userId: string | undefined,
  action: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  options: {
    itemsGenerated?: number
    templateId?: string
    templateItemId?: string
    reasonType?: string
    durationMs?: number
    success?: boolean
    errorMessage?: string
    promptSummary?: string
  } = {}
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('record_ai_usage', {
      p_organization_id: organizationId,
      p_user_id: userId || null,
      p_action: action,
      p_model: model,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_items_generated: options.itemsGenerated ?? 1,
      p_template_id: options.templateId || null,
      p_template_item_id: options.templateItemId || null,
      p_reason_type: options.reasonType || null,
      p_duration_ms: options.durationMs || null,
      p_success: options.success ?? true,
      p_error_message: options.errorMessage || null,
      p_prompt_summary: options.promptSummary || null
    })

    if (error) {
      logger.error('Failed to record AI usage', { error: error.message })
      return null
    }

    return data
  } catch (err) {
    logger.error('Error recording AI usage', { error: err })
    return null
  }
}

/**
 * Parse Anthropic API errors into user-friendly messages
 */
function getFriendlyErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'An unexpected error occurred. Please try again.'
  }

  const message = err.message.toLowerCase()

  // API key issues
  if (message.includes('invalid api key') || message.includes('authentication')) {
    return 'Invalid API key. Please check the AI configuration in Super Admin settings.'
  }

  // Rate limiting
  if (message.includes('rate limit') || message.includes('429')) {
    return 'AI service is temporarily busy. Please wait a moment and try again.'
  }

  // Network errors
  if (message.includes('network') || message.includes('econnrefused') || message.includes('timeout')) {
    return 'Unable to connect to AI service. Please check your internet connection and try again.'
  }

  // Credit/billing issues
  if (message.includes('credit') || message.includes('billing') || message.includes('insufficient')) {
    return 'AI service billing issue. Please contact your administrator.'
  }

  // Model issues
  if (message.includes('model') && (message.includes('not found') || message.includes('invalid'))) {
    return 'AI model not available. Please check the AI configuration in Super Admin settings.'
  }

  // Default
  return `AI generation failed: ${err.message}`
}

/**
 * Check if an error is retryable (transient)
 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false

  const message = err.message.toLowerCase()

  // Retryable: rate limits, network issues, server errors
  return (
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('timeout') ||
    message.includes('overloaded')
  )
}

/**
 * Wrapper function that handles limit checking, execution, and usage tracking
 * Includes retry logic with exponential backoff for transient failures
 */
export async function generateWithTracking<T>(
  organizationId: string,
  userId: string | undefined,
  action: string,
  context: GenerationContext,
  generateFn: () => Promise<AIGenerationResult<T>>
): Promise<T> {
  // Check limits before generating
  await checkGenerationAllowed(organizationId)

  const startTime = Date.now()
  let success = true
  let errorMessage: string | undefined
  let inputTokens = 0
  let outputTokens = 0
  let result: T
  let lastError: Error | null = null

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s...
        const backoffMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
        logger.info(`Retrying AI generation (attempt ${attempt + 1}/${MAX_RETRIES + 1})`, {
          organizationId,
          action,
          backoffMs
        })
        await delay(backoffMs)
      }

      const genResult = await generateFn()
      result = genResult.result
      inputTokens = genResult.inputTokens
      outputTokens = genResult.outputTokens
      lastError = null
      break // Success, exit retry loop
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Only retry on transient errors and if we have retries left
      if (!isRetryableError(err) || attempt >= MAX_RETRIES) {
        success = false
        errorMessage = getFriendlyErrorMessage(err)

        // Log the original error for debugging
        logger.error('AI generation failed', {
          organizationId,
          action,
          attempt: attempt + 1,
          error: lastError.message
        })
        break
      }
    }
  }

  // Record usage (even on failure, to track errors)
  const durationMs = Date.now() - startTime
  await recordUsage(organizationId, userId, action, await getModel(), inputTokens, outputTokens, {
    templateId: context.templateId,
    templateItemId: context.templateItemId,
    reasonType: context.reasonType,
    durationMs,
    success,
    errorMessage: lastError?.message,
    promptSummary: `${action} for ${context.templateItemId || context.reasonType || 'unknown'}`
  })

  // If we failed after all retries, throw the friendly error
  if (lastError) {
    throw new Error(errorMessage || getFriendlyErrorMessage(lastError))
  }

  // Check alerts after successful generation (async, don't block)
  checkAlertsAfterGeneration(organizationId).catch(err => {
    logger.error('Failed to check alerts after generation', { error: err })
  })

  return result!
}

// =============================================================================
// PROMPT GENERATION
// =============================================================================

/**
 * Generate the prompt for reason generation
 */
function generateReasonsPrompt(
  itemName: string,
  sectionName: string,
  reasonType: string | null,
  tone: Tone
): string {
  const toneDescription = tone === 'premium'
    ? 'PREMIUM - Use formal, technical language suitable for a main dealer or prestige service centre. Professional and precise.'
    : 'FRIENDLY - Use warm, reassuring language suitable for an independent family garage. Clear and approachable.'

  const customerTone = tone === 'premium'
    ? 'professional but clear'
    : 'warm and reassuring'

  return `You are an expert UK MOT tester and vehicle technician. Generate a list of common reasons/findings for the following vehicle inspection item.

INSPECTION ITEM: ${itemName}
SECTION: ${sectionName}
ITEM TYPE: ${reasonType || 'unique'}

TONE SETTING: ${toneDescription}

Generate reasons for ALL three RAG statuses:
- RED reasons: Immediate safety concerns, failures, must-fix items
- AMBER reasons: Wear items, advisory items, should address soon
- GREEN reasons: Positive findings, checked and OK, reassuring confirmations

For each reason, provide:
1. reason_text: What the technician selects (concise, max 50 chars)
2. technical_description: For the service advisor (2-3 sentences, technical detail)
3. customer_description: For the customer (2-3 sentences, ${customerTone}, explain WHY it matters)
4. default_rag: 'red', 'amber', or 'green'
5. category: 'safety', 'wear', 'maintenance', 'advisory', or 'positive'

IMPORTANT:
- Use UK English spelling (tyre, colour, centre, honour)
- Customer descriptions should be ${customerTone}
- Explain safety implications where relevant
- Include common wear-related reasons and failure modes
- Include at least 2-3 GREEN/positive reasons (e.g., "Good condition", "Within specification")

Return ONLY a valid JSON array with no additional text:
[
  {
    "reason_text": "...",
    "technical_description": "...",
    "customer_description": "...",
    "default_rag": "red|amber|green",
    "category": "safety|wear|maintenance|advisory|positive"
  }
]

Generate 8-12 relevant reasons covering red, amber, AND green findings.`
}

/**
 * Generate prompt for regenerating descriptions of an existing reason
 */
function regenerateDescriptionsPrompt(
  reasonText: string,
  itemName: string,
  defaultRag: string,
  category: string,
  tone: Tone
): string {
  const toneDescription = tone === 'premium'
    ? 'PREMIUM - Use formal, technical language suitable for a main dealer or prestige service centre.'
    : 'FRIENDLY - Use warm, reassuring language suitable for an independent family garage.'

  return `You are an expert UK MOT tester. Generate technical and customer descriptions for this inspection finding.

REASON: ${reasonText}
INSPECTION ITEM: ${itemName}
STATUS: ${defaultRag.toUpperCase()}
CATEGORY: ${category}

TONE: ${toneDescription}

Provide:
1. technical_description: For the service advisor (2-3 sentences, technical detail)
2. customer_description: For the customer (2-3 sentences, explain WHY it matters, be ${tone === 'premium' ? 'professional' : 'friendly'})

IMPORTANT:
- Use UK English spelling
- Be concise but informative
- Explain safety implications if relevant

Return ONLY valid JSON:
{
  "technical_description": "...",
  "customer_description": "..."
}`
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

/**
 * Parse and validate AI response
 */
function parseAndValidateReasons(responseText: string): GeneratedReason[] {
  // Extract JSON array from response
  const jsonMatch = responseText.match(/\[[\s\S]*\]/)

  if (!jsonMatch) {
    throw new Error('Failed to parse AI response: No JSON array found')
  }

  let reasons: unknown[]
  try {
    reasons = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('Failed to parse AI response: Invalid JSON')
  }

  if (!Array.isArray(reasons) || reasons.length === 0) {
    throw new Error('Failed to parse AI response: Empty or invalid array')
  }

  // Validate and sanitize each reason
  const validRags = ['red', 'amber', 'green']
  const validCategories = ['safety', 'wear', 'maintenance', 'advisory', 'positive']

  return reasons.map((r: unknown, index: number) => {
    const reason = r as Record<string, unknown>

    if (!reason.reason_text || typeof reason.reason_text !== 'string') {
      throw new Error(`Invalid reason at index ${index}: missing reason_text`)
    }

    const defaultRag = String(reason.default_rag || 'amber').toLowerCase()
    const category = String(reason.category || 'advisory').toLowerCase()

    return {
      reason_text: String(reason.reason_text).slice(0, 255),
      technical_description: String(reason.technical_description || ''),
      customer_description: String(reason.customer_description || ''),
      default_rag: validRags.includes(defaultRag) ? defaultRag as GeneratedReason['default_rag'] : 'amber',
      category: validCategories.includes(category) ? category as GeneratedReason['category'] : 'advisory',
      // Always set follow-up fields to null - techs can manually set if needed
      suggested_follow_up_days: null,
      suggested_follow_up_text: null
    }
  })
}

// =============================================================================
// CLAUDE API CALLS
// =============================================================================

/**
 * Call Claude API to generate reasons (returns result with token usage)
 */
async function callClaudeAPIWithUsage(prompt: string): Promise<AIGenerationResult<string>> {
  const client = await getAnthropicClient()
  const model = await getModel()

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  })

  const content = response.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude API')
  }

  return {
    result: content.text,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0
  }
}

/**
 * Get organization's tone setting
 */
async function getOrganizationTone(organizationId: string): Promise<Tone> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('reason_tone')
    .eq('organization_id', organizationId)
    .single()

  return (data?.reason_tone === 'premium' ? 'premium' : 'friendly') as Tone
}

// =============================================================================
// GENERATION FUNCTIONS WITH TRACKING
// =============================================================================

/**
 * Generate reasons for a specific template item
 */
export async function generateReasonsForItem(
  templateItem: TemplateItemInfo,
  tone: Tone,
  organizationId: string,
  userId?: string
): Promise<GeneratedReason[]> {
  logger.info('Generating reasons for item', {
    itemId: templateItem.id,
    itemName: templateItem.name,
    tone,
    organizationId
  })

  const prompt = generateReasonsPrompt(
    templateItem.name,
    templateItem.section_name || 'General',
    templateItem.reason_type || null,
    tone
  )

  const reasons = await generateWithTracking(
    organizationId,
    userId,
    'generate_reasons',
    { templateItemId: templateItem.id },
    async () => {
      const { result, inputTokens, outputTokens } = await callClaudeAPIWithUsage(prompt)
      const parsedReasons = parseAndValidateReasons(result)
      return { result: parsedReasons, inputTokens, outputTokens }
    }
  )

  logger.info('Generated reasons for item', {
    itemId: templateItem.id,
    count: reasons.length
  })

  return reasons
}

/**
 * Generate reasons for a reason type (applies to all items of that type)
 */
export async function generateReasonsForReasonType(
  reasonType: string,
  tone: Tone,
  organizationId: string,
  userId?: string
): Promise<GeneratedReason[]> {
  // Create a friendly name from the reason type
  const typeNameMap: Record<string, string> = {
    'tyre': 'Tyres',
    'brake_assembly': 'Brake Assembly (Front/Rear Brakes)',
    'brake_disc': 'Brake Discs',
    'brake_pad': 'Brake Pads',
    'wiper': 'Wipers',
    'shock_absorber': 'Shock Absorbers',
    'fluid_level': 'Fluid Levels (Oil, Coolant, etc.)',
    'light_cluster': 'Lights (Headlights, Indicators, etc.)',
    'exhaust': 'Exhaust System',
    'suspension': 'Suspension Components',
    'steering': 'Steering Components',
    'wheel': 'Wheels'
  }

  const friendlyName = typeNameMap[reasonType] || reasonType.replace(/_/g, ' ')

  logger.info('Generating reasons for reason type', { reasonType, tone, organizationId })

  const prompt = generateReasonsPrompt(
    friendlyName,
    'Various',
    reasonType,
    tone
  )

  const reasons = await generateWithTracking(
    organizationId,
    userId,
    'generate_reasons',
    { reasonType },
    async () => {
      const { result, inputTokens, outputTokens } = await callClaudeAPIWithUsage(prompt)
      const parsedReasons = parseAndValidateReasons(result)
      return { result: parsedReasons, inputTokens, outputTokens }
    }
  )

  logger.info('Generated reasons for reason type', {
    reasonType,
    count: reasons.length
  })

  return reasons
}

/**
 * Save generated reasons to the database
 */
export async function saveGeneratedReasons(
  organizationId: string,
  reasons: GeneratedReason[],
  options: {
    templateItemId?: string
    reasonType?: string
    createdBy?: string
  }
): Promise<{ saved: number; skipped: number }> {
  let saved = 0
  let skipped = 0

  for (const reason of reasons) {
    const insertData: Record<string, unknown> = {
      organization_id: organizationId,
      reason_text: reason.reason_text,
      technical_description: reason.technical_description,
      customer_description: reason.customer_description,
      default_rag: reason.default_rag,
      category_id: reason.category,
      suggested_follow_up_days: reason.suggested_follow_up_days,
      suggested_follow_up_text: reason.suggested_follow_up_text,
      ai_generated: true,
      ai_reviewed: false,
      is_active: true
    }

    if (options.templateItemId) {
      insertData.template_item_id = options.templateItemId
    } else if (options.reasonType) {
      insertData.reason_type = options.reasonType
    }

    if (options.createdBy) {
      insertData.created_by = options.createdBy
    }

    const { error } = await supabaseAdmin
      .from('item_reasons')
      .insert(insertData)

    if (error) {
      if (error.code === '23505') {
        // Duplicate - skip
        skipped++
        logger.debug('Skipped duplicate reason', { reason_text: reason.reason_text })
      } else {
        logger.error('Failed to save reason', { error: error.message, reason_text: reason.reason_text })
        skipped++
      }
    } else {
      saved++
    }
  }

  return { saved, skipped }
}

/**
 * Generate reasons for a template item and save to database
 */
export async function generateAndSaveReasonsForItem(
  templateItemId: string,
  organizationId: string,
  createdBy?: string
): Promise<{ reasons: GeneratedReason[]; saved: number; skipped: number }> {
  // Get template item info
  const { data: item, error: itemError } = await supabaseAdmin
    .from('template_items')
    .select(`
      id,
      name,
      description,
      reason_type,
      section:template_sections(name)
    `)
    .eq('id', templateItemId)
    .single()

  if (itemError || !item) {
    throw new Error('Template item not found')
  }

  const tone = await getOrganizationTone(organizationId)

  const section = item.section as { name: string } | { name: string }[] | null
  const sectionName = Array.isArray(section) ? section[0]?.name : section?.name

  const templateItem: TemplateItemInfo = {
    id: item.id,
    name: item.name,
    description: item.description,
    reason_type: item.reason_type,
    section_name: sectionName
  }

  const reasons = await generateReasonsForItem(templateItem, tone, organizationId, createdBy)
  const { saved, skipped } = await saveGeneratedReasons(organizationId, reasons, {
    templateItemId,
    createdBy
  })

  return { reasons, saved, skipped }
}

/**
 * Generate reasons for a reason type and save to database
 */
export async function generateAndSaveReasonsForType(
  reasonType: string,
  organizationId: string,
  createdBy?: string
): Promise<{ reasons: GeneratedReason[]; saved: number; skipped: number }> {
  const tone = await getOrganizationTone(organizationId)

  const reasons = await generateReasonsForReasonType(reasonType, tone, organizationId, createdBy)
  const { saved, skipped } = await saveGeneratedReasons(organizationId, reasons, {
    reasonType,
    createdBy
  })

  return { reasons, saved, skipped }
}

/**
 * Generate reasons for all items in a template (bulk generation)
 */
export async function generateAllReasonsForTemplate(
  templateId: string,
  organizationId: string,
  createdBy?: string
): Promise<{
  itemsProcessed: number
  typesProcessed: number
  reasonsCreated: number
  itemsSkipped: number
  errors: string[]
}> {
  const errors: string[] = []
  let itemsProcessed = 0
  let typesProcessed = 0
  let reasonsCreated = 0
  let itemsSkipped = 0

  // Check limits before starting (fail fast)
  await checkGenerationAllowed(organizationId)

  const tone = await getOrganizationTone(organizationId)

  // Get all items in the template
  const { data: sections, error: sectionsError } = await supabaseAdmin
    .from('template_sections')
    .select(`
      id,
      name,
      items:template_items(id, name, description, reason_type, exclude_from_ai)
    `)
    .eq('template_id', templateId)
    .order('sort_order')

  if (sectionsError || !sections) {
    throw new Error('Failed to fetch template sections')
  }

  // Collect unique reason types and unique items
  const processedTypes = new Set<string>()
  const uniqueItems: Array<{ item: TemplateItemInfo; sectionName: string }> = []

  for (const section of sections) {
    const items = Array.isArray(section.items) ? section.items : []
    for (const item of items) {
      // Skip items excluded from AI generation
      if (item.exclude_from_ai) {
        itemsSkipped++
        continue
      }

      if (item.reason_type) {
        // This item has a reason type - we'll generate for the type instead
        if (!processedTypes.has(item.reason_type)) {
          processedTypes.add(item.reason_type)
        }
      } else {
        // Unique item - generate specific reasons
        uniqueItems.push({
          item: {
            id: item.id,
            name: item.name,
            description: item.description,
            reason_type: item.reason_type,
            section_name: section.name
          },
          sectionName: section.name
        })
      }
    }
  }

  // Generate for reason types first
  for (const reasonType of processedTypes) {
    try {
      // Check limits before each generation
      await checkGenerationAllowed(organizationId)

      logger.info('Generating reasons for type', { reasonType })

      const reasons = await generateReasonsForReasonType(reasonType, tone, organizationId, createdBy)
      const { saved } = await saveGeneratedReasons(organizationId, reasons, {
        reasonType,
        createdBy
      })

      typesProcessed++
      reasonsCreated += saved

      // Rate limiting - 500ms delay between API calls
      await delay(500)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      // If we hit limits, stop processing
      if (message.includes('limit reached') || message.includes('limit exceeded')) {
        errors.push(`Stopped: ${message}`)
        break
      }

      errors.push(`Type ${reasonType}: ${message}`)
      logger.error('Failed to generate reasons for type', { reasonType, error: message })
    }
  }

  // Generate for unique items
  for (const { item } of uniqueItems) {
    try {
      // Check limits before each generation
      await checkGenerationAllowed(organizationId)

      logger.info('Generating reasons for unique item', { itemName: item.name })

      const reasons = await generateReasonsForItem(item, tone, organizationId, createdBy)
      const { saved } = await saveGeneratedReasons(organizationId, reasons, {
        templateItemId: item.id,
        createdBy
      })

      itemsProcessed++
      reasonsCreated += saved

      // Rate limiting - 500ms delay between API calls
      await delay(500)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      // If we hit limits, stop processing
      if (message.includes('limit reached') || message.includes('limit exceeded')) {
        errors.push(`Stopped: ${message}`)
        break
      }

      errors.push(`Item ${item.name}: ${message}`)
      logger.error('Failed to generate reasons for item', { itemName: item.name, error: message })
    }
  }

  return {
    itemsProcessed,
    typesProcessed,
    reasonsCreated,
    itemsSkipped,
    errors
  }
}

/**
 * Regenerate descriptions for an existing reason
 */
export async function regenerateDescriptions(
  reasonId: string,
  organizationId: string,
  userId?: string
): Promise<{
  technical_description: string
  customer_description: string
}> {
  // Get the existing reason
  const { data: reason, error: reasonError } = await supabaseAdmin
    .from('item_reasons')
    .select(`
      id,
      reason_text,
      default_rag,
      category_id,
      template_item_id,
      reason_type
    `)
    .eq('id', reasonId)
    .eq('organization_id', organizationId)
    .single()

  if (reasonError || !reason) {
    throw new Error('Reason not found')
  }

  // Get the item name
  let itemName = 'Unknown Item'
  if (reason.template_item_id) {
    const { data: item } = await supabaseAdmin
      .from('template_items')
      .select('name')
      .eq('id', reason.template_item_id)
      .single()
    if (item) itemName = item.name
  } else if (reason.reason_type) {
    // Create friendly name from reason type
    const typeNameMap: Record<string, string> = {
      'tyre': 'Tyres',
      'brake_assembly': 'Brakes',
      'wiper': 'Wipers',
      'fluid_level': 'Fluid Levels',
      'shock_absorber': 'Shock Absorbers',
      'light_cluster': 'Lights',
      'exhaust': 'Exhaust',
      'suspension': 'Suspension',
      'steering': 'Steering',
      'wheel': 'Wheels'
    }
    itemName = typeNameMap[reason.reason_type] || reason.reason_type.replace(/_/g, ' ')
  }

  const tone = await getOrganizationTone(organizationId)

  const prompt = regenerateDescriptionsPrompt(
    reason.reason_text,
    itemName,
    reason.default_rag,
    reason.category_id,
    tone
  )

  const parsed = await generateWithTracking(
    organizationId,
    userId,
    'regenerate_descriptions',
    { templateItemId: reason.template_item_id || undefined, reasonType: reason.reason_type || undefined },
    async () => {
      const { result: responseText, inputTokens, outputTokens } = await callClaudeAPIWithUsage(prompt)

      // Parse the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('Failed to parse AI response')
      }

      const parsedResult = JSON.parse(jsonMatch[0]) as {
        technical_description: string
        customer_description: string
      }

      return { result: parsedResult, inputTokens, outputTokens }
    }
  )

  // Update the reason in the database
  const { error: updateError } = await supabaseAdmin
    .from('item_reasons')
    .update({
      technical_description: parsed.technical_description,
      customer_description: parsed.customer_description,
      ai_generated: true,
      ai_reviewed: false
    })
    .eq('id', reasonId)
    .eq('organization_id', organizationId)

  if (updateError) {
    throw new Error('Failed to update reason: ' + updateError.message)
  }

  return parsed
}

/**
 * Get AI usage summary for an organization
 */
export async function getAIUsageSummary(organizationId: string): Promise<{
  currentPeriodStart: string
  currentGenerations: number
  currentTokens: number
  currentCostUsd: number
  totalGenerations: number
  totalTokens: number
  totalCostUsd: number
  monthlyLimit: number
  percentageUsed: number
  isAiEnabled: boolean
  limitWarningSent: boolean
  limitReachedSent: boolean
}> {
  const { data, error } = await supabaseAdmin.rpc('get_org_ai_usage_summary', {
    p_organization_id: organizationId
  })

  if (error) {
    throw new Error('Failed to get AI usage summary: ' + error.message)
  }

  const result = data?.[0]
  if (!result) {
    // Return defaults for org without any usage
    return {
      currentPeriodStart: new Date().toISOString().slice(0, 10),
      currentGenerations: 0,
      currentTokens: 0,
      currentCostUsd: 0,
      totalGenerations: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      monthlyLimit: 100,
      percentageUsed: 0,
      isAiEnabled: true,
      limitWarningSent: false,
      limitReachedSent: false
    }
  }

  return {
    currentPeriodStart: result.current_period_start,
    currentGenerations: result.current_generations || 0,
    currentTokens: result.current_tokens || 0,
    currentCostUsd: parseFloat(result.current_cost_usd) || 0,
    totalGenerations: result.total_generations || 0,
    totalTokens: result.total_tokens || 0,
    totalCostUsd: parseFloat(result.total_cost_usd) || 0,
    monthlyLimit: result.monthly_limit || 100,
    percentageUsed: parseFloat(result.percentage_used) || 0,
    isAiEnabled: result.is_ai_enabled ?? true,
    limitWarningSent: result.limit_warning_sent || false,
    limitReachedSent: result.limit_reached_sent || false
  }
}
