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
}

export interface AuthContext {
  user: AuthUser
  orgId: string
}

// Extend Hono context with auth
declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext
  }
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
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('auth_id', authUser.id)
      .single()

    if (userError || !user) {
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
        isActive: user.is_active
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
