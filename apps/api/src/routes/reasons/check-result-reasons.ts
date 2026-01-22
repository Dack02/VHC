/**
 * Check Result Reasons Routes
 *
 * Handles the association between check results and reasons,
 * including batch operations, overrides, and customer approvals.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { extractRelation, formatCheckResultReasonResponse, getOrgIdFromCheckResult } from './helpers.js'

const checkResultReasons = new Hono()

// POST /api/v1/check-results/batch-reasons - Get reasons for multiple check results at once
// This is more efficient than making individual requests for each check result
checkResultReasons.post('/check-results/batch-reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { checkResultIds } = body

    if (!checkResultIds || !Array.isArray(checkResultIds) || checkResultIds.length === 0) {
      return c.json({ error: 'checkResultIds array is required' }, 400)
    }

    // Limit batch size to prevent abuse
    if (checkResultIds.length > 100) {
      return c.json({ error: 'Maximum 100 check results per batch' }, 400)
    }

    // Verify all check results belong to the organization
    const { data: checkResults, error: crError } = await supabaseAdmin
      .from('check_results')
      .select(`
        id,
        health_check:health_checks!inner(organization_id)
      `)
      .in('id', checkResultIds)

    if (crError) {
      return c.json({ error: crError.message }, 500)
    }

    // Filter to only check results that belong to this org
    const validIds = checkResults
      ?.filter(cr => getOrgIdFromCheckResult(cr) === auth.orgId)
      .map(cr => cr.id) || []

    if (validIds.length === 0) {
      return c.json({ reasonsByCheckResult: {} })
    }

    // Get selected reasons for all valid check results in one query
    const { data: allSelectedReasons, error: selError } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        check_result_id,
        id,
        item_reason_id,
        technical_description_override,
        customer_description_override,
        follow_up_days,
        follow_up_text,
        rag_overridden,
        customer_approved,
        approved_at,
        reason:item_reasons(
          id,
          reason_text,
          technical_description,
          customer_description,
          default_rag,
          category_id,
          suggested_follow_up_days,
          suggested_follow_up_text,
          category:reason_categories(id, name, color)
        )
      `)
      .in('check_result_id', validIds)

    if (selError) {
      return c.json({ error: selError.message }, 500)
    }

    // Group reasons by check result ID
    // Use ReturnType to match the shape returned by formatCheckResultReasonResponse
    const reasonsByCheckResult: Record<string, ReturnType<typeof formatCheckResultReasonResponse>[]> = {}

    // Initialize all requested IDs with empty arrays
    validIds.forEach(id => {
      reasonsByCheckResult[id] = []
    })

    // Populate with actual reasons
    allSelectedReasons?.forEach((sr) => {
      if (!reasonsByCheckResult[sr.check_result_id]) {
        reasonsByCheckResult[sr.check_result_id] = []
      }
      reasonsByCheckResult[sr.check_result_id].push(formatCheckResultReasonResponse(sr))
    })

    return c.json({ reasonsByCheckResult })
  } catch (error) {
    console.error('Batch get check result reasons error:', error)
    return c.json({ error: 'Failed to get reasons' }, 500)
  }
})

// GET /api/v1/check-results/:id/reasons - Get reasons for a check result
checkResultReasons.get('/check-results/:id/reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get check result with template item
    const { data: checkResult, error: crError } = await supabaseAdmin
      .from('check_results')
      .select(`
        id,
        template_item_id,
        health_check:health_checks!inner(organization_id)
      `)
      .eq('id', id)
      .single()

    if (crError || !checkResult) {
      return c.json({ error: 'Check result not found' }, 404)
    }

    if (getOrgIdFromCheckResult(checkResult) !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Get selected reasons
    const { data: selectedReasons, error: selError } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        *,
        reason:item_reasons(
          id,
          reason_text,
          technical_description,
          customer_description,
          default_rag,
          category_id,
          suggested_follow_up_days,
          suggested_follow_up_text,
          category:reason_categories(id, name, color)
        )
      `)
      .eq('check_result_id', id)

    if (selError) {
      return c.json({ error: selError.message }, 500)
    }

    // Get available reasons
    const { data: availableReasons } = await supabaseAdmin
      .rpc('get_reasons_for_item', {
        p_template_item_id: checkResult.template_item_id,
        p_organization_id: auth.orgId
      })

    return c.json({
      selectedReasons: selectedReasons?.map(sr => formatCheckResultReasonResponse(sr)),
      availableReasons: availableReasons?.map((r: Record<string, unknown>) => ({
        id: r.id,
        reasonText: r.reason_text,
        technicalDescription: r.technical_description,
        customerDescription: r.customer_description,
        defaultRag: r.default_rag,
        categoryId: r.category_id,
        categoryName: r.category_name,
        categoryColor: r.category_color,
        suggestedFollowUpDays: r.suggested_follow_up_days,
        suggestedFollowUpText: r.suggested_follow_up_text,
        source: r.source
      }))
    })
  } catch (error) {
    console.error('Get check result reasons error:', error)
    return c.json({ error: 'Failed to get reasons' }, 500)
  }
})

// PUT /api/v1/check-results/:id/reasons - Set selected reasons for check result
checkResultReasons.put('/check-results/:id/reasons', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { reasonIds, followUpDays, followUpText, notes } = body

    if (!reasonIds || !Array.isArray(reasonIds)) {
      return c.json({ error: 'reasonIds array is required' }, 400)
    }

    // Verify check result belongs to org
    const { data: checkResult, error: crError } = await supabaseAdmin
      .from('check_results')
      .select(`
        id,
        health_check:health_checks!inner(organization_id)
      `)
      .eq('id', id)
      .single()

    if (crError || !checkResult) {
      return c.json({ error: 'Check result not found' }, 404)
    }

    if (getOrgIdFromCheckResult(checkResult) !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Update check_result notes if provided
    if (notes !== undefined) {
      await supabaseAdmin
        .from('check_results')
        .update({ notes })
        .eq('id', id)
    }

    // Delete existing selections
    await supabaseAdmin
      .from('check_result_reasons')
      .delete()
      .eq('check_result_id', id)

    // Insert new selections
    if (reasonIds.length > 0) {
      const inserts = reasonIds.map((reasonId: string) => ({
        check_result_id: id,
        item_reason_id: reasonId,
        organization_id: auth.orgId,
        user_id: auth.user.id,
        follow_up_days: followUpDays,
        follow_up_text: followUpText
      }))

      const { error: insertError } = await supabaseAdmin
        .from('check_result_reasons')
        .insert(inserts)

      if (insertError) {
        return c.json({ error: insertError.message }, 500)
      }
    }

    // Get updated selections
    const { data: selectedReasons } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        *,
        reason:item_reasons(
          id,
          reason_text,
          default_rag,
          category:reason_categories(id, name, color)
        )
      `)
      .eq('check_result_id', id)

    return c.json({
      selectedReasons: selectedReasons?.map(sr => {
        const reason = extractRelation(sr.reason)
        return {
          id: sr.id,
          itemReasonId: sr.item_reason_id,
          reasonText: (reason as { reason_text?: string })?.reason_text,
          defaultRag: (reason as { default_rag?: string })?.default_rag,
          followUpDays: sr.follow_up_days,
          followUpText: sr.follow_up_text
        }
      })
    })
  } catch (error) {
    console.error('Set check result reasons error:', error)
    return c.json({ error: 'Failed to set reasons' }, 500)
  }
})

// PATCH /api/v1/check-result-reasons/:id - Update description override
checkResultReasons.patch('/check-result-reasons/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    const updateData: Record<string, unknown> = {}

    if (body.technicalDescriptionOverride !== undefined) {
      updateData.technical_description_override = body.technicalDescriptionOverride
    }
    if (body.customerDescriptionOverride !== undefined) {
      updateData.customer_description_override = body.customerDescriptionOverride
    }
    if (body.followUpDays !== undefined) {
      updateData.follow_up_days = body.followUpDays
    }
    if (body.followUpText !== undefined) {
      updateData.follow_up_text = body.followUpText
    }

    const { data, error } = await supabaseAdmin
      .from('check_result_reasons')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: data.id,
      technicalDescriptionOverride: data.technical_description_override,
      customerDescriptionOverride: data.customer_description_override,
      followUpDays: data.follow_up_days,
      followUpText: data.follow_up_text
    })
  } catch (error) {
    console.error('Update check result reason error:', error)
    return c.json({ error: 'Failed to update' }, 500)
  }
})

// PATCH /api/v1/check-result-reasons/:id/approval - Record customer approval
checkResultReasons.patch('/check-result-reasons/:id/approval', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { approved } = body

    if (typeof approved !== 'boolean') {
      return c.json({ error: 'approved boolean is required' }, 400)
    }

    const { data, error } = await supabaseAdmin
      .from('check_result_reasons')
      .update({
        customer_approved: approved,
        approved_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: data.id,
      customerApproved: data.customer_approved,
      approvedAt: data.approved_at
    })
  } catch (error) {
    console.error('Update approval error:', error)
    return c.json({ error: 'Failed to update approval' }, 500)
  }
})

export default checkResultReasons
