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
import { testConnection, isDmsAvailable } from '../services/gemini-osi.js'
import {
  queueDmsImport,
  scheduleDmsImport,
  cancelDmsSchedule,
  checkRedisConnection
} from '../services/queue.js'

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
        importScheduleHour: 20,
        importScheduleDays: [1, 2, 3, 4, 5, 6],
        importServiceTypes: ['service', 'mot', 'repair'],
        lastImportAt: null,
        lastImportStatus: null,
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
      importScheduleHour: settings.import_schedule_hour,
      importScheduleDays: settings.import_schedule_days,
      importServiceTypes: settings.import_service_types,
      lastImportAt: settings.last_import_at,
      lastImportStatus: settings.last_import_status,
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
    if (body.importScheduleHour !== undefined || body.import_schedule_hour !== undefined) {
      updateData.import_schedule_hour = body.importScheduleHour ?? body.import_schedule_hour
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
        body.importScheduleHour !== undefined || body.import_schedule_hour !== undefined ||
        body.importScheduleDays || body.import_schedule_days) {
      const redisAvailable = await checkRedisConnection()

      if (redisAvailable) {
        // Cancel existing schedule
        await cancelDmsSchedule(organizationId)

        // Create new schedule if enabled
        if (savedSettings.auto_import_enabled && savedSettings.enabled) {
          const days = savedSettings.import_schedule_days as number[] || [1, 2, 3, 4, 5, 6]
          await scheduleDmsImport(
            organizationId,
            undefined,
            savedSettings.import_schedule_hour || 20,
            days
          )
          logger.info('Scheduled DMS auto-import', {
            organizationId,
            hour: savedSettings.import_schedule_hour,
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
      importScheduleHour: savedSettings.import_schedule_hour,
      importScheduleDays: savedSettings.import_schedule_days,
      importServiceTypes: savedSettings.import_service_types,
      lastImportAt: savedSettings.last_import_at,
      lastImportStatus: savedSettings.last_import_status,
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

    // If credentials provided in request body, use those (for testing before save)
    if (body.apiUrl && body.username && body.password) {
      apiUrl = body.apiUrl
      username = body.username
      password = body.password
    } else {
      // Otherwise get from saved settings
      const { data: settings, error } = await supabaseAdmin
        .from('organization_dms_settings')
        .select('api_url, username_encrypted, password_encrypted')
        .eq('organization_id', organizationId)
        .single()

      if (error || !settings) {
        return c.json({ success: false, message: 'DMS settings not configured. Please enter credentials first.' }, 400)
      }

      if (!settings.api_url || !settings.username_encrypted || !settings.password_encrypted) {
        return c.json({ success: false, message: 'DMS credentials incomplete. Please fill in all fields.' }, 400)
      }

      apiUrl = settings.api_url

      // Decrypt username and password
      try {
        username = decrypt(settings.username_encrypted)
        password = decrypt(settings.password_encrypted)
      } catch {
        return c.json({ success: false, message: 'Failed to decrypt credentials' }, 500)
      }
    }

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

    logger.info('DMS connection test result', {
      organizationId,
      success: result.success,
      message: result.message
    })

    return c.json(result)
  } catch (err) {
    logger.error('DMS connection test failed', { organizationId }, err as Error)
    return c.json({ success: false, message: 'Connection test failed' }, 500)
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
    const siteId = body.site_id

    // Check if DMS is available
    const available = await isDmsAvailable(organizationId)
    if (!available) {
      return c.json({ error: 'DMS integration not configured' }, 400)
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
        importType: 'manual',
        triggeredBy: auth.user.id
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
        importType: 'manual',
        triggeredBy: auth.user.id
      })

      return c.json({
        success: result.success,
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
      healthChecks: healthChecks?.map(hc => ({
        id: hc.id,
        status: hc.status,
        createdAt: hc.created_at,
        vehicle: hc.vehicle
          ? `${hc.vehicle.registration} - ${hc.vehicle.make || ''} ${hc.vehicle.model || ''}`
          : null,
        customer: hc.customer
          ? `${hc.customer.first_name} ${hc.customer.last_name}`
          : null
      })) || []
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
 * Get health checks still in 'created' status (from DMS import)
 */
dmsSettings.get('/unactioned', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.orgId

  try {
    const siteId = c.req.query('site_id')
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = (page - 1) * limit

    // Build query
    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        status,
        external_id,
        external_source,
        created_at,
        promise_time,
        vehicle:vehicles(id, registration, make, model),
        customer:customers(id, first_name, last_name, mobile)
      `, { count: 'exact' })
      .eq('organization_id', organizationId)
      .eq('status', 'created')
      .is('deleted_at', null)
      .not('external_id', 'is', null)

    if (siteId) {
      query = query.eq('site_id', siteId)
    }

    // Get paginated results
    const { data: healthChecks, error, count } = await query
      .order('promise_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    // Calculate time since import
    const now = new Date()
    const results = healthChecks.map(hc => {
      const createdAt = new Date(hc.created_at)
      const hoursSinceImport = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60))

      return {
        id: hc.id,
        status: hc.status,
        externalId: hc.external_id,
        externalSource: hc.external_source,
        createdAt: hc.created_at,
        promiseTime: hc.promise_time,
        hoursSinceImport,
        vehicle: hc.vehicle ? {
          id: hc.vehicle.id,
          registration: hc.vehicle.registration,
          description: `${hc.vehicle.make || ''} ${hc.vehicle.model || ''}`.trim()
        } : null,
        customer: hc.customer ? {
          id: hc.customer.id,
          name: `${hc.customer.first_name} ${hc.customer.last_name}`,
          mobile: hc.customer.mobile
        } : null
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
