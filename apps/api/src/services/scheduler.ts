/**
 * Scheduler Service - Manages automatic reminder scheduling
 */

import { scheduleReminder, cancelReminders, queueNotification, scheduleDailySmsOverview, scheduleCloseStaleEntries, scheduleDmsImport, cancelDmsSchedule } from './queue.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { runFollowUpSweep } from './follow-up-engine.js'
import { sendLibraryGapReport } from './library-gap-report.js'
import { suppressAutomatedComms } from '../lib/comms-guard.js'
import { createOlloDevTicket } from './ollo-dev.js'

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

/**
 * Initialize daily SMS overview schedules for all enabled organizations.
 * Called once at server startup when Redis is available.
 */
export async function initializeDailySmsOverviewSchedules() {
  try {
    const { data: settings, error } = await supabaseAdmin
      .from('organization_notification_settings')
      .select('organization_id, daily_sms_overview_time')
      .eq('daily_sms_overview_enabled', true)

    if (error) {
      console.error('[Daily SMS Overview Scheduler] Error querying settings:', error)
      return
    }

    if (!settings || settings.length === 0) {
      console.log('[Daily SMS Overview Scheduler] No organizations with daily SMS overview enabled')
      return
    }

    for (const setting of settings) {
      const timeStr = setting.daily_sms_overview_time || '18:00'
      const [hourStr, minuteStr] = timeStr.split(':')
      const hour = parseInt(hourStr, 10)
      const minute = parseInt(minuteStr, 10)

      try {
        await scheduleDailySmsOverview(setting.organization_id, hour, minute)
        console.log(`[Daily SMS Overview Scheduler] Scheduled for org ${setting.organization_id} at ${timeStr}`)
      } catch (err) {
        console.error(`[Daily SMS Overview Scheduler] Failed to schedule for org ${setting.organization_id}:`, err)
      }
    }

    console.log(`[Daily SMS Overview Scheduler] Initialized ${settings.length} schedule(s)`)
  } catch (error) {
    console.error('[Daily SMS Overview Scheduler] Initialization error:', error)
  }
}

// Fallback import hours (mirrors DEFAULT_IMPORT_HOURS in routes/dms-settings.ts).
const DEFAULT_DMS_IMPORT_HOURS = [6, 10, 14, 20]

/**
 * Re-register DMS auto-import schedules for every enabled organisation on boot.
 *
 * BullMQ repeatable jobs live in Redis, so a Redis restart silently drops each
 * org's scheduled import. Unlike the SMS-overview / auto-close schedules, nothing
 * re-created the DMS ones — so after a restart scheduled imports stopped firing
 * until someone re-saved their DMS settings (which is why imports can go stale
 * for days). This restores them on startup, mirroring the settings-save handler
 * (cancel, then one repeatable job per configured hour).
 */
export async function initializeDmsImportSchedules() {
  try {
    const { data: settings, error } = await supabaseAdmin
      .from('organization_dms_settings')
      .select('organization_id, import_schedule_hours, import_schedule_days')
      .eq('enabled', true)
      .eq('auto_import_enabled', true)

    if (error) {
      console.error('[DMS Import Scheduler] Error querying settings:', error)
      return
    }

    if (!settings || settings.length === 0) {
      console.log('[DMS Import Scheduler] No organizations with auto-import enabled')
      return
    }

    for (const setting of settings) {
      const hours = (setting.import_schedule_hours as number[] | null) || DEFAULT_DMS_IMPORT_HOURS
      const days = (setting.import_schedule_days as number[] | null) || [1, 2, 3, 4, 5, 6]
      try {
        // Clear any stale entry first, then re-add one repeatable job per hour.
        await cancelDmsSchedule(setting.organization_id)
        for (const hour of hours) {
          await scheduleDmsImport(setting.organization_id, undefined, hour, days)
        }
        console.log(`[DMS Import Scheduler] Scheduled org ${setting.organization_id} at hours ${hours.join(',')}`)
      } catch (err) {
        console.error(`[DMS Import Scheduler] Failed to schedule for org ${setting.organization_id}:`, err)
      }
    }

    console.log(`[DMS Import Scheduler] Initialized ${settings.length} schedule(s)`)
  } catch (error) {
    console.error('[DMS Import Scheduler] Initialization error:', error)
  }
}

