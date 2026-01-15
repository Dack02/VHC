import 'dotenv/config'
import { supabaseAdmin } from '../lib/supabase.js'

async function checkUser() {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*, organization:organizations(id, name, status), site:sites(id, name)')
    .eq('email', 'admin@demo.com')
    .single()

  console.log('User record:', JSON.stringify(data, null, 2))
  if (error) console.log('Error:', error.message)
}

checkUser()
