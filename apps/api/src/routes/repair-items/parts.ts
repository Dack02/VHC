import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { verifyRepairItemAccess, verifyRepairOptionAccess, updateRepairItemWorkflowStatus } from './helpers.js'
import { logAudit } from '../../services/audit.js'

const partsRouter = new Hono()

// GET /repair-items/:id/parts - List parts for repair item
partsRouter.get('/repair-items/:id/parts', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const { data: parts, error } = await supabaseAdmin
      .from('repair_parts')
      .select('*')
      .eq('repair_item_id', id)

    if (error) {
      console.error('Get parts error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      parts: (parts || []).map(part => ({
        id: part.id,
        partNumber: part.part_number,
        description: part.description,
        quantity: parseFloat(part.quantity),
        supplierId: part.supplier_id,
        supplierName: part.supplier_name,
        costPrice: parseFloat(part.cost_price),
        sellPrice: parseFloat(part.sell_price),
        lineTotal: parseFloat(part.line_total),
        marginPercent: part.margin_percent ? parseFloat(part.margin_percent) : null,
        markupPercent: part.markup_percent ? parseFloat(part.markup_percent) : null,
        notes: part.notes,
        allocationType: part.allocation_type || 'direct',
        createdAt: part.created_at
      }))
    })
  } catch (error) {
    console.error('Get parts error:', error)
    return c.json({ error: 'Failed to get parts' }, 500)
  }
})

// POST /repair-items/:id/parts - Add part to repair item
partsRouter.post('/repair-items/:id/parts', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { part_number, description, quantity, supplier_id, cost_price, sell_price, notes, allocation_type } = body

    if (!description || cost_price === undefined || sell_price === undefined) {
      return c.json({ error: 'description, cost_price, and sell_price are required' }, 400)
    }

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const qty = parseFloat(quantity) || 1
    const costPriceNum = parseFloat(cost_price)
    const sellPriceNum = parseFloat(sell_price)
    const lineTotal = qty * sellPriceNum

    // Calculate margin and markup
    const marginPercent = sellPriceNum > 0 ? ((sellPriceNum - costPriceNum) / sellPriceNum) * 100 : 0
    const markupPercent = costPriceNum > 0 ? ((sellPriceNum - costPriceNum) / costPriceNum) * 100 : 0

    // Validate allocation_type if provided
    const validAllocationType = allocation_type === 'shared' || allocation_type === 'direct' ? allocation_type : 'direct'

    // Get supplier name if supplier_id provided
    let supplierName = null
    if (supplier_id) {
      const { data: supplier } = await supabaseAdmin
        .from('suppliers')
        .select('name')
        .eq('id', supplier_id)
        .single()
      supplierName = supplier?.name || null
    }

    const { data: part, error } = await supabaseAdmin
      .from('repair_parts')
      .insert({
        repair_item_id: id,
        part_number: part_number?.trim() || null,
        description: description.trim(),
        quantity: qty,
        supplier_id: supplier_id || null,
        supplier_name: supplierName,
        cost_price: costPriceNum,
        sell_price: sellPriceNum,
        line_total: lineTotal,
        margin_percent: marginPercent,
        markup_percent: markupPercent,
        notes: notes?.trim() || null,
        allocation_type: validAllocationType,
        created_by: auth.user.id
      })
      .select()
      .single()

    if (error) {
      console.error('Add part error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Auto-update workflow status
    await updateRepairItemWorkflowStatus(id, null)

    // Auto-transition health check from tech_completed → awaiting_pricing
    if (existing.health_check_id) {
      const { data: hc } = await supabaseAdmin
        .from('health_checks')
        .select('id, status')
        .eq('id', existing.health_check_id)
        .single()

      if (hc?.status === 'tech_completed') {
        await supabaseAdmin
          .from('health_checks')
          .update({ status: 'awaiting_pricing', updated_at: new Date().toISOString() })
          .eq('id', hc.id)
      }
    }

    // Log audit event for timeline
    logAudit({
      action: 'parts.add',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        part_id: part.id,
        repair_item_id: id,
        health_check_id: existing.health_check_id,
        item_name: existing.name,
        part_number: part.part_number,
        description: part.description,
        quantity: parseFloat(part.quantity),
        sell_price: parseFloat(part.sell_price),
        line_total: parseFloat(part.line_total)
      }
    })

    return c.json({
      id: part.id,
      partNumber: part.part_number,
      description: part.description,
      quantity: parseFloat(part.quantity),
      supplierId: part.supplier_id,
      supplierName: part.supplier_name,
      costPrice: parseFloat(part.cost_price),
      sellPrice: parseFloat(part.sell_price),
      lineTotal: parseFloat(part.line_total),
      marginPercent: parseFloat(part.margin_percent),
      markupPercent: parseFloat(part.markup_percent),
      notes: part.notes,
      allocationType: part.allocation_type || 'direct'
    }, 201)
  } catch (error) {
    console.error('Add part error:', error)
    return c.json({ error: 'Failed to add part' }, 500)
  }
})

