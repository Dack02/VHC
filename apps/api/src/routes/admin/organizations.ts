/**
 * Super Admin Organizations API Routes
 * Full CRUD and management of organizations
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { buildResetPasswordLink } from '../../lib/authLinks.js'
import { superAdminMiddleware, logSuperAdminActivity, getClientIp } from '../../middleware/auth.js'
import { provisionOrganization, ProvisionError } from '../../services/provisioning.js'
import { getOrgModuleDetail, getEffectiveModules } from '../../services/modules.js'
import { MODULE_MAP, isModuleKey, type ModuleKey } from '../../lib/modules.js'
import { sendEmail } from '../../services/email.js'
import crypto from 'crypto'

const adminOrgRoutes = new Hono()

/**
 * `organization_subscriptions` has a UNIQUE(organization_id) constraint, so PostgREST
 * embeds it as a single object (a to-one relationship), not an array — yet supabase-js
 * still types the embed as an array. Indexing `[0]` therefore yields `undefined` at
 * runtime, which is why every org rendered "No plan" despite having a subscription.
 * Normalise either runtime shape to the one subscription record, or null.
 */
function firstSubscription(embed: unknown): Record<string, unknown> | null {
  if (!embed) return null
  if (Array.isArray(embed)) return (embed[0] as Record<string, unknown>) ?? null
  return embed as Record<string, unknown>
}

/**
 * Best-effort: email a newly-added org user so they can get started. Two variants:
 *  - Brand-new account  → "Set your password" with a recovery link (they have no
 *    password yet).
 *  - Existing account (opts.existingAccount) → the person already has a working VHC
 *    login (they're a member of another org), so a "set your password" link would be
 *    confusing. Instead we just tell them they've been added and point them at sign-in.
 *
 * Never throws — returns whether the email was actually sent so the caller can surface
 * it (for new accounts the temp password remains the fallback when this returns false).
 * Tries the org/platform sender first, then falls back to the platform env sender (e.g.
 * on dev where org credentials may be missing).
 */
