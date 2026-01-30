/**
 * Template Renderer Service
 *
 * Handles template fetching, placeholder rendering, and HTML email generation
 */

import { supabaseAdmin } from '../lib/supabase.js'
import {
  DEFAULT_TEMPLATES,
  TemplateType,
  SmsTemplate,
  EmailTemplate
} from './default-templates.js'
import type { OrganizationBranding, EmailRepairItem } from './email.js'

/**
 * Template context containing all available placeholder values
 */
export interface TemplateContext {
  customerName: string
  customerFirstName: string
  vehicleReg: string
  vehicleMakeModel: string
  publicUrl: string
  dealershipName: string
  dealershipPhone?: string
  redCount?: number
  amberCount?: number
  greenCount?: number
  quoteTotalIncVat?: number
  repairItemsCount?: number
  hoursRemaining?: number
  approvedCount?: number
  authorizedTotal?: number
  expiryDate?: string
}

/**
 * Database template record structure
 */
interface DbMessageTemplate {
  id: string
  organization_id: string
  template_type: string
  channel: string
  sms_content: string | null
  email_subject: string | null
  email_greeting: string | null
  email_body: string | null
  email_closing: string | null
  email_signature: string | null
  email_cta_text: string | null
  is_custom: boolean
  created_at: string
  updated_at: string
}

/**
 * Unified template structure returned by getOrganizationTemplate
 */
export interface MessageTemplate {
  id?: string
  templateType: TemplateType
  channel: 'sms' | 'email'
  isCustom: boolean

  // SMS content
  smsContent?: string

  // Email content (block-based)
  emailSubject?: string
  emailGreeting?: string
  emailBody?: string
  emailClosing?: string
  emailSignature?: string
  emailCtaText?: string
}

/**
 * Replace {{placeholders}} with values from context
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  if (!template) return ''

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = context[key as keyof TemplateContext]

    if (value === undefined || value === null) {
      return '' // Remove placeholder if no value
    }

    // Format currency values
    if (key === 'quoteTotalIncVat' || key === 'authorizedTotal') {
      if (typeof value === 'number') {
        return `£${value.toFixed(2)}`
      }
    }

    // Return string representation
    return String(value)
  })
}

/**
 * Fetch organization template from database or return defaults
 */
export async function getOrganizationTemplate(
  organizationId: string | undefined,
  templateType: TemplateType,
  channel: 'sms' | 'email'
): Promise<MessageTemplate> {
  // Get default template
  const defaults = DEFAULT_TEMPLATES[templateType]
  if (!defaults) {
    throw new Error(`Unknown template type: ${templateType}`)
  }

  const defaultTemplate = channel === 'sms' ? defaults.sms : defaults.email

  // If no organizationId, return defaults
  if (!organizationId) {
    return {
      templateType,
      channel,
      isCustom: false,
      ...(channel === 'sms'
        ? { smsContent: (defaultTemplate as SmsTemplate).smsContent }
        : {
            emailSubject: (defaultTemplate as EmailTemplate).emailSubject,
            emailGreeting: (defaultTemplate as EmailTemplate).emailGreeting,
            emailBody: (defaultTemplate as EmailTemplate).emailBody,
            emailClosing: (defaultTemplate as EmailTemplate).emailClosing,
            emailSignature: (defaultTemplate as EmailTemplate).emailSignature,
            emailCtaText: (defaultTemplate as EmailTemplate).emailCtaText
          })
    }
  }

  // Try to fetch from database
  const { data, error } = await supabaseAdmin
    .from('organization_message_templates')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('template_type', templateType)
    .eq('channel', channel)
    .maybeSingle()

  if (error) {
    console.error('Error fetching template:', error)
    // Fall back to defaults on error
  }

  // If custom template exists, merge with defaults (custom values override)
  if (data) {
    const dbTemplate = data as DbMessageTemplate

    if (channel === 'sms') {
      return {
        id: dbTemplate.id,
        templateType,
        channel: 'sms',
        isCustom: dbTemplate.is_custom,
        smsContent: dbTemplate.sms_content || (defaultTemplate as SmsTemplate).smsContent
      }
    } else {
      return {
        id: dbTemplate.id,
        templateType,
        channel: 'email',
        isCustom: dbTemplate.is_custom,
        emailSubject: dbTemplate.email_subject || (defaultTemplate as EmailTemplate).emailSubject,
        emailGreeting:
          dbTemplate.email_greeting || (defaultTemplate as EmailTemplate).emailGreeting,
        emailBody: dbTemplate.email_body || (defaultTemplate as EmailTemplate).emailBody,
        emailClosing: dbTemplate.email_closing || (defaultTemplate as EmailTemplate).emailClosing,
        emailSignature:
          dbTemplate.email_signature || (defaultTemplate as EmailTemplate).emailSignature,
        emailCtaText: dbTemplate.email_cta_text || (defaultTemplate as EmailTemplate).emailCtaText
      }
    }
  }

  // Return defaults
  return {
    templateType,
    channel,
    isCustom: false,
    ...(channel === 'sms'
      ? { smsContent: (defaultTemplate as SmsTemplate).smsContent }
      : {
          emailSubject: (defaultTemplate as EmailTemplate).emailSubject,
          emailGreeting: (defaultTemplate as EmailTemplate).emailGreeting,
          emailBody: (defaultTemplate as EmailTemplate).emailBody,
          emailClosing: (defaultTemplate as EmailTemplate).emailClosing,
          emailSignature: (defaultTemplate as EmailTemplate).emailSignature,
          emailCtaText: (defaultTemplate as EmailTemplate).emailCtaText
        })
  }
}

