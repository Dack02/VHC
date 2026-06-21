/**
 * Follow-Up Timelines — configurable cadences (steps with actions + offsets).
 * Mounted at /api/v1/organizations/:orgId/follow-up-timelines
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { renderFollowUpSampleFromTemplates } from '../services/follow-up-engine.js'
import { sendSms } from '../services/sms.js'
import { sendEmail } from '../services/email.js'

const timelines = new Hono()
timelines.use('*', authMiddleware)

const VALID_ACTIONS = ['send_sms', 'send_email', 'send_both', 'manual_call', 'auto_close']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapStep = (s: any) => ({
  id: s.id,
  stepOrder: s.step_order,
  action: s.action,
  offsetDays: s.offset_days,
  smsBody: s.sms_body,
  emailSubject: s.email_subject,
  emailBody: s.email_body,
  defaultOutcomeId: s.default_outcome_id,
})

const mapTimeline = (t: any) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  anchor: t.anchor,
  isDefault: t.is_default,
  isActive: t.is_active,
  steps: (t.steps || []).sort((a: any, b: any) => a.step_order - b.step_order).map(mapStep),
  createdAt: t.created_at,
  updatedAt: t.updated_at,
})

// GET / — list timelines with steps
timelines.get('/', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('follow_up_timelines')
    .select('*, steps:follow_up_timeline_steps(*)')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ timelines: (data || []).map(mapTimeline) })
})

// POST / — create timeline
timelines.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { name, description, anchor } = await c.req.json()
  if (!name || !name.trim()) return c.json({ error: 'Name is required' }, 400)
  const anchorVal = anchor === 'deferral_date' ? 'deferral_date' : 'due_date'

  const { data, error } = await supabaseAdmin
    .from('follow_up_timelines')
    .insert({ organization_id: orgId, name: name.trim(), description: description?.trim() || null, anchor: anchorVal, is_default: false, is_active: true })
    .select('*, steps:follow_up_timeline_steps(*)')
    .single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(mapTimeline(data), 201)
})

// PATCH /:id — update timeline (name/description/anchor/is_default)
timelines.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { name, description, anchor, is_default } = await c.req.json()
  const { data: existing } = await supabaseAdmin
    .from('follow_up_timelines')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Timeline not found' }, 404)

  const update: Record<string, unknown> = {}
  if (name !== undefined) update.name = name.trim()
  if (description !== undefined) update.description = description?.trim() || null
  if (anchor !== undefined) update.anchor = anchor === 'deferral_date' ? 'deferral_date' : 'due_date'

  // Setting as default — clear the flag on all other timelines for the org
  if (is_default === true) {
    await supabaseAdmin.from('follow_up_timelines').update({ is_default: false }).eq('organization_id', orgId)
    update.is_default = true
  } else if (is_default === false) {
    update.is_default = false
  }

  const { data, error } = await supabaseAdmin
    .from('follow_up_timelines')
    .update(update)
    .eq('id', id)
    .select('*, steps:follow_up_timeline_steps(*)')
    .single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(mapTimeline(data))
})

// PUT /:id/steps — replace the full step list
timelines.put('/:id/steps', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data: timeline } = await supabaseAdmin
    .from('follow_up_timelines')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!timeline) return c.json({ error: 'Timeline not found' }, 404)

  const body = await c.req.json()
  const steps = Array.isArray(body.steps) ? body.steps : []
  for (const s of steps) {
    if (!VALID_ACTIONS.includes(s.action)) return c.json({ error: `Invalid action: ${s.action}` }, 400)
  }

  // Replace: delete existing then insert re-numbered
  await supabaseAdmin.from('follow_up_timeline_steps').delete().eq('timeline_id', id)

  if (steps.length > 0) {
    const rows = steps.map((s: any, i: number) => ({
      timeline_id: id,
      organization_id: orgId,
      step_order: i + 1,
      action: s.action,
      offset_days: Number(s.offset_days) || 0,
      sms_body: s.sms_body?.trim() || null,
      email_subject: s.email_subject?.trim() || null,
      email_body: s.email_body?.trim() || null,
      default_outcome_id: s.default_outcome_id || null,
    }))
    const { error } = await supabaseAdmin.from('follow_up_timeline_steps').insert(rows)
    if (error) return c.json({ error: error.message }, 500)
  }

  const { data: updated } = await supabaseAdmin
    .from('follow_up_timelines')
    .select('*, steps:follow_up_timeline_steps(*)')
    .eq('id', id)
    .single()
  return c.json(mapTimeline(updated))
})

// DELETE /:id — soft delete
timelines.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data: existing } = await supabaseAdmin
    .from('follow_up_timelines')
    .select('id, is_default')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Timeline not found' }, 404)
  if (existing.is_default) return c.json({ error: 'Set another timeline as default before deleting this one' }, 400)

  const { error } = await supabaseAdmin
    .from('follow_up_timelines')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

// POST /:id/preview — render a branded sample of the message being edited.
// Templates come from the body so the preview reflects unsaved edits; blank
// templates fall back to the seeded sample copy. Read-only (no message sent).
timelines.post('/:id/preview', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const channel = body.channel === 'email' ? 'email' : 'sms'
  const sample = await renderFollowUpSampleFromTemplates(orgId, channel, {
    smsBody: typeof body.sms_body === 'string' ? body.sms_body : null,
    emailSubject: typeof body.email_subject === 'string' ? body.email_subject : null,
    emailBody: typeof body.email_body === 'string' ? body.email_body : null,
  })
  return c.json(sample)
})

// POST /:id/test-send — send a rendered sample of this timeline's message to a
// recipient, using the templates passed in (reflects unsaved edits).
timelines.post('/:id/test-send', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const channel = body.channel === 'email' ? 'email' : 'sms'
  const to = (body.to || '').trim()
  if (!to) return c.json({ error: 'A recipient is required' }, 400)

  const templates = {
    smsBody: typeof body.sms_body === 'string' ? body.sms_body : null,
    emailSubject: typeof body.email_subject === 'string' ? body.email_subject : null,
    emailBody: typeof body.email_body === 'string' ? body.email_body : null,
  }

  if (channel === 'sms') {
    const sample = await renderFollowUpSampleFromTemplates(orgId, 'sms', templates)
    const result = await sendSms(to, sample.sms || '', orgId)
    return result.success
      ? c.json({ success: true, message: `Sample SMS sent to ${to}` })
      : c.json({ success: false, error: result.error || 'Failed to send test SMS' })
  }

  if (!EMAIL_RE.test(to)) return c.json({ error: 'A valid email address is required' }, 400)
  const sample = await renderFollowUpSampleFromTemplates(orgId, 'email', templates)
  const result = await sendEmail({
    to,
    subject: sample.subject || 'Sample follow-up',
    html: sample.html || '',
    text: sample.text || '',
    organizationId: orgId,
  })
  return result.success
    ? c.json({ success: true, message: `Sample email sent to ${to}` })
    : c.json({ success: false, error: result.error || 'Failed to send test email' })
})

export default timelines
