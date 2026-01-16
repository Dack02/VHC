/**
 * Gemini OSI DMS API Client
 *
 * Handles communication with Gemini OSI DMS system for importing
 * workshop diary bookings into VHC health checks.
 *
 * Features:
 * - Per-organization credentials (encrypted)
 * - Automatic retry with exponential backoff
 * - Rate limiting awareness
 * - Comprehensive error handling
 */

import { decrypt, isEncryptionConfigured } from '../lib/encryption.js'
import { logger } from '../lib/logger.js'
import { supabaseAdmin } from '../lib/supabase.js'

// ============================================
// Types
// ============================================

export interface GeminiCredentials {
  apiUrl: string
  username: string
  password: string
}

export interface GeminiBooking {
  bookingId: string
  bookingDate: string
  bookingTime: string
  promiseTime?: string
  estimatedDuration: number  // minutes

  // Customer (from InvoiceTo)
  customerId: string
  customerTitle?: string
  customerFirstName: string
  customerLastName: string
  customerEmail?: string
  customerPhone?: string
  customerMobile?: string

  // Vehicle
  vehicleId: string
  vehicleReg: string
  vehicleVin?: string
  vehicleMake?: string
  vehicleModel?: string
  vehicleColor?: string
  vehicleFuelType?: string
  vehicleMileage?: number

  // Booking details
  serviceType: string  // Workshop type: 'Service', 'MOT', 'Bodyshop', etc.
  description?: string
  arrivalStatus?: string  // 'Not Arrived', 'Arrived', 'In Progress', etc.
  workshop?: string  // Workshop name

  // Jobsheet info
  jobsheetNumber?: string

  // Status (derived from ArrivalStatus)
  status: string
}

export interface GeminiDiaryResponse {
  success: boolean
  date: string
  bookings: GeminiBooking[]
  totalCount: number
  error?: string
}

export interface GeminiApiError extends Error {
  statusCode?: number
  code?: string
  retryable: boolean
}

// ============================================
// Configuration
// ============================================

const DEFAULT_TIMEOUT = 30000  // 30 seconds
const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000  // 1 second

// ============================================
// Credential Resolution
// ============================================

/**
 * Get DMS credentials for an organization
 */
export async function getDmsCredentials(organizationId: string): Promise<{
  configured: boolean
  credentials: GeminiCredentials | null
  error?: string
}> {
  try {
    // Fetch organization DMS settings
    const { data: settings, error } = await supabaseAdmin
      .from('organization_dms_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    if (error || !settings) {
      return {
        configured: false,
        credentials: null,
        error: 'DMS settings not configured for this organization'
      }
    }

    if (!settings.enabled) {
      return {
        configured: false,
        credentials: null,
        error: 'DMS integration is disabled for this organization'
      }
    }

    // Check required fields
    if (!settings.api_url || !settings.username_encrypted || !settings.password_encrypted) {
      return {
        configured: false,
        credentials: null,
        error: 'DMS credentials are incomplete'
      }
    }

    // Decrypt username and password
    if (!isEncryptionConfigured()) {
      return {
        configured: false,
        credentials: null,
        error: 'Encryption not configured on server'
      }
    }

    let username: string
    let password: string
    try {
      username = decrypt(settings.username_encrypted)
      password = decrypt(settings.password_encrypted)
    } catch (decryptError) {
      logger.error('Failed to decrypt DMS credentials', { organizationId }, decryptError as Error)
      return {
        configured: false,
        credentials: null,
        error: 'Failed to decrypt DMS credentials'
      }
    }

    return {
      configured: true,
      credentials: {
        apiUrl: settings.api_url,
        username,
        password
      }
    }
  } catch (err) {
    logger.error('Error fetching DMS credentials', { organizationId }, err as Error)
    return {
      configured: false,
      credentials: null,
      error: 'Failed to fetch DMS credentials'
    }
  }
}

// ============================================
// API Client
// ============================================

/**
 * Create an error with retry information
 */
