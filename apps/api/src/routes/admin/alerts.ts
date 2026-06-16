/**
 * Super Admin alerting: typed alert settings, recipients, and a generalised
 * inbox over ai_cost_alerts (now multi-source via the `source` column).
 * The legacy /admin/ai-usage/alerts endpoints + check_and_create_ai_alert()
 * keep working unchanged.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity, getClientIp } from '../../middleware/auth.js'

const adminAlerts = new Hono()

adminAlerts.use('*', superAdminMiddleware)

const ipUa = (c: { req: { header: (k: string) => string | undefined } }) =>
  [getClientIp(c), c.req.header('User-Agent')] as const

const orgName = (rel: unknown): string | null => {
  if (!rel) return null
  if (Array.isArray(rel)) return (rel[0] as { name?: string })?.name || null
  return (rel as { name?: string }).name || null
}

// --- Settings + recipients ---

adminAlerts.get('/settings', async (c) => {
  const [{ data: settings }, { data: recipients }] = await Promise.all([
    supabaseAdmin.from('platform_alert_settings').select('*').order('alert_type'),
    supabaseAdmin.from('platform_alert_recipients').select('*').order('created_at')
  ])
  return c.json({
    settings: (settings || []).map((s) => ({
      alertType: s.alert_type,
      isEnabled: s.is_enabled,
      threshold: s.threshold != null ? Number(s.threshold) : null,
      windowMinutes: s.window_minutes,
      config: s.config
    })),
    recipients: (recipients || []).map((r) => ({
      id: r.id,
      email: r.email,
      alertTypes: r.alert_types,
      isActive: r.is_active
    }))
  })
})

adminAlerts.patch('/settings/:alertType', async (c) => {
  const superAdmin = c.get('superAdmin')
  const alertType = c.req.param('alertType')
  const body = await c.req.json()
  const [ip, ua] = ipUa(c)

  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: superAdmin.id }
  if (body.isEnabled !== undefined) update.is_enabled = body.isEnabled
  if (body.threshold !== undefined) update.threshold = body.threshold
  if (body.windowMinutes !== undefined) update.window_minutes = body.windowMinutes
  if (body.config !== undefined) update.config = body.config

  const { error } = await supabaseAdmin
    .from('platform_alert_settings')
    .update(update)
    .eq('alert_type', alertType)
  if (error) return c.json({ error: error.message }, 500)

  // Back-compat: the AI cost evaluator reads platform_ai_settings.ai_cost_alert_threshold_usd
  if (alertType === 'ai_platform_cost' && body.threshold !== undefined && body.threshold !== null) {
    await supabaseAdmin.from('platform_ai_settings').upsert({
      key: 'ai_cost_alert_threshold_usd',
      value: String(body.threshold),
      updated_at: new Date().toISOString(),
      updated_by: superAdmin.id
    })
  }

  await logSuperAdminActivity(superAdmin.id, 'update_alert_settings', 'platform_alert_settings', undefined, { alertType, changes: Object.keys(body) }, ip, ua)
  return c.json({ success: true })
})

adminAlerts.post('/recipients', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()
  const [ip, ua] = ipUa(c)
  if (!body.email) return c.json({ error: 'email is required' }, 400)

  const { data, error } = await supabaseAdmin
    .from('platform_alert_recipients')
    .insert({ email: body.email, alert_types: body.alertTypes || [], created_by: superAdmin.id })
    .select()
    .single()
  if (error) return c.json({ error: error.message }, error.code === '23505' ? 409 : 500)

  await logSuperAdminActivity(superAdmin.id, 'add_alert_recipient', 'platform_alert_recipients', data.id, { email: body.email }, ip, ua)
  return c.json({ id: data.id, email: data.email, alertTypes: data.alert_types, isActive: data.is_active }, 201)
})

adminAlerts.delete('/recipients/:id', async (c) => {
  const superAdmin = c.get('superAdmin')
  const id = c.req.param('id')
  const [ip, ua] = ipUa(c)
  const { error } = await supabaseAdmin.from('platform_alert_recipients').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  await logSuperAdminActivity(superAdmin.id, 'remove_alert_recipient', 'platform_alert_recipients', id, {}, ip, ua)
  return c.json({ success: true })
})

// --- Inbox ---

adminAlerts.get('/count', async (c) => {
  const { count } = await supabaseAdmin
    .from('ai_cost_alerts')
    .select('*', { count: 'exact', head: true })
    .is('acknowledged_at', null)
  return c.json({ count: count || 0 })
})

adminAlerts.get('/history', async (c) => {
  const { page = '1', limit = '50' } = c.req.query()
  const pageNum = Math.max(1, parseInt(page))
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
  const offset = (pageNum - 1) * limitNum

  const { data, error, count } = await supabaseAdmin
    .from('ai_cost_alerts')
    .select('id, alert_type, source, organization_id, threshold_value, current_value, message, acknowledged_at, created_at, organizations(name)', { count: 'exact' })
    .not('acknowledged_at', 'is', null)
    .order('acknowledged_at', { ascending: false })
    .range(offset, offset + limitNum - 1)
  if (error) return c.json({ error: error.message }, 500)

  return c.json({
    alerts: (data || []).map((a) => ({
      id: a.id, type: a.alert_type, source: a.source,
      organizationId: a.organization_id, organizationName: orgName(a.organizations),
      thresholdValue: a.threshold_value != null ? Number(a.threshold_value) : null,
      currentValue: a.current_value != null ? Number(a.current_value) : null,
      message: a.message, acknowledgedAt: a.acknowledged_at, createdAt: a.created_at
    })),
    pagination: { page: pageNum, limit: limitNum, total: count || 0, pages: Math.ceil((count || 0) / limitNum) }
  })
})

adminAlerts.get('/', async (c) => {
  const { source } = c.req.query()
  let query = supabaseAdmin
    .from('ai_cost_alerts')
    .select('id, alert_type, source, organization_id, threshold_value, current_value, message, created_at, organizations(name)')
    .is('acknowledged_at', null)
  if (source) query = query.eq('source', source)
  query = query.order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)

  return c.json({
    alerts: (data || []).map((a) => ({
      id: a.id, type: a.alert_type, source: a.source,
      organizationId: a.organization_id, organizationName: orgName(a.organizations),
      thresholdValue: a.threshold_value != null ? Number(a.threshold_value) : null,
      currentValue: a.current_value != null ? Number(a.current_value) : null,
      message: a.message, createdAt: a.created_at
    }))
  })
})

adminAlerts.post('/:id/acknowledge', async (c) => {
  const superAdmin = c.get('superAdmin')
  const id = c.req.param('id')
  const [ip, ua] = ipUa(c)
  const { error } = await supabaseAdmin
    .from('ai_cost_alerts')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: superAdmin.id })
    .eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  await logSuperAdminActivity(superAdmin.id, 'acknowledge_alert', 'ai_cost_alerts', id, {}, ip, ua)
  return c.json({ success: true })
})

export default adminAlerts
