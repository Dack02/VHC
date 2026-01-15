import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

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

async function setupDmsKey() {
  // Generate a random API key
  const apiKey = `vhc_dms_${randomBytes(24).toString('hex')}`

  // Update organization settings with DMS API key
  const { data: org, error } = await supabase
    .from('organizations')
    .update({
      settings: {
        currency: 'GBP',
        timezone: 'Europe/London',
        dms_api_key: apiKey
      }
    })
    .eq('id', ORG_ID)
    .select()
    .single()

  if (error) {
    console.error('Failed to set DMS API key:', error)
    process.exit(1)
  }

  console.log('DMS API Key configured for:', org.name)
  console.log('')
  console.log('API Key:', apiKey)
  console.log('')
  console.log('Usage:')
  console.log('  curl -X POST http://localhost:5180/api/v1/dms/customers \\')
  console.log(`    -H "X-API-Key: ${apiKey}" \\`)
  console.log('    -H "Content-Type: application/json" \\')
  console.log('    -d \'{"externalId": "CUST001", "firstName": "John", "lastName": "Doe"}\'')
}

setupDmsKey().catch(console.error)
