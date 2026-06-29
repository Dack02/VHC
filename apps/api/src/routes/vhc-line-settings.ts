/**
 * VHC work-line settings — per-organisation control of the "automatic VHC work line".
 *
 * When a jobsheet is created with "Requires VHC" ticked, the commit flow can
 * auto-add a pre-authorised booked work line from a nominated service package so
 * the technician sees on the job card that a health check is to be performed.
 *
 * The nominated package lives as organization_settings.vhc_service_package_id
 * (20260630160000_vhc_auto_package.sql). NULL = feature off. Mounted under
 * /api/v1/organizations/:orgId/vhc-line-settings.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const vhcLineSettings = new Hono()
vhcLineSettings.use('*', authMiddleware)

const WRITE_ROLES = ['super_admin', 'org_admin', 'site_admin'] as const

// GET /settings — the currently nominated VHC service package (or null).
vhcLineSettings.get('/settings', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)

  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('vhc_service_package_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  return c.json({ settings: { vhcServicePackageId: data?.vhc_service_package_id ?? null } })
})

// PATCH /settings — nominate a package (or pass null/'' to turn the feature off).
vhcLineSettings.patch('/settings', authorize([...WRITE_ROLES]), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  if (orgId !== auth.orgId) return c.json({ error: 'Organisation not found' }, 404)
  const body = await c.req.json()

  if (body.vhcServicePackageId === undefined) {
    return c.json({ error: 'vhcServicePackageId is required' }, 400)
  }

  const raw = body.vhcServicePackageId
  let packageId: string | null = null
  if (raw !== null && raw !== '') {
    if (typeof raw !== 'string') return c.json({ error: 'Invalid service package' }, 400)
    // Only allow nominating an active package that belongs to this organisation.
    const { data: pkg } = await supabaseAdmin
      .from('service_packages')
      .select('id')
      .eq('id', raw)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle()
    if (!pkg) return c.json({ error: 'Service package not found' }, 404)
    packageId = pkg.id
  }

  const updateData = {
    vhc_service_package_id: packageId,
    updated_at: new Date().toISOString()
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
  return c.json({ success: true, settings: { vhcServicePackageId: packageId } })
})

export default vhcLineSettings
