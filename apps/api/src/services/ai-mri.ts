/**
 * AI MRI Sales Description Service
 *
 * Generates customer-facing sales descriptions for MRI (Manufacturer Recommended Items)
 * using Claude AI. Follows the same patterns as ai-reasons.ts for consistency.
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

  // Reuse client if API key hasn't changed
  if (anthropicClient && cachedApiKey === apiKey) {
    return anthropicClient
  }

  // Create new client
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
 * Generate the prompt for MRI sales description
 */
function generateSalesDescriptionPrompt(
  itemName: string,
  description: string | null,
  itemType: string,
  severityWhenDue: string | null,
  tone: Tone
): string {
  const toneDescription = tone === 'premium'
    ? 'PREMIUM - Use formal, professional language suitable for a main dealer or prestige service centre. Emphasise quality and value.'
    : 'FRIENDLY - Use warm, approachable language suitable for an independent family garage. Be helpful and reassuring.'

  const customerTone = tone === 'premium'
    ? 'professional and value-focused'
    : 'warm and reassuring'

  const severityContext = severityWhenDue
    ? `When this item is due, it is flagged as ${severityWhenDue.toUpperCase()} severity.`
    : 'This is an informational item.'

  return `You are an expert automotive service advisor. Generate a customer-facing sales description for the following Manufacturer Recommended Item (MRI).

MRI ITEM: ${itemName}
${description ? `TECHNICAL DESCRIPTION: ${description}` : ''}
TYPE: ${itemType === 'date_mileage' ? 'Service interval item (tracked by date/mileage)' : 'Yes/No check item'}
${severityContext}

TONE: ${toneDescription}

Generate a sales description that:
1. Explains what this item is and why it matters to the customer
2. Highlights the benefits of keeping this item serviced/maintained
3. Uses ${customerTone} language
4. Is between 40-80 words
5. Does NOT include pricing or specific costs
6. Uses UK English spelling (tyre, colour, centre)

Return ONLY the sales description text, no additional formatting or explanation.`
}

interface AIGenerationResult {
  result: string
  inputTokens: number
  outputTokens: number
}

/**
 * Call Claude API for sales description generation
 */
async function callClaudeAPIForDescription(prompt: string): Promise<AIGenerationResult> {
  const client = await getAnthropicClient()
  const model = await getModel()

  const response = await client.messages.create({
    model,
    max_tokens: 500,
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
 * Generate a sales description for an MRI item
 */
export async function generateMriSalesDescription(
  mriItemId: string,
  organizationId: string,
  userId?: string
): Promise<string> {
  // Get the MRI item
  const { data: item, error: itemError } = await supabaseAdmin
    .from('mri_items')
    .select('id, name, description, item_type, severity_when_due')
    .eq('id', mriItemId)
    .eq('organization_id', organizationId)
    .single()

  if (itemError || !item) {
    throw new Error('MRI item not found')
  }

  logger.info('Generating sales description for MRI item', {
    itemId: item.id,
    itemName: item.name,
    organizationId
  })

  const tone = await getOrganizationTone(organizationId)

  const prompt = generateSalesDescriptionPrompt(
    item.name,
    item.description,
    item.item_type,
    item.severity_when_due,
    tone
  )

  const salesDescription = await generateWithTracking(
    organizationId,
    userId,
    'generate_mri_sales_description',
    { templateItemId: mriItemId },
    async () => {
      const { result, inputTokens, outputTokens } = await callClaudeAPIForDescription(prompt)
      return { result, inputTokens, outputTokens }
    }
  )

  // Update the MRI item with the generated description
  const { error: updateError } = await supabaseAdmin
    .from('mri_items')
    .update({
      sales_description: salesDescription,
      ai_generated: true,
      ai_reviewed: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', mriItemId)
    .eq('organization_id', organizationId)

  if (updateError) {
    throw new Error('Failed to update MRI item: ' + updateError.message)
  }

  logger.info('Generated sales description for MRI item', {
    itemId: item.id,
    descriptionLength: salesDescription.length
  })

  return salesDescription
}
