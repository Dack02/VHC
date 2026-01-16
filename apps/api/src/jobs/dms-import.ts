/**
 * DMS Import Job
 *
 * Handles importing bookings from DMS (Gemini OSI) into VHC health checks.
 * Designed for multi-tenant operation - runs per-organization.
 *
 * Features:
 * - Per-organization import with encrypted credentials
 * - Automatic customer/vehicle creation or matching
 * - Duplicate detection via external_id
 * - Import history tracking
 * - Usage tracking for billing
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import {
  getDmsCredentials,
  fetchDiaryBookings,
  GeminiBooking
} from '../services/gemini-osi.js'

// ============================================
// Types
// ============================================

export interface ImportOptions {
  organizationId: string
  siteId?: string
  date: string  // YYYY-MM-DD
  importType: 'manual' | 'scheduled' | 'test'
  triggeredBy?: string  // user ID
}

export interface ImportResult {
  success: boolean
  importId: string
  bookingsFound: number
  bookingsImported: number
  bookingsSkipped: number
  bookingsFailed: number
  customersCreated: number
  vehiclesCreated: number
  healthChecksCreated: number
  errors: Array<{ bookingId: string; error: string }>
}

// ============================================
// Helper Functions
// ============================================

/**
 * Find or create a customer record
 */
async function findOrCreateCustomer(
  organizationId: string,
  booking: GeminiBooking,
  externalSource: string
): Promise<{ customerId: string; created: boolean }> {
  // First, try to find by external_id
  const { data: existingByExternal } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('external_source', externalSource)
    .eq('external_id', booking.customerId)
    .single()

  if (existingByExternal) {
    return { customerId: existingByExternal.id, created: false }
  }

  // Try to find by email (if available)
  if (booking.customerEmail) {
    const { data: existingByEmail } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('email', booking.customerEmail.toLowerCase())
      .single()

    if (existingByEmail) {
      // Update with external_id for future matches
      await supabaseAdmin
        .from('customers')
        .update({
          external_id: booking.customerId,
          external_source: externalSource
        })
        .eq('id', existingByEmail.id)

      return { customerId: existingByEmail.id, created: false }
    }
  }

  // Try to find by mobile (if available)
  if (booking.customerMobile) {
    const normalizedMobile = booking.customerMobile.replace(/\s+/g, '')
    const { data: existingByMobile } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('mobile', normalizedMobile)
      .single()

    if (existingByMobile) {
      // Update with external_id
      await supabaseAdmin
        .from('customers')
        .update({
          external_id: booking.customerId,
          external_source: externalSource
        })
        .eq('id', existingByMobile.id)

      return { customerId: existingByMobile.id, created: false }
    }
  }

  // Create new customer
  const { data: newCustomer, error } = await supabaseAdmin
    .from('customers')
    .insert({
      organization_id: organizationId,
      first_name: booking.customerFirstName,
      last_name: booking.customerLastName,
      email: booking.customerEmail?.toLowerCase() || null,
      mobile: booking.customerMobile?.replace(/\s+/g, '') || booking.customerPhone || null,
      external_id: booking.customerId,
      external_source: externalSource
    })
    .select('id')
    .single()

  if (error || !newCustomer) {
    throw new Error(`Failed to create customer: ${error?.message}`)
  }

  return { customerId: newCustomer.id, created: true }
}

/**
 * Find or create a vehicle record
 */
