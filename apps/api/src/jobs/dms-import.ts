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
  bookingsUpdated: number    // existing awaiting_arrival bookings refreshed/rescheduled
  bookingsCancelled: number  // existing bookings cancelled (explicit DMS status or vanished from feed)
  bookingsRevived: number    // sweep-cancelled bookings revived after reappearing in the feed
  bookingsFlaggedMissing: number  // awaiting_arrival bookings newly/again flagged absent (soft, not yet cancelled)
  bookingsSkipped: number
  bookingsFailed: number
  customersCreated: number
  vehiclesCreated: number
  healthChecksCreated: number
  errors: Array<{ bookingId: string; error: string }>
}

// ============================================
// Cancellation-sweep configuration
// ============================================
// All env-overridable so the safety margins can be tuned without a deploy.
function envInt(name: string, def: number): number {
  const v = parseInt(process.env[name] || '', 10)
  return Number.isFinite(v) && v > 0 ? v : def
}
function envFloat(name: string, def: number): number {
  const v = parseFloat(process.env[name] || '')
  return Number.isFinite(v) && v > 0 ? v : def
}

// A vanished booking is hard-cancelled only after it has been absent across this
// many CONSECUTIVE scheduled runs AND this many wall-clock hours — both, so that
// neither a flurry of intraday runs nor a single overnight gap can cancel alone.
const SWEEP_CANCEL_AFTER_RUNS = envInt('DMS_CANCEL_AFTER_MISSING_RUNS', 3)
const SWEEP_CANCEL_MIN_HOURS = envInt('DMS_CANCEL_MIN_MISSING_HOURS', 24)

// Partial-feed detection. A truncated HTTP 200 is indistinguishable from a batch
// of cancellations, so we refuse to act when the feed looks implausibly small
// relative to what we hold, or when too many rows vanish in one run.
const SWEEP_MIN_HELD_FOR_RATIO = envInt('DMS_SWEEP_MIN_HELD', 5)       // below this, the ratio floor is meaningless
const SWEEP_MIN_FEED_RATIO = envFloat('DMS_SWEEP_MIN_FEED_RATIO', 0.5) // abort if feedCount < held * this
const SWEEP_MAX_MISSING_ABS = envInt('DMS_SWEEP_MAX_MISSING', 25)      // abort if more than this many vanish at once
const SWEEP_MAX_MISSING_RATIO = envFloat('DMS_SWEEP_MAX_MISSING_RATIO', 0.5) // ...or more than this fraction of held

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

/** Compare two timestamp values for equality, tolerant of ISO format differences. */
function timestampsEqual(a: string | null, b: string | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (isNaN(ta) || isNaN(tb)) return a === b
  return ta === tb
}

/**
 * Derive the mutable booking fields VHC syncs from a Gemini booking. Shared by
 * the create (insert) and reconcile (update) paths so a freshly-imported health
 * check and a re-imported / rescheduled one are derived identically — the keys
 * map 1:1 to health_checks columns.
 */
