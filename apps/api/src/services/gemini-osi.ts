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
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
  // Customer address fields (Phase 1 Quick Wins)
  customerAddressLine1?: string
  customerAddressLine2?: string
  customerTown?: string
  customerCounty?: string
  customerPostcode?: string

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
  jobsheetStatus?: string

  // Phase 1 Quick Wins - Additional fields
  customerWaiting: boolean
  loanCarRequired: boolean
  isInternal: boolean
  dueDateTime?: string  // Full DueDateTime from API
  bookedRepairs: Array<{
    code?: string
    description?: string
    notes?: string
  }>

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

        // Try to get response body for debugging - Gemini returns JSON errors even with 500
        let responseBody = ''
        let geminiError: { error?: { message?: string; code?: number } } | null = null
        try {
          responseBody = await response.text()
          console.log('[Gemini] Server error response body:', responseBody.substring(0, 500))
          geminiError = JSON.parse(responseBody)
        } catch {
          // Ignore parse errors
        }

        // Check if it's actually an auth error disguised as 500
        if (geminiError?.error?.code === 3 || geminiError?.error?.message?.toLowerCase().includes('not authorised')) {
          console.log('[Gemini] Authentication error detected in 500 response')
          throw createApiError('Authentication failed - check username and password', 401, false)
        }

        logger.warn('Gemini API server error', {
          status: response.status,
          attempt,
          retryIn: delay / 1000,
          responseBody: responseBody.substring(0, 200)
        })

        if (attempt < retries) {
          await sleep(delay)
          continue
        }

        // Include response body in error message if available
        const errorDetail = geminiError?.error?.message || (responseBody ? responseBody.substring(0, 100) : '')
        throw createApiError(`Gemini API server error: ${response.status}${errorDetail ? ': ' + errorDetail : ''}`, response.status, true)
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
    // Build query string for GET request
    // Gemini API uses GET with query parameters, not POST
    // Note: Build manually to avoid URL-encoding colons in time - some APIs don't decode %3A properly
    const startTime = `${date}T00:00:00`
    const endTime = `${endDate || date}T23:59:59`
    const queryString = `StartTime=${startTime}&EndTime=${endTime}&Site=${siteId}`

    console.log('[Gemini] Query string:', queryString)

    // GET request with query parameters
    const response = await makeRequest<{
      error: {
        message: string
        code: number
      }
      result: {
        Bookings: Array<{
          BookingID: number
          DueDateTime: string
          CollectionDateTime: string
          Workshop: string
          ArrivalStatus: string
          CustomerWaiting: boolean
          LoanCar: boolean
          Internal: boolean
          Notes?: string
          Vehicle: {
            Registration: string
            ChassisNumber?: string
            Make?: string
            Model?: string
            Specification?: string
            Colour?: string
            FuelType?: string
            EngineSize?: number
            CurrentMileage?: number
          }
          InvoiceTo: {
            CustomerID: number
            Reference?: string
            Title?: string
            Forename: string
            Surname: string
            Email?: string
            Mobile?: string
            Telephone?: string
            Street1?: string
            Street2?: string
            Town?: string
            County?: string
            Postcode?: string
          }
          DeliverTo?: {
            CustomerID: number
            Reference?: string
            Title?: string
            Forename: string
            Surname: string
            Email?: string
            Mobile?: string
            Telephone?: string
          }
          Jobsheet?: {
            Number: number
            Status?: string
            Total?: number
            Repairs?: Array<{
              Code?: string
              Description?: string
              Notes?: string
            }>
          }
        }>
      }
    }>(credentials, `api/v2/workshop/get-diary-bookings?${queryString}`, {
      method: 'GET'
    })

    // Log the full raw response for debugging
    try {
      // Navigate up from src/services to project root, then to docs folder
      const docsDir = join(__dirname, '..', '..', '..', '..', 'docs')
      const outputPath = join(docsDir, 'gemini-full-response-sample.json')

      console.log('[Gemini] Saving full raw response to:', outputPath)

      // Create docs directory if it doesn't exist
      if (!existsSync(docsDir)) {
        mkdirSync(docsDir, { recursive: true })
      }

      writeFileSync(outputPath, JSON.stringify(response, null, 2), 'utf-8')
      console.log('[Gemini] Raw response saved successfully')
    } catch (saveError) {
      console.warn('[Gemini] Failed to save raw response:', saveError)
    }

    // Check for API-level errors
    if (response.error && response.error.code !== 0) {
      throw createApiError(response.error.message || 'Unknown API error', undefined, false)
    }

    // Extract bookings from result wrapper
    const rawBookings = response.result?.Bookings || []
    console.log('[Gemini] Raw bookings count:', rawBookings.length)
    if (rawBookings.length > 0) {
      console.log('[Gemini] First raw booking:', JSON.stringify(rawBookings[0], null, 2))
    }

    // Transform bookings to our format
    // Note: Gemini API field names from actual response
    const bookings: GeminiBooking[] = rawBookings.map((b) => ({
      bookingId: String(b.BookingID),
      bookingDate: b.DueDateTime?.split('T')[0] || '',
      bookingTime: b.DueDateTime?.split('T')[1]?.substring(0, 5) || '',
      promiseTime: b.CollectionDateTime?.split('T')[1]?.substring(0, 5),
      estimatedDuration: 60, // Default, not provided by API

      // Customer from InvoiceTo
      customerId: String(b.InvoiceTo?.CustomerID || b.InvoiceTo?.Reference || ''),
      customerTitle: b.InvoiceTo?.Title,
      customerFirstName: b.InvoiceTo?.Forename || '',
      customerLastName: b.InvoiceTo?.Surname || '',
      customerEmail: b.InvoiceTo?.Email || undefined,
      customerPhone: b.InvoiceTo?.Telephone,
      customerMobile: b.InvoiceTo?.Mobile,
      // Customer address fields (Phase 1 Quick Wins)
      customerAddressLine1: b.InvoiceTo?.Street1 || undefined,
      customerAddressLine2: b.InvoiceTo?.Street2 || undefined,
      customerTown: b.InvoiceTo?.Town || undefined,
      customerCounty: b.InvoiceTo?.County || undefined,
      customerPostcode: b.InvoiceTo?.Postcode || undefined,

      // Vehicle
      vehicleId: b.Vehicle?.Registration || '', // Use registration as ID since no separate ID
      vehicleReg: b.Vehicle?.Registration || '',
      vehicleVin: b.Vehicle?.ChassisNumber, // Note: Gemini uses ChassisNumber not VIN
      vehicleMake: b.Vehicle?.Make,
      vehicleModel: b.Vehicle?.Model,
      vehicleColor: b.Vehicle?.Colour,
      vehicleFuelType: b.Vehicle?.FuelType,
      vehicleMileage: b.Vehicle?.CurrentMileage,

      // Booking details
      serviceType: b.Workshop || 'service',
      description: b.Notes,
      arrivalStatus: b.ArrivalStatus,
      workshop: b.Workshop,

      // Jobsheet info
      jobsheetNumber: b.Jobsheet?.Number ? String(b.Jobsheet.Number) : undefined,
      jobsheetStatus: b.Jobsheet?.Status || undefined,

      // Phase 1 Quick Wins - Additional fields
      customerWaiting: b.CustomerWaiting || false,
      loanCarRequired: b.LoanCar || false,
      isInternal: b.Internal || false,
      dueDateTime: b.DueDateTime || undefined,
      bookedRepairs: (b.Jobsheet?.Repairs || []).map(r => ({
        code: r.Code || undefined,
        description: r.Description || undefined,
        notes: r.Notes || undefined
      })),

      status: b.ArrivalStatus || 'PENDING'
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
  console.log('[Gemini] Testing connection to:', credentials.apiUrl)
  console.log('[Gemini] Using credentials:', {
    username: credentials.username.substring(0, 3) + '***',
    passwordLength: credentials.password?.length || 0
  })

  logger.info('Testing Gemini API connection', {
    apiUrl: credentials.apiUrl
  })

  try {
    // Try to fetch today's diary as a connection test
    // This verifies the API URL and credentials are correct
    const today = new Date().toISOString().split('T')[0]

    // Build query string manually - avoid URL-encoding colons
    const queryString = `StartTime=${today}T00:00:00&EndTime=${today}T23:59:59&Site=1`

    const fullUrl = `${credentials.apiUrl.replace(/\/$/, '')}/api/v2/workshop/get-diary-bookings?${queryString}`
    console.log('[Gemini] Full request URL:', fullUrl)
    console.log('[Gemini] Method: GET with Basic Auth')

    const response = await makeRequest<{
      error: { message: string; code: number }
      result: { Bookings: unknown[] } | null
    }>(credentials, `api/v2/workshop/get-diary-bookings?${queryString}`, {
      method: 'GET',
      retries: 1
    })

    console.log('[Gemini] Response received:', {
      hasError: !!response.error,
      errorCode: response.error?.code,
      hasResult: !!response.result,
      bookingCount: response.result?.Bookings?.length
    })

    // Check for API-level errors
    if (response.error && response.error.code !== 0) {
      console.log('[Gemini] API returned error:', response.error)
      return {
        success: false,
        message: response.error.message || 'API returned error'
      }
    }

    // Count bookings from result
    const bookingCount = response.result?.Bookings?.length || 0

    console.log('[Gemini] Connection successful, bookings found:', bookingCount)
    return {
      success: true,
      message: `Connection successful - found ${bookingCount} booking(s) for today`
    }

  } catch (err) {
    const apiError = err as GeminiApiError
    console.error('[Gemini] Connection test failed:', {
      message: apiError.message,
      statusCode: apiError.statusCode,
      retryable: apiError.retryable
    })

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

// ============================================
// Customer Search
// ============================================

export interface GeminiCustomerSearchParams {
  surname?: string
  postcode?: string
  telephone?: string
  mobile?: string
  email?: string
  siteId?: number
}

export interface GeminiCustomerResult {
  customerId: string
  reference: string
  forename?: string
  surname: string
  name: string  // Full display name
  postcode?: string
  telephone?: string
  telephone2?: string
  mobile?: string
  email?: string
  email2?: string
}

export interface GeminiCustomerSearchResponse {
  success: boolean
  customers: GeminiCustomerResult[]
  error?: string
}

/**
 * Search for customers in Gemini DMS
 * Requires at least one search parameter (surname, postcode, telephone, mobile, or email)
 */
export async function searchCustomers(
  credentials: GeminiCredentials,
  params: GeminiCustomerSearchParams
): Promise<GeminiCustomerSearchResponse> {
  const { surname, postcode, telephone, mobile, email, siteId = 1 } = params

  // Validate at least one search param is provided
  if (!surname && !postcode && !telephone && !mobile && !email) {
    return {
      success: false,
      customers: [],
      error: 'At least one search parameter is required (surname, postcode, telephone, mobile, or email)'
    }
  }

  logger.info('Searching Gemini customers', {
    surname,
    postcode,
    hasPhone: !!telephone || !!mobile,
    hasEmail: !!email
  })

  try {
    // Build query string
    const queryParams = new URLSearchParams()
    queryParams.set('Site', siteId.toString())

    if (surname) queryParams.set('Surname', surname)
    if (postcode) queryParams.set('Postcode', postcode)
    if (telephone) queryParams.set('Telephone', telephone)
    if (mobile) queryParams.set('Mobile', mobile)
    if (email) queryParams.set('Email', email)

    const response = await makeRequest<{
      error: { message: string; code: number }
      result: {
        results: Array<{
          CustomerID: number
          Reference: string
          Forename?: string
          Surname: string
          Name: string
          Postcode?: string
          Telephone?: string
          Telephone2?: string
          Mobile?: string
          Email?: string
          Email2?: string
        }>
      }
    }>(credentials, `api/v2/customers/get-customer-list?${queryParams}`, {
      method: 'GET'
    })

    // Check for API-level errors
    if (response.error && response.error.code !== 0) {
      return {
        success: false,
        customers: [],
        error: response.error.message || 'Customer search failed'
      }
    }

    // Transform results
    const customers: GeminiCustomerResult[] = (response.result?.results || []).map(c => ({
      customerId: String(c.CustomerID),
      reference: c.Reference,
      forename: c.Forename || undefined,
      surname: c.Surname,
      name: c.Name,
      postcode: c.Postcode || undefined,
      telephone: c.Telephone || undefined,
      telephone2: c.Telephone2 || undefined,
      mobile: c.Mobile || undefined,
      email: c.Email || undefined,
      email2: c.Email2 || undefined
    }))

    logger.info('Customer search completed', {
      found: customers.length
    })

    return {
      success: true,
      customers
    }

  } catch (err) {
    const apiError = err as GeminiApiError

    logger.error('Customer search failed', {
      error: apiError.message,
      statusCode: apiError.statusCode
    }, apiError)

    return {
      success: false,
      customers: [],
      error: apiError.message || 'Customer search failed'
    }
  }
}
