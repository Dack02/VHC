/**
 * Direct test of Gemini API connection
 * Run: npx tsx src/scripts/test-gemini-direct.ts
 */

const API_URL = 'https://central-2304.geminiosi.co.uk'
const USERNAME = 'LeoDack'
const PASSWORD = 'lgBh$&19d'

async function testGeminiConnection() {
  console.log('Testing Gemini API connection...')
  console.log(`URL: ${API_URL}`)
  console.log(`Endpoint: POST /api/v2/workshop/get-diary-bookings`)
  console.log('')

  const today = new Date().toISOString().split('T')[0]
  const basicAuth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')

  const url = `${API_URL}/api/v2/workshop/get-diary-bookings`
  const body = {
    from: today,
    to: today,
    siteId: 1
  }

  console.log('Request body:', JSON.stringify(body, null, 2))
  console.log('')

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
        'User-Agent': 'VHC-Platform/1.0'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    console.log(`Response status: ${response.status} ${response.statusText}`)
    console.log('Response headers:')
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`)
    })
    console.log('')

    if (!response.ok) {
      const errorText = await response.text()
      console.log('Error response:', errorText)
      return
    }

    const data = await response.json()

    // Pretty print the response
    console.log('Response data:')
    console.log(JSON.stringify(data, null, 2))

    // Save to file for documentation
    const fs = await import('fs')
    const path = await import('path')
    const docsDir = path.join(process.cwd(), 'docs')

    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true })
    }

    fs.writeFileSync(
      path.join(docsDir, 'gemini-live-response.json'),
      JSON.stringify(data, null, 2)
    )
    console.log('\nSaved response to docs/gemini-live-response.json')

    // Count bookings
    const bookingCount = Array.isArray(data) ? data.length : Object.keys(data).length
    console.log(`\nFound ${bookingCount} booking(s) for ${today}`)

  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        console.error('Request timed out after 30 seconds')
      } else {
        console.error('Error:', err.message)
      }
    }
  }
}

testGeminiConnection()
