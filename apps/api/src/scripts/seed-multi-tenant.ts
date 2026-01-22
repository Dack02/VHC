/**
 * Multi-Tenant Test Data Seed Script
 * Creates test organizations, users at different roles, and super admin
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Test Organization IDs
const ORG_1_ID = '11111111-1111-1111-1111-111111111111' // Demo Auto Group (existing)
const ORG_2_ID = '22222222-2222-2222-2222-222222222222' // Premium Motors
const ORG_3_ID = '33333333-3333-3333-3333-333333333333' // Budget Cars

// Test Site IDs
const ORG_1_SITE_1_ID = '22222222-2222-2222-2222-222222222221'
// const ORG_1_SITE_2_ID = '22222222-2222-2222-2222-222222222222' // Reserved for future use
const ORG_2_SITE_1_ID = 'aaaa1111-1111-1111-1111-111111111111'
const ORG_3_SITE_1_ID = 'bbbb1111-1111-1111-1111-111111111111'

// Organizations to create
const organizations = [
  {
    id: ORG_2_ID,
    name: 'Premium Motors Ltd',
    slug: 'premium-motors',
    status: 'active',
    onboarding_completed: true,
    onboarding_step: 5,
    settings: {
      currency: 'GBP',
      timezone: 'Europe/London',
      primaryColor: '#1e40af',
      secondaryColor: '#10b981'
    }
  },
  {
    id: ORG_3_ID,
    name: 'Budget Cars',
    slug: 'budget-cars',
    status: 'active',
    onboarding_completed: false,
    onboarding_step: 2,
    settings: {
      currency: 'GBP',
      timezone: 'Europe/London',
      primaryColor: '#dc2626'
    }
  }
]

// Sites to create
const sites = [
  {
    id: ORG_2_SITE_1_ID,
    organization_id: ORG_2_ID,
    name: 'Premium HQ',
    address: '100 Luxury Lane, London, W1 1AA',
    phone: '+44 20 9876 5432',
    email: 'hq@premiummotors.com'
  },
  {
    id: ORG_3_SITE_1_ID,
    organization_id: ORG_3_ID,
    name: 'Budget Main',
    address: '50 Value Road, Birmingham, B1 1AA',
    phone: '+44 121 234 5678',
    email: 'info@budgetcars.com'
  }
]

// Subscriptions to create
const subscriptions = [
  {
    organization_id: ORG_1_ID,
    plan_id: 'professional',
    status: 'active',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    organization_id: ORG_2_ID,
    plan_id: 'enterprise',
    status: 'active',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    organization_id: ORG_3_ID,
    plan_id: 'starter',
    status: 'active',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }
]

// Users to create
const testUsers = [
  // Super Admin
  {
    email: 'super@vhc.app',
    password: 'super1234',
    firstName: 'Super',
    lastName: 'Admin',
    role: 'super_admin',
    organizationId: null,
    siteId: null,
    isSuperAdmin: true
  },
  // Org 1 Users (Demo Auto Group - existing org)
  {
    email: 'admin@demo.com',
    password: 'demo1234',
    firstName: 'Admin',
    lastName: 'User',
    role: 'org_admin',
    organizationId: ORG_1_ID,
    siteId: null,
    isOrgAdmin: true
  },
  {
    email: 'siteadmin@demo.com',
    password: 'demo1234',
    firstName: 'Site',
    lastName: 'Admin',
    role: 'site_admin',
    organizationId: ORG_1_ID,
    siteId: ORG_1_SITE_1_ID,
    isSiteAdmin: true
  },
  {
    email: 'advisor1@demo.com',
    password: 'demo1234',
    firstName: 'Sarah',
    lastName: 'Johnson',
    role: 'service_advisor',
    organizationId: ORG_1_ID,
    siteId: ORG_1_SITE_1_ID
  },
  {
    email: 'tech1@demo.com',
    password: 'demo1234',
    firstName: 'James',
    lastName: 'Smith',
    role: 'technician',
    organizationId: ORG_1_ID,
    siteId: ORG_1_SITE_1_ID
  },
  // Org 2 Users (Premium Motors)
  {
    email: 'admin@premium.com',
    password: 'demo1234',
    firstName: 'Premium',
    lastName: 'Admin',
    role: 'org_admin',
    organizationId: ORG_2_ID,
    siteId: null,
    isOrgAdmin: true
  },
  {
    email: 'advisor@premium.com',
    password: 'demo1234',
    firstName: 'Premium',
    lastName: 'Advisor',
    role: 'service_advisor',
    organizationId: ORG_2_ID,
    siteId: ORG_2_SITE_1_ID
  },
  {
    email: 'tech@premium.com',
    password: 'demo1234',
    firstName: 'Premium',
    lastName: 'Tech',
    role: 'technician',
    organizationId: ORG_2_ID,
    siteId: ORG_2_SITE_1_ID
  },
  // Org 3 Users (Budget Cars)
  {
    email: 'admin@budget.com',
    password: 'demo1234',
    firstName: 'Budget',
    lastName: 'Admin',
    role: 'org_admin',
    organizationId: ORG_3_ID,
    siteId: null,
    isOrgAdmin: true
  },
  {
    email: 'tech@budget.com',
    password: 'demo1234',
    firstName: 'Budget',
    lastName: 'Tech',
    role: 'technician',
    organizationId: ORG_3_ID,
    siteId: ORG_3_SITE_1_ID
  }
]

async function seed() {
  console.log('='.repeat(60))
  console.log('Multi-Tenant Test Data Seed')
  console.log('='.repeat(60))

  // Step 1: Create Organizations
  console.log('\n1. Creating organizations...')
  for (const org of organizations) {
    const { data: existing } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', org.id)
      .single()

    if (existing) {
      console.log(`   [SKIP] ${org.name} already exists`)
      continue
    }

    const { error } = await supabase.from('organizations').insert(org)
    if (error) {
      console.error(`   [ERROR] Failed to create ${org.name}:`, error.message)
    } else {
      console.log(`   [OK] Created ${org.name}`)
    }
  }

  // Step 2: Create Sites
  console.log('\n2. Creating sites...')
  for (const site of sites) {
    const { data: existing } = await supabase
      .from('sites')
      .select('id')
      .eq('id', site.id)
      .single()

    if (existing) {
      console.log(`   [SKIP] ${site.name} already exists`)
      continue
    }

    const { error } = await supabase.from('sites').insert(site)
    if (error) {
      console.error(`   [ERROR] Failed to create ${site.name}:`, error.message)
    } else {
      console.log(`   [OK] Created ${site.name}`)
    }
  }

  // Step 3: Create Subscriptions
  console.log('\n3. Creating subscriptions...')
  for (const sub of subscriptions) {
    const { data: existing } = await supabase
      .from('organization_subscriptions')
      .select('id')
      .eq('organization_id', sub.organization_id)
      .single()

    if (existing) {
      console.log(`   [SKIP] Subscription for org ${sub.organization_id.slice(0, 8)} already exists`)
      continue
    }

    const { error } = await supabase.from('organization_subscriptions').insert(sub)
    if (error) {
      console.error(`   [ERROR] Failed to create subscription:`, error.message)
    } else {
      console.log(`   [OK] Created ${sub.plan_id} subscription for org ${sub.organization_id.slice(0, 8)}`)
    }
  }

  // Step 4: Create Users
  console.log('\n4. Creating users...')
  for (const user of testUsers) {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', user.email)
      .single()

    if (existingUser) {
      console.log(`   [SKIP] ${user.email} already exists`)
      continue
    }

    // Check for super admin in super_admins table
    if (user.isSuperAdmin) {
      const { data: existingSuperAdmin } = await supabase
        .from('super_admins')
        .select('*')
        .eq('email', user.email)
        .single()

      if (existingSuperAdmin) {
        console.log(`   [SKIP] Super admin ${user.email} already exists`)
        continue
      }
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true
    })

    if (authError) {
      console.error(`   [ERROR] Failed to create auth user ${user.email}:`, authError.message)
      continue
    }

    // Create super admin record if needed
    if (user.isSuperAdmin) {
      const { error: superAdminError } = await supabase
        .from('super_admins')
        .insert({
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          auth_user_id: authData.user.id,
          is_active: true
        })

      if (superAdminError) {
        console.error(`   [ERROR] Failed to create super admin record:`, superAdminError.message)
        await supabase.auth.admin.deleteUser(authData.user.id)
        continue
      }

      console.log(`   [OK] Created super admin: ${user.email}`)
      continue
    }

    // Create regular user record
    const { error: userError } = await supabase
      .from('users')
      .insert({
        auth_id: authData.user.id,
        organization_id: user.organizationId,
        site_id: user.siteId,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        is_org_admin: user.isOrgAdmin || false,
        is_site_admin: user.isSiteAdmin || false,
        is_active: true
      })

    if (userError) {
      console.error(`   [ERROR] Failed to create user record ${user.email}:`, userError.message)
      await supabase.auth.admin.deleteUser(authData.user.id)
      continue
    }

    console.log(`   [OK] Created ${user.role}: ${user.email}`)
  }

  // Step 5: Create Usage Records
  console.log('\n5. Creating usage records...')
  const currentPeriodStart = new Date()
  currentPeriodStart.setDate(1)
  currentPeriodStart.setHours(0, 0, 0, 0)

  const usageRecords = [
    {
      organization_id: ORG_1_ID,
      period_start: currentPeriodStart.toISOString(),
      period_end: new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() + 1, 0).toISOString(),
      health_checks_created: 25,
      health_checks_completed: 20,
      sms_sent: 45,
      emails_sent: 50,
      storage_used_bytes: 524288000 // 500MB
    },
    {
      organization_id: ORG_2_ID,
      period_start: currentPeriodStart.toISOString(),
      period_end: new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() + 1, 0).toISOString(),
      health_checks_created: 150,
      health_checks_completed: 140,
      sms_sent: 200,
      emails_sent: 250,
      storage_used_bytes: 2147483648 // 2GB
    },
    {
      organization_id: ORG_3_ID,
      period_start: currentPeriodStart.toISOString(),
      period_end: new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() + 1, 0).toISOString(),
      health_checks_created: 45,
      health_checks_completed: 40,
      sms_sent: 30,
      emails_sent: 35,
      storage_used_bytes: 104857600 // 100MB
    }
  ]

  for (const usage of usageRecords) {
    const { data: existing } = await supabase
      .from('organization_usage')
      .select('id')
      .eq('organization_id', usage.organization_id)
      .eq('period_start', usage.period_start)
      .single()

    if (existing) {
      console.log(`   [SKIP] Usage record for org ${usage.organization_id.slice(0, 8)} already exists`)
      continue
    }

    const { error } = await supabase.from('organization_usage').insert(usage)
    if (error) {
      console.error(`   [ERROR] Failed to create usage record:`, error.message)
    } else {
      console.log(`   [OK] Created usage record for org ${usage.organization_id.slice(0, 8)}`)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('Seed Complete!')
  console.log('='.repeat(60))
  console.log('\nTest Accounts:')
  console.log('\n  SUPER ADMIN:')
  console.log('    super@vhc.app / super1234')
  console.log('\n  ORG 1 - Demo Auto Group (Professional Plan):')
  console.log('    admin@demo.com / demo1234 (org_admin)')
  console.log('    siteadmin@demo.com / demo1234 (site_admin)')
  console.log('    advisor1@demo.com / demo1234 (service_advisor)')
  console.log('    tech1@demo.com / demo1234 (technician)')
  console.log('\n  ORG 2 - Premium Motors (Enterprise Plan):')
  console.log('    admin@premium.com / demo1234 (org_admin)')
  console.log('    advisor@premium.com / demo1234 (service_advisor)')
  console.log('    tech@premium.com / demo1234 (technician)')
  console.log('\n  ORG 3 - Budget Cars (Starter Plan, Incomplete Onboarding):')
  console.log('    admin@budget.com / demo1234 (org_admin)')
  console.log('    tech@budget.com / demo1234 (technician)')
  console.log('')
}

seed().catch(console.error)
