import { Context, Next } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'

export interface AuthUser {
  id: string
  authId: string
  email: string
  firstName: string
  lastName: string
  role: string
  organizationId: string
  siteId: string | null
  isActive: boolean
  isOrgAdmin?: boolean
  isSiteAdmin?: boolean
}

export interface SuperAdmin {
  id: string
  email: string
  name: string
  authUserId: string
  isActive: boolean
}

export interface AuthContext {
  user: AuthUser
  orgId: string
}

export interface SuperAdminContext {
  superAdmin: SuperAdmin
}

// Extend Hono context with auth
declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext
    superAdmin: SuperAdmin
  }
}

// Database row shape for users table
interface DbUser {
  id: string
  auth_id: string
  email: string
  first_name: string
  last_name: string
  role: string
  organization_id: string
  site_id: string | null
  is_active: boolean
  is_org_admin?: boolean
  is_site_admin?: boolean
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401)
  }

  const token = authHeader.substring(7)

  try {
    // Verify the JWT with Supabase
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !authUser) {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }

    // Get the user record from our users table
    // With multi-org support, one auth_id can have multiple user rows.
    // Use X-Organization-Id header to pick the correct one.
    const requestedOrgId = c.req.header('X-Organization-Id')

    let user: DbUser | null = null

    if (requestedOrgId) {
      // Specific org requested — fetch that exact user record
      const { data, error: userError } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('auth_id', authUser.id)
        .eq('organization_id', requestedOrgId)
        .single()

      if (userError || !data) {
        return c.json({ error: 'User not found for this organization' }, 401)
      }
      user = data
    } else {
      // No org header — resolve from user_preferences or fall back to first record
      const { data: allUsers } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('auth_id', authUser.id)
        .eq('is_active', true)

      if (!allUsers || allUsers.length === 0) {
        return c.json({ error: 'User not found' }, 401)
      }

      if (allUsers.length === 1) {
        user = allUsers[0]
      } else {
        // Multiple orgs — check user_preferences for last active
        const { data: prefs } = await supabaseAdmin
          .from('user_preferences')
          .select('last_active_organization_id')
          .eq('auth_id', authUser.id)
          .single()

        const preferredOrgId = prefs?.last_active_organization_id
        user = allUsers.find((u: DbUser) => u.organization_id === preferredOrgId) || allUsers[0]
      }
    }

    if (!user) {
      return c.json({ error: 'User not found' }, 401)
    }

    if (!user.is_active) {
      return c.json({ error: 'User account is deactivated' }, 403)
    }

    // Set the auth context
    const authContext: AuthContext = {
      user: {
        id: user.id,
        authId: user.auth_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        organizationId: user.organization_id,
        siteId: user.site_id,
        isActive: user.is_active,
        isOrgAdmin: user.is_org_admin || false,
        isSiteAdmin: user.is_site_admin || false
      },
      orgId: user.organization_id
    }

    c.set('auth', authContext)

    // Set the org_id for RLS policies using a custom header approach
    // Note: For RLS to work, we'll use the service key with org filtering in queries

    await next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    return c.json({ error: 'Authentication failed' }, 401)
  }
}

// Role-based authorization middleware factory
type UserRole = 'super_admin' | 'org_admin' | 'site_admin' | 'service_advisor' | 'technician'

const roleHierarchy: Record<UserRole, number> = {
  'super_admin': 5,
  'org_admin': 4,
  'site_admin': 3,
  'service_advisor': 2,
  'technician': 1
}

export function authorize(allowedRoles: UserRole[]) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth')

    if (!auth) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    const userRole = auth.user.role as UserRole

    if (!allowedRoles.includes(userRole)) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    await next()
  }
}

// Helper to check if user has at least a certain role level
export function authorizeMinRole(minRole: UserRole) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth')

    if (!auth) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    const userRole = auth.user.role as UserRole
    const userLevel = roleHierarchy[userRole] || 0
    const requiredLevel = roleHierarchy[minRole] || 0

    if (userLevel < requiredLevel) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }

    await next()
  }
}

/**
 * Super Admin authentication middleware
 * Checks if user exists in super_admins table
 */
export async function superAdminMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401)
  }

  const token = authHeader.substring(7)

  try {
    // Verify the JWT with Supabase
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !authUser) {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }

    // Check if user is a super admin
    const { data: superAdmin, error: superAdminError } = await supabaseAdmin
      .from('super_admins')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .single()

    if (superAdminError || !superAdmin) {
      return c.json({ error: 'Super admin access required' }, 403)
    }

    if (!superAdmin.is_active) {
      return c.json({ error: 'Super admin account is deactivated' }, 403)
    }

    // Update last login
    await supabaseAdmin
      .from('super_admins')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', superAdmin.id)

    // Set the super admin context
    c.set('superAdmin', {
      id: superAdmin.id,
      email: superAdmin.email,
      name: superAdmin.name,
      authUserId: superAdmin.auth_user_id,
      isActive: superAdmin.is_active
    })

    await next()
  } catch (error) {
    console.error('Super admin middleware error:', error)
    return c.json({ error: 'Authentication failed' }, 401)
  }
}

/**
 * Org Admin authorization middleware
 * Must be used after authMiddleware
 */
export function requireOrgAdmin() {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth')

    if (!auth) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    if (!auth.user.isOrgAdmin && auth.user.role !== 'org_admin') {
      return c.json({ error: 'Organization admin access required' }, 403)
    }

    await next()
  }
}

/**
 * Site Admin authorization middleware
 * Must be used after authMiddleware
 */
export function requireSiteAdmin() {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth')

    if (!auth) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    if (!auth.user.isSiteAdmin && !auth.user.isOrgAdmin && auth.user.role !== 'site_admin' && auth.user.role !== 'org_admin') {
      return c.json({ error: 'Site admin access required' }, 403)
    }

    await next()
  }
}

/**
 * Log super admin activity
 */
export async function logSuperAdminActivity(
  superAdminId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    await supabaseAdmin.from('super_admin_activity_log').insert({
      super_admin_id: superAdminId,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      ip_address: ipAddress,
      user_agent: userAgent
    })
  } catch (error) {
    console.error('Failed to log super admin activity:', error)
  }
}
