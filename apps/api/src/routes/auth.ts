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

    // Get the user record from our users table
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select(`
        *,
        organization:organizations(id, name, slug),
        site:sites(id, name)
      `)
      .eq('auth_id', data.user.id)
      .single()

    if (userError || !user) {
      return c.json({ error: 'User profile not found' }, 404)
    }

    if (!user.is_active) {
      return c.json({ error: 'Account is deactivated' }, 403)
    }

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        organization: user.organization,
        site: user.site
      },
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
        organization:organizations(id, name, slug, settings),
        site:sites(id, name, address, phone, email, settings)
      `)
      .eq('id', auth.user.id)
      .single()

    if (error || !user) {
      return c.json({ error: 'User not found' }, 404)
    }

    return c.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      isActive: user.is_active,
      organization: user.organization,
      site: user.site,
      settings: user.settings,
      createdAt: user.created_at
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

export default auth