/**
 * Build RAG summary HTML for emails (system-generated, not customizable)
 */
function buildRagSummaryHtml(redCount: number, amberCount: number, greenCount: number): string {
  return `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td width="33%" style="text-align: center; padding: 16px; background-color: #fee2e2;">
          <div style="font-size: 32px; font-weight: bold; color: #dc2626;">${redCount}</div>
          <div style="font-size: 12px; color: #991b1b;">URGENT</div>
        </td>
        <td width="33%" style="text-align: center; padding: 16px; background-color: #fef9c3;">
          <div style="font-size: 32px; font-weight: bold; color: #ca8a04;">${amberCount}</div>
          <div style="font-size: 12px; color: #854d0e;">ADVISORY</div>
        </td>
        <td width="33%" style="text-align: center; padding: 16px; background-color: #dcfce7;">
          <div style="font-size: 32px; font-weight: bold; color: #16a34a;">${greenCount}</div>
          <div style="font-size: 12px; color: #166534;">PASSED</div>
        </td>
      </tr>
    </table>`
}

/**
 * Build repair items HTML for emails (system-generated, not customizable)
 */
function buildRepairItemsHtml(repairItems: EmailRepairItem[], quoteTotalIncVat?: number): string {
  if (!repairItems || repairItems.length === 0) return ''

  const itemsHtml = repairItems
    .map(
      item => `
      <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e9e5f5;">
        <div style="margin-bottom: 4px;">
          <strong style="color: #1f2937;">${item.name}</strong>
          <span style="float: right; font-weight: 600; color: #7c3aed;">£${item.totalIncVat.toFixed(2)}</span>
        </div>
        ${
          item.linkedCheckResults.length > 0
            ? `
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
            Related to: ${item.linkedCheckResults.join(', ')}
          </div>
        `
            : ''
        }
        ${
          item.options.length > 0
            ? `
          <div style="font-size: 12px; color: #4b5563;">
            ${item.options.length} option${item.options.length > 1 ? 's' : ''} available
            ${item.options.find(o => o.isRecommended) ? ` • Recommended: ${item.options.find(o => o.isRecommended)?.name}` : ''}
          </div>
        `
            : ''
        }
      </div>
    `
    )
    .join('')

  const totalHtml =
    quoteTotalIncVat !== undefined
      ? `
    <div style="margin-top: 16px; padding-top: 16px; border-top: 2px solid #7c3aed;">
      <div>
        <strong style="color: #1f2937; font-size: 16px;">Quote Total (Inc VAT)</strong>
        <strong style="float: right; color: #7c3aed; font-size: 18px;">£${quoteTotalIncVat.toFixed(2)}</strong>
      </div>
    </div>
  `
      : ''

  return `
    <div style="margin: 0 0 24px; background-color: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; overflow: hidden;">
      <div style="padding: 12px 16px; border-bottom: 1px solid #ddd6fe;">
        <h3 style="margin: 0; color: #7c3aed; font-size: 16px;">Recommended Work</h3>
      </div>
      <div style="padding: 16px;">
        ${itemsHtml}
        ${totalHtml}
      </div>
    </div>
  `
}

