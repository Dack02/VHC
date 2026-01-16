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
  SMS: 'sms',
  DMS_IMPORT: 'dms-import'
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

export const dmsImportQueue = new Queue(QUEUE_NAMES.DMS_IMPORT, {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 50,
    removeOnFail: 100
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

export interface DmsImportJob {
  type: 'dms_import'
  organizationId: string
  siteId?: string
  date: string  // YYYY-MM-DD
  importType: 'manual' | 'scheduled'
  triggeredBy?: string  // user ID for manual imports
}

export interface DmsScheduledImportJob {
  type: 'dms_scheduled_import'
  organizationId: string
  siteId?: string
}

export type NotificationJob =
  | SendEmailJob
  | SendSmsJob
  | SendReminderJob
  | ScheduleReminderJob
  | CustomerNotificationJob
  | StaffNotificationJob

export type DmsJob = DmsImportJob | DmsScheduledImportJob

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

// DMS Import Queue Functions
export async function queueDmsImport(job: DmsImportJob) {
  const jobId = `dms-import-${job.organizationId}-${job.date}`
  return dmsImportQueue.add('import', job, { jobId })
}

export async function scheduleDmsImport(
  organizationId: string,
  siteId: string | undefined,
  hour: number,  // 0-23
  days: number[] // 0-6 (Sun-Sat)
) {
  // Calculate next run time
  const now = new Date()
  const nextRun = new Date()
  nextRun.setHours(hour, 0, 0, 0)

  // If we've already passed the hour today, schedule for tomorrow
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1)
  }

  // Find next valid day
  while (!days.includes(nextRun.getDay())) {
    nextRun.setDate(nextRun.getDate() + 1)
  }

  const delay = nextRun.getTime() - now.getTime()

  // Schedule the job
  const jobId = `dms-scheduled-${organizationId}`
  return dmsImportQueue.add(
    'scheduled',
    {
      type: 'dms_scheduled_import',
      organizationId,
      siteId
    } as DmsScheduledImportJob,
    {
      jobId,
      delay,
      repeat: {
        pattern: `0 ${hour} * * ${days.join(',')}`, // Cron pattern
        tz: 'Europe/London'
      }
    }
  )
}

export async function cancelDmsSchedule(organizationId: string) {
  const jobId = `dms-scheduled-${organizationId}`
  const job = await dmsImportQueue.getJob(jobId)
  if (job) {
    await job.remove()
  }

  // Also remove any repeatable jobs
  const repeatableJobs = await dmsImportQueue.getRepeatableJobs()
  for (const repeatJob of repeatableJobs) {
    if (repeatJob.id === jobId || repeatJob.name === jobId) {
      await dmsImportQueue.removeRepeatableByKey(repeatJob.key)
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
  await dmsImportQueue.close()
  await redis.quit()
}
