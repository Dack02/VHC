import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { verifyHealthCheckAccess } from './helpers.js'

const workflowRouter = new Hono()

// GET /health-checks/:id/workflow-status - Get aggregated workflow status for health check
workflowRouter.get('/health-checks/:id/workflow-status', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get sent_at from health check
    const { data: hcData } = await supabaseAdmin
      .from('health_checks')
      .select('sent_at')
      .eq('id', id)
      .single()

    // Get all repair items with their statuses
    const { data: repairItems, error } = await supabaseAdmin
      .from('repair_items')
      .select('labour_status, parts_status, quote_status')
      .eq('health_check_id', id)

    if (error) {
      console.error('Get workflow status error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Calculate aggregated status
    let labourStatus: 'pending' | 'in_progress' | 'complete' | 'na' = 'na'
    let partsStatus: 'pending' | 'in_progress' | 'complete' | 'na' = 'na'
    let quoteStatus: 'pending' | 'ready' | 'na' = 'na'
    const sentStatus: 'pending' | 'complete' | 'na' = hcData?.sent_at ? 'complete' : 'na'

    if (repairItems && repairItems.length > 0) {
      // Labour status aggregation
      const labourComplete = repairItems.every(i => i.labour_status === 'complete')
      const labourStarted = repairItems.some(i =>
        i.labour_status === 'in_progress' || i.labour_status === 'complete'
      )
      labourStatus = labourComplete ? 'complete' : labourStarted ? 'in_progress' : 'pending'

      // Parts status aggregation
      const partsComplete = repairItems.every(i => i.parts_status === 'complete')
      const partsStarted = repairItems.some(i =>
        i.parts_status === 'in_progress' || i.parts_status === 'complete'
      )
      partsStatus = partsComplete ? 'complete' : partsStarted ? 'in_progress' : 'pending'

      // Quote status aggregation
      const quoteReady = repairItems.every(i => i.quote_status === 'ready')
      quoteStatus = quoteReady ? 'ready' : 'pending'
    }

    return c.json({
      labour_status: labourStatus,
      parts_status: partsStatus,
      quote_status: quoteStatus === 'ready' ? 'complete' : quoteStatus === 'pending' ? 'pending' : 'na',
      sent_status: sentStatus,
      repair_item_count: repairItems?.length || 0
    })
  } catch (error) {
    console.error('Get workflow status error:', error)
    return c.json({ error: 'Failed to get workflow status' }, 500)
  }
})

// GET /health-checks/:id/unassigned-check-results - Get check results not linked to any repair item
workflowRouter.get('/health-checks/:id/unassigned-check-results', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const includeGreen = c.req.query('include_green') === 'true'

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // For now, get linked check result IDs via repair_items
    const { data: repairItemsData } = await supabaseAdmin
      .from('repair_items')
      .select('id')
      .eq('health_check_id', id)

    const repairItemIds = repairItemsData?.map(ri => ri.id) || []

    let linkedCheckResultIds: string[] = []
    if (repairItemIds.length > 0) {
      const { data: links } = await supabaseAdmin
        .from('repair_item_check_results')
        .select('check_result_id')
        .in('repair_item_id', repairItemIds)

      linkedCheckResultIds = links?.map(l => l.check_result_id) || []
    }

    // Build query for unassigned check results
    let query = supabaseAdmin
      .from('check_results')
      .select(`
        id,
        rag_status,
        notes,
        is_mot_failure,
        template_item:template_items(id, name, description)
      `)
      .eq('health_check_id', id)

    // Filter by status
    if (includeGreen) {
      query = query.in('rag_status', ['red', 'amber', 'green'])
    } else {
      query = query.in('rag_status', ['red', 'amber'])
    }

    // Exclude already linked results
    if (linkedCheckResultIds.length > 0) {
      query = query.not('id', 'in', `(${linkedCheckResultIds.join(',')})`)
    }

    const { data: results, error } = await query

    if (error) {
      console.error('Get unassigned check results error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      checkResults: (results || []).map(cr => {
        // Supabase returns joined tables as arrays, access first element
        const templateItem = Array.isArray(cr.template_item) ? cr.template_item[0] : cr.template_item
        return {
          id: cr.id,
          ragStatus: cr.rag_status,
          notes: cr.notes,
          isMotFailure: cr.is_mot_failure,
          templateItem: templateItem ? {
            id: templateItem.id,
            name: templateItem.name,
            description: templateItem.description
          } : null
        }
      })
    })
  } catch (error) {
    console.error('Get unassigned check results error:', error)
    return c.json({ error: 'Failed to get unassigned check results' }, 500)
  }
})

export default workflowRouter
