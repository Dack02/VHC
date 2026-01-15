import 'dotenv/config'

// Use native fetch only - no Supabase client interference
async function testLogin() {
  // Step 1: Sign in directly via API
  console.log('Step 1: Signing in via /api/v1/auth/login...')
  const loginRes = await fetch('http://127.0.0.1:5180/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@demo.com',
      password: 'admin123'
    })
  })

  console.log('Login status:', loginRes.status)
  const loginData = await loginRes.json()

  if (loginRes.status !== 200) {
    console.log('Login failed:', loginData)
    return
  }

  console.log('Login successful!')
  console.log('User:', loginData.user?.email)
  console.log('Token prefix:', loginData.session?.accessToken?.substring(0, 50) + '...')

  // Step 2: Test the stats endpoint with the token
  console.log('\nStep 2: Testing /api/v1/admin/stats endpoint...')
  const statsRes = await fetch('http://127.0.0.1:5180/api/v1/admin/stats', {
    headers: {
      'Authorization': `Bearer ${loginData.session?.accessToken}`
    }
  })

  console.log('Stats status:', statsRes.status)
  const statsData = await statsRes.json()
  console.log('Stats response:', JSON.stringify(statsData, null, 2))
}

testLogin()

