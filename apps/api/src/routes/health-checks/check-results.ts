import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { getStorageUrl } from './helpers.js'

const checkResults = new Hono()

// GET /:id/results - Get all results for a health check
checkResults.get('/:id/results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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

    const { data: results, error } = await supabaseAdmin
      .from('check_results')
      .select(`
        *,
        media:result_media(*)
      `)
      .eq('health_check_id', id)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      results: results?.map(r => ({
        id: r.id,
        health_check_id: r.health_check_id,
        template_item_id: r.template_item_id,
        rag_status: r.rag_status,
        value: r.value,
        notes: r.notes,
        media: r.media?.map((m: Record<string, unknown>) => {
          const url = m.storage_path ? getStorageUrl(m.storage_path as string) : null
          return {
            id: m.id,
            url,
            thumbnail_url: url ? `${url}?width=200&height=200` : null,
            annotation_data: m.annotation_data,
            include_in_report: m.include_in_report !== false
          }
        })
      }))
    })
  } catch (error) {
    console.error('Get results error:', error)
    return c.json({ error: 'Failed to get results' }, 500)
  }
})

export default checkResults