async function findOrCreateVehicle(
  organizationId: string,
  customerId: string,
  booking: GeminiBooking,
  externalSource: string
): Promise<{ vehicleId: string; created: boolean }> {
  // First, try to find by external_id
  const { data: existingByExternal } = await supabaseAdmin
    .from('vehicles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('external_source', externalSource)
    .eq('external_id', booking.vehicleId)
    .single()

  if (existingByExternal) {
    return { vehicleId: existingByExternal.id, created: false }
  }

  // Try to find by registration
  const normalizedReg = booking.vehicleReg.replace(/\s+/g, '').toUpperCase()
  const { data: existingByReg } = await supabaseAdmin
    .from('vehicles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('registration', normalizedReg)
    .single()

  if (existingByReg) {
    // Update with external_id and any missing data
    await supabaseAdmin
      .from('vehicles')
      .update({
        external_id: booking.vehicleId,
        external_source: externalSource,
        customer_id: customerId,
        // Update fields if they were missing
        vin: booking.vehicleVin || undefined,
        make: booking.vehicleMake || undefined,
        model: booking.vehicleModel || undefined,
        year: booking.vehicleYear || undefined,
        color: booking.vehicleColor || undefined,
        fuel_type: booking.vehicleFuelType || undefined,
        mileage: booking.vehicleMileage || undefined
      })
      .eq('id', existingByReg.id)

    return { vehicleId: existingByReg.id, created: false }
  }

  // Try to find by VIN (if available)
  if (booking.vehicleVin) {
    const { data: existingByVin } = await supabaseAdmin
      .from('vehicles')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('vin', booking.vehicleVin.toUpperCase())
      .single()

    if (existingByVin) {
      // Update with external_id
      await supabaseAdmin
        .from('vehicles')
        .update({
          external_id: booking.vehicleId,
          external_source: externalSource,
          customer_id: customerId,
          registration: normalizedReg
        })
        .eq('id', existingByVin.id)

      return { vehicleId: existingByVin.id, created: false }
    }
  }

  // Create new vehicle
  const { data: newVehicle, error } = await supabaseAdmin
    .from('vehicles')
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      registration: normalizedReg,
      vin: booking.vehicleVin?.toUpperCase() || null,
      make: booking.vehicleMake || null,
      model: booking.vehicleModel || null,
      year: booking.vehicleYear || null,
      color: booking.vehicleColor || null,
      fuel_type: booking.vehicleFuelType || null,
      mileage: booking.vehicleMileage || null,
      external_id: booking.vehicleId,
      external_source: externalSource
    })
    .select('id')
    .single()

  if (error || !newVehicle) {
    throw new Error(`Failed to create vehicle: ${error?.message}`)
  }

  return { vehicleId: newVehicle.id, created: true }
}

/**
 * Check if health check already exists for this booking
 */
async function healthCheckExists(
  organizationId: string,
  externalSource: string,
  externalId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('health_checks')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('external_source', externalSource)
    .eq('external_id', externalId)
    .is('deleted_at', null)
    .single()

  return !!data
}

/**
 * Create a health check from a booking
 */
