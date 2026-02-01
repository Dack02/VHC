/**
 * Scheduler Service - Manages automatic reminder scheduling
 */

import { scheduleReminder, cancelReminders, queueNotification } from './queue.js'
import { supabaseAdmin } from '../lib/supabase.js'

// Default reminder schedule (can be overridden by organization settings)
const DEFAULT_REMINDER_SCHEDULE = [
  { hours: 4, reminderNumber: 1 },   // 4 hours after sending
  { hours: 24, reminderNumber: 2 },  // 24 hours after sending
  { hours: 48, reminderNumber: 3 }   // 48 hours after sending
]

/**
 * Schedule reminders for a health check after it's sent to customer
 */
export async function scheduleHealthCheckReminders(
  healthCheckId: string,
  sentAt: Date,
  expiresAt: Date | null,
  organizationSettings?: { reminder_schedule?: typeof DEFAULT_REMINDER_SCHEDULE }
) {
  const schedule = organizationSettings?.reminder_schedule || DEFAULT_REMINDER_SCHEDULE

  for (const reminder of schedule) {
    const sendAt = new Date(sentAt.getTime() + reminder.hours * 60 * 60 * 1000)

    // Don't schedule if it would be after expiry
    if (expiresAt && sendAt >= expiresAt) {
      console.log(`Skipping reminder ${reminder.reminderNumber} - would be after expiry`)
      continue
    }

    // Don't schedule if already in the past
    if (sendAt <= new Date()) {
      console.log(`Skipping reminder ${reminder.reminderNumber} - already past`)
      continue
    }

    const delayMs = sendAt.getTime() - Date.now()
    await scheduleReminder(healthCheckId, delayMs, reminder.reminderNumber)
    console.log(`Scheduled reminder ${reminder.reminderNumber} for health check ${healthCheckId} in ${Math.round(delayMs / 1000 / 60)} minutes`)
  }
}

/**
 * Cancel all reminders for a health check (when customer responds)
 */
export async function cancelHealthCheckReminders(healthCheckId: string) {
  await cancelReminders(healthCheckId)
  console.log(`Cancelled all reminders for health check ${healthCheckId}`)
}

/**
 * Schedule link expiry warning notification
 */
export async function scheduleLinkExpiryWarning(
  healthCheckId: string,
  siteId: string,
  expiresAt: Date
) {
  // Schedule warning 24 hours before expiry
  const warningTime = new Date(expiresAt.getTime() - 24 * 60 * 60 * 1000)

  if (warningTime > new Date()) {
    // Note: In a production system, this would schedule a delayed job
    // For now, we queue immediately (the checkExpiringLinks cron will handle timing)
    await queueNotification({
      type: 'staff_notification',
      notificationType: 'link_expiring',
      healthCheckId,
      siteId,
      metadata: {
        hoursRemaining: 24,
        expiresAt: expiresAt.toISOString()
      }
    })

    console.log(`Scheduled link expiry warning for health check ${healthCheckId}`)
  }
}

/**
 * Check for expiring/expired links and notify staff
 * Run this periodically (e.g., every hour via cron)
 */
export async function checkExpiringLinks() {
  const now = new Date()
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // Find health checks expiring in next 24 hours that haven't been warned about
  const { data: expiringSoon } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      site_id,
      token_expires_at,
      vehicle:vehicles(registration),
      customer:customers(first_name, last_name)
    `)
    .eq('status', 'sent')
    .gt('token_expires_at', now.toISOString())
    .lte('token_expires_at', in24Hours.toISOString())
    .is('expiry_warning_sent', null)

  for (const hc of expiringSoon || []) {
    const expiresAt = new Date(hc.token_expires_at)
    const hoursRemaining = Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60))
    const vehicle = hc.vehicle as unknown as { registration: string }
    const customer = hc.customer as unknown as { first_name: string; last_name: string }

    await queueNotification({
      type: 'staff_notification',
      notificationType: 'link_expiring',
      healthCheckId: hc.id,
      siteId: hc.site_id,
      metadata: {
        hoursRemaining,
        expiresAt: hc.token_expires_at,
        vehicleReg: vehicle.registration,
        customerName: `${customer.first_name} ${customer.last_name}`
      }
    })

    // Mark as warned
    await supabaseAdmin
      .from('health_checks')
      .update({ expiry_warning_sent: now.toISOString() })
      .eq('id', hc.id)
  }

  // Find health checks that have just expired
  const { data: justExpired } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      site_id,
      vehicle:vehicles(registration),
      customer:customers(first_name, last_name)
    `)
    .eq('status', 'sent')
    .lt('token_expires_at', now.toISOString())
    .is('expired_notification_sent', null)

  for (const hc of justExpired || []) {
    const vehicle = hc.vehicle as unknown as { registration: string }
    const customer = hc.customer as unknown as { first_name: string; last_name: string }

    await queueNotification({
      type: 'staff_notification',
      notificationType: 'link_expired',
      healthCheckId: hc.id,
      siteId: hc.site_id,
      metadata: {
        vehicleReg: vehicle.registration,
        customerName: `${customer.first_name} ${customer.last_name}`
      }
    })

    // Update status and mark as notified
    await supabaseAdmin
      .from('health_checks')
      .update({
        status: 'expired',
        expired_notification_sent: now.toISOString()
      })
      .eq('id', hc.id)
  }

  console.log(`Checked expiring links: ${expiringSoon?.length || 0} expiring soon, ${justExpired?.length || 0} just expired`)
}

/**
 * Notify staff when customer takes action
 */
export async function notifyCustomerAction(
  healthCheckId: string,
  siteId: string,
  action: 'viewed' | 'authorized' | 'declined' | 'signed',
  metadata?: Record<string, unknown>
) {
  const notificationTypeMap = {
    viewed: 'customer_viewed',
    authorized: 'customer_authorized',
    declined: 'customer_declined',
    signed: 'customer_authorized' // Treat signature as authorization confirmation
  } as const

  await queueNotification({
    type: 'staff_notification',
    notificationType: notificationTypeMap[action],
    healthCheckId,
    siteId,
    metadata
  })
}

/**
 * Delete activity logs older than 6 months.
 * Should be called once daily (e.g., via setInterval in server startup).
 */
export async function cleanupOldActivityLogs() {
  try {
    const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabaseAdmin
      .from('super_admin_activity_log')
      .delete()
      .lt('created_at', cutoff)

    if (error) {
      console.error('Activity log cleanup failed:', error.message)
    } else {
      console.log(`Activity log cleanup: deleted records older than 6 months (before ${cutoff})`)
    }
  } catch (error) {
    console.error('Activity log cleanup error:', error)
  }
}

/**
 * Start all daily scheduled cleanup tasks.
 * Called once at server startup; runs every 24 hours.
 */
export function startScheduledCleanupTasks() {
  // Run immediately on startup, then every 24 hours
  cleanupOldActivityLogs()
  setInterval(cleanupOldActivityLogs, 24 * 60 * 60 * 1000)
  console.log('Scheduled daily activity log cleanup')
}

/**
 * Notify staff when technician completes inspection
 */
export async function notifyTechnicianCompleted(
  healthCheckId: string,
  siteId: string,
  technicianId: string,
  metadata?: Record<string, unknown>
) {
  await queueNotification({
    type: 'staff_notification',
    notificationType: 'tech_completed',
    healthCheckId,
    siteId,
    metadata: {
      ...metadata,
      technicianId
    }
  })
}
