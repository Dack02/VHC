/**
 * Super Admin org-level audit browser over the audit_logs table (security-
 * sensitive actions by users/customers/system/admin, org-scoped). Separate from
 * the super_admin_activity_log (platform-admin actions) at /admin/activity — the
 * two logs have different shapes, so they're browsed side-by-side, not unioned.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity, getClientIp } from '../../middleware/auth.js'
import { logger } from '../../lib/logger.js'

const adminAudit = new Hono()

adminAudit.use('*', superAdminMiddleware)

const ipUa = (c: { req: { header: (k: string) => string | undefined } }) =>
  [getClientIp(c), c.req.header('User-Agent')] as const

interface AuditRow {
  id: string
  action: string
  actor_id: string | null
  actor_type: string
  organization_id: string | null
  resource_type: string | null
  resource_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
  organizations: { name: string }[] | { name: string } | null
}

const orgName = (rel: AuditRow['organizations']): string | null => {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0]?.name || null) : (rel.name || null)
}

/**
 * GET /api/v1/admin/audit
 */
adminAudit.get('/', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { organizationId, actorType, action, resourceType, from, to, q, page = '1', limit = '50' } = c.req.query()

  try {
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    let query = supabaseAdmin
      .from('audit_logs')
      .select(`*, organizations(name)`, { count: 'exact' })

    if (organizationId) query = query.eq('organization_id', organizationId)
    if (actorType) query = query.eq('actor_type', actorType)
    if (action) query = query.eq('action', action)
    if (resourceType) query = query.eq('resource_type', resourceType)
    if (from) query = query.gte('created_at', new Date(from).toISOString())
    if (to) query = query.lte('created_at', new Date(to).toISOString())
    if (q) {
      const safe = String(q).replace(/[,()]/g, '')
      query = query.or(`action.ilike.%${safe}%,resource_type.ilike.%${safe}%,resource_id.ilike.%${safe}%`)
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limitNum - 1)

    const { data, error, count } = await query
    if (error) throw new Error(error.message)

    const logs = ((data as AuditRow[] | null) || []).map((a) => ({
      id: a.id,
      action: a.action,
      actorId: a.actor_id,
      actorType: a.actor_type,
      organizationId: a.organization_id,
      organizationName: orgName(a.organizations),
      resourceType: a.resource_type,
      resourceId: a.resource_id,
      metadata: a.metadata,
      ipAddress: a.ip_address,
      createdAt: a.created_at
    }))

    const total = count || 0
    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'view_org_audit', 'audit_logs', undefined, { filters: { organizationId, actorType, action, from, to }, page: pageNum }, ip, ua)

    return c.json({ logs, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
  } catch (error) {
    logger.error('Error fetching org audit logs', { error })
    const message = error instanceof Error ? error.message : 'Failed to fetch audit logs'
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /api/v1/admin/audit/export
 */
adminAudit.get('/export', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { organizationId, actorType, action, resourceType, from, to, q } = c.req.query()

  try {
    let query = supabaseAdmin
      .from('audit_logs')
      .select(`*, organizations(name)`)

    if (organizationId) query = query.eq('organization_id', organizationId)
    if (actorType) query = query.eq('actor_type', actorType)
    if (action) query = query.eq('action', action)
    if (resourceType) query = query.eq('resource_type', resourceType)
    if (from) query = query.gte('created_at', new Date(from).toISOString())
    if (to) query = query.lte('created_at', new Date(to).toISOString())
    if (q) {
      const safe = String(q).replace(/[,()]/g, '')
      query = query.or(`action.ilike.%${safe}%,resource_type.ilike.%${safe}%,resource_id.ilike.%${safe}%`)
    }
    query = query.order('created_at', { ascending: false }).limit(10000)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const headers = ['date', 'organization', 'actor_type', 'action', 'resource_type', 'resource_id', 'ip_address', 'metadata']
    const rows = ((data as AuditRow[] | null) || []).map((a) => [
      new Date(a.created_at).toISOString(),
      `"${(orgName(a.organizations) || '').replace(/"/g, '""')}"`,
      a.actor_type,
      a.action,
      a.resource_type || '',
      a.resource_id || '',
      a.ip_address || '',
      `"${JSON.stringify(a.metadata || {}).replace(/"/g, '""')}"`
    ].join(','))
    const csv = [headers.join(','), ...rows].join('\n')

    const [ip, ua] = ipUa(c)
    await logSuperAdminActivity(superAdmin.id, 'export_org_audit', 'audit_logs', undefined, { filters: { organizationId, actorType, action, from, to }, rowCount: rows.length }, ip, ua)

    const filename = `org-audit-${new Date().toISOString().split('T')[0]}.csv`
    return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` } })
  } catch (error) {
    logger.error('Error exporting org audit logs', { error })
    const message = error instanceof Error ? error.message : 'Failed to export audit logs'
    return c.json({ error: message }, 500)
  }
})

export default adminAudit