function createApiError(message: string, statusCode?: number, retryable = false): GeminiApiError {
  const error = new Error(message) as GeminiApiError
  error.name = 'GeminiApiError'
  error.statusCode = statusCode
  error.retryable = retryable
  return error
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Make an API request to Gemini OSI with retry logic
 */
async function makeRequest<T>(
  credentials: GeminiCredentials,
  endpoint: string,
  options: {
    method?: string
    body?: unknown
    timeout?: number
    retries?: number
  } = {}
): Promise<T> {
  const {
    method = 'GET',
    body,
    timeout = DEFAULT_TIMEOUT,
    retries = MAX_RETRIES
  } = options

  const url = `${credentials.apiUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`

  let lastError: GeminiApiError | null = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      // Create Basic Auth header from username:password
      const basicAuth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${basicAuth}`,
          'User-Agent': 'VHC-Platform/1.0'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_DELAY_BASE * Math.pow(2, attempt)

        logger.warn('Gemini API rate limited', {
          attempt,
          retryAfter: delay / 1000,
          endpoint
        })

        if (attempt < retries) {
          await sleep(delay)
          continue
        }

        throw createApiError('Rate limited by Gemini API', 429, true)
      }

      // Handle server errors (retryable)
      if (response.status >= 500) {
        const delay = RETRY_DELAY_BASE * Math.pow(2, attempt - 1)

        logger.warn('Gemini API server error', {
          status: response.status,
          attempt,
          retryIn: delay / 1000
        })

        if (attempt < retries) {
          await sleep(delay)
          continue
        }

        throw createApiError(`Gemini API server error: ${response.status}`, response.status, true)
      }

      // Handle client errors (not retryable)
      if (response.status >= 400) {
        let errorMessage = `Gemini API error: ${response.status}`
        try {
          const errorBody = await response.json()
          errorMessage = errorBody.error || errorBody.message || errorMessage
        } catch {
          // Ignore JSON parse errors
        }

        throw createApiError(errorMessage, response.status, false)
      }

      // Parse successful response
      const data = await response.json()
      return data as T

    } catch (err) {
      // Handle abort (timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = createApiError('Request timed out', undefined, true)

        if (attempt < retries) {
          logger.warn('Gemini API request timeout, retrying', { attempt, endpoint })
          await sleep(RETRY_DELAY_BASE * attempt)
          continue
        }
      }

      // Handle network errors
      if (err instanceof TypeError && err.message.includes('fetch')) {
        lastError = createApiError('Network error connecting to Gemini API', undefined, true)

        if (attempt < retries) {
          logger.warn('Gemini API network error, retrying', { attempt, endpoint })
          await sleep(RETRY_DELAY_BASE * attempt)
          continue
        }
      }

      // Handle API errors
      if ((err as GeminiApiError).retryable !== undefined) {
        lastError = err as GeminiApiError
        if (!lastError.retryable || attempt >= retries) {
          throw lastError
        }
        continue
      }

      // Unknown error
      throw err
    }
  }

  throw lastError || createApiError('Request failed after all retries', undefined, false)
}

// ============================================
// Public API Methods
// ============================================

/**
 * Fetch diary bookings for a specific date
 */
export async function fetchDiaryBookings(
  credentials: GeminiCredentials,
  date: string,  // YYYY-MM-DD format
  options: {
    siteId?: number
    endDate?: string  // Optional end date, defaults to same as date
  } = {}
): Promise<GeminiDiaryResponse> {
  const { siteId = 1, endDate } = options

  logger.info('Fetching Gemini diary bookings', {
    from: date,
    to: endDate || date,
    siteId
  })

  try {
    // POST request with JSON body
    const response = await makeRequest<{
      // Gemini API response structure - array of bookings
      [index: number]: {
        Id: number
        BookingDate: string
        TimeBooked: string
        PromiseTime: string
        ArrivalStatus: string
        Workshop: string
        Vehicle: {
          Id: number
          Registration: string
          VIN?: string
          Make?: string
          Model?: string
          Colour?: string
          FuelType?: string
          CurrentMileage?: number
        }
        InvoiceTo: {
          Id: number
          Title?: string
          Forename: string
          Surname: string
          Email?: string
          Mobile?: string
          Telephone?: string
          Address1?: string
          Address2?: string
          Address3?: string
          Postcode?: string
        }
        DeliverTo?: {
          Id: number
          Title?: string
          Forename: string
          Surname: string
          Email?: string
          Mobile?: string
          Telephone?: string
        }
        Jobsheets?: Array<{
          Id: number
          JobsheetNumber: string
          Description?: string
          Status?: string
        }>
      }
    }>(credentials, 'api/v2/workshop/get-diary-bookings', {
      method: 'POST',
      body: {
        from: date,
        to: endDate || date,
        siteId
      }
    })

    // Gemini API returns an array directly (or object with numeric keys)
    // Convert to array if needed
    const responseArray = Array.isArray(response)
      ? response
      : Object.values(response).filter(item => typeof item === 'object' && item !== null)

    // Transform bookings to our format
    const bookings: GeminiBooking[] = responseArray.map((b: any) => ({
      bookingId: String(b.Id),
      bookingDate: b.BookingDate,
      bookingTime: b.TimeBooked,
      promiseTime: b.PromiseTime,
      estimatedDuration: 60, // Default, not provided by API

      // Customer from InvoiceTo
      customerId: String(b.InvoiceTo?.Id || ''),
      customerTitle: b.InvoiceTo?.Title,
      customerFirstName: b.InvoiceTo?.Forename || '',
      customerLastName: b.InvoiceTo?.Surname || '',
      customerEmail: b.InvoiceTo?.Email,
      customerPhone: b.InvoiceTo?.Telephone,
      customerMobile: b.InvoiceTo?.Mobile,

      // Vehicle
      vehicleId: String(b.Vehicle?.Id || ''),
      vehicleReg: b.Vehicle?.Registration || '',
      vehicleVin: b.Vehicle?.VIN,
      vehicleMake: b.Vehicle?.Make,
      vehicleModel: b.Vehicle?.Model,
      vehicleColor: b.Vehicle?.Colour,
      vehicleFuelType: b.Vehicle?.FuelType,
      vehicleMileage: b.Vehicle?.CurrentMileage,

      // Booking details
      serviceType: b.Workshop || 'service',
      description: b.Jobsheets?.[0]?.Description,
      arrivalStatus: b.ArrivalStatus,
      workshop: b.Workshop,

      // Jobsheet info
      jobsheetNumber: b.Jobsheets?.[0]?.JobsheetNumber,
      status: b.ArrivalStatus || 'booked'
    }))

    logger.info('Successfully fetched Gemini diary bookings', {
      date,
      totalFound: bookings.length
    })

    return {
      success: true,
      date,
      bookings,
      totalCount: bookings.length
    }

  } catch (err) {
    const apiError = err as GeminiApiError

    logger.error('Failed to fetch Gemini diary bookings', {
      date,
      statusCode: apiError.statusCode
    }, apiError)

    return {
      success: false,
      date,
      bookings: [],
      totalCount: 0,
      error: apiError.message
    }
  }
}

/**
 * Test connection to Gemini API
 * Tries a simple authenticated request to verify credentials
 */
export async function testConnection(credentials: GeminiCredentials): Promise<{
  success: boolean
  message: string
  dealerName?: string
}> {
  logger.info('Testing Gemini API connection', {
        apiUrl: credentials.apiUrl
  })

  try {
    // Try to fetch today's diary as a connection test
    // This verifies the API URL and credentials are correct
    const today = new Date().toISOString().split('T')[0]

    const response = await makeRequest<unknown>(credentials, 'api/v2/workshop/get-diary-bookings', {
      method: 'POST',
      body: {
        from: today,
        to: today,
        siteId: 1
      },
      retries: 1
    })

    // Gemini API returns an array of bookings on success
    // Any response without an error is considered successful
    if (response !== null && response !== undefined) {
      const bookingCount = Array.isArray(response)
        ? response.length
        : Object.keys(response as object).length

      return {
        success: true,
        message: `Connection successful - found ${bookingCount} booking(s) for today`
      }
    }

    return {
      success: false,
      message: 'API returned empty response'
    }

  } catch (err) {
    const apiError = err as GeminiApiError
    logger.error('Gemini connection test failed', {
            apiUrl: credentials.apiUrl,
      error: apiError.message,
      statusCode: apiError.statusCode
    })

    // Provide more helpful error messages
    if (apiError.statusCode === 401) {
      return {
        success: false,
        message: 'Authentication failed - check username and password'
      }
    }
    if (apiError.statusCode === 403) {
      return {
        success: false,
        message: 'Access denied - check permissions'
      }
    }
    if (apiError.statusCode === 404) {
      return {
        success: false,
        message: 'API endpoint not found - check the API URL'
      }
    }
    if (apiError.message?.includes('fetch') || apiError.message?.includes('Network')) {
      return {
        success: false,
        message: 'Cannot reach server - check the API URL is correct'
      }
    }

    return {
      success: false,
      message: apiError.message || 'Connection failed'
    }
  }
}

/**
 * Check if DMS integration is available for an organization
 */
export async function isDmsAvailable(organizationId: string): Promise<boolean> {
  const { configured } = await getDmsCredentials(organizationId)
  return configured
}
