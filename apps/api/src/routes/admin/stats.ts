/**
 * Super Admin Stats, Activity, Impersonation, and Plans API Routes
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'

const adminStatsRoutes = new Hono()

// All routes require super admin authentication
adminStatsRoutes.use('*', superAdminMiddleware)

/**
 * GET /api/v1/admin/stats
 * Platform-wide stats for dashboard
 */
adminStatsRoutes.get('/stats', async (c) => {
  const superAdmin = c.get('superAdmin')

  // Get organization counts by status
  const { data: orgCounts } = await supabaseAdmin
    .from('organizations')
    .select('status')

  const orgStats = {
    total: orgCounts?.length || 0,
    active: orgCounts?.filter(o => o.status === 'active').length || 0,
    pending: orgCounts?.filter(o => o.status === 'pending').length || 0,
    suspended: orgCounts?.filter(o => o.status === 'suspended').length || 0,
    cancelled: orgCounts?.filter(o => o.status === 'cancelled').length || 0
  }

  // Get active users count
  const { count: activeUsers } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact' })
    .eq('is_active', true)

  // Get total users count
  const { count: totalUsers } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact' })

  // Get health checks this month
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { count: healthChecksThisMonth } = await supabaseAdmin
    .from('health_checks')
    .select('id', { count: 'exact' })
    .gte('created_at', monthStart)

  // Get total health checks
  const { count: totalHealthChecks } = await supabaseAdmin
    .from('health_checks')
    .select('id', { count: 'exact' })

  // Get SMS/emails this month (from usage table)
  const { data: usageData } = await supabaseAdmin
    .from('organization_usage')
    .select('sms_sent, emails_sent')
    .eq('period_start', monthStart)

  const smsThisMonth = usageData?.reduce((sum, u) => sum + (u.sms_sent || 0), 0) || 0
  const emailsThisMonth = usageData?.reduce((sum, u) => sum + (u.emails_sent || 0), 0) || 0

  // Get MRR (Monthly Recurring Revenue)
  const { data: subscriptions } = await supabaseAdmin
    .from('organization_subscriptions')
    .select(`
      plan:subscription_plans(price_monthly)
    `)
    .eq('status', 'active')

  const mrr = subscriptions?.reduce((sum, sub) => {
    const plan = sub.plan as { price_monthly?: number } | null
    return sum + (plan?.price_monthly || 0)
  }, 0) || 0

  // Get sites count
  const { count: totalSites } = await supabaseAdmin
    .from('sites')
    .select('id', { count: 'exact' })
    .eq('is_active', true)

  // Get recent activity
  const { data: recentActivity } = await supabaseAdmin
    .from('super_admin_activity_log')
    .select(`
      id,
      action,
      target_type,
      target_id,
      details,
      created_at,
      super_admin:super_admins(name, email)
    `)
    .order('created_at', { ascending: false })
    .limit(10)

  // Log this stats view
  await logSuperAdminActivity(
    superAdmin.id,
    'view_platform_stats',
    'platform',
    undefined,
    undefined,
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
    c.req.header('User-Agent')
  )

  return c.json({
    organizations: orgStats,
    users: {
      total: totalUsers || 0,
      active: activeUsers || 0
    },
    sites: {
      total: totalSites || 0
    },
    healthChecks: {
      total: totalHealthChecks || 0,
      thisMonth: healthChecksThisMonth || 0
    },
    communications: {
      smsThisMonth,
      emailsThisMonth
    },
    revenue: {
      mrr,
      currency: 'GBP'
    },
    recentActivity: recentActivity?.map(a => ({
      id: a.id,
      action: a.action,
      targetType: a.target_type,
      targetId: a.target_id,
      details: a.details,
      createdAt: a.created_at,
      superAdmin: a.super_admin
    })) || []
  })
})

/**
 * GET /api/v1/admin/activity
 * Get activity log (paginated)
 */
adminStatsRoutes.get('/activity', async (c) => {
  const { limit = '50', offset = '0', action, targetType, superAdminId, organizationId } = c.req.query()

  let query = supabaseAdmin
    .from('super_admin_activity_log')
    .select(`
      *,
      super_admin:super_admins(id, name, email)
    `, { count: 'exact' })

  // Apply filters
  if (action) {
    query = query.eq('action', action)
  }
  if (targetType) {
    query = query.eq('target_type', targetType)
  }
  if (superAdminId) {
    query = query.eq('super_admin_id', superAdminId)
  }
  if (organizationId) {
    query = query.or(`target_id.eq.${organizationId},details->>organizationId.eq.${organizationId}`)
  }

  // Apply pagination
  query = query
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

  const { data: activity, error, count } = await query

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    activity: activity?.map(a => ({
      id: a.id,
      action: a.action,
      targetType: a.target_type,
      targetId: a.target_id,
      details: a.details,
      ipAddress: a.ip_address,
      userAgent: a.user_agent,
      createdAt: a.created_at,
      superAdmin: a.super_admin
    })) || [],
    pagination: {
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    }
  })
})

/**
 * GET /api/v1/admin/plans
 * List all subscription plans
 */
