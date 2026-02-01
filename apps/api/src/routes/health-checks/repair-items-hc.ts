import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { updateHealthCheckTotals } from './helpers.js'

const repairItemsHC = new Hono()

// POST /:hcId/repair-items/:itemId/work-done - Mark work as complete
repairItemsHC.post('/:hcId/repair-items/:itemId/work-done', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { hcId: healthCheckId, itemId } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Update repair item with work completion details
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        work_completed_at: new Date().toISOString(),
        work_completed_by: auth.user.id
      })
      .eq('id', itemId)
      .eq('health_check_id', healthCheckId)
      .select('id, work_completed_at, work_completed_by')
      .single()

    if (error) {
      console.error('[work-done POST] Supabase update error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        itemId,
        healthCheckId,
        userId: auth.user.id
      })
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      work_completed_at: updated.work_completed_at,
      work_completed_by: updated.work_completed_by
    })
  } catch (error) {
    console.error('Mark work complete error:', error)
    return c.json({ error: 'Failed to mark work as complete' }, 500)
  }
})

// DELETE /:hcId/repair-items/:itemId/work-done - Unmark work as complete
repairItemsHC.delete('/:hcId/repair-items/:itemId/work-done', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { hcId: healthCheckId, itemId } = c.req.param()

    console.log('[work-done DELETE] params:', { healthCheckId, itemId, orgId: auth.orgId })

    // Verify health check belongs to org
    const { data: healthCheck, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (hcError) {
      console.error('[work-done DELETE] Health check query error:', hcError)
      return c.json({ error: 'Health check query failed' }, 500)
    }

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Clear work completion details
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        work_completed_at: null,
        work_completed_by: null
      })
      .eq('id', itemId)
      .eq('health_check_id', healthCheckId)
      .select()
      .single()

    if (error) {
      console.error('[work-done DELETE] Update error:', error)
      return c.json({ error: error.message }, 500)
    }

    if (!updated) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    return c.json({
      id: updated.id,
      work_completed_at: null,
      work_completed_by: null
    })
  } catch (error) {
    console.error('[work-done DELETE] Unexpected error:', error)
    return c.json({ error: 'Failed to unmark work as complete' }, 500)
  }
})

