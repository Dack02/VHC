import 'dotenv/config'

async function testFetch() {
  console.log('Testing fetch to API...')

  // Try different URLs
  const urls = [
    'http://127.0.0.1:5180/health',
    'http://127.0.0.1:5180/api/v1/admin/stats',
    'http://localhost:5180/api/v1/admin/stats',
    'http://[::1]:5180/api/v1/admin/stats'
  ]

  for (const url of urls) {
    try {
      console.log(`\nTrying: ${url}`)
      const res = await fetch(url)
      console.log('Status:', res.status)
      const text = await res.text()
      console.log('Body:', text.substring(0, 100))
    } catch (e) {
      console.log('Error:', e)
    }
  }
}

testFetch()
