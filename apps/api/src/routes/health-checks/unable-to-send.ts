import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'

const unableToSend = new Hono()

// PATCH /:id/unable-to-send - Record unable to send reason on a health check
unableToSend.patch('/:id/unable-to-send', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const { unable_to_send_reason_id } = body

    if (!unable_to_send_reason_id) {
      return c.json({ error: 'unable_to_send_reason_id is required' }, 400)
    }

    // Get current health check
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Validate the reason belongs to the org and is active
    const { data: reason } = await supabaseAdmin
      .from('unable_to_send_reasons')
      .select('id, reason')
      .eq('id', unable_to_send_reason_id)
      .eq('organization_id', auth.orgId)
      .eq('is_active', true)
      .single()

    if (!reason) {
      return c.json({ error: 'Invalid or inactive unable to send reason' }, 400)
    }

    // Record the reason on the health check (does NOT change status)
    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({
        unable_to_send_reason_id,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      console.error('Record unable to send reason error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      success: true,
      healthCheckId: id,
      reason: reason.reason
    })
  } catch (error) {
    console.error('Unable to send error:', error)
    return c.json({ error: 'Failed to record unable to send reason' }, 500)
  }
})

export default unableToSend
