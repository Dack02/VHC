/**
 * Org Admin API Routes
 * Organization settings, sites, users management
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, requireOrgAdmin } from '../middleware/auth.js'
import {
  checkSiteLimit,
  checkUserLimit,
  getOrganizationLimits
} from '../services/limits.js'
import crypto from 'crypto'

const orgAdminRoutes = new Hono()

// All routes require authentication
orgAdminRoutes.use('*', authMiddleware)

// ============================================
// Organization Settings
// ============================================

/**
 * GET /api/v1/organizations/:id/settings
 * Get organization settings
 */
orgAdminRoutes.get('/:id/settings', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Get or create settings
  let { data: settings, error } = await supabaseAdmin
    .from('organization_settings')
    .select('*')
    .eq('organization_id', orgId)
    .single()

  if (error && error.code === 'PGRST116') {
    // Not found - create default settings
    const { data: newSettings, error: createError } = await supabaseAdmin
      .from('organization_settings')
      .insert({ organization_id: orgId })
      .select()
      .single()

    if (createError) {
      return c.json({ error: createError.message }, 500)
    }
    settings = newSettings
  } else if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    id: settings.id,
    organizationId: settings.organization_id,
    // Branding
    logoUrl: settings.logo_url,
    logoDarkUrl: settings.logo_dark_url,
    faviconUrl: settings.favicon_url,
    primaryColor: settings.primary_color,
    secondaryColor: settings.secondary_color,
    // Business
    legalName: settings.legal_name,
    companyNumber: settings.company_number,
    vatNumber: settings.vat_number,
    // Address
    addressLine1: settings.address_line1,
    addressLine2: settings.address_line2,
    city: settings.city,
    county: settings.county,
    postcode: settings.postcode,
    country: settings.country,
    // Contact
    phone: settings.phone,
    email: settings.email,
    website: settings.website,
    // Preferences
    timezone: settings.timezone,
    dateFormat: settings.date_format,
    currency: settings.currency,
    // Features
    featuresEnabled: settings.features_enabled,
    createdAt: settings.created_at,
    updatedAt: settings.updated_at
  })
})

/**
 * PATCH /api/v1/organizations/:id/settings
 * Update organization settings (Org Admin only)
 */
orgAdminRoutes.patch('/:id/settings', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Get existing settings
  let { data: settings, error: fetchError } = await supabaseAdmin
    .from('organization_settings')
    .select('id')
    .eq('organization_id', orgId)
    .single()

  if (fetchError && fetchError.code === 'PGRST116') {
    // Create if not exists
    const { data: newSettings, error: createError } = await supabaseAdmin
      .from('organization_settings')
      .insert({ organization_id: orgId })
      .select()
      .single()

    if (createError) {
      return c.json({ error: createError.message }, 500)
    }
    settings = newSettings
  } else if (fetchError) {
    return c.json({ error: fetchError.message }, 500)
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  // Branding
  if (body.logoUrl !== undefined) updateData.logo_url = body.logoUrl
  if (body.logoDarkUrl !== undefined) updateData.logo_dark_url = body.logoDarkUrl
  if (body.faviconUrl !== undefined) updateData.favicon_url = body.faviconUrl
  if (body.primaryColor !== undefined) updateData.primary_color = body.primaryColor
  if (body.secondaryColor !== undefined) updateData.secondary_color = body.secondaryColor

  // Business
  if (body.legalName !== undefined) updateData.legal_name = body.legalName
  if (body.companyNumber !== undefined) updateData.company_number = body.companyNumber
  if (body.vatNumber !== undefined) updateData.vat_number = body.vatNumber

  // Address
  if (body.addressLine1 !== undefined) updateData.address_line1 = body.addressLine1
  if (body.addressLine2 !== undefined) updateData.address_line2 = body.addressLine2
  if (body.city !== undefined) updateData.city = body.city
  if (body.county !== undefined) updateData.county = body.county
  if (body.postcode !== undefined) updateData.postcode = body.postcode
  if (body.country !== undefined) updateData.country = body.country

  // Contact
  if (body.phone !== undefined) updateData.phone = body.phone
  if (body.email !== undefined) updateData.email = body.email
  if (body.website !== undefined) updateData.website = body.website

  // Preferences
  if (body.timezone !== undefined) updateData.timezone = body.timezone
  if (body.dateFormat !== undefined) updateData.date_format = body.dateFormat
  if (body.currency !== undefined) updateData.currency = body.currency

  // Features
  if (body.featuresEnabled !== undefined) updateData.features_enabled = body.featuresEnabled

  const { error: updateError } = await supabaseAdmin
    .from('organization_settings')
    .update(updateData)
    .eq('id', settings.id)

  if (updateError) {
    return c.json({ error: updateError.message }, 500)
  }

  return c.json({ success: true })
})