/**
 * Initialize end-of-day auto-close schedules for all organizations. Closes any
 * technician time entries left clocked on, so a forgotten clock-off can't run
 * the live board timer away. See docs/technician-job-clocking-spec.md §5.3.
 */
export async function initializeAutoCloseSchedules() {
  try {
    const { data: orgs, error } = await supabaseAdmin
      .from('organizations')
      .select('id')

    if (error || !orgs || orgs.length === 0) return

    for (const org of orgs) {
      const { data: settings } = await supabaseAdmin
        .from('organization_settings')
        .select('timezone')
        .eq('organization_id', org.id)
        .maybeSingle()

      try {
        await scheduleCloseStaleEntries(org.id, 22, 0, settings?.timezone || 'Europe/London')
      } catch (err) {
        console.error(`[Auto-close Scheduler] Failed to schedule for org ${org.id}:`, err)
      }
    }

    console.log(`[Auto-close Scheduler] Initialized ${orgs.length} schedule(s)`)
  } catch (error) {
    console.error('[Auto-close Scheduler] Initialization error:', error)
  }
}

/**
 * Start the Follow-Up sweep. Ticks every FOLLOW_UP_SWEEP_INTERVAL_MIN minutes
 * (default 30) rather than once a day, so per-org quiet hours / send windows can
 * be honoured: an out-of-window case is left due and dispatched on a later tick
 * once its window opens. The heavier deferred-item scan is still gated to once
 * per org per local day inside the engine, and the whole sweep is idempotent and
 * skips orgs that haven't opted in. In-process so it runs whether or not the
 * BullMQ worker / Redis are available. See docs/follow-up-module-spec.md §10.
 */
export function startFollowUpSweepSchedule() {
  const intervalMin = Math.max(1, parseInt(process.env.FOLLOW_UP_SWEEP_INTERVAL_MIN || '30', 10))
  const tickMs = intervalMin * 60 * 1000

  async function tick() {
    try {
      await runFollowUpSweep(undefined, { trigger: 'scheduled' })
    } catch (err) {
      console.error('[Follow-Up Sweep] Run failed:', err)
    }
  }

  setTimeout(tick, 60 * 1000) // first run shortly after startup
  setInterval(tick, tickMs)
  console.log(`[Follow-Up Sweep] Scheduled (every ${intervalMin} min, per-org send window aware)`)
}

// =============================================================================
// Library Gap Report — daily digest of manually-typed inspection notes.
// =============================================================================

const LIBRARY_GAP_TICK_MS = 15 * 60 * 1000

