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
 * Advance the stored onboarding step monotonically. Revisiting an earlier step
 * (via the wizard's Back button) must never roll the saved progress backwards,
 * otherwise the user resumes earlier than they had reached on their next visit.
 */
async function advanceOnboardingStep(organizationId: string, step: number): Promise<void> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('onboarding_step')
    .eq('id', organizationId)
    .maybeSingle()

  const next = Math.max(org?.onboarding_step || 0, step)

  await supabaseAdmin
    .from('organizations')
    .update({ onboarding_step: next, updated_at: new Date().toISOString() })
    .eq('id', organizationId)
}

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

  // Get inspection templates count (an org needs at least one to create a health check)
  const { count: templatesCount } = await supabaseAdmin
    .from('check_templates')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  return c.json({
    organizationId: org.id,
    organizationName: org.name,
    onboardingCompleted: org.onboarding_completed,
    currentStep: org.onboarding_step || 0,
    hasSettings: !!org.settings,
    hasSites: (sitesCount || 0) > 0,
    hasTeamMembers: (usersCount || 0) > 0,
    hasTemplates: (templatesCount || 0) > 0,
    sitesCount: sitesCount || 0,
    teamMembersCount: usersCount || 0,
    templatesCount: templatesCount || 0
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

  // Advance onboarding progress (monotonic — never regress when revisiting a step)
  await advanceOnboardingStep(organizationId, 1)

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

  // Idempotency: check if an active site already exists for this org
  const { data: existingSite } = await supabaseAdmin
    .from('sites')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (existingSite) {
    // Site already exists - ensure user is assigned and step is updated
    await supabaseAdmin
      .from('users')
      .update({
        site_id: existingSite.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', auth.user.id)
      .is('site_id', null)

    await advanceOnboardingStep(organizationId, 2)

    return c.json({
      success: true,
      site: {
        id: existingSite.id,
        name: existingSite.name,
        address: existingSite.address,
        phone: existingSite.phone,
        email: existingSite.email
      }
    })
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

  // Advance onboarding progress (monotonic)
  await advanceOnboardingStep(organizationId, 2)

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

  // Get the first site for the organization (may be absent if this step is reached early)
  const { data: site } = await supabaseAdmin
    .from('sites')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  // Get organization name for invite email
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .single()
  const orgName = org?.name || 'Vehicle Health Check'

  const results: Array<{ email: string; userId: string; role: string; success: boolean; emailSent: boolean }> = []
  const errors: Array<{ email: string; error: string }> = []

  const validRoles = ['site_admin', 'service_advisor', 'technician']
  const resetRedirect = `${process.env.WEB_URL || 'http://localhost:5181'}/reset-password`

  for (const invite of invites) {
    const { email, firstName, lastName, role } = invite

    if (!email || !firstName || !lastName || !role) {
      errors.push({ email, error: 'Missing required fields' })
      continue
    }

    if (!validRoles.includes(role)) {
      errors.push({ email, error: 'Invalid role' })
      continue
    }

    // Prevent duplicate membership within this organisation
    const { data: existingMember } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (existingMember) {
      errors.push({ email, error: 'Already a member of this organisation' })
      continue
    }

    try {
      // Create (or resolve an existing) auth user
      let authUserId: string | null = null
      let createdNewAuthUser = false

      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName }
      })

      if (authError) {
        // The email may already exist in Supabase Auth (e.g. a member of another org) —
        // link to that existing account rather than failing the invite.
        if (authError.message.includes('already been registered')) {
          const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers()
          const existingAuth = existingAuthUsers?.users?.find(u => u.email === email)
          if (existingAuth) {
            authUserId = existingAuth.id
          } else {
            errors.push({ email, error: authError.message })
            continue
          }
        } else {
          errors.push({ email, error: authError.message })
          continue
        }
      } else if (authUser?.user) {
        authUserId = authUser.user.id
        createdNewAuthUser = true
      }

      if (!authUserId) {
        errors.push({ email, error: 'Could not resolve auth user' })
        continue
      }

      // Create the org membership record
      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          auth_id: authUserId,
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
        // Only clean up the auth user if WE created it (never delete another org's account)
        if (createdNewAuthUser) {
          await supabaseAdmin.auth.admin.deleteUser(authUserId)
        }
        errors.push({ email, error: userError.message })
        continue
      }

      // Best-effort: email a "set your password" link. A failure here does NOT fail
      // the invite — the user exists and an admin can re-send the link later.
      let emailSent = false
      try {
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: resetRedirect }
        })

        const resetLink = linkData?.properties?.action_link
        if (resetLink) {
          const roleLabel = role.replace('_', ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase())
          const result = await sendEmail({
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
                  <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 12px 32px; text-decoration: none; font-weight: bold; display: inline-block; border-radius: 6px;">Set Your Password</a>
                </div>
                <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="color: #666; font-size: 12px; word-break: break-all;">${resetLink}</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="color: #999; font-size: 12px;">This invite was sent by ${orgName} via Vehicle Health Check.</p>
              </div>
            `
          })
          emailSent = result.success
        } else {
          console.warn(`Failed to generate invite link for ${email}:`, linkError?.message)
        }
      } catch (emailErr) {
        console.warn(`Failed to send invite email to ${email}:`, emailErr)
      }

      results.push({ email, userId: user.id, role, success: true, emailSent })
    } catch (err) {
      errors.push({ email, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  // Advance onboarding progress (monotonic)
  await advanceOnboardingStep(organizationId, 3)

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

  // Advance onboarding progress (monotonic)
  await advanceOnboardingStep(organizationId, 4)

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
      onboarding_step: 5,
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
