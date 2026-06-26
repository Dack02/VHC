import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { getStorageUrl, checkQuoteEditable, autoGenerateRepairItems } from './helpers.js'

const checkResults = new Hono()

const VALID_RAG = ['red', 'amber', 'green', 'na'] as const

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

// PATCH /:id/results/:resultId/rag-status - Correct an inspection item's RAG severity
// (e.g. an item marked amber that should be red, or a green item that was actually a fault).
// Advisors/admins only; locked once the quote has been sent unless an admin overrides.
checkResults.patch(
  '/:id/results/:resultId/rag-status',
  authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']),
  async (c) => {
    try {
      const auth = c.get('auth')
      const { id, resultId } = c.req.param()
      const body = await c.req.json().catch(() => ({}))
      const ragStatus = body?.ragStatus ?? body?.rag_status

      if (!ragStatus || !VALID_RAG.includes(ragStatus)) {
        return c.json({ error: `ragStatus must be one of: ${VALID_RAG.join(', ')}` }, 400)
      }

      // Verify health check belongs to org and get its status for the edit-lock
      const { data: healthCheck } = await supabaseAdmin
        .from('health_checks')
        .select('id, status')
        .eq('id', id)
        .eq('organization_id', auth.orgId)
        .single()

      if (!healthCheck) {
        return c.json({ error: 'Health check not found' }, 404)
      }

      // Block severity changes once the quote has been sent (admin can override)
      const gate = checkQuoteEditable(healthCheck.status, auth.user.role, body?.override === true)
      if (!gate.allowed) {
        return c.json({ error: gate.error, code: gate.code }, 403)
      }

      // Ensure the result belongs to THIS health check (check_results has no org column)
      const { data: existing } = await supabaseAdmin
        .from('check_results')
        .select('id, rag_status')
        .eq('id', resultId)
        .eq('health_check_id', id)
        .single()

      if (!existing) {
        return c.json({ error: 'Check result not found' }, 404)
      }

      // Update the severity. The trigger_update_rag_counts DB trigger recomputes the
      // health check's red/amber/green counts automatically on this UPDATE.
      const { data: updated, error } = await supabaseAdmin
        .from('check_results')
        .update({
          rag_status: ragStatus,
          checked_by: auth.user.id,
          checked_at: new Date().toISOString()
        })
        .eq('id', resultId)
        .eq('health_check_id', id)
        .select('id, rag_status')
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }

      // If this item is now red/amber and has no quote line yet, create one so the
      // correction actually surfaces on the customer quote. Idempotent — skips results
      // that already have a linked repair item. Downgrades to green/na leave any existing
      // line in place for the advisor to remove deliberately (it may carry pricing).
      let generated = 0
      if (ragStatus === 'red' || ragStatus === 'amber') {
        const result = await autoGenerateRepairItems(id)
        generated = result.created
      }

      return c.json({
        id: updated.id,
        rag_status: updated.rag_status,
        previousRagStatus: existing.rag_status,
        repairItemsGenerated: generated
      })
    } catch (error) {
      console.error('Update RAG status error:', error)
      return c.json({ error: 'Failed to update RAG status' }, 500)
    }
  }
)

export default checkResults
