/**
 * DMS Settings & Import Management Routes
 *
 * Internal routes for managing DMS settings, triggering imports,
 * and viewing import history. Uses user authentication (not API key).
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { encrypt, decrypt, isEncryptionConfigured, maskString } from '../lib/encryption.js'
import { authMiddleware, requireOrgAdmin } from '../middleware/auth.js'
import { logger } from '../lib/logger.js'
import { runDmsImport } from '../jobs/dms-import.js'
import { testConnection, isDmsAvailable, getDmsCredentials, fetchDiaryBookings } from '../services/gemini-osi.js'
import {
  queueDmsImport,
  scheduleDmsImport,
  cancelDmsSchedule,
  checkRedisConnection
} from '../services/queue.js'

// Default import hours (6am, 10am, 2pm, 8pm UK time)
const DEFAULT_IMPORT_HOURS = [6, 10, 14, 20]

const dmsSettings = new Hono()

// All routes require authentication
dmsSettings.use('*', authMiddleware)

// ============================================
// DMS Settings Endpoints
// ============================================

/**
 * GET /settings
 * Get DMS settings for current organization (masked credentials)
 */
dmsSettings.get('/settings', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    const { data: settings, error } = await supabaseAdmin
      .from('organization_dms_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw error
    }

    // If no settings exist, return defaults (camelCase for frontend)
    if (!settings) {
      return c.json({
        enabled: false,
        provider: 'gemini_osi',
        configured: false,
        credentialsConfigured: false,
        apiUrl: '',
        defaultTemplateId: null,
        autoImportEnabled: false,
        importScheduleHours: DEFAULT_IMPORT_HOURS,
        importScheduleDays: [1, 2, 3, 4, 5, 6],
        importServiceTypes: ['service', 'mot', 'repair'],
        dailyImportLimit: 100,
        lastImportAt: null,
        lastImportStatus: null,
        lastSyncAt: null,
        lastError: null
      })
    }

    // Build camelCase response
    let credentialsConfigured = false
    let usernameMasked: string | null = null

    // Show if credentials are configured and mask username
    if (settings.username_encrypted && settings.password_encrypted) {
      try {
        const decryptedUsername = decrypt(settings.username_encrypted)
        credentialsConfigured = true
        usernameMasked = maskString(decryptedUsername)
      } catch {
        credentialsConfigured = false
      }
    }

    // Check if fully configured
    const configured =
      settings.enabled &&
      !!settings.api_url &&
      !!settings.username_encrypted &&
      !!settings.password_encrypted

    return c.json({
      enabled: settings.enabled,
      provider: settings.provider,
      configured,
      credentialsConfigured,
      usernameMasked,
      apiUrl: settings.api_url || '',
      defaultTemplateId: settings.default_template_id,
      autoImportEnabled: settings.auto_import_enabled,
      importScheduleHours: settings.import_schedule_hours || DEFAULT_IMPORT_HOURS,
      importScheduleDays: settings.import_schedule_days,
      importServiceTypes: settings.import_service_types,
      dailyImportLimit: settings.daily_import_limit || 100,
      lastImportAt: settings.last_import_at,
      lastImportStatus: settings.last_import_status,
      lastSyncAt: settings.last_sync_at,
      lastError: settings.last_error
    })
  } catch (err) {
    logger.error('Failed to get DMS settings', { organizationId }, err as Error)
    return c.json({ error: 'Failed to get DMS settings' }, 500)
  }
})

/**
 * PATCH /settings
 * Update DMS settings (requires org admin)
 */
