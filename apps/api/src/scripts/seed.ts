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

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const SITE_MAIN_ID = '22222222-2222-2222-2222-222222222221'
const SITE_NORTH_ID = '22222222-2222-2222-2222-222222222222'

const testUsers = [
  {
    email: 'admin@demo.com',
    password: 'demo1234',
    firstName: 'Admin',
    lastName: 'User',
    role: 'org_admin',
    siteId: null
  },
  {
    email: 'advisor1@demo.com',
    password: 'demo1234',
    firstName: 'Sarah',
    lastName: 'Johnson',
    role: 'service_advisor',
    siteId: SITE_MAIN_ID
  },
  {
    email: 'advisor2@demo.com',
    password: 'demo1234',
    firstName: 'Mike',
    lastName: 'Chen',
    role: 'service_advisor',
    siteId: SITE_NORTH_ID
  },
  {
    email: 'tech1@demo.com',
    password: 'demo1234',
    firstName: 'James',
    lastName: 'Smith',
    role: 'technician',
    siteId: SITE_MAIN_ID
  },
  {
    email: 'tech2@demo.com',
    password: 'demo1234',
    firstName: 'Emma',
    lastName: 'Wilson',
    role: 'technician',
    siteId: SITE_MAIN_ID
  }
]

async function seed() {
  console.log('Starting seed...')

  // Check if org exists, if not run the seed.sql first
  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', ORG_ID)
    .single()

  if (!org) {
    console.log('Organization not found. Creating base data...')

    // Create organization
    const { error: orgError } = await supabase
      .from('organizations')
      .insert({
        id: ORG_ID,
        name: 'Demo Auto Group',
        slug: 'demo-auto-group',
        settings: { currency: 'GBP', timezone: 'Europe/London' }
      })

    if (orgError) {
      console.error('Failed to create organization:', orgError)
      process.exit(1)
    }

    // Create sites
    const { error: sitesError } = await supabase
      .from('sites')
      .insert([
        {
          id: SITE_MAIN_ID,
          organization_id: ORG_ID,
          name: 'Main Workshop',
          address: '123 High Street, London, SW1A 1AA',
          phone: '+44 20 1234 5678',
          email: 'main@demoauto.com',
          settings: { bayCount: 6 }
        },
        {
          id: SITE_NORTH_ID,
          organization_id: ORG_ID,
          name: 'North Branch',
          address: '456 North Road, Manchester, M1 1AA',
          phone: '+44 161 234 5678',
          email: 'north@demoauto.com',
          settings: { bayCount: 4 }
        }
      ])

    if (sitesError) {
      console.error('Failed to create sites:', sitesError)
      process.exit(1)
    }

    console.log('Base data created.')
  }

  // Create test users
  console.log('Creating test users...')

  for (const user of testUsers) {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', user.email)
      .single()

    if (existingUser) {
      console.log(`User ${user.email} already exists, skipping...`)
      continue
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true
    })

    if (authError) {
      console.error(`Failed to create auth user ${user.email}:`, authError)
      continue
    }

    // Create user record
    const { error: userError } = await supabase
      .from('users')
      .insert({
        auth_id: authData.user.id,
        organization_id: ORG_ID,
        site_id: user.siteId,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        is_active: true
      })

    if (userError) {
      console.error(`Failed to create user record ${user.email}:`, userError)
      // Cleanup auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      continue
    }

    console.log(`Created user: ${user.email} (${user.role})`)
  }

  console.log('\nSeed complete!')
  console.log('\nTest accounts:')
  console.log('  admin@demo.com / demo1234 (org_admin)')
  console.log('  advisor1@demo.com / demo1234 (service_advisor - Main Workshop)')
  console.log('  advisor2@demo.com / demo1234 (service_advisor - North Branch)')
  console.log('  tech1@demo.com / demo1234 (technician - Main Workshop)')
  console.log('  tech2@demo.com / demo1234 (technician - Main Workshop)')
}

seed().catch(console.error)