// GET /repair-options/:id/parts - List parts for option
partsRouter.get('/repair-options/:id/parts', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairOptionAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair option not found' }, 404)
    }

    const { data: parts, error } = await supabaseAdmin
      .from('repair_parts')
      .select('*')
      .eq('repair_option_id', id)

    if (error) {
      console.error('Get option parts error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      parts: (parts || []).map(part => ({
        id: part.id,
        partNumber: part.part_number,
        description: part.description,
        quantity: parseFloat(part.quantity),
        supplierId: part.supplier_id,
        supplierName: part.supplier_name,
        costPrice: parseFloat(part.cost_price),
        sellPrice: parseFloat(part.sell_price),
        lineTotal: parseFloat(part.line_total),
        marginPercent: part.margin_percent ? parseFloat(part.margin_percent) : null,
        markupPercent: part.markup_percent ? parseFloat(part.markup_percent) : null,
        notes: part.notes,
        allocationType: part.allocation_type || 'direct'
      }))
    })
  } catch (error) {
    console.error('Get option parts error:', error)
    return c.json({ error: 'Failed to get parts' }, 500)
  }
})

// POST /repair-options/:id/parts - Add part to option
partsRouter.post('/repair-options/:id/parts', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { part_number, description, quantity, supplier_id, cost_price, sell_price, notes } = body

    if (!description || cost_price === undefined || sell_price === undefined) {
      return c.json({ error: 'description, cost_price, and sell_price are required' }, 400)
    }

    const existing = await verifyRepairOptionAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair option not found' }, 404)
    }

    const qty = parseFloat(quantity) || 1
    const costPriceNum = parseFloat(cost_price)
    const sellPriceNum = parseFloat(sell_price)
    const lineTotal = qty * sellPriceNum

    // Calculate margin and markup
    const marginPercent = sellPriceNum > 0 ? ((sellPriceNum - costPriceNum) / sellPriceNum) * 100 : 0
    const markupPercent = costPriceNum > 0 ? ((sellPriceNum - costPriceNum) / costPriceNum) * 100 : 0

    // Get supplier name if supplier_id provided
    let supplierName = null
    if (supplier_id) {
      const { data: supplier } = await supabaseAdmin
        .from('suppliers')
        .select('name')
        .eq('id', supplier_id)
        .single()
      supplierName = supplier?.name || null
    }

    const { data: part, error } = await supabaseAdmin
      .from('repair_parts')
      .insert({
        repair_option_id: id,
        part_number: part_number?.trim() || null,
        description: description.trim(),
        quantity: qty,
        supplier_id: supplier_id || null,
        supplier_name: supplierName,
        cost_price: costPriceNum,
        sell_price: sellPriceNum,
        line_total: lineTotal,
        margin_percent: marginPercent,
        markup_percent: markupPercent,
        notes: notes?.trim() || null,
        created_by: auth.user.id
      })
      .select()
      .single()

    if (error) {
      console.error('Add option part error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Auto-update workflow status (for option, pass null for repairItemId)
    await updateRepairItemWorkflowStatus(null, id)

    return c.json({
      id: part.id,
      partNumber: part.part_number,
      description: part.description,
      quantity: parseFloat(part.quantity),
      supplierId: part.supplier_id,
      supplierName: part.supplier_name,
      costPrice: parseFloat(part.cost_price),
      sellPrice: parseFloat(part.sell_price),
      lineTotal: parseFloat(part.line_total),
      marginPercent: parseFloat(part.margin_percent),
      markupPercent: parseFloat(part.markup_percent),
      notes: part.notes
    }, 201)
  } catch (error) {
    console.error('Add option part error:', error)
    return c.json({ error: 'Failed to add part' }, 500)
  }
})