dmsSettings.patch('/settings', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    const body = await c.req.json()
    const updateData: Record<string, unknown> = {}

    // Handle each updateable field (accept both camelCase and snake_case)
    if (body.enabled !== undefined) updateData.enabled = body.enabled
    if (body.provider) updateData.provider = body.provider
    if (body.apiUrl || body.api_url) updateData.api_url = body.apiUrl || body.api_url
    if (body.defaultTemplateId !== undefined || body.default_template_id !== undefined) {
      updateData.default_template_id = body.defaultTemplateId ?? body.default_template_id
    }
    if (body.autoImportEnabled !== undefined || body.auto_import_enabled !== undefined) {
      updateData.auto_import_enabled = body.autoImportEnabled ?? body.auto_import_enabled
    }
    if (body.importScheduleHours || body.import_schedule_hours) {
      updateData.import_schedule_hours = body.importScheduleHours || body.import_schedule_hours
    }
    if (body.importScheduleDays || body.import_schedule_days) {
      updateData.import_schedule_days = body.importScheduleDays || body.import_schedule_days
    }
    if (body.importServiceTypes || body.import_service_types) {
      updateData.import_service_types = body.importServiceTypes || body.import_service_types
    }
    if (body.minBookingDurationMinutes !== undefined || body.min_booking_duration_minutes !== undefined) {
      updateData.min_booking_duration_minutes = body.minBookingDurationMinutes ?? body.min_booking_duration_minutes
    }
    if (body.dailyImportLimit !== undefined || body.daily_import_limit !== undefined) {
      updateData.daily_import_limit = body.dailyImportLimit ?? body.daily_import_limit
    }

    // Encrypt username and password if provided
    if (body.username || body.password) {
      if (!isEncryptionConfigured()) {
        return c.json({ error: 'Encryption not configured on server' }, 500)
      }
      if (body.username) {
        updateData.username_encrypted = encrypt(body.username)
      }
      if (body.password) {
        updateData.password_encrypted = encrypt(body.password)
      }
    }

    updateData.updated_at = new Date().toISOString()

    // Upsert settings
    const { data: existing } = await supabaseAdmin
      .from('organization_dms_settings')
      .select('id')
      .eq('organization_id', organizationId)
      .single()

    let result
    if (existing) {
      result = await supabaseAdmin
        .from('organization_dms_settings')
        .update(updateData)
        .eq('organization_id', organizationId)
        .select()
        .single()
    } else {
      result = await supabaseAdmin
        .from('organization_dms_settings')
        .insert({
          organization_id: organizationId,
          ...updateData
        })
        .select()
        .single()
    }

    if (result.error) {
      throw result.error
    }

    const savedSettings = result.data

    // Update scheduled import if auto-import settings changed
    if (body.autoImportEnabled !== undefined || body.auto_import_enabled !== undefined ||
        body.importScheduleHours || body.import_schedule_hours ||
        body.importScheduleDays || body.import_schedule_days) {
      const redisAvailable = await checkRedisConnection()

      if (redisAvailable) {
        // Cancel existing schedule
        await cancelDmsSchedule(organizationId)

        // Create new schedules if enabled (one per hour)
        if (savedSettings.auto_import_enabled && savedSettings.enabled) {
          const hours = (savedSettings.import_schedule_hours as number[]) || DEFAULT_IMPORT_HOURS
          const days = (savedSettings.import_schedule_days as number[]) || [1, 2, 3, 4, 5, 6]

          // Schedule for each hour
          for (const hour of hours) {
            await scheduleDmsImport(
              organizationId,
              undefined,
              hour,
              days
            )
          }

          logger.info('Scheduled DMS auto-imports', {
            organizationId,
            hours,
            days
          })
        }
      }
    }

    logger.info('Updated DMS settings', { organizationId, fields: Object.keys(updateData) })

    // Build camelCase response for frontend
    let credentialsConfigured = false
    let usernameMasked: string | null = null

    if (savedSettings.username_encrypted && savedSettings.password_encrypted) {
      try {
        const decryptedUsername = decrypt(savedSettings.username_encrypted)
        credentialsConfigured = true
        usernameMasked = maskString(decryptedUsername)
      } catch {
        credentialsConfigured = false
      }
    }

    const configured =
      savedSettings.enabled &&
      !!savedSettings.api_url &&
      !!savedSettings.username_encrypted &&
      !!savedSettings.password_encrypted

    return c.json({
      enabled: savedSettings.enabled,
      provider: savedSettings.provider,
      configured,
      credentialsConfigured,
      usernameMasked,
      apiUrl: savedSettings.api_url || '',
      defaultTemplateId: savedSettings.default_template_id,
      autoImportEnabled: savedSettings.auto_import_enabled,
      importScheduleHours: savedSettings.import_schedule_hours || DEFAULT_IMPORT_HOURS,
      importScheduleDays: savedSettings.import_schedule_days,
      importServiceTypes: savedSettings.import_service_types,
      dailyImportLimit: savedSettings.daily_import_limit || 100,
      lastImportAt: savedSettings.last_import_at,
      lastImportStatus: savedSettings.last_import_status,
      lastSyncAt: savedSettings.last_sync_at,
      lastError: savedSettings.last_error
    })
  } catch (err) {
    logger.error('Failed to update DMS settings', { organizationId }, err as Error)
    return c.json({ error: 'Failed to update DMS settings' }, 500)
  }
})

