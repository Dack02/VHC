import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const repairItems = new Hono()

repairItems.use('*', authMiddleware)

// Helper to verify health check access
async function verifyHealthCheckAccess(healthCheckId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('health_checks')
    .select('id, status')
    .eq('id', healthCheckId)
    .eq('organization_id', orgId)
    .single()
  return data
}

// Helper to recalculate health check totals
async function recalculateTotals(healthCheckId: string) {
  const { data: items } = await supabaseAdmin
    .from('repair_items')
    .select('labour_cost, parts_cost, total_cost')
    .eq('health_check_id', healthCheckId)

  const totalLabour = items?.reduce((sum, i) => sum + (i.labour_cost || 0), 0) || 0
  const totalParts = items?.reduce((sum, i) => sum + (i.parts_cost || 0), 0) || 0
  const totalAmount = items?.reduce((sum, i) => sum + (i.total_cost || 0), 0) || 0

  await supabaseAdmin
    .from('health_checks')
    .update({
      total_labour: totalLabour,
      total_parts: totalParts,
      total_amount: totalAmount,
      updated_at: new Date().toISOString()
    })
    .eq('id', healthCheckId)
}

// GET /api/v1/health-checks/:id/repair-items - List repair items
repairItems.get('/health-checks/:id/repair-items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { data: items, error } = await supabaseAdmin
      .from('repair_items')
      .select(`
        *,
        check_result:check_results(
          id,
          status,
          template_item:template_items(id, name)
        )
      `)
      .eq('health_check_id', id)
      .order('sort_order', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      repairItems: items?.map(item => ({
        id: item.id,
        description: item.description,
        labourCost: item.labour_cost,
        partsCost: item.parts_cost,
        totalCost: item.total_cost,
        isAuthorized: item.is_authorized,
        sortOrder: item.sort_order,
        checkResult: item.check_result ? {
          id: item.check_result.id,
          status: item.check_result.status,
          templateItem: item.check_result.template_item ? {
            id: item.check_result.template_item.id,
            name: item.check_result.template_item.name
          } : null
        } : null,
        createdAt: item.created_at
      }))
    })
  } catch (error) {
    console.error('Get repair items error:', error)
    return c.json({ error: 'Failed to get repair items' }, 500)
  }
})

// POST /api/v1/health-checks/:id/repair-items - Add repair item
repairItems.post('/health-checks/:id/repair-items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { description, labourCost, partsCost, checkResultId } = body

    if (!description) {
      return c.json({ error: 'Description is required' }, 400)
    }

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get max sort order
    const { data: maxOrderResult } = await supabaseAdmin
      .from('repair_items')
      .select('sort_order')
      .eq('health_check_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const sortOrder = (maxOrderResult?.sort_order || 0) + 1
    const totalCost = (labourCost || 0) + (partsCost || 0)

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .insert({
        health_check_id: id,
        check_result_id: checkResultId,
        description,
        labour_cost: labourCost || 0,
        parts_cost: partsCost || 0,
        total_cost: totalCost,
        sort_order: sortOrder,
        is_authorized: false
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Recalculate totals
    await recalculateTotals(id)

    return c.json({
      id: item.id,
      description: item.description,
      labourCost: item.labour_cost,
      partsCost: item.parts_cost,
      totalCost: item.total_cost,
      isAuthorized: item.is_authorized,
      sortOrder: item.sort_order,
      createdAt: item.created_at
    }, 201)
  } catch (error) {
    console.error('Add repair item error:', error)
    return c.json({ error: 'Failed to add repair item' }, 500)
  }
})

// PATCH /api/v1/health-checks/:id/repair-items/:itemId - Update repair item
repairItems.patch('/health-checks/:id/repair-items/:itemId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, itemId } = c.req.param()
    const body = await c.req.json()
    const { description, labourCost, partsCost, isAuthorized } = body

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get current item to calculate new total
    const { data: current } = await supabaseAdmin
      .from('repair_items')
      .select('labour_cost, parts_cost')
      .eq('id', itemId)
      .eq('health_check_id', id)
      .single()

    if (!current) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const newLabour = labourCost !== undefined ? labourCost : current.labour_cost
    const newParts = partsCost !== undefined ? partsCost : current.parts_cost
    const totalCost = newLabour + newParts

    const updateData: Record<string, unknown> = {
      total_cost: totalCost,
      updated_at: new Date().toISOString()
    }
    if (description !== undefined) updateData.description = description
    if (labourCost !== undefined) updateData.labour_cost = labourCost
    if (partsCost !== undefined) updateData.parts_cost = partsCost
    if (isAuthorized !== undefined) updateData.is_authorized = isAuthorized

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('health_check_id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Recalculate totals
    await recalculateTotals(id)

    return c.json({
      id: item.id,
      description: item.description,
      labourCost: item.labour_cost,
      partsCost: item.parts_cost,
      totalCost: item.total_cost,
      isAuthorized: item.is_authorized,
      updatedAt: item.updated_at
    })
  } catch (error) {
    console.error('Update repair item error:', error)
    return c.json({ error: 'Failed to update repair item' }, 500)
  }
})

