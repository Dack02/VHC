import 'dotenv/config'
import { supabaseAdmin } from '../lib/supabase.js'

async function createSuperAdmin() {
  const email = 'leo@dack.co.uk'
  const password = 'Vauxalist1986'
  const name = 'Leo Dack'

  console.log(`Creating super admin: ${email}`)

  // Check if auth user already exists
  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers()
  let authUser = authUsers?.users?.find(u => u.email === email)

  if (authUser) {
    console.log('Auth user already exists, updating password...')
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password: password,
      email_confirm: true
    })
    if (updateError) {
      console.error('Error updating auth user:', updateError.message)
      return
    }
    console.log('Password updated successfully')
  } else {
    // Create auth user
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true
    })

    if (createError) {
      console.error('Error creating auth user:', createError.message)
      return
    }

    authUser = newUser.user
    console.log('Auth user created:', authUser.id)
  }

  // Upsert super_admins record
  const { error: upsertError } = await supabaseAdmin
    .from('super_admins')
    .upsert({
      email: email,
      name: name,
      auth_user_id: authUser.id,
      is_active: true,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'email'
    })

  if (upsertError) {
    console.error('Error upserting super_admins record:', upsertError.message)
    return
  }

  console.log('Super admin created successfully!')
  console.log(`  Email: ${email}`)
  console.log(`  Password: ${password}`)
  console.log(`  Auth ID: ${authUser.id}`)
}

createSuperAdmin()
