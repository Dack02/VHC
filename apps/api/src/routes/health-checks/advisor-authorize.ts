import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { isValidTransition } from './helpers.js'
import { notifyHealthCheckStatusChanged } from '../../services/websocket.js'

const advisorAuthorize = new Hono()

// Valid statuses from which advisor can record authorization
const ALLOWED_STATUSES = ['tech_completed', 'ready_to_send', 'sent', 'delivered', 'opened', 'partial_response', 'expired']

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

    // Fetch ALL non-deleted repair items (top-level + children) with their check results
    const { data: allItems } = await supabaseAdmin
      .from('repair_items')
      .select(`
        id, name, outcome_status, is_group, parent_repair_item_id,
        check_results:repair_item_check_results(
          check_result:check_results(rag_status)
        )
      `)
      .eq('health_check_id', id)
      .eq('organization_id', auth.orgId)
      .is('deleted_at', null)

    const topLevelItems = (allItems || []).filter(i => !i.parent_repair_item_id)
    const childItems = (allItems || []).filter(i => i.parent_repair_item_id)

    const hasOutcome = (s: string | null) => ['authorised', 'declined', 'deferred'].includes(s || '')

    // Check if an item has red/amber check results (needs authorization)
    const hasRedAmberResults = (item: typeof topLevelItems[0]): boolean => {
      if (item.check_results && item.check_results.length > 0) {
        return item.check_results.some((cr: Record<string, unknown>) => {
          const result = cr.check_result as Record<string, unknown> | null
          return result?.rag_status === 'red' || result?.rag_status === 'amber'
        })
      }
      return false
    }

    // An item is in the auth flow if it has red/amber findings, a decided outcome,
    // or is a group with children that need authorization
    const isItemInAuthFlow = (item: typeof topLevelItems[0]): boolean => {
      if (hasOutcome(item.outcome_status)) return true
      if (!item.is_group) return hasRedAmberResults(item)
      if (hasRedAmberResults(item)) return true
      const children = childItems.filter(c => c.parent_repair_item_id === item.id)
      return children.some(c => hasOutcome(c.outcome_status) || c.outcome_status === 'ready' || c.outcome_status === 'incomplete')
    }

    // For groups, derive outcome from children
    const getEffectiveOutcome = (item: typeof topLevelItems[0]): string | null => {
      if (hasOutcome(item.outcome_status)) return item.outcome_status
      if (item.is_group) {
        const children = childItems.filter(c => c.parent_repair_item_id === item.id)
        const activeChildren = children.filter(c => hasOutcome(c.outcome_status) || c.outcome_status === 'ready' || c.outcome_status === 'incomplete')
        if (activeChildren.length > 0 && activeChildren.every(c => hasOutcome(c.outcome_status))) {
          if (activeChildren.some(c => c.outcome_status === 'authorised')) return 'authorised'
          if (activeChildren.some(c => c.outcome_status === 'deferred')) return 'deferred'
          return 'declined'
        }
        if (activeChildren.length === 0) return null
      }
      if (!isItemInAuthFlow(item)) return null
      return item.outcome_status
    }

    // Only require decisions for items actually in the authorization flow
    const itemsInAuthFlow = topLevelItems.filter(i => isItemInAuthFlow(i))
    const undecidedItems = itemsInAuthFlow.filter(i => !hasOutcome(getEffectiveOutcome(i)))

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

    // Calculate new HC status from effective outcomes (only items in auth flow)
    const effectiveOutcomes = itemsInAuthFlow.map(i => getEffectiveOutcome(i))
    const hasAuthorised = effectiveOutcomes.some(s => s === 'authorised')

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
