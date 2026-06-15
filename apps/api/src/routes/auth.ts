import { Hono } from 'hono'
import { supabaseAuth, supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { sendEmail } from '../services/email.js'
import { provisionOrganization } from '../services/provisioning.js'
import crypto from 'crypto'

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
      // Use 'local' scope to only revoke THIS session, not all sessions for the user.
      // Using 'global' (the default) would invalidate sessions across all apps
      // (e.g., logging out of admin portal would kill the main app session).
      await supabaseAdmin.auth.admin.signOut(token, 'local')
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

// POST /api/v1/auth/forgot-password
// Public, self-service password reset request. Always returns 200 so the response
// never reveals whether an account exists (no enumeration). Rate-limited by the
// /api/v1/auth/* limiter mounted in index.ts.
auth.post('/forgot-password', async (c) => {
  try {
    const { email } = await c.req.json().catch(() => ({}))

    if (!email || typeof email !== 'string') {
      return c.json({ success: true })
    }

    const redirectTo = `${process.env.WEB_URL || 'http://localhost:5181'}/reset-password`

    // generateLink fails for unknown emails — that's fine, we swallow it and still
    // return success so attackers can't probe which emails are registered.
    const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo }
    })

    const resetLink = linkData?.properties?.action_link
    if (resetLink) {
      // Look up the user for a friendly greeting + branded email credentials.
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('first_name, organization_id')
        .eq('email', email)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      const firstName = userRow?.first_name || 'there'
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">Reset your password</h2>
          <p>Hi ${firstName},</p>
          <p>We received a request to reset the password for your Vehicle Health Check account.</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 12px 32px; text-decoration: none; font-weight: bold; display: inline-block; border-radius: 6px;">Reset Password</a>
          </div>
          <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="color: #666; font-size: 12px; word-break: break-all;">${resetLink}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </div>
      `
      const text = `Reset your password\n\nHi ${firstName},\n\nWe received a request to reset the password for your Vehicle Health Check account.\n\nReset your password: ${resetLink}\n\nIf you didn't request this, you can safely ignore this email.`

      // Surface the link in logs outside production (dev/staging may not send email).
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[auth] Password reset link for ${email}: ${resetLink}`)
      }
      // Try the org/platform sender, then fall back to the platform env sender.
      const emailPayload = { to: email, subject: 'Reset your VHC password', html, text }
      let result = await sendEmail({ ...emailPayload, organizationId: userRow?.organization_id || undefined })
      if (!result.success) {
        result = await sendEmail(emailPayload)
      }
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Forgot password error:', error)
    // Still return success to avoid leaking information.
    return c.json({ success: true })
  }
})

// ---------------------------------------------------------------------------
// Public self-service signup
// ---------------------------------------------------------------------------

/** Read a platform_settings row's JSON, defaulting to {} when absent. */
async function readPlatformSettings(id: string): Promise<Record<string, unknown>> {
  const { data } = await supabaseAdmin
    .from('platform_settings')
    .select('settings')
    .eq('id', id)
    .maybeSingle()
  return (data?.settings as Record<string, unknown>) || {}
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// GET /api/v1/auth/signup-config
// Public-safe config so the signup page can self-disable and show terms links.
// (The full platform settings GET is super-admin only.)
auth.get('/signup-config', async (c) => {
  try {
    const [features, general] = await Promise.all([
      readPlatformSettings('features'),
      readPlatformSettings('general')
    ])
    return c.json({
      enabled: features.allowSelfSignup === true,
      platformName: (general.platformName as string) || 'Vehicle Health Check',
      termsUrl: (general.termsUrl as string) || null,
      privacyUrl: (general.privacyUrl as string) || null
    })
  } catch (error) {
    console.error('Signup config error:', error)
    return c.json({ enabled: false, platformName: 'Vehicle Health Check', termsUrl: null, privacyUrl: null })
  }
})

// POST /api/v1/auth/signup
// Public self-service organization signup. Guarded by: a strict per-IP rate limit
// (mounted in index.ts), the allowSelfSignup kill-switch (fail-safe: off unless
// explicitly enabled), and email verification — the admin sets their password via
// an emailed link (handled inside provisionOrganization when no password is given).
auth.post('/signup', async (c) => {
  try {
    const features = await readPlatformSettings('features')
    // Fail-safe: signup is disabled unless a super-admin has explicitly turned it on.
    if (features.allowSelfSignup !== true) {
      return c.json({ error: 'Signups are currently closed' }, 403)
    }

    const body = await c.req.json().catch(() => ({}))
    const organizationName = String(body.organizationName || '').trim()
    const adminFirstName = String(body.adminFirstName || '').trim()
    const adminLastName = String(body.adminLastName || '').trim()
    const adminEmail = String(body.adminEmail || '').trim().toLowerCase()
    const acceptTerms = body.acceptTerms === true

    if (!organizationName || !adminFirstName || !adminLastName || !adminEmail) {
      return c.json({ error: 'All fields are required' }, 400)
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
      return c.json({ error: 'Please enter a valid email address' }, 400)
    }
    if (!acceptTerms) {
      return c.json({ error: 'You must accept the terms to continue' }, 400)
    }

    const genericSuccess = {
      success: true,
      message: 'Check your email to finish setting up your account.'
    }

    // No enumeration: if the email already belongs to a user, respond exactly as a
    // fresh signup would (without creating anything or sending an email).
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', adminEmail)
      .limit(1)
      .maybeSingle()
    if (existing) {
      return c.json(genericSuccess)
    }

    const defaults = await readPlatformSettings('defaults')
    const planId = (defaults.defaultPlanId as string) || 'starter'
    const requireEmailVerification = defaults.requireEmailVerification !== false

    // Collision-safe slug: derive from the name, add a short random suffix if taken.
    const base = slugify(organizationName) || 'org'
    let slug = base
    const { data: clash } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (clash) {
      slug = `${base}-${crypto.randomBytes(3).toString('hex')}`
    }

    // Default path: no password → provisionOrganization emails a "set your password"
    // link, which also verifies the email. If a super-admin disabled verification,
    // allow an optional password from the form for instant login.
    const adminPassword =
      requireEmailVerification ? undefined
      : (typeof body.password === 'string' && body.password ? body.password : undefined)

    try {
      await provisionOrganization({
        name: organizationName,
        slug,
        planId,
        adminEmail,
        adminFirstName,
        adminLastName,
        adminPassword
      })
    } catch (err) {
      const msg = (err instanceof Error ? err.message : '').toLowerCase()
      // Existing auth account or a rare slug race — respond generically (no leak).
      if (msg.includes('already been registered') || msg.includes('slug already exists')) {
        return c.json(genericSuccess)
      }
      throw err
    }

    return c.json(genericSuccess)
  } catch (error) {
    console.error('Signup error:', error)
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})

export default auth
