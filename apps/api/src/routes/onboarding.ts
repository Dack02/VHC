/**
 * Onboarding API Routes
 * Handles organization setup wizard for new organizations
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, requireOrgAdmin } from '../middleware/auth.js'
import { sendEmail } from '../services/email.js'

const onboarding = new Hono()

// All routes require authentication and org admin role
onboarding.use('*', authMiddleware)
onboarding.use('*', requireOrgAdmin())

/**
 * GET /api/v1/onboarding/status
 * Get current onboarding status and progress
 */
onboarding.get('/status', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.user.organizationId

  // Get organization with settings
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select(`
      id,
      name,
      onboarding_completed,
      onboarding_step,
      settings:organization_settings(*)
    `)
    .eq('id', organizationId)
    .single()

  if (error || !org) {
    return c.json({ error: 'Organisation not found' }, 404)
  }

  // Get sites count
  const { count: sitesCount } = await supabaseAdmin
    .from('sites')
    .select('id', { count: 'exact' })
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  // Get users count (excluding current user)
  const { count: usersCount } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact' })
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .neq('id', auth.user.id)

  return c.json({
    organizationId: org.id,
    organizationName: org.name,
    onboardingCompleted: org.onboarding_completed,
    currentStep: org.onboarding_step || 0,
    hasSettings: !!org.settings,
    hasSites: (sitesCount || 0) > 0,
    hasTeamMembers: (usersCount || 0) > 0,
    sitesCount: sitesCount || 0,
    teamMembersCount: usersCount || 0
  })
})

/**
 * PATCH /api/v1/onboarding/step
 * Update the current onboarding step
 */
onboarding.patch('/step', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.user.organizationId
  const { step } = await c.req.json()

  if (typeof step !== 'number' || step < 0 || step > 5) {
    return c.json({ error: 'Invalid step number' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      onboarding_step: step,
      updated_at: new Date().toISOString()
    })
    .eq('id', organizationId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ success: true, step })
})

/**
 * POST /api/v1/onboarding/business-details
 * Step 1: Save business details
 */
