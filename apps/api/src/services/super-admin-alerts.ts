/**
 * Super-admin platform alerts.
 *
 * Lightweight notifications to the platform operators (super admins) about
 * account-level events — currently a new organization signing up via self-service
 * (email or Google). Designed so the people running Ollo Inspect find out the moment
 * a new customer joins.
 *
 * Recipients are the mobile numbers on active super_admins rows (managed in the admin
 * panel's "Super Admins" page), plus any extra numbers in the SUPER_ADMIN_ALERT_PHONES
 * environment variable (a Railway override that needs no DB row). Both sources are
 * unioned and de-duplicated.
 *
 * SUPER_ADMIN_ALERT_PHONES format: one or more phone numbers (E.164 like +447700900123,
 * or UK local like 07700900123) separated by commas or semicolons. Spaces inside a
 * number are fine. Example:
 *   SUPER_ADMIN_ALERT_PHONES="+447700900123, +447700900456"
 *
 * Everything here is best-effort and never throws — a failed alert must never break the
 * signup flow that triggered it.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { sendPlatformSms, formatPhoneNumber } from './sms.js'

export interface NewOrganizationAlert {
  organizationId: string
  organizationName: string
  adminName: string
  adminEmail: string
  planId?: string
  /** How the org was created, for context in the alert. */
  source?: 'email' | 'google'
}

/** Trim, drop blanks, normalise to E.164, and de-duplicate a list of raw numbers. */
function dedupeE164(entries: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of entries) {
    const trimmed = (entry || '').trim()
    if (!trimmed) continue
    const e164 = formatPhoneNumber(trimmed)
    // Guard against junk that normalises to an empty UK prefix.
    if (!e164 || e164 === '+' || e164 === '+44') continue
    if (seen.has(e164)) continue
    seen.add(e164)
    out.push(e164)
  }
  return out
}

/** Numbers from the SUPER_ADMIN_ALERT_PHONES env override, normalised + deduped. */
export function getSuperAdminAlertPhones(): string[] {
  const raw = process.env.SUPER_ADMIN_ALERT_PHONES || process.env.SUPER_ADMIN_ALERT_PHONE || ''
  return dedupeE164(raw.split(/[,;]+/))
}

/** Mobile numbers on file for active super admins. Best-effort: errors → empty list. */
async function getSuperAdminPhonesFromDb(): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('super_admins')
      .select('phone')
      .eq('is_active', true)
      .not('phone', 'is', null)
    if (error) {
      console.error('[super-admin-alerts] Could not read super-admin phone numbers:', error.message)
      return []
    }
    return (data || []).map((r) => String((r as { phone: string | null }).phone || ''))
  } catch (err) {
    console.error('[super-admin-alerts] Could not read super-admin phone numbers:', err)
    return []
  }
}

/**
 * The numbers that should receive platform alerts: every active super admin's mobile,
 * plus any configured via SUPER_ADMIN_ALERT_PHONES. Unioned and de-duplicated (E.164).
 */
export async function resolveSuperAdminAlertRecipients(): Promise<string[]> {
  const fromDb = await getSuperAdminPhonesFromDb()
  const fromEnv = process.env.SUPER_ADMIN_ALERT_PHONES || process.env.SUPER_ADMIN_ALERT_PHONE || ''
  return dedupeE164([...fromDb, ...fromEnv.split(/[,;]+/)])
}

/**
 * Text the configured super-admin number(s) that a new organization has signed up.
 * Best-effort: when no recipients are configured it logs and returns; individual send
 * failures are logged, never thrown.
 */
export async function notifyNewOrganizationSignup(alert: NewOrganizationAlert): Promise<void> {
  try {
    const recipients = await resolveSuperAdminAlertRecipients()
    if (recipients.length === 0) {
      console.log(
        `[super-admin-alerts] New org "${alert.organizationName}" signed up but no ` +
          'super-admin mobile numbers are configured — no SMS sent. Add one on the ' +
          'Super Admins page or set SUPER_ADMIN_ALERT_PHONES.'
      )
      return
    }

    const via = alert.source === 'google' ? 'Google' : alert.source === 'email' ? 'email' : null
    const lines = [
      '🎉 New Ollo Inspect signup',
      alert.organizationName,
      `${alert.adminName} · ${alert.adminEmail}`.trim()
    ]
    const meta = [alert.planId ? `${alert.planId} plan` : null, via ? `via ${via}` : null]
      .filter(Boolean)
      .join(' · ')
    if (meta) lines.push(meta)
    const message = lines.join('\n')

    for (const to of recipients) {
      const result = await sendPlatformSms(to, message)
      if (result.success) {
        console.log(`[super-admin-alerts] New-signup SMS sent to ${to} (${result.messageId})`)
      } else {
        console.error(`[super-admin-alerts] New-signup SMS to ${to} failed: ${result.error}`)
      }
    }
  } catch (err) {
    // Never let an alert failure escape into the signup flow.
    console.error('[super-admin-alerts] Failed to notify of new organization signup:', err)
  }
}
