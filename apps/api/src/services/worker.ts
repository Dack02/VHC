/**
 * Queue Worker - Processes background jobs
 * Run separately: npx tsx src/services/worker.ts
 */

import 'dotenv/config'
import { Worker, Job } from 'bullmq'
import {
  redis,
  QUEUE_NAMES,
  publishWebSocketEvent,
  type SendEmailJob,
  type SendSmsJob,
  type SendReminderJob,
  type CustomerNotificationJob,
  type StaffNotificationJob,
  type NotificationJob,
  type DmsImportJob,
  type DmsScheduledImportJob,
  type DmsJob
} from './queue.js'
import { runDmsImport } from '../jobs/dms-import.js'
import { sendEmail, sendHealthCheckReadyEmail, sendReminderEmail, sendCustomerResponseNotification, sendWorkflowStatusNotification, RepairItemResponse } from './email.js'
import { sendSms, sendHealthCheckReadySms, sendReminderSms, sendCustomerResponseNotificationSms } from './sms.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { WS_EVENTS } from './websocket.js'
import { sendPushNotification } from './web-push.js'

const PUSH_NOTIFICATION_TYPES = ['tech_completed', 'customer_authorized', 'customer_declined']

// Worker-side WebSocket helpers that publish via Redis pub/sub
// These allow the worker to emit events that the API server will receive and broadcast

function notifyHealthCheckStatusChanged(
  siteId: string,
  healthCheckId: string,
  data: Record<string, unknown>
) {
  const payload = { healthCheckId, ...data, timestamp: new Date().toISOString() }
  publishWebSocketEvent({ type: 'emit_to_site', targetId: siteId, event: WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED, data: payload })
  publishWebSocketEvent({ type: 'emit_to_health_check', targetId: healthCheckId, event: WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED, data: payload })
}

function notifyCustomerViewing(
  siteId: string,
  healthCheckId: string,
  data: Record<string, unknown>
) {
  const payload = { healthCheckId, ...data, timestamp: new Date().toISOString() }
  publishWebSocketEvent({ type: 'emit_to_site', targetId: siteId, event: WS_EVENTS.CUSTOMER_VIEWING, data: payload })
}

function notifyCustomerAction(
  siteId: string,
  healthCheckId: string,
  data: { action: 'authorized' | 'declined' | 'signed'; [key: string]: unknown }
) {
  const event =
    data.action === 'authorized'
      ? WS_EVENTS.CUSTOMER_AUTHORIZED
      : data.action === 'declined'
      ? WS_EVENTS.CUSTOMER_DECLINED
      : WS_EVENTS.CUSTOMER_SIGNED

  const payload = { healthCheckId, ...data, timestamp: new Date().toISOString() }
  publishWebSocketEvent({ type: 'emit_to_site', targetId: siteId, event, data: payload })
  publishWebSocketEvent({ type: 'emit_to_health_check', targetId: healthCheckId, event, data: payload })
}

function notifyLinkExpiring(
  siteId: string,
  healthCheckId: string,
  data: Record<string, unknown>
) {
  const payload = { healthCheckId, ...data, timestamp: new Date().toISOString() }
  publishWebSocketEvent({ type: 'emit_to_site', targetId: siteId, event: WS_EVENTS.LINK_EXPIRING, data: payload })
}

function notifyLinkExpired(
  siteId: string,
  healthCheckId: string,
  data: Record<string, unknown>
) {
  const payload = { healthCheckId, ...data, timestamp: new Date().toISOString() }
  publishWebSocketEvent({ type: 'emit_to_site', targetId: siteId, event: WS_EVENTS.LINK_EXPIRED, data: payload })
}

function sendUserNotification(
  userId: string,
  notification: {
    id: string
    type: string
    title: string
    message: string
    healthCheckId?: string
    priority?: string
    actionUrl?: string
  }
) {
  const payload = { ...notification, timestamp: new Date().toISOString() }
  publishWebSocketEvent({ type: 'emit_to_user', targetId: userId, event: WS_EVENTS.NOTIFICATION, data: payload })
}

console.log('Starting queue workers...')

/**
 * Increment organization usage counters
 */
