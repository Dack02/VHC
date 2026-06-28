/**
 * Expiry reminder campaigns — per expiry type, an opt-in reminder that texts/
 * emails the vehicle's reminder recipient when the date falls inside the lead
 * window. Reuses the comms send primitives via services/expiry-reminders.ts.
 *
 * Gated by the `vehicle_reminders` module (opt-in; touches outbound comms).
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { getCampaignAudienceCount, processExpiryRemindersForOrg } from '../services/expiry-reminders.js'

const expiryCampaigns = new Hono()

expiryCampaigns.use('*', authMiddleware)
expiryCampaigns.use('*', requireModule('vehicle_reminders'))

// GET / — campaigns joined to their expiry type
expiryCampaigns.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { data, error } = await supabaseAdmin
      .from('expiry_campaigns')
      .select('id, expiry_type_id, name, channel, message_template, lead_days, is_enabled, updated_at, expiry_type:expiry_types(id, code, label, is_active, default_lead_days, default_channel)')
      .eq('organization_id', auth.orgId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ campaigns: data || [] })
  } catch (error) {
    console.error('List expiry campaigns error:', error)
    return c.json({ error: 'Failed to list campaigns' }, 500)
  }
})

// PUT / — upsert a campaign for an expiry type
expiryCampaigns.put('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { expiryTypeId, name, channel = 'sms', messageTemplate, leadDays = 30, isEnabled = false } = body
    if (!expiryTypeId) return c.json({ error: 'expiryTypeId is required' }, 400)

    const { data: type } = await supabaseAdmin
      .from('expiry_types').select('id, label').eq('id', expiryTypeId).eq('organization_id', auth.orgId).maybeSingle()
    if (!type) return c.json({ error: 'Expiry type not found' }, 404)

    const { data: existing } = await supabaseAdmin
      .from('expiry_campaigns').select('id').eq('organization_id', auth.orgId).eq('expiry_type_id', expiryTypeId).maybeSingle()

    const payload = {
      organization_id: auth.orgId,
      expiry_type_id: expiryTypeId,
      name: name || `${type.label} reminder`,
      channel,
      message_template: messageTemplate || null,
      lead_days: leadDays,
      is_enabled: !!isEnabled
    }

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('expiry_campaigns').update(payload).eq('id', existing.id).select('*').single()
      if (error) return c.json({ error: error.message }, 500)
      return c.json(data)
    }
    const { data, error } = await supabaseAdmin
      .from('expiry_campaigns').insert(payload).select('*').single()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data, 201)
  } catch (error) {
    console.error('Upsert expiry campaign error:', error)
    return c.json({ error: 'Failed to save campaign' }, 500)
  }
})

// GET /:id/audience-count — preview how many vehicles the campaign would reach
expiryCampaigns.get('/:id/audience-count', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { data: campaign } = await supabaseAdmin
      .from('expiry_campaigns')
      .select('lead_days, expiry_type:expiry_types(code)')
      .eq('id', id).eq('organization_id', auth.orgId).maybeSingle()
    if (!campaign) return c.json({ error: 'Campaign not found' }, 404)
    const typeCode = (campaign.expiry_type as { code?: string } | null)?.code
    if (!typeCode) return c.json({ count: 0 })
    const count = await getCampaignAudienceCount(auth.orgId, typeCode, campaign.lead_days)
    return c.json({ count })
  } catch (error) {
    console.error('Audience count error:', error)
    return c.json({ error: 'Failed to compute audience' }, 500)
  }
})

// POST /run — run the enabled campaigns now (manual trigger; the daily sweep also runs them)
expiryCampaigns.post('/run', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { dryRun = false } = await c.req.json().catch(() => ({}))
    const sent = await processExpiryRemindersForOrg(auth.orgId, !!dryRun)
    return c.json({ success: true, sent, dryRun: !!dryRun })
  } catch (error) {
    console.error('Run expiry campaigns error:', error)
    return c.json({ error: 'Failed to run campaigns' }, 500)
  }
})

export default expiryCampaigns
