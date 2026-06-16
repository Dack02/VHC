/**
 * Organization Provisioning Service
 *
 * Single source of truth for creating a new organization together with its first
 * admin user and all default records. Used by the super-admin "create organization"
 * route today, and designed to be reused by a future public self-service signup
 * endpoint.
 *
 * Guarantees:
 *  - Atomic from the caller's perspective: if any required step fails, the partially
 *    created organization (and auth user) is rolled back before throwing.
 *  - Best-effort seeding (starter reasons, starter inspection template, and the default
 *    libraries every org needs) and the admin invite email never roll back the
 *    organization — they are reported via the result flags instead.
 *  - Never returns a plaintext password. When no password is supplied, a random one
 *    is set and the admin receives a "set your password" recovery-link email.
 */

import crypto from 'crypto'
import { supabaseAdmin } from '../lib/supabase.js'
import { sendEmail } from './email.js'

export interface ProvisionOrganizationParams {
  name: string
  slug?: string
  planId?: string
  adminEmail: string
  adminFirstName: string
  adminLastName: string
  /** Optional. If provided, it is used as-is and NO invite email is sent (caller already knows it). If omitted, a random password is set and an invite link is emailed. */
  adminPassword?: string
  settings?: Record<string, unknown>
}

export interface ProvisionOrganizationResult {
  organization: { id: string; name: string; slug: string; status: string }
  adminUser: { id: string; email: string; firstName: string; lastName: string }
  site: { id: string; name: string } | null
  starterReasonsCopied: number
  starterTemplateCopied: number
  defaultsSeeded: boolean
  inviteEmailSent: boolean
}

/** Error carrying an HTTP status so routes can map it directly to a response. */
export class ProvisionError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'ProvisionError'
    this.statusCode = statusCode
  }
}

