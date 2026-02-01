import { Hono } from 'hono'
import { supabaseAuth, supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'

const auth = new Hono()

// POST /api/v1/auth/login
auth.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      return c.json({ error: error.message }, 401)
    }

    // First check if this is a super admin
    const { data: superAdmin } = await supabaseAdmin
      .from('super_admins')
      .select('*')
      .eq('auth_user_id', data.user.id)
      .single()

    if (superAdmin) {
      if (!superAdmin.is_active) {
        return c.json({ error: 'Account is deactivated' }, 403)
      }

      // Update last login
      await supabaseAdmin
        .from('super_admins')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', superAdmin.id)

      return c.json({
        user: {
          id: superAdmin.id,
          email: superAdmin.email,
          firstName: superAdmin.name.split(' ')[0] || superAdmin.name,
          lastName: superAdmin.name.split(' ').slice(1).join(' ') || '',
          role: 'super_admin',
          isSuperAdmin: true,
          isOrgAdmin: false,
          isSiteAdmin: false,
          organization: null,
          site: null
        },
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at
        }
      })
    }

    // Get ALL user records for this auth_id (multi-org support)
    const { data: allUsers, error: userError } = await supabaseAdmin
      .from('users')
      .select(`
        *,
        organization:organizations(id, name, slug, status, onboarding_completed, onboarding_step),
        site:sites(id, name)
      `)
      .eq('auth_id', data.user.id)
      .eq('is_active', true)

    if (userError || !allUsers || allUsers.length === 0) {
      return c.json({ error: 'User profile not found' }, 404)
    }

    // Determine which org to use as the active one
    let user = allUsers[0]
    if (allUsers.length > 1) {
      const { data: prefs } = await supabaseAdmin
        .from('user_preferences')
        .select('last_active_organization_id')
        .eq('auth_id', data.user.id)
        .single()

      if (prefs?.last_active_organization_id) {
        const preferred = allUsers.find((u: Record<string, unknown>) => u.organization_id === prefs.last_active_organization_id)
        if (preferred) user = preferred
      }
    }

    // Update last login for the active user
    await supabaseAdmin
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)

    // Transform organization data to include onboarding fields
    const org = user.organization as {
      id: string
      name: string
      slug: string
      status: string
      onboarding_completed: boolean
      onboarding_step: number
    } | null

    // Build organizations array for multi-org switcher
    const organizations = allUsers.map((u: Record<string, unknown>) => {
      const uOrg = u.organization as { id: string; name: string; slug: string } | null
      return {
        id: uOrg?.id || u.organization_id,
        name: uOrg?.name || 'Unknown',
        slug: uOrg?.slug || '',
        role: u.role as string,
        userId: u.id as string
      }
    })

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isSuperAdmin: false,
        isOrgAdmin: user.is_org_admin,
        isSiteAdmin: user.is_site_admin,
        organization: org ? {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
          onboardingCompleted: org.onboarding_completed,
          onboardingStep: org.onboarding_step
        } : null,
        site: user.site
      },
      organizations,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: 'Login failed' }, 500)
  }
})

// POST /api/v1/auth/logout
auth.post('/logout', authMiddleware, async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    const token = authHeader?.substring(7)

    if (token) {
      await supabaseAdmin.auth.admin.signOut(token)
    }

    return c.json({ message: 'Logged out successfully' })
  } catch (error) {
    console.error('Logout error:', error)
    return c.json({ error: 'Logout failed' }, 500)
  }
})

// GET /api/v1/auth/me
auth.get('/me', authMiddleware, async (c) => {
  try {
    const auth = c.get('auth')

    // Get full user details with organization and site
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select(`
        *,
        organization:organizations(id, name, slug, status, onboarding_completed, onboarding_step, settings),
        site:sites(id, name, address, phone, email, settings)
      `)
      .eq('id', auth.user.id)
      .single()

    if (error || !user) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Transform organization data
    const org = user.organization as {
      id: string
      name: string
      slug: string
      status: string
      onboarding_completed: boolean
      onboarding_step: number
      settings: unknown
    } | null

    // Fetch all org memberships for this auth user (multi-org support)
    const { data: allUsers } = await supabaseAdmin
      .from('users')
      .select(`
        id, role, organization_id,
        organization:organizations(id, name, slug)
      `)
      .eq('auth_id', auth.user.authId)
      .eq('is_active', true)

    const organizations = (allUsers || []).map((u: Record<string, unknown>) => {
      const uOrg = u.organization as { id: string; name: string; slug: string } | null
      return {
        id: uOrg?.id || u.organization_id,
        name: uOrg?.name || 'Unknown',
        slug: uOrg?.slug || '',
        role: u.role as string,
        userId: u.id as string
      }
    })

    return c.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      isOrgAdmin: user.is_org_admin,
      isSiteAdmin: user.is_site_admin,
      isActive: user.is_active,
      organization: org ? {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        onboardingCompleted: org.onboarding_completed,
        onboardingStep: org.onboarding_step,
        settings: org.settings
      } : null,
      site: user.site,
      settings: user.settings,
      createdAt: user.created_at,
      organizations
    })
  } catch (error) {
    console.error('Get me error:', error)
    return c.json({ error: 'Failed to get user' }, 500)
  }
})

// POST /api/v1/auth/refresh
auth.post('/refresh', async (c) => {
  try {
    const { refreshToken } = await c.req.json()

    if (!refreshToken) {
      return c.json({ error: 'Refresh token is required' }, 400)
    }

    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token: refreshToken
    })

    if (error) {
      return c.json({ error: error.message }, 401)
    }

    return c.json({
      session: {
        accessToken: data.session?.access_token,
        refreshToken: data.session?.refresh_token,
        expiresAt: data.session?.expires_at
      }
    })
  } catch (error) {
    console.error('Refresh error:', error)
    return c.json({ error: 'Token refresh failed' }, 500)
  }
})

// POST /api/v1/auth/switch-org
auth.post('/switch-org', authMiddleware, async (c) => {
  try {
    const auth = c.get('auth')
    const { organizationId } = await c.req.json()

    if (!organizationId) {
      return c.json({ error: 'organizationId is required' }, 400)
    }

    // Verify user has an active record in the target org
    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('users')
      .select(`
        *,
        organization:organizations(id, name, slug, status, onboarding_completed, onboarding_step),
        site:sites(id, name)
      `)
      .eq('auth_id', auth.user.authId)
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .single()

    if (targetError || !targetUser) {
      return c.json({ error: 'You do not have access to this organization' }, 403)
    }

    // Upsert user_preferences with last_active_organization_id
    await supabaseAdmin
      .from('user_preferences')
      .upsert({
        auth_id: auth.user.authId,
        last_active_organization_id: organizationId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'auth_id' })

    const org = targetUser.organization as {
      id: string
      name: string
      slug: string
      status: string
      onboarding_completed: boolean
      onboarding_step: number
    } | null

    return c.json({
      user: {
        id: targetUser.id,
        email: targetUser.email,
        firstName: targetUser.first_name,
        lastName: targetUser.last_name,
        role: targetUser.role,
        isSuperAdmin: false,
        isOrgAdmin: targetUser.is_org_admin,
        isSiteAdmin: targetUser.is_site_admin,
        organization: org ? {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
          onboardingCompleted: org.onboarding_completed,
          onboardingStep: org.onboarding_step
        } : null,
        site: targetUser.site
      }
    })
  } catch (error) {
    console.error('Switch org error:', error)
    return c.json({ error: 'Failed to switch organization' }, 500)
  }
})

export default auth