// PATCH /repair-parts/:id - Update part
partsRouter.patch('/repair-parts/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { part_number, description, quantity, supplier_id, cost_price, sell_price, notes, allocation_type } = body

    console.log('[PATCH /repair-parts/:id] id:', id, 'auth.orgId:', auth.orgId)

    // Get existing part to verify access
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_parts')
      .select(`
        *,
        repair_item:repair_items!repair_parts_repair_item_id_fkey(organization_id),
        repair_option:repair_options!repair_parts_repair_option_id_fkey(
          repair_item:repair_items!repair_options_repair_item_id_fkey(organization_id)
        )
      `)
      .eq('id', id)
      .single()

    console.log('[PATCH /repair-parts/:id] existError:', existError, 'existing:', existing ? 'found' : 'null')

    if (existError || !existing) {
      console.log('[PATCH /repair-parts/:id] Part not found - existError:', existError)
      return c.json({ error: 'Part not found' }, 404)
    }

    // Supabase returns joined tables as arrays, access first element
    const repairItem = Array.isArray(existing.repair_item) ? existing.repair_item[0] : existing.repair_item
    const repairOption = Array.isArray(existing.repair_option) ? existing.repair_option[0] : existing.repair_option
    const nestedRepairItemRaw = repairOption?.repair_item
    const nestedRepairItem = nestedRepairItemRaw && Array.isArray(nestedRepairItemRaw) ? nestedRepairItemRaw[0] : nestedRepairItemRaw
    const orgId = (repairItem as { organization_id?: string })?.organization_id ||
      (nestedRepairItem as { organization_id?: string })?.organization_id

    console.log('[PATCH /repair-parts/:id] orgId from part:', orgId, 'auth.orgId:', auth.orgId)

    if (orgId !== auth.orgId) {
      console.log('[PATCH /repair-parts/:id] Org mismatch - part orgId:', orgId, 'user orgId:', auth.orgId)
      return c.json({ error: 'Part not found' }, 404)
    }

    const qty = quantity !== undefined ? parseFloat(quantity) : parseFloat(existing.quantity)
    const costPriceNum = cost_price !== undefined ? parseFloat(cost_price) : parseFloat(existing.cost_price)
    const sellPriceNum = sell_price !== undefined ? parseFloat(sell_price) : parseFloat(existing.sell_price)
    const lineTotal = qty * sellPriceNum

    // Calculate margin and markup
    const marginPercent = sellPriceNum > 0 ? ((sellPriceNum - costPriceNum) / sellPriceNum) * 100 : 0
    const markupPercent = costPriceNum > 0 ? ((sellPriceNum - costPriceNum) / costPriceNum) * 100 : 0

    const updateData: Record<string, unknown> = {
      quantity: qty,
      cost_price: costPriceNum,
      sell_price: sellPriceNum,
      line_total: lineTotal,
      margin_percent: marginPercent,
      markup_percent: markupPercent,
      updated_at: new Date().toISOString()
    }

    if (part_number !== undefined) updateData.part_number = part_number?.trim() || null
    if (description !== undefined) updateData.description = description.trim()
    if (notes !== undefined) updateData.notes = notes?.trim() || null
    if (allocation_type !== undefined && (allocation_type === 'shared' || allocation_type === 'direct')) {
      updateData.allocation_type = allocation_type
    }

    // Update supplier if changed
    if (supplier_id !== undefined) {
      updateData.supplier_id = supplier_id || null
      if (supplier_id) {
        const { data: supplier } = await supabaseAdmin
          .from('suppliers')
          .select('name')
          .eq('id', supplier_id)
          .single()
        updateData.supplier_name = supplier?.name || null
      } else {
        updateData.supplier_name = null
      }
    }

    const { data: part, error } = await supabaseAdmin
      .from('repair_parts')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update part error:', error)
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
      action: 'parts.update',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_parts',
      resourceId: id,
      metadata: {
        part_id: part.id,
        repair_item_id: repairItemId,
        health_check_id: healthCheckId,
        item_name: itemName,
        description: part.description,
        old_quantity: parseFloat(existing.quantity),
        new_quantity: parseFloat(part.quantity),
        old_sell_price: parseFloat(existing.sell_price),
        new_sell_price: parseFloat(part.sell_price),
        old_line_total: parseFloat(existing.line_total),
        new_line_total: parseFloat(part.line_total)
      }
    })

    return c.json({
      id: part.id,
      partNumber: part.part_number,
      description: part.description,
      quantity: parseFloat(part.quantity),
      supplierId: part.supplier_id,
      supplierName: part.supplier_name,
      costPrice: parseFloat(part.cost_price),
      sellPrice: parseFloat(part.sell_price),
      lineTotal: parseFloat(part.line_total),
      marginPercent: parseFloat(part.margin_percent),
      markupPercent: parseFloat(part.markup_percent),
      notes: part.notes,
      allocationType: part.allocation_type || 'direct'
    })
  } catch (error) {
    console.error('Update part error:', error)
    return c.json({ error: 'Failed to update part' }, 500)
  }
})

