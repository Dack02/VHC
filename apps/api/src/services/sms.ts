/**
 * SMS Service - Twilio integration for sending SMS messages
 * Supports both platform and organization-level credentials
 */

import twilio from 'twilio'
import { getSmsCredentials, SmsCredentials } from './credentials.js'

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
  organizationId?: string
): Promise<SmsResult> {
  const message = `Hi ${customerName}, your vehicle health check for ${vehicleReg} is ready. Please review and authorize any work: ${publicUrl} - ${dealershipName}`

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
  _dealershipName: string,
  hoursRemaining?: number,
  organizationId?: string
): Promise<SmsResult> {
  let message = `Hi ${customerName}, reminder: Your health check for ${vehicleReg} is awaiting your response. View it here: ${publicUrl}`

  if (hoursRemaining && hoursRemaining <= 24) {
    message = `Hi ${customerName}, urgent: Your health check for ${vehicleReg} expires in ${hoursRemaining} hours. Please respond: ${publicUrl}`
  }

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
  organizationId?: string
): Promise<SmsResult> {
  const message = `Thank you ${customerName}! You've authorized £${authorizedTotal.toFixed(2)} of work on ${vehicleReg}. ${dealershipName} will be in touch shortly.`

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
function formatPhoneNumber(phone: string): string {
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
