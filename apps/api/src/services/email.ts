/**
 * Email Service - Resend integration for sending emails
 * Supports both platform and organization-level credentials
 */

import { Resend } from 'resend'
import { getEmailCredentials, EmailCredentials } from './credentials.js'

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
  organizationId?: string
): Promise<EmailResult> {
  const subject = `Your Vehicle Health Check is Ready - ${vehicleReg}`

  const html = `
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
      <td style="background-color: #1e40af; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Vehicle Health Check</h1>
      </td>
    </tr>

    <!-- Content -->
    <tr>
      <td style="padding: 32px 24px;">
        <p style="margin: 0 0 16px; color: #333; font-size: 16px;">Hi ${customerName},</p>

        <p style="margin: 0 0 24px; color: #333; font-size: 16px;">
          Your vehicle health check for <strong>${vehicleReg}</strong> (${vehicleMakeModel}) is now ready for your review.
        </p>

        ${customMessage ? `<p style="margin: 0 0 24px; color: #333; font-size: 16px; padding: 16px; background-color: #f8f8f8; border-left: 4px solid #1e40af;">${customMessage}</p>` : ''}

        <!-- Summary -->
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
        </table>

        <!-- CTA Button -->
        <table cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px;">
          <tr>
            <td style="text-align: center;">
              <a href="${publicUrl}" style="display: inline-block; background-color: #1e40af; color: #ffffff; text-decoration: none; padding: 16px 32px; font-size: 18px; font-weight: bold;">
                View Health Check
              </a>
            </td>
          </tr>
        </table>

        <p style="margin: 0 0 16px; color: #666; font-size: 14px;">
          Please review the findings and authorize any necessary repairs. You can approve or decline each item individually.
        </p>

        <p style="margin: 0; color: #666; font-size: 14px;">
          If you have any questions, please call us at <strong>${dealershipPhone}</strong>.
        </p>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #f4f4f4; padding: 24px; text-align: center;">
        <p style="margin: 0 0 8px; color: #666; font-size: 14px;">${dealershipName}</p>
        <p style="margin: 0; color: #999; font-size: 12px;">
          This link will expire in 72 hours. Please respond at your earliest convenience.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`

  const text = `
Hi ${customerName},

Your vehicle health check for ${vehicleReg} (${vehicleMakeModel}) is now ready for your review.

${customMessage ? `Message from the dealership: ${customMessage}\n` : ''}
Summary:
- ${redCount} Urgent items requiring immediate attention
- ${amberCount} Advisory items for your consideration
- ${greenCount} Items passed inspection

View your health check: ${publicUrl}

Please review the findings and authorize any necessary repairs.

If you have any questions, please call us at ${dealershipPhone}.

${dealershipName}
`

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
  const isUrgent = hoursRemaining && hoursRemaining <= 24
  const subject = isUrgent
    ? `Urgent: Your Health Check Link Expires Soon - ${vehicleReg}`
    : `Reminder: Your Vehicle Health Check Awaits - ${vehicleReg}`

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
      <td style="background-color: ${isUrgent ? '#dc2626' : '#ca8a04'}; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">${isUrgent ? 'Action Required' : 'Reminder'}</h1>
      </td>
    </tr>

    <tr>
      <td style="padding: 32px 24px;">
        <p style="margin: 0 0 16px; color: #333; font-size: 16px;">Hi ${customerName},</p>

        <p style="margin: 0 0 24px; color: #333; font-size: 16px;">
          ${isUrgent
            ? `Your vehicle health check for <strong>${vehicleReg}</strong> will expire in ${hoursRemaining} hours. Please review and respond before the link expires.`
            : `We noticed you haven't had a chance to review your vehicle health check for <strong>${vehicleReg}</strong> yet. Please take a moment to review the findings.`
          }
        </p>

        <table cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px;">
          <tr>
            <td style="text-align: center;">
              <a href="${publicUrl}" style="display: inline-block; background-color: ${isUrgent ? '#dc2626' : '#1e40af'}; color: #ffffff; text-decoration: none; padding: 16px 32px; font-size: 18px; font-weight: bold;">
                View Health Check Now
              </a>
            </td>
          </tr>
        </table>

        <p style="margin: 0; color: #666; font-size: 14px;">
          Questions? Call us at <strong>${dealershipPhone}</strong>.
        </p>
      </td>
    </tr>

    <tr>
      <td style="background-color: #f4f4f4; padding: 24px; text-align: center;">
        <p style="margin: 0; color: #666; font-size: 14px;">${dealershipName}</p>
      </td>
    </tr>
  </table>
</body>
</html>
`

  return sendEmail({ to, subject, html, organizationId })
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
  const subject = `Work Authorized - ${vehicleReg}`

  const itemsHtml = authorizedItems
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.title}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">£${item.price.toFixed(2)}</td>
      </tr>
    `
    )
    .join('')

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
      <td style="background-color: #16a34a; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Work Authorized</h1>
      </td>
    </tr>

    <tr>
      <td style="padding: 32px 24px;">
        <p style="margin: 0 0 16px; color: #333; font-size: 16px;">Hi ${customerName},</p>

        <p style="margin: 0 0 24px; color: #333; font-size: 16px;">
          Thank you for authorizing the following work on your vehicle <strong>${vehicleReg}</strong>:
        </p>

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

        <p style="margin: 0 0 16px; color: #333; font-size: 16px;">
          We will begin work shortly and keep you updated on progress. If you have any questions, please don't hesitate to contact us.
        </p>

        <p style="margin: 0; color: #666; font-size: 14px;">
          Call us: <strong>${dealershipPhone}</strong>
        </p>
      </td>
    </tr>

    <tr>
      <td style="background-color: #f4f4f4; padding: 24px; text-align: center;">
        <p style="margin: 0; color: #666; font-size: 14px;">${dealershipName}</p>
      </td>
    </tr>
  </table>
</body>
</html>
`

  return sendEmail({ to, subject, html, organizationId })
}

/**
 * Check if Resend is configured (legacy - checks env vars)
 */
export function isResendConfigured(): boolean {
  return !!legacyResend
}
