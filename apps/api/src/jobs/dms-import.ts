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
  endDate?: string  // YYYY-MM-DD — fetch bookings up to this date (inclusive)
  importType: 'manual' | 'scheduled' | 'test'
  triggeredBy?: string  // user ID
  bookingIds?: string[]  // selective import - only import these booking IDs
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
  console.log('[DMS Import] findOrCreateCustomer called with:', {
    organizationId,
    customerId: booking.customerId,
    firstName: booking.customerFirstName,
    lastName: booking.customerLastName,
    email: booking.customerEmail,
    mobile: booking.customerMobile
  })

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
      // Update with external_id and address fields (Phase 1 Quick Wins)
      await supabaseAdmin
        .from('customers')
        .update({
          external_id: booking.customerId,
          external_source: externalSource,
          // Update address fields if not already set
          title: booking.customerTitle || undefined,
          address_line1: booking.customerAddressLine1 || undefined,
          address_line2: booking.customerAddressLine2 || undefined,
          town: booking.customerTown || undefined,
          county: booking.customerCounty || undefined,
          postcode: booking.customerPostcode || undefined
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
      // Update with external_id and address fields (Phase 1 Quick Wins)
      await supabaseAdmin
        .from('customers')
        .update({
          external_id: booking.customerId,
          external_source: externalSource,
          // Update address fields if not already set
          title: booking.customerTitle || undefined,
          address_line1: booking.customerAddressLine1 || undefined,
          address_line2: booking.customerAddressLine2 || undefined,
          town: booking.customerTown || undefined,
          county: booking.customerCounty || undefined,
          postcode: booking.customerPostcode || undefined
        })
        .eq('id', existingByMobile.id)

      return { customerId: existingByMobile.id, created: false }
    }
  }

  // Create new customer with address fields (Phase 1 Quick Wins)
  const { data: newCustomer, error } = await supabaseAdmin
    .from('customers')
    .insert({
      organization_id: organizationId,
      first_name: booking.customerFirstName,
      last_name: booking.customerLastName,
      email: booking.customerEmail?.toLowerCase() || null,
      mobile: booking.customerMobile?.replace(/\s+/g, '') || booking.customerPhone || null,
      // Address fields (Phase 1 Quick Wins)
      title: booking.customerTitle || null,
      address_line1: booking.customerAddressLine1 || null,
      address_line2: booking.customerAddressLine2 || null,
      town: booking.customerTown || null,
      county: booking.customerCounty || null,
      postcode: booking.customerPostcode || null,
      external_id: booking.customerId,
      external_source: externalSource
    })
    .select('id')
    .single()

  if (error || !newCustomer) {
    console.error('[DMS Import] Failed to create customer:', error)
    throw new Error(`Failed to create customer: ${error?.message}`)
  }

  console.log('[DMS Import] Created new customer:', newCustomer.id)
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
  console.log('[DMS Import] findOrCreateVehicle called with:', {
    organizationId,
    customerId,
    vehicleId: booking.vehicleId,
    vehicleReg: booking.vehicleReg,
    vehicleVin: booking.vehicleVin,
    vehicleMake: booking.vehicleMake,
    vehicleModel: booking.vehicleModel
  })

  // Validate required fields
  if (!booking.vehicleReg) {
    console.error('[DMS Import] Missing vehicleReg in booking - cannot create vehicle')
    throw new Error('Vehicle registration is required')
  }

  // First, try to find by external_id
  const { data: existingByExternal, error: externalError } = await supabaseAdmin
    .from('vehicles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('external_source', externalSource)
    .eq('external_id', booking.vehicleId)
    .single()

  console.log('[DMS Import] Search by external_id result:', { found: !!existingByExternal, error: externalError?.message })

  if (existingByExternal) {
    console.log('[DMS Import] Found existing vehicle by external_id:', existingByExternal.id)
    return { vehicleId: existingByExternal.id, created: false }
  }

  // Try to find by registration
  const normalizedReg = booking.vehicleReg.replace(/\s+/g, '').toUpperCase()
  console.log('[DMS Import] Normalized registration:', normalizedReg)
  const { data: existingByReg, error: regError } = await supabaseAdmin
    .from('vehicles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('registration', normalizedReg)
    .single()

  console.log('[DMS Import] Search by registration result:', { found: !!existingByReg, error: regError?.message })

  if (existingByReg) {
    console.log('[DMS Import] Found existing vehicle by registration:', existingByReg.id)
    // Update with external_id and any missing data
    const { error: updateError } = await supabaseAdmin
      .from('vehicles')
      .update({
        external_id: booking.vehicleId,
        external_source: externalSource,
        customer_id: customerId,
        // Update fields if they were missing
        vin: booking.vehicleVin || undefined,
        make: booking.vehicleMake || undefined,
        model: booking.vehicleModel || undefined,
        // year is not available from Gemini booking
        color: booking.vehicleColor || undefined,
        fuel_type: booking.vehicleFuelType || undefined,
        mileage: booking.vehicleMileage || undefined
      })
      .eq('id', existingByReg.id)

    if (updateError) {
      console.warn('[DMS Import] Failed to update existing vehicle:', updateError)
    }

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
  console.log('[DMS Import] Creating new vehicle with data:', {
    organization_id: organizationId,
    customer_id: customerId,
    registration: normalizedReg,
    vin: booking.vehicleVin?.toUpperCase() || null,
    make: booking.vehicleMake || null,
    model: booking.vehicleModel || null,
    external_id: booking.vehicleId,
    external_source: externalSource
  })

  const { data: newVehicle, error } = await supabaseAdmin
    .from('vehicles')
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      registration: normalizedReg,
      vin: booking.vehicleVin?.toUpperCase() || null,
      make: booking.vehicleMake || null,
      model: booking.vehicleModel || null,
      year: null,  // not available from Gemini booking
      color: booking.vehicleColor || null,
      fuel_type: booking.vehicleFuelType || null,
      mileage: booking.vehicleMileage || null,
      external_id: booking.vehicleId,
      external_source: externalSource
    })
    .select('id')
    .single()

  if (error || !newVehicle) {
    console.error('[DMS Import] Failed to create vehicle:', error)
    throw new Error(`Failed to create vehicle: ${error?.message}`)
  }

  console.log('[DMS Import] Created new vehicle:', newVehicle.id)
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
  console.log('[DMS Import] createHealthCheck called with:', {
    organizationId,
    siteId,
    customerId,
    vehicleId,
    templateId,
    importBatchId,
    bookingId: booking.bookingId
  })

  // Parse promise time from booking
  let promiseTime: string | null = null
  if (booking.bookingDate && booking.bookingTime) {
    try {
      promiseTime = new Date(`${booking.bookingDate}T${booking.bookingTime}`).toISOString()
      console.log('[DMS Import] Parsed promise time:', promiseTime)
    } catch (e) {
      console.warn('[DMS Import] Failed to parse promise time:', e)
    }
  }

  // Parse due_date from booking
  let dueDate: string | null = null
  if (booking.dueDateTime) {
    try {
      dueDate = new Date(booking.dueDateTime).toISOString()
    } catch (e) {
      console.warn('[DMS Import] Failed to parse due date:', e)
    }
  }

  const insertData = {
    organization_id: organizationId,
    site_id: siteId,
    customer_id: customerId,
    vehicle_id: vehicleId,
    template_id: templateId,
    status: 'awaiting_arrival',  // DMS imports start in awaiting_arrival status
    mileage_in: booking.vehicleMileage || null,
    promise_time: promiseTime,
    notes: booking.description || null,
    external_id: booking.bookingId,
    external_source: externalSource,
    import_batch_id: importBatchId,
    // Phase 1 Quick Wins - Additional fields
    customer_waiting: booking.customerWaiting || false,
    loan_car_required: booking.loanCarRequired || false,
    is_internal: booking.isInternal || false,
    due_date: dueDate,
    booked_date: new Date().toISOString(), // Record when booking was imported
    jobsheet_number: booking.jobsheetNumber || null,
    jobsheet_status: booking.jobsheetStatus || null,
    booked_repairs: booking.bookedRepairs && booking.bookedRepairs.length > 0
      ? booking.bookedRepairs
      : []
  }
  console.log('[DMS Import] Creating health check with data:', insertData)

  const { data, error } = await supabaseAdmin
    .from('health_checks')
    .insert(insertData)
    .select('id')
    .single()

  if (error || !data) {
    console.error('[DMS Import] Failed to create health check:', error)
    throw new Error(`Failed to create health check: ${error?.message}`)
  }

  console.log('[DMS Import] Created health check:', data.id)
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
    triggeredBy,
    bookingIds
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

    // Get default site if not provided
    let effectiveSiteId: string | null = siteId ?? null
    if (!effectiveSiteId) {
      const { data: defaultSite } = await supabaseAdmin
        .from('sites')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (!defaultSite) {
        throw new Error('No site found for organization')
      }
      effectiveSiteId = defaultSite.id
      console.log('[DMS Import] Using default site:', effectiveSiteId)
    }

    // Fetch bookings from DMS
    // Note: serviceTypes filtering is not yet supported by fetchDiaryBookings
    const diaryResponse = await fetchDiaryBookings(credentials, date, {
      endDate: options.endDate
    })

    if (!diaryResponse.success) {
      throw new Error(diaryResponse.error || 'Failed to fetch bookings from DMS')
    }

    result.bookingsFound = diaryResponse.bookings.length
    console.log('[DMS Import] Bookings found:', result.bookingsFound)

    // Process each booking
    const externalSource = 'gemini_osi'

    for (let i = 0; i < diaryResponse.bookings.length; i++) {
      const booking = diaryResponse.bookings[i]
      console.log(`\n[DMS Import] ========== Processing booking ${i + 1}/${diaryResponse.bookings.length} ==========`)
      console.log('[DMS Import] Booking raw data:', JSON.stringify(booking, null, 2))

      try {
        // If selective import, skip bookings not in the list
        if (bookingIds && bookingIds.length > 0 && !bookingIds.includes(booking.bookingId)) {
          result.bookingsSkipped++
          continue
        }

        // Skip cancelled/completed bookings
        if (['cancelled', 'completed'].includes(booking.status.toLowerCase())) {
          console.log('[DMS Import] Skipping - status is:', booking.status)
          result.bookingsSkipped++
          continue
        }

        // Check if already imported
        const exists = await healthCheckExists(organizationId, externalSource, booking.bookingId)
        if (exists) {
          console.log('[DMS Import] Skipping - already imported')
          result.bookingsSkipped++
          continue
        }

        console.log('[DMS Import] Step 1: Finding or creating customer...')
        // Find or create customer
        const customerResult = await findOrCreateCustomer(organizationId, booking, externalSource)
        console.log('[DMS Import] Customer result:', customerResult)
        if (customerResult.created) {
          result.customersCreated++
        }

        console.log('[DMS Import] Step 2: Finding or creating vehicle...')
        // Find or create vehicle
        const vehicleResult = await findOrCreateVehicle(
          organizationId,
          customerResult.customerId,
          booking,
          externalSource
        )
        console.log('[DMS Import] Vehicle result:', vehicleResult)
        if (vehicleResult.created) {
          result.vehiclesCreated++
        }

        console.log('[DMS Import] Step 3: Creating health check...')
        // Create health check
        const healthCheckId = await createHealthCheck(
          organizationId,
          effectiveSiteId,
          customerResult.customerId,
          vehicleResult.vehicleId,
          booking,
          templateId,
          result.importId,
          externalSource
        )
        console.log('[DMS Import] Health check created:', healthCheckId)

        result.bookingsImported++
        result.healthChecksCreated++
        console.log('[DMS Import] Booking imported successfully!')

      } catch (bookingError) {
        result.bookingsFailed++
        const errorMessage = bookingError instanceof Error ? bookingError.message : 'Unknown error'
        console.error('[DMS Import] FAILED to import booking:', errorMessage)
        console.error('[DMS Import] Full error:', bookingError)
        result.errors.push({
          bookingId: booking.bookingId,
          error: errorMessage
        })
        logger.error('Failed to import booking', {
          ...logContext,
          bookingId: booking.bookingId
        }, bookingError as Error)
      }
    }

    console.log('\n[DMS Import] ========== Import Summary ==========')
    console.log('[DMS Import] Bookings found:', result.bookingsFound)
    console.log('[DMS Import] Bookings imported:', result.bookingsImported)
    console.log('[DMS Import] Bookings skipped:', result.bookingsSkipped)
    console.log('[DMS Import] Bookings failed:', result.bookingsFailed)
    console.log('[DMS Import] Customers created:', result.customersCreated)
    console.log('[DMS Import] Vehicles created:', result.vehiclesCreated)
    console.log('[DMS Import] Health checks created:', result.healthChecksCreated)

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

    // Update DMS settings with last import info and sync timestamp
    await supabaseAdmin
      .from('organization_dms_settings')
      .update({
        last_import_at: new Date().toISOString(),
        last_import_status: result.bookingsFailed > 0 ? 'partial' : 'completed',
        last_error: result.errors.length > 0 ? result.errors[0].error : null,
        last_sync_at: new Date().toISOString()  // Update sync timestamp for Awaiting Arrival display
      })
      .eq('organization_id', organizationId)

    // Update organization usage
    const currentDate = new Date()
    const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      .toISOString().split('T')[0]

    try {
      await supabaseAdmin.rpc('increment_usage', {
        p_organization_id: organizationId,
        p_period_start: periodStart,
        p_dms_imports: 1,
        p_dms_bookings_imported: result.bookingsImported
      })
    } catch {
      // RPC may not exist, that's okay
    }

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