// PATCH /repair-parts/:id/allocation - Update part allocation type
partsRouter.patch('/repair-parts/:id/allocation', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { allocation_type, target_repair_item_id } = body

    if (!allocation_type || (allocation_type !== 'shared' && allocation_type !== 'direct')) {
      return c.json({ error: 'allocation_type must be "shared" or "direct"' }, 400)
    }

    // Get existing part to verify access
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_parts')
      .select(`
        *,
        repair_item:repair_items(organization_id, is_group, parent_repair_item_id)
      `)
      .eq('id', id)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Part not found' }, 404)
    }

    const repairItem = Array.isArray(existing.repair_item) ? existing.repair_item[0] : existing.repair_item
    const orgId = (repairItem as { organization_id?: string })?.organization_id

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Part not found' }, 404)
    }

    const updateData: Record<string, unknown> = {
      allocation_type,
      updated_at: new Date().toISOString()
    }

    // If moving to a different repair item (e.g., from shared to direct on a specific concern)
    if (target_repair_item_id && target_repair_item_id !== existing.repair_item_id) {
      // Verify the target repair item exists and belongs to the same org
      const { data: targetItem, error: targetError } = await supabaseAdmin
        .from('repair_items')
        .select('id, organization_id')
        .eq('id', target_repair_item_id)
        .single()

      if (targetError || !targetItem || targetItem.organization_id !== auth.orgId) {
        return c.json({ error: 'Target repair item not found' }, 404)
      }

      updateData.repair_item_id = target_repair_item_id
    }

    const { data: part, error } = await supabaseAdmin
      .from('repair_parts')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update part allocation error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: part.id,
      partNumber: part.part_number,
      description: part.description,
      quantity: parseFloat(part.quantity),
      supplierId: part.supplier_id,
      supplierName: part.supplier_name,
      costPrice: parseFloat(part.cost_price),
      sellPrice: parseFloat(part.sell_price),
      lineTotal: parseFloat(part.line_total),
      marginPercent: parseFloat(part.margin_percent),
      markupPercent: parseFloat(part.markup_percent),
      notes: part.notes,
      allocationType: part.allocation_type || 'direct',
      repairItemId: part.repair_item_id
    })
  } catch (error) {
    console.error('Update part allocation error:', error)
    return c.json({ error: 'Failed to update part allocation' }, 500)
  }
})

