/**
 * AI Alerts Service
 *
 * Handles checking and creating alerts for AI usage limits and costs.
 * Called after each AI generation to monitor thresholds.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'

// =============================================================================
// TYPES
// =============================================================================

interface OrgUsageStatus {
  currentGenerations: number
  limit: number
  percentageUsed: number
  warningAlreadySent: boolean
  reachedAlreadySent: boolean
}

// Interface reserved for future platform cost tracking
// interface PlatformCostStatus {
//   totalCostThisMonth: number
//   threshold: number
//   alertAlreadySent: boolean
// }

// =============================================================================
// ALERT CHECKING FUNCTIONS
// =============================================================================

/**
 * Check if organization has reached 80% of their AI generation limit
 * Creates an alert and updates org settings if threshold crossed
 */
export async function checkOrgLimitWarning(organizationId: string): Promise<boolean> {
  try {
    // Get current usage
    const { data, error } = await supabaseAdmin.rpc('get_org_ai_usage_summary', {
      p_organization_id: organizationId
    })

    if (error || !data?.[0]) {
      logger.debug('Could not get org usage for limit warning check', { organizationId, error })
      return false
    }

    const usage = data[0] as OrgUsageStatus & {
      current_generations: number
      monthly_limit: number
      percentage_used: number
      limit_warning_sent: boolean
      limit_reached_sent: boolean
    }

    const percentUsed = usage.percentage_used || 0
    const warningAlreadySent = usage.limit_warning_sent

    // Check if at 80% and warning not yet sent this period
    if (percentUsed >= 80 && percentUsed < 100 && !warningAlreadySent) {
      // Create alert
      await supabaseAdmin.rpc('check_and_create_ai_alert', {
        p_alert_type: 'org_limit_warning',
        p_organization_id: organizationId,
        p_threshold_value: 80,
        p_current_value: percentUsed,
        p_message: `Organisation has used ${usage.current_generations} of ${usage.monthly_limit} AI generations (${Math.round(percentUsed)}%)`
      })

      // Update org settings to mark warning as sent
      await supabaseAdmin
        .from('organization_ai_settings')
        .update({ limit_warning_sent_at: new Date().toISOString() })
        .eq('organization_id', organizationId)

      logger.info('AI limit warning alert created', { organizationId, percentUsed })
      return true
    }

    return false
  } catch (err) {
    logger.error('Failed to check org limit warning', { error: err, organizationId })
    return false
  }
}

/**
 * Check if organization has reached 100% of their AI generation limit
 * Creates an alert and updates org settings if threshold crossed
 */
export async function checkOrgLimitReached(organizationId: string): Promise<boolean> {
  try {
    // Get current usage
    const { data, error } = await supabaseAdmin.rpc('get_org_ai_usage_summary', {
      p_organization_id: organizationId
    })

    if (error || !data?.[0]) {
      logger.debug('Could not get org usage for limit reached check', { organizationId, error })
      return false
    }

    const usage = data[0] as {
      current_generations: number
      monthly_limit: number
      percentage_used: number
      limit_reached_sent: boolean
    }

    const percentUsed = usage.percentage_used || 0
    const reachedAlreadySent = usage.limit_reached_sent

    // Check if at 100% and notification not yet sent this period
    if (percentUsed >= 100 && !reachedAlreadySent) {
      // Create alert
      await supabaseAdmin.rpc('check_and_create_ai_alert', {
        p_alert_type: 'org_limit_reached',
        p_organization_id: organizationId,
        p_threshold_value: 100,
        p_current_value: percentUsed,
        p_message: `Organisation has reached their monthly AI generation limit (${usage.current_generations}/${usage.monthly_limit})`
      })

      // Update org settings to mark limit reached as sent
      await supabaseAdmin
        .from('organization_ai_settings')
        .update({ limit_reached_sent_at: new Date().toISOString() })
        .eq('organization_id', organizationId)

      logger.info('AI limit reached alert created', { organizationId, percentUsed })
      return true
    }

    return false
  } catch (err) {
    logger.error('Failed to check org limit reached', { error: err, organizationId })
    return false
  }
}