/**
 * Build CTA button HTML for emails
 */
function buildCtaButtonHtml(ctaText: string, url: string, primaryColor: string): string {
  if (!ctaText) return ''

  return `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px;">
      <tr>
        <td style="text-align: center;">
          <a href="${url}" style="display: inline-block; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; padding: 16px 32px; font-size: 18px; font-weight: bold;">
            ${ctaText}
          </a>
        </td>
      </tr>
    </table>`
}

/**
 * Authorized item for confirmation emails
 */
export interface AuthorizedItem {
  title: string
  price: number
}

/**
 * Build authorized items table HTML for confirmation emails (system-generated)
 */
function buildAuthorizedItemsHtml(items: AuthorizedItem[], totalAuthorized: number): string {
  if (!items || items.length === 0) return ''

  const itemsHtml = items
    .map(
      item => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.title}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">£${item.price.toFixed(2)}</td>
      </tr>
    `
    )
    .join('')

  return `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px; border: 1px solid #eee;">
      <thead>
        <tr style="background-color: #f8f8f8;">
          <th style="padding: 12px 8px; text-align: left; font-weight: bold;">Item</th>
          <th style="padding: 12px 8px; text-align: right; font-weight: bold;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
      <tfoot>
        <tr style="background-color: #f8f8f8;">
          <td style="padding: 12px 8px; font-weight: bold;">Total Authorized</td>
          <td style="padding: 12px 8px; text-align: right; font-weight: bold; font-size: 18px;">£${totalAuthorized.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  `
}

/**
 * Options for rendering HTML email
 */
export interface RenderEmailOptions {
  template: MessageTemplate
  context: TemplateContext
  branding: OrganizationBranding
  showRagSummary?: boolean
  repairItems?: EmailRepairItem[]
  quoteTotalIncVat?: number
  customMessage?: string
  headerBackgroundColor?: string
  expiryText?: string
  authorizedItems?: AuthorizedItem[]
  totalAuthorized?: number
}

/**
 * Render full HTML email from template blocks
 */
export function renderEmailHtml(options: RenderEmailOptions): string {
  const {
    template,
    context,
    branding,
    showRagSummary = false,
    repairItems,
    quoteTotalIncVat,
    customMessage,
    headerBackgroundColor,
    expiryText = 'This link will expire in 72 hours. Please respond at your earliest convenience.',
    authorizedItems,
    totalAuthorized
  } = options

  const primaryColor = headerBackgroundColor || branding.primaryColor || '#3B82F6'
  const organizationName = branding.organizationName || context.dealershipName

  // Render customizable blocks with placeholders
  const greeting = renderTemplate(template.emailGreeting || '', context)
  const body = renderTemplate(template.emailBody || '', context)
  const closing = renderTemplate(template.emailClosing || '', context)
  const signature = renderTemplate(template.emailSignature || '', context)
  const ctaText = renderTemplate(template.emailCtaText || '', context)

  // Convert body line breaks to HTML
  const bodyHtml = body
    .split('\n\n')
    .map(p => (p.trim() ? `<p style="margin: 0 0 16px; color: #333; font-size: 16px;">${p.trim()}</p>` : ''))
    .join('')

  // Build header with logo or text
  const headerContent = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${organizationName}" style="max-height: 48px; max-width: 200px; margin-bottom: 8px;">`
    : `<h1 style="color: #ffffff; margin: 0; font-size: 24px;">Vehicle Health Check</h1>`

  // Build optional custom message block
  const customMessageHtml = customMessage
    ? `<p style="margin: 0 0 24px; color: #333; font-size: 16px; padding: 16px; background-color: #f8f8f8; border-left: 4px solid ${primaryColor};">${customMessage}</p>`
    : ''

  // Build RAG summary if requested
  const ragHtml =
    showRagSummary && context.redCount !== undefined
      ? buildRagSummaryHtml(context.redCount, context.amberCount || 0, context.greenCount || 0)
      : ''

  // Build repair items if provided
  const repairItemsHtml =
    repairItems && repairItems.length > 0
      ? buildRepairItemsHtml(repairItems, quoteTotalIncVat)
      : ''

  // Build authorized items table if provided (for confirmation emails)
  const authorizedItemsHtml =
    authorizedItems && authorizedItems.length > 0 && totalAuthorized !== undefined
      ? buildAuthorizedItemsHtml(authorizedItems, totalAuthorized)
      : ''

  // Build CTA button
  const ctaHtml = ctaText ? buildCtaButtonHtml(ctaText, context.publicUrl, primaryColor) : ''

  // Build closing paragraph
  const closingHtml = closing
    ? `<p style="margin: 0 0 16px; color: #666; font-size: 14px;">${closing}</p>`
    : ''

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vehicle Health Check</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <!-- Header -->
    <tr>
      <td style="background-color: ${primaryColor}; padding: 24px; text-align: center;">
        ${headerContent}
      </td>
    </tr>

    <!-- Content -->
    <tr>
      <td style="padding: 32px 24px;">
        <p style="margin: 0 0 16px; color: #333; font-size: 16px;">${greeting}</p>

        ${bodyHtml}

        ${customMessageHtml}

        ${ragHtml}

        ${repairItemsHtml}

        ${authorizedItemsHtml}

        ${ctaHtml}

        ${closingHtml}
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #f4f4f4; padding: 24px; text-align: center;">
        <p style="margin: 0 0 8px; color: #666; font-size: 14px;">${signature || organizationName}</p>
        <p style="margin: 0; color: #999; font-size: 12px;">
          ${expiryText}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Render plain text version of email
 */
export function renderEmailText(options: RenderEmailOptions): string {
  const {
    template,
    context,
    branding,
    showRagSummary = false,
    repairItems,
    quoteTotalIncVat,
    authorizedItems,
    totalAuthorized
  } = options

  const organizationName = branding.organizationName || context.dealershipName

  // Render customizable blocks with placeholders
  const greeting = renderTemplate(template.emailGreeting || '', context)
  const body = renderTemplate(template.emailBody || '', context)
  const closing = renderTemplate(template.emailClosing || '', context)
  const signature = renderTemplate(template.emailSignature || '', context)

  // Build RAG summary text
  const ragText =
    showRagSummary && context.redCount !== undefined
      ? `
Summary:
- ${context.redCount} Urgent items requiring immediate attention
- ${context.amberCount || 0} Advisory items for your consideration
- ${context.greenCount || 0} Items passed inspection
`
      : ''

  // Build repair items text
  const repairItemsText =
    repairItems && repairItems.length > 0
      ? `
Recommended Work:
${repairItems.map(item => `- ${item.name}: £${item.totalIncVat.toFixed(2)}${item.options.length > 0 ? ` (${item.options.length} option${item.options.length > 1 ? 's' : ''} available)` : ''}`).join('\n')}
${quoteTotalIncVat !== undefined ? `\nQuote Total (Inc VAT): £${quoteTotalIncVat.toFixed(2)}\n` : ''}
`
      : ''

  // Build authorized items text
  const authorizedItemsText =
    authorizedItems && authorizedItems.length > 0 && totalAuthorized !== undefined
      ? `
Authorized Work:
${authorizedItems.map(item => `- ${item.title}: £${item.price.toFixed(2)}`).join('\n')}

Total Authorized: £${totalAuthorized.toFixed(2)}
`
      : ''

  // Only include the public URL line if there's a URL
  const urlLine = context.publicUrl ? `\nView your health check: ${context.publicUrl}\n` : ''

  return `
${greeting}

${body}
${ragText}
${repairItemsText}
${authorizedItemsText}
${urlLine}
${closing}

${signature || organizationName}
`.trim()
}

/**
 * Render SMS message from template
 */
export function renderSmsMessage(template: MessageTemplate, context: TemplateContext): string {
  return renderTemplate(template.smsContent || '', context)
}

/**
 * Generate preview with sample data
 */
export const SAMPLE_CONTEXT: TemplateContext = {
  customerName: 'John Smith',
  customerFirstName: 'John',
  vehicleReg: 'AB21 XYZ',
  vehicleMakeModel: 'BMW 3 Series',
  publicUrl: 'https://inspect.ollosoft.io/view/abc123',
  dealershipName: 'Premier Motors',
  dealershipPhone: '01onal 123456',
  redCount: 2,
  amberCount: 3,
  greenCount: 15,
  quoteTotalIncVat: 245.0,
  repairItemsCount: 5,
  hoursRemaining: 12,
  approvedCount: 3,
  authorizedTotal: 180.0,
  expiryDate: '31 January 2026'
}