/**
 * POST /test-connection
 * Test DMS connection with provided or saved credentials
 */
dmsSettings.post('/test-connection', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    const body = await c.req.json().catch(() => ({}))

    let apiUrl: string
    let username: string
    let password: string

    console.log('[DMS Test] Starting connection test for org:', organizationId)
    console.log('[DMS Test] Body credentials provided:', {
      hasApiUrl: !!body.apiUrl,
      hasUsername: !!body.username,
      hasPassword: !!body.password
    })

    // If credentials provided in request body, use those (for testing before save)
    if (body.apiUrl && body.username && body.password) {
      apiUrl = body.apiUrl
      username = body.username
      password = body.password
      console.log('[DMS Test] Using credentials from request body')
    } else {
      console.log('[DMS Test] Fetching credentials from database...')
      // Otherwise get from saved settings
      const { data: settings, error } = await supabaseAdmin
        .from('organization_dms_settings')
        .select('api_url, username_encrypted, password_encrypted')
        .eq('organization_id', organizationId)
        .single()

      if (error || !settings) {
        console.log('[DMS Test] No settings found in database:', error?.message)
        return c.json({ success: false, message: 'DMS settings not configured. Please enter credentials first.' }, 400)
      }

      console.log('[DMS Test] Settings found:', {
        hasApiUrl: !!settings.api_url,
        hasUsernameEncrypted: !!settings.username_encrypted,
        hasPasswordEncrypted: !!settings.password_encrypted
      })

      if (!settings.api_url || !settings.username_encrypted || !settings.password_encrypted) {
        return c.json({ success: false, message: 'DMS credentials incomplete. Please fill in all fields.' }, 400)
      }

      apiUrl = settings.api_url

      // Decrypt username and password
      try {
        console.log('[DMS Test] Attempting to decrypt credentials...')
        console.log('[DMS Test] Encryption configured:', isEncryptionConfigured())
        username = decrypt(settings.username_encrypted)
        password = decrypt(settings.password_encrypted)
        console.log('[DMS Test] Decryption successful, username length:', username.length)
      } catch (decryptErr) {
        console.error('[DMS Test] Decryption failed:', decryptErr)
        return c.json({
          success: false,
          message: `Failed to decrypt credentials: ${decryptErr instanceof Error ? decryptErr.message : 'Unknown error'}`
        }, 500)
      }
    }

    console.log('[DMS Test] Testing connection with:', {
      apiUrl,
      username: username.substring(0, 3) + '***',
      method: 'GET',
      endpoint: '/api/v2/workshop/get-diary-bookings',
      authType: 'Basic Auth'
    })

    logger.info('Testing DMS connection', {
      organizationId,
      apiUrl,
      hasUsername: !!username,
      hasPassword: !!password
    })

    // Test connection
    const result = await testConnection({
      apiUrl,
      username,
      password
    })

    console.log('[DMS Test] Connection test result:', result)

    logger.info('DMS connection test result', {
      organizationId,
      success: result.success,
      message: result.message
    })

    return c.json(result)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    const errorStack = err instanceof Error ? err.stack : ''
    console.error('[DMS Test] Connection test failed:', errorMessage)
    console.error('[DMS Test] Stack:', errorStack)
    logger.error('DMS connection test failed', { organizationId }, err as Error)
    return c.json({
      success: false,
      message: `Connection test failed: ${errorMessage}`
    }, 500)
  }
})

/**
 * GET /preview
 * Preview what would be imported WITHOUT creating any data
 * Returns bookings categorized into: willImport, willSkip (with reasons)
 */
