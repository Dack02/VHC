import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { notifyHealthCheckStatusChanged } from '../../services/websocket.js'

const reopen = new Hono()

// In-flight states a wrongly-started check can be reset FROM. Deliberately excludes
// anything already sent to the customer (those are handled by the admin edit-override,
// not by a destructive reset) and the arrival/check-in states (nothing to clear yet).
const REOPENABLE_STATUSES = new Set([
  'assigned', 'in_progress', 'paused',
  'tech_completed', 'awaiting_review', 'awaiting_pricing', 'awaiting_parts', 'ready_to_send'
])

/**
 * POST /:id/reopen - Reset a wrongly-started health check back into the system.
 *
 * For when a technician starts the wrong VHC. Clears the inspection results, their
 * photos and the auto-generated quote lines, unassigns the technician, and sends the
 * check back to `created` so it can be started fresh.
 *
 * Deliberately KEEPS: clocked time entries (audit of where time actually went) and any
 * check-in / MRI data (the check lands back in `created`, i.e. post-check-in).
 *
 * Advisors and admins only. Not available once the quote has been sent.
 */
reopen.post('/:id/reopen', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null

    // Load the check (org-scoped) with what we need for guards + notification
    const { data: current } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id, status, site_id, technician_id,
        vehicle:vehicles(registration)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    if (!REOPENABLE_STATUSES.has(current.status)) {
      return c.json({
        error: `Cannot reopen a health check with status '${current.status}'. Reopen is only available before a quote has been sent to the customer.`,
        code: 'NOT_REOPENABLE'
      }, 400)
    }

    // Clear the auto-generated quote lines. Deleting repair_items cascades to the
    // repair_item_check_results junction, options and child rows.
    const { error: itemsError } = await supabaseAdmin
      .from('repair_items')
      .delete()
      .eq('health_check_id', id)
    if (itemsError) {
      console.error('Reopen: failed to clear repair items:', itemsError)
      return c.json({ error: 'Failed to clear repair items' }, 500)
    }

    // Clear the inspection results. Deleting check_results cascades to result_media.
    const { error: resultsError } = await supabaseAdmin
      .from('check_results')
      .delete()
      .eq('health_check_id', id)
    if (resultsError) {
      console.error('Reopen: failed to clear check results:', resultsError)
      return c.json({ error: 'Failed to clear inspection results' }, 500)
    }

    // Send the check back to a clean, unassigned `created` state. Keep the clocked time
    // entries — they record where the tech's time actually went and stay for audit.
    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update({
        status: 'created',
        technician_id: null,
        tech_started_at: null,
        tech_completed_at: null,
        updated_at: now
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select('id, status')
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    // Record the reset in the status history
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: current.status,
        to_status: 'created',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: reason
          ? `Health check reopened/reset by ${auth.user.firstName} ${auth.user.lastName}: ${reason}`
          : `Health check reopened/reset by ${auth.user.firstName} ${auth.user.lastName} (inspection cleared, technician unassigned)`
      })

    // Notify the board in real time
    if (current.site_id) {
      const vehicleReg = (current.vehicle as unknown as { registration?: string })?.registration || 'Unknown'
      notifyHealthCheckStatusChanged(current.site_id, id, {
        status: 'created',
        previousStatus: current.status,
        vehicleReg,
        updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
      })
    }

    return c.json({
      id: updated.id,
      status: updated.status,
      previousStatus: current.status
    })
  } catch (error) {
    console.error('Reopen health check error:', error)
    return c.json({ error: 'Failed to reopen health check' }, 500)
  }
})

export default reopen
