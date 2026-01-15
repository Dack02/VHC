import 'dotenv/config'
import { supabaseAdmin } from '../lib/supabase.js'

async function fixSuperAdmin() {
  // Get auth user id
  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers()
  const authUser = authUsers?.users?.find(u => u.email === 'admin@demo.com')

  if (!authUser) {
    console.log('Auth user not found for admin@demo.com')
    return
  }

  console.log('Found auth user:', authUser.id)

  // Check if super_admin record exists
  const { data: existing } = await supabaseAdmin
    .from('super_admins')
    .select('*')
    .eq('email', 'admin@demo.com')
    .single()

  if (existing) {
    // Update existing
    const { data, error } = await supabaseAdmin
      .from('super_admins')
      .update({ auth_user_id: authUser.id })
      .eq('email', 'admin@demo.com')
      .select()

    if (error) {
      console.error('Error updating:', error.message)
    } else {
      console.log('Updated super_admin:', data)
    }
  } else {
    // Insert new
    const { data, error } = await supabaseAdmin
      .from('super_admins')
      .insert({
        email: 'admin@demo.com',
        name: 'Demo Admin',
        auth_user_id: authUser.id,
        is_active: true
      })
      .select()

    if (error) {
      console.error('Error inserting:', error.message)
    } else {
      console.log('Created super_admin:', data)
    }
  }
}

fixSuperAdmin()
