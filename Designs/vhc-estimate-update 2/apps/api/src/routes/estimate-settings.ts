/**
 * Estimate Settings routes — per-organisation control of the Estimates module:
 * tenant selling points (USPs), customer-link expiry, auto-expiry of stale estimates,
 * require-signature on accept, terms & conditions, and the online-booking config.
 *
 * Settings live as columns on organization_settings (estimates_send + estimate_usps +
 * estimate_online_booking migrations). Mounted under
 * /api/v1/organizations/:orgId/estimate-settings.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { getEstimateSettings, buildSettingsUpdate } from '../services/estimate-settings.js'

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

  let updateData: Record<string, unknown>
  try {
    updateData = buildSettingsUpdate(body)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Invalid settings' }, 400)
  }
  updateData.updated_at = new Date().toISOString()

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
