import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { emitToSite } from '../../services/websocket.js'

const cards = new Hono()

/**
 * Helper: ensure a tcard_assignment row exists for a health check + date, then return it.
 * Creates one if missing.
 */
async function ensureAssignment(orgId: string, healthCheckId: string, date: string) {
  const { data: existing } = await supabaseAdmin
    .from('tcard_assignments')
    .select('*')
    .eq('health_check_id', healthCheckId)
    .eq('board_date', date)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (existing) return existing

  const { data: created, error } = await supabaseAdmin
    .from('tcard_assignments')
    .insert({
      organization_id: orgId,
      health_check_id: healthCheckId,
      board_date: date,
    })
    .select()
    .single()

  if (error) throw error
  return created
}

/**
 * POST /cards/move — Move card to column (drag-and-drop)
 */
cards.post('/move', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, columnType, technicianId, sortPosition, boardDate } = await c.req.json()

    if (!healthCheckId || !columnType) {
      return c.json({ error: 'healthCheckId and columnType are required' }, 400)
    }

    const date = boardDate || new Date().toISOString().split('T')[0]

    // Upsert assignment
    const { data: assignment, error } = await supabaseAdmin
      .from('tcard_assignments')
      .upsert({
        organization_id: auth.orgId,
        health_check_id: healthCheckId,
        column_type: columnType,
        technician_id: columnType === 'technician' ? technicianId : null,
        sort_position: sortPosition ?? 0,
        board_date: date,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'health_check_id,board_date' })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Also update technician_id on health_check if assigned to a technician
    if (columnType === 'technician' && technicianId) {
      await supabaseAdmin
        .from('health_checks')
        .update({ technician_id: technicianId, updated_at: new Date().toISOString() })
        .eq('id', healthCheckId)
        .eq('organization_id', auth.orgId)
    }

    // Get site_id from the health check for socket emission
    const { data: hc } = await supabaseAdmin
      .from('health_checks')
      .select('site_id')
      .eq('id', healthCheckId)
      .single()

    if (hc?.site_id) {
      emitToSite(hc.site_id, 'tcard:card_moved', {
        healthCheckId,
        columnType,
        technicianId,
        sortPosition,
        movedBy: `${auth.user.firstName} ${auth.user.lastName}`,
      })
    }

    return c.json({
      assignment: {
        id: assignment.id,
        healthCheckId: assignment.health_check_id,
        columnType: assignment.column_type,
        technicianId: assignment.technician_id,
        sortPosition: assignment.sort_position,
        priority: assignment.priority,
        boardDate: assignment.board_date,
      }
    })
  } catch (error) {
    console.error('Move card error:', error)
    return c.json({ error: 'Failed to move card' }, 500)
  }
})

/**
 * PATCH /cards/reorder — Reorder cards within column (MUST be before /:healthCheckId routes)
 */
cards.patch('/reorder', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { cardIds, boardDate } = await c.req.json()

    const date = boardDate || new Date().toISOString().split('T')[0]

    if (!Array.isArray(cardIds)) {
      return c.json({ error: 'cardIds array is required' }, 400)
    }

    const updates = cardIds.map((healthCheckId: string, index: number) =>
      supabaseAdmin
        .from('tcard_assignments')
        .update({ sort_position: index, updated_at: new Date().toISOString() })
        .eq('health_check_id', healthCheckId)
        .eq('board_date', date)
        .eq('organization_id', auth.orgId)
    )

    await Promise.all(updates)

    return c.json({ success: true })
  } catch (error) {
    console.error('Reorder cards error:', error)
    return c.json({ error: 'Failed to reorder cards' }, 500)
  }
})

/**
 * PATCH /cards/:healthCheckId/status — Set tcard job status
 */
cards.patch('/:healthCheckId/status', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const healthCheckId = c.req.param('healthCheckId')
    const { statusId, boardDate } = await c.req.json()

    const date = boardDate || new Date().toISOString().split('T')[0]

    // Ensure assignment exists
    await ensureAssignment(auth.orgId, healthCheckId, date)

    // Update status
    const { data: assignment, error } = await supabaseAdmin
      .from('tcard_assignments')
      .update({
        tcard_status_id: statusId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('health_check_id', healthCheckId)
      .eq('board_date', date)
      .eq('organization_id', auth.orgId)
      .select('id, health_check_id, tcard_status_id')
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Get status details for socket event
    let statusData = null
    if (statusId) {
      const { data: s } = await supabaseAdmin
        .from('tcard_statuses')
        .select('id, name, colour, icon')
        .eq('id', statusId)
        .single()
      statusData = s
    }

    // Emit socket event
    const { data: hc } = await supabaseAdmin
      .from('health_checks')
      .select('site_id')
      .eq('id', healthCheckId)
      .single()

    if (hc?.site_id) {
      emitToSite(hc.site_id, 'tcard:status_changed', {
        healthCheckId,
        statusId,
        statusName: statusData?.name || null,
        statusColour: statusData?.colour || null,
      })
    }

    return c.json({ assignment })
  } catch (error) {
    console.error('Set card status error:', error)
    return c.json({ error: 'Failed to set card status' }, 500)
  }
})

/**
 * PATCH /cards/:healthCheckId/priority — Set priority
 */
cards.patch('/:healthCheckId/priority', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const healthCheckId = c.req.param('healthCheckId')
    const { priority, boardDate } = await c.req.json()

    const date = boardDate || new Date().toISOString().split('T')[0]

    if (!['normal', 'high', 'urgent'].includes(priority)) {
      return c.json({ error: 'Invalid priority. Must be normal, high, or urgent' }, 400)
    }

    // Ensure assignment exists
    await ensureAssignment(auth.orgId, healthCheckId, date)

    // Update priority
    const { data: assignment, error } = await supabaseAdmin
      .from('tcard_assignments')
      .update({
        priority,
        updated_at: new Date().toISOString(),
      })
      .eq('health_check_id', healthCheckId)
      .eq('board_date', date)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    const { data: hc } = await supabaseAdmin
      .from('health_checks')
      .select('site_id')
      .eq('id', healthCheckId)
      .single()

    if (hc?.site_id) {
      emitToSite(hc.site_id, 'tcard:card_updated', {
        healthCheckId,
        changes: { priority },
      })
    }

    return c.json({ assignment })
  } catch (error) {
    console.error('Set card priority error:', error)
    return c.json({ error: 'Failed to set card priority' }, 500)
  }
})

export default cards
