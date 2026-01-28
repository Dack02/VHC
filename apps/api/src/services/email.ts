/**
 * Email Service - Resend integration for sending emails
 * Supports both platform and organization-level credentials
 */

import { Resend } from 'resend'
import { getEmailCredentials, EmailCredentials } from './credentials.js'
import { supabaseAdmin } from '../lib/supabase.js'
import {
  getOrganizationTemplate,
  renderTemplate,
  renderEmailHtml,
  renderEmailText,
  TemplateContext
} from './template-renderer.js'
import type { TemplateType } from './default-templates.js'

export interface OrganizationBranding {
  logoUrl?: string | null
  primaryColor?: string
  organizationName?: string
  phone?: string
  email?: string
  website?: string
}

// Repair item types for email templates
export interface EmailRepairOption {
  id: string
  name: string
  totalIncVat: number
  isRecommended: boolean
}

export interface EmailRepairItem {
  id: string
  name: string
  description?: string | null
  totalIncVat: number
  options: EmailRepairOption[]
  linkedCheckResults: string[]
}

// Legacy: Environment-based credentials for backward compatibility
const envApiKey = process.env.RESEND_API_KEY
const envFromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@vhc.example.com'
const envFromName = process.env.RESEND_FROM_NAME || 'Vehicle Health Check'

// Legacy client for backward compatibility
const legacyResend = envApiKey ? new Resend(envApiKey) : null

export interface EmailResult {
  success: boolean
  messageId?: string
  error?: string
  source?: 'organization' | 'platform' | 'env'
}

export interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  organizationId?: string
}

/**
 * Send an email using organization or platform credentials
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const { to, subject, html, text, replyTo, organizationId } = options

  // If organizationId provided, use credential resolution
  if (organizationId) {
    const credResult = await getEmailCredentials(organizationId)

    if (!credResult.configured || !credResult.credentials) {
      console.log(`Email not configured for org ${organizationId} - Email would be sent to:`, to)
      console.log('Subject:', subject)
      return {
        success: false,
        error: credResult.error || 'Email not configured',
        source: credResult.source
      }
    }

    try {
      const resend = new Resend(credResult.credentials.apiKey)

      const result = await resend.emails.send({
        from: `${credResult.credentials.fromName} <${credResult.credentials.fromEmail}>`,
        to: [to],
        subject,
        html,
        text,
        replyTo
      })

      if (result.error) {
        console.error('Email send error:', result.error)
        return {
          success: false,
          error: result.error.message,
          source: credResult.source
        }
      }

      console.log(`Email sent successfully via ${credResult.source}:`, result.data?.id)
      return {
        success: true,
        messageId: result.data?.id,
        source: credResult.source
      }
    } catch (error) {
      console.error('Email send error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send email',
        source: credResult.source
      }
    }
  }

  // Legacy: Use environment-based credentials
  if (!legacyResend) {
    console.log('Resend not configured - Email would be sent to:', to)
    console.log('Subject:', subject)
    return {
      success: true,
      messageId: 'mock-' + Date.now(),
      error: 'Resend not configured - email logged only',
      source: 'env'
    }
  }

  try {
    const result = await legacyResend.emails.send({
      from: `${envFromName} <${envFromEmail}>`,
      to: [to],
      subject,
      html,
      text,
      replyTo
    })

    if (result.error) {
      console.error('Email send error:', result.error)
      return {
        success: false,
        error: result.error.message,
        source: 'env'
      }
    }

    console.log('Email sent successfully:', result.data?.id)
    return {
      success: true,
      messageId: result.data?.id,
      source: 'env'
    }
  } catch (error) {
    console.error('Email send error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email',
      source: 'env'
    }
  }
}

/**
 * Test email with specific credentials (for testing in settings UI)
 */