/**
 * POST /api/v1/organizations/:id/settings/logo
 * Upload organization logo (Org Admin only)
 */
orgAdminRoutes.post('/:id/settings/logo', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string || 'logo' // logo, logo_dark, or favicon

  if (!file) {
    return c.json({ error: 'No file provided' }, 400)
  }

  // Validate file type
  const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Invalid file type. Allowed: PNG, JPEG, SVG, WebP' }, 400)
  }

  // Validate file size (max 2MB)
  if (file.size > 2 * 1024 * 1024) {
    return c.json({ error: 'File too large. Maximum size: 2MB' }, 400)
  }

  try {
    const fileBuffer = await file.arrayBuffer()
    const fileExt = file.name.split('.').pop() || 'png'
    const fileName = `${orgId}/${type}-${Date.now()}.${fileExt}`

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('organization-assets')
      .upload(fileName, fileBuffer, {
        contentType: file.type,
        upsert: true
      })

    if (uploadError) {
      return c.json({ error: uploadError.message }, 500)
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('organization-assets')
      .getPublicUrl(fileName)

    const publicUrl = urlData.publicUrl

    // Update organization settings with new URL
    const updateField = type === 'logo_dark' ? 'logo_dark_url' : type === 'favicon' ? 'favicon_url' : 'logo_url'

    await supabaseAdmin
      .from('organization_settings')
      .update({
        [updateField]: publicUrl,
        updated_at: new Date().toISOString()
      })
      .eq('organization_id', orgId)

    return c.json({
      success: true,
      url: publicUrl,
      type
    })
  } catch (error) {
    console.error('Logo upload error:', error)
    return c.json({ error: 'Failed to upload logo' }, 500)
  }
})

// ============================================
// Sites Management
// ============================================

/**
 * GET /api/v1/organizations/:id/sites
 * List organization sites
 */
orgAdminRoutes.get('/:id/sites', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const { data: sites, error } = await supabaseAdmin
    .from('sites')
    .select(`
      *,
      users:users(count)
    `)
    .eq('organization_id', orgId)
    .order('name', { ascending: true })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Get site limit info
  const limitCheck = await checkSiteLimit(orgId)

  return c.json({
    sites: sites?.map(site => ({
      id: site.id,
      name: site.name,
      address: site.address,
      phone: site.phone,
      email: site.email,
      settings: site.settings,
      isActive: site.is_active,
      usersCount: site.users?.[0]?.count || 0,
      createdAt: site.created_at,
      updatedAt: site.updated_at
    })) || [],
    limits: {
      current: limitCheck.current,
      max: limitCheck.limit,
      canAdd: limitCheck.allowed
    }
  })
})

/**
 * POST /api/v1/organizations/:id/sites
 * Create new site (Org Admin only)
 */
