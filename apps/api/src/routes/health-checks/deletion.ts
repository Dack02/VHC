import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { isValidTransition, DELETION_REASONS, type DeletionReason } from './helpers.js'

const deletion = new Hono()

// DELETE /:id - Cancel health check
deletion.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get current status
    const { data: current } = await supabaseAdmin
      .from('health_checks')
      .select('status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    if (!isValidTransition(current.status, 'cancelled')) {
      return c.json({ error: `Cannot cancel health check in ${current.status} status` }, 400)
    }

    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record status change
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: current.status,
        to_status: 'cancelled',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: 'Health check cancelled'
      })

    return c.json({ message: 'Health check cancelled' })
  } catch (error) {
    console.error('Cancel health check error:', error)
    return c.json({ error: 'Failed to cancel health check' }, 500)
  }
})

// POST /:id/delete - Soft delete with reason
deletion.post('/:id/delete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { reason, notes } = body as { reason: DeletionReason; notes?: string }

    // Validate reason
    if (!reason || !DELETION_REASONS.includes(reason)) {
      return c.json({
        error: 'Invalid deletion reason',
        valid_reasons: DELETION_REASONS
      }, 400)
    }

    // Require notes for 'other' reason
    if (reason === 'other' && (!notes || notes.trim().length === 0)) {
      return c.json({ error: 'Notes are required when reason is "other"' }, 400)
    }

    // Get health check
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, deleted_at')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    if (healthCheck.deleted_at) {
      return c.json({ error: 'Health check is already deleted' }, 400)
    }

    // Only allow deletion of certain statuses
    const deletableStatuses = ['created', 'assigned', 'cancelled']
    if (!deletableStatuses.includes(healthCheck.status)) {
      return c.json({
        error: `Cannot delete health check in "${healthCheck.status}" status. Only "${deletableStatuses.join('", "')}" can be deleted.`
      }, 400)
    }

    // Soft delete
    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: auth.user.id,
        deletion_reason: reason,
        deletion_notes: notes?.trim() || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record in status history
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: healthCheck.status,
        to_status: 'deleted',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: `Deleted: ${reason}${notes ? ` - ${notes}` : ''}`
      })

    return c.json({
      success: true,
      message: 'Health check deleted',
      reason
    })
  } catch (error) {
    console.error('Delete health check error:', error)
    return c.json({ error: 'Failed to delete health check' }, 500)
  }
})

// POST /bulk-delete - Bulk soft delete with reason
deletion.post('/bulk-delete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { ids, reason, notes } = body as {
      ids: string[]
      reason: DeletionReason
      notes?: string
    }

    // Validate inputs
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'ids array is required' }, 400)
    }

    if (ids.length > 100) {
      return c.json({ error: 'Maximum 100 health checks per bulk delete' }, 400)
    }

    if (!reason || !DELETION_REASONS.includes(reason)) {
      return c.json({
        error: 'Invalid deletion reason',
        valid_reasons: DELETION_REASONS
      }, 400)
    }

    if (reason === 'other' && (!notes || notes.trim().length === 0)) {
      return c.json({ error: 'Notes are required when reason is "other"' }, 400)
    }

    // Get health checks
    const { data: healthChecks } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, deleted_at')
      .in('id', ids)
      .eq('organization_id', auth.orgId)

    if (!healthChecks || healthChecks.length === 0) {
      return c.json({ error: 'No health checks found' }, 404)
    }

    // Filter to only deletable ones
    const deletableStatuses = ['created', 'assigned', 'cancelled']
    const deletable = healthChecks.filter(hc =>
      !hc.deleted_at && deletableStatuses.includes(hc.status)
    )
    const skipped = healthChecks.filter(hc =>
      hc.deleted_at || !deletableStatuses.includes(hc.status)
    )

    if (deletable.length === 0) {
      return c.json({
        error: 'No health checks can be deleted',
        skipped: skipped.length
      }, 400)
    }

    const deletableIds = deletable.map(hc => hc.id)

    // Bulk soft delete
    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: auth.user.id,
        deletion_reason: reason,
        deletion_notes: notes?.trim() || null,
        updated_at: new Date().toISOString()
      })
      .in('id', deletableIds)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record in status history for each
    const historyRecords = deletable.map(hc => ({
      health_check_id: hc.id,
      from_status: hc.status,
      to_status: 'deleted',
      changed_by: auth.user.id,
      change_source: 'user',
      notes: `Bulk deleted: ${reason}${notes ? ` - ${notes}` : ''}`
    }))

    await supabaseAdmin
      .from('health_check_status_history')
      .insert(historyRecords)

    return c.json({
      success: true,
      message: `${deletable.length} health check(s) deleted`,
      deleted: deletable.length,
      skipped: skipped.length,
      reason
    })
  } catch (error) {
    console.error('Bulk delete health checks error:', error)
    return c.json({ error: 'Failed to bulk delete health checks' }, 500)
  }
})

// POST /:id/restore - Restore a soft-deleted health check
deletion.post('/:id/restore', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get health check
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, deleted_at, deletion_reason')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    if (!healthCheck.deleted_at) {
      return c.json({ error: 'Health check is not deleted' }, 400)
    }

    // Restore
    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({
        deleted_at: null,
        deleted_by: null,
        deletion_reason: null,
        deletion_notes: null,
        status: 'created',  // Reset to created status
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record in status history
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: 'deleted',
        to_status: 'created',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: 'Health check restored'
      })

    return c.json({
      success: true,
      message: 'Health check restored'
    })
  } catch (error) {
    console.error('Restore health check error:', error)
    return c.json({ error: 'Failed to restore health check' }, 500)
  }
})

export default deletion
