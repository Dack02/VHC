import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { verifyRepairItemAccess, verifyHealthCheckAccess } from './helpers.js'
import { logAudit, getRequestContext } from '../../services/audit.js'

const outcomesRouter = new Hono()

// =============================================================================
// Helper Functions
// =============================================================================

// Helper to verify a declined reason belongs to the organization
async function verifyDeclinedReasonAccess(reasonId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('declined_reasons')
    .select('id, reason')
    .eq('id', reasonId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .single()
  return data
}

// Helper to verify a deleted reason belongs to the organization
async function verifyDeletedReasonAccess(reasonId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('deleted_reasons')
    .select('id, reason')
    .eq('id', reasonId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .single()
  return data
}

// Helper to check if "Other" reason requires notes
async function isOtherReason(reasonId: string, tableName: 'declined_reasons' | 'deleted_reasons') {
  const { data } = await supabaseAdmin
    .from(tableName)
    .select('is_system, reason')
    .eq('id', reasonId)
    .single()
  // "Other" is typically the system reason that requires notes
  return data?.is_system && data?.reason?.toLowerCase() === 'other'
}

// Helper to verify multiple repair items belong to the same org and exist
async function verifyBulkRepairItemsAccess(repairItemIds: string[], orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('repair_items')
    .select('id, health_check_id')
    .in('id', repairItemIds)
    .eq('organization_id', orgId)

  if (error || !data) return null

  // Check all items were found
  if (data.length !== repairItemIds.length) {
    return null
  }

  return data
}

// =============================================================================
// Individual Outcome Endpoints
// =============================================================================

// POST /repair-items/:id/authorise - Mark repair item as authorised
outcomesRouter.post('/repair-items/:id/authorise', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const { notes } = body

    // Verify repair item belongs to org
    const repairItem = await verifyRepairItemAccess(id, auth.orgId)
    if (!repairItem) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const now = new Date().toISOString()

    // Update repair item
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        outcome_status: 'authorised',
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        outcome_source: 'manual',
        // Also set the legacy customer_approved fields for compatibility
        customer_approved: true,
        customer_approved_at: now,
        updated_at: now
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Authorise repair item error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Audit log the outcome change
    const reqContext = getRequestContext(c)
    await logAudit({
      action: 'repair_item.authorise',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        repairItemName: repairItem.name,
        healthCheckId: repairItem.health_check_id,
        notes: notes || null
      },
      ...reqContext
    })

    return c.json({
      success: true,
      repairItem: {
        id: updated.id,
        outcomeStatus: updated.outcome_status,
        outcomeSetBy: updated.outcome_set_by,
        outcomeSetAt: updated.outcome_set_at,
        outcomeSource: updated.outcome_source
      }
    })
  } catch (error) {
    console.error('Authorise repair item error:', error)
    return c.json({ error: 'Failed to authorise repair item' }, 500)
  }
})

// POST /repair-items/:id/defer - Mark repair item as deferred
outcomesRouter.post('/repair-items/:id/defer', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { deferred_until, notes } = body

    // Validate required fields
    if (!deferred_until) {
      return c.json({ error: 'deferred_until date is required' }, 400)
    }

    // Validate date format
    const deferDate = new Date(deferred_until)
    if (isNaN(deferDate.getTime())) {
      return c.json({ error: 'Invalid date format for deferred_until' }, 400)
    }

    // Ensure date is in the future
    if (deferDate <= new Date()) {
      return c.json({ error: 'deferred_until must be a future date' }, 400)
    }

    // Verify repair item belongs to org
    const repairItem = await verifyRepairItemAccess(id, auth.orgId)
    if (!repairItem) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const now = new Date().toISOString()

    // Update repair item
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        outcome_status: 'deferred',
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        outcome_source: 'manual',
        deferred_until: deferred_until,
        deferred_notes: notes?.trim() || null,
        updated_at: now
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Defer repair item error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Audit log the outcome change
    const reqContext = getRequestContext(c)
    await logAudit({
      action: 'repair_item.defer',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        repairItemName: repairItem.name,
        healthCheckId: repairItem.health_check_id,
        deferredUntil: deferred_until,
        notes: notes || null
      },
      ...reqContext
    })

    return c.json({
      success: true,
      repairItem: {
        id: updated.id,
        outcomeStatus: updated.outcome_status,
        outcomeSetBy: updated.outcome_set_by,
        outcomeSetAt: updated.outcome_set_at,
        outcomeSource: updated.outcome_source,
        deferredUntil: updated.deferred_until,
        deferredNotes: updated.deferred_notes
      }
    })
  } catch (error) {
    console.error('Defer repair item error:', error)
    return c.json({ error: 'Failed to defer repair item' }, 500)
  }
})

