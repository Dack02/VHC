/**
 * Expiry reminder campaigns.
 *
 * Turns typed vehicle expiry dates (MOT / Service / Road Tax / custom) into
 * proactive reminders. Reuses the existing comms SEND primitives (sendSms /
 * sendEmail / org branding) and the communication_logs sink — it does NOT
 * overload the health-check-bound follow_up_cases table. Each due vehicle gets
 * ONE reminder per expiry window (v1 single-send model), tracked in
 * expiry_reminder_cases so it never re-fires.
 *
 * Suppression (lifecycle sold/scrapped, opt-out, snooze, 2-year recency,
 * already-booked-in) lives in the expiry_campaign_audience SQL function so the
 * count preview and the sweep share identical logic.
 *
 * Gated by the `vehicle_reminders` module (the sweep checks per-org). Design:
 * docs/vehicles-module-plan.md §6.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { sendSms } from './sms.js'
import { sendEmail, getOrganizationBranding } from './email.js'

export interface ExpiryAudienceRow {
  vehicle_id: string
  registration: string
  make: string | null
  model: string | null
  due_date: string
  due_mileage: number | null
  recipient_customer_id: string
  first_name: string | null
  last_name: string | null
  mobile: string | null
  email: string | null
}

interface CampaignRow {
  id: string
  expiry_type_id: string
  name: string
  channel: string
  message_template: string | null
  lead_days: number
  is_enabled: boolean
  type_code: string
  type_label: string
}

const DEFAULT_TEMPLATE =
  "Hi {{firstName}}, a reminder from {{garageName}} that your {{type}} for {{registration}} is due on {{dueDate}}. Call us to book in{{garagePhoneSuffix}}."

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
}

/**
 * Audience for a single campaign (also used by the count preview).
 * `siteId` (§4.6): pass a site to confine the audience to that site (separated
 * orgs); null/omitted = org-wide (today's behaviour, all sites).
 */
export async function getCampaignAudience(orgId: string, typeCode: string, leadDays: number, siteId: string | null = null): Promise<ExpiryAudienceRow[]> {
  const { data, error } = await supabaseAdmin.rpc('expiry_campaign_audience', {
    p_org: orgId,
    p_type_code: typeCode,
    p_lead_days: leadDays,
    p_site: siteId
  })
  if (error) {
    logger.error('Expiry audience query failed', { orgId, typeCode }, new Error(error.message))
    return []
  }
  return (data || []) as ExpiryAudienceRow[]
}

/** Count of the campaign audience (for the settings preview). */
export async function getCampaignAudienceCount(orgId: string, typeCode: string, leadDays: number, siteId: string | null = null): Promise<number> {
  const rows = await getCampaignAudience(orgId, typeCode, leadDays, siteId)
  return rows.length
}

async function loadEnabledCampaigns(orgId: string): Promise<CampaignRow[]> {
  const { data, error } = await supabaseAdmin
    .from('expiry_campaigns')
    .select('id, expiry_type_id, name, channel, message_template, lead_days, is_enabled, expiry_type:expiry_types(code, label, is_active)')
    .eq('organization_id', orgId)
    .eq('is_enabled', true)
  if (error || !data) return []
  return data
    .map((r) => {
      const t = (r as { expiry_type?: { code?: string; label?: string; is_active?: boolean } }).expiry_type
      if (!t || t.is_active === false) return null
      return {
        id: r.id,
        expiry_type_id: r.expiry_type_id,
        name: r.name,
        channel: r.channel,
        message_template: r.message_template,
        lead_days: r.lead_days,
        is_enabled: r.is_enabled,
        type_code: t.code || '',
        type_label: t.label || r.name
      } as CampaignRow
    })
    .filter((r): r is CampaignRow => !!r && !!r.type_code)
}

/** True when an open reminder case already exists for this vehicle/type/window. */
async function hasOpenCase(orgId: string, vehicleId: string, typeCode: string, dueDate: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('expiry_reminder_cases')
    .select('id')
    .eq('organization_id', orgId)
    .eq('vehicle_id', vehicleId)
    .eq('type_code', typeCode)
    .eq('due_date', dueDate)
    .neq('status', 'closed')
    .maybeSingle()
  return !!data
}

