import 'dotenv/config'

async function test() {
  // Test without auth header
  console.log('Test 1: Without auth header')
  const res1 = await fetch('http://127.0.0.1:5180/api/v1/admin/stats')
  console.log('Status:', res1.status)
  console.log('Body:', await res1.text())

  // Test with dummy auth header
  console.log('\nTest 2: With dummy auth header')
  const res2 = await fetch('http://127.0.0.1:5180/api/v1/admin/stats', {
    headers: { 'Authorization': 'Bearer test123' }
  })
  console.log('Status:', res2.status)
  console.log('Body:', await res2.text())

  // Test the root admin endpoint
  console.log('\nTest 3: Root /api/v1/admin')
  const res3 = await fetch('http://127.0.0.1:5180/api/v1/admin')
  console.log('Status:', res3.status)
  console.log('Body:', await res3.text())
}

test()