async function incrementOrgUsage(
  organizationId: string,
  usage: { emails_sent?: number; sms_sent?: number; health_checks_created?: number }
) {
  try {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    // Try to update existing record
    const { data: existing } = await supabaseAdmin
      .from('organization_usage')
      .select('id, emails_sent, sms_sent, health_checks_created')
      .eq('organization_id', organizationId)
      .eq('period_start', periodStart)
      .single()

    if (existing) {
      // Update existing record
      await supabaseAdmin
        .from('organization_usage')
        .update({
          emails_sent: (existing.emails_sent || 0) + (usage.emails_sent || 0),
          sms_sent: (existing.sms_sent || 0) + (usage.sms_sent || 0),
          health_checks_created: (existing.health_checks_created || 0) + (usage.health_checks_created || 0),
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
    } else {
      // Create new record for this period
      await supabaseAdmin
        .from('organization_usage')
        .insert({
          organization_id: organizationId,
          period_start: periodStart,
          emails_sent: usage.emails_sent || 0,
          sms_sent: usage.sms_sent || 0,
          health_checks_created: usage.health_checks_created || 0
        })
    }
  } catch (error) {
    console.error('Failed to increment org usage:', error)
    // Don't throw - usage tracking shouldn't break the main flow
  }
}

/**
 * Email Worker
 */
const emailWorker = new Worker(
  QUEUE_NAMES.EMAILS,
  async (job: Job<SendEmailJob>) => {
    console.log(`Processing email job ${job.id}:`, job.data.subject)

    const result = await sendEmail({
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.html,
      text: job.data.text,
      organizationId: job.data.organizationId
    })

    if (!result.success) {
      throw new Error(result.error || 'Failed to send email')
    }

    // Log to database
    if (job.data.healthCheckId) {
      await supabaseAdmin.from('communication_logs').insert({
        health_check_id: job.data.healthCheckId,
        channel: 'email',
        recipient: job.data.to,
        subject: job.data.subject,
        status: 'sent',
        external_id: result.messageId
      })
    }

    // Track usage
    if (job.data.organizationId) {
      await incrementOrgUsage(job.data.organizationId, { emails_sent: 1 })
    }

    return result
  },
  { connection: redis as any }
)

emailWorker.on('completed', (job) => {
  console.log(`Email job ${job.id} completed`)
})

emailWorker.on('failed', (job, err) => {
  console.error(`Email job ${job?.id} failed:`, err.message)
})

/**
 * SMS Worker
 */
const smsWorker = new Worker(
  QUEUE_NAMES.SMS,
  async (job: Job<SendSmsJob>) => {
    console.log(`Processing SMS job ${job.id}:`, job.data.to)

    const result = await sendSms(job.data.to, job.data.message, job.data.organizationId)

    if (!result.success) {
      throw new Error(result.error || 'Failed to send SMS')
    }

    // Log to database
    if (job.data.healthCheckId) {
      await supabaseAdmin.from('communication_logs').insert({
        health_check_id: job.data.healthCheckId,
        channel: 'sms',
        recipient: job.data.to,
        message_body: job.data.message,
        status: 'sent',
        external_id: result.messageId
      })
    }

    // Track usage
    if (job.data.organizationId) {
      await incrementOrgUsage(job.data.organizationId, { sms_sent: 1 })
    }

    return result
  },
  { connection: redis as any }
)

smsWorker.on('completed', (job) => {
  console.log(`SMS job ${job.id} completed`)
})

smsWorker.on('failed', (job, err) => {
  console.error(`SMS job ${job?.id} failed:`, err.message)
})

/**
 * Notification Worker
 */
const notificationWorker = new Worker(
  QUEUE_NAMES.NOTIFICATIONS,
  async (job: Job<NotificationJob>) => {
    console.log(`Processing notification job ${job.id}:`, job.data.type)

    switch (job.data.type) {
      case 'customer_health_check_ready':
        await processCustomerNotification(job.data as CustomerNotificationJob)
        break

      case 'staff_notification':
        await processStaffNotification(job.data as StaffNotificationJob)
        break

      default:
        console.warn(`Unknown notification type: ${job.data.type}`)
    }
  },
  { connection: redis as any }
)

notificationWorker.on('completed', (job) => {
  console.log(`Notification job ${job.id} completed`)
})

notificationWorker.on('failed', (job, err) => {
  console.error(`Notification job ${job?.id} failed:`, err.message)
})

/**
 * Reminder Worker
 */
const reminderWorker = new Worker(
  QUEUE_NAMES.REMINDERS,
  async (job: Job<SendReminderJob>) => {
    console.log(`Processing reminder job ${job.id}:`, job.data.healthCheckId)

    await processReminder(job.data)
  },
  { connection: redis as any }
)

reminderWorker.on('completed', (job) => {
  console.log(`Reminder job ${job.id} completed`)
})

reminderWorker.on('failed', (job, err) => {
  console.error(`Reminder job ${job?.id} failed:`, err.message)
})

/**
 * DMS Import Worker
 */
const dmsImportWorker = new Worker(
  QUEUE_NAMES.DMS_IMPORT,
  async (job: Job<DmsJob>) => {
    console.log(`Processing DMS import job ${job.id}:`, job.data.type)

    // Determine import options based on job type
    let importOptions: {
      organizationId: string
      siteId?: string
      date: string
      endDate?: string
      importType: 'manual' | 'scheduled'
      triggeredBy?: string
      bookingIds?: string[]
    }

    if (job.data.type === 'dms_import') {
      // Manual or triggered import with specific date
      const importJob = job.data as DmsImportJob
      importOptions = {
        organizationId: importJob.organizationId,
        siteId: importJob.siteId,
        date: importJob.date,
        endDate: importJob.endDate,
        importType: importJob.importType,
        triggeredBy: importJob.triggeredBy,
        bookingIds: importJob.bookingIds
      }
    } else {
      // Scheduled import - use today's date and fetch next 2 working days ahead
      const scheduledJob = job.data as DmsScheduledImportJob
      const { getNextWorkingDays } = await import('../lib/date-utils.js')
      const today = new Date().toISOString().split('T')[0]
      const futureDays = getNextWorkingDays(new Date(), 2)
      const endDate = futureDays[futureDays.length - 1]

      importOptions = {
        organizationId: scheduledJob.organizationId,
        siteId: scheduledJob.siteId,
        date: today,
        endDate,
        importType: 'scheduled',
        triggeredBy: undefined
      }
    }

    console.log(`[DMS Import] Starting import for org ${importOptions.organizationId}, date ${importOptions.date}`)

    const result = await runDmsImport(importOptions)

    if (!result.success && result.errors.length > 0) {
      console.error(`[DMS Import] Import completed with errors:`, result.errors)
      // Don't throw for partial failures - the import record tracks them
      if (result.bookingsImported === 0 && result.bookingsFound > 0) {
        throw new Error(`Import failed: ${result.errors[0]?.error || 'All bookings failed to import'}`)
      }
    }

    console.log(`[DMS Import] Import completed:`, {
      found: result.bookingsFound,
      imported: result.bookingsImported,
      skipped: result.bookingsSkipped,
      failed: result.bookingsFailed
    })

    return result
  },
  { connection: redis as any }
)

dmsImportWorker.on('completed', (job) => {
  console.log(`DMS import job ${job.id} completed`)
})

dmsImportWorker.on('failed', (job, err) => {
  console.error(`DMS import job ${job?.id} failed:`, err.message)
})

/**
 * Process customer notification (health check ready)
 */
async function processCustomerNotification(data: CustomerNotificationJob) {
  // Get health check details
  const { data: healthCheck } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      organization_id,
      red_count,
      amber_count,
      green_count,
      vehicle:vehicles(registration, make, model),
      customer:customers(first_name, last_name, email, mobile),
      site:sites(name, phone, email)
    `)
    .eq('id', data.healthCheckId)
    .single()

  if (!healthCheck) {
    throw new Error(`Health check not found: ${data.healthCheckId}`)
  }

  // Cast nested relations for TypeScript
  const customer = healthCheck.customer as unknown as { first_name: string; last_name: string; email: string; mobile: string }
  const vehicle = healthCheck.vehicle as unknown as { registration: string; make: string; model: string }
  const site = healthCheck.site as unknown as { name: string; phone: string; email: string }

  const customerName = `${customer.first_name} ${customer.last_name}`
  const vehicleReg = vehicle.registration
  const vehicleMakeModel = `${vehicle.make} ${vehicle.model}`
  const organizationId = data.organizationId || healthCheck.organization_id

  // Send email if requested
  if (data.sendEmail && data.customerEmail) {
    console.log(`[Customer Notification] Sending email to ${data.customerEmail} for health check ${data.healthCheckId}`)

    const emailResult = await sendHealthCheckReadyEmail(
      data.customerEmail,
      customerName,
      vehicleReg,
      vehicleMakeModel,
      data.publicUrl,
      site.name,
      site.phone || '',
      healthCheck.red_count || 0,
      healthCheck.amber_count || 0,
      healthCheck.green_count || 0,
      data.customMessage,
      organizationId
    )

    console.log(`[Customer Notification] Email result:`, {
      success: emailResult.success,
      messageId: emailResult.messageId,
      error: emailResult.error,
      source: emailResult.source
    })

    await supabaseAdmin.from('communication_logs').insert({
      health_check_id: data.healthCheckId,
      channel: 'email',
      recipient: data.customerEmail,
      subject: `Your Vehicle Health Check is Ready - ${vehicleReg}`,
      status: emailResult.success ? 'sent' : 'failed',
      external_id: emailResult.messageId,
      error_message: emailResult.error
    })

    // Only track usage if actually sent
    if (emailResult.success) {
      await incrementOrgUsage(organizationId, { emails_sent: 1 })
    } else {
      console.error(`[Customer Notification] Email failed for ${data.healthCheckId}:`, emailResult.error)
    }
  }

  // Send SMS if requested
  if (data.sendSms && data.customerMobile) {
    console.log(`[Customer Notification] Sending SMS to ${data.customerMobile} for health check ${data.healthCheckId}`)

    const smsResult = await sendHealthCheckReadySms(
      data.customerMobile,
      customerName,
      vehicleReg,
      data.publicUrl,
      site.name,
      organizationId
    )

    console.log(`[Customer Notification] SMS result:`, {
      success: smsResult.success,
      messageId: smsResult.messageId,
      error: smsResult.error,
      source: smsResult.source
    })

    await supabaseAdmin.from('communication_logs').insert({
      health_check_id: data.healthCheckId,
      channel: 'sms',
      recipient: data.customerMobile,
      status: smsResult.success ? 'sent' : 'failed',
      external_id: smsResult.messageId,
      error_message: smsResult.error
    })

    // Only track usage if actually sent
    if (smsResult.success) {
      await incrementOrgUsage(organizationId, { sms_sent: 1 })
    } else {
      console.error(`[Customer Notification] SMS failed for ${data.healthCheckId}:`, smsResult.error)
    }
  }
}

/**
 * Process staff notification
 */
async function processStaffNotification(data: StaffNotificationJob) {
  console.log(`[Staff Notification] Processing: ${data.notificationType} for health check ${data.healthCheckId}, site ${data.siteId}`)

  // Get health check details
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
    throw new Error(`Health check not found: ${data.healthCheckId}`)
  }

  // Cast nested relations for TypeScript
  const vehicle = (healthCheck.vehicle as { registration: string }[] | null)?.[0]
  const customer = (healthCheck.customer as { first_name: string; last_name: string }[] | null)?.[0]

  if (!vehicle || !customer) {
    throw new Error(`Health check missing vehicle or customer data: ${data.healthCheckId}`)
  }

  const vehicleReg = vehicle.registration
  const customerName = `${customer.first_name} ${customer.last_name}`

  let title = ''
  let message = ''
  let priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'

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
      // Send email/SMS notification to advisor
      await sendAdvisorResponseNotification(
        data.healthCheckId,
        healthCheck.organization_id,
        data.metadata?.approvedCount as number || 0,
        data.metadata?.declinedCount as number || 0,
        data.metadata?.totalAuthorized as number || 0
      )
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
      // Send email/SMS notification to advisor
      await sendAdvisorResponseNotification(
        data.healthCheckId,
        healthCheck.organization_id,
        data.metadata?.approvedCount as number || 0,
        data.metadata?.declinedCount as number || 0,
        data.metadata?.totalAuthorized as number || 0
      )
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
      // Send email notification to advisor
      await sendWorkflowNotificationEmail(
        data.healthCheckId,
        healthCheck.organization_id,
        'check_complete',
        data.metadata?.technicianName as string
      )
      break
  }

  // Create in-app notification if targeting specific user
  if (data.userId) {
    await supabaseAdmin.from('notifications').insert({
      user_id: data.userId,
      type: data.notificationType,
      title,
      message,
      health_check_id: data.healthCheckId,
      priority,
      action_url: `/health-checks/${data.healthCheckId}`
    })

    sendUserNotification(data.userId, {
      id: crypto.randomUUID(),
      type: data.notificationType,
      title,
      message,
      healthCheckId: data.healthCheckId,
      priority,
      actionUrl: `/health-checks/${data.healthCheckId}`
    })

    // Fire-and-forget push notification for key event types
    if (PUSH_NOTIFICATION_TYPES.includes(data.notificationType)) {
      sendPushNotification(data.userId, {
        title,
        body: message,
        icon: '/favicon.ico',
        tag: `vhc-${data.notificationType}-${data.healthCheckId}`,
        data: {
          type: data.notificationType,
          actionUrl: `/health-checks/${data.healthCheckId}`,
          healthCheckId: data.healthCheckId
        }
      }).catch(() => {})
    }
  } else {
    // Broadcast to all site staff (service advisors and admins) + org_admins org-wide
    console.log(`[Staff Notification] Querying users for site ${data.siteId}`)

    // Site staff (advisors + site admins at this specific site)
    const { data: siteStaff, error: siteError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('site_id', data.siteId)
      .eq('is_active', true)
      .in('role', ['site_admin', 'service_advisor'])

    // Org admins (should see notifications for all sites in their org)
    const { data: orgAdmins, error: orgError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('organization_id', healthCheck.organization_id)
      .eq('is_active', true)
      .eq('role', 'org_admin')

    if (siteError) console.error(`[Staff Notification] Error querying site staff:`, siteError)
    if (orgError) console.error(`[Staff Notification] Error querying org admins:`, orgError)

    // Merge and deduplicate
    const seen = new Set<string>()
    const users: { id: string }[] = []
    for (const u of [...(siteStaff || []), ...(orgAdmins || [])]) {
      if (!seen.has(u.id)) {
        seen.add(u.id)
        users.push(u)
      }
    }

    console.log(`[Staff Notification] Found ${users.length} users to notify (${siteStaff?.length || 0} site staff + ${orgAdmins?.length || 0} org admins)`)

    if (users.length > 0) {
      for (const user of users) {
        console.log(`[Staff Notification] Creating notification for user ${user.id}`)
        const { error: insertError } = await supabaseAdmin.from('notifications').insert({
          user_id: user.id,
          type: data.notificationType,
          title,
          message,
          health_check_id: data.healthCheckId,
          priority,
          action_url: `/health-checks/${data.healthCheckId}`
        })

        if (insertError) {
          console.error(`[Staff Notification] Error inserting notification:`, insertError)
        } else {
          console.log(`[Staff Notification] Notification created for user ${user.id}`)
        }

        sendUserNotification(user.id, {
          id: crypto.randomUUID(),
          type: data.notificationType,
          title,
          message,
          healthCheckId: data.healthCheckId,
          priority,
          actionUrl: `/health-checks/${data.healthCheckId}`
        })

        // Fire-and-forget push notification for key event types
        if (PUSH_NOTIFICATION_TYPES.includes(data.notificationType)) {
          sendPushNotification(user.id, {
            title,
            body: message,
            icon: '/favicon.ico',
            tag: `vhc-${data.notificationType}-${data.healthCheckId}`,
            data: {
              type: data.notificationType,
              actionUrl: `/health-checks/${data.healthCheckId}`,
              healthCheckId: data.healthCheckId
            }
          }).catch(() => {})
        }
      }
    } else {
      console.log(`[Staff Notification] No users found to notify at site ${data.siteId}`)
    }
  }
}

/**
 * Process reminder
 */
async function processReminder(data: SendReminderJob) {
  // Get health check details
  const { data: healthCheck } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      organization_id,
      status,
      token_expires_at,
      public_token,
      vehicle:vehicles(registration),
      customer:customers(first_name, last_name, email, mobile),
      site:sites(name, phone, settings)
    `)
    .eq('id', data.healthCheckId)
    .single()

  if (!healthCheck) {
    console.log(`Health check not found: ${data.healthCheckId}`)
    return
  }

  // Don't send reminder if already responded
  if (['authorized', 'declined', 'completed'].includes(healthCheck.status)) {
    console.log(`Health check ${data.healthCheckId} already responded, skipping reminder`)
    return
  }

  // Don't send reminder if reminders have been disabled for this organization
  const { data: notifSettings } = await supabaseAdmin
    .from('organization_notification_settings')
    .select('default_reminder_enabled')
    .eq('organization_id', healthCheck.organization_id)
    .single()

  if (notifSettings?.default_reminder_enabled === false) {
    console.log(`Reminders disabled for org ${healthCheck.organization_id}, skipping reminder`)
    return
  }

  // Don't send reminder if expired
  if (healthCheck.token_expires_at && new Date(healthCheck.token_expires_at) < new Date()) {
    console.log(`Health check ${data.healthCheckId} expired, skipping reminder`)
    return
  }

  // Cast nested relations for TypeScript
  const customer = healthCheck.customer as unknown as { first_name: string; last_name: string; email: string; mobile: string }
  const vehicle = healthCheck.vehicle as unknown as { registration: string }
  const site = healthCheck.site as unknown as { name: string; phone: string; settings: unknown }

  const customerName = `${customer.first_name} ${customer.last_name}`
  const vehicleReg = vehicle.registration
  const publicUrl = `${process.env.WEB_URL || 'http://localhost:5181'}/view/${healthCheck.public_token}`
  const organizationId = data.organizationId || healthCheck.organization_id

  // Calculate hours remaining
  let hoursRemaining: number | undefined
  if (healthCheck.token_expires_at) {
    const expiresAt = new Date(healthCheck.token_expires_at)
    hoursRemaining = Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60))
  }

  // Send email reminder
  if (data.channel === 'email' || data.channel === 'both') {
    if (customer.email) {
      await sendReminderEmail(
        customer.email,
        customerName,
        vehicleReg,
        publicUrl,
        site.name,
        site.phone || '',
        hoursRemaining,
        organizationId
      )

      await supabaseAdmin.from('communication_logs').insert({
        health_check_id: data.healthCheckId,
        channel: 'email',
        recipient: customer.email,
        subject: `Reminder: Your Vehicle Health Check - ${vehicleReg}`,
        status: 'sent',
        template_id: 'reminder'
      })

      // Track usage
      await incrementOrgUsage(organizationId, { emails_sent: 1 })
    }
  }

  // Send SMS reminder
  if (data.channel === 'sms' || data.channel === 'both') {
    if (customer.mobile) {
      await sendReminderSms(
        customer.mobile,
        customerName,
        vehicleReg,
        publicUrl,
        site.name,
        hoursRemaining,
        organizationId
      )

      await supabaseAdmin.from('communication_logs').insert({
        health_check_id: data.healthCheckId,
        channel: 'sms',
        recipient: customer.mobile,
        status: 'sent',
        template_id: 'reminder'
      })

      // Track usage
      await incrementOrgUsage(organizationId, { sms_sent: 1 })
    }
  }

  // Update reminder count
  await supabaseAdmin
    .from('health_checks')
    .update({
      reminder_count: data.reminderNumber,
      last_reminder_at: new Date().toISOString()
    })
    .eq('id', data.healthCheckId)

  console.log(`Sent reminder #${data.reminderNumber} for health check ${data.healthCheckId}`)
}