dmsSettings.get('/preview', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0]
    const endDate = c.req.query('endDate') || undefined

    // Get DMS credentials
    const credResult = await getDmsCredentials(organizationId)
    if (!credResult.configured || !credResult.credentials) {
      return c.json({ error: credResult.error || 'DMS not configured' }, 400)
    }

    // Get settings for filtering
    const { data: settings } = await supabaseAdmin
      .from('organization_dms_settings')
      .select('import_service_types, daily_import_limit')
      .eq('organization_id', organizationId)
      .single()

    const dailyLimit = settings?.daily_import_limit || 100

    // Check daily limit
    const { data: todayImports } = await supabaseAdmin
      .from('health_checks')
      .select('id', { count: 'exact' })
      .eq('organization_id', organizationId)
      .eq('external_source', 'gemini_osi')
      .gte('created_at', `${date}T00:00:00`)
      .lte('created_at', `${date}T23:59:59`)
      .is('deleted_at', null)

    const importsToday = todayImports?.length || 0
    const remainingCapacity = Math.max(0, dailyLimit - importsToday)

    // Fetch bookings from Gemini API
    logger.info('Fetching preview bookings', { organizationId, date, endDate })

    const response = await fetchDiaryBookings(credResult.credentials, date, { endDate })

    if (!response.success) {
      return c.json({
        error: response.error || 'Failed to fetch bookings from DMS',
        success: false
      }, 500)
    }

    // Get existing external_ids to check for duplicates
    const { data: existingChecks } = await supabaseAdmin
      .from('health_checks')
      .select('external_id')
      .eq('organization_id', organizationId)
      .eq('external_source', 'gemini_osi')
      .not('external_id', 'is', null)

    const existingExternalIds = new Set(existingChecks?.map(hc => hc.external_id) || [])

    // Categorize bookings
    const willImport: Array<{
      bookingId: string
      vehicleReg: string
      customerName: string
      scheduledTime: string
      serviceType: string
      bookingDate: string
    }> = []

    const willSkip: Array<{
      bookingId: string
      vehicleReg: string
      customerName: string
      reason: string
      bookingDate: string
    }> = []

    for (const booking of response.bookings) {
      const customerName = `${booking.customerFirstName} ${booking.customerLastName}`.trim()

      // Check if already imported
      if (existingExternalIds.has(booking.bookingId)) {
        willSkip.push({
          bookingId: booking.bookingId,
          vehicleReg: booking.vehicleReg,
          customerName,
          reason: 'Already imported',
          bookingDate: booking.bookingDate || date
        })
        continue
      }

      // Check if no vehicle registration
      if (!booking.vehicleReg) {
        willSkip.push({
          bookingId: booking.bookingId,
          vehicleReg: 'N/A',
          customerName,
          reason: 'No vehicle registration',
          bookingDate: booking.bookingDate || date
        })
        continue
      }

      // Check arrival status (skip completed/cancelled)
      if (['COMPLETED', 'CANCELLED', 'NO SHOW'].includes(booking.arrivalStatus?.toUpperCase() || '')) {
        willSkip.push({
          bookingId: booking.bookingId,
          vehicleReg: booking.vehicleReg,
          customerName,
          reason: `Status: ${booking.arrivalStatus}`,
          bookingDate: booking.bookingDate || date
        })
        continue
      }

      // Would be imported
      willImport.push({
        bookingId: booking.bookingId,
        vehicleReg: booking.vehicleReg,
        customerName,
        scheduledTime: booking.bookingTime || 'Not set',
        serviceType: booking.serviceType || 'Service',
        bookingDate: booking.bookingDate || date
      })
    }

    // Check if would exceed daily limit
    const limitExceeded = willImport.length > remainingCapacity
    const actualWillImport = limitExceeded ? willImport.slice(0, remainingCapacity) : willImport
    const wouldExceedLimit = limitExceeded ? willImport.slice(remainingCapacity) : []

    // Add limit-exceeded bookings to skip list
    for (const booking of wouldExceedLimit) {
      willSkip.push({
        bookingId: booking.bookingId,
        vehicleReg: booking.vehicleReg,
        customerName: booking.customerName,
        reason: 'Would exceed daily import limit',
        bookingDate: booking.bookingDate
      })
    }

    return c.json({
      success: true,
      date,
      summary: {
        totalBookings: response.totalCount,
        willImport: actualWillImport.length,
        willSkip: willSkip.length,
        alreadyImportedToday: importsToday,
        dailyLimit,
        remainingCapacity,
        limitWouldBeExceeded: limitExceeded
      },
      willImport: actualWillImport,
      willSkip,
      // Safety warning if auto-import would do something unexpected
      warnings: limitExceeded
        ? [`Import would be limited to ${remainingCapacity} bookings due to daily limit of ${dailyLimit}`]
        : []
    })

  } catch (err) {
    logger.error('Failed to preview import', { organizationId }, err as Error)
    return c.json({ error: 'Failed to preview import' }, 500)
  }
})

