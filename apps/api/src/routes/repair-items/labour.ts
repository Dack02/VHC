import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { verifyRepairItemAccess, verifyRepairOptionAccess, updateRepairItemWorkflowStatus } from './helpers.js'
import { logAudit } from '../../services/audit.js'

const labourRouter = new Hono()

// Debug middleware for labour router
labourRouter.use('*', async (c, next) => {
  console.log(`[labour-router] ${c.req.method} ${c.req.path}`)
  await next()
})

// GET /repair-items/:id/labour - List labour for repair item
labourRouter.get('/repair-items/:id/labour', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const { data: labour, error } = await supabaseAdmin
      .from('repair_labour')
      .select(`
        *,
        labour_code:labour_codes(id, code, description)
      `)
      .eq('repair_item_id', id)

    if (error) {
      console.error('Get labour error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      labour: (labour || []).map(lab => ({
        id: lab.id,
        labourCodeId: lab.labour_code_id,
        labourCode: lab.labour_code,
        hours: parseFloat(lab.hours),
        rate: parseFloat(lab.rate),
        discountPercent: parseFloat(lab.discount_percent) || 0,
        total: parseFloat(lab.total),
        isVatExempt: lab.is_vat_exempt,
        notes: lab.notes,
        createdAt: lab.created_at
      }))
    })
  } catch (error) {
    console.error('Get labour error:', error)
    return c.json({ error: 'Failed to get labour' }, 500)
  }
})

// POST /repair-items/:id/labour - Add labour to repair item
labourRouter.post('/repair-items/:id/labour', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { labour_code_id, hours, notes, discount_percent } = body

    if (!labour_code_id || hours === undefined) {
      return c.json({ error: 'labour_code_id and hours are required' }, 400)
    }

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Get labour code details
    const { data: labourCode, error: codeError } = await supabaseAdmin
      .from('labour_codes')
      .select('id, hourly_rate, is_vat_exempt')
      .eq('id', labour_code_id)
      .eq('organization_id', auth.orgId)
      .single()

    if (codeError || !labourCode) {
      return c.json({ error: 'Labour code not found' }, 404)
    }

    const rate = parseFloat(labourCode.hourly_rate)
    const discountPct = parseFloat(discount_percent) || 0
    const subtotal = rate * parseFloat(hours)
    const total = subtotal * (1 - discountPct / 100)

    const { data: labour, error } = await supabaseAdmin
      .from('repair_labour')
      .insert({
        repair_item_id: id,
        labour_code_id,
        hours: parseFloat(hours),
        rate,
        discount_percent: discountPct,
        total,
        is_vat_exempt: labourCode.is_vat_exempt,
        notes: notes?.trim() || null,
        created_by: auth.user.id
      })
      .select(`
        *,
        labour_code:labour_codes(id, code, description)
      `)
      .single()

    if (error) {
      console.error('Add labour error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Auto-update workflow status
    await updateRepairItemWorkflowStatus(id, null)

    // Log audit event for timeline
    logAudit({
      action: 'labour.add',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        labour_id: labour.id,
        repair_item_id: id,
        health_check_id: existing.health_check_id,
        item_name: existing.name,
        labour_code: labour.labour_code?.code || null,
        labour_description: labour.labour_code?.description || null,
        hours: parseFloat(labour.hours),
        rate: parseFloat(labour.rate),
        total: parseFloat(labour.total)
      }
    })

    return c.json({
      id: labour.id,
      labourCodeId: labour.labour_code_id,
      labourCode: labour.labour_code,
      hours: parseFloat(labour.hours),
      rate: parseFloat(labour.rate),
      discountPercent: parseFloat(labour.discount_percent) || 0,
      total: parseFloat(labour.total),
      isVatExempt: labour.is_vat_exempt,
      notes: labour.notes
    }, 201)
  } catch (error) {
    console.error('Add labour error:', error)
    return c.json({ error: 'Failed to add labour' }, 500)
  }
})

