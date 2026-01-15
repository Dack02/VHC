/**
 * Queue Service - BullMQ job queue for background processing
 */

import { Queue } from 'bullmq'
import IORedis from 'ioredis'

// Redis connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
export const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null // Required for BullMQ
})

// Queue names
export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  REMINDERS: 'reminders',
  EMAILS: 'emails',
  SMS: 'sms'
} as const

// Create queues
export const notificationQueue = new Queue(QUEUE_NAMES.NOTIFICATIONS, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    },
    removeOnComplete: 100,
    removeOnFail: 500
  }
})

export const reminderQueue = new Queue(QUEUE_NAMES.REMINDERS, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 100,
    removeOnFail: 500
  }
})

export const emailQueue = new Queue(QUEUE_NAMES.EMAILS, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100,
    removeOnFail: 500
  }
})

export const smsQueue = new Queue(QUEUE_NAMES.SMS, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100,
    removeOnFail: 500
  }
})

// Job types
export interface SendEmailJob {
  type: 'send_email'
  to: string
  subject: string
  html: string
  text?: string
  healthCheckId?: string
  organizationId?: string
  templateId?: string
}

export interface SendSmsJob {
  type: 'send_sms'
  to: string
  message: string
  healthCheckId?: string
  organizationId?: string
}

export interface SendReminderJob {
  type: 'send_reminder'
  healthCheckId: string
  reminderNumber: number
  channel: 'email' | 'sms' | 'both'
  organizationId?: string
}

export interface ScheduleReminderJob {
  type: 'schedule_reminder'
  healthCheckId: string
  delayMs: number
  reminderNumber: number
}

export interface CustomerNotificationJob {
  type: 'customer_health_check_ready'
  healthCheckId: string
  customerId: string
  organizationId: string
  publicToken: string
  publicUrl: string
  sendEmail: boolean
  sendSms: boolean
  customerEmail?: string
  customerMobile?: string
  customMessage?: string
}

export interface StaffNotificationJob {
  type: 'staff_notification'
  notificationType:
    | 'customer_viewed'
    | 'customer_authorized'
    | 'customer_declined'
    | 'link_expiring'
    | 'link_expired'
    | 'tech_completed'
  healthCheckId: string
  organizationId: string
  siteId: string
  userId?: string // Target specific user, or broadcast to site
  metadata?: Record<string, unknown>
}

export type NotificationJob =
  | SendEmailJob
  | SendSmsJob
  | SendReminderJob
  | ScheduleReminderJob
  | CustomerNotificationJob
  | StaffNotificationJob

// Helper functions to add jobs
export async function queueEmail(job: SendEmailJob) {
  return emailQueue.add('email', job)
}

export async function queueSms(job: SendSmsJob) {
  return smsQueue.add('sms', job)
}

export async function queueNotification(job: NotificationJob) {
  return notificationQueue.add(job.type, job)
}

export async function scheduleReminder(
  healthCheckId: string,
  delayMs: number,
  reminderNumber: number
) {
  return reminderQueue.add(
    'reminder',
    {
      type: 'send_reminder',
      healthCheckId,
      reminderNumber,
      channel: 'both'
    } as SendReminderJob,
    {
      delay: delayMs,
      jobId: `reminder-${healthCheckId}-${reminderNumber}`
    }
  )
}

export async function cancelReminders(healthCheckId: string) {
  // Cancel all pending reminders for this health check
  for (let i = 1; i <= 5; i++) {
    const jobId = `reminder-${healthCheckId}-${i}`
    const job = await reminderQueue.getJob(jobId)
    if (job) {
      await job.remove()
    }
  }
}

// Check Redis connection
export async function checkRedisConnection(): Promise<boolean> {
  try {
    await redis.ping()
    return true
  } catch (error) {
    console.error('Redis connection failed:', error)
    return false
  }
}

// Graceful shutdown
export async function closeQueues() {
  await notificationQueue.close()
  await reminderQueue.close()
  await emailQueue.close()
  await smsQueue.close()
  await redis.quit()
}
