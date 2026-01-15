import 'dotenv/config'
import { supabaseAdmin } from '../lib/supabase.js'

async function check() {
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .select('*')

  console.log('All super_admins:', JSON.stringify(data, null, 2))
  if (error) console.log('Error:', error.message)
}

check()