export async function provisionOrganization(
  params: ProvisionOrganizationParams
): Promise<ProvisionOrganizationResult> {
  const {
    name,
    slug,
    planId = 'starter',
    adminEmail,
    adminFirstName,
    adminLastName,
    adminPassword,
    settings = {}
  } = params

  if (!name || !adminEmail || !adminFirstName || !adminLastName) {
    throw new ProvisionError('Name, adminEmail, adminFirstName, and adminLastName are required', 400)
  }

  const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!orgSlug) {
    throw new ProvisionError('Could not derive a valid slug from the organization name; please provide one', 400)
  }

  // Slug uniqueness
  const { data: existingOrg } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .maybeSingle()

  if (existingOrg) {
    throw new ProvisionError('Organization slug already exists', 400)
  }

  let createdOrgId: string | null = null
  let createdAuthUserId: string | null = null

  try {
    // 1. Organization
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({
        name,
        slug: orgSlug,
        status: 'active',
        onboarding_completed: false,
        onboarding_step: 0
      })
      .select()
      .single()

    if (orgError || !org) {
      throw new ProvisionError(orgError?.message || 'Failed to create organization')
    }
    createdOrgId = org.id

    // 2. Organization settings
    const { error: settingsError } = await supabaseAdmin
      .from('organization_settings')
      .insert({ organization_id: org.id, ...settings })
    if (settingsError) {
      throw new ProvisionError(`Failed to create organization settings: ${settingsError.message}`)
    }

    // 3. Notification settings (platform defaults)
    const { error: notifError } = await supabaseAdmin
      .from('organization_notification_settings')
      .insert({ organization_id: org.id, use_platform_sms: true, use_platform_email: true })
    if (notifError) {
      throw new ProvisionError(`Failed to create notification settings: ${notifError.message}`)
    }

    // 4. Subscription
    const periodStart = new Date()
    const periodEnd = new Date()
    periodEnd.setMonth(periodEnd.getMonth() + 1)
    const { error: subError } = await supabaseAdmin
      .from('organization_subscriptions')
      .insert({
        organization_id: org.id,
        plan_id: planId,
        status: 'active',
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString()
      })
    if (subError) {
      throw new ProvisionError(`Failed to create subscription: ${subError.message}`)
    }

    // 5. First site (default)
    const { data: site, error: siteError } = await supabaseAdmin
      .from('sites')
      .insert({ organization_id: org.id, name: `${name} - Main Site`, is_active: true })
      .select()
      .single()
    if (siteError || !site) {
      throw new ProvisionError(`Failed to create site: ${siteError?.message || 'unknown error'}`)
    }

    // 6. Admin auth user
    const willEmailInvite = !adminPassword
    const password = adminPassword || crypto.randomBytes(16).toString('hex')
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { first_name: adminFirstName, last_name: adminLastName }
    })
    if (authError || !authData?.user) {
      throw new ProvisionError(`Failed to create admin user: ${authError?.message || 'unknown error'}`)
    }
    createdAuthUserId = authData.user.id

    // 7. User record
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_id: authData.user.id,
        organization_id: org.id,
        site_id: site.id,
        email: adminEmail,
        first_name: adminFirstName,
        last_name: adminLastName,
        role: 'org_admin',
        is_org_admin: true,
        is_active: true
      })
      .select()
      .single()
    if (userError || !user) {
      throw new ProvisionError(`Failed to create user record: ${userError?.message || 'unknown error'}`)
    }

    // 8. Usage tracking for current period
    const usagePeriodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const usagePeriodEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    const { error: usageError } = await supabaseAdmin
      .from('organization_usage')
      .insert({
        organization_id: org.id,
        period_start: usagePeriodStart.toISOString().split('T')[0],
        period_end: usagePeriodEnd.toISOString().split('T')[0],
        health_checks_created: 0,
        health_checks_completed: 0,
        sms_sent: 0,
        emails_sent: 0,
        storage_used_bytes: 0
      })
    if (usageError) {
      throw new ProvisionError(`Failed to initialise usage tracking: ${usageError.message}`)
    }

    // 9. Best-effort seeding — failures here must NOT roll back the org
    const starterReasonsCopied = await copyStarterReasons(org.id)
    const starterTemplateCopied = await copyStarterTemplate(org.id)
    const defaultsSeeded = await seedDefaultLibraries(org.id)

    // 10. Admin invite email (best-effort) — only when we generated the password
    let inviteEmailSent = false
    if (willEmailInvite) {
      inviteEmailSent = await sendAdminInviteEmail(org.id, adminEmail, adminFirstName, name)
    }

    return {
      organization: { id: org.id, name: org.name, slug: org.slug, status: org.status },
      adminUser: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name
      },
      site: { id: site.id, name: site.name },
      starterReasonsCopied,
      starterTemplateCopied,
      defaultsSeeded,
      inviteEmailSent
    }
  } catch (err) {
    // Roll back so we never leave a half-provisioned organization.
    if (createdAuthUserId) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId)
      } catch (cleanupErr) {
        console.error('Provisioning rollback: failed to delete auth user', cleanupErr)
      }
    }
    if (createdOrgId) {
      // Deleting the org cascades to settings, site, user, subscription, usage, etc.
      try {
        await supabaseAdmin.from('organizations').delete().eq('id', createdOrgId)
      } catch (cleanupErr) {
        console.error('Provisioning rollback: failed to delete organization', cleanupErr)
      }
    }
    if (err instanceof ProvisionError) throw err
    throw new ProvisionError(err instanceof Error ? err.message : 'Failed to provision organization')
  }
}

/** Copy starter reasons into a new org, honouring the platform setting. Best-effort. */
async function copyStarterReasons(orgId: string): Promise<number> {
  try {
    const { data: cfgRow } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'starter_reasons')
      .maybeSingle()
    const cfg = cfgRow?.settings as { auto_copy_on_create?: boolean; source_organization_id?: string } | null
    if (cfg?.auto_copy_on_create === false) return 0
    const { data } = await supabaseAdmin.rpc('copy_starter_reasons_to_org', {
      target_org_id: orgId,
      source_org_id: cfg?.source_organization_id || null
    })
    return data || 0
  } catch (err) {
    console.error('Failed to copy starter reasons:', err)
    return 0
  }
}