orgAdminRoutes.post('/:id/sites', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Check site limit
  const limitCheck = await checkSiteLimit(orgId)
  if (!limitCheck.allowed) {
    return c.json({ error: limitCheck.message }, 403)
  }

  const { name, address, phone, email, settings } = body

  if (!name) {
    return c.json({ error: 'Site name is required' }, 400)
  }

  const { data: site, error } = await supabaseAdmin
    .from('sites')
    .insert({
      organization_id: orgId,
      name,
      address: address || null,
      phone: phone || null,
      email: email || null,
      settings: settings || {},
      is_active: true
    })
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    id: site.id,
    name: site.name,
    address: site.address,
    phone: site.phone,
    email: site.email,
    settings: site.settings,
    isActive: site.is_active,
    createdAt: site.created_at
  }, 201)
})

// ============================================
// Users Management
// ============================================

/**
 * GET /api/v1/organizations/:id/users
 * List organization users
 */
orgAdminRoutes.get('/:id/users', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select(`
      *,
      site:sites(id, name)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Get user limit info
  const limitCheck = await checkUserLimit(orgId)

  return c.json({
    users: users?.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      site: user.site,
      isActive: user.is_active,
      isOrgAdmin: user.is_org_admin,
      isSiteAdmin: user.is_site_admin,
      lastLoginAt: user.last_login_at,
      invitedAt: user.invited_at,
      createdAt: user.created_at
    })) || [],
    limits: {
      current: limitCheck.current,
      max: limitCheck.limit,
      canAdd: limitCheck.allowed
    }
  })
})

/**
 * POST /api/v1/organizations/:id/users
 * Invite new user (Org Admin only)
 */
orgAdminRoutes.post('/:id/users', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Check user limit
  const limitCheck = await checkUserLimit(orgId)
  if (!limitCheck.allowed) {
    return c.json({ error: limitCheck.message }, 403)
  }

  const {
    email,
    firstName,
    lastName,
    phone,
    role = 'technician',
    siteId,
    isOrgAdmin = false,
    isSiteAdmin = false,
    sendInvite = true
  } = body

  if (!email || !firstName || !lastName) {
    return c.json({ error: 'Email, firstName, and lastName are required' }, 400)
  }

  // Validate role
  const validRoles = ['org_admin', 'site_admin', 'service_advisor', 'technician']
  if (!validRoles.includes(role)) {
    return c.json({ error: 'Invalid role' }, 400)
  }

  // Validate site belongs to org if provided
  if (siteId) {
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('organization_id', orgId)
      .single()

    if (!site) {
      return c.json({ error: 'Invalid site ID' }, 400)
    }
  }

  // Check if email already exists in this organization
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .eq('organization_id', orgId)
    .single()

  if (existingUser) {
    return c.json({ error: 'User with this email already exists in the organization' }, 400)
  }

  try {
    // Generate temporary password
    const tempPassword = crypto.randomBytes(16).toString('hex')

    // Create Supabase auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName
      }
    })

    if (authError) {
      // Check if user already exists in auth (might be in another org)
      if (authError.message.includes('already been registered')) {
        // Try to get existing auth user
        const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers()
        const existingAuth = existingAuthUsers?.users?.find(u => u.email === email)

        if (existingAuth) {
          // Create user record linked to existing auth user
          const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .insert({
              auth_id: existingAuth.id,
              organization_id: orgId,
              site_id: siteId || null,
              email,
              first_name: firstName,
              last_name: lastName,
              phone: phone || null,
              role,
              is_org_admin: isOrgAdmin,
              is_site_admin: isSiteAdmin,
              is_active: true,
              invited_by: auth.user.id,
              invited_at: new Date().toISOString()
            })
            .select()
            .single()

          if (userError) {
            return c.json({ error: userError.message }, 500)
          }

          return c.json({
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            note: 'User linked to existing auth account'
          }, 201)
        }
      }
      return c.json({ error: `Failed to create auth user: ${authError.message}` }, 500)
    }

    // Create user record
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_id: authData.user.id,
        organization_id: orgId,
        site_id: siteId || null,
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        role,
        is_org_admin: isOrgAdmin,
        is_site_admin: isSiteAdmin,
        is_active: true,
        invited_by: auth.user.id,
        invited_at: new Date().toISOString()
      })
      .select()
      .single()

    if (userError) {
      // Rollback: delete auth user
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return c.json({ error: userError.message }, 500)
    }

    // TODO: Send welcome email with password reset link
    // For now, return the temporary password (in production, send email instead)

    return c.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      temporaryPassword: sendInvite ? tempPassword : undefined
    }, 201)
  } catch (error) {
    console.error('User creation error:', error)
    return c.json({ error: 'Failed to create user' }, 500)
  }
})

/**
 * POST /api/v1/organizations/:id/users/:userId/resend-invite
 * Resend invite email (Org Admin only)
 */
orgAdminRoutes.post('/:id/users/:userId/resend-invite', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')
  const userId = c.req.param('userId')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Get user
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('*, auth_id')
    .eq('id', userId)
    .eq('organization_id', orgId)
    .single()

  if (error || !user) {
    return c.json({ error: 'User not found' }, 404)
  }

  // Generate password reset link
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: user.email
  })

  if (linkError) {
    return c.json({ error: linkError.message }, 500)
  }

  // TODO: Send email with reset link
  // For now, return the link (in production, send email)

  return c.json({
    success: true,
    message: 'Invite resent',
    // In production, don't return this - send via email
    resetLink: linkData.properties?.action_link
  })
})

// ============================================
// Subscription View (Read Only)
// ============================================

/**
 * GET /api/v1/organizations/:id/subscription
 * View current subscription (any org member)
 */
orgAdminRoutes.get('/:id/subscription', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const { data: subscription, error } = await supabaseAdmin
    .from('organization_subscriptions')
    .select(`
      *,
      plan:subscription_plans(*)
    `)
    .eq('organization_id', orgId)
    .single()

  if (error || !subscription) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  return c.json({
    id: subscription.id,
    status: subscription.status,
    plan: subscription.plan ? {
      id: subscription.plan.id,
      name: subscription.plan.name,
      description: subscription.plan.description,
      priceMonthly: subscription.plan.price_monthly,
      priceAnnual: subscription.plan.price_annual,
      currency: subscription.plan.currency,
      maxSites: subscription.plan.max_sites,
      maxUsers: subscription.plan.max_users,
      maxHealthChecksPerMonth: subscription.plan.max_health_checks_per_month,
      maxStorageGb: subscription.plan.max_storage_gb,
      features: subscription.plan.features
    } : null,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end
  })
})

/**
 * GET /api/v1/organizations/:id/usage
 * View current usage (any org member)
 */
orgAdminRoutes.get('/:id/usage', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Get all limits and usage
  const limits = await getOrganizationLimits(orgId)

  return c.json({
    sites: {
      current: limits.sites.current,
      limit: limits.sites.limit,
      percentUsed: limits.sites.limit > 0 ? Math.round((limits.sites.current / limits.sites.limit) * 100) : 0
    },
    users: {
      current: limits.users.current,
      limit: limits.users.limit,
      percentUsed: limits.users.limit > 0 ? Math.round((limits.users.current / limits.users.limit) * 100) : 0
    },
    healthChecks: {
      current: limits.healthChecks.current,
      limit: limits.healthChecks.limit,
      percentUsed: limits.healthChecks.limit > 0 ? Math.round((limits.healthChecks.current / limits.healthChecks.limit) * 100) : 0,
      periodLabel: 'This Month'
    },
    storage: {
      currentBytes: limits.storage.current,
      currentGb: (limits.storage.current / (1024 * 1024 * 1024)).toFixed(2),
      limitBytes: limits.storage.limit,
      limitGb: (limits.storage.limit / (1024 * 1024 * 1024)).toFixed(2),
      percentUsed: limits.storage.limit > 0 ? Math.round((limits.storage.current / limits.storage.limit) * 100) : 0
    }
  })
})

export default orgAdminRoutes
