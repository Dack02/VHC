/**
 * Super Admin AI Usage API Routes
 * Platform-wide AI usage monitoring and analytics
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'
import { logger } from '../../lib/logger.js'

const aiUsage = new Hono()

// All routes require super admin authentication
aiUsage.use('*', superAdminMiddleware)

/**
 * Parse period string to date range
 */
function getPeriodDates(period: string): { start: Date; end: Date } {
  const end = new Date()
  let start: Date

  switch (period) {
    case '7d':
      start = new Date(end)
      start.setDate(start.getDate() - 7)
      break
    case '90d':
      start = new Date(end)
      start.setDate(start.getDate() - 90)
      break
    case 'all':
      start = new Date('2020-01-01') // Far enough back
      break
    case '30d':
    default:
      start = new Date(end)
      start.setDate(start.getDate() - 30)
      break
  }

  return { start, end }
}

/**
 * GET /api/v1/admin/ai-usage/summary
 * Get platform-wide AI usage summary
 */
aiUsage.get('/summary', async (c) => {
  const superAdmin = c.get('superAdmin')
  const period = c.req.query('period') || '30d'

  try {
    const { start, end } = getPeriodDates(period)

    // Get totals
    const { data: totals, error: totalsError } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('id, input_tokens, output_tokens, total_tokens, total_cost_usd, success')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())

    if (totalsError) {
      throw new Error(`Failed to fetch totals: ${totalsError.message}`)
    }

    const logs = totals || []
    const totalGenerations = logs.length
    const totalTokens = logs.reduce((sum, l) => sum + (l.total_tokens || 0), 0)
    const totalCost = logs.reduce((sum, l) => sum + parseFloat(String(l.total_cost_usd || 0)), 0)
    const successCount = logs.filter(l => l.success).length
    const successRate = totalGenerations > 0 ? (successCount / totalGenerations) * 100 : 100

    // Get by action
    const { data: byActionData, error: actionError } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('action, input_tokens, output_tokens, total_tokens, total_cost_usd')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())

    if (actionError) {
      throw new Error(`Failed to fetch by action: ${actionError.message}`)
    }

    // Aggregate by action
    const actionMap = new Map<string, { count: number; tokens: number; cost: number }>()
    for (const log of byActionData || []) {
      const existing = actionMap.get(log.action) || { count: 0, tokens: 0, cost: 0 }
      actionMap.set(log.action, {
        count: existing.count + 1,
        tokens: existing.tokens + (log.total_tokens || 0),
        cost: existing.cost + parseFloat(String(log.total_cost_usd || 0))
      })
    }

    const byAction = Array.from(actionMap.entries()).map(([action, data]) => ({
      action,
      count: data.count,
      tokens: data.tokens,
      cost: Math.round(data.cost * 100) / 100
    })).sort((a, b) => b.count - a.count)

    // Get daily breakdown
    const { data: dailyData, error: dailyError } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('created_at, total_cost_usd')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: true })

    if (dailyError) {
      throw new Error(`Failed to fetch daily breakdown: ${dailyError.message}`)
    }

    // Aggregate by day
    const dailyMap = new Map<string, { generations: number; cost: number }>()
    for (const log of dailyData || []) {
      const date = new Date(log.created_at).toISOString().split('T')[0]
      const existing = dailyMap.get(date) || { generations: 0, cost: 0 }
      dailyMap.set(date, {
        generations: existing.generations + 1,
        cost: existing.cost + parseFloat(String(log.total_cost_usd || 0))
      })
    }

    const dailyBreakdown = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      generations: data.generations,
      cost: Math.round(data.cost * 100) / 100
    }))

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'view_ai_usage_summary',
      'ai_usage_logs',
      undefined,
      { period },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      period: {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      },
      totals: {
        generations: totalGenerations,
        tokens: totalTokens,
        costUsd: Math.round(totalCost * 100) / 100,
        successRate: Math.round(successRate * 10) / 10
      },
      byAction,
      dailyBreakdown
    })
  } catch (error) {
    logger.error('Error fetching AI usage summary', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch usage summary'
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /api/v1/admin/ai-usage/by-organization
 * Get usage breakdown by organization
 */
aiUsage.get('/by-organization', async (c) => {
  const superAdmin = c.get('superAdmin')
  const period = c.req.query('period') || '30d'
  const sort = c.req.query('sort') || 'cost_desc'

  try {
    const { start, end } = getPeriodDates(period)

    // Get all organizations
    const { data: orgs, error: orgsError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, status')
      .eq('status', 'active')

    if (orgsError) {
      throw new Error(`Failed to fetch organizations: ${orgsError.message}`)
    }

    // Get usage data for the period
    const { data: usageData, error: usageError } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('organization_id, total_tokens, total_cost_usd')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())

    if (usageError) {
      throw new Error(`Failed to fetch usage data: ${usageError.message}`)
    }

    // Aggregate by org
    const usageMap = new Map<string, { generations: number; tokens: number; cost: number }>()
    for (const log of usageData || []) {
      const existing = usageMap.get(log.organization_id) || { generations: 0, tokens: 0, cost: 0 }
      usageMap.set(log.organization_id, {
        generations: existing.generations + 1,
        tokens: existing.tokens + (log.total_tokens || 0),
        cost: existing.cost + parseFloat(String(log.total_cost_usd || 0))
      })
    }

    // Get limits for each org
    const { data: aiSettings, error: settingsError } = await supabaseAdmin
      .from('organization_ai_settings')
      .select('organization_id, monthly_generation_limit, current_period_generations')

    if (settingsError) {
      logger.warn('Failed to fetch AI settings', { error: settingsError.message })
    }

    const settingsMap = new Map<string, { limit: number | null; currentGenerations: number }>()
    for (const s of aiSettings || []) {
      settingsMap.set(s.organization_id, {
        limit: s.monthly_generation_limit,
        currentGenerations: s.current_period_generations || 0
      })
    }

    // Get default limit
    const { data: defaultLimitSetting } = await supabaseAdmin
      .from('platform_ai_settings')
      .select('value')
      .eq('key', 'default_monthly_ai_limit')
      .single()

    const defaultLimit = parseInt(defaultLimitSetting?.value || '100')

    // Build response
    let organizations = (orgs || []).map(org => {
      const usage = usageMap.get(org.id) || { generations: 0, tokens: 0, cost: 0 }
      const settings = settingsMap.get(org.id)
      const limit = settings?.limit || defaultLimit
      const currentMonthGenerations = settings?.currentGenerations || usage.generations

      return {
        id: org.id,
        name: org.name,
        generations: usage.generations,
        tokens: usage.tokens,
        costUsd: Math.round(usage.cost * 100) / 100,
        limit,
        currentMonthGenerations,
        percentageUsed: limit > 0 ? Math.round((currentMonthGenerations / limit) * 100 * 10) / 10 : 0
      }
    })

    // Sort
    switch (sort) {
      case 'generations_desc':
        organizations.sort((a, b) => b.generations - a.generations)
        break
      case 'name_asc':
        organizations.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'cost_desc':
      default:
        organizations.sort((a, b) => b.costUsd - a.costUsd)
        break
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'view_ai_usage_by_org',
      'ai_usage_logs',
      undefined,
      { period, sort },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      period: {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      },
      organizations
    })
  } catch (error) {
    logger.error('Error fetching AI usage by organization', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch usage by organization'
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /api/v1/admin/ai-usage/logs
 * Get detailed usage logs (paginated)
 */
aiUsage.get('/logs', async (c) => {
  const superAdmin = c.get('superAdmin')
  const {
    organization_id,
    action,
    from,
    to,
    page = '1',
    limit = '50'
  } = c.req.query()

  try {
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    // Build query
    let query = supabaseAdmin
      .from('ai_usage_logs')
      .select(`
        id,
        organization_id,
        user_id,
        action,
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        total_cost_usd,
        success,
        error_message,
        items_generated,
        duration_ms,
        template_item_id,
        reason_type,
        created_at,
        organizations!inner(name),
        users(first_name, last_name, email)
      `, { count: 'exact' })

    // Apply filters
    if (organization_id) {
      query = query.eq('organization_id', organization_id)
    }
    if (action) {
      query = query.eq('action', action)
    }
    if (from) {
      query = query.gte('created_at', new Date(from).toISOString())
    }
    if (to) {
      query = query.lte('created_at', new Date(to).toISOString())
    }

    // Order and paginate
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1)

    const { data: logs, error, count } = await query

    if (error) {
      throw new Error(`Failed to fetch logs: ${error.message}`)
    }

    // Transform logs
    const transformedLogs = (logs || []).map(log => {
      const org = (log.organizations as { name: string }[] | null)?.[0] ?? null
      const user = (log.users as { first_name: string | null; last_name: string | null; email: string }[] | null)?.[0] ?? null

      return {
        id: log.id,
        organizationId: log.organization_id,
        organizationName: org?.name || 'Unknown',
        userId: log.user_id,
        userName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email : 'System',
        action: log.action,
        model: log.model,
        inputTokens: log.input_tokens,
        outputTokens: log.output_tokens,
        totalTokens: log.total_tokens,
        costUsd: parseFloat(String(log.total_cost_usd || 0)),
        success: log.success,
        errorMessage: log.error_message,
        itemsGenerated: log.items_generated,
        durationMs: log.duration_ms,
        templateItemId: log.template_item_id,
        reasonType: log.reason_type,
        createdAt: log.created_at
      }
    })

    const total = count || 0
    const pages = Math.ceil(total / limitNum)

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'view_ai_usage_logs',
      'ai_usage_logs',
      undefined,
      { filters: { organization_id, action, from, to }, page: pageNum },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({
      logs: transformedLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages
      }
    })
  } catch (error) {
    logger.error('Error fetching AI usage logs', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch usage logs'
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /api/v1/admin/ai-usage/export
 * Export usage data as CSV
 */
aiUsage.get('/export', async (c) => {
  const superAdmin = c.get('superAdmin')
  const period = c.req.query('period') || '30d'
  const format = c.req.query('format') || 'csv'

  if (format !== 'csv') {
    return c.json({ error: 'Only CSV format is currently supported' }, 400)
  }

  try {
    const { start, end } = getPeriodDates(period)

    // Fetch all logs for the period with org and user info
    const { data: logs, error } = await supabaseAdmin
      .from('ai_usage_logs')
      .select(`
        created_at,
        action,
        model,
        input_tokens,
        output_tokens,
        total_cost_usd,
        success,
        organizations!inner(name),
        users(first_name, last_name, email)
      `)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to fetch logs: ${error.message}`)
    }

    // Build CSV
    const headers = ['date', 'organization', 'user', 'action', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'success']
    const rows = (logs || []).map(log => {
      const org = (log.organizations as { name: string }[] | null)?.[0] ?? null
      const user = (log.users as { first_name: string | null; last_name: string | null; email: string }[] | null)?.[0] ?? null
      const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email : 'System'

      return [
        new Date(log.created_at).toISOString().split('T')[0],
        `"${(org?.name || 'Unknown').replace(/"/g, '""')}"`,
        `"${userName.replace(/"/g, '""')}"`,
        log.action,
        log.model,
        log.input_tokens,
        log.output_tokens,
        parseFloat(String(log.total_cost_usd || 0)).toFixed(6),
        log.success ? 'true' : 'false'
      ].join(',')
    })

    const csv = [headers.join(','), ...rows].join('\n')

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'export_ai_usage',
      'ai_usage_logs',
      undefined,
      { period, format, rowCount: rows.length },
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    // Return as file download
    const filename = `ai-usage-${period}-${new Date().toISOString().split('T')[0]}.csv`

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    })
  } catch (error) {
    logger.error('Error exporting AI usage', { error })
    const message = error instanceof Error ? error.message : 'Failed to export usage data'
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /api/v1/admin/ai-usage/alerts/count
 * Get count of unacknowledged AI alerts (for badge display)
 */
aiUsage.get('/alerts/count', async (c) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('ai_cost_alerts')
      .select('*', { count: 'exact', head: true })
      .is('acknowledged_at', null)

    if (error) {
      throw new Error(`Failed to count alerts: ${error.message}`)
    }

    return c.json({ count: count || 0 })
  } catch (error) {
    logger.error('Error counting AI alerts', { error })
    return c.json({ count: 0 })
  }
})

/**
 * GET /api/v1/admin/ai-usage/alerts
 * Get unacknowledged AI cost alerts
 */
aiUsage.get('/alerts', async (c) => {
  try {
    const { data: alerts, error } = await supabaseAdmin
      .from('ai_cost_alerts')
      .select(`
        id,
        alert_type,
        organization_id,
        threshold_value,
        current_value,
        message,
        created_at,
        organizations(name)
      `)
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to fetch alerts: ${error.message}`)
    }

    return c.json({
      alerts: (alerts || []).map(alert => {
        const org = (alert.organizations as { name: string }[] | null)?.[0] ?? null
        return {
          id: alert.id,
          type: alert.alert_type,
          organizationId: alert.organization_id,
          organizationName: org?.name || null,
          thresholdValue: parseFloat(String(alert.threshold_value || 0)),
          currentValue: parseFloat(String(alert.current_value || 0)),
          message: alert.message,
          createdAt: alert.created_at
        }
      })
    })
  } catch (error) {
    logger.error('Error fetching AI alerts', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch alerts'
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/v1/admin/ai-usage/alerts/:id/acknowledge
 * Acknowledge an alert
 */
aiUsage.post('/alerts/:id/acknowledge', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { id } = c.req.param()

  try {
    const { error } = await supabaseAdmin
      .from('ai_cost_alerts')
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: superAdmin.id
      })
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to acknowledge alert: ${error.message}`)
    }

    // Log activity
    await logSuperAdminActivity(
      superAdmin.id,
      'acknowledge_ai_alert',
      'ai_cost_alerts',
      id,
      {},
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'),
      c.req.header('User-Agent')
    )

    return c.json({ success: true })
  } catch (error) {
    logger.error('Error acknowledging AI alert', { error })
    const message = error instanceof Error ? error.message : 'Failed to acknowledge alert'
    return c.json({ error: message }, 500)
  }
})

export default aiUsage
