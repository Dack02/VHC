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

  // Get SMS/emails sent this month from the communication log (the reliable
  // per-message audit; status sent/delivered/bounced = successfully dispatched).
  // The organization_usage rollup counters are not consistently maintained, so
  // we count attributed (non-null organization_id) sent messages directly.
  const [{ count: smsCount }, { count: emailCount }] = await Promise.all([
    supabaseAdmin
      .from('communication_logs')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'sms')
      .in('status', ['sent', 'delivered', 'bounced'])
      .not('organization_id', 'is', null)
      .gte('created_at', monthStart),
    supabaseAdmin
      .from('communication_logs')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .in('status', ['sent', 'delivered', 'bounced'])
      .not('organization_id', 'is', null)
      .gte('created_at', monthStart)
  ])

  const smsThisMonth = smsCount || 0
  const emailsThisMonth = emailCount || 0

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
  const { limit = '50', offset = '0', action, targetType, superAdminId, organizationId, from, to, q } = c.req.query()

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
  if (from) {
    query = query.gte('created_at', new Date(from).toISOString())
  }
  if (to) {
    query = query.lte('created_at', new Date(to).toISOString())
  }
  if (q) {
    // Best-effort free-text over action + a curated set of detail keys.
    const safe = String(q).replace(/[,()]/g, '')
    query = query.or(`action.ilike.%${safe}%,details->>organizationName.ilike.%${safe}%,details->>email.ilike.%${safe}%,details->>userEmail.ilike.%${safe}%,details->>name.ilike.%${safe}%`)
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
 * GET /api/v1/admin/activity/export
 * CSV export of the platform activity log (same filters as /activity).
 */
adminStatsRoutes.get('/activity/export', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { action, targetType, superAdminId, organizationId, from, to, q } = c.req.query()

  let query = supabaseAdmin
    .from('super_admin_activity_log')
    .select(`*, super_admin:super_admins(name, email)`)

  if (action) query = query.eq('action', action)
  if (targetType) query = query.eq('target_type', targetType)
  if (superAdminId) query = query.eq('super_admin_id', superAdminId)
  if (organizationId) query = query.or(`target_id.eq.${organizationId},details->>organizationId.eq.${organizationId}`)
  if (from) query = query.gte('created_at', new Date(from).toISOString())
  if (to) query = query.lte('created_at', new Date(to).toISOString())
  if (q) {
    const safe = String(q).replace(/[,()]/g, '')
    query = query.or(`action.ilike.%${safe}%,details->>organizationName.ilike.%${safe}%,details->>email.ilike.%${safe}%,details->>userEmail.ilike.%${safe}%,details->>name.ilike.%${safe}%`)
  }
  query = query.order('created_at', { ascending: false }).limit(10000)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)

  const headers = ['date', 'super_admin', 'action', 'target_type', 'target_id', 'ip_address', 'details']
  const rows = (data || []).map((a) => {
    const sa = a.super_admin as { name?: string; email?: string } | null
    return [
      new Date(a.created_at).toISOString(),
      `"${(sa?.name || sa?.email || 'System').replace(/"/g, '""')}"`,
      a.action,
      a.target_type || '',
      a.target_id || '',
      a.ip_address || '',
      `"${JSON.stringify(a.details || {}).replace(/"/g, '""')}"`
    ].join(',')
  })
  const csv = [headers.join(','), ...rows].join('\n')

  await logSuperAdminActivity(
    superAdmin.id, 'export_admin_activity', 'super_admin_activity_log', undefined,
    { filters: { action, from, to, q }, rowCount: rows.length },
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'), c.req.header('User-Agent')
  )

  const filename = `admin-activity-${new Date().toISOString().split('T')[0]}.csv`
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` } })
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

  // Record a server-side impersonation session (audit + expiry visibility).
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const { data: sessionRow } = await supabaseAdmin
    .from('impersonation_sessions')
    .insert({
      super_admin_id: superAdmin.id,
      target_user_id: user.id,
      organization_id: user.organization_id,
      reason,
      ip_address: c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      user_agent: c.req.header('User-Agent'),
      expires_at: expiresAt
    })
    .select('id')
    .single()

  // Return the user data for the frontend to set up impersonation session
  return c.json({
    success: true,
    impersonation: {
      originalSuperAdminId: superAdmin.id,
      originalSuperAdminEmail: superAdmin.email,
      reason,
      startedAt: new Date().toISOString(),
      sessionId: sessionRow?.id || null,
      expiresAt
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

  // Close the server-side session if a sessionId was provided (body or query).
  let sessionId: string | undefined
  try { sessionId = (await c.req.json())?.sessionId } catch { /* no body */ }
  if (!sessionId) sessionId = c.req.query('sessionId')
  if (sessionId) {
    await supabaseAdmin
      .from('impersonation_sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: 'manual' })
      .eq('id', sessionId)
      .is('ended_at', null)
  }

  await logSuperAdminActivity(
    superAdmin.id,
    'end_impersonation',
    'users',
    undefined,
    { sessionId },
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
    c.req.header('User-Agent')
  )

  return c.json({ success: true, message: 'Impersonation session ended' })
})

/**
 * GET /api/v1/admin/impersonate/sessions
 * Active and recent impersonation sessions.
 */
adminStatsRoutes.get('/impersonate/sessions', async (c) => {
  const { data, error } = await supabaseAdmin
    .from('impersonation_sessions')
    .select(`
      *,
      super_admin:super_admins(name, email),
      target:users(email, first_name, last_name),
      organization:organizations(name)
    `)
    .order('started_at', { ascending: false })
    .limit(50)

  if (error) return c.json({ error: error.message }, 500)

  const now = Date.now()
  return c.json({
    sessions: (data || []).map((s) => {
      const expired = !s.ended_at && new Date(s.expires_at).getTime() < now
      const target = s.target as { email?: string; first_name?: string; last_name?: string } | null
      return {
        id: s.id,
        superAdmin: s.super_admin,
        targetEmail: target?.email || null,
        targetName: target ? `${target.first_name || ''} ${target.last_name || ''}`.trim() : null,
        organizationName: (s.organization as { name?: string } | null)?.name || null,
        reason: s.reason,
        startedAt: s.started_at,
        expiresAt: s.expires_at,
        endedAt: s.ended_at,
        active: !s.ended_at && !expired,
        status: s.ended_at ? (s.end_reason || 'ended') : (expired ? 'expired' : 'active')
      }
    })
  })
})

/**
 * POST /api/v1/admin/impersonate/sessions/:id/revoke
 * Force-end another admin's active impersonation session.
 */
adminStatsRoutes.post('/impersonate/sessions/:id/revoke', async (c) => {
  const superAdmin = c.get('superAdmin')
  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: 'admin_revoked' })
    .eq('id', id)
    .is('ended_at', null)
  if (error) return c.json({ error: error.message }, 500)

  await logSuperAdminActivity(
    superAdmin.id, 'revoke_impersonation', 'impersonation_sessions', id, {},
    c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'), c.req.header('User-Agent')
  )
  return c.json({ success: true })
})

export default adminStatsRoutes