/**
 * DELETE /settings/credentials
 * Remove DMS credentials (keep other settings)
 */
dmsSettings.delete('/settings/credentials', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    // Cancel any scheduled imports
    const redisAvailable = await checkRedisConnection()
    if (redisAvailable) {
      await cancelDmsSchedule(organizationId)
    }

    // Clear credentials and disable
    const { error } = await supabaseAdmin
      .from('organization_dms_settings')
      .update({
        enabled: false,
        username_encrypted: null,
        password_encrypted: null,
        auto_import_enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('organization_id', organizationId)

    if (error) {
      throw error
    }

    logger.info('Removed DMS credentials', { organizationId })

    return c.json({ success: true, message: 'DMS credentials removed' })
  } catch (err) {
    logger.error('Failed to remove DMS credentials', { organizationId }, err as Error)
    return c.json({ error: 'Failed to remove credentials' }, 500)
  }
})

// ============================================
// Import Endpoints
// ============================================

/**
 * POST /import
 * Trigger manual DMS import
 */
dmsSettings.post('/import', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    const body = await c.req.json()
    const date = body.date || new Date().toISOString().split('T')[0]
    const endDate: string | undefined = body.endDate || undefined
    const siteId = body.site_id
    const skipLimitCheck = body.skipLimitCheck === true  // Allow override with confirmation
    const bookingIds: string[] | undefined = Array.isArray(body.bookingIds) ? body.bookingIds : undefined

    // Check if DMS is available
    const available = await isDmsAvailable(organizationId)
    if (!available) {
      return c.json({ error: 'DMS integration not configured' }, 400)
    }

    // Check daily import limit (unless explicitly skipped with confirmation)
    if (!skipLimitCheck) {
      const { data: settings } = await supabaseAdmin
        .from('organization_dms_settings')
        .select('daily_import_limit')
        .eq('organization_id', organizationId)
        .single()

      const dailyLimit = settings?.daily_import_limit || 100

      const { count: importsToday } = await supabaseAdmin
        .from('health_checks')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('external_source', 'gemini_osi')
        .gte('created_at', `${date}T00:00:00`)
        .lte('created_at', `${date}T23:59:59`)
        .is('deleted_at', null)

      if ((importsToday || 0) >= dailyLimit) {
        return c.json({
          error: 'Daily import limit reached',
          dailyLimit,
          importsToday: importsToday || 0,
          message: `You have reached the daily import limit of ${dailyLimit} health checks. Use preview to see pending bookings.`
        }, 429)  // Too Many Requests
      }
    }

    // Check if Redis is available for queueing
    const redisAvailable = await checkRedisConnection()

    if (redisAvailable && !body.sync) {
      // Queue the import job
      await queueDmsImport({
        type: 'dms_import',
        organizationId,
        siteId,
        date,
        endDate,
        importType: 'manual',
        triggeredBy: auth.user.id,
        bookingIds
      })

      logger.info('Queued DMS import', { organizationId, date })

      return c.json({
        success: true,
        message: 'Import job queued',
        queued: true
      })
    } else {
      // Run import synchronously
      const result = await runDmsImport({
        organizationId,
        siteId,
        date,
        endDate,
        importType: 'manual',
        triggeredBy: auth.user.id,
        bookingIds
      })

      return c.json({
        queued: false,
        ...result
      })
    }
  } catch (err) {
    logger.error('Failed to trigger DMS import', { organizationId }, err as Error)
    return c.json({ error: 'Failed to trigger import' }, 500)
  }
})

