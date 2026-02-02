import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { checkUserLimit } from '../services/limits.js'
import { sendEmail } from '../services/email.js'

const users = new Hono()

// Apply auth middleware to all routes
users.use('*', authMiddleware)

// GET /api/v1/users - List users (filtered by org)
users.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { site_id, role, search, limit = '50', offset = '0' } = c.req.query()

    let query = supabaseAdmin
      .from('users')
      .select('*, site:sites(id, name)', { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    // Site admins and advisors can only see users from their site
    if (['site_admin', 'service_advisor'].includes(auth.user.role) && auth.user.siteId) {
      query = query.eq('site_id', auth.user.siteId)
    } else if (site_id) {
      query = query.eq('site_id', site_id)
    }

    if (role) {
      query = query.eq('role', role)
    }

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`)
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      users: data?.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
        isActive: user.is_active,
        site: user.site,
        createdAt: user.created_at
      })),
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('List users error:', error)
    return c.json({ error: 'Failed to list users' }, 500)
  }
})

// POST /api/v1/users - Create user
users.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { email, password, firstName, lastName, phone, role, siteId, sendInvite } = body

    if (!email || !password || !firstName || !lastName || !role) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Check user limit
    const limitCheck = await checkUserLimit(auth.orgId)
    if (!limitCheck.allowed) {
      return c.json({ error: limitCheck.message }, 403)
    }

    // Site admins can only create users for their site
    if (auth.user.role === 'site_admin' && siteId && siteId !== auth.user.siteId) {
      return c.json({ error: 'Cannot create user for a different site' }, 403)
    }

    // Create Supabase auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })

    if (authError) {
      return c.json({ error: authError.message }, 400)
    }

    // Create user record in our table
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_id: authData.user.id,
        organization_id: auth.orgId,
        site_id: siteId || auth.user.siteId,
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        role,
        is_active: true
      })
      .select()
      .single()

    if (userError) {
      // Rollback: delete the auth user if our insert fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return c.json({ error: userError.message }, 500)
    }

    // Send invite email if requested
    let emailSent = false
    if (sendInvite) {
      try {
        // Fetch org name
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('name')
          .eq('id', auth.orgId)
          .single()

        const orgName = org?.name || 'Your Organization'
        const roleLabel = role.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase())
        const loginUrl = process.env.WEB_URL || 'https://vhc.ollosoft.co.uk'

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e4e4e7;">
        <tr><td style="background:#18181b;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Welcome to ${orgName}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#3f3f46;font-size:15px;line-height:1.6;">
            You've been added as a <strong>${roleLabel}</strong> on the Vehicle Health Check platform.
          </p>
          <p style="margin:0 0 24px;color:#3f3f46;font-size:15px;line-height:1.6;">
            Use the credentials below to sign in:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;border:1px solid #e4e4e7;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 8px;color:#71717a;font-size:13px;">Email</p>
              <p style="margin:0 0 16px;color:#18181b;font-size:15px;font-weight:600;">${email}</p>
              <p style="margin:0 0 8px;color:#71717a;font-size:13px;">Password</p>
              <p style="margin:0;color:#18181b;font-size:15px;font-weight:600;font-family:monospace;">${password}</p>
            </td></tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#18181b;padding:12px 24px;">
              <a href="${loginUrl}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Sign In</a>
            </td></tr>
          </table>
          <p style="margin:0;color:#a1a1aa;font-size:13px;line-height:1.5;">
            We recommend changing your password after your first login.
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e4e4e7;">
          <p style="margin:0;color:#a1a1aa;font-size:12px;">${orgName} &mdash; Vehicle Health Check</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

        const text = `Welcome to ${orgName}\n\nYou've been added as a ${roleLabel} on the Vehicle Health Check platform.\n\nEmail: ${email}\nPassword: ${password}\n\nSign in at: ${loginUrl}\n\nWe recommend changing your password after your first login.`

        const result = await sendEmail({
          to: email,
          subject: `Welcome to ${orgName} - Your Login Details`,
          html,
          text,
          organizationId: auth.orgId
        })

        emailSent = result.success
      } catch (emailError) {
        console.error('Failed to send invite email:', emailError)
      }
    }

    return c.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      isActive: user.is_active,
      createdAt: user.created_at,
      emailSent: sendInvite ? emailSent : undefined
    }, 201)
  } catch (error) {
    console.error('Create user error:', error)
    return c.json({ error: 'Failed to create user' }, 500)
  }
})