function hmToMinutes(hm: string): number {
  const [h, m] = (hm || '').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * One scheduler tick: for every org with the report enabled, send the digest if
 * the org-local clock has reached its configured time and it hasn't already run
 * today (tracked by library_gap_report_last_sent_on). Per-org timezone aware and
 * idempotent across restarts, so it works in-process without the BullMQ worker.
 */
export async function runLibraryGapReportTick() {
  // Skip the automated digest when automated comms are suppressed (e.g. on dev).
  // The manual "send now" route (routes/library-gap-report.ts) is unaffected.
  if (suppressAutomatedComms()) return
  try {
    const { data: settings, error } = await supabaseAdmin
      .from('organization_settings')
      .select('organization_id, library_gap_report_time, library_gap_report_last_sent_on, timezone')
      .eq('library_gap_report_enabled', true)

    if (error || !settings || settings.length === 0) return

    const now = new Date()
    for (const s of settings) {
      const tz = s.timezone || 'Europe/London'
      const localToday = now.toLocaleDateString('en-CA', { timeZone: tz })
      const localHm = now.toLocaleTimeString('en-GB', {
        timeZone: tz,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      })

      if (s.library_gap_report_last_sent_on === localToday) continue // already ran today
      if (hmToMinutes(localHm) < hmToMinutes(s.library_gap_report_time || '07:00')) continue // not time yet

      try {
        await sendLibraryGapReport(s.organization_id)
      } catch (err) {
        console.error(`[Library Gap Report] Send failed for org ${s.organization_id}:`, err)
      }

      // Mark as run today regardless of send/skip so we don't retry every tick.
      await supabaseAdmin
        .from('organization_settings')
        .update({ library_gap_report_last_sent_on: localToday })
        .eq('organization_id', s.organization_id)
    }
  } catch (err) {
    console.error('[Library Gap Report] Tick error:', err)
  }
}

/**
 * Start the Library Gap Report scheduler: tick shortly after startup, then every
 * 15 minutes. The per-org last_sent_on guard makes repeated ticks and restarts
 * safe. In-process so it runs in production (the BullMQ worker does not).
 */
export function startLibraryGapReportSchedule() {
  setTimeout(() => { runLibraryGapReportTick() }, 60 * 1000)
  setInterval(() => { runLibraryGapReportTick() }, LIBRARY_GAP_TICK_MS)
  console.log('[Library Gap Report] Scheduled (15-min tick, per-org send time)')
}

// =============================================================================
// Feedback sync retry — re-push feedback_tickets that failed to reach Ollo Dev.
// In-process so it runs whether or not the BullMQ worker / Redis are available.
// =============================================================================

const FEEDBACK_SYNC_TICK_MS = 2 * 60 * 1000
const FEEDBACK_SYNC_MAX_ATTEMPTS = 8

/**
 * One sweep: re-send any feedback ticket still pending/failed (under the attempt
 * cap) to Ollo Dev. Idempotent — Ollo Dev dedupes on (source_app, external_ref),
 * so a re-send after a lost response returns the same ticket rather than a dupe.
 */
export async function runFeedbackSyncRetryTick() {
  try {
    const { data: pending, error } = await supabaseAdmin
      .from('feedback_tickets')
      .select('id, type, subject, description, priority, reporter_name, reporter_email, reporter_role, reporter_org_name, diagnostics, sync_attempts')
      .in('sync_state', ['pending', 'failed'])
      .lt('sync_attempts', FEEDBACK_SYNC_MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(20)

    if (error || !pending || pending.length === 0) return

    for (const t of pending) {
      const { data: attachments } = await supabaseAdmin
        .from('feedback_attachments')
        .select('public_url, content_type, byte_size, storage_path')
        .eq('feedback_ticket_id', t.id)

      const attachmentPayload = (attachments ?? []).map((a, i) => ({
        url: a.public_url,
        name: (a.storage_path?.split('/').pop()) || `screenshot-${i + 1}`,
        type: a.content_type || 'image/jpeg',
        size: a.byte_size || 0,
      }))

      const push = await createOlloDevTicket({
        externalRef: t.id,
        type: t.type as 'bug' | 'feature' | 'question',
        subject: t.subject,
        description: t.description,
        priority: t.priority as 'low' | 'normal' | 'high' | 'urgent',
        reporter: {
          email: t.reporter_email,
          name: t.reporter_name,
          role: t.reporter_role || undefined,
          org: t.reporter_org_name || undefined,
        },
        attachments: attachmentPayload,
        diagnostics: (t.diagnostics as Record<string, unknown>) || {},
      })

      const attempts = (t.sync_attempts || 0) + 1
      if (push.success) {
        await supabaseAdmin
          .from('feedback_tickets')
          .update({
            ollo_dev_ticket_id: push.olloDevTicketId,
            sync_state: 'synced',
            sync_error: null,
            sync_attempts: attempts,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', t.id)
      } else {
        await supabaseAdmin
          .from('feedback_tickets')
          .update({
            sync_state: 'failed',
            sync_error: push.error ?? 'Sync failed',
            sync_attempts: attempts,
            updated_at: new Date().toISOString(),
          })
          .eq('id', t.id)
      }
    }
  } catch (err) {
    console.error('[Feedback Sync] Tick error:', err)
  }
}

/**
 * Start the feedback sync retry sweep: shortly after startup, then every 2 min.
 * The attempt cap + idempotent ingest make repeated ticks and restarts safe.
 */
export function startFeedbackSyncRetrySchedule() {
  setTimeout(() => { runFeedbackSyncRetryTick() }, 90 * 1000)
  setInterval(() => { runFeedbackSyncRetryTick() }, FEEDBACK_SYNC_TICK_MS)
  console.log('[Feedback Sync] Scheduled (2-min retry for unsynced feedback)')
}