// POST /repair-items/:id/decline - Mark repair item as declined
outcomesRouter.post('/repair-items/:id/decline', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { declined_reason_id, notes } = body

    // Validate required fields
    if (!declined_reason_id) {
      return c.json({ error: 'declined_reason_id is required' }, 400)
    }

    // Verify repair item belongs to org
    const repairItem = await verifyRepairItemAccess(id, auth.orgId)
    if (!repairItem) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Verify declined reason exists and belongs to org
    const declinedReason = await verifyDeclinedReasonAccess(declined_reason_id, auth.orgId)
    if (!declinedReason) {
      return c.json({ error: 'Declined reason not found' }, 404)
    }

    // Check if "Other" reason requires notes
    const needsNotes = await isOtherReason(declined_reason_id, 'declined_reasons')
    if (needsNotes && (!notes || !notes.trim())) {
      return c.json({ error: 'Notes are required when selecting "Other" reason' }, 400)
    }

    const now = new Date().toISOString()

    // Update repair item
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        outcome_status: 'declined',
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        outcome_source: 'manual',
        declined_reason_id: declined_reason_id,
        declined_notes: notes?.trim() || null,
        // Also set the legacy customer_approved fields for compatibility
        customer_approved: false,
        customer_declined_reason: declinedReason.reason,
        updated_at: now
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Decline repair item error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Audit log the outcome change
    const reqContext = getRequestContext(c)
    await logAudit({
      action: 'repair_item.decline',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        repairItemName: repairItem.name,
        healthCheckId: repairItem.health_check_id,
        declinedReasonId: declined_reason_id,
        declinedReason: declinedReason.reason,
        notes: notes || null
      },
      ...reqContext
    })

    return c.json({
      success: true,
      repairItem: {
        id: updated.id,
        outcomeStatus: updated.outcome_status,
        outcomeSetBy: updated.outcome_set_by,
        outcomeSetAt: updated.outcome_set_at,
        outcomeSource: updated.outcome_source,
        declinedReasonId: updated.declined_reason_id,
        declinedNotes: updated.declined_notes
      }
    })
  } catch (error) {
    console.error('Decline repair item error:', error)
    return c.json({ error: 'Failed to decline repair item' }, 500)
  }
})

// POST /repair-items/:id/delete - Soft delete repair item with reason
outcomesRouter.post('/repair-items/:id/delete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { deleted_reason_id, notes } = body

    // Validate required fields
    if (!deleted_reason_id) {
      return c.json({ error: 'deleted_reason_id is required' }, 400)
    }

    // Verify repair item belongs to org
    const repairItem = await verifyRepairItemAccess(id, auth.orgId)
    if (!repairItem) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Verify deleted reason exists and belongs to org
    const deletedReason = await verifyDeletedReasonAccess(deleted_reason_id, auth.orgId)
    if (!deletedReason) {
      return c.json({ error: 'Deleted reason not found' }, 404)
    }

    // Check if "Other" reason requires notes
    const needsNotes = await isOtherReason(deleted_reason_id, 'deleted_reasons')
    if (needsNotes && (!notes || !notes.trim())) {
      return c.json({ error: 'Notes are required when selecting "Other" reason' }, 400)
    }

    const now = new Date().toISOString()

    // Soft delete by setting deleted_at and outcome_status
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        outcome_status: 'deleted',
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        outcome_source: 'manual',
        deleted_reason_id: deleted_reason_id,
        deleted_notes: notes?.trim() || null,
        deleted_at: now,
        deleted_by: auth.user.id,
        updated_at: now
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Delete repair item error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Audit log the outcome change
    const reqContext = getRequestContext(c)
    await logAudit({
      action: 'repair_item.delete',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        repairItemName: repairItem.name,
        healthCheckId: repairItem.health_check_id,
        deletedReasonId: deleted_reason_id,
        deletedReason: deletedReason.reason,
        notes: notes || null
      },
      ...reqContext
    })

    return c.json({
      success: true,
      repairItem: {
        id: updated.id,
        outcomeStatus: updated.outcome_status,
        deletedReasonId: updated.deleted_reason_id,
        deletedNotes: updated.deleted_notes,
        deletedAt: updated.deleted_at,
        deletedBy: updated.deleted_by
      }
    })
  } catch (error) {
    console.error('Delete repair item error:', error)
    return c.json({ error: 'Failed to delete repair item' }, 500)
  }
})

