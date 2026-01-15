import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const results = new Hono()

results.use('*', authMiddleware)

// Helper to verify health check access
async function verifyHealthCheckAccess(healthCheckId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, technician_id')
    .eq('id', healthCheckId)
    .eq('organization_id', orgId)
    .single()
  return data
}

// GET /api/v1/health-checks/:id/results - Get all results
results.get('/health-checks/:id/results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { data: checkResults, error } = await supabaseAdmin
      .from('check_results')
      .select(`
        *,
        media:result_media(*),
        template_item:template_items(id, name, item_type, config)
      `)
      .eq('health_check_id', id)
      .order('created_at', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      results: checkResults?.map(r => ({
        id: r.id,
        templateItemId: r.template_item_id,
        template_item_id: r.template_item_id,
        templateItem: r.template_item ? {
          id: r.template_item.id,
          name: r.template_item.name,
          itemType: r.template_item.item_type,
          config: r.template_item.config
        } : null,
        status: r.rag_status,
        rag_status: r.rag_status,
        value: r.value,
        notes: r.notes,
        media: (r.media || []).map((m: Record<string, unknown>) => ({
          id: m.id,
          url: m.url,
          thumbnailUrl: m.thumbnail_url,
          thumbnail_url: m.thumbnail_url,
          caption: m.caption
        })),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    })
  } catch (error) {
    console.error('Get results error:', error)
    return c.json({ error: 'Failed to get results' }, 500)
  }
})

// POST /api/v1/health-checks/:id/results - Save single result
results.post('/health-checks/:id/results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { templateItemId, status, value, notes } = body

    if (!templateItemId) {
      return c.json({ error: 'Template item ID is required' }, 400)
    }

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Check if result already exists for this item
    const { data: existing } = await supabaseAdmin
      .from('check_results')
      .select('id')
      .eq('health_check_id', id)
      .eq('template_item_id', templateItemId)
      .single()

    let result
    if (existing) {
      // Update existing result
      const { data, error } = await supabaseAdmin
        .from('check_results')
        .update({
          rag_status: status,
          value,
          notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      result = data
    } else {
      // Create new result
      const { data, error } = await supabaseAdmin
        .from('check_results')
        .insert({
          health_check_id: id,
          template_item_id: templateItemId,
          rag_status: status,
          value,
          notes
        })
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      result = data
    }

    return c.json({
      id: result.id,
      templateItemId: result.template_item_id,
      status: result.rag_status,
      value: result.value,
      notes: result.notes,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    }, existing ? 200 : 201)
  } catch (error) {
    console.error('Save result error:', error)
    return c.json({ error: 'Failed to save result' }, 500)
  }
})

// POST /api/v1/health-checks/:id/results/batch - Save multiple results
results.post('/health-checks/:id/results/batch', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { results: resultsToSave } = body

    if (!resultsToSave || !Array.isArray(resultsToSave)) {
      return c.json({ error: 'Results array is required' }, 400)
    }

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const savedResults = []
    for (const r of resultsToSave) {
      const { templateItemId, status, value, notes } = r

      // Check if result already exists
      const { data: existing } = await supabaseAdmin
        .from('check_results')
        .select('id')
        .eq('health_check_id', id)
        .eq('template_item_id', templateItemId)
        .single()

      let result
      if (existing) {
        const { data } = await supabaseAdmin
          .from('check_results')
          .update({ rag_status: status, value, notes, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select()
          .single()
        result = data
      } else {
        const { data } = await supabaseAdmin
          .from('check_results')
          .insert({
            health_check_id: id,
            template_item_id: templateItemId,
            rag_status: status,
            value,
            notes
          })
          .select()
          .single()
        result = data
      }

      if (result) {
        savedResults.push({
          id: result.id,
          templateItemId: result.template_item_id,
          status: result.rag_status,
          value: result.value
        })
      }
    }

    return c.json({
      saved: savedResults.length,
      results: savedResults
    })
  } catch (error) {
    console.error('Batch save results error:', error)
    return c.json({ error: 'Failed to save results' }, 500)
  }
})

// PATCH /api/v1/health-checks/:id/results/:resultId - Update result
results.patch('/health-checks/:id/results/:resultId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, resultId } = c.req.param()
    const body = await c.req.json()
    const { status, value, notes } = body

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (status !== undefined) updateData.rag_status = status
    if (value !== undefined) updateData.value = value
    if (notes !== undefined) updateData.notes = notes

    const { data: result, error } = await supabaseAdmin
      .from('check_results')
      .update(updateData)
      .eq('id', resultId)
      .eq('health_check_id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: result.id,
      templateItemId: result.template_item_id,
      status: result.rag_status,
      value: result.value,
      notes: result.notes,
      updatedAt: result.updated_at
    })
  } catch (error) {
    console.error('Update result error:', error)
    return c.json({ error: 'Failed to update result' }, 500)
  }
})

export default results
