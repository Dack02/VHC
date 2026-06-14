/**
 * Library Gap Report Routes
 *
 * Per-organization settings (toggle, send time, skip-empty) plus the recipient
 * list (staff users and/or free-form emails) for the daily "Library Gap" digest.
 * Mounted under /api/v1/organizations/:orgId/library-gap-report.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const libraryGapReport = new Hono()
libraryGapReport.use('*', authMiddleware)

function localDateStr(tz: string | undefined): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz || 'Europe/London' })
}

function mapRecipient(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    userId: r.user_id || null,
    isActive: r.is_active,
    createdAt: r.created_at
  }
}

// GET /settings
libraryGapReport.get('/settings', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('library_gap_report_enabled, library_gap_report_time, library_gap_report_skip_empty')
    .eq('organization_id', orgId)
    .maybeSingle()

  return c.json({
    enabled: data?.library_gap_report_enabled === true,
    time: data?.library_gap_report_time || '07:00',
    skipEmpty: data?.library_gap_report_skip_empty !== false
  })
})

// PATCH /settings
libraryGapReport.patch('/settings', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)
  const body = await c.req.json()

  const { data: existing } = await supabaseAdmin
    .from('organization_settings')
    .select('id, timezone')
    .eq('organization_id', orgId)
    .maybeSingle()

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.enabled !== undefined) {
    updateData.library_gap_report_enabled = body.enabled === true
    // On enable, mark today as already-sent so the scheduler's first automatic
    // run is tomorrow at the configured time. Use "Send test" to verify now.
    if (body.enabled === true) {
      updateData.library_gap_report_last_sent_on = localDateStr(existing?.timezone as string | undefined)
    }
  }
  if (body.time !== undefined) updateData.library_gap_report_time = body.time
  if (body.skipEmpty !== undefined) updateData.library_gap_report_skip_empty = body.skipEmpty === true

  const result = existing
    ? await supabaseAdmin.from('organization_settings').update(updateData).eq('organization_id', orgId)
    : await supabaseAdmin.from('organization_settings').insert({ organization_id: orgId, ...updateData })

  if (result.error) return c.json({ error: result.error.message }, 500)
  return c.json({ success: true })
})

// GET /recipients
libraryGapReport.get('/recipients', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('library_gap_report_recipients')
    .select('id, name, email, user_id, is_active, created_at')
    .eq('organization_id', orgId)
    .order('name', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ recipients: (data || []).map(mapRecipient) })
})

// POST /recipients
libraryGapReport.post('/recipients', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)
  const body = await c.req.json()

  const name = (body.name || '').trim()
  const email = (body.email || '').trim().toLowerCase()
  const userId = body.userId || null

  if (!name) return c.json({ error: 'Name is required' }, 400)
  if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'A valid email is required' }, 400)

  const { data, error } = await supabaseAdmin
    .from('library_gap_report_recipients')
    .insert({ organization_id: orgId, name, email, user_id: userId })
    .select('id, name, email, user_id, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') return c.json({ error: 'That email is already a recipient' }, 409)
    return c.json({ error: error.message }, 500)
  }
  return c.json(mapRecipient(data), 201)
})

// PATCH /recipients/:id
libraryGapReport.patch('/recipients/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)
  const body = await c.req.json()

  const { data: existing } = await supabaseAdmin
    .from('library_gap_report_recipients')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!existing) return c.json({ error: 'Recipient not found' }, 404)

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) updateData.name = (body.name || '').trim()
  if (body.email !== undefined) {
    const email = (body.email || '').trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'A valid email is required' }, 400)
    updateData.email = email
  }
  if (body.isActive !== undefined) updateData.is_active = body.isActive === true

  const { data, error } = await supabaseAdmin
    .from('library_gap_report_recipients')
    .update(updateData)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('id, name, email, user_id, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') return c.json({ error: 'That email is already a recipient' }, 409)
    return c.json({ error: error.message }, 500)
  }
  return c.json(mapRecipient(data))
})

// DELETE /recipients/:id
libraryGapReport.delete('/recipients/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const id = c.req.param('id')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { error } = await supabaseAdmin
    .from('library_gap_report_recipients')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

// POST /send-now — manual trigger for testing (sends even when empty)
libraryGapReport.post('/send-now', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  try {
    const { sendLibraryGapReport } = await import('../services/library-gap-report.js')
    const result = await sendLibraryGapReport(orgId, { force: true })
    if (result.skipped && result.reason === 'no_recipients') {
      return c.json({ success: false, message: 'No active recipients configured' }, 400)
    }
    return c.json({ success: true, ...result })
  } catch (err) {
    console.error('Send library gap report error:', err)
    return c.json({ error: 'Failed to send report' }, 500)
  }
})

export default libraryGapReport