// POST /repair-items/:id/reset - Reset repair item outcome back to 'ready'
outcomesRouter.post('/repair-items/:id/reset', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify repair item belongs to org
    const repairItem = await verifyRepairItemAccess(id, auth.orgId)
    if (!repairItem) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const now = new Date().toISOString()

    // Reset all outcome fields
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        outcome_status: 'ready',
        outcome_set_by: auth.user.id, // Log who reset it
        outcome_set_at: now,
        outcome_source: 'manual',
        // Clear deferred fields
        deferred_until: null,
        deferred_notes: null,
        // Clear declined fields
        declined_reason_id: null,
        declined_notes: null,
        // Clear deleted fields (un-delete)
        deleted_reason_id: null,
        deleted_notes: null,
        deleted_at: null,
        deleted_by: null,
        // Clear legacy fields
        customer_approved: null,
        customer_approved_at: null,
        customer_declined_reason: null,
        updated_at: now
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Reset repair item error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Audit log the outcome change
    const reqContext = getRequestContext(c)
    await logAudit({
      action: 'repair_item.reset',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        repairItemName: repairItem.name,
        healthCheckId: repairItem.health_check_id
      },
      ...reqContext
    })

    return c.json({
      success: true,
      repairItem: {
        id: updated.id,
        outcomeStatus: updated.outcome_status,
        outcomeSetBy: updated.outcome_set_by,
        outcomeSetAt: updated.outcome_set_at,
        outcomeSource: updated.outcome_source
      }
    })
  } catch (error) {
    console.error('Reset repair item error:', error)
    return c.json({ error: 'Failed to reset repair item' }, 500)
  }
})

// =============================================================================
// Bulk Outcome Endpoints
// =============================================================================

// POST /repair-items/bulk-authorise - Bulk authorise multiple repair items
outcomesRouter.post('/repair-items/bulk-authorise', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { repair_item_ids, notes } = body

    // Validate required fields
    if (!repair_item_ids || !Array.isArray(repair_item_ids) || repair_item_ids.length === 0) {
      return c.json({ error: 'repair_item_ids array is required' }, 400)
    }

    // Verify all repair items belong to org
    const repairItems = await verifyBulkRepairItemsAccess(repair_item_ids, auth.orgId)
    if (!repairItems) {
      return c.json({ error: 'One or more repair items not found' }, 404)
    }

    const now = new Date().toISOString()

    // Bulk update repair items
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        outcome_status: 'authorised',
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        outcome_source: 'manual',
        customer_approved: true,
        customer_approved_at: now,
        updated_at: now
      })
      .in('id', repair_item_ids)
      .select('id')

    if (error) {
      console.error('Bulk authorise error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Audit log the bulk outcome change
    const reqContext = getRequestContext(c)
    await logAudit({
      action: 'repair_item.bulk_authorise',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      metadata: {
        repairItemIds: repair_item_ids,
        count: repair_item_ids.length,
        notes: notes || null
      },
      ...reqContext
    })

    return c.json({
      success: true,
      updatedCount: updated?.length || 0,
      updatedIds: updated?.map(item => item.id) || []
    })
  } catch (error) {
    console.error('Bulk authorise error:', error)
    return c.json({ error: 'Failed to bulk authorise repair items' }, 500)
  }
})

// POST /repair-items/bulk-defer - Bulk defer multiple repair items
outcomesRouter.post('/repair-items/bulk-defer', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { repair_item_ids, deferred_until, notes } = body

    // Validate required fields
    if (!repair_item_ids || !Array.isArray(repair_item_ids) || repair_item_ids.length === 0) {
      return c.json({ error: 'repair_item_ids array is required' }, 400)
    }

    if (!deferred_until) {
      return c.json({ error: 'deferred_until date is required' }, 400)
    }

    // Validate date format
    const deferDate = new Date(deferred_until)
    if (isNaN(deferDate.getTime())) {
      return c.json({ error: 'Invalid date format for deferred_until' }, 400)
    }

    // Ensure date is in the future
    if (deferDate <= new Date()) {
      return c.json({ error: 'deferred_until must be a future date' }, 400)
    }

    // Verify all repair items belong to org
    const repairItems = await verifyBulkRepairItemsAccess(repair_item_ids, auth.orgId)
    if (!repairItems) {
      return c.json({ error: 'One or more repair items not found' }, 404)
    }

    const now = new Date().toISOString()

    // Bulk update repair items
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        outcome_status: 'deferred',
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        outcome_source: 'manual',
        deferred_until: deferred_until,
        deferred_notes: notes?.trim() || null,
        updated_at: now
      })
      .in('id', repair_item_ids)
      .select('id')

    if (error) {
      console.error('Bulk defer error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Audit log the bulk outcome change
    const reqContext = getRequestContext(c)
    await logAudit({
      action: 'repair_item.bulk_defer',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      metadata: {
        repairItemIds: repair_item_ids,
        count: repair_item_ids.length,
        deferredUntil: deferred_until,
        notes: notes || null
      },
      ...reqContext
    })

    return c.json({
      success: true,
      updatedCount: updated?.length || 0,
      updatedIds: updated?.map(item => item.id) || []
    })
  } catch (error) {
    console.error('Bulk defer error:', error)
    return c.json({ error: 'Failed to bulk defer repair items' }, 500)
  }
})

