import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { isValidTransition } from './helpers.js'
import { notifyHealthCheckStatusChanged } from '../../services/websocket.js'

const advisorAuthorize = new Hono()

// Valid statuses from which advisor can record authorization
const ALLOWED_STATUSES = ['ready_to_send', 'sent', 'delivered', 'opened', 'partial_response', 'expired']

// POST /:id/advisor-authorize - Record customer authorization (advisor action)
advisorAuthorize.post('/:id/advisor-authorize', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const { authorization_method, notes } = body

    // Validate required fields
    if (!authorization_method || !['in_person', 'phone', 'not_sent'].includes(authorization_method)) {
      return c.json({ error: 'authorization_method must be one of: in_person, phone, not_sent' }, 400)
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

    // Validate all top-level, non-deleted repair items already have an outcome
    const { data: allItems } = await supabaseAdmin
      .from('repair_items')
      .select('id, name, outcome_status')
      .eq('health_check_id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)
      .is('parent_repair_item_id', null)

    const hasOutcome = (s: string | null) => ['authorised', 'declined', 'deferred'].includes(s || '')
    const undecidedItems = (allItems || []).filter(i => !hasOutcome(i.outcome_status))

    if (undecidedItems.length > 0) {
      return c.json({
        error: `All repair items must have an outcome before recording authorization. Undecided items: ${undecidedItems.map(i => i.name).join(', ')}`,
        code: 'ITEMS_NOT_DECIDED'
      }, 400)
    }

    const now = new Date().toISOString()

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
    const allOutcomes = (allItems || []).map(i => i.outcome_status)
    const hasAuthorised = allOutcomes.some(s => s === 'authorised')

    let newStatus: string
    if (hasAuthorised) {
      newStatus = 'authorized'
    } else {
      newStatus = 'declined'
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
      authorization_method
    })
  } catch (error) {
    console.error('Advisor authorize error:', error)
    return c.json({ error: 'Failed to record authorization' }, 500)
  }
})

export default advisorAuthorize