onboarding.post('/business-details', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.user.organizationId
  const body = await c.req.json()

  const {
    legalName,
    companyNumber,
    vatNumber,
    addressLine1,
    addressLine2,
    city,
    county,
    postcode,
    country,
    phone,
    email,
    website,
    timezone,
    dateFormat,
    currency
  } = body

  // Check if settings exist
  const { data: existingSettings } = await supabaseAdmin
    .from('organization_settings')
    .select('id')
    .eq('organization_id', organizationId)
    .single()

  const settingsData = {
    organization_id: organizationId,
    legal_name: legalName,
    company_number: companyNumber,
    vat_number: vatNumber,
    address_line1: addressLine1,
    address_line2: addressLine2,
    city,
    county,
    postcode,
    country: country || 'GB',
    phone,
    email,
    website,
    timezone: timezone || 'Europe/London',
    date_format: dateFormat || 'DD/MM/YYYY',
    currency: currency || 'GBP',
    updated_at: new Date().toISOString()
  }

  let result
  if (existingSettings) {
    result = await supabaseAdmin
      .from('organization_settings')
      .update(settingsData)
      .eq('organization_id', organizationId)
      .select()
      .single()
  } else {
    result = await supabaseAdmin
      .from('organization_settings')
      .insert({
        ...settingsData,
        created_at: new Date().toISOString()
      })
      .select()
      .single()
  }

  if (result.error) {
    return c.json({ error: result.error.message }, 500)
  }

  // Update onboarding step
  await supabaseAdmin
    .from('organizations')
    .update({
      onboarding_step: 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', organizationId)

  return c.json({
    success: true,
    settings: result.data
  })
})

/**
 * POST /api/v1/onboarding/first-site
 * Step 2: Create the first site
 */
onboarding.post('/first-site', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.user.organizationId
  const body = await c.req.json()

  const {
    name,
    addressLine1,
    addressLine2,
    city,
    county,
    postcode,
    country,
    phone,
    email,
    copyFromOrg
  } = body

  if (!name) {
    return c.json({ error: 'Site name is required' }, 400)
  }

  let siteAddress = {
    address_line1: addressLine1,
    address_line2: addressLine2,
    city,
    county,
    postcode,
    country: country || 'GB',
    phone,
    email
  }

  // If copying from org, get org settings
  if (copyFromOrg) {
    const { data: orgSettings } = await supabaseAdmin
      .from('organization_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    if (orgSettings) {
      siteAddress = {
        address_line1: orgSettings.address_line1,
        address_line2: orgSettings.address_line2,
        city: orgSettings.city,
        county: orgSettings.county,
        postcode: orgSettings.postcode,
        country: orgSettings.country,
        phone: orgSettings.phone,
        email: orgSettings.email
      }
    }
  }

  // Create site
  const { data: site, error } = await supabaseAdmin
    .from('sites')
    .insert({
      organization_id: organizationId,
      name,
      address: `${siteAddress.address_line1 || ''}, ${siteAddress.city || ''}, ${siteAddress.postcode || ''}`.trim().replace(/^,|,$/g, ''),
      phone: siteAddress.phone,
      email: siteAddress.email,
      is_active: true,
      settings: {
        addressLine1: siteAddress.address_line1,
        addressLine2: siteAddress.address_line2,
        city: siteAddress.city,
        county: siteAddress.county,
        postcode: siteAddress.postcode,
        country: siteAddress.country
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Update current user's site assignment
  await supabaseAdmin
    .from('users')
    .update({
      site_id: site.id,
      updated_at: new Date().toISOString()
    })
    .eq('id', auth.user.id)

  // Update onboarding step
  await supabaseAdmin
    .from('organizations')
    .update({
      onboarding_step: 2,
      updated_at: new Date().toISOString()
    })
    .eq('id', organizationId)

  return c.json({
    success: true,
    site: {
      id: site.id,
      name: site.name,
      address: site.address,
      phone: site.phone,
      email: site.email
    }
  })
})

/**
 * POST /api/v1/onboarding/invite-team
 * Step 3: Invite team members
 */
onboarding.post('/invite-team', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.user.organizationId
  const body = await c.req.json()
  const { invites } = body

  if (!Array.isArray(invites)) {
    return c.json({ error: 'Invites must be an array' }, 400)
  }

  // Get the first site for the organization
  const { data: site } = await supabaseAdmin
    .from('sites')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .limit(1)
    .single()

  // Get organization name for invite email
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .single()
  const orgName = org?.name || 'Vehicle Health Check'

  const results = []
  const errors = []

  for (const invite of invites) {
    const { email, firstName, lastName, role } = invite

    if (!email || !firstName || !lastName || !role) {
      errors.push({ email, error: 'Missing required fields' })
      continue
    }

    // Valid roles for onboarding
    const validRoles = ['site_admin', 'service_advisor', 'technician']
    if (!validRoles.includes(role)) {
      errors.push({ email, error: 'Invalid role' })
      continue
    }

    try {
      // Create auth user
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          first_name: firstName,
          last_name: lastName
        }
      })

      if (authError) {
        errors.push({ email, error: authError.message })
        continue
      }

      // Create user record
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          auth_id: authUser.user.id,
          organization_id: organizationId,
          site_id: site?.id,
          email,
          first_name: firstName,
          last_name: lastName,
          role,
          is_active: true,
          is_org_admin: false,
          is_site_admin: role === 'site_admin',
          invited_by: auth.user.id,
          invited_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (userError) {
        // Clean up auth user if user record creation fails
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
        errors.push({ email, error: userError.message })
        continue
      }

      // Generate a password reset link so the invited user can set their password
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email
      })

      if (linkData?.properties?.action_link) {
        const resetLink = linkData.properties.action_link

        const roleLabel = role.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())

        await sendEmail({
          to: email,
          subject: `You've been invited to join ${orgName} on VHC`,
          organizationId,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">You've Been Invited!</h2>
              <p>Hi ${firstName},</p>
              <p><strong>${orgName}</strong> has invited you to join their team as a <strong>${roleLabel}</strong> on the Vehicle Health Check platform.</p>
              <p>Click the button below to set your password and get started:</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 12px 32px; text-decoration: none; font-weight: bold; display: inline-block;">Set Your Password</a>
              </div>
              <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="color: #666; font-size: 12px; word-break: break-all;">${resetLink}</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px;">This invite was sent by ${orgName} via Vehicle Health Check.</p>
            </div>
          `
        })
      } else {
        console.warn(`Failed to generate invite link for ${email}:`, linkError?.message)
      }

      results.push({
        email,
        userId: user.id,
        role,
        success: true
      })
    } catch (err) {
      errors.push({ email, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  // Update onboarding step
  await supabaseAdmin
    .from('organizations')
    .update({
      onboarding_step: 3,
      updated_at: new Date().toISOString()
    })
    .eq('id', organizationId)

  return c.json({
    success: true,
    invited: results,
    errors: errors.length > 0 ? errors : undefined
  })
})

/**
 * POST /api/v1/onboarding/notifications
 * Step 4: Configure notification settings
 */
onboarding.post('/notifications', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.user.organizationId
  const body = await c.req.json()

  const {
    usePlatformSms,
    usePlatformEmail,
    defaultLinkExpiryHours,
    defaultReminderEnabled,
    defaultReminderIntervals
  } = body

  // Check if notification settings exist
  const { data: existingSettings } = await supabaseAdmin
    .from('organization_notification_settings')
    .select('id')
    .eq('organization_id', organizationId)
    .single()

  const notificationData = {
    organization_id: organizationId,
    use_platform_sms: usePlatformSms !== false,
    use_platform_email: usePlatformEmail !== false,
    default_link_expiry_hours: defaultLinkExpiryHours || 72,
    default_reminder_enabled: defaultReminderEnabled !== false,
    default_reminder_intervals: defaultReminderIntervals || [24, 48],
    updated_at: new Date().toISOString()
  }

  let result
  if (existingSettings) {
    result = await supabaseAdmin
      .from('organization_notification_settings')
      .update(notificationData)
      .eq('organization_id', organizationId)
      .select()
      .single()
  } else {
    result = await supabaseAdmin
      .from('organization_notification_settings')
      .insert({
        ...notificationData,
        created_at: new Date().toISOString()
      })
      .select()
      .single()
  }

  if (result.error) {
    return c.json({ error: result.error.message }, 500)
  }

  // Update onboarding step
  await supabaseAdmin
    .from('organizations')
    .update({
      onboarding_step: 4,
      updated_at: new Date().toISOString()
    })
    .eq('id', organizationId)

  return c.json({
    success: true,
    settings: {
      usePlatformSms: result.data.use_platform_sms,
      usePlatformEmail: result.data.use_platform_email,
      defaultLinkExpiryHours: result.data.default_link_expiry_hours,
      defaultReminderEnabled: result.data.default_reminder_enabled
    }
  })
})

/**
 * POST /api/v1/onboarding/complete
 * Mark onboarding as complete
 */
onboarding.post('/complete', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.user.organizationId

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      onboarding_completed: true,
      onboarding_step: 5,
      updated_at: new Date().toISOString()
    })
    .eq('id', organizationId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    success: true,
    message: 'Onboarding completed successfully!'
  })
})

/**
 * POST /api/v1/onboarding/skip
 * Skip remaining onboarding steps
 */
onboarding.post('/skip', async (c) => {
  const auth = c.get('auth')
  const organizationId = auth.user.organizationId

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({
      onboarding_completed: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', organizationId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    success: true,
    message: 'Onboarding skipped. You can complete setup later in Settings.'
  })
})

export default onboarding