// GET /:id/repair-items - Get all repair items for a health check
// NOTE: This uses the NEW repair_items schema (Phase 6+) with junction table for check results
repairItemsHC.get('/:id/repair-items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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

    // Query using NEW schema - repair_items with junction table for check results
    // Note: Using explicit FK hints because repair_items has two FKs to repair_options:
    // 1. repair_options.repair_item_id -> repair_items.id (one-to-many)
    // 2. repair_items.selected_option_id -> repair_options.id (many-to-one)
    // Only return top-level items (parent_repair_item_id is null) - children are included in their parent
    const { data: items, error } = await supabaseAdmin
      .from('repair_items')
      .select(`
        *,
        check_results:repair_item_check_results(
          check_result:check_results(
            id,
            rag_status,
            notes,
            template_item:template_items(id, name)
          )
        ),
        options:repair_options!repair_options_repair_item_id_fkey(
          id,
          name,
          description,
          labour_total,
          parts_total,
          subtotal,
          vat_amount,
          total_inc_vat,
          is_recommended,
          sort_order,
          parts:repair_parts!repair_parts_repair_option_id_fkey(
            id,
            part_number,
            description,
            quantity,
            supplier_id,
            supplier_name,
            cost_price,
            sell_price,
            line_total,
            margin_percent,
            markup_percent,
            notes,
            allocation_type
          )
        ),
        labour:repair_labour!repair_labour_repair_item_id_fkey(
          id,
          labour_code_id,
          hours,
          rate,
          discount_percent,
          total,
          is_vat_exempt,
          notes,
          labour_code:labour_codes(id, code, description)
        ),
        parts:repair_parts!repair_parts_repair_item_id_fkey(
          id,
          part_number,
          description,
          quantity,
          supplier_id,
          supplier_name,
          cost_price,
          sell_price,
          line_total,
          margin_percent,
          markup_percent,
          notes,
          allocation_type
        )
      `)
      .eq('health_check_id', id)
      .is('parent_repair_item_id', null)
      .order('created_at', { ascending: true })

    // Get children for groups (items with parent_repair_item_id)
    const { data: childItems } = await supabaseAdmin
      .from('repair_items')
      .select(`
        *,
        check_results:repair_item_check_results(
          check_result:check_results(
            id,
            rag_status,
            notes,
            template_item:template_items(id, name)
          )
        ),
        labour:repair_labour!repair_labour_repair_item_id_fkey(
          id,
          labour_code_id,
          hours,
          rate,
          discount_percent,
          total,
          is_vat_exempt,
          notes,
          labour_code:labour_codes(id, code, description)
        ),
        parts:repair_parts!repair_parts_repair_item_id_fkey(
          id,
          part_number,
          description,
          quantity,
          supplier_id,
          supplier_name,
          cost_price,
          sell_price,
          line_total,
          margin_percent,
          markup_percent,
          notes,
          allocation_type
        )
      `)
      .eq('health_check_id', id)
      .not('parent_repair_item_id', 'is', null)
      .order('created_at', { ascending: true })

    // Create a map of children by parent ID
    const childrenByParent = new Map<string, typeof childItems>()
    if (childItems) {
      for (const child of childItems) {
        const parentId = child.parent_repair_item_id
        if (!childrenByParent.has(parentId)) {
          childrenByParent.set(parentId, [])
        }
        childrenByParent.get(parentId)!.push(child)
      }
    }

    if (error) {
      console.error('Get repair items error:', error)
      return c.json({ error: error.message, details: error.details }, 500)
    }

    return c.json({
      repairItems: (items || []).map(item => {
        // Get children for this item if it's a group
        const children = childrenByParent.get(item.id) || []

        return {
          id: item.id,
          healthCheckId: item.health_check_id,
          name: item.name,
          description: item.description,
          isGroup: item.is_group,
          parentRepairItemId: item.parent_repair_item_id || null,
          labourTotal: parseFloat(item.labour_total) || 0,
          partsTotal: parseFloat(item.parts_total) || 0,
          subtotal: parseFloat(item.subtotal) || 0,
          vatAmount: parseFloat(item.vat_amount) || 0,
          totalIncVat: parseFloat(item.total_inc_vat) || 0,
          priceOverride: item.price_override ? parseFloat(item.price_override) : null,
          priceOverrideReason: item.price_override_reason,
          labourStatus: item.labour_status,
          partsStatus: item.parts_status,
          quoteStatus: item.quote_status,
          noLabourRequired: item.no_labour_required || false,
          noPartsRequired: item.no_parts_required || false,
          customerApproved: item.customer_approved,
          customerApprovedAt: item.customer_approved_at,
          customerDeclinedReason: item.customer_declined_reason,
          selectedOptionId: item.selected_option_id,
          followUpDate: item.follow_up_date || null,
          createdBy: item.created_by,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          // Source tracking for MRI items
          source: item.source || null,
          // RAG status - from stored value (for MRI items) or will be derived from checkResults on frontend
          ragStatus: item.rag_status || null,
          mriResultId: item.mri_result_id || null,
          checkResults: item.check_results?.map((cr: Record<string, unknown>) => {
            const checkResult = cr.check_result as Record<string, unknown>
            return {
              id: checkResult?.id,
              ragStatus: checkResult?.rag_status,
              notes: checkResult?.notes,
              templateItem: checkResult?.template_item
            }
          }) || [],
          options: item.options?.map((opt: Record<string, unknown>) => ({
            id: opt.id,
            name: opt.name,
            description: opt.description,
            labourTotal: parseFloat(opt.labour_total as string) || 0,
            partsTotal: parseFloat(opt.parts_total as string) || 0,
            subtotal: parseFloat(opt.subtotal as string) || 0,
            vatAmount: parseFloat(opt.vat_amount as string) || 0,
            totalIncVat: parseFloat(opt.total_inc_vat as string) || 0,
            isRecommended: opt.is_recommended,
            sortOrder: opt.sort_order,
            parts: ((opt.parts as Array<Record<string, unknown>>) || []).map((part: Record<string, unknown>) => ({
              id: part.id,
              partNumber: part.part_number,
              description: part.description,
              quantity: parseFloat(part.quantity as string),
              supplierId: part.supplier_id,
              supplierName: part.supplier_name,
              costPrice: parseFloat(part.cost_price as string),
              sellPrice: parseFloat(part.sell_price as string),
              lineTotal: parseFloat(part.line_total as string),
              marginPercent: part.margin_percent ? parseFloat(part.margin_percent as string) : null,
              markupPercent: part.markup_percent ? parseFloat(part.markup_percent as string) : null,
              notes: part.notes,
              allocationType: part.allocation_type || 'direct'
            }))
          })) || [],
          labour: item.labour?.map((lab: Record<string, unknown>) => ({
            id: lab.id,
            labourCodeId: lab.labour_code_id,
            labourCode: lab.labour_code,
            hours: parseFloat(lab.hours as string),
            rate: parseFloat(lab.rate as string),
            discountPercent: parseFloat(lab.discount_percent as string) || 0,
            total: parseFloat(lab.total as string),
            isVatExempt: lab.is_vat_exempt,
            notes: lab.notes
          })) || [],
          parts: item.parts?.map((part: Record<string, unknown>) => ({
            id: part.id,
            partNumber: part.part_number,
            description: part.description,
            quantity: parseFloat(part.quantity as string),
            supplierId: part.supplier_id,
            supplierName: part.supplier_name,
            costPrice: parseFloat(part.cost_price as string),
            sellPrice: parseFloat(part.sell_price as string),
            lineTotal: parseFloat(part.line_total as string),
            marginPercent: part.margin_percent ? parseFloat(part.margin_percent as string) : null,
            markupPercent: part.markup_percent ? parseFloat(part.markup_percent as string) : null,
            notes: part.notes,
            allocationType: part.allocation_type || 'direct'
          })) || [],
          // Include children for groups
          children: children.map((child: Record<string, unknown>) => ({
            id: child.id,
            healthCheckId: child.health_check_id,
            name: child.name,
            description: child.description,
            isGroup: child.is_group,
            parentRepairItemId: child.parent_repair_item_id,
            labourTotal: parseFloat(child.labour_total as string) || 0,
            partsTotal: parseFloat(child.parts_total as string) || 0,
            subtotal: parseFloat(child.subtotal as string) || 0,
            vatAmount: parseFloat(child.vat_amount as string) || 0,
            totalIncVat: parseFloat(child.total_inc_vat as string) || 0,
            labourStatus: child.labour_status,
            partsStatus: child.parts_status,
            quoteStatus: child.quote_status,
            noLabourRequired: child.no_labour_required || false,
            noPartsRequired: child.no_parts_required || false,
            createdAt: child.created_at,
            updatedAt: child.updated_at,
            checkResults: (child.check_results as Array<Record<string, unknown>>)?.map((cr: Record<string, unknown>) => {
              const checkResult = cr.check_result as Record<string, unknown>
              return {
                id: checkResult?.id,
                ragStatus: checkResult?.rag_status,
                notes: checkResult?.notes,
                templateItem: checkResult?.template_item
              }
            }) || [],
            labour: ((child.labour as Array<Record<string, unknown>>) || []).map((lab: Record<string, unknown>) => ({
              id: lab.id,
              labourCodeId: lab.labour_code_id,
              labourCode: lab.labour_code,
              hours: parseFloat(lab.hours as string),
              rate: parseFloat(lab.rate as string),
              discountPercent: parseFloat(lab.discount_percent as string) || 0,
              total: parseFloat(lab.total as string),
              isVatExempt: lab.is_vat_exempt,
              notes: lab.notes
            })),
            parts: ((child.parts as Array<Record<string, unknown>>) || []).map((part: Record<string, unknown>) => ({
              id: part.id,
              partNumber: part.part_number,
              description: part.description,
              quantity: parseFloat(part.quantity as string),
              supplierId: part.supplier_id,
              supplierName: part.supplier_name,
              costPrice: parseFloat(part.cost_price as string),
              sellPrice: parseFloat(part.sell_price as string),
              lineTotal: parseFloat(part.line_total as string),
              marginPercent: part.margin_percent ? parseFloat(part.margin_percent as string) : null,
              markupPercent: part.markup_percent ? parseFloat(part.markup_percent as string) : null,
              notes: part.notes,
              allocationType: part.allocation_type || 'direct'
            }))
          }))
        }
      })
    })
  } catch (error) {
    console.error('=== REPAIR ITEMS ERROR DETAIL ===')
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error as object)))
    return c.json({ error: 'Failed to get repair items' }, 500)
  }
})

