import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'

const history = new Hono()

// GET /:id/history - Get status history
history.get('/:id/history', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { data: historyData, error } = await supabaseAdmin
      .from('health_check_status_history')
      .select(`
        *,
        user:users(id, first_name, last_name)
      `)
      .eq('health_check_id', id)
      .order('changed_at', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      history: historyData?.map(h => ({
        id: h.id,
        health_check_id: h.health_check_id,
        from_status: h.from_status,
        to_status: h.to_status,
        changed_by: h.changed_by,
        notes: h.notes,
        created_at: h.changed_at,
        user: h.user ? {
          first_name: h.user.first_name,
          last_name: h.user.last_name
        } : null
      }))
    })
  } catch (error) {
    console.error('Get history error:', error)
    return c.json({ error: 'Failed to get status history' }, 500)
  }
})

export default history
