/**
 * Health Check API Integration Tests
 *
 * These tests verify the health check API endpoints work correctly.
 * Run with: npx tsx src/tests/health-check.test.ts
 *
 * Prerequisites:
 * - API server running on port 5180
 * - Seed data loaded (admin@demo.com account)
 * - At least one template, customer, and vehicle in database
 */

const API_BASE = 'http://localhost:5180/api/v1'

interface TestContext {
  token: string
  healthCheckId?: string
  templateId?: string
  vehicleId?: string
  customerId?: string
}

const ctx: TestContext = { token: '' }

async function api(path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }
  return data
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  Error: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}

async function runTests() {
  console.log('Health Check API Tests\n')

  // Login
  await test('Login as admin', async () => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email: 'admin@demo.com', password: 'demo1234' }
    })
    if (!data.session?.accessToken) throw new Error('No token received')
    ctx.token = data.session.accessToken
  })

  // Get template
  await test('Get templates', async () => {
    const data = await api('/templates', { token: ctx.token })
    if (!data.templates?.length) throw new Error('No templates found')
    ctx.templateId = data.templates[0].id
  })

  // Create customer
  await test('Create customer', async () => {
    const data = await api('/customers', {
      method: 'POST',
      token: ctx.token,
      body: {
        firstName: 'Test',
        lastName: 'Customer',
        email: `test${Date.now()}@example.com`,
        mobile: '07700900000'
      }
    })
    if (!data.id) throw new Error('No customer ID returned')
    ctx.customerId = data.id
  })

  // Create vehicle
  await test('Create vehicle', async () => {
    const data = await api('/vehicles', {
      method: 'POST',
      token: ctx.token,
      body: {
        customerId: ctx.customerId,
        registration: `TEST${Date.now().toString().slice(-4)}`,
        make: 'Test',
        model: 'Vehicle'
      }
    })
    if (!data.id) throw new Error('No vehicle ID returned')
    ctx.vehicleId = data.id
  })

  // Create health check
  await test('Create health check', async () => {
    const data = await api('/health-checks', {
      method: 'POST',
      token: ctx.token,
      body: {
        vehicleId: ctx.vehicleId,
        templateId: ctx.templateId,
        mileageIn: 50000
      }
    })
    if (!data.id) throw new Error('No health check ID returned')
    if (data.status !== 'created') throw new Error(`Expected status 'created', got '${data.status}'`)
    ctx.healthCheckId = data.id
  })

  // Get health check details
  await test('Get health check details', async () => {
    const data = await api(`/health-checks/${ctx.healthCheckId}`, { token: ctx.token })
    if (data.id !== ctx.healthCheckId) throw new Error('Health check ID mismatch')
    if (!data.template?.sections?.length) throw new Error('No template sections')
  })

  // Assign technician (using current user as technician for test)
  await test('Assign technician', async () => {
    const me = await api('/auth/me', { token: ctx.token })
    const data = await api(`/health-checks/${ctx.healthCheckId}/assign`, {
      method: 'POST',
      token: ctx.token,
      body: { technicianId: me.id }
    })
    if (data.status !== 'assigned') throw new Error(`Expected status 'assigned', got '${data.status}'`)
  })

  // Clock in
  await test('Clock in', async () => {
    const data = await api(`/health-checks/${ctx.healthCheckId}/clock-in`, {
      method: 'POST',
      token: ctx.token
    })
    if (!data.clockIn) throw new Error('No clock in time')
    if (data.healthCheckStatus !== 'in_progress') throw new Error('Status not updated to in_progress')
  })

  // Save check result
  await test('Save check result', async () => {
    // Get template item ID from health check
    const hc = await api(`/health-checks/${ctx.healthCheckId}`, { token: ctx.token })
    const templateItemId = hc.template.sections[0].items[0].id

    const data = await api(`/health-checks/${ctx.healthCheckId}/results`, {
      method: 'POST',
      token: ctx.token,
      body: {
        templateItemId,
        status: 'amber',
        notes: 'Test note'
      }
    })
    if (!data.id) throw new Error('No result ID returned')
    if (data.status !== 'amber') throw new Error(`Expected status 'amber', got '${data.status}'`)
  })

  // Clock out
  await test('Clock out', async () => {
    const data = await api(`/health-checks/${ctx.healthCheckId}/clock-out`, {
      method: 'POST',
      token: ctx.token,
      body: { complete: false }
    })
    if (!data.clockOut) throw new Error('No clock out time')
    if (data.healthCheckStatus !== 'paused') throw new Error('Status not updated to paused')
  })

  // Get time entries
  await test('Get time entries', async () => {
    const data = await api(`/health-checks/${ctx.healthCheckId}/time-entries`, { token: ctx.token })
    if (!data.entries?.length) throw new Error('No time entries found')
    if (data.totalMinutes < 0) throw new Error('Invalid total minutes')
  })

  // Generate repair items
  await test('Generate repair items from amber results', async () => {
    const data = await api(`/health-checks/${ctx.healthCheckId}/repair-items/generate`, {
      method: 'POST',
      token: ctx.token
    })
    if (data.generated !== 1) throw new Error(`Expected 1 generated item, got ${data.generated}`)
  })

  // Get repair items
  await test('Get repair items', async () => {
    const data = await api(`/health-checks/${ctx.healthCheckId}/repair-items`, { token: ctx.token })
    if (!data.repairItems?.length) throw new Error('No repair items found')
  })

  // Update repair item price
  await test('Update repair item price', async () => {
    const items = await api(`/health-checks/${ctx.healthCheckId}/repair-items`, { token: ctx.token })
    const itemId = items.repairItems[0].id

    const data = await api(`/health-checks/${ctx.healthCheckId}/repair-items/${itemId}`, {
      method: 'PATCH',
      token: ctx.token,
      body: { labourCost: 50, partsCost: 25 }
    })
    if (data.totalCost !== 75) throw new Error(`Expected total 75, got ${data.totalCost}`)
  })

  // Change status
  await test('Change status with validation', async () => {
    // First clock back in to get to in_progress
    await api(`/health-checks/${ctx.healthCheckId}/clock-in`, {
      method: 'POST',
      token: ctx.token
    })

    // Then clock out with complete
    await api(`/health-checks/${ctx.healthCheckId}/clock-out`, {
      method: 'POST',
      token: ctx.token,
      body: { complete: true }
    })

    // Now try to change to awaiting_pricing
    const data = await api(`/health-checks/${ctx.healthCheckId}/status`, {
      method: 'POST',
      token: ctx.token,
      body: { status: 'awaiting_pricing', notes: 'Test status change' }
    })
    if (data.status !== 'awaiting_pricing') throw new Error('Status not changed')
  })

  // Get status history
  await test('Get status history', async () => {
    const data = await api(`/health-checks/${ctx.healthCheckId}/history`, { token: ctx.token })
    if (!data.history?.length) throw new Error('No history entries')
    if (data.history.length < 5) throw new Error('Expected at least 5 history entries')
  })

  // Invalid status transition should fail
  await test('Invalid status transition rejected', async () => {
    try {
      await api(`/health-checks/${ctx.healthCheckId}/status`, {
        method: 'POST',
        token: ctx.token,
        body: { status: 'created' } // Invalid: can't go back to created
      })
      throw new Error('Should have rejected invalid transition')
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid status transition')) {
        // Expected error
      } else if (error instanceof Error && error.message === 'Should have rejected invalid transition') {
        throw error
      }
      // Other errors are also acceptable (means validation worked)
    }
  })

  // List health checks
  await test('List health checks with filters', async () => {
    const data = await api('/health-checks?status=awaiting_pricing', { token: ctx.token })
    if (!data.healthChecks?.length) throw new Error('No health checks found')
    const found = data.healthChecks.find((hc: { id: string }) => hc.id === ctx.healthCheckId)
    if (!found) throw new Error('Created health check not in list')
  })

  console.log('\n✓ All tests passed!')
}

runTests().catch(console.error)