adminStatsRoutes.get('/plans', async (c) => {
  const { data: plans, error } = await supabaseAdmin
    .from('subscription_plans')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Get subscriber counts for each plan
  const { data: subscriptions } = await supabaseAdmin
    .from('organization_subscriptions')
    .select('plan_id')
    .eq('status', 'active')

  const subscriberCounts: Record<string, number> = {}
  subscriptions?.forEach(sub => {
    subscriberCounts[sub.plan_id] = (subscriberCounts[sub.plan_id] || 0) + 1
  })

  return c.json({
    plans: plans?.map(plan => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.price_monthly,
      priceAnnual: plan.price_annual,
      currency: plan.currency,
      maxSites: plan.max_sites,
      maxUsers: plan.max_users,
      maxHealthChecksPerMonth: plan.max_health_checks_per_month,
      maxStorageGb: plan.max_storage_gb,
      features: plan.features,
      isActive: plan.is_active,
      sortOrder: plan.sort_order,
      subscriberCount: subscriberCounts[plan.id] || 0
    })) || []
  })
})

/**
 * PATCH /api/v1/admin/plans/:id
 * Update subscription plan
 */
adminStatsRoutes.patch('/plans/:id', async (c) => {
  const superAdmin = c.get('superAdmin')
  const planId = c.req.param('id')
  const body = await c.req.json()

  const {
    name,
    description,
    priceMonthly,
    priceAnnual,
    maxSites,
    maxUsers,
    maxHealthChecksPerMonth,
    maxStorageGb,
    features,
    isActive,
    sortOrder
  } = body

  // Build update data
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  if (name !== undefined) updateData.name = name
  if (description !== undefined) updateData.description = description
  if (priceMonthly !== undefined) updateData.price_monthly = priceMonthly
  if (priceAnnual !== undefined) updateData.price_annual = priceAnnual
  if (maxSites !== undefined) updateData.max_sites = maxSites
  if (maxUsers !== undefined) updateData.max_users = maxUsers
  if (maxHealthChecksPerMonth !== undefined) updateData.max_health_checks_per_month = maxHealthChecksPerMonth
  if (maxStorageGb !== undefined) updateData.max_storage_gb = maxStorageGb
  if (features !== undefined) updateData.features = features
  if (isActive !== undefined) updateData.is_active = isActive
  if (sortOrder !== undefined) updateData.sort_order = sortOrder

  const { data: plan, error } = await supabaseAdmin
    .from('subscription_plans')
    .update(updateData)
    .eq('id', planId)
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'update_plan',
    'subscription_plans',
    planId,
    { changes: Object.keys(updateData).filter(k => k !== 'updated_at') },
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
    c.req.header('User-Agent')
  )

  return c.json({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceMonthly: plan.price_monthly,
    priceAnnual: plan.price_annual,
    currency: plan.currency,
    maxSites: plan.max_sites,
    maxUsers: plan.max_users,
    maxHealthChecksPerMonth: plan.max_health_checks_per_month,
    maxStorageGb: plan.max_storage_gb,
    features: plan.features,
    isActive: plan.is_active,
    sortOrder: plan.sort_order,
    updatedAt: plan.updated_at
  })
})

/**
 * POST /api/v1/admin/impersonate/:userId
 * Start impersonation session
 *
 * Returns user info and a flag for the frontend to set up impersonation.
 * The frontend will use the super admin's existing token but track the
 * impersonation state in localStorage.
 */
adminStatsRoutes.post('/impersonate/:userId', async (c) => {
  const superAdmin = c.get('superAdmin')
  const userId = c.req.param('userId')
  const body = await c.req.json()
  const { reason } = body

  if (!reason) {
    return c.json({ error: 'Reason is required for impersonation' }, 400)
  }

  // Get the user to impersonate with organization status
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select(`
      *,
      organization:organizations(id, name, slug, status),
      site:sites(id, name)
    `)
    .eq('id', userId)
    .single()

  if (userError || !user) {
    return c.json({ error: 'User not found' }, 404)
  }

  if (!user.is_active) {
    return c.json({ error: 'Cannot impersonate inactive user' }, 400)
  }

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'start_impersonation',
    'users',
    userId,
    {
      userEmail: user.email,
      userName: `${user.first_name} ${user.last_name}`,
      organizationId: user.organization_id,
      organizationName: user.organization?.name,
      reason
    },
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
    c.req.header('User-Agent')
  )

  // Return the user data for the frontend to set up impersonation session
  return c.json({
    success: true,
    impersonation: {
      originalSuperAdminId: superAdmin.id,
      originalSuperAdminEmail: superAdmin.email,
      reason,
      startedAt: new Date().toISOString()
    },
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isOrgAdmin: user.is_org_admin,
      isSiteAdmin: user.is_site_admin,
      organization: user.organization,
      site: user.site
    }
  })
})

/**
 * DELETE /api/v1/admin/impersonate
 * End impersonation session
 */
adminStatsRoutes.delete('/impersonate', async (c) => {
  const superAdmin = c.get('superAdmin')

  // Log activity
  await logSuperAdminActivity(
    superAdmin.id,
    'end_impersonation',
    'users',
    undefined,
    undefined,
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
    c.req.header('User-Agent')
  )

  return c.json({
    success: true,
    message: 'Impersonation session ended'
  })
})

export default adminStatsRoutes
