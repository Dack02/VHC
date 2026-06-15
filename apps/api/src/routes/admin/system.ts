/**
 * Super Admin system/infrastructure health.
 * GET /api/v1/admin/system/health?include=cheap|all
 *  - cheap: API uptime, DB connectivity, queue depths + worker liveness, comms config
 *  - all:   + DB size and migration status (via SECURITY DEFINER RPCs)
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'
import { isEncryptionConfigured } from '../../lib/encryption.js'
import {
  checkRedisConnection,
  notificationQueue, reminderQueue, emailQueue, smsQueue,
  dmsImportQueue, dailySmsOverviewQueue, closeStaleEntriesQueue,
  QUEUE_NAMES
} from '../../services/queue.js'

const adminSystem = new Hono()

adminSystem.use('*', superAdminMiddleware)

type ProbeStatus = 'ok' | 'degraded' | 'down' | 'unknown'

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
}

adminSystem.get('/health', async (c) => {
  const superAdmin = c.get('superAdmin')
  const include = c.req.query('include') || 'cheap'
  const deep = include === 'all'

  // --- API (trivially up if this handler runs) ---
  const api = {
    status: 'ok' as ProbeStatus,
    uptimeSeconds: Math.round(process.uptime()),
    nodeEnv: process.env.NODE_ENV || 'development'
  }

  // --- DB connectivity ---
  let db: { status: ProbeStatus; latencyMs?: number; detail?: string } = { status: 'down' }
  try {
    const start = Date.now()
    const { error } = await withTimeout(
      Promise.resolve(supabaseAdmin.from('organizations').select('id', { count: 'exact', head: true })),
      3000
    )
    db = error ? { status: 'down', detail: error.message } : { status: 'ok', latencyMs: Date.now() - start }
  } catch (e) {
    db = { status: 'down', detail: e instanceof Error ? e.message : 'error' }
  }

  // --- Redis + BullMQ queues + worker liveness ---
  const redisUp = await checkRedisConnection().catch(() => false)
  let queues: { status: ProbeStatus; redisConnected: boolean; workerCount: number; items: Array<Record<string, unknown>> } = {
    status: redisUp ? 'ok' : 'down',
    redisConnected: redisUp,
    workerCount: 0,
    items: []
  }
  if (redisUp) {
    const queueObjs: Array<[string, typeof emailQueue]> = [
      [QUEUE_NAMES.NOTIFICATIONS, notificationQueue],
      [QUEUE_NAMES.REMINDERS, reminderQueue],
      [QUEUE_NAMES.EMAILS, emailQueue],
      [QUEUE_NAMES.SMS, smsQueue],
      [QUEUE_NAMES.DMS_IMPORT, dmsImportQueue],
      [QUEUE_NAMES.DAILY_SMS_OVERVIEW, dailySmsOverviewQueue],
      [QUEUE_NAMES.CLOSE_STALE_ENTRIES, closeStaleEntriesQueue]
    ]
    const items = await Promise.all(queueObjs.map(async ([name, q]) => {
      try {
        const counts = await withTimeout(q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'), 3000)
        return { name, ...counts }
      } catch {
        return { name, error: true }
      }
    }))
    let workerCount = 0
    try {
      const workers = await withTimeout(emailQueue.getWorkers(), 3000)
      workerCount = workers.length
    } catch { /* leave 0 */ }
    queues = {
      status: workerCount > 0 ? 'ok' : 'degraded',
      redisConnected: true,
      workerCount,
      items
    }
  }

  // --- Outbound comms provider config (no live send) ---
  let comms: { status: ProbeStatus; smsConfigured: boolean; emailConfigured: boolean; encryptionConfigured: boolean } = {
    status: 'unknown', smsConfigured: false, emailConfigured: false, encryptionConfigured: false
  }
  try {
    const { data } = await supabaseAdmin.from('platform_settings').select('settings').eq('id', 'notifications').maybeSingle()
    const s = (data?.settings as Record<string, unknown>) || {}
    const smsConfigured = !!(s.twilio_account_sid && s.twilio_auth_token_encrypted && s.twilio_phone_number)
    const emailConfigured = !!(s.resend_api_key_encrypted && s.resend_from_email)
    comms = {
      status: (smsConfigured || emailConfigured) ? 'ok' : 'degraded',
      smsConfigured, emailConfigured,
      encryptionConfigured: isEncryptionConfigured()
    }
  } catch { /* leave unknown */ }

  const result: Record<string, unknown> = { api, db, queues, comms }

  // --- Deep probes (on demand) ---
  if (deep) {
    try {
      const { data } = await supabaseAdmin.rpc('admin_db_stats')
      result.database = data
    } catch (e) {
      result.database = { error: e instanceof Error ? e.message : 'failed' }
    }
    try {
      const { data } = await supabaseAdmin.rpc('admin_migration_status')
      result.migrations = data
    } catch (e) {
      result.migrations = { error: e instanceof Error ? e.message : 'failed' }
    }
  }

  // Overall rollup
  const statuses: ProbeStatus[] = [api.status, db.status, queues.status, comms.status]
  result.overall = statuses.includes('down') ? 'down' : statuses.includes('degraded') ? 'degraded' : 'ok'

  await logSuperAdminActivity(
    superAdmin.id, 'view_system_health', 'platform', undefined, { include },
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'), c.req.header('User-Agent')
  )

  return c.json(result)
})

export default adminSystem
