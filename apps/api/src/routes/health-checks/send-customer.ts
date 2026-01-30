import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { queueNotification } from '../../services/queue.js'
import { scheduleHealthCheckReminders } from '../../services/scheduler.js'
import { notifyHealthCheckStatusChanged } from '../../services/websocket.js'

const sendCustomer = new Hono()

// POST /:id/publish - Publish and send to customer
sendCustomer.post('/:id/publish', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { send_email = true, send_sms = false, expires_in_days = 7, message } = body

    // Get health check and verify it's ready to send
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id, status, customer_id, vehicle_id, site_id,
        vehicle:vehicles(registration),
        customer:customers(id, first_name, last_name, email, mobile)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Validate status allows sending
    const sendableStatuses = ['ready_to_send', 'sent', 'expired', 'opened', 'customer_viewed', 'customer_approved', 'customer_partial', 'customer_declined']
    if (!sendableStatuses.includes(healthCheck.status)) {
      return c.json({ error: `Cannot send health check in ${healthCheck.status} status` }, 400)
    }

    // Generate public token (random hex string)
    const publicToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Calculate expiry date
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expires_in_days)

    // Update health check with public token and status
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update({
        public_token: publicToken,
        token_expires_at: expiresAt.toISOString(),
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    // Record status change
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: healthCheck.status,
        to_status: 'sent',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: `Sent to customer via ${[send_email && 'email', send_sms && 'SMS'].filter(Boolean).join(' and ')}`
      })

    // Get organization and site settings for sending
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, settings')
      .eq('id', auth.orgId)
      .single()

    // Build public URL
    const publicUrl = `${process.env.PUBLIC_APP_URL || 'http://localhost:5183'}/view/${publicToken}`

    // Cast nested relations for TypeScript
    const vehicle = healthCheck.vehicle as unknown as { registration: string }
    const customer = healthCheck.customer as unknown as { id: string; first_name: string; last_name: string; email: string; mobile: string }

    // Queue customer notification (email/SMS)
    await queueNotification({
      type: 'customer_health_check_ready',
      healthCheckId: id,
      customerId: healthCheck.customer_id,
      organizationId: auth.orgId,
      publicToken,
      publicUrl,
      sendEmail: send_email,
      sendSms: send_sms,
      customerEmail: customer?.email,
      customerMobile: customer?.mobile,
      customMessage: message
    })

    // Schedule automatic reminders (only if enabled)
    const { data: notifSettings } = await supabaseAdmin
      .from('organization_notification_settings')
      .select('default_reminder_enabled')
      .eq('organization_id', auth.orgId)
      .single()

    if (notifSettings?.default_reminder_enabled !== false) {
      await scheduleHealthCheckReminders(
        id,
        new Date(),
        expiresAt,
        org?.settings
      )
    } else {
      console.log(`Reminders disabled for org ${auth.orgId}, skipping scheduling`)
    }

    // Send real-time notification to staff
    if (healthCheck.site_id) {
      notifyHealthCheckStatusChanged(healthCheck.site_id, id, {
        status: 'sent',
        previousStatus: healthCheck.status,
        vehicleReg: vehicle.registration,
        customerName: `${customer.first_name} ${customer.last_name}`,
        updatedBy: auth.user.email
      })
    }

    console.log('Health check published:', {
      id,
      publicUrl,
      sendEmail: send_email,
      sendSms: send_sms
    })

    return c.json({
      id: updated.id,
      status: updated.status,
      publicToken: updated.public_token,
      publicUrl,
      expiresAt: updated.token_expires_at,
      sentVia: {
        email: send_email,
        sms: send_sms
      }
    })
  } catch (error) {
    console.error('Publish health check error:', error)
    return c.json({ error: 'Failed to publish health check' }, 500)
  }
})

export default sendCustomer