/**
 * GET /import/status
 * Get current import status
 */
dmsSettings.get('/import/status', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    // Get most recent import
    const { data: latestImport, error } = await supabaseAdmin
      .from('dms_import_history')
      .select('*')
      .eq('organization_id', organizationId)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw error
    }

    if (!latestImport) {
      return c.json({
        hasHistory: false,
        message: 'No imports found'
      })
    }

    return c.json({
      hasHistory: true,
      latestImport: {
        id: latestImport.id,
        status: latestImport.status,
        importType: latestImport.import_type,
        importDate: latestImport.import_date,
        startedAt: latestImport.started_at,
        completedAt: latestImport.completed_at,
        bookingsFound: latestImport.bookings_found,
        bookingsImported: latestImport.bookings_imported,
        bookingsSkipped: latestImport.bookings_skipped,
        bookingsFailed: latestImport.bookings_failed,
        customersCreated: latestImport.customers_created,
        vehiclesCreated: latestImport.vehicles_created,
        healthChecksCreated: latestImport.health_checks_created,
        errors: latestImport.errors
      }
    })
  } catch (err) {
    logger.error('Failed to get import status', { organizationId }, err as Error)
    return c.json({ error: 'Failed to get import status' }, 500)
  }
})

/**
 * GET /import/history
 * Get import history
 */