// GET /api/v1/users/:id - Get single user
users.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*, site:sites(id, name)')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !user) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Site-level users can only view users from their site
    if (['site_admin', 'service_advisor'].includes(auth.user.role) &&
        auth.user.siteId && user.site_id !== auth.user.siteId) {
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
      site: user.site,
      settings: user.settings,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    })
  } catch (error) {
    console.error('Get user error:', error)
    return c.json({ error: 'Failed to get user' }, 500)
  }
})

// PATCH /api/v1/users/:id - Update user
users.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { firstName, lastName, phone, role, siteId, isActive, settings, password } = body

    // First get the user to check permissions
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !existingUser) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Site admins can only update users from their site
    if (auth.user.role === 'site_admin' && existingUser.site_id !== auth.user.siteId) {
      return c.json({ error: 'Cannot update user from a different site' }, 403)
    }

    // Update Supabase Auth password if provided
    if (password) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUser.auth_id,
        { password }
      )
      if (authError) {
        return c.json({ error: authError.message }, 400)
      }
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (firstName !== undefined) updateData.first_name = firstName
    if (lastName !== undefined) updateData.last_name = lastName
    if (phone !== undefined) updateData.phone = phone
    if (role !== undefined) updateData.role = role
    if (siteId !== undefined) updateData.site_id = siteId
    if (isActive !== undefined) updateData.is_active = isActive
    if (settings !== undefined) updateData.settings = settings

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      isActive: user.is_active,
      updatedAt: user.updated_at
    })
  } catch (error) {
    console.error('Update user error:', error)
    return c.json({ error: 'Failed to update user' }, 500)
  }
})

// POST /api/v1/users/:id/reset-link - Send password reset link
users.post('/:id/reset-link', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !existingUser) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Site admins can only reset passwords for users from their site
    if (auth.user.role === 'site_admin' && existingUser.site_id !== auth.user.siteId) {
      return c.json({ error: 'Cannot reset password for user from a different site' }, 403)
    }

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: existingUser.email
    })

    if (linkError) {
      return c.json({ error: linkError.message }, 500)
    }

    // Try to send recovery email
    let emailSent = false
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', auth.orgId)
        .single()

      const orgName = org?.name || 'Your Organization'
      const resetUrl = linkData.properties?.action_link || ''

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e4e4e7;">
        <tr><td style="background:#18181b;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Password Reset</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#3f3f46;font-size:15px;line-height:1.6;">
            A password reset has been requested for your account on the ${orgName} Vehicle Health Check platform.
          </p>
          <p style="margin:0 0 24px;color:#3f3f46;font-size:15px;line-height:1.6;">
            Click the button below to set a new password:
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#18181b;padding:12px 24px;">
              <a href="${resetUrl}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Reset Password</a>
            </td></tr>
          </table>
          <p style="margin:0;color:#a1a1aa;font-size:13px;line-height:1.5;">
            If you did not request this reset, you can safely ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e4e4e7;">
          <p style="margin:0;color:#a1a1aa;font-size:12px;">${orgName} &mdash; Vehicle Health Check</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

      const text = `Password Reset\n\nA password reset has been requested for your account on the ${orgName} Vehicle Health Check platform.\n\nReset your password: ${resetUrl}\n\nIf you did not request this reset, you can safely ignore this email.`

      const result = await sendEmail({
        to: existingUser.email,
        subject: `Password Reset - ${orgName}`,
        html,
        text,
        organizationId: auth.orgId
      })

      emailSent = result.success
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError)
    }

    return c.json({ message: 'Reset link generated', emailSent })
  } catch (error) {
    console.error('Reset link error:', error)
    return c.json({ error: 'Failed to generate reset link' }, 500)
  }
})

// DELETE /api/v1/users/:id - Deactivate user (soft delete)
users.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Prevent self-deactivation
    if (id === auth.user.id) {
      return c.json({ error: 'Cannot deactivate your own account' }, 400)
    }

    // First get the user to check permissions
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !existingUser) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Site admins can only deactivate users from their site
    if (auth.user.role === 'site_admin' && existingUser.site_id !== auth.user.siteId) {
      return c.json({ error: 'Cannot deactivate user from a different site' }, 403)
    }

    const { error } = await supabaseAdmin
      .from('users')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ message: 'User deactivated successfully' })
  } catch (error) {
    console.error('Delete user error:', error)
    return c.json({ error: 'Failed to deactivate user' }, 500)
  }
})

export default users
