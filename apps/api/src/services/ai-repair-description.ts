/**
 * AI Repair Description Service
 *
 * Generates customer-facing sales descriptions for repair items
 * by converting technician notes into friendly language using Claude AI.
 * Follows the same patterns as ai-mri.ts for consistency.
 */

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { getApiKey, getModel, generateWithTracking, type Tone } from './ai-reasons.js'

// Cached Anthropic client
let anthropicClient: Anthropic | null = null
let cachedApiKey: string | null = null

/**
 * Get or create Anthropic client with current API key
 */
async function getAnthropicClient(): Promise<Anthropic> {
  const apiKey = await getApiKey()

  if (anthropicClient && cachedApiKey === apiKey) {
    return anthropicClient
  }

  anthropicClient = new Anthropic({ apiKey })
  cachedApiKey = apiKey

  return anthropicClient
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

/**
 * Build the prompt for generating a customer-facing repair description
 */
function buildDescriptionPrompt(
  itemName: string,
  techNotes: string,
  tone: Tone
): string {
  const toneDescription = tone === 'premium'
    ? 'PREMIUM - Use formal, professional language suitable for a main dealer or prestige service centre. Emphasise quality, safety, and value.'
    : 'FRIENDLY - Use warm, approachable language suitable for an independent family garage. Be helpful, clear, and reassuring.'

  return `You are an expert automotive service advisor. Convert the following technician notes into a customer-facing description for a repair item.

REPAIR ITEM: ${itemName}
TECHNICIAN NOTES: ${techNotes}

TONE: ${toneDescription}

Requirements:
1. Write a clear, customer-friendly description (30-60 words)
2. Explain what was found and why it matters to the customer
3. Do NOT include pricing, part numbers, or overly technical jargon
4. Use UK English spelling (tyre, colour, centre, honour)
5. Be factual - do not exaggerate or understate the finding

Return ONLY the description text, no additional formatting or explanation.`
}

interface AIGenerationResult {
  result: string
  inputTokens: number
  outputTokens: number
}

/**
 * Call Claude API for description generation
 */
async function callClaudeAPI(prompt: string): Promise<AIGenerationResult> {
  const client = await getAnthropicClient()
  const model = await getModel()

  const response = await client.messages.create({
    model,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  })

  const content = response.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude API')
  }

  return {
    result: content.text.trim(),
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0
  }
}

/**
 * Generate a customer-facing description for a repair item from tech notes.
 * Does NOT auto-save the description -- returns it for advisor review.
 */
export async function generateRepairDescription(
  repairItemId: string,
  organizationId: string,
  userId?: string,
  checkResultId?: string
): Promise<string> {
  // Get the repair item
  const { data: item, error: itemError } = await supabaseAdmin
    .from('repair_items')
    .select('id, name, description')
    .eq('id', repairItemId)
    .eq('organization_id', organizationId)
    .single()

  if (itemError || !item) {
    throw new Error('Repair item not found')
  }

  // Get linked check result notes
  let techNotes = ''

  if (checkResultId) {
    // Fetch specific check result
    const { data: cr } = await supabaseAdmin
      .from('check_results')
      .select('notes')
      .eq('id', checkResultId)
      .single()

    if (cr?.notes) {
      techNotes = cr.notes
    }
  }

  // If no specific check result or no notes found, get all linked check results
  if (!techNotes) {
    const { data: links } = await supabaseAdmin
      .from('repair_item_check_results')
      .select('check_result:check_results(notes)')
      .eq('repair_item_id', repairItemId)

    if (links && links.length > 0) {
      const allNotes = links
        .map(l => {
          const cr = l.check_result as unknown as { notes?: string } | { notes?: string }[] | null
          if (Array.isArray(cr)) return cr[0]?.notes
          return cr?.notes
        })
        .filter(Boolean)

      techNotes = allNotes.join('. ')
    }
  }

  if (!techNotes) {
    throw new Error('No technician notes available to generate from')
  }

  logger.info('Generating repair description', {
    repairItemId: item.id,
    itemName: item.name,
    organizationId,
    notesLength: techNotes.length
  })

  const tone = await getOrganizationTone(organizationId)

  const prompt = buildDescriptionPrompt(item.name, techNotes, tone)

  const description = await generateWithTracking(
    organizationId,
    userId,
    'generate_repair_description',
    { templateItemId: repairItemId },
    async () => {
      const { result, inputTokens, outputTokens } = await callClaudeAPI(prompt)
      return { result, inputTokens, outputTokens }
    }
  )

  logger.info('Generated repair description', {
    repairItemId: item.id,
    descriptionLength: description.length
  })

  return description
}
