import 'dotenv/config'
import { supabaseAdmin } from '../lib/supabase.js'

async function resetPassword() {
  // Get the auth user
  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers()
  const authUser = authUsers?.users?.find(u => u.email === 'admin@demo.com')

  if (!authUser) {
    console.log('Auth user not found')
    return
  }

  console.log('Found auth user:', authUser.id)

  // Reset password to 'admin123'
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
    password: 'admin123'
  })

  if (error) {
    console.log('Error resetting password:', error.message)
  } else {
    console.log('Password reset to: admin123')
  }
}

resetPassword()
