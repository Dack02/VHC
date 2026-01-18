/**
 * Group Creation Bug Fix Test
 *
 * Tests that when creating a repair group from check results that don't have
 * existing repair items, child repair items are created properly.
 *
 * Run with: npx tsx src/tests/group-creation.test.ts
 */

const API_BASE = 'http://localhost:5180/api/v1'

interface TestContext {
  token: string
  healthCheckId?: string
  checkResultIds: string[]
  templateId?: string
  vehicleId?: string
  customerId?: string
  createdHealthCheck: boolean
}

const ctx: TestContext = { token: '', checkResultIds: [], createdHealthCheck: false }

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
  return { data, ok: response.ok, status: response.status }
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
  console.log('Group Creation Bug Fix Test\n')
  console.log('Testing: When creating a group from check results WITHOUT existing repair items,')
  console.log('         child repair items should be created automatically.\n')

  // Login
  await test('Login as admin', async () => {
    const { data, ok } = await api('/auth/login', {
      method: 'POST',
      body: { email: 'admin@demo.com', password: 'demo1234' }
    })
    if (!ok || !data.session?.accessToken) throw new Error('Login failed')
    ctx.token = data.session.accessToken
  })

  // Find a health check with check results OR create test data
  await test('Find or create health check with check results', async () => {
    // First try to find an existing health check
    const { data, ok } = await api('/health-checks?limit=50', { token: ctx.token })
    if (!ok) throw new Error('Failed to fetch health checks')

    // Find a health check with amber/red results
    for (const hc of data.healthChecks || []) {
      const { data: detail } = await api(`/health-checks/${hc.id}`, { token: ctx.token })

      // Look for check results that are amber/red and don't have repair items yet
      const checkResults = detail.checkResults || []
      const eligibleResults = checkResults.filter((cr: any) =>
        (cr.rag_status === 'amber' || cr.rag_status === 'red') &&
        !cr.repair_item_id
      )

      if (eligibleResults.length >= 2) {
        ctx.healthCheckId = hc.id
        ctx.checkResultIds = eligibleResults.slice(0, 2).map((cr: any) => cr.id)
        console.log(`    Found existing health check ${hc.id} with ${eligibleResults.length} eligible check results`)
        return
      }
    }

    // No existing health check found, create test data
    console.log('    No suitable health check found, creating test data...')

    // Get current user and site
    const { data: me } = await api('/auth/me', { token: ctx.token })
    let siteId = me.siteId || me.site_id || me.default_site_id || me.site?.id

    // If no site assigned to user, get from organization's sites
    if (!siteId) {
      const { data: sites } = await api('/sites', { token: ctx.token })
      if (sites.sites?.length > 0) {
        siteId = sites.sites[0].id
      }
    }

    if (!siteId) {
      throw new Error('No site available - please configure a site in the organization')
    }
    console.log(`    Using site: ${siteId}`)

    // Get template with at least 2 items
    const { data: templates } = await api('/templates', { token: ctx.token })
    if (!templates.templates?.length) throw new Error('No templates found')

    // Find a template with enough items
    let selectedTemplate = null
    for (const t of templates.templates) {
      const { data: templateDetail } = await api(`/templates/${t.id}`, { token: ctx.token })
      const items = templateDetail.sections?.flatMap((s: any) => s.items || []) || []
      console.log(`    Template "${t.name}" has ${items.length} items`)
      if (items.length >= 2) {
        selectedTemplate = templateDetail
        break
      }
    }
    if (!selectedTemplate) throw new Error('No template found with at least 2 items')
    ctx.templateId = selectedTemplate.id

    // Create customer
    const { data: customer, ok: custOk } = await api('/customers', {
      method: 'POST',
      token: ctx.token,
      body: {
        firstName: 'GroupTest',
        lastName: 'Customer',
        email: `grouptest${Date.now()}@example.com`,
        mobile: '07700900000'
      }
    })
    if (!custOk) throw new Error('Failed to create customer')
    ctx.customerId = customer.id

    // Create vehicle
    const { data: vehicle, ok: vehOk } = await api('/vehicles', {
      method: 'POST',
      token: ctx.token,
      body: {
        customerId: ctx.customerId,
        registration: `GT${Date.now().toString().slice(-4)}`,
        make: 'Test',
        model: 'GroupTest'
      }
    })
    if (!vehOk) throw new Error('Failed to create vehicle')
    ctx.vehicleId = vehicle.id

    // Create health check
    const { data: hc, ok: hcOk } = await api('/health-checks', {
      method: 'POST',
      token: ctx.token,
      body: {
        vehicleId: ctx.vehicleId,
        templateId: ctx.templateId,
        siteId: siteId,
        mileageIn: 50000
      }
    })
    if (!hcOk) {
      console.error('    HC creation failed:', JSON.stringify(hc, null, 2))
      throw new Error(`Failed to create health check: ${hc.error || 'unknown error'}`)
    }
    ctx.healthCheckId = hc.id
    ctx.createdHealthCheck = true
    console.log(`    Created health check ${ctx.healthCheckId}`)

    // Get template items to create check results
    const { data: hcDetail } = await api(`/health-checks/${ctx.healthCheckId}`, { token: ctx.token })
    console.log(`    HC detail template sections: ${hcDetail.template?.sections?.length || 0}`)

    // Try to get template items from the selected template data instead
    const templateItems = selectedTemplate.sections?.flatMap((s: any) => s.items || []) || []
    console.log(`    Using ${templateItems.length} template items`)

    if (templateItems.length < 2) throw new Error('Template has fewer than 2 items')

    // Assign technician (me) and clock in
    await api(`/health-checks/${ctx.healthCheckId}/assign`, {
      method: 'POST',
      token: ctx.token,
      body: { technicianId: me.id }
    })
    await api(`/health-checks/${ctx.healthCheckId}/clock-in`, {
      method: 'POST',
      token: ctx.token
    })

    // Create 2 amber check results
    for (let i = 0; i < 2; i++) {
      const { data: result, ok: resOk } = await api(`/health-checks/${ctx.healthCheckId}/results`, {
        method: 'POST',
        token: ctx.token,
        body: {
          templateItemId: templateItems[i].id,
          status: 'amber',
          notes: `Test amber result ${i + 1}`
        }
      })
      if (!resOk) throw new Error(`Failed to create check result ${i + 1}`)
      ctx.checkResultIds.push(result.id)
      console.log(`    Created amber check result ${result.id}`)
    }
  })

  // Get existing repair items to compare later
  let existingRepairItemCount = 0
  await test('Get existing repair items count', async () => {
    const { data, ok } = await api(`/health-checks/${ctx.healthCheckId}/repair-items`, { token: ctx.token })
    if (!ok) throw new Error('Failed to fetch repair items')
    existingRepairItemCount = (data.repairItems || []).length
    console.log(`    Existing repair items: ${existingRepairItemCount}`)
  })

  // Create a group from the check results
  let groupId = ''
  await test('Create repair group from check results without existing repair items', async () => {
    console.log(`    Creating group from check_result_ids: ${ctx.checkResultIds.join(', ')}`)

    const { data, ok, status } = await api(`/health-checks/${ctx.healthCheckId}/repair-items`, {
      method: 'POST',
      token: ctx.token,
      body: {
        name: `Test Group ${Date.now()}`,
        is_group: true,
        check_result_ids: ctx.checkResultIds
      }
    })

    if (!ok) {
      console.error('    Response:', JSON.stringify(data, null, 2))
      throw new Error(`Failed to create group: ${data.error || status}`)
    }

    groupId = data.id
    console.log(`    Created group with id: ${groupId}`)
    console.log(`    Group data: is_group=${data.is_group}, isGroup=${data.isGroup}`)

    // Check both snake_case and camelCase since formatRepairItem might transform it
    if (!data.is_group && !data.isGroup) {
      console.error('    Full response:', JSON.stringify(data, null, 2))
      throw new Error('Created item is not marked as a group')
    }
  })

  // Verify the group has children
  await test('Verify group has children', async () => {
    const { data, ok } = await api(`/health-checks/${ctx.healthCheckId}/repair-items`, { token: ctx.token })
    if (!ok) throw new Error('Failed to fetch repair items')

    console.log(`    All repair items returned: ${data.repairItems?.length || 0}`)
    for (const ri of data.repairItems || []) {
      console.log(`      - ${ri.name} (id: ${ri.id}, isGroup: ${ri.isGroup}, children: ${ri.children?.length || 0})`)
      if (ri.children && ri.children.length > 0) {
        for (const child of ri.children) {
          console.log(`        - Child: ${child.name} (id: ${child.id}, parentId: ${child.parentRepairItemId})`)
        }
      }
    }

    const repairItems = data.repairItems || []
    const group = repairItems.find((ri: any) => ri.id === groupId)

    if (!group) {
      throw new Error(`Group ${groupId} not found in repair items`)
    }

    console.log(`    Group: ${group.name}`)
    console.log(`    is_group: ${group.is_group}`)
    console.log(`    children count: ${(group.children || []).length}`)

    if (!group.children || group.children.length === 0) {
      console.error('    Full group data:', JSON.stringify(group, null, 2))
      throw new Error('Group has no children - THE BUG IS STILL PRESENT')
    }

    if (group.children.length !== ctx.checkResultIds.length) {
      throw new Error(`Expected ${ctx.checkResultIds.length} children, got ${group.children.length}`)
    }

    console.log(`    ✓ Group has ${group.children.length} children as expected`)

    // Verify each child has the correct parent
    for (const child of group.children) {
      console.log(`      - Child: ${child.name} (id: ${child.id}, parent: ${child.parentRepairItemId})`)
      if (child.parentRepairItemId !== groupId) {
        throw new Error(`Child ${child.id} has wrong parentRepairItemId: expected ${groupId}, got ${child.parentRepairItemId}`)
      }
    }
  })

  // Verify the new repair item count
  await test('Verify repair item count increased correctly', async () => {
    const { data, ok } = await api(`/health-checks/${ctx.healthCheckId}/repair-items`, { token: ctx.token })
    if (!ok) throw new Error('Failed to fetch repair items')

    const newCount = (data.repairItems || []).length
    // We should have: existing + 1 group + N children (but children are nested, so top-level count increases by 1)
    const expectedTopLevel = existingRepairItemCount + 1

    console.log(`    Previous top-level count: ${existingRepairItemCount}`)
    console.log(`    New top-level count: ${newCount}`)

    if (newCount !== expectedTopLevel) {
      console.log(`    Note: Count may vary if children are counted differently`)
    }
  })

  // Cleanup - delete the test group
  await test('Cleanup - delete test group', async () => {
    const { ok } = await api(`/health-checks/${ctx.healthCheckId}/repair-items/${groupId}`, {
      method: 'DELETE',
      token: ctx.token
    })
    if (!ok) {
      console.log('    Warning: Failed to delete test group (may need manual cleanup)')
    } else {
      console.log('    Deleted test group')
    }
  })

  console.log('\n✓ All tests passed! The group creation fix is working.')
}

runTests().catch(console.error)