async function createHealthCheck(
  organizationId: string,
  siteId: string | null,
  customerId: string,
  vehicleId: string,
  booking: GeminiBooking,
  templateId: string,
  importBatchId: string,
  externalSource: string
): Promise<string> {
  // Parse promise time from booking
  let promiseTime: string | null = null
  if (booking.bookingDate && booking.bookingTime) {
    try {
      promiseTime = new Date(`${booking.bookingDate}T${booking.bookingTime}`).toISOString()
    } catch {
      // Ignore invalid dates
    }
  }

  const { data, error } = await supabaseAdmin
    .from('health_checks')
    .insert({
      organization_id: organizationId,
      site_id: siteId,
      customer_id: customerId,
      vehicle_id: vehicleId,
      template_id: templateId,
      status: 'created',
      mileage_in: booking.vehicleMileage || null,
      promise_time: promiseTime,
      notes: booking.description || null,
      external_id: booking.bookingId,
      external_source: externalSource,
      import_batch_id: importBatchId
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create health check: ${error?.message}`)
  }

  return data.id
}

// ============================================
// Main Import Function
// ============================================

/**
 * Run DMS import for an organization
 */
export async function runDmsImport(options: ImportOptions): Promise<ImportResult> {
  const {
    organizationId,
    siteId,
    date,
    importType,
    triggeredBy
  } = options

  const logContext = { organizationId, date, importType }
  logger.info('Starting DMS import', logContext)

  // Initialize result
  const result: ImportResult = {
    success: false,
    importId: '',
    bookingsFound: 0,
    bookingsImported: 0,
    bookingsSkipped: 0,
    bookingsFailed: 0,
    customersCreated: 0,
    vehiclesCreated: 0,
    healthChecksCreated: 0,
    errors: []
  }

  // Create import history record
  const { data: importRecord, error: createError } = await supabaseAdmin
    .from('dms_import_history')
    .insert({
      organization_id: organizationId,
      site_id: siteId || null,
      import_type: importType,
      import_date: date,
      status: 'running',
      triggered_by: triggeredBy || null
    })
    .select('id')
    .single()

  if (createError || !importRecord) {
    logger.error('Failed to create import record', logContext, createError as Error)
    result.errors.push({ bookingId: 'system', error: 'Failed to create import record' })
    return result
  }

  result.importId = importRecord.id

  try {
    // Get DMS credentials
    const { configured, credentials, error: credError } = await getDmsCredentials(organizationId)

    if (!configured || !credentials) {
      throw new Error(credError || 'DMS credentials not configured')
    }

    // Get DMS settings for template and filters
    const { data: dmsSettings } = await supabaseAdmin
      .from('organization_dms_settings')
      .select('default_template_id, import_service_types')
      .eq('organization_id', organizationId)
      .single()

    // Get default template if not specified
    let templateId = dmsSettings?.default_template_id

    if (!templateId) {
      // Get first active template for org
      const { data: defaultTemplate } = await supabaseAdmin
        .from('check_templates')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (!defaultTemplate) {
        throw new Error('No active template found for organization')
      }
      templateId = defaultTemplate.id
    }

    // Fetch bookings from DMS
    const serviceTypes = dmsSettings?.import_service_types as string[] | undefined
    const diaryResponse = await fetchDiaryBookings(credentials, date, {
      siteId,
      serviceTypes
    })

    if (!diaryResponse.success) {
      throw new Error(diaryResponse.error || 'Failed to fetch bookings from DMS')
    }

    result.bookingsFound = diaryResponse.bookings.length

    // Process each booking
    const externalSource = 'gemini_osi'

    for (const booking of diaryResponse.bookings) {
      try {
        // Skip cancelled/completed bookings
        if (['cancelled', 'completed'].includes(booking.status.toLowerCase())) {
          result.bookingsSkipped++
          continue
        }

        // Check if already imported
        const exists = await healthCheckExists(organizationId, externalSource, booking.bookingId)
        if (exists) {
          result.bookingsSkipped++
          continue
        }

        // Find or create customer
        const customerResult = await findOrCreateCustomer(organizationId, booking, externalSource)
        if (customerResult.created) {
          result.customersCreated++
        }

        // Find or create vehicle
        const vehicleResult = await findOrCreateVehicle(
          organizationId,
          customerResult.customerId,
          booking,
          externalSource
        )
        if (vehicleResult.created) {
          result.vehiclesCreated++
        }

        // Create health check
        await createHealthCheck(
          organizationId,
          siteId || null,
          customerResult.customerId,
          vehicleResult.vehicleId,
          booking,
          templateId,
          result.importId,
          externalSource
        )

        result.bookingsImported++
        result.healthChecksCreated++

      } catch (bookingError) {
        result.bookingsFailed++
        result.errors.push({
          bookingId: booking.bookingId,
          error: bookingError instanceof Error ? bookingError.message : 'Unknown error'
        })
        logger.error('Failed to import booking', {
          ...logContext,
          bookingId: booking.bookingId
        }, bookingError as Error)
      }
    }

    // Update import record with results
    await supabaseAdmin
      .from('dms_import_history')
      .update({
        status: result.bookingsFailed > 0 ? 'partial' : 'completed',
        completed_at: new Date().toISOString(),
        bookings_found: result.bookingsFound,
        bookings_imported: result.bookingsImported,
        bookings_skipped: result.bookingsSkipped,
        bookings_failed: result.bookingsFailed,
        customers_created: result.customersCreated,
        vehicles_created: result.vehiclesCreated,
        health_checks_created: result.healthChecksCreated,
        errors: result.errors
      })
      .eq('id', result.importId)

    // Update DMS settings with last import info
    await supabaseAdmin
      .from('organization_dms_settings')
      .update({
        last_import_at: new Date().toISOString(),
        last_import_status: result.bookingsFailed > 0 ? 'partial' : 'completed',
        last_error: result.errors.length > 0 ? result.errors[0].error : null
      })
      .eq('organization_id', organizationId)

    // Update organization usage
    const currentDate = new Date()
    const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      .toISOString().split('T')[0]

    await supabaseAdmin.rpc('increment_usage', {
      p_organization_id: organizationId,
      p_period_start: periodStart,
      p_dms_imports: 1,
      p_dms_bookings_imported: result.bookingsImported
    }).catch(() => {
      // RPC may not exist, that's okay
    })

    result.success = true
    logger.info('DMS import completed', {
      ...logContext,
      imported: result.bookingsImported,
      skipped: result.bookingsSkipped,
      failed: result.bookingsFailed
    })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    // Update import record with failure
    await supabaseAdmin
      .from('dms_import_history')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        errors: [{ bookingId: 'system', error: errorMessage }]
      })
      .eq('id', result.importId)

    // Update DMS settings with error
    await supabaseAdmin
      .from('organization_dms_settings')
      .update({
        last_import_at: new Date().toISOString(),
        last_import_status: 'failed',
        last_error: errorMessage
      })
      .eq('organization_id', organizationId)

    result.errors.push({ bookingId: 'system', error: errorMessage })
    logger.error('DMS import failed', logContext, err as Error)
  }

  return result
}

export default runDmsImport
