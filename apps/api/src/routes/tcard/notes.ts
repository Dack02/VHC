import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { emitToSite } from '../../services/websocket.js'

const notes = new Hono()

/**
 * GET /notes/:healthCheckId — Get notes for a health check
 */
notes.get('/:healthCheckId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const healthCheckId = c.req.param('healthCheckId')

    const { data, error } = await supabaseAdmin
      .from('tcard_notes')
      .select(`
        id, content, created_at,
        user:users(id, first_name, last_name)
      `)
      .eq('health_check_id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      notes: (data || []).map(n => ({
        id: n.id,
        content: n.content,
        createdAt: n.created_at,
        user: n.user ? {
          id: (n.user as any).id,
          firstName: (n.user as any).first_name,
          lastName: (n.user as any).last_name,
        } : null,
      }))
    })
  } catch (error) {
    console.error('Get notes error:', error)
    return c.json({ error: 'Failed to get notes' }, 500)
  }
})

/**
 * POST /notes — Add note to a health check
 */
notes.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, content } = await c.req.json()

    if (!healthCheckId || !content) {
      return c.json({ error: 'healthCheckId and content are required' }, 400)
    }

    if (content.length > 500) {
      return c.json({ error: 'Note content must be 500 characters or less' }, 400)
    }

    const { data: note, error } = await supabaseAdmin
      .from('tcard_notes')
      .insert({
        organization_id: auth.orgId,
        health_check_id: healthCheckId,
        user_id: auth.user.id,
        content,
      })
      .select('id, content, created_at, user_id')
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Emit socket event
    const { data: hc } = await supabaseAdmin
      .from('health_checks')
      .select('site_id')
      .eq('id', healthCheckId)
      .single()

    if (hc?.site_id) {
      emitToSite(hc.site_id, 'tcard:note_added', {
        healthCheckId,
        note: {
          id: note.id,
          content: note.content,
          createdAt: note.created_at,
        },
        userName: `${auth.user.firstName} ${auth.user.lastName}`,
      })
    }

    return c.json({
      note: {
        id: note.id,
        content: note.content,
        createdAt: note.created_at,
        user: {
          id: auth.user.id,
          firstName: auth.user.firstName,
          lastName: auth.user.lastName,
        },
      }
    }, 201)
  } catch (error) {
    console.error('Create note error:', error)
    return c.json({ error: 'Failed to create note' }, 500)
  }
})

export default notes