// POST /:id/repair-items/generate - Auto-generate repair items from results
repairItemsHC.post('/:id/repair-items/generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get health check with results
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id, organization_id,
        results:check_results(
          id, rag_status, notes, is_mot_failure,
          template_item:template_items(name, description)
        )
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get existing linked check results via junction table to avoid duplicates
    const { data: existingLinks } = await supabaseAdmin
      .from('repair_item_check_results')
      .select('check_result_id, repair_item:repair_items!inner(health_check_id)')
      .eq('repair_item.health_check_id', id)

    const existingResultIds = new Set(existingLinks?.map(l => l.check_result_id) || [])

    // Filter to red/amber results that don't already have repair items
    const resultsToCreate = (healthCheck.results || []).filter(
      (r: { rag_status: string; id: string }) =>
        (r.rag_status === 'red' || r.rag_status === 'amber') &&
        !existingResultIds.has(r.id)
    )

    if (resultsToCreate.length === 0) {
      return c.json({ message: 'No new repair items to generate', created: 0 })
    }

    // Create repair items with new schema (name, not title; no check_result_id)
    const createdItems: { id: string; checkResultId: string }[] = []

    for (const result of resultsToCreate) {
      // Handle template_item which may be object or array from Supabase
      const templateItem = Array.isArray((result as Record<string, unknown>).template_item)
        ? ((result as Record<string, unknown>).template_item as Record<string, unknown>[])[0]
        : (result as Record<string, unknown>).template_item as Record<string, unknown>

      // Create the repair item
      const { data: repairItem, error: insertError } = await supabaseAdmin
        .from('repair_items')
        .insert({
          health_check_id: id,
          organization_id: healthCheck.organization_id,
          name: (templateItem?.name as string) || 'Repair Item',
          description: ((result as Record<string, unknown>).notes as string) ||
            (templateItem?.description as string) || null,
          is_group: false,
          labour_total: 0,
          parts_total: 0,
          subtotal: 0,
          vat_amount: 0,
          total_inc_vat: 0,
          labour_status: 'pending',
          parts_status: 'pending',
          quote_status: 'pending',
          created_by: auth.user.id
        })
        .select('id')
        .single()

      if (insertError || !repairItem) {
        console.error('Failed to create repair item:', insertError)
        continue
      }

      // Create junction table entry to link repair item to check result
      const { error: linkError } = await supabaseAdmin
        .from('repair_item_check_results')
        .insert({
          repair_item_id: repairItem.id,
          check_result_id: (result as { id: string }).id
        })

      if (linkError) {
        console.error('Failed to link repair item to check result:', linkError)
      }

      createdItems.push({
        id: repairItem.id,
        checkResultId: (result as { id: string }).id
      })
    }

    return c.json({
      message: `Generated ${createdItems.length} repair items`,
      created: createdItems.length,
      repairItems: createdItems
    })
  } catch (error) {
    console.error('Generate repair items error:', error)
    return c.json({ error: 'Failed to generate repair items' }, 500)
  }
})