dmsSettings.get('/import/history', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '20')
    const offset = (page - 1) * limit

    // Get total count
    const { count } = await supabaseAdmin
      .from('dms_import_history')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)

    // Get paginated history
    const { data: history, error } = await supabaseAdmin
      .from('dms_import_history')
      .select(`
        *,
        triggered_by_user:triggered_by(first_name, last_name)
      `)
      .eq('organization_id', organizationId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    return c.json({
      history: history.map(h => ({
        id: h.id,
        status: h.status,
        importType: h.import_type,
        importDate: h.import_date,
        startedAt: h.started_at,
        completedAt: h.completed_at,
        bookingsFound: h.bookings_found,
        bookingsImported: h.bookings_imported,
        bookingsSkipped: h.bookings_skipped,
        bookingsFailed: h.bookings_failed,
        customersCreated: h.customers_created,
        vehiclesCreated: h.vehicles_created,
        healthChecksCreated: h.health_checks_created,
        errorCount: Array.isArray(h.errors) ? h.errors.length : 0,
        triggeredBy: h.triggered_by_user
          ? `${h.triggered_by_user.first_name} ${h.triggered_by_user.last_name}`
          : h.import_type === 'scheduled' ? 'System' : null
      })),
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (err) {
    logger.error('Failed to get import history', { organizationId }, err as Error)
    return c.json({ error: 'Failed to get import history' }, 500)
  }
})

/**
 * GET /import/:id
 * Get specific import details
 */
dmsSettings.get('/import/:id', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId
  const importId = c.req.param('id')

  try {
    const { data: importRecord, error } = await supabaseAdmin
      .from('dms_import_history')
      .select(`
        *,
        triggered_by_user:triggered_by(first_name, last_name)
      `)
      .eq('id', importId)
      .eq('organization_id', organizationId)
      .single()

    if (error || !importRecord) {
      return c.json({ error: 'Import not found' }, 404)
    }

    // Get health checks created in this import
    const { data: healthChecks } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        created_at,
        vehicle:vehicles(registration, make, model),
        customer:customers(first_name, last_name)
      `)
      .eq('import_batch_id', importId)
      .order('created_at', { ascending: false })

    return c.json({
      import: {
        id: importRecord.id,
        status: importRecord.status,
        importType: importRecord.import_type,
        importDate: importRecord.import_date,
        startedAt: importRecord.started_at,
        completedAt: importRecord.completed_at,
        bookingsFound: importRecord.bookings_found,
        bookingsImported: importRecord.bookings_imported,
        bookingsSkipped: importRecord.bookings_skipped,
        bookingsFailed: importRecord.bookings_failed,
        customersCreated: importRecord.customers_created,
        vehiclesCreated: importRecord.vehicles_created,
        healthChecksCreated: importRecord.health_checks_created,
        errors: importRecord.errors,
        triggeredBy: importRecord.triggered_by_user
          ? `${importRecord.triggered_by_user.first_name} ${importRecord.triggered_by_user.last_name}`
          : importRecord.import_type === 'scheduled' ? 'System' : null
      },
      healthChecks: healthChecks?.map(hc => {
        const vehicle = hc.vehicle as unknown as { registration: string; make: string | null; model: string | null } | null
        const customer = hc.customer as unknown as { first_name: string; last_name: string } | null
        return {
          id: hc.id,
          status: hc.status,
          createdAt: hc.created_at,
          vehicle: vehicle
            ? `${vehicle.registration} - ${vehicle.make || ''} ${vehicle.model || ''}`
            : null,
          customer: customer
            ? `${customer.first_name} ${customer.last_name}`
            : null
        }
      }) || []
    })
  } catch (err) {
    logger.error('Failed to get import details', { organizationId, importId }, err as Error)
    return c.json({ error: 'Failed to get import details' }, 500)
  }
})

// ============================================
// Unactioned Health Checks
// ============================================

/**
 * GET /unactioned
 * Get health checks in 'awaiting_arrival' status (from DMS import, waiting for vehicle)
 * Sorted: waiting customers first (prioritized), then by due_date/promise_time
 */
dmsSettings.get('/unactioned', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    const siteId = c.req.query('site_id')
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = (page - 1) * limit

    // Build query - look for awaiting_arrival status (DMS imports)
    // Include Phase 1 Quick Wins fields: customer_waiting, loan_car_required, due_date, booked_repairs
    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        external_id,
        external_source,
        created_at,
        promise_time,
        due_date,
        arrived_at,
        customer_waiting,
        loan_car_required,
        booked_repairs,
        jobsheet_number,
        vehicle:vehicles(id, registration, make, model),
        customer:customers(id, first_name, last_name, mobile)
      `, { count: 'exact' })
      .eq('organization_id', organizationId)
      .eq('status', 'awaiting_arrival')
      .is('deleted_at', null)
      .not('external_id', 'is', null)

    if (siteId) {
      query = query.eq('site_id', siteId)
    }

    // Get paginated results
    // Sort: customer_waiting DESC (waiting customers first), then by due_date/promise_time
    const { data: healthChecks, error, count } = await query
      .order('customer_waiting', { ascending: false })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('promise_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    // Calculate time since import and map to flat structure for frontend
    const now = new Date()
    const results = healthChecks.map(hc => {
      const createdAt = new Date(hc.created_at)
      const hoursSinceImport = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60))
      const vehicle = hc.vehicle as unknown as { id: string; registration: string; make: string | null; model: string | null } | null
      const customer = hc.customer as unknown as { id: string; first_name: string; last_name: string; mobile: string | null } | null

      // Return flat structure matching frontend AwaitingArrivalItem interface
      return {
        id: hc.id,
        status: hc.status,
        externalId: hc.external_id,
        externalSource: hc.external_source,
        // Flat fields for table display
        registration: vehicle?.registration || '',
        make: vehicle?.make || '',
        model: vehicle?.model || '',
        customerName: customer ? `${customer.first_name} ${customer.last_name}`.trim() : '',
        promiseTime: hc.promise_time,
        dueDate: hc.due_date,
        importedAt: hc.created_at,
        // Phase 1 Quick Wins - Priority indicators
        customerWaiting: hc.customer_waiting || false,
        loanCarRequired: hc.loan_car_required || false,
        bookedRepairs: hc.booked_repairs || [],
        jobsheetNumber: hc.jobsheet_number || null,
        // Additional useful fields
        hoursSinceImport,
        vehicleId: vehicle?.id || null,
        customerId: customer?.id || null,
        customerMobile: customer?.mobile || null
      }
    })

    return c.json({
      healthChecks: results,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (err) {
    logger.error('Failed to get unactioned health checks', { organizationId }, err as Error)
    return c.json({ error: 'Failed to get unactioned health checks' }, 500)
  }
})

export default dmsSettings
