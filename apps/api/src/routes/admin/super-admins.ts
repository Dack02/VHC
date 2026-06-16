/**
 * Super Admin user management (Super Admin only).
 * List / create / deactivate / reactivate / resend-invite super admins.
 * Soft-deactivate only (no hard delete). Guards prevent self-lockout and
 * removing the last active super admin.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { buildResetPasswordLink } from '../../lib/authLinks.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'
import { sendEmail } from '../../services/email.js'
import crypto from 'crypto'

const adminSuperAdmins = new Hono()

adminSuperAdmins.use('*', superAdminMiddleware)

const ipUa = (c: { req: { header: (k: string) => string | undefined } }) =>
  [c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP'), c.req.header('User-Agent')] as const

/** Send a super admin a "set your password" recovery-link email. Best-effort. */
async function sendSuperAdminInviteEmail(email: string, name: string): Promise<boolean> {
  try {
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${process.env.WEB_URL || 'http://localhost:5181'}/reset-password` }
    })
    const resetLink = buildResetPasswordLink(linkData?.properties)
    if (!resetLink) {
      console.warn(`Failed to generate super-admin invite link for ${email}:`, linkError?.message)
      return false
    }
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[super-admin] Set-password link for ${email}: ${resetLink}`)
    }
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">VHC Super Admin Portal</h2>
        <p>Hi ${name},</p>
        <p>You have been granted super-admin access to the Vehicle Health Check platform.</p>
        <p>Click below to set your password, then sign in at the Super Admin Portal:</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetLink}" style="background-color: #4f46e5; color: white; padding: 12px 32px; text-decoration: none; font-weight: bold; display: inline-block; border-radius: 6px;">Set Your Password</a>
        </div>
        <p style="color: #666; font-size: 12px; word-break: break-all;">${resetLink}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">If you weren't expecting this, you can safely ignore this email.</p>
      </div>`
    const text = `VHC Super Admin Portal\n\nHi ${name},\n\nYou have been granted super-admin access. Set your password: ${resetLink}`
    const result = await sendEmail({ to: email, subject: 'VHC Super Admin access — set your password', html, text })
    return result.success
  } catch (err) {
    console.error('Failed to send super-admin invite email:', err)
    return false
  }
}

/**
 * GET /api/v1/admin/super-admins
 */
adminSuperAdmins.get('/', async (c) => {
  const superAdmin = c.get('superAdmin')
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .select('id, email, name, phone, is_active, last_login_at, created_at, deactivated_at')
    .order('created_at', { ascending: true })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  const activeCount = (data || []).filter((a) => a.is_active).length

  return c.json({
    superAdmins: (data || []).map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      phone: a.phone ?? null,
      isActive: a.is_active,
      lastLoginAt: a.last_login_at,
      createdAt: a.created_at,
      deactivatedAt: a.deactivated_at,
      isYou: a.id === superAdmin.id
    })),
    activeCount
  })
})

/**
 * POST /api/v1/admin/super-admins
 * Body: { email, name, sendInvite?: boolean (default true), password?: string }
 */
adminSuperAdmins.post('/', async (c) => {
  const superAdmin = c.get('superAdmin')
  const body = await c.req.json()
  const { email, name, sendInvite = true, password } = body
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const [ip, ua] = ipUa(c)

  if (!email || !name) {
    return c.json({ error: 'email and name are required' }, 400)
  }

  // Reject duplicate super admin
  const { data: existing } = await supabaseAdmin
    .from('super_admins')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (existing) {
    return c.json({ error: 'A super admin with this email already exists' }, 409)
  }

  try {
    const tempPassword = password || crypto.randomBytes(16).toString('hex')
    let authUserId: string
    let linkedExistingAuth = false

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name }
    })

    if (authError) {
      if (authError.message.includes('already been registered')) {
        // Promote an existing auth user (e.g. an org user) to super admin
        const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers()
        const existingAuth = existingAuthUsers?.users?.find((u) => u.email === email)
        if (!existingAuth) {
          return c.json({ error: `Failed to create auth user: ${authError.message}` }, 500)
        }
        authUserId = existingAuth.id
        linkedExistingAuth = true
      } else {
        return c.json({ error: `Failed to create auth user: ${authError.message}` }, 500)
      }
    } else {
      authUserId = authData.user.id
    }

    const { data: row, error: insertError } = await supabaseAdmin
      .from('super_admins')
      .insert({
        email,
        name,
        phone: phone || null,
        auth_user_id: authUserId,
        is_active: true,
        created_by: superAdmin.id
      })
      .select()
      .single()

    if (insertError) {
      // Roll back the auth user only if we created a brand-new one
      if (!linkedExistingAuth) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId)
      }
      return c.json({ error: insertError.message }, 500)
    }

    let inviteEmailSent = false
    if (sendInvite) {
      inviteEmailSent = await sendSuperAdminInviteEmail(email, name)
    }

    await logSuperAdminActivity(
      superAdmin.id,
      'create_super_admin',
      'super_admins',
      row.id,
      { email, name, linkedExistingAuth, inviteEmailSent },
      ip, ua
    )

    return c.json({
      id: row.id,
      email: row.email,
      name: row.name,
      isActive: row.is_active,
      inviteEmailSent,
      // Only return a temp password when the caller supplied one and no invite was sent
      temporaryPassword: !sendInvite && password ? tempPassword : undefined
    }, 201)
  } catch (error) {
    console.error('Create super admin error:', error)
    return c.json({ error: 'Failed to create super admin' }, 500)
  }
})

/**
 * PATCH /api/v1/admin/super-admins/:id
 * Update editable fields on a super admin. Currently the mobile number, which is used
 * as a recipient for platform alerts (e.g. the new-organization signup SMS).
 * Body: { phone?: string }  — an empty string clears the number.
 */
adminSuperAdmins.patch('/:id', async (c) => {
  const superAdmin = c.get('superAdmin')
  const targetId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const [ip, ua] = ipUa(c)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.phone === 'string') {
    const phone = body.phone.trim()
    updates.phone = phone || null
  }

  // Nothing to change beyond the timestamp → reject as a no-op.
  if (Object.keys(updates).length <= 1) {
    return c.json({ error: 'No updatable fields provided' }, 400)
  }

  const { data: row, error } = await supabaseAdmin
    .from('super_admins')
    .update(updates)
    .eq('id', targetId)
    .select('id, email, name, phone, is_active')
    .maybeSingle()

  if (error) {
    return c.json({ error: error.message }, 500)
  }
  if (!row) {
    return c.json({ error: 'Super admin not found' }, 404)
  }

  await logSuperAdminActivity(
    superAdmin.id,
    'update_super_admin',
    'super_admins',
    targetId,
    { phone: 'phone' in updates ? (updates.phone ? 'set' : 'cleared') : undefined },
    ip, ua
  )

  return c.json({
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? null,
    isActive: row.is_active
  })
})

/**
 * POST /api/v1/admin/super-admins/:id/deactivate
 */
adminSuperAdmins.post('/:id/deactivate', async (c) => {
  const superAdmin = c.get('superAdmin')
  const targetId = c.req.param('id')
  const [ip, ua] = ipUa(c)

  if (targetId === superAdmin.id) {
    return c.json({ error: 'You cannot deactivate your own super-admin account' }, 400)
  }

  const { data: target } = await supabaseAdmin
    .from('super_admins')
    .select('id, name, email, is_active')
    .eq('id', targetId)
    .single()

  if (!target) {
    return c.json({ error: 'Super admin not found' }, 404)
  }

  if (target.is_active) {
    const { count } = await supabaseAdmin
      .from('super_admins')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    if ((count || 0) <= 1) {
      return c.json({ error: 'Cannot deactivate the last active super admin' }, 400)
    }
  }

  const { error } = await supabaseAdmin
    .from('super_admins')
    .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivated_by: superAdmin.id, updated_at: new Date().toISOString() })
    .eq('id', targetId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  await logSuperAdminActivity(superAdmin.id, 'deactivate_super_admin', 'super_admins', targetId, { email: target.email }, ip, ua)
  return c.json({ success: true })
})

/**
 * POST /api/v1/admin/super-admins/:id/reactivate
 */
adminSuperAdmins.post('/:id/reactivate', async (c) => {
  const superAdmin = c.get('superAdmin')
  const targetId = c.req.param('id')
  const [ip, ua] = ipUa(c)

  const { data: target } = await supabaseAdmin
    .from('super_admins')
    .select('id, email')
    .eq('id', targetId)
    .single()

  if (!target) {
    return c.json({ error: 'Super admin not found' }, 404)
  }

  const { error } = await supabaseAdmin
    .from('super_admins')
    .update({ is_active: true, deactivated_at: null, deactivated_by: null, updated_at: new Date().toISOString() })
    .eq('id', targetId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  await logSuperAdminActivity(superAdmin.id, 'reactivate_super_admin', 'super_admins', targetId, { email: target.email }, ip, ua)
  return c.json({ success: true })
})

/**
 * POST /api/v1/admin/super-admins/:id/resend-invite
 */
adminSuperAdmins.post('/:id/resend-invite', async (c) => {
  const superAdmin = c.get('superAdmin')
  const targetId = c.req.param('id')
  const [ip, ua] = ipUa(c)

  const { data: target } = await supabaseAdmin
    .from('super_admins')
    .select('id, email, name')
    .eq('id', targetId)
    .single()

  if (!target) {
    return c.json({ error: 'Super admin not found' }, 404)
  }

  const sent = await sendSuperAdminInviteEmail(target.email, target.name)
  await logSuperAdminActivity(superAdmin.id, 'resend_super_admin_invite', 'super_admins', targetId, { email: target.email, sent }, ip, ua)
  return c.json({ success: true, inviteEmailSent: sent })
})

export default adminSuperAdmins
