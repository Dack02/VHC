/**
 * Follow-Up Settings routes — per-organisation control of the deferred-work
 * recovery automation: master enable/disable, automatic-sweep toggle, simulation
 * (dry-run) mode, and the send window / quiet hours. Also a "test send" that
 * dispatches a rendered sample of the org's actual follow-up message so admins
 * can verify templates, branding and credentials end to end.
 *
 * Settings live as columns on organization_settings (see
 * 20260614130000_follow_up_settings.sql). Mounted under
 * /api/v1/organizations/:orgId/follow-up-settings.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { sendSms } from '../services/sms.js'
import { sendEmail } from '../services/email.js'
import { renderFollowUpSample } from '../services/follow-up-engine.js'
import { getFollowUpSettings } from '../services/follow-up-settings.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const followUpSettings = new Hono()
followUpSettings.use('*', authMiddleware)

const WRITE_ROLES = ['super_admin', 'org_admin', 'site_admin'] as const

// GET /settings — current settings (camelCase) plus a small status panel.
followUpSettings.get('/settings', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const [settings, { data: row }, counts] = await Promise.all([
    getFollowUpSettings(orgId),
    supabaseAdmin
      .from('organization_settings')
      .select('follow_up_last_swept_at')
      .eq('organization_id', orgId)
      .maybeSingle(),
    (async () => {
      const byStatus = async (status: string) => {
        const { count } = await supabaseAdmin
          .from('follow_up_cases')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', status)
        return count || 0
      }
      const [active, manual, bookingFound, engaged] = await Promise.all([
        byStatus('active'),
        byStatus('manual'),
        byStatus('booking_found'),
        byStatus('engaged'),
      ])
      return { active, manual, bookingFound, engaged }
    })(),
  ])

  return c.json({
    settings: {
      enabled: settings.enabled,
      autoSweepEnabled: settings.autoSweepEnabled,
      simulationMode: settings.simulationMode,
      sendWindowEnabled: settings.sendWindowEnabled,
      sendWindowStart: settings.sendWindowStart,
      sendWindowEnd: settings.sendWindowEnd,
      skipWeekends: settings.skipWeekends,
      timezone: settings.timezone,
    },
    status: {
      lastSweptAt: row?.follow_up_last_swept_at || null,
      activeCases: counts.active,
      manualCases: counts.manual,
      bookingFoundCases: counts.bookingFound,
      engagedCases: counts.engaged,
      openCases: counts.active + counts.manual + counts.bookingFound + counts.engaged,
    },
  })
})

// PATCH /settings — update any subset of the settings (insert row if missing).
followUpSettings.patch('/settings', authorize([...WRITE_ROLES]), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)
  const body = await c.req.json()

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.enabled !== undefined) updateData.follow_up_enabled = body.enabled === true
  if (body.autoSweepEnabled !== undefined) updateData.follow_up_auto_sweep_enabled = body.autoSweepEnabled === true
  if (body.simulationMode !== undefined) updateData.follow_up_simulation_mode = body.simulationMode === true
  if (body.sendWindowEnabled !== undefined) updateData.follow_up_send_window_enabled = body.sendWindowEnabled === true
  if (body.skipWeekends !== undefined) updateData.follow_up_skip_weekends = body.skipWeekends === true
  if (body.sendWindowStart !== undefined) {
    if (!HM_RE.test(body.sendWindowStart)) return c.json({ error: 'Start time must be HH:MM' }, 400)
    updateData.follow_up_send_window_start = body.sendWindowStart
  }
  if (body.sendWindowEnd !== undefined) {
    if (!HM_RE.test(body.sendWindowEnd)) return c.json({ error: 'End time must be HH:MM' }, 400)
    updateData.follow_up_send_window_end = body.sendWindowEnd
  }

  const { data: existing } = await supabaseAdmin
    .from('organization_settings')
    .select('id')
    .eq('organization_id', orgId)
    .maybeSingle()

  const result = existing
    ? await supabaseAdmin.from('organization_settings').update(updateData).eq('organization_id', orgId)
    : await supabaseAdmin.from('organization_settings').insert({ organization_id: orgId, ...updateData })

  if (result.error) return c.json({ error: result.error.message }, 500)
  return c.json({ success: true })
})

// POST /test-sms — send a rendered sample follow-up SMS to a number.
followUpSettings.post('/test-sms', authorize([...WRITE_ROLES]), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)
  const body = await c.req.json()
  const to = (body.to || '').trim()
  if (!to) return c.json({ error: 'A phone number is required' }, 400)

  const sample = await renderFollowUpSample(orgId, 'sms')
  const result = await sendSms(to, sample.sms || '', orgId)
  if (result.success) return c.json({ success: true, message: `Sample follow-up SMS sent to ${to}` })
  return c.json({ success: false, error: result.error || 'Failed to send test SMS' })
})

// POST /test-email — send a rendered sample follow-up email to an address.
followUpSettings.post('/test-email', authorize([...WRITE_ROLES]), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)
  const body = await c.req.json()
  const to = (body.to || '').trim()
  if (!to || !EMAIL_RE.test(to)) return c.json({ error: 'A valid email address is required' }, 400)

  const sample = await renderFollowUpSample(orgId, 'email')
  const result = await sendEmail({
    to,
    subject: sample.subject || 'Sample follow-up',
    html: sample.html || '',
    text: sample.text || '',
    organizationId: orgId,
  })
  if (result.success) return c.json({ success: true, message: `Sample follow-up email sent to ${to}` })
  return c.json({ success: false, error: result.error || 'Failed to send test email' })
})

export default followUpSettings