// POST /repair-items/bulk-decline - Bulk decline multiple repair items
outcomesRouter.post('/repair-items/bulk-decline', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { repair_item_ids, declined_reason_id, notes } = body

    // Validate required fields
    if (!repair_item_ids || !Array.isArray(repair_item_ids) || repair_item_ids.length === 0) {
      return c.json({ error: 'repair_item_ids array is required' }, 400)
    }

    if (!declined_reason_id) {
      return c.json({ error: 'declined_reason_id is required' }, 400)
    }

    // Verify all repair items belong to org
    const repairItems = await verifyBulkRepairItemsAccess(repair_item_ids, auth.orgId)
    if (!repairItems) {
      return c.json({ error: 'One or more repair items not found' }, 404)
    }

    // Verify declined reason exists and belongs to org
    const declinedReason = await verifyDeclinedReasonAccess(declined_reason_id, auth.orgId)
    if (!declinedReason) {
      return c.json({ error: 'Declined reason not found' }, 404)
    }

    // Check if "Other" reason requires notes
    const needsNotes = await isOtherReason(declined_reason_id, 'declined_reasons')
    if (needsNotes && (!notes || !notes.trim())) {
      return c.json({ error: 'Notes are required when selecting "Other" reason' }, 400)
    }

    const now = new Date().toISOString()

    // Bulk update repair items
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        outcome_status: 'declined',
        outcome_set_by: auth.user.id,
        outcome_set_at: now,
        outcome_source: 'manual',
        declined_reason_id: declined_reason_id,
        declined_notes: notes?.trim() || null,
        customer_approved: false,
        customer_declined_reason: declinedReason.reason,
        updated_at: now
      })
      .in('id', repair_item_ids)
      .select('id')

    if (error) {
      console.error('Bulk decline error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Audit log the bulk outcome change
    const reqContext = getRequestContext(c)
    await logAudit({
      action: 'repair_item.bulk_decline',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      metadata: {
        repairItemIds: repair_item_ids,
        count: repair_item_ids.length,
        declinedReasonId: declined_reason_id,
        declinedReason: declinedReason.reason,
        notes: notes || null
      },
      ...reqContext
    })

    return c.json({
      success: true,
      updatedCount: updated?.length || 0,
      updatedIds: updated?.map(item => item.id) || []
    })
  } catch (error) {
    console.error('Bulk decline error:', error)
    return c.json({ error: 'Failed to bulk decline repair items' }, 500)
  }
})

// =============================================================================
// Health Check Completion Check
// =============================================================================

// GET /health-checks/:id/can-complete - Check if health check can be completed
outcomesRouter.get('/health-checks/:id/can-complete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check belongs to org
    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get all non-deleted repair items
    const { data: repairItems, error } = await supabaseAdmin
      .from('repair_items')
      .select('id, name, outcome_status, labour_status, parts_status, no_labour_required, no_parts_required')
      .eq('health_check_id', id)
      .is('deleted_at', null) // Exclude soft-deleted items

    if (error) {
      console.error('Get repair items error:', error)
      return c.json({ error: error.message }, 500)
    }

    // If no repair items, health check can be completed
    if (!repairItems || repairItems.length === 0) {
      return c.json({
        canComplete: true,
        pendingItems: 0,
        message: 'No repair items to action'
      })
    }

    // Calculate pending items (incomplete or ready status)
    const pendingItems = repairItems.filter(item => {
      // If outcome is already set (authorised, deferred, declined), it's not pending
      if (['authorised', 'deferred', 'declined'].includes(item.outcome_status)) {
        return false
      }

      // If still incomplete (L&P not done) or ready (awaiting decision), it's pending
      return true
    })

    if (pendingItems.length > 0) {
      return c.json({
        canComplete: false,
        pendingItems: pendingItems.length,
        message: `Cannot complete: ${pendingItems.length} repair item(s) need an outcome`,
        items: pendingItems.map(item => ({
          id: item.id,
          name: item.name,
          outcomeStatus: item.outcome_status
        }))
      })
    }

    return c.json({
      canComplete: true,
      pendingItems: 0,
      message: 'All repair items have been actioned'
    })
  } catch (error) {
    console.error('Can complete check error:', error)
    return c.json({ error: 'Failed to check completion status' }, 500)
  }
})

export default outcomesRouter
