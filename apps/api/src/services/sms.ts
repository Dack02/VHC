/**
 * SMS Service - Twilio integration for sending SMS messages
 * Supports both platform and organization-level credentials
 */

import twilio from 'twilio'
import { getSmsCredentials, SmsCredentials } from './credentials.js'
import {
  getOrganizationTemplate,
  renderSmsMessage,
  TemplateContext
} from './template-renderer.js'
import type { TemplateType } from './default-templates.js'

// Legacy: Environment-based credentials for backward compatibility
const envAccountSid = process.env.TWILIO_ACCOUNT_SID
const envAuthToken = process.env.TWILIO_AUTH_TOKEN
const envFromNumber = process.env.TWILIO_FROM_NUMBER

// Legacy client for backward compatibility
const legacyClient = envAccountSid && envAuthToken ? twilio(envAccountSid, envAuthToken) : null

export interface SmsResult {
  success: boolean
  messageId?: string
  error?: string
  source?: 'organization' | 'platform' | 'env'
}

/**
 * Create a Twilio client with specific credentials
 */
function createTwilioClient(credentials: SmsCredentials) {
  return twilio(credentials.accountSid, credentials.authToken)
}

/**
 * Send an SMS message using organization or platform credentials
 */
export async function sendSms(
  to: string,
  message: string,
  organizationId?: string
): Promise<SmsResult> {
  // If organizationId provided, use credential resolution
  if (organizationId) {
    const credResult = await getSmsCredentials(organizationId)

    if (!credResult.configured || !credResult.credentials) {
      console.log(`SMS not configured for org ${organizationId} - SMS would be sent to:`, to)
      console.log('Message:', message)
      return {
        success: false,
        error: credResult.error || 'SMS not configured',
        source: credResult.source
      }
    }

    try {
      const client = createTwilioClient(credResult.credentials)
      const formattedTo = formatPhoneNumber(to)

      const result = await client.messages.create({
        body: message,
        from: credResult.credentials.phoneNumber,
        to: formattedTo
      })

      console.log(`SMS sent successfully via ${credResult.source}:`, result.sid)
      return {
        success: true,
        messageId: result.sid,
        source: credResult.source
      }
    } catch (error) {
      console.error('SMS send error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send SMS',
        source: credResult.source
      }
    }
  }

  // Legacy: Use environment-based credentials
  if (!legacyClient || !envFromNumber) {
    console.log('Twilio not configured - SMS would be sent to:', to)
    console.log('Message:', message)
    return {
      success: true,
      messageId: 'mock-' + Date.now(),
      error: 'Twilio not configured - message logged only',
      source: 'env'
    }
  }

  try {
    const formattedTo = formatPhoneNumber(to)

    const result = await legacyClient.messages.create({
      body: message,
      from: envFromNumber,
      to: formattedTo
    })

    console.log('SMS sent successfully:', result.sid)
    return {
      success: true,
      messageId: result.sid,
      source: 'env'
    }
  } catch (error) {
    console.error('SMS send error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
      source: 'env'
    }
  }
}

/**
 * Send health check notification SMS
 */
export async function sendHealthCheckReadySms(
  to: string,
  customerName: string,
  vehicleReg: string,
  publicUrl: string,
  dealershipName: string,
  organizationId?: string,
  repairItemsCount?: number,
  quoteTotalIncVat?: number,
  vehicleMakeModel?: string
): Promise<SmsResult> {
  // Get customizable template
  const template = await getOrganizationTemplate(
    organizationId,
    'health_check_ready',
    'sms'
  )

  // Build context for template rendering
  const firstName = customerName.split(' ')[0]
  const context: TemplateContext = {
    customerName,
    customerFirstName: firstName,
    vehicleReg,
    vehicleMakeModel: vehicleMakeModel || '',
    publicUrl,
    dealershipName,
    repairItemsCount: repairItemsCount || 0,
    quoteTotalIncVat: quoteTotalIncVat || 0
  }

  // Render template with context
  const message = renderSmsMessage(template, context)

  return sendSms(to, message, organizationId)
}