/** Copy the starter inspection template (+ sections + items) into a new org. Best-effort. */
async function copyStarterTemplate(orgId: string): Promise<number> {
  try {
    const { data: cfgRow } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', 'starter_template')
      .maybeSingle()
    const cfg = cfgRow?.settings as { auto_copy_on_create?: boolean; source_organization_id?: string } | null
    if (cfg?.auto_copy_on_create === false) return 0
    const { data } = await supabaseAdmin.rpc('copy_starter_template_to_org', {
      target_org_id: orgId,
      source_org_id: cfg?.source_organization_id || null
    })
    return data || 0
  } catch (err) {
    console.error('Failed to copy starter template:', err)
    return 0
  }
}

/**
 * Seed the universal default libraries every org needs: follow-up config (outcomes,
 * dispositions, default timeline), decline/deleted outcome reasons, and HC deletion
 * reasons. Unlike starter reasons/templates these are not tied to a source org or a
 * platform toggle — every new org gets them. All three RPCs are idempotent. Best-effort:
 * failures are logged and reported via the return flag, never roll back the org.
 */
async function seedDefaultLibraries(orgId: string): Promise<boolean> {
  const p = { p_organization_id: orgId }
  let allOk = true

  try {
    const { error } = await supabaseAdmin.rpc('seed_follow_up_config_for_org', p)
    if (error) { allOk = false; console.error('Failed to seed follow-up config:', error.message) }
  } catch (err) {
    allOk = false
    console.error('Failed to seed follow-up config:', err)
  }

  try {
    const { error } = await supabaseAdmin.rpc('seed_outcome_reasons_for_org', p)
    if (error) { allOk = false; console.error('Failed to seed outcome reasons:', error.message) }
  } catch (err) {
    allOk = false
    console.error('Failed to seed outcome reasons:', err)
  }

  try {
    const { error } = await supabaseAdmin.rpc('seed_hc_deletion_reasons_for_org', p)
    if (error) { allOk = false; console.error('Failed to seed HC deletion reasons:', error.message) }
  } catch (err) {
    allOk = false
    console.error('Failed to seed HC deletion reasons:', err)
  }

  return allOk
}

/** Send the first admin a "set your password" recovery-link email. Best-effort. */
async function sendAdminInviteEmail(
  orgId: string,
  email: string,
  firstName: string,
  orgName: string
): Promise<boolean> {
  try {
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${process.env.WEB_URL || 'http://localhost:5181'}/reset-password` }
    })
    const resetLink = linkData?.properties?.action_link
    if (!resetLink) {
      console.warn(`Failed to generate admin invite link for ${email}:`, linkError?.message)
      return false
    }

    // Outside production, surface the link in logs — dev/staging often can't send
    // outbound email (e.g. platform Resend credentials can't be decrypted there).
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[provisioning] Set-password link for ${email}: ${resetLink}`)
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">Welcome to ${orgName} on VHC</h2>
        <p>Hi ${firstName},</p>
        <p>An account has been created for you as the administrator of <strong>${orgName}</strong> on the Vehicle Health Check platform.</p>
        <p>Click the button below to set your password and get started:</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 12px 32px; text-decoration: none; font-weight: bold; display: inline-block; border-radius: 6px;">Set Your Password</a>
        </div>
        <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #666; font-size: 12px; word-break: break-all;">${resetLink}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">If you weren't expecting this, you can safely ignore this email.</p>
      </div>
    `
    const text = `Welcome to ${orgName} on VHC\n\nHi ${firstName},\n\nAn account has been created for you as the administrator of ${orgName}.\n\nSet your password to get started: ${resetLink}\n\nIf you weren't expecting this, you can safely ignore this email.`

    // Account/auth emails: try the org/platform sender first; if those credentials
    // are unavailable (e.g. on dev), fall back to the platform env (RESEND_API_KEY) sender.
    const emailPayload = {
      to: email,
      subject: `Welcome to ${orgName} on VHC — set your password`,
      html,
      text
    }
    let result = await sendEmail({ ...emailPayload, organizationId: orgId })
    if (!result.success) {
      result = await sendEmail(emailPayload)
    }
    return result.success
  } catch (err) {
    console.error('Failed to send admin invite email:', err)
    return false
  }
}
