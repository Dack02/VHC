import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { scheduleDailySmsOverview, cancelDailySmsOverviewSchedule, queueDailySmsOverview } from '../services/queue.js'
import { isRedisConnected } from '../services/queue.js'

const dailySmsOverview = new Hono()

// Apply auth middleware to all routes
dailySmsOverview.use('*', authMiddleware)

// GET /recipients - List all recipients for this org
dailySmsOverview.get('/recipients', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data: recipients, error } = await supabaseAdmin
      .from('daily_sms_overview_recipients')
      .select('id, name, phone_number, site_id, is_active, created_at, updated_at, site:sites(id, name)')
      .eq('organization_id', orgId)
      .order('name', { ascending: true })

    if (error) {
      console.error('Get daily SMS recipients error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      recipients: (recipients || []).map(r => ({
        id: r.id,
        name: r.name,
        phoneNumber: r.phone_number,
        siteId: r.site_id,
        siteName: (r.site as any)?.name || null,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    })
  } catch (error) {
    console.error('Get daily SMS recipients error:', error)
    return c.json({ error: 'Failed to get recipients' }, 500)
  }
})

// POST /recipients - Add a recipient
dailySmsOverview.post('/recipients', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { name, phoneNumber, siteId } = body

    if (!name || !name.trim()) {
      return c.json({ error: 'Name is required' }, 400)
    }
    if (!phoneNumber || !phoneNumber.trim()) {
      return c.json({ error: 'Phone number is required' }, 400)
    }

    const { data: recipient, error } = await supabaseAdmin
      .from('daily_sms_overview_recipients')
      .insert({
        organization_id: orgId,
        name: name.trim(),
        phone_number: phoneNumber.trim(),
        site_id: siteId || null
      })
      .select('id, name, phone_number, site_id, is_active, created_at')
      .single()

    if (error) {
      console.error('Create daily SMS recipient error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: recipient.id,
      name: recipient.name,
      phoneNumber: recipient.phone_number,
      siteId: recipient.site_id,
      isActive: recipient.is_active,
      createdAt: recipient.created_at
    }, 201)
  } catch (error) {
    console.error('Create daily SMS recipient error:', error)
    return c.json({ error: 'Failed to create recipient' }, 500)
  }
})

// PATCH /recipients/:id - Update a recipient
dailySmsOverview.patch('/recipients/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const recipientId = c.req.param('id')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Verify recipient belongs to this org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('daily_sms_overview_recipients')
      .select('id')
      .eq('id', recipientId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Recipient not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) updateData.name = body.name.trim()
    if (body.phoneNumber !== undefined) updateData.phone_number = body.phoneNumber.trim()
    if (body.siteId !== undefined) updateData.site_id = body.siteId || null
    if (body.isActive !== undefined) updateData.is_active = body.isActive

    const { data: updated, error } = await supabaseAdmin
      .from('daily_sms_overview_recipients')
      .update(updateData)
      .eq('id', recipientId)
      .select('id, name, phone_number, site_id, is_active, updated_at')
      .single()

    if (error) {
      console.error('Update daily SMS recipient error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      name: updated.name,
      phoneNumber: updated.phone_number,
      siteId: updated.site_id,
      isActive: updated.is_active,
      updatedAt: updated.updated_at
    })
  } catch (error) {
    console.error('Update daily SMS recipient error:', error)
    return c.json({ error: 'Failed to update recipient' }, 500)
  }
})

// DELETE /recipients/:id - Remove a recipient
dailySmsOverview.delete('/recipients/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const recipientId = c.req.param('id')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('daily_sms_overview_recipients')
      .delete()
      .eq('id', recipientId)
      .eq('organization_id', orgId)

    if (error) {
      console.error('Delete daily SMS recipient error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete daily SMS recipient error:', error)
    return c.json({ error: 'Failed to delete recipient' }, 500)
  }
})

// GET /settings - Get daily SMS overview settings
dailySmsOverview.get('/settings', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data: settings, error } = await supabaseAdmin
      .from('organization_notification_settings')
      .select('daily_sms_overview_enabled, daily_sms_overview_time')
      .eq('organization_id', orgId)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Get daily SMS settings error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      enabled: settings?.daily_sms_overview_enabled ?? false,
      time: settings?.daily_sms_overview_time ?? '18:00'
    })
  } catch (error) {
    console.error('Get daily SMS settings error:', error)
    return c.json({ error: 'Failed to get settings' }, 500)
  }
})

// PATCH /settings - Update daily SMS overview settings
dailySmsOverview.patch('/settings', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.enabled !== undefined) updateData.daily_sms_overview_enabled = body.enabled
    if (body.time !== undefined) updateData.daily_sms_overview_time = body.time

    // Upsert settings
    const { data: existing } = await supabaseAdmin
      .from('organization_notification_settings')
      .select('id')
      .eq('organization_id', orgId)
      .single()

    if (existing) {
      await supabaseAdmin
        .from('organization_notification_settings')
        .update(updateData)
        .eq('organization_id', orgId)
    } else {
      await supabaseAdmin
        .from('organization_notification_settings')
        .insert({
          organization_id: orgId,
          ...updateData
        })
    }

    // Reschedule or cancel the cron job
    const enabled = body.enabled ?? existing ? true : false
    const time = body.time || '18:00'
    const [hourStr, minuteStr] = time.split(':')
    const hour = parseInt(hourStr, 10)
    const minute = parseInt(minuteStr, 10)

    if (isRedisConnected()) {
      if (body.enabled === true || (body.time !== undefined && enabled)) {
        await scheduleDailySmsOverview(orgId, hour, minute)
        console.log(`[Daily SMS Overview] Rescheduled for org ${orgId} at ${time}`)
      } else if (body.enabled === false) {
        await cancelDailySmsOverviewSchedule(orgId)
        console.log(`[Daily SMS Overview] Cancelled schedule for org ${orgId}`)
      }
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Update daily SMS settings error:', error)
    return c.json({ error: 'Failed to update settings' }, 500)
  }
})

// POST /send-now - Manual trigger for testing
dailySmsOverview.post('/send-now', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    if (isRedisConnected()) {
      await queueDailySmsOverview({
        type: 'daily_sms_overview',
        organizationId: orgId
      })
      return c.json({ success: true, message: 'Daily SMS overview queued for sending' })
    } else {
      // Process directly if Redis is not available
      const { sendDailySmsOverview } = await import('../services/daily-sms-overview.js')
      await sendDailySmsOverview(orgId)
      return c.json({ success: true, message: 'Daily SMS overview sent' })
    }
  } catch (error) {
    console.error('Send daily SMS overview error:', error)
    return c.json({ error: 'Failed to send daily SMS overview' }, 500)
  }
})

export default dailySmsOverview
