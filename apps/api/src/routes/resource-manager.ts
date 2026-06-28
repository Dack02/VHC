/**
 * Resource Manager API
 *
 * P0 surface: per-site capacity config. GET returns the saved config (or
 * all-defaults when none exists); PUT upserts it (site_admin+). The Booking
 * Diary reads the same config (via services/resource-config) to band days
 * against `target_loading_pct`.
 *
 * Site-scoped like the Booking Diary: an explicit ?siteId (validated against the
 * org) or the caller's own site.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { loadSiteConfig, type ResourceSiteConfig } from '../services/resource-config.js'

const resourceManager = new Hono()

resourceManager.use('*', authMiddleware)

const ADMIN_ROLES = ['super_admin', 'org_admin', 'site_admin'] as const
const ADVISOR_ROLES = [...ADMIN_ROLES, 'service_advisor'] as const

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

async function resolveSiteId(c: any): Promise<string | null> {
  const auth = c.get('auth')
  const requested = c.req.query('siteId')
  if (requested) {
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', requested)
      .eq('organization_id', auth.orgId)
      .single()
    return site ? site.id : null
  }
  return auth.user.siteId
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

// GET /config?siteId=...  → saved config or all-defaults
resourceManager.get('/config', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)

  const config = await loadSiteConfig(auth.orgId, siteId)
  return c.json({ siteId, config })
})

// PUT /config?siteId=...  → upsert (site_admin+)
resourceManager.put('/config', authorize([...ADMIN_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)

  let body: Partial<ResourceSiteConfig>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Start from the current (or default) config, then apply provided fields so a
  // partial PUT only changes what it sends.
  const current = await loadSiteConfig(auth.orgId, siteId)
  const merged: ResourceSiteConfig = { ...current }

  if (body.targetLoadingPct != null) merged.targetLoadingPct = clamp(Number(body.targetLoadingPct), 0.1, 2.0)
  if (body.overbookFactor != null) merged.overbookFactor = clamp(Number(body.overbookFactor), 1.0, 2.0)
  if (body.bookingLeadTimeDays != null) merged.bookingLeadTimeDays = clamp(Math.round(Number(body.bookingLeadTimeDays)), 0, 365)
  if (body.onlineLeadTimeHours != null) merged.onlineLeadTimeHours = clamp(Math.round(Number(body.onlineLeadTimeHours)), 0, 720)
  if (body.bookingMaxDays != null) merged.bookingMaxDays = clamp(Math.round(Number(body.bookingMaxDays)), 1, 365)
  if (body.releaseWindowDays != null) merged.releaseWindowDays = clamp(Math.round(Number(body.releaseWindowDays)), 0, 60)
  if (body.dropoffWindowStart != null) {
    if (!TIME_RE.test(body.dropoffWindowStart)) return c.json({ error: 'dropoffWindowStart must be HH:MM' }, 400)
    merged.dropoffWindowStart = body.dropoffWindowStart
  }
  if (body.dropoffWindowEnd != null) {
    if (!TIME_RE.test(body.dropoffWindowEnd)) return c.json({ error: 'dropoffWindowEnd must be HH:MM' }, 400)
    merged.dropoffWindowEnd = body.dropoffWindowEnd
  }
  if (body.dropoffSlotIntervalMinutes != null) merged.dropoffSlotIntervalMinutes = clamp(Math.round(Number(body.dropoffSlotIntervalMinutes)), 5, 120)
  if (body.dropoffSlotCapacity !== undefined) {
    merged.dropoffSlotCapacity = body.dropoffSlotCapacity == null ? null : clamp(Math.round(Number(body.dropoffSlotCapacity)), 1, 100)
  }
  if (body.enableSkillRouting != null) merged.enableSkillRouting = Boolean(body.enableSkillRouting)
  if (body.enableCategoryQuotas != null) merged.enableCategoryQuotas = Boolean(body.enableCategoryQuotas)

  if (merged.dropoffWindowEnd <= merged.dropoffWindowStart) {
    return c.json({ error: 'Drop-off window end must be after start' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('resource_site_config')
    .upsert({
      organization_id: auth.orgId,
      site_id: siteId,
      target_loading_pct: merged.targetLoadingPct,
      overbook_factor: merged.overbookFactor,
      booking_lead_time_days: merged.bookingLeadTimeDays,
      online_lead_time_hours: merged.onlineLeadTimeHours,
      booking_max_days: merged.bookingMaxDays,
      release_window_days: merged.releaseWindowDays,
      dropoff_window_start: merged.dropoffWindowStart,
      dropoff_window_end: merged.dropoffWindowEnd,
      dropoff_slot_interval_minutes: merged.dropoffSlotIntervalMinutes,
      dropoff_slot_capacity: merged.dropoffSlotCapacity,
      enable_skill_routing: merged.enableSkillRouting,
      enable_category_quotas: merged.enableCategoryQuotas,
      updated_at: new Date().toISOString()
    }, { onConflict: 'organization_id,site_id' })

  if (error) {
    console.error('resource_site_config upsert error:', error)
    return c.json({ error: 'Failed to save config' }, 500)
  }

  return c.json({ siteId, config: merged })
})

export default resourceManager