/**
 * Check if platform-wide AI cost has exceeded the threshold
 * Creates a platform-level alert if threshold crossed
 */
export async function checkPlatformCostAlert(): Promise<boolean> {
  try {
    // Get current month's total cost
    const { data: costData, error: costError } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('total_cost_usd')
      .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())

    if (costError) {
      logger.debug('Could not get platform cost', { error: costError })
      return false
    }

    const totalCost = (costData || []).reduce((sum, log) => sum + (parseFloat(log.total_cost_usd) || 0), 0)

    // Get threshold from settings
    const { data: settingData, error: settingError } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value')
      .eq('key', 'ai_cost_alert_threshold_usd')
      .single()

    if (settingError || !settingData?.value) {
      return false
    }

    const threshold = parseFloat(settingData.value)

    if (totalCost >= threshold) {
      // Check if alert already exists this month
      const { data: existingAlert } = await supabaseAdmin
        .from('ai_cost_alerts')
        .select('id')
        .eq('alert_type', 'platform_cost_alert')
        .is('organization_id', null)
        .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
        .is('acknowledged_at', null)
        .limit(1)
        .single()

      if (!existingAlert) {
        // Create platform cost alert
        await supabaseAdmin
          .from('ai_cost_alerts')
          .insert({
            alert_type: 'platform_cost_alert',
            organization_id: null,  // Platform-level
            threshold_value: threshold,
            current_value: totalCost,
            message: `Platform AI costs have reached $${totalCost.toFixed(2)} (threshold: $${threshold.toFixed(2)})`
          })

        logger.info('Platform cost alert created', { totalCost, threshold })
        return true
      }
    }

    return false
  } catch (err) {
    logger.error('Failed to check platform cost alert', { error: err })
    return false
  }
}

/**
 * Run all alert checks after an AI generation
 * Called from generateWithTracking in ai-reasons.ts
 */
export async function checkAlertsAfterGeneration(organizationId: string): Promise<void> {
  try {
    // Run checks in parallel (they're independent)
    await Promise.all([
      checkOrgLimitWarning(organizationId),
      checkOrgLimitReached(organizationId),
      checkPlatformCostAlert()
    ])
  } catch (err) {
    // Log but don't throw - alerts are secondary to the main operation
    logger.error('Error checking alerts after generation', { error: err, organizationId })
  }
}

// =============================================================================
// ALERT MANAGEMENT
// =============================================================================

/**
 * Get unacknowledged alerts for super admin
 */
export async function getUnacknowledgedAlerts(): Promise<{
  alerts: Array<{
    id: string
    alertType: string
    organizationId: string | null
    organizationName: string | null
    threshold: number
    currentValue: number
    message: string
    createdAt: string
  }>
  count: number
}> {
  const { data, error } = await supabaseAdmin
    .from('ai_cost_alerts')
    .select(`
      id,
      alert_type,
      organization_id,
      threshold_value,
      current_value,
      message,
      created_at,
      organization:organizations(name)
    `)
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error('Failed to fetch alerts: ' + error.message)
  }

  const alerts = (data || []).map(alert => ({
    id: alert.id,
    alertType: alert.alert_type,
    organizationId: alert.organization_id,
    organizationName: (alert.organization as { name: string }[] | null)?.[0]?.name || null,
    threshold: alert.threshold_value,
    currentValue: alert.current_value,
    message: alert.message,
    createdAt: alert.created_at
  }))

  return { alerts, count: alerts.length }
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('ai_cost_alerts')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: acknowledgedBy
    })
    .eq('id', alertId)

  if (error) {
    throw new Error('Failed to acknowledge alert: ' + error.message)
  }
}

/**
 * Get count of unacknowledged alerts
 */
export async function getUnacknowledgedAlertCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('ai_cost_alerts')
    .select('*', { count: 'exact', head: true })
    .is('acknowledged_at', null)

  if (error) {
    logger.error('Failed to count unacknowledged alerts', { error })
    return 0
  }

  return count || 0
}