async function logComm(
  orgId: string,
  channel: 'sms' | 'email',
  recipient: string,
  subject: string | null,
  body: string,
  result: { success: boolean; messageId?: string; error?: string }
): Promise<void> {
  try {
    await supabaseAdmin.from('communication_logs').insert({
      health_check_id: null,
      organization_id: orgId,
      channel,
      recipient,
      subject,
      message_body: body,
      template_id: 'vehicle_reminder',
      status: result.success ? 'sent' : 'failed',
      external_id: result.messageId ?? null,
      error_message: result.error ?? null,
      metadata: { source: 'vehicle_reminder' }
    })
  } catch (err) {
    logger.error('Failed to log expiry reminder comm', { orgId }, err as Error)
  }
}

/**
 * Process all enabled expiry campaigns for one org: send one reminder per due
 * vehicle window and record the case. Returns the number of reminders sent.
 * Best-effort — never throws.
 */
export async function processExpiryRemindersForOrg(orgId: string, dryRun = false): Promise<number> {
  let sent = 0
  try {
    const campaigns = await loadEnabledCampaigns(orgId)
    if (!campaigns.length) return 0

    const branding = await getOrganizationBranding(orgId).catch(() => null)
    const garageName = (branding as { organizationName?: string } | null)?.organizationName || 'your garage'
    const garagePhone = (branding as { phone?: string } | null)?.phone || ''
    const garagePhoneSuffix = garagePhone ? ` on ${garagePhone}` : ''

    for (const campaign of campaigns) {
      const audience = await getCampaignAudience(orgId, campaign.type_code, campaign.lead_days)
      for (const row of audience) {
        if (await hasOpenCase(orgId, row.vehicle_id, campaign.type_code, row.due_date)) continue

        const vars: Record<string, string> = {
          firstName: row.first_name || 'there',
          lastName: row.last_name || '',
          registration: row.registration,
          vehicle: [row.make, row.model].filter(Boolean).join(' ') || row.registration,
          type: campaign.type_label,
          dueDate: fmtDate(row.due_date),
          garageName,
          garagePhone,
          garagePhoneSuffix
        }
        const body = render(campaign.message_template || DEFAULT_TEMPLATE, vars)
        const wantSms = campaign.channel === 'sms' || campaign.channel === 'both'
        const wantEmail = campaign.channel === 'email' || campaign.channel === 'both'

        if (dryRun) { sent++; continue }

        let delivered = false
        if (wantSms && row.mobile) {
          const res = await sendSms(row.mobile, body, orgId)
          await logComm(orgId, 'sms', row.mobile, null, body, res)
          if (res.success) delivered = true
        }
        if (wantEmail && row.email) {
          const subject = `${campaign.type_label} reminder — ${row.registration}`
          const html = `<p>${body.replace(/\n/g, '<br>')}</p>`
          const res = await sendEmail({ to: row.email, subject, html, text: body, organizationId: orgId })
          await logComm(orgId, 'email', row.email, subject, body, res)
          if (res.success) delivered = true
        }

        // Record the case so this window never re-fires (even if delivery failed,
        // so we don't hammer a bad number every sweep).
        const now = new Date().toISOString()
        await supabaseAdmin.from('expiry_reminder_cases').insert({
          organization_id: orgId,
          vehicle_id: row.vehicle_id,
          campaign_id: campaign.id,
          recipient_customer_id: row.recipient_customer_id,
          type_code: campaign.type_code,
          due_date: row.due_date,
          current_step: 1,
          status: 'active',
          last_notified_at: delivered ? now : null
        }).then(undefined, () => { /* unique-index race: another sweep got it */ })

        await supabaseAdmin
          .from('vehicle_expiry_dates')
          .update({ last_notified_at: now })
          .eq('vehicle_id', row.vehicle_id)
          .eq('type_code', campaign.type_code)
          .eq('organization_id', orgId)

        if (delivered) sent++
      }
    }
  } catch (err) {
    logger.error('processExpiryRemindersForOrg failed', { orgId }, err as Error)
  }
  return sent
}
