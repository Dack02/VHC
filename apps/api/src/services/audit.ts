/**
 * Audit Logging Service
 * Records sensitive actions for compliance and security review
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'

export type AuditAction =
  // Authentication
  | 'auth.login'
  | 'auth.logout'
  | 'auth.password_change'
  | 'auth.password_reset'
  | 'auth.failed_login'

  // User management
  | 'user.create'
  | 'user.update'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'user.role_change'

  // Organization
  | 'org.settings_update'
  | 'org.branding_update'
  | 'org.plan_change'

  // Health checks
  | 'health_check.create'
  | 'health_check.delete'
  | 'health_check.status_change'
  | 'health_check.send_to_customer'

  // Customer actions
  | 'customer.authorize'
  | 'customer.decline'
  | 'customer.sign'
  | 'customer.view'

  // Repair item outcomes
  | 'repair_item.authorise'
  | 'repair_item.defer'
  | 'repair_item.decline'
  | 'repair_item.delete'
  | 'repair_item.reset'
  | 'repair_item.bulk_authorise'
  | 'repair_item.bulk_defer'
  | 'repair_item.bulk_decline'

  // Labour events (for timeline tracking)
  | 'labour.add'
  | 'labour.update'
  | 'labour.delete'
  | 'labour.complete'

  // Parts events (for timeline tracking)
  | 'parts.add'
  | 'parts.update'
  | 'parts.delete'
  | 'parts.complete'

  // Admin actions
  | 'admin.impersonate_start'
  | 'admin.impersonate_end'
  | 'admin.org_suspend'
  | 'admin.org_unsuspend'
  | 'admin.plan_override'

  // Security
  | 'security.rate_limit_exceeded'
  | 'security.invalid_token'
  | 'security.unauthorized_access'

interface AuditLogEntry {
  action: AuditAction
  actorId?: string
  actorType: 'user' | 'customer' | 'system' | 'admin'
  organizationId?: string
  resourceType?: string
  resourceId?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

/**
 * Log an audit event
 * Stores in database and logs to structured logger
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  const timestamp = new Date().toISOString()

  // Log to structured logger
  logger.info(`AUDIT: ${entry.action}`, {
    action: entry.action,
    actorId: entry.actorId,
    actorType: entry.actorType,
    orgId: entry.organizationId,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    metadata: entry.metadata,
    ipAddress: entry.ipAddress,
  })

  // Store in database (if audit_logs table exists)
  try {
    const { error } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        action: entry.action,
        actor_id: entry.actorId,
        actor_type: entry.actorType,
        organization_id: entry.organizationId,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId,
        metadata: entry.metadata,
        ip_address: entry.ipAddress,
        user_agent: entry.userAgent,
        created_at: timestamp,
      })

    if (error) {
      // Don't throw - audit logging shouldn't break the application
      logger.warn('Failed to store audit log in database', {
        action: entry.action,
      }, error as Error)
    }
  } catch (err) {
    // Table might not exist yet - just log warning
    logger.debug('Audit logs table not available', { action: entry.action })
  }
}

/**
 * Create audit logger with preset context
 */
export function createAuditLogger(context: {
  actorId?: string
  actorType: AuditLogEntry['actorType']
  organizationId?: string
  ipAddress?: string
  userAgent?: string
}) {
  return {
    log: (
      action: AuditAction,
      resourceType?: string,
      resourceId?: string,
      metadata?: Record<string, unknown>
    ) => {
      return logAudit({
        action,
        resourceType,
        resourceId,
        metadata,
        ...context,
      })
    },
  }
}

/**
 * Helper to extract IP and user agent from Hono context
 */
export function getRequestContext(c: {
  req: { header: (name: string) => string | undefined }
}): { ipAddress?: string; userAgent?: string } {
  return {
    ipAddress:
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      undefined,
    userAgent: c.req.header('user-agent'),
  }
}
