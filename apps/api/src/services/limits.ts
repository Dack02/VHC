/**
 * Limit Enforcement Service
 * Checks subscription limits before allowing actions
 */

import { supabaseAdmin } from '../lib/supabase.js'

export interface LimitCheckResult {
  allowed: boolean
  current: number
  limit: number
  message?: string
}

/**
 * Get organization's subscription plan limits
 */
async function getPlanLimits(organizationId: string): Promise<{
  maxSites: number
  maxUsers: number
  maxHealthChecksPerMonth: number
  maxStorageGb: number
} | null> {
  const { data: subscription } = await supabaseAdmin
    .from('organization_subscriptions')
    .select(`
      plan:subscription_plans(
        max_sites,
        max_users,
        max_health_checks_per_month,
        max_storage_gb
      )
    `)
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .single()

  const planArray = subscription?.plan as { max_sites: number; max_users: number; max_health_checks_per_month: number; max_storage_gb: number }[] | null
  const plan = planArray?.[0]

  if (!plan) {
    // No active subscription - allow unlimited usage (subscription not enforced yet)
    return {
      maxSites: -1,
      maxUsers: -1,
      maxHealthChecksPerMonth: -1,
      maxStorageGb: -1
    }
  }

  return {
    maxSites: plan.max_sites,
    maxUsers: plan.max_users,
    maxHealthChecksPerMonth: plan.max_health_checks_per_month,
    maxStorageGb: plan.max_storage_gb
  }
}

/**
 * Check if organization can add more sites
 */
export async function checkSiteLimit(organizationId: string): Promise<LimitCheckResult> {
  const limits = await getPlanLimits(organizationId)

  if (!limits) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: 'No active subscription found'
    }
  }

  // Count current active sites
  const { count } = await supabaseAdmin
    .from('sites')
    .select('id', { count: 'exact' })
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  const currentSites = count || 0

  // -1 means unlimited
  if (limits.maxSites !== -1 && currentSites >= limits.maxSites) {
    return {
      allowed: false,
      current: currentSites,
      limit: limits.maxSites,
      message: `Site limit reached (${currentSites}/${limits.maxSites}). Upgrade your plan to add more sites.`
    }
  }

  return {
    allowed: true,
    current: currentSites,
    limit: limits.maxSites
  }
}

/**
 * Check if organization can add more users
 */
export async function checkUserLimit(organizationId: string): Promise<LimitCheckResult> {
  const limits = await getPlanLimits(organizationId)

  if (!limits) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: 'No active subscription found'
    }
  }

  // Count current active users
  const { count } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact' })
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  const currentUsers = count || 0

  // -1 means unlimited
  if (limits.maxUsers !== -1 && currentUsers >= limits.maxUsers) {
    return {
      allowed: false,
      current: currentUsers,
      limit: limits.maxUsers,
      message: `User limit reached (${currentUsers}/${limits.maxUsers}). Upgrade your plan to add more users.`
    }
  }

  return {
    allowed: true,
    current: currentUsers,
    limit: limits.maxUsers
  }
}

/**
 * Check if organization can create more health checks this month
 */
export async function checkHealthCheckLimit(organizationId: string): Promise<LimitCheckResult> {
  const limits = await getPlanLimits(organizationId)

  if (!limits) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: 'No active subscription found'
    }
  }

  // Get current month's usage
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const { data: usage } = await supabaseAdmin
    .from('organization_usage')
    .select('health_checks_created')
    .eq('organization_id', organizationId)
    .eq('period_start', periodStart)
    .single()

  const currentHealthChecks = usage?.health_checks_created || 0

  // -1 means unlimited
  if (limits.maxHealthChecksPerMonth !== -1 && currentHealthChecks >= limits.maxHealthChecksPerMonth) {
    return {
      allowed: false,
      current: currentHealthChecks,
      limit: limits.maxHealthChecksPerMonth,
      message: `Monthly health check limit reached (${currentHealthChecks}/${limits.maxHealthChecksPerMonth}). Upgrade your plan or wait until next month.`
    }
  }

  return {
    allowed: true,
    current: currentHealthChecks,
    limit: limits.maxHealthChecksPerMonth
  }
}

/**
 * Check storage limit
 */
export async function checkStorageLimit(organizationId: string, additionalBytes: number = 0): Promise<LimitCheckResult> {
  const limits = await getPlanLimits(organizationId)

  if (!limits) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: 'No active subscription found'
    }
  }

  // Get current month's usage
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const { data: usage } = await supabaseAdmin
    .from('organization_usage')
    .select('storage_used_bytes')
    .eq('organization_id', organizationId)
    .eq('period_start', periodStart)
    .single()

  const currentStorageBytes = (usage?.storage_used_bytes || 0) + additionalBytes
  const limitBytes = limits.maxStorageGb * 1024 * 1024 * 1024 // Convert GB to bytes

  // -1 means unlimited
  if (limits.maxStorageGb !== -1 && currentStorageBytes >= limitBytes) {
    const currentGb = (currentStorageBytes / (1024 * 1024 * 1024)).toFixed(2)
    return {
      allowed: false,
      current: currentStorageBytes,
      limit: limitBytes,
      message: `Storage limit reached (${currentGb}GB/${limits.maxStorageGb}GB). Upgrade your plan for more storage.`
    }
  }

  return {
    allowed: true,
    current: currentStorageBytes,
    limit: limitBytes
  }
}

/**
 * Get all limits and usage for an organization
 */
export async function getOrganizationLimits(organizationId: string): Promise<{
  sites: LimitCheckResult
  users: LimitCheckResult
  healthChecks: LimitCheckResult
  storage: LimitCheckResult
}> {
  const [sites, users, healthChecks, storage] = await Promise.all([
    checkSiteLimit(organizationId),
    checkUserLimit(organizationId),
    checkHealthCheckLimit(organizationId),
    checkStorageLimit(organizationId)
  ])

  return { sites, users, healthChecks, storage }
}

/**
 * Increment health check usage counter
 */
export async function incrementHealthCheckUsage(organizationId: string): Promise<void> {
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  // Try to update existing record
  const { data: existing } = await supabaseAdmin
    .from('organization_usage')
    .select('id, health_checks_created')
    .eq('organization_id', organizationId)
    .eq('period_start', periodStart)
    .single()

  if (existing) {
    await supabaseAdmin
      .from('organization_usage')
      .update({
        health_checks_created: (existing.health_checks_created || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)
  } else {
    await supabaseAdmin
      .from('organization_usage')
      .insert({
        organization_id: organizationId,
        period_start: periodStart,
        health_checks_created: 1
      })
  }
}

/**
 * Increment storage usage counter
 */
export async function incrementStorageUsage(organizationId: string, bytes: number): Promise<void> {
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  // Try to update existing record
  const { data: existing } = await supabaseAdmin
    .from('organization_usage')
    .select('id, storage_used_bytes')
    .eq('organization_id', organizationId)
    .eq('period_start', periodStart)
    .single()

  if (existing) {
    await supabaseAdmin
      .from('organization_usage')
      .update({
        storage_used_bytes: (existing.storage_used_bytes || 0) + bytes,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)
  } else {
    await supabaseAdmin
      .from('organization_usage')
      .insert({
        organization_id: organizationId,
        period_start: periodStart,
        storage_used_bytes: bytes
      })
  }
}