// DELETE /api/v1/health-checks/:id/repair-items/:itemId - Remove repair item
repairItems.delete('/health-checks/:id/repair-items/:itemId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, itemId } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('repair_items')
      .delete()
      .eq('id', itemId)
      .eq('health_check_id', id)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Recalculate totals
    await recalculateTotals(id)

    return c.json({ message: 'Repair item deleted' })
  } catch (error) {
    console.error('Delete repair item error:', error)
    return c.json({ error: 'Failed to delete repair item' }, 500)
  }
})

// POST /api/v1/health-checks/:id/repair-items/reorder - Reorder repair items
repairItems.post('/health-checks/:id/repair-items/reorder', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { itemIds } = body

    if (!itemIds || !Array.isArray(itemIds)) {
      return c.json({ error: 'itemIds array is required' }, 400)
    }

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Update sort orders
    for (let i = 0; i < itemIds.length; i++) {
      await supabaseAdmin
        .from('repair_items')
        .update({ sort_order: i + 1 })
        .eq('id', itemIds[i])
        .eq('health_check_id', id)
    }

    return c.json({ message: 'Repair items reordered' })
  } catch (error) {
    console.error('Reorder repair items error:', error)
    return c.json({ error: 'Failed to reorder repair items' }, 500)
  }
})

// POST /api/v1/health-checks/:id/repair-items/generate - Auto-generate from red/amber results
repairItems.post('/health-checks/:id/repair-items/generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get all red and amber results that don't have repair items
    const { data: results, error: resultsError } = await supabaseAdmin
      .from('check_results')
      .select(`
        id,
        status,
        notes,
        template_item:template_items(id, name)
      `)
      .eq('health_check_id', id)
      .in('status', ['red', 'amber'])

    if (resultsError) {
      return c.json({ error: resultsError.message }, 500)
    }

    // Get existing repair items to avoid duplicates
    const { data: existingItems } = await supabaseAdmin
      .from('repair_items')
      .select('check_result_id')
      .eq('health_check_id', id)

    const existingResultIds = new Set(existingItems?.map(i => i.check_result_id) || [])

    // Get max sort order
    const { data: maxOrderResult } = await supabaseAdmin
      .from('repair_items')
      .select('sort_order')
      .eq('health_check_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    let sortOrder = (maxOrderResult?.sort_order || 0)

    const generatedItems = []
    for (const result of results || []) {
      // Skip if repair item already exists for this result
      if (existingResultIds.has(result.id)) continue

      sortOrder++
      const itemName = result.template_item?.name || 'Unknown Item'
      const description = result.status === 'red'
        ? `URGENT: ${itemName} requires immediate attention`
        : `Advisory: ${itemName} - recommended repair/replacement`

      const { data: item, error: itemError } = await supabaseAdmin
        .from('repair_items')
        .insert({
          health_check_id: id,
          check_result_id: result.id,
          description,
          labour_cost: 0,
          parts_cost: 0,
          total_cost: 0,
          sort_order: sortOrder,
          is_authorized: false
        })
        .select()
        .single()

      if (!itemError && item) {
        generatedItems.push({
          id: item.id,
          description: item.description,
          checkResultId: result.id,
          status: result.status
        })
      }
    }

    return c.json({
      generated: generatedItems.length,
      items: generatedItems
    })
  } catch (error) {
    console.error('Generate repair items error:', error)
    return c.json({ error: 'Failed to generate repair items' }, 500)
  }
})

export default repairItems