/**
 * Send email/SMS notification to advisor when customer responds
 */
async function sendAdvisorResponseNotification(
  healthCheckId: string,
  organizationId: string,
  approvedCount: number,
  declinedCount: number,
  totalApproved: number
) {
  try {
    // Get health check with all related data
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        advisor_id,
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name, email, mobile),
        vehicle:vehicles(registration, make, model),
        customer:vehicles(customer:customers(first_name, last_name))
      `)
      .eq('id', healthCheckId)
      .single()

    if (!healthCheck || !healthCheck.advisor) {
      console.log('[Advisor Notification] No advisor assigned, skipping notification')
      return
    }

    const advisor = healthCheck.advisor as unknown as { id: string; first_name: string; last_name: string; email: string; mobile: string }
    const vehicle = healthCheck.vehicle as unknown as { registration: string; make: string; model: string }
    const customerData = healthCheck.customer as unknown as { customer: { first_name: string; last_name: string } }

    if (!advisor.email && !advisor.mobile) {
      console.log('[Advisor Notification] Advisor has no contact info, skipping notification')
      return
    }

    const advisorName = `${advisor.first_name} ${advisor.last_name}`
    const customerName = customerData?.customer ? `${customerData.customer.first_name} ${customerData.customer.last_name}` : 'Customer'
    const vehicleReg = vehicle?.registration || 'Unknown'
    const vehicleMakeModel = vehicle ? `${vehicle.make} ${vehicle.model}` : ''
    const healthCheckUrl = `${process.env.WEB_URL || 'http://localhost:5181'}/health-checks/${healthCheckId}`

    // Get notification settings to check if advisor should be notified
    const { data: settings } = await supabaseAdmin
      .from('organization_notification_settings')
      .select('staff_email_notifications, staff_sms_notifications')
      .eq('organization_id', organizationId)
      .single()

    const staffEmailEnabled = settings?.staff_email_notifications !== false
    const staffSmsEnabled = settings?.staff_sms_notifications !== false

    // Get repair items responses for detailed notification
    const { data: repairItems } = await supabaseAdmin
      .from('repair_items')
      .select(`
        id,
        name,
        total_inc_vat,
        customer_approved,
        customer_declined_reason,
        selected_option_id,
        options:repair_options(id, name)
      `)
      .eq('health_check_id', healthCheckId)
      .not('customer_approved', 'is', null)

    const responses: RepairItemResponse[] = (repairItems || []).map(item => {
      const selectedOption = item.options?.find((o: { id: string; name: string }) => o.id === item.selected_option_id)
      return {
        name: item.name,
        approved: item.customer_approved === true,
        selectedOption: selectedOption?.name || null,
        declinedReason: item.customer_declined_reason,
        totalIncVat: item.total_inc_vat || 0
      }
    })

    // Send email notification
    if (staffEmailEnabled && advisor.email) {
      console.log(`[Advisor Notification] Sending email to ${advisor.email}`)
      await sendCustomerResponseNotification(
        advisor.email,
        advisorName,
        customerName,
        vehicleReg,
        vehicleMakeModel,
        responses,
        totalApproved,
        healthCheckUrl,
        organizationId
      )
    }

    // Send SMS notification
    if (staffSmsEnabled && advisor.mobile) {
      console.log(`[Advisor Notification] Sending SMS to ${advisor.mobile}`)
      await sendCustomerResponseNotificationSms(
        advisor.mobile,
        advisorName,
        customerName,
        vehicleReg,
        approvedCount,
        declinedCount,
        totalApproved,
        organizationId
      )
    }

    console.log(`[Advisor Notification] Sent notification for health check ${healthCheckId}`)
  } catch (error) {
    console.error('[Advisor Notification] Error sending notification:', error)
  }
}

/**
 * Send workflow status email notification to advisor
 */
async function sendWorkflowNotificationEmail(
  healthCheckId: string,
  organizationId: string,
  statusType: 'check_complete' | 'awaiting_customer' | 'work_authorized' | 'work_complete',
  technicianName?: string,
  approvedCount?: number,
  totalValue?: number
) {
  try {
    // Get health check with all related data
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        advisor_id,
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name, email),
        vehicle:vehicles(registration, make, model)
      `)
      .eq('id', healthCheckId)
      .single()

    if (!healthCheck || !healthCheck.advisor) {
      console.log('[Workflow Notification] No advisor assigned, skipping notification')
      return
    }

    const advisor = healthCheck.advisor as unknown as { id: string; first_name: string; last_name: string; email: string }
    const vehicle = healthCheck.vehicle as unknown as { registration: string; make: string; model: string }

    if (!advisor.email) {
      console.log('[Workflow Notification] Advisor has no email, skipping notification')
      return
    }

    // Get notification settings
    const { data: settings } = await supabaseAdmin
      .from('organization_notification_settings')
      .select('staff_email_notifications')
      .eq('organization_id', organizationId)
      .single()

    if (settings?.staff_email_notifications === false) {
      console.log('[Workflow Notification] Staff email notifications disabled, skipping')
      return
    }

    const advisorName = `${advisor.first_name} ${advisor.last_name}`
    const vehicleReg = vehicle?.registration || 'Unknown'
    const vehicleMakeModel = vehicle ? `${vehicle.make} ${vehicle.model}` : ''
    const healthCheckUrl = `${process.env.WEB_URL || 'http://localhost:5181'}/health-checks/${healthCheckId}`

    console.log(`[Workflow Notification] Sending ${statusType} email to ${advisor.email}`)
    await sendWorkflowStatusNotification(
      advisor.email,
      advisorName,
      vehicleReg,
      vehicleMakeModel,
      statusType,
      healthCheckUrl,
      {
        technicianName,
        approvedCount,
        totalValue
      },
      organizationId
    )

    console.log(`[Workflow Notification] Sent ${statusType} notification for health check ${healthCheckId}`)
  } catch (error) {
    console.error('[Workflow Notification] Error sending notification:', error)
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log('Shutting down workers...')
  await Promise.all([
    emailWorker.close(),
    smsWorker.close(),
    notificationWorker.close(),
    reminderWorker.close(),
    dmsImportWorker.close()
  ])
  await redis.quit()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('Queue workers started')