// PATCH /:healthCheckId/repair-items/:itemId - Update repair item
repairItemsHC.patch('/:healthCheckId/repair-items/:itemId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, itemId } = c.req.param()
    const body = await c.req.json()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Map legacy field names to NEW schema columns
    const updateData: Record<string, unknown> = {}
    if (body.title !== undefined) updateData.name = body.title
    if (body.name !== undefined) updateData.name = body.name
    if (body.description !== undefined) updateData.description = body.description
    if (body.parts_cost !== undefined) updateData.parts_total = body.parts_cost
    if (body.parts_total !== undefined) updateData.parts_total = body.parts_total
    if (body.labor_cost !== undefined) updateData.labour_total = body.labor_cost
    if (body.labour_total !== undefined) updateData.labour_total = body.labour_total
    if (body.is_approved !== undefined) updateData.customer_approved = body.is_approved
    if (body.customer_approved !== undefined) updateData.customer_approved = body.customer_approved
    if (body.follow_up_date !== undefined) updateData.follow_up_date = body.follow_up_date

    // Handle total_price - if provided directly, use it; otherwise calculate from parts+labour
    if (body.total_price !== undefined || body.total_inc_vat !== undefined) {
      // Direct total price update
      updateData.total_inc_vat = body.total_inc_vat ?? body.total_price
    } else if (body.parts_cost !== undefined || body.labor_cost !== undefined ||
               body.parts_total !== undefined || body.labour_total !== undefined) {
      // Calculate total from parts + labour
      const { data: current } = await supabaseAdmin
        .from('repair_items')
        .select('parts_total, labour_total')
        .eq('id', itemId)
        .single()

      const parts = body.parts_cost ?? body.parts_total ?? current?.parts_total ?? 0
      const labour = body.labor_cost ?? body.labour_total ?? current?.labour_total ?? 0
      updateData.subtotal = parseFloat(String(parts)) + parseFloat(String(labour))
      // Note: VAT calculation would need to be done separately
      updateData.total_inc_vat = updateData.subtotal
    }

    // Ensure we have something to update
    if (Object.keys(updateData).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400)
    }

    // Always set updated_at timestamp
    updateData.updated_at = new Date().toISOString()

    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('health_check_id', healthCheckId)
      .select()
      .single()

    if (error) {
      console.error('Supabase update error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Update health check totals
    await updateHealthCheckTotals(healthCheckId)

    // Return data with BOTH legacy and new field names for compatibility
    return c.json({
      id: updated.id,
      // Legacy field names (for backward compatibility)
      title: updated.name,
      parts_cost: parseFloat(String(updated.parts_total)) || 0,
      labor_cost: parseFloat(String(updated.labour_total)) || 0,
      total_price: parseFloat(String(updated.total_inc_vat)) || 0,
      is_approved: updated.customer_approved,
      is_mot_failure: false,
      follow_up_date: updated.follow_up_date || null,
      work_completed_at: updated.work_completed_at,
      work_completed_by: updated.work_completed_by,
      // New field names
      name: updated.name,
      description: updated.description,
      parts_total: parseFloat(String(updated.parts_total)) || 0,
      labour_total: parseFloat(String(updated.labour_total)) || 0,
      total_inc_vat: parseFloat(String(updated.total_inc_vat)) || 0,
      customer_approved: updated.customer_approved
    })
  } catch (error) {
    console.error('Update repair item error:', error)
    return c.json({ error: 'Failed to update repair item' }, 500)
  }
})

// DELETE /:healthCheckId/repair-items/:itemId - Delete repair item
repairItemsHC.delete('/:healthCheckId/repair-items/:itemId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, itemId } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('repair_items')
      .delete()
      .eq('id', itemId)
      .eq('health_check_id', healthCheckId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Update health check totals
    await updateHealthCheckTotals(healthCheckId)

    return c.json({ message: 'Repair item deleted' })
  } catch (error) {
    console.error('Delete repair item error:', error)
    return c.json({ error: 'Failed to delete repair item' }, 500)
  }
})

export default repairItemsHC