/**
 * Send reminder SMS
 */
export async function sendReminderSms(
  to: string,
  customerName: string,
  vehicleReg: string,
  publicUrl: string,
  dealershipName: string,
  hoursRemaining?: number,
  organizationId?: string
): Promise<SmsResult> {
  // Use urgent template if less than 24 hours remaining
  const isUrgent = hoursRemaining && hoursRemaining <= 24
  const templateType: TemplateType = isUrgent ? 'reminder_urgent' : 'reminder'

  // Get customizable template
  const template = await getOrganizationTemplate(organizationId, templateType, 'sms')

  // Build context for template rendering
  const firstName = customerName.split(' ')[0]
  const context: TemplateContext = {
    customerName,
    customerFirstName: firstName,
    vehicleReg,
    vehicleMakeModel: '',
    publicUrl,
    dealershipName,
    hoursRemaining: hoursRemaining || 0
  }

  // Render template with context
  const message = renderSmsMessage(template, context)

  return sendSms(to, message, organizationId)
}

/**
 * Send authorization confirmation SMS
 */
export async function sendAuthorizationConfirmationSms(
  to: string,
  customerName: string,
  vehicleReg: string,
  authorizedTotal: number,
  dealershipName: string,
  organizationId?: string,
  approvedCount?: number
): Promise<SmsResult> {
  // Get customizable template
  const template = await getOrganizationTemplate(
    organizationId,
    'authorization_confirmation',
    'sms'
  )

  // Build context for template rendering
  const firstName = customerName.split(' ')[0]
  const context: TemplateContext = {
    customerName,
    customerFirstName: firstName,
    vehicleReg,
    vehicleMakeModel: '',
    publicUrl: '',
    dealershipName,
    approvedCount: approvedCount || 0,
    authorizedTotal: authorizedTotal || 0
  }

  // Render template with context
  const message = renderSmsMessage(template, context)

  return sendSms(to, message, organizationId)
}

/**
 * Send notification to advisor when customer responds (internal SMS)
 */
export async function sendCustomerResponseNotificationSms(
  to: string,
  advisorName: string,
  customerName: string,
  vehicleReg: string,
  approvedCount: number,
  declinedCount: number,
  totalApproved: number,
  organizationId?: string
): Promise<SmsResult> {
  let message = `${advisorName}: ${customerName} responded for ${vehicleReg}. `

  if (approvedCount > 0 && declinedCount > 0) {
    message += `${approvedCount} approved (£${totalApproved.toFixed(2)}), ${declinedCount} declined.`
  } else if (approvedCount > 0) {
    message += `${approvedCount} item${approvedCount > 1 ? 's' : ''} approved (£${totalApproved.toFixed(2)}).`
  } else {
    message += `${declinedCount} item${declinedCount > 1 ? 's' : ''} declined.`
  }

  return sendSms(to, message, organizationId)
}

/**
 * Test SMS with specific credentials (for testing in settings UI)
 */
export async function testSmsWithCredentials(
  credentials: SmsCredentials,
  to: string
): Promise<SmsResult> {
  try {
    const client = createTwilioClient(credentials)
    const formattedTo = formatPhoneNumber(to)

    const result = await client.messages.create({
      body: 'This is a test message from VHC Platform. If you received this, your SMS is configured correctly!',
      from: credentials.phoneNumber,
      to: formattedTo
    })

    return {
      success: true,
      messageId: result.sid
    }
  } catch (error) {
    console.error('Test SMS error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test SMS'
    }
  }
}

/**
 * Format phone number to E.164 format
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '')

  // If starts with 0, assume UK and replace with +44
  if (cleaned.startsWith('0')) {
    cleaned = '+44' + cleaned.substring(1)
  }

  // If doesn't start with +, assume UK
  if (!cleaned.startsWith('+')) {
    cleaned = '+44' + cleaned
  }

  return cleaned
}

/**
 * Check if Twilio is configured (legacy - checks env vars)
 */
export function isTwilioConfigured(): boolean {
  return !!legacyClient && !!envFromNumber
}