// GET /repair-options/:id/labour - List labour for option
labourRouter.get('/repair-options/:id/labour', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairOptionAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair option not found' }, 404)
    }

    const { data: labour, error } = await supabaseAdmin
      .from('repair_labour')
      .select(`
        *,
        labour_code:labour_codes(id, code, description)
      `)
      .eq('repair_option_id', id)

    if (error) {
      console.error('Get option labour error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      labour: (labour || []).map(lab => ({
        id: lab.id,
        labourCodeId: lab.labour_code_id,
        labourCode: lab.labour_code,
        hours: parseFloat(lab.hours),
        rate: parseFloat(lab.rate),
        discountPercent: parseFloat(lab.discount_percent) || 0,
        total: parseFloat(lab.total),
        isVatExempt: lab.is_vat_exempt,
        notes: lab.notes
      }))
    })
  } catch (error) {
    console.error('Get option labour error:', error)
    return c.json({ error: 'Failed to get labour' }, 500)
  }
})

// POST /repair-options/:id/labour - Add labour to option
labourRouter.post('/repair-options/:id/labour', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { labour_code_id, hours, notes, discount_percent } = body

    if (!labour_code_id || hours === undefined) {
      return c.json({ error: 'labour_code_id and hours are required' }, 400)
    }

    const existing = await verifyRepairOptionAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair option not found' }, 404)
    }

    // Get labour code details
    const { data: labourCode, error: codeError } = await supabaseAdmin
      .from('labour_codes')
      .select('id, hourly_rate, is_vat_exempt')
      .eq('id', labour_code_id)
      .eq('organization_id', auth.orgId)
      .single()

    if (codeError || !labourCode) {
      return c.json({ error: 'Labour code not found' }, 404)
    }

    const rate = parseFloat(labourCode.hourly_rate)
    const discountPct = parseFloat(discount_percent) || 0
    const subtotal = rate * parseFloat(hours)
    const total = subtotal * (1 - discountPct / 100)

    const { data: labour, error } = await supabaseAdmin
      .from('repair_labour')
      .insert({
        repair_option_id: id,
        labour_code_id,
        hours: parseFloat(hours),
        rate,
        discount_percent: discountPct,
        total,
        is_vat_exempt: labourCode.is_vat_exempt,
        notes: notes?.trim() || null,
        created_by: auth.user.id
      })
      .select(`
        *,
        labour_code:labour_codes(id, code, description)
      `)
      .single()

    if (error) {
      console.error('Add option labour error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Auto-update workflow status (for option, pass null for repairItemId)
    await updateRepairItemWorkflowStatus(null, id)

    return c.json({
      id: labour.id,
      labourCodeId: labour.labour_code_id,
      labourCode: labour.labour_code,
      hours: parseFloat(labour.hours),
      rate: parseFloat(labour.rate),
      discountPercent: parseFloat(labour.discount_percent) || 0,
      total: parseFloat(labour.total),
      isVatExempt: labour.is_vat_exempt,
      notes: labour.notes
    }, 201)
  } catch (error) {
    console.error('Add option labour error:', error)
    return c.json({ error: 'Failed to add labour' }, 500)
  }
})