async function sendOrgUserInviteEmail(
  orgId: string,
  orgName: string,
  email: string,
  firstName: string,
  role: string,
  opts: { existingAccount?: boolean } = {}
): Promise<boolean> {
  try {
    const roleLabel = role.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase())
    const loginUrl = process.env.WEB_URL || 'http://localhost:5181'

    let subject: string
    let heading: string
    let introHtml: string
    let ctaLabel: string
    let ctaHref: string
    let text: string

    if (opts.existingAccount) {
      // Already has a VHC login — notify and point at sign-in, no password CTA.
      subject = `You've been added to ${orgName} on VHC`
      heading = `Welcome to ${orgName}`
      ctaLabel = 'Sign In'
      ctaHref = loginUrl
      introHtml = `
        <p>Hi ${firstName},</p>
        <p><strong>${orgName}</strong> has added you to their team as a <strong>${roleLabel}</strong> on the Vehicle Health Check platform.</p>
        <p>You already have a VHC account, so just sign in with your existing email and password to get started — no new password needed.</p>
      `
      text = `You've been added to ${orgName} on VHC\n\nHi ${firstName},\n\n${orgName} has added you to their team as a ${roleLabel}.\n\nYou already have a VHC account — sign in with your existing email and password to get started: ${loginUrl}\n\nIf you've forgotten your password, use "Forgot password" on the sign-in page.`
    } else {
      // Brand-new account — email a "set your password" recovery link.
      const resetRedirect = `${loginUrl}/reset-password`
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: resetRedirect }
      })
      const resetLink = buildResetPasswordLink(linkData?.properties)
      if (!resetLink) {
        console.warn(`Failed to generate invite link for ${email}:`, linkError?.message)
        return false
      }

      // Outside production, surface the link in logs — dev/staging often can't send
      // outbound email (e.g. platform credentials can't be decrypted there).
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[admin/add-user] Set-password link for ${email}: ${resetLink}`)
      }

      subject = `You've been invited to join ${orgName} on VHC`
      heading = "You've Been Invited!"
      ctaLabel = 'Set Your Password'
      ctaHref = resetLink
      introHtml = `
        <p>Hi ${firstName},</p>
        <p><strong>${orgName}</strong> has added you to their team as a <strong>${roleLabel}</strong> on the Vehicle Health Check platform.</p>
        <p>Click the button below to set your password and get started:</p>
      `
      text = `You've been invited to join ${orgName} on VHC\n\nHi ${firstName},\n\n${orgName} has added you to their team as a ${roleLabel}.\n\nSet your password to get started: ${resetLink}\n\nIf you weren't expecting this, you can safely ignore this email.`
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">${heading}</h2>
        ${introHtml}
        <div style="text-align: center; margin: 32px 0;">
          <a href="${ctaHref}" style="background-color: #2563eb; color: white; padding: 12px 32px; text-decoration: none; font-weight: bold; display: inline-block; border-radius: 6px;">${ctaLabel}</a>
        </div>
        <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #666; font-size: 12px; word-break: break-all;">${ctaHref}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">This was sent by ${orgName} via Vehicle Health Check.</p>
      </div>
    `

    const emailPayload = { to: email, subject, html, text }
    let result = await sendEmail({ ...emailPayload, organizationId: orgId })
    if (!result.success) {
      result = await sendEmail(emailPayload)
    }
    return result.success
  } catch (err) {
    console.error('Failed to send org user invite email:', err)
    return false
  }
}

// All routes require super admin authentication
adminOrgRoutes.use('*', superAdminMiddleware)

/**
 * GET /api/v1/admin/organizations
 * List all organizations (paginated, filterable)
 */
adminOrgRoutes.get('/', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { status, plan, search, limit = '20', offset = '0' } = c.req.query()

  let query = supabaseAdmin
    .from('organizations')
    .select(`
      *,
      organization_settings(*),
      organization_subscriptions(
        *,
        plan:subscription_plans(*)
      ),
      sites:sites(count),
      users:users(count)
    `, { count: 'exact' })

  // Apply filters
  if (status) {
    query = query.eq('status', status)
  }
  if (search) {
    query = query.ilike('name', `%${search}%`)
  }

  // Apply pagination
  query = query
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

  const { data: organizations, error, count } = await query

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Filter by plan if specified (post-query filter since it's in a relation)
  let filteredOrgs = organizations || []
  if (plan) {
    filteredOrgs = filteredOrgs.filter(org =>
      firstSubscription(org.organization_subscriptions)?.plan_id === plan
    )
  }

  // Transform to cleaner response
  const orgs = filteredOrgs.map(org => {
    const sub = firstSubscription(org.organization_subscriptions)
    const planRel = sub?.plan
    const subPlan = (Array.isArray(planRel) ? planRel[0] : planRel) as Record<string, unknown> | null | undefined
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      onboardingCompleted: org.onboarding_completed,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
      settings: org.organization_settings?.[0] || null,
      subscription: sub ? {
        planId: sub.plan_id,
        planName: subPlan?.name ?? null,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
        trialStartedAt: sub.trial_started_at,
        trialEndsAt: sub.trial_ends_at
      } : null,
      sitesCount: org.sites?.[0]?.count || 0,
      usersCount: org.users?.[0]?.count || 0
    }
  })

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'list_organizations',
    'organizations',
    undefined,
    { filters: { status, plan, search }, count: orgs.length },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  return c.json({
    organizations: orgs,
    pagination: {
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    }
  })
})

/**
 * POST /api/v1/admin/organizations
 * Create a new organization with first admin user
 */
adminOrgRoutes.post('/', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()

  try {
    const result = await provisionOrganization({
      name: body.name,
      slug: body.slug,
      planId: body.planId,
      adminEmail: body.adminEmail,
      adminFirstName: body.adminFirstName,
      adminLastName: body.adminLastName,
      adminPassword: body.adminPassword,
      settings: body.settings || {}
    })

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'create_organization',
      'organizations',
      result.organization.id,
      {
        name: result.organization.name,
        slug: result.organization.slug,
        planId: body.planId || 'starter',
        adminEmail: body.adminEmail
      },
      getClientIp(c),
      c.req.header('User-Agent')
    )

    return c.json({
      organization: result.organization,
      adminUser: result.adminUser,
      site: result.site,
      inviteEmailSent: result.inviteEmailSent,
      starterReasonsCopied: result.starterReasonsCopied,
      starterTemplateCopied: result.starterTemplateCopied,
      defaultsSeeded: result.defaultsSeeded
    }, 201)
  } catch (error) {
    if (error instanceof ProvisionError) {
      return error.statusCode === 400
        ? c.json({ error: error.message }, 400)
        : c.json({ error: error.message }, 500)
    }
    console.error('Create organization error:', error)
    return c.json({ error: 'Failed to create organization' }, 500)
  }
})

/**
 * GET /api/v1/admin/organizations/:id
 * Get organization details with settings, subscription, and usage
 */
adminOrgRoutes.get('/:id', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select(`
      *,
      organization_settings(*),
      organization_notification_settings(*),
      organization_subscriptions(
        *,
        plan:subscription_plans(*)
      )
    `)
    .eq('id', orgId)
    .single()

  if (error || !org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  // Get counts
  const [sitesResult, usersResult, healthChecksResult] = await Promise.all([
    supabaseAdmin.from('sites').select('id', { count: 'exact' }).eq('organization_id', orgId),
    supabaseAdmin.from('users').select('id', { count: 'exact' }).eq('organization_id', orgId),
    supabaseAdmin.from('health_checks').select('id', { count: 'exact' }).eq('organization_id', orgId)
  ])

  // Get current period usage
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { data: usage } = await supabaseAdmin
    .from('organization_usage')
    .select('*')
    .eq('organization_id', orgId)
    .eq('period_start', periodStart)
    .single()

  // Get org admins
  const { data: admins } = await supabaseAdmin
    .from('users')
    .select('id, email, first_name, last_name, last_login_at')
    .eq('organization_id', orgId)
    .eq('is_org_admin', true)
    .eq('is_active', true)

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'view_organization',
    'organizations',
    orgId,
    { name: org.name },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  return c.json({
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    onboardingCompleted: org.onboarding_completed,
    onboardingStep: org.onboarding_step,
    createdAt: org.created_at,
    updatedAt: org.updated_at,
    settings: org.organization_settings?.[0] || null,
    notificationSettings: org.organization_notification_settings?.[0] ? {
      usePlatformSms: org.organization_notification_settings[0].use_platform_sms,
      usePlatformEmail: org.organization_notification_settings[0].use_platform_email,
      smsEnabled: org.organization_notification_settings[0].sms_enabled,
      emailEnabled: org.organization_notification_settings[0].email_enabled,
      hasCustomSmsCredentials: !!(org.organization_notification_settings[0].twilio_account_sid_encrypted),
      hasCustomEmailCredentials: !!(org.organization_notification_settings[0].resend_api_key_encrypted)
    } : null,
    subscription: (() => {
      const sub = firstSubscription(org.organization_subscriptions)
      if (!sub) return null
      const planRel = sub.plan
      const planData = (Array.isArray(planRel) ? planRel[0] : planRel) as Record<string, unknown> | null
      return {
        id: sub.id,
        planId: sub.plan_id,
        planName: planData?.name || null,
        plan: planData,
        status: sub.status,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        trialStartedAt: sub.trial_started_at,
        trialEndsAt: sub.trial_ends_at,
        limits: planData ? {
          maxSites: planData.max_sites || 0,
          maxUsersPerSite: planData.max_users || 0,
          maxHealthChecksPerMonth: planData.max_health_checks_per_month || 0,
          maxStorageGb: planData.max_storage_gb || 0
        } : null
      }
    })(),
    counts: {
      sites: sitesResult.count || 0,
      users: usersResult.count || 0,
      healthChecks: healthChecksResult.count || 0
    },
    currentUsage: usage ? {
      healthChecksCreated: usage.health_checks_created,
      healthChecksCompleted: usage.health_checks_completed,
      smsSent: usage.sms_sent,
      emailsSent: usage.emails_sent,
      storageUsedBytes: usage.storage_used_bytes
    } : null,
    admins: admins?.map(admin => ({
      id: admin.id,
      email: admin.email,
      firstName: admin.first_name,
      lastName: admin.last_name,
      lastLoginAt: admin.last_login_at
    })) || []
  })
})

/**
 * PATCH /api/v1/admin/organizations/:id
 * Update organization
 */
adminOrgRoutes.patch('/:id', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')
  const body = await c.req.json()

  const { name, slug, status, onboardingCompleted, onboardingStep } = body

  // Build update data
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  if (name !== undefined) updateData.name = name
  if (slug !== undefined) {
    // Check if new slug is unique
    const { data: existingOrg } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .neq('id', orgId)
      .single()

    if (existingOrg) {
      return c.json({ error: 'Slug already exists' }, 400)
    }
    updateData.slug = slug
  }
  if (status !== undefined) updateData.status = status
  if (onboardingCompleted !== undefined) updateData.onboarding_completed = onboardingCompleted
  if (onboardingStep !== undefined) updateData.onboarding_step = onboardingStep

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .update(updateData)
    .eq('id', orgId)
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'update_organization',
    'organizations',
    orgId,
    { changes: Object.keys(updateData).filter(k => k !== 'updated_at') },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  return c.json({
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    updatedAt: org.updated_at
  })
})

/**
 * DELETE /api/v1/admin/organizations/:id
 * Soft delete organization (set status: cancelled)
 */
adminOrgRoutes.delete('/:id', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')

  // Get org info for logging
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()

  if (!org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  // Soft delete by setting status to cancelled
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('id', orgId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Also update subscription status
  await supabaseAdmin
    .from('organization_subscriptions')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('organization_id', orgId)

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'delete_organization',
    'organizations',
    orgId,
    { name: org.name },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  return c.json({ success: true, message: 'Organization cancelled' })
})

/**
 * POST /api/v1/admin/organizations/:id/suspend
 * Suspend organization
 */
adminOrgRoutes.post('/:id/suspend', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')
  const body = await c.req.json()
  const { reason } = body

  // Get org info
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, status')
    .eq('id', orgId)
    .single()

  if (!org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  if (org.status === 'suspended') {
    return c.json({ error: 'Organization is already suspended' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      status: 'suspended',
      updated_at: new Date().toISOString()
    })
    .eq('id', orgId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'suspend_organization',
    'organizations',
    orgId,
    { name: org.name, reason, previousStatus: org.status },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  return c.json({ success: true, message: 'Organization suspended' })
})

/**
 * POST /api/v1/admin/organizations/:id/activate
 * Activate organization
 */
adminOrgRoutes.post('/:id/activate', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')

  // Get org info
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, status')
    .eq('id', orgId)
    .single()

  if (!org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  if (org.status === 'active') {
    return c.json({ error: 'Organization is already active' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('id', orgId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'activate_organization',
    'organizations',
    orgId,
    { name: org.name, previousStatus: org.status },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  return c.json({ success: true, message: 'Organization activated' })
})

/**
 * GET /api/v1/admin/organizations/:id/subscription
 * Get organization subscription details
 */
adminOrgRoutes.get('/:id/subscription', async (c) => {
  const orgId = c.req.param('id')

  const { data: subscription, error } = await supabaseAdmin
    .from('organization_subscriptions')
    .select(`
      *,
      plan:subscription_plans(*)
    `)
    .eq('organization_id', orgId)
    .single()

  if (error || !subscription) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  return c.json({
    id: subscription.id,
    organizationId: subscription.organization_id,
    planId: subscription.plan_id,
    plan: subscription.plan,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at
  })
})

/**
 * PATCH /api/v1/admin/organizations/:id/subscription
 * Update organization subscription (change plan, dates)
 */
adminOrgRoutes.patch('/:id/subscription', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')
  const body = await c.req.json()

  const { planId, status, currentPeriodStart, currentPeriodEnd } = body

  // Validate plan exists if changing
  if (planId) {
    const { data: plan } = await supabaseAdmin
      .from('subscription_plans')
      .select('id')
      .eq('id', planId)
      .single()

    if (!plan) {
      return c.json({ error: 'Invalid plan ID' }, 400)
    }
  }

  // Get current subscription
  const { data: currentSub } = await supabaseAdmin
    .from('organization_subscriptions')
    .select('*, plan:subscription_plans(*)')
    .eq('organization_id', orgId)
    .single()

  if (!currentSub) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  if (planId !== undefined) updateData.plan_id = planId
  if (status !== undefined) updateData.status = status
  if (currentPeriodStart !== undefined) updateData.current_period_start = currentPeriodStart
  if (currentPeriodEnd !== undefined) updateData.current_period_end = currentPeriodEnd

  const { data: subscription, error } = await supabaseAdmin
    .from('organization_subscriptions')
    .update(updateData)
    .eq('organization_id', orgId)
    .select(`
      *,
      plan:subscription_plans(*)
    `)
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'update_subscription',
    'organization_subscriptions',
    subscription.id,
    {
      organizationId: orgId,
      previousPlan: currentSub.plan_id,
      newPlan: planId || currentSub.plan_id,
      previousStatus: currentSub.status,
      newStatus: status || currentSub.status
    },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  return c.json({
    id: subscription.id,
    organizationId: subscription.organization_id,
    planId: subscription.plan_id,
    plan: subscription.plan,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    updatedAt: subscription.updated_at
  })
})

/**
 * GET /api/v1/admin/organizations/:id/usage
 * Get current period usage
 */
adminOrgRoutes.get('/:id/usage', async (c) => {
  const orgId = c.req.param('id')

  // Get current period
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  // Parallel queries for usage, sites count, users count, and health checks this month
  const [usageResult, sitesResult, usersResult, healthChecksResult] = await Promise.all([
    supabaseAdmin
      .from('organization_usage')
      .select('*')
      .eq('organization_id', orgId)
      .eq('period_start', periodStart)
      .single(),
    supabaseAdmin
      .from('sites')
      .select('id', { count: 'exact' })
      .eq('organization_id', orgId)
      .eq('is_active', true),
    supabaseAdmin
      .from('users')
      .select('id', { count: 'exact' })
      .eq('organization_id', orgId)
      .eq('is_active', true),
    supabaseAdmin
      .from('health_checks')
      .select('id', { count: 'exact' })
      .eq('organization_id', orgId)
      .gte('created_at', periodStart)
  ])

  if (usageResult.error && usageResult.error.code !== 'PGRST116') {
    return c.json({ error: usageResult.error.message }, 500)
  }

  // Return flat shape the frontend expects
  return c.json({
    sitesCount: sitesResult.count || 0,
    usersCount: usersResult.count || 0,
    healthChecksThisMonth: healthChecksResult.count || 0,
    storageUsedBytes: usageResult.data?.storage_used_bytes || 0
  })
})

/**
 * GET /api/v1/admin/organizations/:id/usage/history
 * Get usage history (last 12 months)
 */
adminOrgRoutes.get('/:id/usage/history', async (c) => {
  const orgId = c.req.param('id')

  // Last 12 months (including the current month). SMS/email/HC are counted live
  // from communication_logs + health_checks via RPC — the organization_usage
  // rollup counters are not maintained (only its storage_used_bytes is real,
  // merged in below).
  const now = new Date()
  const fromStr = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().slice(0, 10)
  const toStr = now.toISOString().slice(0, 10)

  const [historyRes, storageRes] = await Promise.all([
    supabaseAdmin.rpc('admin_org_usage_history', { p_org: orgId, p_from: fromStr, p_to: toStr }),
    supabaseAdmin
      .from('organization_usage')
      .select('period_start, storage_used_bytes')
      .eq('organization_id', orgId)
      .gte('period_start', fromStr)
  ])

  if (historyRes.error) {
    return c.json({ error: historyRes.error.message }, 500)
  }

  // storage_used_bytes is a point-in-time gauge kept only in organization_usage
  const storageByMonth = new Map<string, number>()
  for (const r of (storageRes.data || []) as Array<{ period_start: string; storage_used_bytes: number | null }>) {
    storageByMonth.set(String(r.period_start).slice(0, 7), r.storage_used_bytes || 0)
  }

  const history = (historyRes.data || []) as Array<{
    period_start: string
    sms_sent: number
    emails_sent: number
    health_checks_created: number
    health_checks_completed: number
  }>

  return c.json({
    history: history.map(period => ({
      periodStart: period.period_start,
      healthChecksCreated: Number(period.health_checks_created) || 0,
      healthChecksCompleted: Number(period.health_checks_completed) || 0,
      smsSent: Number(period.sms_sent) || 0,
      emailsSent: Number(period.emails_sent) || 0,
      storageUsedBytes: storageByMonth.get(String(period.period_start).slice(0, 7)) || 0
    }))
  })
})

/**
 * GET /api/v1/admin/organizations/:id/billing
 * Current-month billing/usage summary: plan price + comms/AI usage + estimated
 * spend (GBP plan+SMS; AI cost/chargeout in USD, kept separate — no fake FX).
 */
adminOrgRoutes.get('/:id/billing', async (c) => {
  const orgId = c.req.param('id')
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, organization_subscriptions(plan:subscription_plans(*))')
    .eq('id', orgId)
    .single()

  if (error || !org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  const [smsRes, emailRes, hcRes, aiRes, billingRes, marginRes] = await Promise.all([
    supabaseAdmin.from('communication_logs').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('channel', 'sms').in('status', ['sent', 'delivered', 'bounced']).gte('created_at', monthStart),
    supabaseAdmin.from('communication_logs').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('channel', 'email').in('status', ['sent', 'delivered', 'bounced']).gte('created_at', monthStart),
    supabaseAdmin.from('health_checks').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).gte('created_at', monthStart),
    supabaseAdmin.from('organization_ai_settings').select('current_period_cost_usd').eq('organization_id', orgId).maybeSingle(),
    supabaseAdmin.from('platform_settings').select('settings').eq('id', 'billing').maybeSingle(),
    supabaseAdmin.from('platform_ai_settings').select('value').eq('key', 'ai_margin_percent').maybeSingle()
  ])

  const sub = firstSubscription(org.organization_subscriptions)
  const planRel = sub?.plan as Record<string, unknown> | Record<string, unknown>[] | null | undefined
  const plan = ((Array.isArray(planRel) ? planRel[0] : planRel) as Record<string, unknown> | null) || null

  const billingSettings = (billingRes.data?.settings as Record<string, unknown> | null) || null
  const smsRate = Number(billingSettings?.sms_unit_cost ?? 0.04)
  const emailRate = Number(billingSettings?.email_unit_cost ?? 0)
  const margin = marginRes.data?.value ? parseFloat(marginRes.data.value) : 0

  const smsSent = smsRes.count || 0
  const emailsSent = emailRes.count || 0
  const planPrice = Number(plan?.price_monthly || 0)
  const estSmsCost = Math.round(smsSent * smsRate * 100) / 100
  const estEmailCost = Math.round(emailsSent * emailRate * 100) / 100
  const aiCostUsd = Number(aiRes.data?.current_period_cost_usd || 0)

  return c.json({
    period: { start: monthStart },
    plan: plan ? {
      name: plan.name,
      priceMonthly: planPrice,
      currency: plan.currency || 'GBP',
      limits: {
        maxSites: plan.max_sites,
        maxUsers: plan.max_users,
        maxHealthChecksPerMonth: plan.max_health_checks_per_month,
        maxStorageGb: plan.max_storage_gb
      }
    } : null,
    usage: { smsSent, emailsSent, healthChecksCreated: hcRes.count || 0 },
    estimated: {
      planCostGbp: planPrice,
      smsCostGbp: estSmsCost,
      emailCostGbp: estEmailCost,
      totalGbp: Math.round((planPrice + estSmsCost + estEmailCost) * 100) / 100,
      aiCostUsd: Math.round(aiCostUsd * 100) / 100,
      aiChargeoutUsd: Math.round(aiCostUsd * (1 + margin / 100) * 100) / 100,
      aiMarginPercent: margin
    }
  })
})

/**
 * GET /api/v1/admin/organizations/:id/sites
 * List sites for an organization
 */
adminOrgRoutes.get('/:id/sites', async (c) => {
  const orgId = c.req.param('id')

  const { data: sites, error } = await supabaseAdmin
    .from('sites')
    .select(`
      id,
      name,
      address,
      is_active,
      users:users(count)
    `)
    .eq('organization_id', orgId)
    .order('name', { ascending: true })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    sites: (sites || []).map(site => ({
      id: site.id,
      name: site.name,
      address: site.address,
      isActive: site.is_active,
      usersCount: site.users?.[0]?.count || 0
    }))
  })
})

/**
 * GET /api/v1/admin/organizations/:id/users
 * List users for an organization
 */
adminOrgRoutes.get('/:id/users', async (c) => {
  const orgId = c.req.param('id')

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select(`
      id,
      email,
      first_name,
      last_name,
      role,
      is_active,
      last_login_at,
      site:sites(name)
    `)
    .eq('organization_id', orgId)
    .order('first_name', { ascending: true })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    users: (users || []).map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active,
      lastSignIn: user.last_login_at,
      siteName: (user.site as unknown as { name: string } | null)?.name || null
    }))
  })
})

/**
 * POST /api/v1/admin/organizations/:id/users
 * Create a user in an organization (super admin — no user limit check)
 */
adminOrgRoutes.post('/:id/users', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')
  const body = await c.req.json()

  const {
    email,
    firstName,
    lastName,
    phone,
    role = 'technician',
    siteId
  } = body

  if (!email || !firstName || !lastName) {
    return c.json({ error: 'Email, firstName, and lastName are required' }, 400)
  }

  // Validate role
  const validRoles = ['org_admin', 'site_admin', 'service_advisor', 'technician']
  if (!validRoles.includes(role)) {
    return c.json({ error: 'Invalid role' }, 400)
  }

  // Verify org exists
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .single()

  if (!org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  // Validate site belongs to org if provided
  if (siteId) {
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('organization_id', orgId)
      .single()

    if (!site) {
      return c.json({ error: 'Invalid site ID' }, 400)
    }
  }

  // Check if email already exists in this organization
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .eq('organization_id', orgId)
    .single()

  if (existingUser) {
    return c.json({ error: 'User with this email already exists in the organisation' }, 400)
  }

  try {
    const tempPassword = crypto.randomBytes(16).toString('hex')

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName
      }
    })

    if (authError) {
      // Handle user already existing in auth (might be in another org)
      if (authError.message.includes('already been registered')) {
        const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers()
        const existingAuth = existingAuthUsers?.users?.find(u => u.email === email)

        if (existingAuth) {
          const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .insert({
              auth_id: existingAuth.id,
              organization_id: orgId,
              site_id: siteId || null,
              email,
              first_name: firstName,
              last_name: lastName,
              phone: phone || null,
              role,
              is_org_admin: role === 'org_admin',
              is_site_admin: role === 'site_admin',
              is_active: true
            })
            .select()
            .single()

          if (userError) {
            return c.json({ error: userError.message }, 500)
          }

          await logSuperAdminActivity(
            superAdmin.id,
            'create_user',
            'users',
            user.id,
            { email, organizationId: orgId, organizationName: org.name, role, note: 'Linked to existing auth account' },
            getClientIp(c),
            c.req.header('User-Agent')
          )

          // They already have a VHC login — notify them they've been added (no
          // set-password link, which would confuse an existing account). Best-effort.
          const emailSent = await sendOrgUserInviteEmail(orgId, org.name, email, firstName, role, { existingAccount: true })

          return c.json({
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            emailSent,
            note: 'User linked to existing auth account'
          }, 201)
        }
      }
      return c.json({ error: `Failed to create auth user: ${authError.message}` }, 500)
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_id: authData.user.id,
        organization_id: orgId,
        site_id: siteId || null,
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        role,
        is_org_admin: role === 'org_admin',
        is_site_admin: role === 'site_admin',
        is_active: true
      })
      .select()
      .single()

    if (userError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return c.json({ error: userError.message }, 500)
    }

    await logSuperAdminActivity(
      superAdmin.id,
      'create_user',
      'users',
      user.id,
      { email, organizationId: orgId, organizationName: org.name, role },
      getClientIp(c),
      c.req.header('User-Agent')
    )

    // Email the new user a set-password link. Best-effort; the temp password below
    // remains the fallback the super admin can hand over if email delivery fails.
    const emailSent = await sendOrgUserInviteEmail(orgId, org.name, email, firstName, role)

    return c.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      temporaryPassword: tempPassword,
      emailSent
    }, 201)
  } catch (error) {
    console.error('Admin user creation error:', error)
    return c.json({ error: 'Failed to create user' }, 500)
  }
})

// =============================================================================
// AI SETTINGS
// =============================================================================

/**
 * Helper: Get or create organization AI settings (lazy init)
 */
async function getOrCreateOrgAiSettings(orgId: string) {
  // Try to get existing settings
  let { data: settings, error } = await supabaseAdmin
    .from('organization_ai_settings')
    .select('*')
    .eq('organization_id', orgId)
    .single()

  if (error && error.code === 'PGRST116') {
    // Not found - create default settings
    const { data: newSettings, error: createError } = await supabaseAdmin
      .from('organization_ai_settings')
      .insert({
        organization_id: orgId,
        monthly_generation_limit: null, // Use platform default
        is_ai_enabled: true,
        current_period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        current_period_generations: 0,
        current_period_tokens: 0,
        current_period_cost_usd: 0,
        total_generations: 0,
        total_tokens: 0,
        total_cost_usd: 0
      })
      .select()
      .single()

    if (createError) {
      // Might have been created by another request - try to fetch again
      const { data: retrySettings } = await supabaseAdmin
        .from('organization_ai_settings')
        .select('*')
        .eq('organization_id', orgId)
        .single()

      if (retrySettings) {
        return retrySettings
      }

      throw new Error(`Failed to create AI settings: ${createError.message}`)
    }

    return newSettings
  }

  if (error) {
    throw new Error(`Failed to fetch AI settings: ${error.message}`)
  }

  return settings
}

/**
 * Helper: Get effective AI limit for an organization
 */
async function getEffectiveLimit(_orgId: string, orgLimit: number | null): Promise<number> {
  if (orgLimit !== null) {
    return orgLimit
  }

  // Get platform default
  const { data: defaultSetting } = await supabaseAdmin
    .from('platform_ai_settings')
    .select('value')
    .eq('key', 'default_monthly_ai_limit')
    .single()

  return parseInt(defaultSetting?.value || '100')
}

/**
 * GET /api/v1/admin/organizations/:id/ai-settings
 * Get organization AI settings
 */
adminOrgRoutes.get('/:id/ai-settings', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')

  try {
    // Verify org exists
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single()

    if (!org) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Get or create AI settings
    const settings = await getOrCreateOrgAiSettings(orgId)

    // Get effective limit
    const effectiveLimit = await getEffectiveLimit(orgId, settings.monthly_generation_limit)

    // Check if current period needs reset (new month)
    const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    const settingsPeriodStart = settings.current_period_start

    let currentPeriod = {
      start: settings.current_period_start,
      generations: settings.current_period_generations || 0,
      tokens: settings.current_period_tokens || 0,
      costUsd: parseFloat(String(settings.current_period_cost_usd || 0))
    }

    // If we're in a new month, show zeros for current period
    if (settingsPeriodStart < currentMonthStart) {
      currentPeriod = {
        start: currentMonthStart,
        generations: 0,
        tokens: 0,
        costUsd: 0
      }
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'view_org_ai_settings',
      'organization_ai_settings',
      orgId,
      {},
      getClientIp(c),
      c.req.header('User-Agent')
    )

    // Compute period end (last day of current period month)
    const periodStartDate = new Date(currentPeriod.start)
    const periodEnd = new Date(periodStartDate.getFullYear(), periodStartDate.getMonth() + 1, 0).toISOString().split('T')[0]

    return c.json({
      id: settings.id,
      organizationId: orgId,
      organizationName: org.name,
      aiEnabled: settings.is_ai_enabled,
      monthlyLimit: settings.monthly_generation_limit,
      effectiveLimit,
      currentPeriodGenerations: currentPeriod.generations,
      currentPeriodTokens: currentPeriod.tokens,
      currentPeriodCost: currentPeriod.costUsd,
      periodStart: currentPeriod.start,
      periodEnd,
      lifetimeGenerations: settings.total_generations || 0,
      lifetimeTokens: settings.total_tokens || 0,
      lifetimeCost: parseFloat(String(settings.total_cost_usd || 0))
    })
  } catch (error) {
    console.error('Get org AI settings error:', error)
    const message = error instanceof Error ? error.message : 'Failed to get AI settings'
    return c.json({ error: message }, 500)
  }
})

/**
 * PATCH /api/v1/admin/organizations/:id/ai-settings
 * Update organization AI settings
 */
adminOrgRoutes.patch('/:id/ai-settings', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')

  try {
    const body = await c.req.json()
    // Accept both camelCase (frontend) and snake_case field names
    const monthlyLimit = body.monthlyLimit !== undefined ? body.monthlyLimit : body.monthly_generation_limit
    const aiEnabled = body.aiEnabled !== undefined ? body.aiEnabled : body.is_ai_enabled

    // Verify org exists
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single()

    if (!org) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Validate limit
    if (monthlyLimit !== undefined && monthlyLimit !== null) {
      const limit = parseInt(monthlyLimit)
      if (isNaN(limit) || limit < 0) {
        return c.json({ error: 'monthlyLimit must be a non-negative integer or null' }, 400)
      }
    }

    // Ensure settings record exists
    await getOrCreateOrgAiSettings(orgId)

    // Build update data
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    if (monthlyLimit !== undefined) {
      updateData.monthly_generation_limit = monthlyLimit === null ? null : parseInt(monthlyLimit)
    }
    if (aiEnabled !== undefined) {
      updateData.is_ai_enabled = aiEnabled
    }

    // Update
    const { error } = await supabaseAdmin
      .from('organization_ai_settings')
      .update(updateData)
      .eq('organization_id', orgId)

    if (error) {
      throw new Error(`Failed to update AI settings: ${error.message}`)
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'update_org_ai_settings',
      'organization_ai_settings',
      orgId,
      { changes: Object.keys(updateData).filter(k => k !== 'updated_at'), organizationName: org.name },
      getClientIp(c),
      c.req.header('User-Agent')
    )

    return c.json({ success: true })
  } catch (error) {
    console.error('Update org AI settings error:', error)
    const message = error instanceof Error ? error.message : 'Failed to update AI settings'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/v1/admin/organizations/:id/ai-settings/reset-period
 * Reset organization's current AI usage period
 */
adminOrgRoutes.post('/:id/ai-settings/reset-period', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')

  try {
    // Verify org exists
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single()

    if (!org) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Get current settings
    const settings = await getOrCreateOrgAiSettings(orgId)

    // Store previous values
    const previous = {
      periodStart: settings.current_period_start,
      generations: settings.current_period_generations || 0,
      tokens: settings.current_period_tokens || 0,
      costUsd: parseFloat(String(settings.current_period_cost_usd || 0))
    }

    // Reset
    const now = new Date().toISOString().split('T')[0]
    const { error } = await supabaseAdmin
      .from('organization_ai_settings')
      .update({
        current_period_start: now,
        current_period_generations: 0,
        current_period_tokens: 0,
        current_period_cost_usd: 0,
        limit_warning_sent_at: null,
        limit_reached_sent_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('organization_id', orgId)

    if (error) {
      throw new Error(`Failed to reset period: ${error.message}`)
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'reset_org_ai_period',
      'organization_ai_settings',
      orgId,
      { organizationName: org.name, previous },
      getClientIp(c),
      c.req.header('User-Agent')
    )

    return c.json({
      success: true,
      previous
    })
  } catch (error) {
    console.error('Reset org AI period error:', error)
    const message = error instanceof Error ? error.message : 'Failed to reset period'
    return c.json({ error: message }, 500)
  }
})

// =============================================================================
// MODULES (per-org feature enablement)
// =============================================================================

/**
 * GET /api/v1/admin/organizations/:id/modules
 * Per-module effective state + override (true/false/null=inherit) + plan default.
 */
adminOrgRoutes.get('/:id/modules', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .single()

  if (!org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  const detail = await getOrgModuleDetail(orgId)
  const modules = detail.map((m) => ({
    ...m,
    label: MODULE_MAP[m.key].label,
    description: MODULE_MAP[m.key].description
  }))

  await logSuperAdminActivity(
    superAdmin.id,
    'view_org_modules',
    'organization_settings',
    orgId,
    {},
    getClientIp(c),
    c.req.header('User-Agent')
  )

  return c.json({ modules })
})

/**
 * PATCH /api/v1/admin/organizations/:id/modules
 * Body: { overrides: { [moduleKey]: boolean | null } }  (null clears -> inherit plan)
 */
adminOrgRoutes.patch('/:id/modules', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')
  const body = await c.req.json()
  const overrides = body?.overrides

  if (!overrides || typeof overrides !== 'object') {
    return c.json({ error: 'overrides object is required' }, 400)
  }

  // Validate keys and values
  for (const [key, val] of Object.entries(overrides)) {
    if (!isModuleKey(key)) {
      return c.json({ error: `Unknown module: ${key}` }, 400)
    }
    if (MODULE_MAP[key as ModuleKey].core) {
      return c.json({ error: `Module "${key}" is core and cannot be disabled` }, 400)
    }
    if (val !== null && typeof val !== 'boolean') {
      return c.json({ error: `Override for "${key}" must be boolean or null` }, 400)
    }
  }

  // Verify org exists
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .single()

  if (!org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  // Merge into existing overrides (null clears the key)
  const { data: existing } = await supabaseAdmin
    .from('organization_settings')
    .select('module_overrides')
    .eq('organization_id', orgId)
    .maybeSingle()

  const next: Record<string, boolean> = { ...((existing?.module_overrides as Record<string, boolean>) || {}) }
  for (const [key, val] of Object.entries(overrides)) {
    if (val === null) delete next[key]
    else next[key] = val as boolean
  }

  const settingsUpdate: Record<string, unknown> = {
    organization_id: orgId,
    module_overrides: next,
    updated_at: new Date().toISOString()
  }

  // The `jobsheets` module is the master gate for operating_mode (TECH_JOB_MODEL.md §4:
  // module gates the mode). When this change touches the jobsheets override, keep the
  // stored operating_mode in lock-step: enabling => 'gms', disabling/inheriting => 'vhc_only'.
  // (jobsheets is override-only, so next.jobsheets===true is the full "effective on" test.)
  if (Object.prototype.hasOwnProperty.call(overrides, 'jobsheets')) {
    settingsUpdate.operating_mode = next.jobsheets === true ? 'gms' : 'vhc_only'
  }

  const { error } = await supabaseAdmin
    .from('organization_settings')
    .upsert(settingsUpdate, { onConflict: 'organization_id' })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  await logSuperAdminActivity(
    superAdmin.id,
    'update_org_modules',
    'organization_settings',
    orgId,
    { organizationName: org.name, changes: Object.keys(overrides) },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  const detail = await getOrgModuleDetail(orgId)
  const modules = detail.map((m) => ({
    ...m,
    label: MODULE_MAP[m.key].label,
    description: MODULE_MAP[m.key].description
  }))

  return c.json({ success: true, modules })
})

// =============================================================================
// OPERATING MODE (VHC-only vs full GMS) — TECH_JOB_MODEL.md §4 / §13
// =============================================================================
// operating_mode is *coerced by* the jobsheets module (module-gates-mode): it is
// inert unless that module is on. This endpoint is the friendly "switch the whole
// account" control — it flips the jobsheets override AND operating_mode together so
// the two can never drift. Super-admin only (GMS is effectively a tier).

/**
 * GET /api/v1/admin/organizations/:id/operating-mode
 * Effective + stored mode, and whether the jobsheets module is currently on.
 */
adminOrgRoutes.get('/:id/operating-mode', async (c) => {
  const orgId = c.req.param('id')
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('id', orgId)
    .single()
  if (!org) return c.json({ error: 'Organisation not found' }, 404)

  const { data: settings } = await supabaseAdmin
    .from('organization_settings')
    .select('operating_mode')
    .eq('organization_id', orgId)
    .maybeSingle()
  const mods = await getEffectiveModules(orgId)
  const stored = settings?.operating_mode === 'gms' ? 'gms' : 'vhc_only'
  // Effective mode = stored, but only if the module that gates it is actually on.
  const operatingMode = mods.jobsheets ? stored : 'vhc_only'

  return c.json({ operatingMode, storedOperatingMode: stored, jobsheetsModuleEnabled: mods.jobsheets })
})

/**
 * PUT /api/v1/admin/organizations/:id/operating-mode
 * Body: { operatingMode: 'vhc_only' | 'gms' }. Sets the jobsheets module override
 * (explicit on/off so the mode is definitive regardless of plan default) AND
 * operating_mode in one atomic upsert.
 */
adminOrgRoutes.put('/:id/operating-mode', async (c) => {
  const superAdmin = c.get('superAdmin')
  const orgId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const operatingMode = body?.operatingMode
  if (operatingMode !== 'vhc_only' && operatingMode !== 'gms') {
    return c.json({ error: "operatingMode must be 'vhc_only' or 'gms'" }, 400)
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .single()
  if (!org) return c.json({ error: 'Organisation not found' }, 404)

  const gms = operatingMode === 'gms'
  const { data: existing } = await supabaseAdmin
    .from('organization_settings')
    .select('module_overrides')
    .eq('organization_id', orgId)
    .maybeSingle()
  const next: Record<string, boolean> = { ...((existing?.module_overrides as Record<string, boolean>) || {}) }
  next.jobsheets = gms

  const { error } = await supabaseAdmin
    .from('organization_settings')
    .upsert(
      { organization_id: orgId, module_overrides: next, operating_mode: operatingMode, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' }
    )
  if (error) return c.json({ error: error.message }, 500)

  await logSuperAdminActivity(
    superAdmin.id,
    'set_operating_mode',
    'organization_settings',
    orgId,
    { organizationName: org.name, operatingMode },
    getClientIp(c),
    c.req.header('User-Agent')
  )

  const detail = await getOrgModuleDetail(orgId)
  const modules = detail.map((m) => ({
    ...m,
    label: MODULE_MAP[m.key].label,
    description: MODULE_MAP[m.key].description
  }))
  return c.json({ success: true, operatingMode, modules })
})

export default adminOrgRoutes
