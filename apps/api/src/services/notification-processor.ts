/**
 * Direct Notification Processor - Handles notifications synchronously when Redis is unavailable.
 * Falls back to in-process handling instead of queuing via BullMQ.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import {
  notifyHealthCheckStatusChanged,
  notifyCustomerViewing,
  notifyCustomerAction,
  notifyLinkExpiring,
  notifyLinkExpired
} from './websocket.js'
import { createRoleNotifications } from '../routes/notifications.js'
import type { NotificationJob, StaffNotificationJob } from './queue.js'

/**
 * Process a notification job directly (without Redis/BullMQ).
 * Only handles staff_notification jobs - customer notifications (email/SMS)
 * require the full worker pipeline.
 */
export async function processNotificationDirect(job: NotificationJob): Promise<void> {
  switch (job.type) {
    case 'staff_notification':
      await processStaffNotificationDirect(job as StaffNotificationJob)
      break

    case 'customer_health_check_ready':
      console.warn('[Notification Direct] customer_health_check_ready requires Redis worker for email/SMS delivery - skipping')
      break

    case 'send_email':
    case 'send_sms':
    case 'send_reminder':
    case 'schedule_reminder':
      console.warn(`[Notification Direct] ${job.type} requires Redis worker - skipping`)
      break

    default:
      console.warn(`[Notification Direct] Unknown job type: ${(job as { type: string }).type} - skipping`)
  }
}

async function processStaffNotificationDirect(data: StaffNotificationJob): Promise<void> {
  console.log(`[Notification Direct] Processing staff_notification: ${data.notificationType} for health check ${data.healthCheckId}, site ${data.siteId}`)

  // Fetch health check details
  const { data: healthCheck } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      organization_id,
      vehicle:vehicles(registration),
      customer:customers(first_name, last_name)
    `)
    .eq('id', data.healthCheckId)
    .single()

  if (!healthCheck) {
    console.error(`[Notification Direct] Health check not found: ${data.healthCheckId}`)
    return
  }

  const vehicle = (healthCheck.vehicle as { registration: string }[] | null)?.[0]
  const customer = (healthCheck.customer as { first_name: string; last_name: string }[] | null)?.[0]

  if (!vehicle || !customer) {
    console.error(`[Notification Direct] Health check missing vehicle or customer data: ${data.healthCheckId}`)
    return
  }

  const vehicleReg = vehicle.registration
  const customerName = `${customer.first_name} ${customer.last_name}`

  let title = ''
  let message = ''
  let priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'

  // Build title/message/priority and emit WebSocket events
  switch (data.notificationType) {
    case 'customer_viewed':
      title = 'Customer Viewing Health Check'
      message = `${customerName} is viewing the health check for ${vehicleReg}`
      notifyCustomerViewing(data.siteId, data.healthCheckId, {
        vehicleReg,
        customerName,
        viewCount: (data.metadata?.viewCount as number) || 1,
        isFirstView: (data.metadata?.isFirstView as boolean) || false
      })
      break

    case 'customer_authorized':
      title = 'Work Authorized'
      message = `${customerName} authorized work on ${vehicleReg}`
      priority = 'high'
      notifyCustomerAction(data.siteId, data.healthCheckId, {
        vehicleReg,
        customerName,
        action: 'authorized',
        totalAuthorized: data.metadata?.totalAuthorized as number
      })
      break

    case 'customer_declined':
      title = 'Work Declined'
      message = `${customerName} declined work on ${vehicleReg}`
      notifyCustomerAction(data.siteId, data.healthCheckId, {
        vehicleReg,
        customerName,
        action: 'declined',
        totalDeclined: data.metadata?.totalDeclined as number
      })
      break

    case 'link_expiring':
      title = 'Link Expiring Soon'
      message = `Health check link for ${vehicleReg} expires in ${data.metadata?.hoursRemaining} hours`
      priority = 'high'
      notifyLinkExpiring(data.siteId, data.healthCheckId, {
        vehicleReg,
        customerName,
        hoursRemaining: data.metadata?.hoursRemaining as number,
        expiresAt: data.metadata?.expiresAt as string
      })
      break

    case 'link_expired':
      title = 'Link Expired'
      message = `Health check link for ${vehicleReg} has expired without response`
      priority = 'urgent'
      notifyLinkExpired(data.siteId, data.healthCheckId, {
        vehicleReg,
        customerName
      })
      break

    case 'tech_completed':
      title = 'Inspection Completed'
      message = `Technician completed inspection for ${vehicleReg}`
      notifyHealthCheckStatusChanged(data.siteId, data.healthCheckId, {
        status: 'completed',
        previousStatus: 'in_progress',
        vehicleReg,
        customerName
      })
      break
  }

  // Create in-app notifications for site advisors/admins via existing helper
  // This inserts into the notifications table AND emits per-user WebSocket events
  const roles = ['org_admin', 'site_admin', 'service_advisor']
  await createRoleNotifications(data.siteId, roles, data.notificationType, title, message, {
    healthCheckId: data.healthCheckId,
    priority,
    actionUrl: `/health-checks/${data.healthCheckId}`,
    organizationId: healthCheck.organization_id
  })

  console.log(`[Notification Direct] Completed ${data.notificationType} for ${vehicleReg}`)
}