export async function testEmailWithCredentials(
  credentials: EmailCredentials,
  to: string
): Promise<EmailResult> {
  try {
    const resend = new Resend(credentials.apiKey)

    const result = await resend.emails.send({
      from: `${credentials.fromName} <${credentials.fromEmail}>`,
      to: [to],
      subject: 'VHC Platform - Test Email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1e40af;">Test Email</h1>
          <p>This is a test email from VHC Platform.</p>
          <p>If you received this, your email is configured correctly!</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
          <p style="color: #666; font-size: 12px;">
            Sent from: ${credentials.fromName} &lt;${credentials.fromEmail}&gt;
          </p>
        </div>
      `,
      text: 'This is a test email from VHC Platform. If you received this, your email is configured correctly!'
    })

    if (result.error) {
      return {
        success: false,
        error: result.error.message
      }
    }

    return {
      success: true,
      messageId: result.data?.id
    }
  } catch (error) {
    console.error('Test email error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test email'
    }
  }
}

/**
 * Send health check ready notification email
 */
export async function sendHealthCheckReadyEmail(
  to: string,
  customerName: string,
  vehicleReg: string,
  vehicleMakeModel: string,
  publicUrl: string,
  dealershipName: string,
  dealershipPhone: string,
  redCount: number,
  amberCount: number,
  greenCount: number,
  customMessage?: string,
  organizationId?: string,
  repairItems?: EmailRepairItem[],
  quoteTotalIncVat?: number
): Promise<EmailResult> {
  // Get organization branding
  const branding = organizationId
    ? await getOrganizationBranding(organizationId)
    : { primaryColor: '#3B82F6', organizationName: dealershipName }

  // Get customizable template
  const template = await getOrganizationTemplate(
    organizationId,
    'health_check_ready',
    'email'
  )

  // Build context for template rendering
  const firstName = customerName.split(' ')[0]
  const context: TemplateContext = {
    customerName,
    customerFirstName: firstName,
    vehicleReg,
    vehicleMakeModel,
    publicUrl,
    dealershipName: branding.organizationName || dealershipName,
    dealershipPhone,
    redCount,
    amberCount,
    greenCount,
    quoteTotalIncVat,
    repairItemsCount: repairItems?.length || 0
  }

  // Render subject with placeholders
  const subject = renderTemplate(template.emailSubject || '', context)

  // Render full HTML email using template blocks
  const html = renderEmailHtml({
    template,
    context,
    branding,
    showRagSummary: true,
    repairItems,
    quoteTotalIncVat,
    customMessage,
    expiryText: 'This link will expire in 72 hours. Please respond at your earliest convenience.'
  })

  // Render plain text version
  const text = renderEmailText({
    template,
    context,
    branding,
    showRagSummary: true,
    repairItems,
    quoteTotalIncVat
  })

  return sendEmail({ to, subject, html, text, organizationId })
}

/**
 * Send reminder email
 */
export async function sendReminderEmail(
  to: string,
  customerName: string,
  vehicleReg: string,
  publicUrl: string,
  dealershipName: string,
  dealershipPhone: string,
  hoursRemaining?: number,
  organizationId?: string
): Promise<EmailResult> {
  // Get organization branding
  const branding = organizationId
    ? await getOrganizationBranding(organizationId)
    : { primaryColor: '#3B82F6', organizationName: dealershipName }

  // Use urgent template if less than 24 hours remaining
  const isUrgent = hoursRemaining && hoursRemaining <= 24
  const templateType: TemplateType = isUrgent ? 'reminder_urgent' : 'reminder'

  // Get customizable template
  const template = await getOrganizationTemplate(organizationId, templateType, 'email')

  // Build context for template rendering
  const firstName = customerName.split(' ')[0]
  const context: TemplateContext = {
    customerName,
    customerFirstName: firstName,
    vehicleReg,
    vehicleMakeModel: '',
    publicUrl,
    dealershipName: branding.organizationName || dealershipName,
    dealershipPhone,
    hoursRemaining: hoursRemaining || 0
  }

  // Render subject with placeholders
  const subject = renderTemplate(template.emailSubject || '', context)

  // Header color: red for urgent, otherwise primary
  const headerBackgroundColor = isUrgent ? '#dc2626' : undefined

  // Render full HTML email using template blocks
  const html = renderEmailHtml({
    template,
    context,
    branding,
    showRagSummary: false,
    headerBackgroundColor,
    expiryText: isUrgent
      ? `Your link expires in ${hoursRemaining} hours.`
      : 'Please respond at your earliest convenience.'
  })

  // Render plain text version
  const text = renderEmailText({
    template,
    context,
    branding,
    showRagSummary: false
  })

  return sendEmail({ to, subject, html, text, organizationId })
}

/**
 * Send authorization confirmation email
 */
export async function sendAuthorizationConfirmationEmail(
  to: string,
  customerName: string,
  vehicleReg: string,
  authorizedItems: Array<{ title: string; price: number }>,
  totalAuthorized: number,
  dealershipName: string,
  dealershipPhone: string,
  organizationId?: string
): Promise<EmailResult> {
  // Get organization branding
  const branding = organizationId
    ? await getOrganizationBranding(organizationId)
    : { primaryColor: '#3B82F6', organizationName: dealershipName }

  // Get customizable template
  const template = await getOrganizationTemplate(
    organizationId,
    'authorization_confirmation',
    'email'
  )

  // Build context for template rendering
  const firstName = customerName.split(' ')[0]
  const context: TemplateContext = {
    customerName,
    customerFirstName: firstName,
    vehicleReg,
    vehicleMakeModel: '',
    publicUrl: '',
    dealershipName: branding.organizationName || dealershipName,
    dealershipPhone,
    approvedCount: authorizedItems.length,
    authorizedTotal: totalAuthorized
  }

  // Render subject with placeholders
  const subject = renderTemplate(template.emailSubject || '', context)

  // Render full HTML email using template blocks - green header for confirmation
  const html = renderEmailHtml({
    template,
    context,
    branding,
    showRagSummary: false,
    headerBackgroundColor: '#16a34a', // Green for success
    authorizedItems,
    totalAuthorized,
    expiryText: ''
  })

  // Render plain text version
  const text = renderEmailText({
    template,
    context,
    branding,
    showRagSummary: false,
    authorizedItems,
    totalAuthorized
  })

  return sendEmail({ to, subject, html, text, organizationId })
}

/**
 * Check if Resend is configured (legacy - checks env vars)
 */
export function isResendConfigured(): boolean {
  return !!legacyResend
}

/**
 * Get organization branding settings
 */
export async function getOrganizationBranding(organizationId: string): Promise<OrganizationBranding> {
  const defaultBranding: OrganizationBranding = {
    primaryColor: '#3B82F6',
    organizationName: 'Vehicle Health Check'
  }

  try {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, settings')
      .eq('id', organizationId)
      .single()

    if (!org) return defaultBranding

    const settings = org.settings as Record<string, unknown> | null

    return {
      logoUrl: settings?.logoUrl as string | null,
      primaryColor: (settings?.primaryColor as string) || defaultBranding.primaryColor,
      organizationName: org.name || defaultBranding.organizationName,
      phone: settings?.phone as string,
      email: settings?.email as string,
      website: settings?.website as string
    }
  } catch (error) {
    console.error('Failed to get organization branding:', error)
    return defaultBranding
  }
}

/**
 * Repair item response data for notifications
 */
export interface RepairItemResponse {
  name: string
  approved: boolean
  selectedOption?: string | null
  declinedReason?: string | null
  totalIncVat: number
}

/**
 * Send notification to advisor when customer responds to health check
 */
export async function sendCustomerResponseNotification(
  advisorEmail: string,
  advisorName: string,
  customerName: string,
  vehicleReg: string,
  vehicleMakeModel: string,
  responses: RepairItemResponse[],
  totalApproved: number,
  healthCheckUrl: string,
  organizationId?: string
): Promise<EmailResult> {
  const branding = organizationId
    ? await getOrganizationBranding(organizationId)
    : { primaryColor: '#3B82F6', organizationName: 'Vehicle Health Check' }

  const primaryColor = branding.primaryColor || '#3B82F6'
  const approvedItems = responses.filter(r => r.approved)
  const declinedItems = responses.filter(r => !r.approved)

  const subject = `Customer Response: ${vehicleReg} - ${customerName}`

  const headerContent = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${branding.organizationName}" style="max-height: 40px; max-width: 160px;">`
    : `<h1 style="color: #ffffff; margin: 0; font-size: 20px;">Customer Response</h1>`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="background-color: ${primaryColor}; padding: 20px; text-align: center;">
        ${headerContent}
      </td>
    </tr>

    <tr>
      <td style="padding: 24px;">
        <p style="margin: 0 0 16px; color: #333; font-size: 16px;">Hi ${advisorName},</p>

        <p style="margin: 0 0 16px; color: #333; font-size: 14px;">
          <strong>${customerName}</strong> has responded to the health check for <strong>${vehicleReg}</strong> (${vehicleMakeModel}).
        </p>

        <!-- Summary -->
        <table cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px;">
          <tr>
            <td width="50%" style="text-align: center; padding: 12px; background-color: #dcfce7;">
              <div style="font-size: 28px; font-weight: bold; color: #16a34a;">${approvedItems.length}</div>
              <div style="font-size: 11px; color: #166534;">APPROVED</div>
            </td>
            <td width="50%" style="text-align: center; padding: 12px; background-color: #fee2e2;">
              <div style="font-size: 28px; font-weight: bold; color: #dc2626;">${declinedItems.length}</div>
              <div style="font-size: 11px; color: #991b1b;">DECLINED</div>
            </td>
          </tr>
        </table>

        ${approvedItems.length > 0 ? `
        <div style="margin: 0 0 16px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px;">
          <h4 style="margin: 0 0 8px; color: #16a34a; font-size: 14px;">Approved Items</h4>
          ${approvedItems.map(item => `
            <div style="padding: 6px 0; border-bottom: 1px solid #dcfce7; font-size: 13px;">
              <strong>${item.name}</strong> - £${item.totalIncVat.toFixed(2)}
              ${item.selectedOption ? `<br><span style="color: #6b7280; font-size: 11px;">Option: ${item.selectedOption}</span>` : ''}
            </div>
          `).join('')}
          <div style="margin-top: 10px; font-weight: 600; color: #166534; font-size: 14px;">
            Total Approved: £${totalApproved.toFixed(2)}
          </div>
        </div>
        ` : ''}

        ${declinedItems.length > 0 ? `
        <div style="margin: 0 0 16px; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px;">
          <h4 style="margin: 0 0 8px; color: #dc2626; font-size: 14px;">Declined Items</h4>
          ${declinedItems.map(item => `
            <div style="padding: 6px 0; border-bottom: 1px solid #fee2e2; font-size: 13px;">
              <strong>${item.name}</strong>
              ${item.declinedReason ? `<br><span style="color: #6b7280; font-size: 11px;">Reason: ${item.declinedReason}</span>` : ''}
            </div>
          `).join('')}
        </div>
        ` : ''}

        <table cellpadding="0" cellspacing="0" width="100%" style="margin: 16px 0;">
          <tr>
            <td style="text-align: center;">
              <a href="${healthCheckUrl}" style="display: inline-block; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; padding: 12px 24px; font-size: 14px; font-weight: bold; border-radius: 4px;">
                View Health Check
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="background-color: #f4f4f4; padding: 16px; text-align: center;">
        <p style="margin: 0; color: #666; font-size: 12px;">${branding.organizationName}</p>
      </td>
    </tr>
  </table>
</body>
</html>
`

  const text = `
Hi ${advisorName},

${customerName} has responded to the health check for ${vehicleReg} (${vehicleMakeModel}).

Summary:
- ${approvedItems.length} items approved
- ${declinedItems.length} items declined
${totalApproved > 0 ? `\nTotal Approved: £${totalApproved.toFixed(2)}` : ''}

${approvedItems.length > 0 ? `Approved Items:\n${approvedItems.map(i => `- ${i.name}: £${i.totalIncVat.toFixed(2)}${i.selectedOption ? ` (${i.selectedOption})` : ''}`).join('\n')}\n` : ''}

${declinedItems.length > 0 ? `Declined Items:\n${declinedItems.map(i => `- ${i.name}${i.declinedReason ? ` - Reason: ${i.declinedReason}` : ''}`).join('\n')}\n` : ''}

View health check: ${healthCheckUrl}

${branding.organizationName}
`

  return sendEmail({ to: advisorEmail, subject, html, text, organizationId })
}

/**
 * Send internal workflow status notification
 */
export async function sendWorkflowStatusNotification(
  recipientEmail: string,
  recipientName: string,
  vehicleReg: string,
  vehicleMakeModel: string,
  statusType: 'check_complete' | 'awaiting_customer' | 'work_authorized' | 'work_complete',
  healthCheckUrl: string,
  additionalInfo?: {
    technicianName?: string
    approvedCount?: number
    totalValue?: number
  },
  organizationId?: string
): Promise<EmailResult> {
  const branding = organizationId
    ? await getOrganizationBranding(organizationId)
    : { primaryColor: '#3B82F6', organizationName: 'Vehicle Health Check' }

  const primaryColor = branding.primaryColor || '#3B82F6'

  const statusConfig = {
    check_complete: {
      title: 'Health Check Complete',
      message: `The health check for ${vehicleReg} (${vehicleMakeModel}) has been completed by the technician.`,
      color: '#3b82f6'
    },
    awaiting_customer: {
      title: 'Awaiting Customer Response',
      message: `The health check for ${vehicleReg} (${vehicleMakeModel}) has been sent to the customer and is awaiting their response.`,
      color: '#d97706'
    },
    work_authorized: {
      title: 'Work Authorized',
      message: `Work has been authorized for ${vehicleReg} (${vehicleMakeModel}).`,
      color: '#16a34a'
    },
    work_complete: {
      title: 'Work Completed',
      message: `All authorized work for ${vehicleReg} (${vehicleMakeModel}) has been completed.`,
      color: '#7c3aed'
    }
  }

  const config = statusConfig[statusType]
  const subject = `${config.title}: ${vehicleReg}`

  const headerContent = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${branding.organizationName}" style="max-height: 40px; max-width: 160px;">`
    : `<h1 style="color: #ffffff; margin: 0; font-size: 20px;">${config.title}</h1>`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="background-color: ${config.color}; padding: 20px; text-align: center;">
        ${headerContent}
      </td>
    </tr>

    <tr>
      <td style="padding: 24px;">
        <p style="margin: 0 0 16px; color: #333; font-size: 16px;">Hi ${recipientName},</p>

        <p style="margin: 0 0 16px; color: #333; font-size: 14px;">
          ${config.message}
        </p>

        ${additionalInfo?.technicianName ? `
        <p style="margin: 0 0 16px; color: #666; font-size: 13px;">
          Technician: <strong>${additionalInfo.technicianName}</strong>
        </p>
        ` : ''}

        ${additionalInfo?.approvedCount !== undefined ? `
        <p style="margin: 0 0 16px; color: #666; font-size: 13px;">
          Approved Items: <strong>${additionalInfo.approvedCount}</strong>
          ${additionalInfo.totalValue !== undefined ? ` | Total Value: <strong>£${additionalInfo.totalValue.toFixed(2)}</strong>` : ''}
        </p>
        ` : ''}

        <table cellpadding="0" cellspacing="0" width="100%" style="margin: 16px 0;">
          <tr>
            <td style="text-align: center;">
              <a href="${healthCheckUrl}" style="display: inline-block; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; padding: 12px 24px; font-size: 14px; font-weight: bold; border-radius: 4px;">
                View Health Check
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="background-color: #f4f4f4; padding: 16px; text-align: center;">
        <p style="margin: 0; color: #666; font-size: 12px;">${branding.organizationName}</p>
      </td>
    </tr>
  </table>
</body>
</html>
`

  const text = `
Hi ${recipientName},

${config.message}
${additionalInfo?.technicianName ? `\nTechnician: ${additionalInfo.technicianName}` : ''}
${additionalInfo?.approvedCount !== undefined ? `\nApproved Items: ${additionalInfo.approvedCount}` : ''}
${additionalInfo?.totalValue !== undefined ? ` | Total Value: £${additionalInfo.totalValue.toFixed(2)}` : ''}

View health check: ${healthCheckUrl}

${branding.organizationName}
`

  return sendEmail({ to: recipientEmail, subject, html, text, organizationId })
}