// DELETE /repair-parts/:id - Delete part
partsRouter.delete('/repair-parts/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get existing part to verify access and capture IDs for status update
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_parts')
      .select(`
        id,
        repair_item_id,
        repair_option_id,
        repair_item:repair_items!repair_parts_repair_item_id_fkey(organization_id),
        repair_option:repair_options!repair_parts_repair_option_id_fkey(
          id,
          repair_item_id,
          repair_item:repair_items!repair_options_repair_item_id_fkey(organization_id)
        )
      `)
      .eq('id', id)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Part not found' }, 404)
    }

    // Supabase returns joined tables as arrays, access first element
    const repairItem = Array.isArray(existing.repair_item) ? existing.repair_item[0] : existing.repair_item
    const repairOption = Array.isArray(existing.repair_option) ? existing.repair_option[0] : existing.repair_option
    const nestedRepairItemRaw = repairOption?.repair_item
    const nestedRepairItem = nestedRepairItemRaw && Array.isArray(nestedRepairItemRaw) ? nestedRepairItemRaw[0] : nestedRepairItemRaw
    const orgId = (repairItem as { organization_id?: string })?.organization_id ||
      (nestedRepairItem as { organization_id?: string })?.organization_id

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Part not found' }, 404)
    }

    // Capture IDs before deletion for status recalculation
    const repairItemId = existing.repair_item_id
    const repairOptionId = existing.repair_option_id

    // Get health_check_id and item name for audit before deletion
    let healthCheckId: string | null = null
    let itemName: string | null = null
    const actualRepairItemId = repairItemId || repairOption?.repair_item_id
    if (actualRepairItemId) {
      const { data: repairItemData } = await supabaseAdmin
        .from('repair_items')
        .select('health_check_id, name')
        .eq('id', actualRepairItemId)
        .single()
      healthCheckId = repairItemData?.health_check_id || null
      itemName = repairItemData?.name || null
    }

    // Get part details before deletion for audit
    const { data: partDetails } = await supabaseAdmin
      .from('repair_parts')
      .select('description, quantity, sell_price, line_total')
      .eq('id', id)
      .single()

    const { error } = await supabaseAdmin
      .from('repair_parts')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete part error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Log audit event for timeline
    logAudit({
      action: 'parts.delete',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_parts',
      resourceId: id,
      metadata: {
        part_id: id,
        repair_item_id: actualRepairItemId,
        health_check_id: healthCheckId,
        item_name: itemName,
        description: partDetails?.description || null,
        quantity: partDetails ? parseFloat(partDetails.quantity) : null,
        line_total: partDetails ? parseFloat(partDetails.line_total) : null
      }
    })

    // Recalculate workflow status after deletion
    await updateRepairItemWorkflowStatus(repairItemId, repairOptionId)

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete part error:', error)
    return c.json({ error: 'Failed to delete part' }, 500)
  }
})

// POST /repair-items/:id/no-parts-required - Mark item as no parts required
partsRouter.post('/repair-items/:id/no-parts-required', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
        no_parts_required: true,
        no_parts_required_by: auth.user.id,
        no_parts_required_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Mark no parts required error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      noPartsRequired: item.no_parts_required,
      noPartsRequiredBy: item.no_parts_required_by,
      noPartsRequiredAt: item.no_parts_required_at
    })
  } catch (error) {
    console.error('Mark no parts required error:', error)
    return c.json({ error: 'Failed to mark no parts required' }, 500)
  }
})

// DELETE /repair-items/:id/no-parts-required - Remove no parts required flag
partsRouter.delete('/repair-items/:id/no-parts-required', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
        no_parts_required: false,
        no_parts_required_by: null,
        no_parts_required_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Remove no parts required error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Recalculate workflow status after removing the flag
    await updateRepairItemWorkflowStatus(id, null)

    return c.json({
      noPartsRequired: item.no_parts_required,
      noPartsRequiredBy: item.no_parts_required_by,
      noPartsRequiredAt: item.no_parts_required_at
    })
  } catch (error) {
    console.error('Remove no parts required error:', error)
    return c.json({ error: 'Failed to remove no parts required' }, 500)
  }
})

// POST /repair-items/:id/parts-complete - Mark parts complete
partsRouter.post('/repair-items/:id/parts-complete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Check if labour is already complete to auto-set quote status
    const { data: currentItem } = await supabaseAdmin
      .from('repair_items')
      .select('labour_status')
      .eq('id', id)
      .single()

    const updateData: Record<string, unknown> = {
      parts_status: 'complete',
      parts_completed_by: auth.user.id,
      parts_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Auto-set quote status to ready if labour is also complete
    if (currentItem?.labour_status === 'complete') {
      updateData.quote_status = 'ready'
    }

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Mark parts complete error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Get parts total for audit
    const { data: partsData } = await supabaseAdmin
      .from('repair_parts')
      .select('line_total')
      .eq('repair_item_id', id)

    const partsTotal = (partsData || []).reduce((sum, p) => sum + parseFloat(p.line_total), 0)

    // Log audit event for timeline
    logAudit({
      action: 'parts.complete',
      actorId: auth.user.id,
      actorType: 'user',
      organizationId: auth.orgId,
      resourceType: 'repair_item',
      resourceId: id,
      metadata: {
        repair_item_id: id,
        health_check_id: existing.health_check_id,
        item_name: existing.name,
        parts_total: partsTotal
      }
    })

    return c.json({
      partsStatus: item.parts_status,
      partsCompletedBy: item.parts_completed_by,
      partsCompletedAt: item.parts_completed_at,
      quoteStatus: item.quote_status
    })
  } catch (error) {
    console.error('Mark parts complete error:', error)
    return c.json({ error: 'Failed to mark parts complete' }, 500)
  }
})

export default partsRouter
