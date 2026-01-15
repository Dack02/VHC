import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

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
    const { email, password, firstName, lastName, phone, role, siteId } = body

    if (!email || !password || !firstName || !lastName || !role) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Site admins can only create users for their site
    if (auth.user.role === 'site_admin' && siteId !== auth.user.siteId) {
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

    return c.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      isActive: user.is_active,
      createdAt: user.created_at
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
    const { firstName, lastName, phone, role, siteId, isActive, settings } = body

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
