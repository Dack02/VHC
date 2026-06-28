/**
 * Estimate Settings routes — per-organisation control of the Estimates module:
 * tenant selling points (USPs), customer-link expiry, auto-expiry of stale estimates,
 * require-signature on accept, and the terms & conditions text shown on the estimate portal.
 *
 * Settings live as columns on organization_settings (20260626160000_estimates_send.sql +
 * 20260627120000_estimate_usps.sql). Mounted under
 * /api/v1/organizations/:orgId/estimate-settings.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { getEstimateSettings, normaliseUsps } from '../services/estimate-settings.js'

const estimateSettings = new Hono()
estimateSettings.use('*', authMiddleware)

const WRITE_ROLES = ['super_admin', 'org_admin', 'site_admin'] as const

// GET /settings — current estimate settings (camelCase).
estimateSettings.get('/settings', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const settings = await getEstimateSettings(orgId)
  return c.json({ settings })
})

// PATCH /settings — update any subset (insert the org_settings row if missing).
estimateSettings.patch('/settings', authorize([...WRITE_ROLES]), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)
  const body = await c.req.json()

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.linkExpiryDays !== undefined) {
    const days = parseInt(body.linkExpiryDays, 10)
    if (isNaN(days) || days < 1 || days > 365) return c.json({ error: 'Link expiry must be 1–365 days' }, 400)
    updateData.estimate_link_expiry_days = days
  }
  if (body.autoExpire !== undefined) updateData.estimate_auto_expire = body.autoExpire === true
  if (body.requireSignature !== undefined) updateData.estimate_require_signature = body.requireSignature === true
  if (body.onlineBookingEnabled !== undefined) updateData.estimate_online_booking_enabled = body.onlineBookingEnabled === true
  if (body.termsText !== undefined) {
    const t = typeof body.termsText === 'string' ? body.termsText : ''
    if (t.length > 10000) return c.json({ error: 'Terms text is too long (max 10,000 characters)' }, 400)
    updateData.estimate_terms_text = t.trim() || null
  }
  if (body.usps !== undefined) {
    if (!Array.isArray(body.usps)) return c.json({ error: 'Selling points must be a list' }, 400)
    // Stored as JSONB; normalise (trim, drop empties, cap length + count) before persisting.
    updateData.estimate_usps = normaliseUsps(body.usps)
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

export default estimateSettings