// PATCH /repair-labour/:id - Update labour entry
labourRouter.patch('/repair-labour/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { labour_code_id, hours, notes, discount_percent } = body

    console.log('PATCH /repair-labour/:id - id:', id, 'body:', body)

    // Get existing labour entry
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_labour')
      .select(`
        *,
        repair_item:repair_items(organization_id),
        repair_option:repair_options(
          repair_item:repair_items!repair_options_repair_item_id_fkey(organization_id)
        )
      `)
      .eq('id', id)
      .single()

    console.log('Existing labour query result:', { existing, existError })

    if (existError || !existing) {
      console.log('Labour entry not found for id:', id)
      return c.json({ error: 'Labour entry not found' }, 404)
    }

    // Supabase returns joined tables as arrays, access first element
    const repairItem = Array.isArray(existing.repair_item) ? existing.repair_item[0] : existing.repair_item
    const repairOption = Array.isArray(existing.repair_option) ? existing.repair_option[0] : existing.repair_option
    const nestedRepairItemRaw = repairOption?.repair_item
    const nestedRepairItem = nestedRepairItemRaw && Array.isArray(nestedRepairItemRaw) ? nestedRepairItemRaw[0] : nestedRepairItemRaw
    const orgId = (repairItem as { organization_id?: string })?.organization_id ||
      (nestedRepairItem as { organization_id?: string })?.organization_id

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Labour entry not found' }, 404)
    }

    let rate = parseFloat(existing.rate)
    let isVatExempt = existing.is_vat_exempt

    // If labour code changed, get new rate
    if (labour_code_id && labour_code_id !== existing.labour_code_id) {
      const { data: labourCode } = await supabaseAdmin
        .from('labour_codes')
        .select('hourly_rate, is_vat_exempt')
        .eq('id', labour_code_id)
        .eq('organization_id', auth.orgId)
        .single()

      if (!labourCode) {
        return c.json({ error: 'Labour code not found' }, 404)
      }

      rate = parseFloat(labourCode.hourly_rate)
      isVatExempt = labourCode.is_vat_exempt
    }

    const newHours = hours !== undefined ? parseFloat(hours) : parseFloat(existing.hours)
    const discountPct = discount_percent !== undefined ? parseFloat(discount_percent) : (parseFloat(existing.discount_percent) || 0)
    const subtotal = rate * newHours
    const total = subtotal * (1 - discountPct / 100)

    const updateData: Record<string, unknown> = {
      hours: newHours,
      rate,
      discount_percent: discountPct,
      total,
      is_vat_exempt: isVatExempt,
      updated_at: new Date().toISOString()
    }
    if (labour_code_id) updateData.labour_code_id = labour_code_id
    if (notes !== undefined) updateData.notes = notes?.trim() || null

    const { data: labour, error } = await supabaseAdmin
      .from('repair_labour')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        labour_code:labour_codes(id, code, description)
      `)
      .single()

    if (error) {
      console.error('Update labour error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Get health_check_id and item name for audit
    const repairItemId = existing.repair_item_id || repairOption?.repair_item_id
    let healthCheckId: string | null = null
    let itemName: string | null = null
    if (repairItemId) {
      const { data: repairItemData } = await supabaseAdmin
        .from('repair_items')
        .select('health_check_id, name')
        .eq('id', repairItemId)
        .single()
      healthCheckId = repairItemData?.health_check_id || null
      itemName = repairItemData?.name || null
    }

    // Log audit event for timeline
    logAudit({
      action: 'labour.update',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_labour',
      resourceId: id,
      metadata: {
        labour_id: labour.id,
        repair_item_id: repairItemId,
        health_check_id: healthCheckId,
        item_name: itemName,
        labour_code: labour.labour_code?.code || null,
        old_hours: parseFloat(existing.hours),
        new_hours: parseFloat(labour.hours),
        old_rate: parseFloat(existing.rate),
        new_rate: parseFloat(labour.rate),
        old_total: parseFloat(existing.total),
        new_total: parseFloat(labour.total)
      }
    })

    return c.json({
      id: labour.id,
      labourCodeId: labour.labour_code_id,
      labourCode: labour.labour_code,
      hours: parseFloat(labour.hours),
      rate: parseFloat(labour.rate),
      discountPercent: parseFloat(labour.discount_percent) || 0,
      total: parseFloat(labour.total),
      isVatExempt: labour.is_vat_exempt,
      notes: labour.notes
    })
  } catch (error) {
    console.error('Update labour error:', error)
    return c.json({ error: 'Failed to update labour' }, 500)
  }
})

// DELETE /repair-labour/:id - Delete labour entry
labourRouter.delete('/repair-labour/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get existing labour entry to verify access and capture IDs for status update
    // Note: Use explicit FK for nested repair_items to avoid ambiguity with selected_option_id
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_labour')
      .select(`
        id,
        repair_item_id,
        repair_option_id,
        repair_item:repair_items(organization_id),
        repair_option:repair_options(
          id,
          repair_item:repair_items!repair_options_repair_item_id_fkey(organization_id)
        )
      `)
      .eq('id', id)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Labour entry not found' }, 404)
    }

    // Supabase returns joined tables as arrays, access first element
    const repairItem = Array.isArray(existing.repair_item) ? existing.repair_item[0] : existing.repair_item
    const repairOption = Array.isArray(existing.repair_option) ? existing.repair_option[0] : existing.repair_option
    const nestedRepairItemRaw = repairOption?.repair_item
    const nestedRepairItem = nestedRepairItemRaw && Array.isArray(nestedRepairItemRaw) ? nestedRepairItemRaw[0] : nestedRepairItemRaw
    const orgId = (repairItem as { organization_id?: string })?.organization_id ||
      (nestedRepairItem as { organization_id?: string })?.organization_id

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Labour entry not found' }, 404)
    }

    // Capture IDs before deletion for status recalculation
    const repairItemId = existing.repair_item_id
    const repairOptionId = existing.repair_option_id

    // Get health_check_id and item name for audit before deletion
    let healthCheckId: string | null = null
    let itemName: string | null = null
    const actualRepairItemId = repairItemId || repairOption?.id
    if (actualRepairItemId) {
      const { data: repairItemData } = await supabaseAdmin
        .from('repair_items')
        .select('health_check_id, name')
        .eq('id', actualRepairItemId)
        .single()
      healthCheckId = repairItemData?.health_check_id || null
      itemName = repairItemData?.name || null
    }

    // Get labour details before deletion for audit
    const { data: labourDetails } = await supabaseAdmin
      .from('repair_labour')
      .select(`
        hours, rate, total,
        labour_code:labour_codes(code, description)
      `)
      .eq('id', id)
      .single()

    // Extract labour_code (may be array from join)
    const labourCodeObj = labourDetails?.labour_code
    const labourCode = Array.isArray(labourCodeObj) ? labourCodeObj[0] : labourCodeObj

    const { error } = await supabaseAdmin
      .from('repair_labour')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete labour error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Log audit event for timeline
    logAudit({
      action: 'labour.delete',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_labour',
      resourceId: id,
      metadata: {
        labour_id: id,
        repair_item_id: actualRepairItemId,
        health_check_id: healthCheckId,
        item_name: itemName,
        labour_code: labourCode?.code || null,
        labour_description: labourCode?.description || null,
        hours: labourDetails ? parseFloat(labourDetails.hours) : null,
        total: labourDetails ? parseFloat(labourDetails.total) : null
      }
    })

    // Recalculate workflow status after deletion
    await updateRepairItemWorkflowStatus(repairItemId, repairOptionId)

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete labour error:', error)
    return c.json({ error: 'Failed to delete labour' }, 500)
  }
})

// POST /repair-items/:id/no-labour-required - Mark item as no labour required
labourRouter.post('/repair-items/:id/no-labour-required', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        no_labour_required: true,
        no_labour_required_by: auth.user.id,
        no_labour_required_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Mark no labour required error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      noLabourRequired: item.no_labour_required,
      noLabourRequiredBy: item.no_labour_required_by,
      noLabourRequiredAt: item.no_labour_required_at
    })
  } catch (error) {
    console.error('Mark no labour required error:', error)
    return c.json({ error: 'Failed to mark no labour required' }, 500)
  }
})

// DELETE /repair-items/:id/no-labour-required - Remove no labour required flag
labourRouter.delete('/repair-items/:id/no-labour-required', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        no_labour_required: false,
        no_labour_required_by: null,
        no_labour_required_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Remove no labour required error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Recalculate workflow status after removing the flag
    await updateRepairItemWorkflowStatus(id, null)

    return c.json({
      noLabourRequired: item.no_labour_required,
      noLabourRequiredBy: item.no_labour_required_by,
      noLabourRequiredAt: item.no_labour_required_at
    })
  } catch (error) {
    console.error('Remove no labour required error:', error)
    return c.json({ error: 'Failed to remove no labour required' }, 500)
  }
})

// POST /repair-items/:id/labour-complete - Mark labour complete
labourRouter.post('/repair-items/:id/labour-complete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Check if parts is already complete to auto-set quote status
    const { data: currentItem } = await supabaseAdmin
      .from('repair_items')
      .select('parts_status')
      .eq('id', id)
      .single()

    const updateData: Record<string, unknown> = {
      labour_status: 'complete',
      labour_completed_by: auth.user.id,
      labour_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Auto-set quote status to ready if parts is also complete
    if (currentItem?.parts_status === 'complete') {
      updateData.quote_status = 'ready'
    }

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Mark labour complete error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Get labour total for audit
    const { data: labourData } = await supabaseAdmin
      .from('repair_labour')
      .select('total')
      .eq('repair_item_id', id)

    const labourTotal = (labourData || []).reduce((sum, l) => sum + parseFloat(l.total), 0)

    // Log audit event for timeline
    logAudit({
      action: 'labour.complete',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        repair_item_id: id,
        health_check_id: existing.health_check_id,
        item_name: existing.name,
        labour_total: labourTotal
      }
    })

    return c.json({
      labourStatus: item.labour_status,
      labourCompletedBy: item.labour_completed_by,
      labourCompletedAt: item.labour_completed_at,
      quoteStatus: item.quote_status
    })
  } catch (error) {
    console.error('Mark labour complete error:', error)
    return c.json({ error: 'Failed to mark labour complete' }, 500)
  }
})

export default labourRouter
