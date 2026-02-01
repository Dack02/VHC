/**
 * Super Admin Organizations API Routes
 * Full CRUD and management of organizations
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'
import crypto from 'crypto'

const adminOrgRoutes = new Hono()

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
      org.organization_subscriptions?.[0]?.plan_id === plan
    )
  }

  // Transform to cleaner response
  const orgs = filteredOrgs.map(org => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    onboardingCompleted: org.onboarding_completed,
    createdAt: org.created_at,
    updatedAt: org.updated_at,
    settings: org.organization_settings?.[0] || null,
    subscription: org.organization_subscriptions?.[0] ? {
      planId: org.organization_subscriptions[0].plan_id,
      planName: org.organization_subscriptions[0].plan?.name,
      status: org.organization_subscriptions[0].status,
      currentPeriodEnd: org.organization_subscriptions[0].current_period_end
    } : null,
    sitesCount: org.sites?.[0]?.count || 0,
    usersCount: org.users?.[0]?.count || 0
  }))

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'list_organizations',
    'organizations',
    undefined,
    { filters: { status, plan, search }, count: orgs.length },
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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

  const {
    name,
    slug,
    planId = 'starter',
    // First admin user
    adminEmail,
    adminFirstName,
    adminLastName,
    adminPassword,
    // Optional settings
    settings = {}
  } = body

  if (!name || !adminEmail || !adminFirstName || !adminLastName) {
    return c.json({
      error: 'Name, adminEmail, adminFirstName, and adminLastName are required'
    }, 400)
  }

  // Generate slug if not provided
  const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  // Check if slug is unique
  const { data: existingOrg } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()

  if (existingOrg) {
    return c.json({ error: 'Organization slug already exists' }, 400)
  }

  try {
    // 1. Create the organization
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

    if (orgError) {
      return c.json({ error: orgError.message }, 500)
    }

    // 2. Create organization settings
    await supabaseAdmin
      .from('organization_settings')
      .insert({
        organization_id: org.id,
        ...settings
      })

    // 3. Create organization notification settings (with platform defaults)
    await supabaseAdmin
      .from('organization_notification_settings')
      .insert({
        organization_id: org.id,
        use_platform_sms: true,
        use_platform_email: true
      })

    // 4. Create organization subscription
    const periodStart = new Date()
    const periodEnd = new Date()
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    await supabaseAdmin
      .from('organization_subscriptions')
      .insert({
        organization_id: org.id,
        plan_id: planId,
        status: 'active',
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString()
      })

    // 5. Create first site (default)
    const { data: site } = await supabaseAdmin
      .from('sites')
      .insert({
        organization_id: org.id,
        name: `${name} - Main Site`,
        is_active: true
      })
      .select()
      .single()

    // 6. Create the admin user in Supabase Auth
    const tempPassword = adminPassword || crypto.randomBytes(16).toString('hex')

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name: adminFirstName,
        last_name: adminLastName
      }
    })

    if (authError) {
      // Rollback: delete organization
      await supabaseAdmin.from('organizations').delete().eq('id', org.id)
      return c.json({ error: `Failed to create admin user: ${authError.message}` }, 500)
    }

    // 7. Create the user record
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_id: authData.user.id,
        organization_id: org.id,
        site_id: site?.id,
        email: adminEmail,
        first_name: adminFirstName,
        last_name: adminLastName,
        role: 'org_admin',
        is_org_admin: true,
        is_active: true
      })
      .select()
      .single()

    if (userError) {
      // Rollback: delete auth user and organization
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      await supabaseAdmin.from('organizations').delete().eq('id', org.id)
      return c.json({ error: `Failed to create user record: ${userError.message}` }, 500)
    }

    // 8. Initialize usage tracking for current period
    const usagePeriodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const usagePeriodEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    await supabaseAdmin
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

    // 9. Auto-copy starter reasons if enabled
    let starterReasonsCopied = 0
    try {
      const { data: starterSettings } = await supabaseAdmin
        .from('platform_settings')
        .select('settings')
        .eq('id', 'starter_reasons')
        .single()

      const starterConfig = starterSettings?.settings as { auto_copy_on_create?: boolean; source_organization_id?: string } | null
      if (starterConfig?.auto_copy_on_create !== false) {
        // Copy starter reasons to new organization
        const { data: copyResult } = await supabaseAdmin.rpc('copy_starter_reasons_to_org', {
          target_org_id: org.id,
          source_org_id: starterConfig?.source_organization_id || null
        })
        starterReasonsCopied = copyResult || 0
      }
    } catch (starterError) {
      console.error('Failed to copy starter reasons:', starterError)
      // Non-blocking error - organization creation should still succeed
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'create_organization',
      'organizations',
      org.id,
      { name, slug: orgSlug, planId, adminEmail },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status
      },
      adminUser: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name
      },
      site: site ? {
        id: site.id,
        name: site.name
      } : null,
      temporaryPassword: adminPassword ? undefined : tempPassword,
      starterReasonsCopied
    }, 201)
  } catch (error) {
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
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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
    subscription: org.organization_subscriptions?.[0] ? (() => {
      const sub = org.organization_subscriptions[0]
      const planData = sub.plan as Record<string, unknown> | null
      return {
        id: sub.id,
        planId: sub.plan_id,
        planName: planData?.name || null,
        plan: sub.plan,
        status: sub.status,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        limits: planData ? {
          maxSites: planData.max_sites || 0,
          maxUsersPerSite: planData.max_users || 0,
          maxHealthChecksPerMonth: planData.max_health_checks_per_month || 0,
          maxStorageGb: planData.max_storage_gb || 0
        } : null
      }
    })() : null,
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
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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

  // Get last 12 months of usage
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

  const { data: history, error } = await supabaseAdmin
    .from('organization_usage')
    .select('*')
    .eq('organization_id', orgId)
    .gte('period_start', twelveMonthsAgo.toISOString())
    .order('period_start', { ascending: false })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    history: (history || []).map(period => ({
      periodStart: period.period_start,
      healthChecksCreated: period.health_checks_created,
      healthChecksCompleted: period.health_checks_completed,
      smsSent: period.sms_sent,
      emailsSent: period.emails_sent,
      storageUsedBytes: period.storage_used_bytes
    }))
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
            c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
            c.req.header('User-Agent')
          )

          return c.json({
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
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
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      temporaryPassword: tempPassword
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
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
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

export default adminOrgRoutes
