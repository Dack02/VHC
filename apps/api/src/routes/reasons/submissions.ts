/**
 * Reason Submissions Routes
 *
 * Handles the workflow for technicians to submit custom reasons
 * for manager review and approval.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { extractRelation } from './helpers.js'

const submissions = new Hono()

// POST /api/v1/reason-submissions - Submit custom reason for manager review
submissions.post('/reason-submissions', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const {
      templateItemId,
      reasonType,
      reasonText,
      notes,
      healthCheckId,
      checkResultId
    } = body

    if (!reasonText) {
      return c.json({ error: 'Reason text is required' }, 400)
    }

    if (!templateItemId && !reasonType) {
      return c.json({ error: 'Either templateItemId or reasonType is required' }, 400)
    }

    const { data: submission, error } = await supabaseAdmin
      .from('reason_submissions')
      .insert({
        organization_id: auth.orgId,
        template_item_id: templateItemId,
        reason_type: reasonType,
        submitted_reason_text: reasonText,
        submitted_notes: notes,
        health_check_id: healthCheckId,
        check_result_id: checkResultId,
        submitted_by: auth.user.id
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: submission.id,
      reasonText: submission.submitted_reason_text,
      status: submission.status,
      submittedAt: submission.submitted_at
    }, 201)
  } catch (error) {
    console.error('Submit reason error:', error)
    return c.json({ error: 'Failed to submit reason' }, 500)
  }
})

// GET /api/v1/organizations/:id/reason-submissions - List submissions
submissions.get('/organizations/:id/reason-submissions', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { status } = c.req.query()

    // Verify org access
    if (id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    let query = supabaseAdmin
      .from('reason_submissions')
      .select(`
        *,
        submitter:users!reason_submissions_submitted_by_fkey(first_name, last_name),
        reviewer:users!reason_submissions_reviewed_by_fkey(first_name, last_name),
        template_item:template_items(id, name),
        health_check:health_checks(id, job_number, vehicle:vehicles(registration))
      `, { count: 'exact' })
      .eq('organization_id', id)
      .order('submitted_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      submissions: data?.map(s => {
        const submitter = extractRelation(s.submitter)
        const reviewer = extractRelation(s.reviewer)
        const templateItem = extractRelation(s.template_item)
        const healthCheck = extractRelation(s.health_check)
        const vehicle = healthCheck ? extractRelation((healthCheck as { vehicle?: { registration?: string } }).vehicle) : null

        return {
          id: s.id,
          templateItemId: s.template_item_id,
          templateItemName: (templateItem as { name?: string })?.name,
          reasonType: s.reason_type,
          reasonText: s.submitted_reason_text,
          notes: s.submitted_notes,
          status: s.status,
          submittedBy: submitter ? `${(submitter as { first_name?: string }).first_name} ${(submitter as { last_name?: string }).last_name}` : null,
          submittedAt: s.submitted_at,
          reviewedBy: reviewer ? `${(reviewer as { first_name?: string }).first_name} ${(reviewer as { last_name?: string }).last_name}` : null,
          reviewedAt: s.reviewed_at,
          reviewNotes: s.review_notes,
          context: healthCheck ? {
            healthCheckId: (healthCheck as { id?: string }).id,
            jobNumber: (healthCheck as { job_number?: string }).job_number,
            registration: (vehicle as { registration?: string })?.registration
          } : null
        }
      }),
      count
    })
  } catch (error) {
    console.error('Get submissions error:', error)
    return c.json({ error: 'Failed to get submissions' }, 500)
  }
})

// GET /api/v1/organizations/:id/reason-submissions/count - Get pending count
submissions.get('/organizations/:id/reason-submissions/count', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { status = 'pending' } = c.req.query()

    if (id !== auth.orgId) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    const { count, error } = await supabaseAdmin
      .from('reason_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', id)
      .eq('status', status)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ count: count || 0 })
  } catch (error) {
    console.error('Get submission count error:', error)
    return c.json({ error: 'Failed to get count' }, 500)
  }
})

// POST /api/v1/reason-submissions/:id/approve - Approve submission
submissions.post('/reason-submissions/:id/approve', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const {
      technicalDescription,
      customerDescription,
      defaultRag,
      categoryId,
      suggestedFollowUpDays,
      suggestedFollowUpText,
      applyToType  // If true, create as type-based reason instead of item-specific
    } = body

    // Get the submission
    const { data: submission, error: fetchError } = await supabaseAdmin
      .from('reason_submissions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .eq('status', 'pending')
      .single()

    if (fetchError || !submission) {
      return c.json({ error: 'Submission not found or already processed' }, 404)
    }

    // Create the new reason
    const reasonData: Record<string, unknown> = {
      organization_id: auth.orgId,
      reason_text: submission.submitted_reason_text,
      technical_description: technicalDescription,
      customer_description: customerDescription,
      default_rag: defaultRag || 'amber',
      category_id: categoryId,
      suggested_follow_up_days: suggestedFollowUpDays,
      suggested_follow_up_text: suggestedFollowUpText,
      ai_reviewed: true,
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
      created_by: auth.user.id
    }

    // Determine if creating for type or specific item
    if (applyToType && submission.reason_type) {
      reasonData.reason_type = submission.reason_type
    } else if (submission.template_item_id) {
      reasonData.template_item_id = submission.template_item_id
    } else if (submission.reason_type) {
      reasonData.reason_type = submission.reason_type
    }

    const { data: reason, error: createError } = await supabaseAdmin
      .from('item_reasons')
      .insert(reasonData)
      .select()
      .single()

    if (createError) {
      return c.json({ error: createError.message }, 500)
    }

    // Update submission status
    const { data: updatedSubmission, error: updateError } = await supabaseAdmin
      .from('reason_submissions')
      .update({
        status: 'approved',
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
        approved_reason_id: reason.id
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    return c.json({
      submission: {
        id: updatedSubmission.id,
        status: updatedSubmission.status,
        reviewedAt: updatedSubmission.reviewed_at
      },
      reason: {
        id: reason.id,
        reasonText: reason.reason_text,
        templateItemId: reason.template_item_id,
        reasonType: reason.reason_type
      }
    })
  } catch (error) {
    console.error('Approve submission error:', error)
    return c.json({ error: 'Failed to approve submission' }, 500)
  }
})

// POST /api/v1/reason-submissions/:id/reject - Reject submission
submissions.post('/reason-submissions/:id/reject', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { reviewNotes } = body

    const { data: submission, error } = await supabaseAdmin
      .from('reason_submissions')
      .update({
        status: 'rejected',
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .eq('status', 'pending')
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    if (!submission) {
      return c.json({ error: 'Submission not found or already processed' }, 404)
    }

    return c.json({
      id: submission.id,
      status: submission.status,
      reviewedAt: submission.reviewed_at,
      reviewNotes: submission.review_notes
    })
  } catch (error) {
    console.error('Reject submission error:', error)
    return c.json({ error: 'Failed to reject submission' }, 500)
  }
})

export default submissions
