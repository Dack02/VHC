import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { isValidTransition } from './helpers.js'
import { notifyHealthCheckStatusChanged } from '../../services/websocket.js'

const advisorAuthorize = new Hono()

// Valid statuses from which advisor can record authorization
const ALLOWED_STATUSES = ['ready_to_send', 'sent', 'delivered', 'opened', 'partial_response', 'expired']

// POST /:id/advisor-authorize - Record customer authorization decisions (advisor action)
advisorAuthorize.post('/:id/advisor-authorize', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const { items, authorization_method, notes } = body

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ error: 'Items array is required and must not be empty' }, 400)
    }

    if (!authorization_method || !['in_person', 'phone', 'not_sent'].includes(authorization_method)) {
      return c.json({ error: 'authorization_method must be one of: in_person, phone, not_sent' }, 400)
    }

    // Validate each item has required fields
    for (const item of items) {
      if (!item.repair_item_id || !item.decision) {
        return c.json({ error: 'Each item must have repair_item_id and decision' }, 400)
      }
      if (!['authorise', 'decline', 'defer'].includes(item.decision)) {
        return c.json({ error: `Invalid decision "${item.decision}". Must be: authorise, decline, defer` }, 400)
      }
    }

    // Get current health check
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id, status, site_id,
        vehicle:vehicles(registration)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Check status is valid for advisor authorization
    if (!ALLOWED_STATUSES.includes(healthCheck.status)) {
      return c.json({
        error: `Cannot record authorization when status is "${healthCheck.status}". Allowed statuses: ${ALLOWED_STATUSES.join(', ')}`,
        code: 'INVALID_STATUS'
      }, 400)
    }

    // Verify all repair_item_ids belong to this health check and org
    const itemIds = items.map((i: { repair_item_id: string }) => i.repair_item_id)
    const { data: repairItems } = await supabaseAdmin
      .from('repair_items')
      .select('id')
      .eq('health_check_id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .is('parent_repair_item_id', null)
      .in('id', itemIds)

    const foundIds = new Set(repairItems?.map(r => r.id) || [])
    const missingIds = itemIds.filter((itemId: string) => !foundIds.has(itemId))

    if (missingIds.length > 0) {
      return c.json({
        error: `Repair items not found or do not belong to this health check: ${missingIds.join(', ')}`,
        code: 'INVALID_ITEMS'
      }, 400)
    }

    // Update each repair item
    const now = new Date().toISOString()

    for (const item of items) {
      const updateData: Record<string, unknown> = {
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        outcome_source: 'manual',
        updated_at: now
      }

      switch (item.decision) {
        case 'authorise':
          updateData.outcome_status = 'authorised'
          break
        case 'decline':
          updateData.outcome_status = 'declined'
          if (item.declined_reason_id) {
            updateData.declined_reason_id = item.declined_reason_id
          }
          if (item.declined_notes) {
            updateData.declined_notes = item.declined_notes
          }
          break
        case 'defer':
          updateData.outcome_status = 'deferred'
          if (item.deferred_until) {
            updateData.deferred_until = item.deferred_until
          }
          if (item.deferred_notes) {
            updateData.deferred_notes = item.deferred_notes
          }
          break
      }

      await supabaseAdmin
        .from('repair_items')
        .update(updateData)
        .eq('id', item.repair_item_id)
        .eq('health_check_id', id)
        .eq('organization_id', auth.orgId)
    }

    // Update authorization_method on health check
    await supabaseAdmin
      .from('health_checks')
      .update({
        authorization_method,
        updated_at: now
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    // Calculate new HC status from all item outcomes
    const { data: allItems } = await supabaseAdmin
      .from('repair_items')
      .select('id, outcome_status')
      .eq('health_check_id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .is('parent_repair_item_id', null)

    const allOutcomes = (allItems || []).map(i => i.outcome_status)
    const hasOutcome = (s: string | null) => ['authorised', 'declined', 'deferred'].includes(s || '')
    const allHaveOutcomes = allOutcomes.every(hasOutcome)
    const hasAuthorised = allOutcomes.some(s => s === 'authorised')

    let newStatus: string
    if (allHaveOutcomes && hasAuthorised) {
      newStatus = 'authorized'
    } else if (allHaveOutcomes) {
      newStatus = 'declined'
    } else {
      newStatus = 'partial_response'
    }

    // Transition HC status if valid
    if (isValidTransition(healthCheck.status, newStatus)) {
      await supabaseAdmin
        .from('health_checks')
        .update({
          status: newStatus,
          updated_at: now
        })
        .eq('id', id)
        .eq('organization_id', auth.orgId)

      // Record status change
      const historyNotes = notes
        ? `Advisor recorded authorization (${authorization_method}): ${notes}`
        : `Advisor recorded authorization (${authorization_method})`

      await supabaseAdmin
        .from('health_check_status_history')
        .insert({
          health_check_id: id,
          from_status: healthCheck.status,
          to_status: newStatus,
          changed_by: auth.user.id,
          change_source: 'user',
          notes: historyNotes
        })

      // WebSocket notification
      if (healthCheck.site_id) {
        const vehicleReg = (healthCheck.vehicle as unknown as { registration: string })?.registration || 'Unknown'
        notifyHealthCheckStatusChanged(healthCheck.site_id, id, {
          status: newStatus,
          previousStatus: healthCheck.status,
          vehicleReg,
          updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
        })
      }
    }

    return c.json({
      success: true,
      healthCheckId: id,
      status: newStatus,
      previousStatus: healthCheck.status,
      authorization_method,
      items_updated: items.length
    })
  } catch (error) {
    console.error('Advisor authorize error:', error)
    return c.json({ error: 'Failed to record authorization' }, 500)
  }
})

export default advisorAuthorize
