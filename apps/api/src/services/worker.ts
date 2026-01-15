/**
 * Queue Worker - Processes background jobs
 * Run separately: npx tsx src/services/worker.ts
 */

import { Worker, Job } from 'bullmq'
import {
  redis,
  QUEUE_NAMES,
  type SendEmailJob,
  type SendSmsJob,
  type SendReminderJob,
  type CustomerNotificationJob,
  type StaffNotificationJob,
  type NotificationJob
} from './queue.js'
import { sendEmail, sendHealthCheckReadyEmail, sendReminderEmail } from './email.js'
import { sendSms, sendHealthCheckReadySms, sendReminderSms } from './sms.js'
import { supabaseAdmin } from '../lib/supabase.js'
import {
  notifyHealthCheckStatusChanged,
  notifyCustomerViewing,
  notifyCustomerAction,
  notifyLinkExpiring,
  notifyLinkExpired,
  sendUserNotification
} from './websocket.js'

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
  { connection: redis }
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
  { connection: redis }
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
  { connection: redis }
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
  { connection: redis }
)

reminderWorker.on('completed', (job) => {
  console.log(`Reminder job ${job.id} completed`)
})

reminderWorker.on('failed', (job, err) => {
  console.error(`Reminder job ${job?.id} failed:`, err.message)
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
    await sendHealthCheckReadyEmail(
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

    await supabaseAdmin.from('communication_logs').insert({
      health_check_id: data.healthCheckId,
      channel: 'email',
      recipient: data.customerEmail,
      subject: `Your Vehicle Health Check is Ready - ${vehicleReg}`,
      status: 'sent'
    })

    // Track usage
    await incrementOrgUsage(organizationId, { emails_sent: 1 })
  }

  // Send SMS if requested
  if (data.sendSms && data.customerMobile) {
    await sendHealthCheckReadySms(
      data.customerMobile,
      customerName,
      vehicleReg,
      data.publicUrl,
      site.name,
      organizationId
    )

    await supabaseAdmin.from('communication_logs').insert({
      health_check_id: data.healthCheckId,
      channel: 'sms',
      recipient: data.customerMobile,
      status: 'sent'
    })

    // Track usage
    await incrementOrgUsage(organizationId, { sms_sent: 1 })
  }
}

/**
 * Process staff notification
 */
async function processStaffNotification(data: StaffNotificationJob) {
  // Get health check details
  const { data: healthCheck } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      vehicle:vehicles(registration),
      customer:customers(first_name, last_name)
    `)
    .eq('id', data.healthCheckId)
    .single()

  if (!healthCheck) {
    throw new Error(`Health check not found: ${data.healthCheckId}`)
  }

  // Cast nested relations for TypeScript
  const vehicle = healthCheck.vehicle as unknown as { registration: string }
  const customer = healthCheck.customer as unknown as { first_name: string; last_name: string }

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
  } else {
    // Broadcast to all site staff
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('site_id', data.siteId)
      .eq('is_active', true)
      .in('role', ['admin', 'manager', 'advisor'])

    if (users) {
      for (const user of users) {
        await supabaseAdmin.from('notifications').insert({
          user_id: user.id,
          type: data.notificationType,
          title,
          message,
          health_check_id: data.healthCheckId,
          priority,
          action_url: `/health-checks/${data.healthCheckId}`
        })

        sendUserNotification(user.id, {
          id: crypto.randomUUID(),
          type: data.notificationType,
          title,
          message,
          healthCheckId: data.healthCheckId,
          priority,
          actionUrl: `/health-checks/${data.healthCheckId}`
        })
      }
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
 * Graceful shutdown
 */
async function shutdown() {
  console.log('Shutting down workers...')
  await Promise.all([
    emailWorker.close(),
    smsWorker.close(),
    notificationWorker.close(),
    reminderWorker.close()
  ])
  await redis.quit()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('Queue workers started')