function deriveBookingFields(booking: GeminiBooking) {
  // Parse promise time from booking
  let promiseTime: string | null = null
  if (booking.bookingDate && booking.bookingTime) {
    try {
      promiseTime = new Date(`${booking.bookingDate}T${booking.bookingTime}`).toISOString()
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

  // Gemini sends no MOT flag — infer one from the booked work / notes text.
  // The real payload exposes MOT only as "MOT Labour" repair lines or "MOT" in notes.
  const motText = [
    booking.description || '',
    booking.serviceType || '',
    ...(booking.bookedRepairs || []).flatMap(r => [
      r.description || '',
      r.notes || '',
      ...(r.labourItems || []).map(l => l.description || '')
    ])
  ].join(' ').toLowerCase()

  return {
    mileage_in: booking.vehicleMileage || null,
    promise_time: promiseTime,
    notes: booking.description || null,
    customer_waiting: booking.customerWaiting || false,
    loan_car_required: booking.loanCarRequired || false,
    is_internal: booking.isInternal || false,
    due_date: dueDate,
    jobsheet_number: booking.jobsheetNumber || null,
    jobsheet_status: booking.jobsheetStatus || null,
    booked_repairs: booking.bookedRepairs && booking.bookedRepairs.length > 0
      ? booking.bookedRepairs
      : [],
    // Booking Diary metadata (previously dropped on import)
    estimated_hours: booking.durationHours && booking.durationHours > 0 ? booking.durationHours : null,
    booked_service_type: booking.serviceType || null,
    is_mot_booking: /\bmot\b/.test(motText),
  }
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

  const insertData = {
    organization_id: organizationId,
    site_id: siteId,
    customer_id: customerId,
    vehicle_id: vehicleId,
    template_id: templateId,
    status: 'awaiting_arrival',  // DMS imports start in awaiting_arrival status
    external_id: booking.bookingId,
    external_source: externalSource,
    import_batch_id: importBatchId,
    booked_date: new Date().toISOString(), // Record when booking was imported
    // Mutable booking fields (kept in sync on re-import via the reconcile path)
    ...deriveBookingFields(booking)
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

/**
 * Soft, reversible cancellation sweep for SCHEDULED imports.
 *
 * Gemini never emits a "cancelled" status — a cancelled booking simply drops out
 * of the diary feed. Reconciling that safely needs three guarantees, all enforced
 * here / by the caller:
 *
 *  1. Site mapping — the caller passes an UNAMBIGUOUS sweepSiteId (an explicit
 *     site, or the org's single active site). Multi-site orgs without an explicit
 *     site are skipped upstream, because the feed is scoped to one Gemini Site and
 *     "Gemini Site=1" is not "all VHC sites".
 *  2. Partial-feed detection — a truncated 200 looks identical to a batch of
 *     cancellations, so we abort and touch NOTHING when the feed is implausibly
 *     small vs what we hold, or when too many rows vanish at once.
 *  3. Reversibility — a vanished booking is first only *flagged* (dms_missing_since
 *     / dms_missing_runs). It is hard-cancelled only after it has been absent
 *     across N consecutive scheduled runs AND a wall-clock floor. Reappearance
 *     clears the flag; a sweep-cancelled booking that reappears is revived in the
 *     main reconcile loop (deletion_reason='dms_missing').
 *
 * Every write is guarded on the expected status so it can't race an advisor who
 * progressed/cancelled the booking between the held-set read and here.
 */
async function reconcileMissingBookings(params: {
  organizationId: string
  externalSource: string
  sweepSiteId: string
  windowStartUtc: string
  windowEndUtc: string
  feedIds: Set<string>
  feedCount: number
  result: ImportResult
}): Promise<void> {
  const {
    organizationId, externalSource, sweepSiteId,
    windowStartUtc, windowEndUtc, feedIds, feedCount, result
  } = params

  // Held set: in-window awaiting_arrival Gemini bookings for this ONE site. The
  // window bounds are explicit-UTC ('Z') to match how due_date (TIMESTAMPTZ) is
  // written — new Date(booking.dueDateTime).toISOString(). Past-due awaiting_arrival
  // rows fall outside the window and are intentionally excluded: they are absent
  // from the feed because they are in the past, not because they were cancelled.
  const { data: heldRows, error: heldErr } = await supabaseAdmin
    .from('health_checks')
    .select('id, external_id, due_date, dms_missing_since, dms_missing_runs')
    .eq('organization_id', organizationId)
    .eq('external_source', externalSource)
    .eq('status', 'awaiting_arrival')
    .eq('site_id', sweepSiteId)
    .is('deleted_at', null)
    .gte('due_date', windowStartUtc)
    .lte('due_date', windowEndUtc)

  if (heldErr) {
    console.error('[DMS Import] Cancellation sweep: failed to load held set:', heldErr.message)
    return
  }

  const held = (heldRows || []) as Array<{
    id: string
    external_id: string | null
    due_date: string | null
    dms_missing_since: string | null
    dms_missing_runs: number | null
  }>
  const heldCount = held.length
  if (heldCount === 0) {
    console.log('[DMS Import] Cancellation sweep: nothing held in window, skipping')
    return
  }

  const missing = held.filter(r => r.external_id && !feedIds.has(r.external_id))

  // ---- Safety net 2a: implausibly small feed vs held → suspected partial feed.
  if (heldCount >= SWEEP_MIN_HELD_FOR_RATIO && feedCount < heldCount * SWEEP_MIN_FEED_RATIO) {
    const msg = `Cancellation sweep ABORTED: feed returned ${feedCount} bookings vs ${heldCount} in-window awaiting_arrival held (below ${SWEEP_MIN_FEED_RATIO}× floor). Suspected partial/truncated feed — nothing cancelled.`
    console.error('[DMS Import]', msg)
    logger.error('DMS cancellation sweep aborted (suspected partial feed)', { organizationId, feedCount, heldCount })
    result.errors.push({ bookingId: 'sweep', error: msg })
    return
  }

  // ---- Safety net 2b: too many vanish at once → suspected partial feed / mass error.
  const maxMissing = Math.max(1, Math.min(SWEEP_MAX_MISSING_ABS, Math.ceil(heldCount * SWEEP_MAX_MISSING_RATIO)))
  if (missing.length > maxMissing) {
    const msg = `Cancellation sweep ABORTED: ${missing.length} of ${heldCount} held bookings vanished from the feed in one run (cap ${maxMissing}). Suspected partial feed — nothing cancelled.`
    console.error('[DMS Import]', msg)
    logger.error('DMS cancellation sweep aborted (mass disappearance)', { organizationId, missing: missing.length, heldCount, maxMissing })
    result.errors.push({ bookingId: 'sweep', error: msg })
    return
  }

  if (missing.length === 0) {
    console.log(`[DMS Import] Cancellation sweep: all ${heldCount} held bookings present in feed`)
    return
  }

  const nowIso = new Date().toISOString()
  const nowMs = Date.now()
  let flaggedThisRun = 0
  let cancelledThisRun = 0

  for (const row of missing) {
    const runs = (row.dms_missing_runs ?? 0) + 1
    const missingSince = row.dms_missing_since || nowIso
    const ageHours = (nowMs - new Date(missingSince).getTime()) / 3_600_000
    const eligibleToCancel = runs >= SWEEP_CANCEL_AFTER_RUNS && ageHours >= SWEEP_CANCEL_MIN_HOURS

    if (eligibleToCancel) {
      // Hard-cancel. Keep the missing markers for audit + so a reappearance can
      // revive it (deletion_reason='dms_missing' is the revival key).
      const { data: cancelled } = await supabaseAdmin
        .from('health_checks')
        .update({
          status: 'cancelled',
          deletion_reason: 'dms_missing',
          deletion_notes: `Auto-cancelled: absent from the Gemini diary feed across ${runs} consecutive scheduled imports (first missing ${missingSince}).`,
          dms_missing_since: missingSince,
          dms_missing_runs: runs,
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .eq('status', 'awaiting_arrival')
        .select('id')
      if (cancelled && cancelled.length > 0) {
        cancelledThisRun++
        result.bookingsCancelled++
      }
    } else {
      // Not yet eligible — only advance the soft flag.
      const { data: flagged } = await supabaseAdmin
        .from('health_checks')
        .update({
          dms_missing_since: missingSince,
          dms_missing_runs: runs,
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .eq('status', 'awaiting_arrival')
        .select('id')
      if (flagged && flagged.length > 0) {
        flaggedThisRun++
        result.bookingsFlaggedMissing++
      }
    }
  }

  console.log(`[DMS Import] Cancellation sweep: held=${heldCount} feed=${feedCount} missing=${missing.length} flagged=${flaggedThisRun} cancelled=${cancelledThisRun}`)
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
    bookingsUpdated: 0,
    bookingsCancelled: 0,
    bookingsRevived: 0,
    bookingsFlaggedMissing: 0,
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
      .select('default_template_id, import_service_types, cancel_missing_bookings, gemini_site_id')
      .eq('organization_id', organizationId)
      .single()

    // Cancellation sweep opt-in (off by default) + which Gemini Site the feed maps to.
    const cancelMissingBookings = dmsSettings?.cancel_missing_bookings === true
    const geminiSiteId = typeof dmsSettings?.gemini_site_id === 'number' && dmsSettings.gemini_site_id > 0
      ? dmsSettings.gemini_site_id
      : 1

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
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!defaultSite) {
        throw new Error('No site found for organization')
      }
      effectiveSiteId = defaultSite.id
      console.warn('[DMS Import] No site_id provided, falling back to most recent active site:', effectiveSiteId)
    }

    // Fetch bookings from DMS
    // Note: serviceTypes filtering is not yet supported by fetchDiaryBookings.
    // siteId scopes the feed to the org's mapped Gemini Site (default 1) so the
    // feed and the cancellation sweep agree on which site's bookings we're seeing.
    const diaryResponse = await fetchDiaryBookings(credentials, date, {
      endDate: options.endDate,
      siteId: geminiSiteId
    })

    if (!diaryResponse.success) {
      throw new Error(diaryResponse.error || 'Failed to fetch bookings from DMS')
    }

    result.bookingsFound = diaryResponse.bookings.length
    console.log('[DMS Import] Bookings found:', result.bookingsFound)

    // Process each booking
    const externalSource = 'gemini_osi'
    const isSelective = !!(bookingIds && bookingIds.length > 0)

    // Batch-fetch existing health checks for these bookings up front (chunked)
    // rather than an N+1 existence check per booking — important now that a
    // single run can span a full year of bookings.
    const allExternalIds = diaryResponse.bookings.map(b => b.bookingId)
    const existingByExtId = new Map<string, {
      id: string
      status: string
      due_date: string | null
      promise_time: string | null
      booked_repairs: unknown
      estimated_hours: number | string | null
      booked_service_type: string | null
      is_mot_booking: boolean | null
      customer_waiting: boolean | null
      loan_car_required: boolean | null
      jobsheet_status: string | null
      is_internal: boolean | null
      deletion_reason: string | null
      dms_missing_since: string | null
      dms_missing_runs: number | null
    }>()
    for (let j = 0; j < allExternalIds.length; j += 200) {
      const chunkIds = allExternalIds.slice(j, j + 200)
      if (chunkIds.length === 0) continue
      const { data: existingRows } = await supabaseAdmin
        .from('health_checks')
        .select('id, external_id, status, due_date, promise_time, booked_repairs, estimated_hours, booked_service_type, is_mot_booking, customer_waiting, loan_car_required, jobsheet_status, is_internal, deletion_reason, dms_missing_since, dms_missing_runs')
        .eq('organization_id', organizationId)
        .eq('external_source', externalSource)
        .in('external_id', chunkIds)
        .is('deleted_at', null)
      for (const r of existingRows || []) existingByExtId.set(r.external_id, r)
    }

    for (let i = 0; i < diaryResponse.bookings.length; i++) {
      const booking = diaryResponse.bookings[i]

      try {
        // If selective import, skip bookings not in the list
        if (isSelective && bookingIds && !bookingIds.includes(booking.bookingId)) {
          result.bookingsSkipped++
          continue
        }

        const existing = existingByExtId.get(booking.bookingId)
        const statusLower = (booking.status || '').toLowerCase()
        const isCancelSignal = ['cancelled', 'canceled', 'no show', 'no-show', 'noshow'].includes(statusLower)
        const isCompletedSignal = statusLower === 'completed'

        // ---- Existing booking: reconcile, don't re-insert ----
        if (existing) {
          // Revive a booking the cancellation sweep previously cancelled, now that
          // it has REAPPEARED in the feed (we only reach here for feed-present
          // external_ids). This is the reversibility guarantee: an over-eager
          // sweep-cancel self-heals on the next run. It only ever touches
          // sweep-cancelled rows (deletion_reason='dms_missing') — never an
          // advisor's deliberate cancel — and re-syncs the DMS fields.
          if (existing.status === 'cancelled') {
            if (existing.deletion_reason === 'dms_missing' && !isCancelSignal && !isCompletedSignal) {
              const { data: revived } = await supabaseAdmin
                .from('health_checks')
                .update({
                  status: 'awaiting_arrival',
                  deletion_reason: null,
                  deletion_notes: null,
                  dms_missing_since: null,
                  dms_missing_runs: 0,
                  ...deriveBookingFields(booking),
                  updated_at: new Date().toISOString()
                })
                .eq('id', existing.id)
                .eq('status', 'cancelled')
                .eq('deletion_reason', 'dms_missing')
                .select('id')
              if (revived && revived.length > 0) {
                result.bookingsRevived++
              } else {
                result.bookingsSkipped++
              }
            } else {
              // Manually cancelled (or cancel/complete signalled now) → leave terminal.
              result.bookingsSkipped++
            }
            continue
          }

          // Never touch a check that has progressed past awaiting_arrival — that
          // would clobber real workshop state (arrived / in-progress / etc.).
          if (existing.status !== 'awaiting_arrival') {
            result.bookingsSkipped++
            continue
          }

          // Cancelled in the DMS → cancel our check so it drops out of the diary.
          // Defensive: Gemini's diary feed does not currently emit a cancelled
          // ArrivalStatus (cancelled bookings simply drop out of the feed), so this
          // rarely fires in practice — it's here for if/when an explicit signal
          // appears. The status guard in the WHERE keeps it atomic against a
          // booking an advisor just progressed between the batch read and here.
          if (isCancelSignal) {
            await supabaseAdmin
              .from('health_checks')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() })
              .eq('id', existing.id)
              .eq('status', 'awaiting_arrival')
            result.bookingsCancelled++
            continue
          }
          // Completed directly in the DMS (never processed in VHC) → leave as-is.
          if (isCompletedSignal) {
            result.bookingsSkipped++
            continue
          }

          // Reschedule / refresh: write back only the DMS-authoritative fields
          // that changed. notes, mileage_in and jobsheet_number are intentionally
          // NOT reconciled — they can be edited in VHC (advisor notes, actual
          // mileage captured on arrival) and a re-import must not clobber that.
          const fields = deriveBookingFields(booking)
          const changed: Record<string, unknown> = {}
          if (!timestampsEqual(existing.due_date, fields.due_date)) changed.due_date = fields.due_date
          if (!timestampsEqual(existing.promise_time, fields.promise_time)) changed.promise_time = fields.promise_time
          if (JSON.stringify(existing.booked_repairs ?? []) !== JSON.stringify(fields.booked_repairs)) changed.booked_repairs = fields.booked_repairs
          const existingHours = existing.estimated_hours == null ? null : Number(existing.estimated_hours)
          if (existingHours !== fields.estimated_hours) changed.estimated_hours = fields.estimated_hours
          if ((existing.booked_service_type ?? null) !== fields.booked_service_type) changed.booked_service_type = fields.booked_service_type
          if ((existing.jobsheet_status ?? null) !== fields.jobsheet_status) changed.jobsheet_status = fields.jobsheet_status
          if (Boolean(existing.is_mot_booking) !== fields.is_mot_booking) changed.is_mot_booking = fields.is_mot_booking
          if (Boolean(existing.is_internal) !== fields.is_internal) changed.is_internal = fields.is_internal
          if (Boolean(existing.customer_waiting) !== fields.customer_waiting) changed.customer_waiting = fields.customer_waiting
          if (Boolean(existing.loan_car_required) !== fields.loan_car_required) changed.loan_car_required = fields.loan_car_required

          // Present in the feed again → reset the "missing" counters so that
          // "N CONSECUTIVE absent runs" stays genuinely consecutive. (Reaching
          // here means present: existingByExtId only holds feed external_ids.)
          if (existing.dms_missing_since != null || (existing.dms_missing_runs ?? 0) > 0) {
            changed.dms_missing_since = null
            changed.dms_missing_runs = 0
          }

          if (Object.keys(changed).length > 0) {
            changed.updated_at = new Date().toISOString()
            // Re-assert the awaiting_arrival guard at write time so we can't race a
            // booking an advisor just progressed between the batch read and here.
            await supabaseAdmin
              .from('health_checks')
              .update(changed)
              .eq('id', existing.id)
              .eq('status', 'awaiting_arrival')
            result.bookingsUpdated++
          } else {
            result.bookingsSkipped++
          }
          continue
        }

        // ---- New booking ----
        // Don't import a booking already cancelled/completed in the DMS.
        if (isCancelSignal || isCompletedSignal) {
          result.bookingsSkipped++
          continue
        }

        // Find or create customer
        const customerResult = await findOrCreateCustomer(organizationId, booking, externalSource)
        if (customerResult.created) result.customersCreated++

        // Find or create vehicle
        const vehicleResult = await findOrCreateVehicle(
          organizationId,
          customerResult.customerId,
          booking,
          externalSource
        )
        if (vehicleResult.created) result.vehiclesCreated++

        // Create health check
        await createHealthCheck(
          organizationId,
          effectiveSiteId,
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
        const errorMessage = bookingError instanceof Error ? bookingError.message : 'Unknown error'
        console.error('[DMS Import] FAILED to process booking:', errorMessage)
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

    // ---- Cancellation sync sweep (soft + reversible) ----
    // Gemini has no explicit cancelled signal — cancelled bookings just drop out
    // of the feed. We reconcile that here, but ONLY for SCHEDULED, non-selective
    // imports: a manual day-pull or a selective import sees a partial slice of the
    // diary and would wrongly flag every other booking as "missing". Opt-in per
    // org, off by default.
    if (importType === 'scheduled' && !isSelective && cancelMissingBookings) {
      // Resolve the ONE VHC site this sweep may touch. The feed is scoped to a
      // single Gemini Site (geminiSiteId) which maps to a single VHC site — but on
      // a multi-site org the "most recent active site" fallback used for imports is
      // NOT a safe mapping (other sites' bookings live on Gemini Sites we never
      // queried). So we only sweep when the target site is unambiguous: an explicit
      // site was supplied, or the org has exactly one active site. Otherwise skip.
      let sweepSiteId: string | null = null
      if (siteId) {
        sweepSiteId = siteId
      } else {
        const { data: activeSites } = await supabaseAdmin
          .from('sites')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
        if ((activeSites?.length ?? 0) === 1) {
          sweepSiteId = activeSites![0].id
        }
      }

      if (!sweepSiteId) {
        console.warn('[DMS Import] Cancellation sweep skipped: ambiguous Gemini↔VHC site mapping (multi-site org without an explicit site). Imports keep working; auto-cancel stays off for this org until a single mapped site is configured.')
      } else {
        // Window bounds explicit-UTC ('Z') to match how due_date (TIMESTAMPTZ) is
        // stored, and exactly matching the fetched window so the held set and the
        // feed cover the same span.
        const windowStartUtc = `${date}T00:00:00Z`
        const windowEndUtc = `${options.endDate || date}T23:59:59Z`
        const feedIds = new Set(diaryResponse.bookings.map(b => b.bookingId))
        await reconcileMissingBookings({
          organizationId,
          externalSource,
          sweepSiteId,
          windowStartUtc,
          windowEndUtc,
          feedIds,
          feedCount: diaryResponse.bookings.length,
          result
        })
      }
    }

    console.log('\n[DMS Import] ========== Import Summary ==========')
    console.log('[DMS Import] Bookings found:', result.bookingsFound)
    console.log('[DMS Import] Bookings imported:', result.bookingsImported)
    console.log('[DMS Import] Bookings updated:', result.bookingsUpdated)
    console.log('[DMS Import] Bookings cancelled:', result.bookingsCancelled)
    console.log('[DMS Import] Bookings revived:', result.bookingsRevived)
    console.log('[DMS Import] Bookings flagged missing:', result.bookingsFlaggedMissing)
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
      updated: result.bookingsUpdated,
      cancelled: result.bookingsCancelled,
      revived: result.bookingsRevived,
      flaggedMissing: result.bookingsFlaggedMissing,
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
