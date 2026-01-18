import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const repairItems = new Hono()

// Debug: log all requests to this router
repairItems.use('*', async (c, next) => {
  console.log(`[repair-items] ${c.req.method} ${c.req.path}`)
  await next()
})

repairItems.use('*', authMiddleware)

// Helper to verify health check access
async function verifyHealthCheckAccess(healthCheckId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, organization_id')
    .eq('id', healthCheckId)
    .eq('organization_id', orgId)
    .single()
  return data
}

// Helper to verify repair item access
async function verifyRepairItemAccess(repairItemId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('repair_items')
    .select('id, health_check_id, organization_id')
    .eq('id', repairItemId)
    .eq('organization_id', orgId)
    .single()
  return data
}

// Helper to verify repair option access
async function verifyRepairOptionAccess(optionId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('repair_options')
    .select(`
      id,
      repair_item_id,
      repair_item:repair_items!inner(organization_id)
    `)
    .eq('id', optionId)
    .single()

  // repair_item is returned as an array from the join, access first element
  const repairItem = Array.isArray(data?.repair_item) ? data.repair_item[0] : data?.repair_item
  if (!data || (repairItem as { organization_id?: string })?.organization_id !== orgId) {
    return null
  }
  return data
}

// Helper to auto-update repair item workflow status when labour/parts are added
async function updateRepairItemWorkflowStatus(repairItemId: string | null, repairOptionId: string | null) {
  if (!repairItemId && !repairOptionId) return

  // If it's from an option, get the parent repair item id
  let actualRepairItemId = repairItemId
  if (!actualRepairItemId && repairOptionId) {
    const { data: option } = await supabaseAdmin
      .from('repair_options')
      .select('repair_item_id')
      .eq('id', repairOptionId)
      .single()
    actualRepairItemId = option?.repair_item_id || null
  }

  if (!actualRepairItemId) return

  // Get current repair item status
  const { data: repairItem } = await supabaseAdmin
    .from('repair_items')
    .select('labour_status, parts_status, quote_status')
    .eq('id', actualRepairItemId)
    .single()

  if (!repairItem) return

  // Check if there's any labour
  const { count: labourCount } = await supabaseAdmin
    .from('repair_labour')
    .select('*', { count: 'exact', head: true })
    .eq('repair_item_id', actualRepairItemId)

  // Check if there's any labour in options
  const { data: options } = await supabaseAdmin
    .from('repair_options')
    .select('id')
    .eq('repair_item_id', actualRepairItemId)

  let optionLabourCount = 0
  if (options && options.length > 0) {
    const optionIds = options.map(o => o.id)
    const { count } = await supabaseAdmin
      .from('repair_labour')
      .select('*', { count: 'exact', head: true })
      .in('repair_option_id', optionIds)
    optionLabourCount = count || 0
  }

  const totalLabourCount = (labourCount || 0) + optionLabourCount

  // Check if there are any parts
  const { count: partsCount } = await supabaseAdmin
    .from('repair_parts')
    .select('*', { count: 'exact', head: true })
    .eq('repair_item_id', actualRepairItemId)

  let optionPartsCount = 0
  if (options && options.length > 0) {
    const optionIds = options.map(o => o.id)
    const { count } = await supabaseAdmin
      .from('repair_parts')
      .select('*', { count: 'exact', head: true })
      .in('repair_option_id', optionIds)
    optionPartsCount = count || 0
  }

  const totalPartsCount = (partsCount || 0) + optionPartsCount

  // Determine new statuses
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }

  // Labour status: pending → in_progress when labour added
  if (totalLabourCount > 0 && repairItem.labour_status === 'pending') {
    updateData.labour_status = 'in_progress'
  }

  // Parts status: pending → in_progress when parts added
  if (totalPartsCount > 0 && repairItem.parts_status === 'pending') {
    updateData.parts_status = 'in_progress'
  }

  // Quote status: pending → ready when both labour and parts are complete
  if (repairItem.labour_status === 'complete' && repairItem.parts_status === 'complete' && repairItem.quote_status === 'pending') {
    updateData.quote_status = 'ready'
  }

  // Only update if there are changes
  if (Object.keys(updateData).length > 1) {
    await supabaseAdmin
      .from('repair_items')
      .update(updateData)
      .eq('id', actualRepairItemId)
  }
}

// Helper to format repair item response
function formatRepairItem(item: Record<string, unknown>) {
  return {
    id: item.id,
    healthCheckId: item.health_check_id,
    name: item.name,
    description: item.description,
    isGroup: item.is_group,
    parentRepairItemId: item.parent_repair_item_id || null,
    labourTotal: parseFloat(item.labour_total as string) || 0,
    partsTotal: parseFloat(item.parts_total as string) || 0,
    subtotal: parseFloat(item.subtotal as string) || 0,
    vatAmount: parseFloat(item.vat_amount as string) || 0,
    totalIncVat: parseFloat(item.total_inc_vat as string) || 0,
    priceOverride: item.price_override ? parseFloat(item.price_override as string) : null,
    priceOverrideReason: item.price_override_reason,
    labourStatus: item.labour_status,
    partsStatus: item.parts_status,
    quoteStatus: item.quote_status,
    customerApproved: item.customer_approved,
    customerApprovedAt: item.customer_approved_at,
    customerDeclinedReason: item.customer_declined_reason,
    selectedOptionId: item.selected_option_id,
    createdBy: item.created_by,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    labourCompletedBy: item.labour_completed_by,
    labourCompletedAt: item.labour_completed_at,
    partsCompletedBy: item.parts_completed_by,
    partsCompletedAt: item.parts_completed_at,
    noLabourRequired: item.no_labour_required || false,
    noLabourRequiredBy: item.no_labour_required_by,
    noLabourRequiredAt: item.no_labour_required_at
  }
}

// ============================================================================
// REPAIR ITEMS ENDPOINTS
// ============================================================================

// GET /api/v1/health-checks/:id/repair-items - List all repair items for health check
repairItems.get('/health-checks/:id/repair-items', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get repair items with related data
    // Note: We use explicit FK hints because repair_items has two FKs to repair_options:
    // 1. repair_options.repair_item_id -> repair_items.id (one-to-many, what we want)
    // 2. repair_items.selected_option_id -> repair_options.id (many-to-one, for selected)
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
          sort_order
        ),
        labour:repair_labour!repair_labour_repair_item_id_fkey(
          id,
          labour_code_id,
          hours,
          rate,
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
          notes
        )
      `)
      .eq('health_check_id', id)
      .is('parent_repair_item_id', null)
      .order('created_at', { ascending: true })

    // Get children for groups (items with parent_repair_item_id)
    // Include labour data so children can have labour assigned individually
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
          total,
          is_vat_exempt,
          notes,
          labour_code:labour_codes(id, code, description)
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
      console.error('Error details:', JSON.stringify(error, null, 2))
      // If error is related to missing related tables, return empty array
      if (error.message.includes('does not exist')) {
        return c.json({ repairItems: [], migrationPending: true })
      }
      return c.json({ error: error.message, details: error.details || error.hint }, 500)
    }

    return c.json({
      repairItems: (items || []).map(item => {
        // Get children for this item if it's a group
        const children = childrenByParent.get(item.id) || []

        return {
          ...formatRepairItem(item),
          checkResults: item.check_results?.map((cr: Record<string, unknown>) => ({
            id: (cr.check_result as Record<string, unknown>)?.id,
            ragStatus: (cr.check_result as Record<string, unknown>)?.rag_status,
            notes: (cr.check_result as Record<string, unknown>)?.notes,
            templateItem: (cr.check_result as Record<string, unknown>)?.template_item
          })) || [],
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
            sortOrder: opt.sort_order
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
            notes: part.notes
          })) || [],
          // Include children for groups with their labour data
          children: children.map((child: Record<string, unknown>) => ({
            ...formatRepairItem(child),
            checkResults: (child.check_results as Array<Record<string, unknown>>)?.map((cr: Record<string, unknown>) => ({
              id: (cr.check_result as Record<string, unknown>)?.id,
              ragStatus: (cr.check_result as Record<string, unknown>)?.rag_status,
              notes: (cr.check_result as Record<string, unknown>)?.notes,
              templateItem: (cr.check_result as Record<string, unknown>)?.template_item
            })) || [],
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
            }))
          }))
        }
      })
    })
  } catch (error) {
    console.error('=== REPAIR ITEMS ERROR ===')
    console.error('Error:', error)
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown')
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack')
    return c.json({
      error: 'Failed to get repair items',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, 500)
  }
})

// POST /api/v1/health-checks/:id/repair-items - Create repair item
repairItems.post('/health-checks/:id/repair-items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, description, is_group, check_result_ids } = body

    if (!name || !name.trim()) {
      return c.json({ error: 'Name is required' }, 400)
    }

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Create repair item
    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .insert({
        health_check_id: id,
        organization_id: auth.orgId,
        name: name.trim(),
        description: description?.trim() || null,
        is_group: is_group || false,
        created_by: auth.user.id
      })
      .select()
      .single()

    if (error) {
      console.error('Create repair item error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Link check results if provided
    if (check_result_ids && Array.isArray(check_result_ids) && check_result_ids.length > 0) {
      // Find existing repair items linked to these check results
      const { data: existingLinks } = await supabaseAdmin
        .from('repair_item_check_results')
        .select('repair_item_id, check_result_id')
        .in('check_result_id', check_result_ids)

      // Track which check_result_ids already have repair items linked
      const linkedCheckResultIds = new Set(existingLinks?.map(l => l.check_result_id) || [])
      const unlinkedCheckResultIds = check_result_ids.filter((crId: string) => !linkedCheckResultIds.has(crId))

      console.log(`[Group Creation] is_group=${is_group}, total check_result_ids=${check_result_ids.length}, linked=${linkedCheckResultIds.size}, unlinked=${unlinkedCheckResultIds.length}`)

      if (existingLinks && existingLinks.length > 0 && is_group) {
        // Get unique repair item IDs to re-parent
        const repairItemIdsToReparent = [...new Set(existingLinks.map(l => l.repair_item_id))]

        // Get the repair items with their labour/parts to check for migration
        const { data: itemsToReparent } = await supabaseAdmin
          .from('repair_items')
          .select(`
            id,
            is_group,
            labour_total,
            parts_total,
            labour:repair_labour!repair_labour_repair_item_id_fkey(id, labour_code_id, hours, rate, total, is_vat_exempt, notes, created_by),
            parts:repair_parts!repair_parts_repair_item_id_fkey(id, part_number, description, quantity, supplier_id, supplier_name, cost_price, sell_price, line_total, margin_percent, markup_percent, notes, created_by)
          `)
          .in('id', repairItemIdsToReparent)
          .eq('health_check_id', id)
          .eq('is_group', false) // Only individual items can become children

        if (itemsToReparent && itemsToReparent.length > 0) {
          const idsToReparent = itemsToReparent.map(ri => ri.id)

          // Re-parent existing items to the new group (instead of deleting)
          const { error: reparentError } = await supabaseAdmin
            .from('repair_items')
            .update({ parent_repair_item_id: item.id, updated_at: new Date().toISOString() })
            .in('id', idsToReparent)

          if (reparentError) {
            console.error('Failed to re-parent repair items:', reparentError)
          } else {
            console.log(`Re-parented ${idsToReparent.length} repair items to group ${item.id}`)
          }

          // Check if any have labour/parts that need to be migrated to a "Standard" option
          const itemsWithPricing = itemsToReparent.filter(ri =>
            (ri.labour && ri.labour.length > 0) || (ri.parts && ri.parts.length > 0)
          )

          if (itemsWithPricing.length > 0) {
            // Create "Standard" option on the group
            const { data: standardOption, error: optionError } = await supabaseAdmin
              .from('repair_options')
              .insert({
                repair_item_id: item.id,
                name: 'Standard',
                description: 'Migrated from individual items',
                is_recommended: true,
                sort_order: 1
              })
              .select()
              .single()

            if (optionError) {
              console.error('Failed to create Standard option:', optionError)
            } else if (standardOption) {
              // Migrate labour entries to the option
              for (const ri of itemsWithPricing) {
                if (ri.labour && ri.labour.length > 0) {
                  for (const lab of ri.labour) {
                    await supabaseAdmin
                      .from('repair_labour')
                      .insert({
                        repair_option_id: standardOption.id,
                        labour_code_id: lab.labour_code_id,
                        hours: lab.hours,
                        rate: lab.rate,
                        total: lab.total,
                        is_vat_exempt: lab.is_vat_exempt,
                        notes: lab.notes ? `[From: ${ri.id}] ${lab.notes}` : `[Migrated from child item]`,
                        created_by: lab.created_by
                      })

                    // Delete original labour entry from child
                    await supabaseAdmin
                      .from('repair_labour')
                      .delete()
                      .eq('id', lab.id)
                  }
                }

                if (ri.parts && ri.parts.length > 0) {
                  for (const part of ri.parts) {
                    await supabaseAdmin
                      .from('repair_parts')
                      .insert({
                        repair_option_id: standardOption.id,
                        part_number: part.part_number,
                        description: part.description,
                        quantity: part.quantity,
                        supplier_id: part.supplier_id,
                        supplier_name: part.supplier_name,
                        cost_price: part.cost_price,
                        sell_price: part.sell_price,
                        line_total: part.line_total,
                        margin_percent: part.margin_percent,
                        markup_percent: part.markup_percent,
                        notes: part.notes ? `[From: ${ri.id}] ${part.notes}` : `[Migrated from child item]`,
                        created_by: part.created_by
                      })

                    // Delete original part entry from child
                    await supabaseAdmin
                      .from('repair_parts')
                      .delete()
                      .eq('id', part.id)
                  }
                }
              }
              console.log(`Migrated pricing from ${itemsWithPricing.length} items to Standard option`)
            }
          }
        }
      }

      // FIX: For groups, create child repair items for check results that don't have repair items yet
      if (is_group && unlinkedCheckResultIds.length > 0) {
        console.log(`[Group Creation] Group ID: ${item.id}, Creating ${unlinkedCheckResultIds.length} child repair items for unlinked check results`)

        // Get the check results with their template items to get names
        const { data: checkResults, error: crError } = await supabaseAdmin
          .from('check_results')
          .select('id, template_item:template_items(id, name)')
          .in('id', unlinkedCheckResultIds)

        if (crError) {
          console.error('Failed to fetch check results for child creation:', crError)
        } else if (checkResults && checkResults.length > 0) {
          for (const cr of checkResults) {
            const childName = (cr.template_item as any)?.name || 'Unknown Item'

            console.log(`[Group Creation] Creating child "${childName}" with parent_repair_item_id=${item.id}`)

            // Create child repair item linked to the group
            const { data: childItem, error: childError } = await supabaseAdmin
              .from('repair_items')
              .insert({
                health_check_id: id,
                organization_id: auth.orgId,
                name: childName,
                is_group: false,
                parent_repair_item_id: item.id, // Link to parent group
                created_by: auth.user.id
              })
              .select()
              .single()

            if (childError) {
              console.error(`Failed to create child repair item for check result ${cr.id}:`, childError)
              console.error(`Error details:`, JSON.stringify(childError, null, 2))
              continue
            }

            console.log(`[Group Creation] Created child repair item ${childItem.id} (${childName}) with parent=${childItem.parent_repair_item_id} for check result ${cr.id}`)

            // Link the CHILD (not the group) to the check result
            const { error: linkChildError } = await supabaseAdmin
              .from('repair_item_check_results')
              .insert({
                repair_item_id: childItem.id,
                check_result_id: cr.id
              })

            if (linkChildError) {
              console.error(`Failed to link child ${childItem.id} to check result ${cr.id}:`, linkChildError)
            }
          }
        }
      }

      // FIX: Only create direct links for non-group items
      // Groups don't own check result links directly - their children do
      if (!is_group) {
        const links = check_result_ids.map((crId: string) => ({
          repair_item_id: item.id,
          check_result_id: crId
        }))

        const { error: linkError } = await supabaseAdmin
          .from('repair_item_check_results')
          .insert(links)

        if (linkError) {
          console.error('Link check results error:', linkError)
          // Don't fail the whole operation, just log the error
        }
      } else {
        console.log(`[Group Creation] Skipping direct check_result links for group ${item.id} - children own the links`)
      }
    }

    return c.json(formatRepairItem(item), 201)
  } catch (error) {
    console.error('Create repair item error:', error)
    return c.json({ error: 'Failed to create repair item' }, 500)
  }
})

// GET /api/v1/repair-items/:id - Get single repair item with all related data
repairItems.get('/repair-items/:id', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: item, error } = await supabaseAdmin
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
          *,
          labour:repair_labour!repair_labour_repair_option_id_fkey(
            *,
            labour_code:labour_codes(id, code, description)
          ),
          parts:repair_parts!repair_parts_repair_option_id_fkey(*)
        ),
        labour:repair_labour!repair_labour_repair_item_id_fkey(
          *,
          labour_code:labour_codes(id, code, description)
        ),
        parts:repair_parts!repair_parts_repair_item_id_fkey(*)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !item) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    return c.json({
      ...formatRepairItem(item),
      checkResults: item.check_results?.map((cr: Record<string, unknown>) => ({
        id: (cr.check_result as Record<string, unknown>)?.id,
        ragStatus: (cr.check_result as Record<string, unknown>)?.rag_status,
        notes: (cr.check_result as Record<string, unknown>)?.notes,
        templateItem: (cr.check_result as Record<string, unknown>)?.template_item
      })) || [],
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
        labour: (opt.labour as Record<string, unknown>[])?.map(lab => ({
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
        parts: (opt.parts as Record<string, unknown>[])?.map(part => ({
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
          notes: part.notes
        })) || []
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
        notes: part.notes
      })) || []
    })
  } catch (error) {
    console.error('Get repair item error:', error)
    return c.json({ error: 'Failed to get repair item' }, 500)
  }
})

// PATCH /api/v1/repair-items/:id - Update repair item
repairItems.patch('/repair-items/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, description, price_override, price_override_reason } = body

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (price_override !== undefined) updateData.price_override = price_override
    if (price_override_reason !== undefined) updateData.price_override_reason = price_override_reason

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update repair item error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json(formatRepairItem(item))
  } catch (error) {
    console.error('Update repair item error:', error)
    return c.json({ error: 'Failed to update repair item' }, 500)
  }
})

// DELETE /api/v1/repair-items/:id - Delete repair item
repairItems.delete('/repair-items/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Check if the item has been customer-approved
    const { data: item } = await supabaseAdmin
      .from('repair_items')
      .select('customer_approved')
      .eq('id', id)
      .single()

    if (item?.customer_approved === true) {
      return c.json({ error: 'Cannot delete a repair item that has been approved by the customer' }, 403)
    }

    // Delete cascades to check_results links, options, labour, parts
    const { error } = await supabaseAdmin
      .from('repair_items')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete repair item error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete repair item error:', error)
    return c.json({ error: 'Failed to delete repair item' }, 500)
  }
})

// POST /api/v1/repair-items/:id/ungroup - Ungroup a repair group back to individual items
repairItems.post('/repair-items/:id/ungroup', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Verify it's a group
    const { data: group } = await supabaseAdmin
      .from('repair_items')
      .select('id, is_group, labour_total, parts_total')
      .eq('id', id)
      .single()

    if (!group?.is_group) {
      return c.json({ error: 'Can only ungroup repair groups' }, 400)
    }

    // Get all children of this group
    const { data: children } = await supabaseAdmin
      .from('repair_items')
      .select('id')
      .eq('parent_repair_item_id', id)

    if (!children || children.length === 0) {
      return c.json({ error: 'No children to ungroup' }, 400)
    }

    // Set parent to null for all children (ungroup them)
    const childIds = children.map(c => c.id)
    const { error: ungroupError } = await supabaseAdmin
      .from('repair_items')
      .update({ parent_repair_item_id: null, updated_at: new Date().toISOString() })
      .in('id', childIds)

    if (ungroupError) {
      console.error('Ungroup error:', ungroupError)
      return c.json({ error: ungroupError.message }, 500)
    }

    // Remove check result links from the group (they stay on children)
    await supabaseAdmin
      .from('repair_item_check_results')
      .delete()
      .eq('repair_item_id', id)

    // Check if group has its own pricing data
    const groupHasPricing = (parseFloat(group.labour_total) || 0) > 0 || (parseFloat(group.parts_total) || 0) > 0

    // Check if group has options with pricing
    const { data: options } = await supabaseAdmin
      .from('repair_options')
      .select('id, labour_total, parts_total')
      .eq('repair_item_id', id)

    const optionsHavePricing = options?.some(opt =>
      (parseFloat(opt.labour_total) || 0) > 0 || (parseFloat(opt.parts_total) || 0) > 0
    )

    if (!groupHasPricing && !optionsHavePricing) {
      // Delete the empty group
      const { error: deleteError } = await supabaseAdmin
        .from('repair_items')
        .delete()
        .eq('id', id)

      if (deleteError) {
        console.error('Delete group error:', deleteError)
        // Non-fatal - group is already ungrouped
      }

      return c.json({ success: true, groupDeleted: true, ungroupedCount: childIds.length })
    }

    // Group has pricing, keep it but mark as not a group
    await supabaseAdmin
      .from('repair_items')
      .update({ is_group: false, updated_at: new Date().toISOString() })
      .eq('id', id)

    return c.json({ success: true, groupDeleted: false, ungroupedCount: childIds.length })
  } catch (error) {
    console.error('Ungroup error:', error)
    return c.json({ error: 'Failed to ungroup' }, 500)
  }
})

// ============================================================================
// CHECK RESULTS LINKING ENDPOINTS
// ============================================================================

// POST /api/v1/repair-items/:id/check-results - Link check result
repairItems.post('/repair-items/:id/check-results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { check_result_id } = body

    if (!check_result_id) {
      return c.json({ error: 'check_result_id is required' }, 400)
    }

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const { data: link, error } = await supabaseAdmin
      .from('repair_item_check_results')
      .insert({
        repair_item_id: id,
        check_result_id
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'Check result already linked' }, 409)
      }
      console.error('Link check result error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ id: link.id }, 201)
  } catch (error) {
    console.error('Link check result error:', error)
    return c.json({ error: 'Failed to link check result' }, 500)
  }
})

// DELETE /api/v1/repair-items/:id/check-results/:checkResultId - Unlink check result
repairItems.delete('/repair-items/:id/check-results/:checkResultId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, checkResultId } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('repair_item_check_results')
      .delete()
      .eq('repair_item_id', id)
      .eq('check_result_id', checkResultId)

    if (error) {
      console.error('Unlink check result error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Unlink check result error:', error)
    return c.json({ error: 'Failed to unlink check result' }, 500)
  }
})

// ============================================================================
// REPAIR OPTIONS ENDPOINTS
// ============================================================================

// GET /api/v1/repair-items/:id/options - List options
repairItems.get('/repair-items/:id/options', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const { data: options, error } = await supabaseAdmin
      .from('repair_options')
      .select(`
        *,
        labour:repair_labour!repair_labour_repair_option_id_fkey(
          *,
          labour_code:labour_codes(id, code, description)
        ),
        parts:repair_parts!repair_parts_repair_option_id_fkey(*)
      `)
      .eq('repair_item_id', id)
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Get repair options error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      options: (options || []).map(opt => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        labourTotal: parseFloat(opt.labour_total) || 0,
        partsTotal: parseFloat(opt.parts_total) || 0,
        subtotal: parseFloat(opt.subtotal) || 0,
        vatAmount: parseFloat(opt.vat_amount) || 0,
        totalIncVat: parseFloat(opt.total_inc_vat) || 0,
        isRecommended: opt.is_recommended,
        sortOrder: opt.sort_order,
        labour: opt.labour?.map((lab: Record<string, unknown>) => ({
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
        parts: opt.parts?.map((part: Record<string, unknown>) => ({
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
          notes: part.notes
        })) || []
      }))
    })
  } catch (error) {
    console.error('Get repair options error:', error)
    return c.json({ error: 'Failed to get repair options' }, 500)
  }
})

// POST /api/v1/repair-items/:id/options - Create option
repairItems.post('/repair-items/:id/options', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, description, is_recommended } = body

    if (!name || !name.trim()) {
      return c.json({ error: 'Name is required' }, 400)
    }

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Get next sort order
    const { data: maxSort } = await supabaseAdmin
      .from('repair_options')
      .select('sort_order')
      .eq('repair_item_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const { data: option, error } = await supabaseAdmin
      .from('repair_options')
      .insert({
        repair_item_id: id,
        name: name.trim(),
        description: description?.trim() || null,
        is_recommended: is_recommended || false,
        sort_order: (maxSort?.sort_order || 0) + 1
      })
      .select()
      .single()

    if (error) {
      console.error('Create repair option error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: option.id,
      name: option.name,
      description: option.description,
      labourTotal: 0,
      partsTotal: 0,
      subtotal: 0,
      vatAmount: 0,
      totalIncVat: 0,
      isRecommended: option.is_recommended,
      sortOrder: option.sort_order
    }, 201)
  } catch (error) {
    console.error('Create repair option error:', error)
    return c.json({ error: 'Failed to create repair option' }, 500)
  }
})

// PATCH /api/v1/repair-options/:id - Update option
repairItems.patch('/repair-options/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, description, is_recommended, sort_order } = body

    const existing = await verifyRepairOptionAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair option not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (is_recommended !== undefined) updateData.is_recommended = is_recommended
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data: option, error } = await supabaseAdmin
      .from('repair_options')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update repair option error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: option.id,
      name: option.name,
      description: option.description,
      labourTotal: parseFloat(option.labour_total) || 0,
      partsTotal: parseFloat(option.parts_total) || 0,
      subtotal: parseFloat(option.subtotal) || 0,
      vatAmount: parseFloat(option.vat_amount) || 0,
      totalIncVat: parseFloat(option.total_inc_vat) || 0,
      isRecommended: option.is_recommended,
      sortOrder: option.sort_order
    })
  } catch (error) {
    console.error('Update repair option error:', error)
    return c.json({ error: 'Failed to update repair option' }, 500)
  }
})

// DELETE /api/v1/repair-options/:id - Delete option
repairItems.delete('/repair-options/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairOptionAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair option not found' }, 404)
    }

    // Delete cascades to labour and parts
    const { error } = await supabaseAdmin
      .from('repair_options')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete repair option error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete repair option error:', error)
    return c.json({ error: 'Failed to delete repair option' }, 500)
  }
})

// POST /api/v1/repair-items/:id/select-option - Set selected option
repairItems.post('/repair-items/:id/select-option', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { option_id } = body

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Verify option belongs to this repair item (if option_id provided)
    if (option_id) {
      const { data: option } = await supabaseAdmin
        .from('repair_options')
        .select('id')
        .eq('id', option_id)
        .eq('repair_item_id', id)
        .single()

      if (!option) {
        return c.json({ error: 'Option not found for this repair item' }, 404)
      }
    }

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        selected_option_id: option_id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Select option error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ selectedOptionId: item.selected_option_id })
  } catch (error) {
    console.error('Select option error:', error)
    return c.json({ error: 'Failed to select option' }, 500)
  }
})

// ============================================================================
// LABOUR ENDPOINTS
// ============================================================================

// GET /api/v1/repair-items/:id/labour - List labour for repair item
repairItems.get('/repair-items/:id/labour', async (c) => {
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

// POST /api/v1/repair-items/:id/labour - Add labour to repair item
repairItems.post('/repair-items/:id/labour', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// GET /api/v1/repair-options/:id/labour - List labour for option
repairItems.get('/repair-options/:id/labour', async (c) => {
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

// POST /api/v1/repair-options/:id/labour - Add labour to option
repairItems.post('/repair-options/:id/labour', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// PATCH /api/v1/repair-labour/:id - Update labour entry
repairItems.patch('/repair-labour/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { labour_code_id, hours, notes, discount_percent } = body

    // Get existing labour entry
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_labour')
      .select(`
        *,
        repair_item:repair_items(organization_id),
        repair_option:repair_options(
          repair_item:repair_items(organization_id)
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

// DELETE /api/v1/repair-labour/:id - Delete labour entry
repairItems.delete('/repair-labour/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get existing labour entry to verify access
    // Note: Use explicit FK for nested repair_items to avoid ambiguity with selected_option_id
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_labour')
      .select(`
        id,
        repair_item:repair_items(organization_id),
        repair_option:repair_options(
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

    const { error } = await supabaseAdmin
      .from('repair_labour')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete labour error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete labour error:', error)
    return c.json({ error: 'Failed to delete labour' }, 500)
  }
})

// ============================================================================
// PARTS ENDPOINTS
// ============================================================================

// GET /api/v1/repair-items/:id/parts - List parts for repair item
repairItems.get('/repair-items/:id/parts', async (c) => {
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
        createdAt: part.created_at
      }))
    })
  } catch (error) {
    console.error('Get parts error:', error)
    return c.json({ error: 'Failed to get parts' }, 500)
  }
})

// POST /api/v1/repair-items/:id/parts - Add part to repair item
repairItems.post('/repair-items/:id/parts', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { part_number, description, quantity, supplier_id, cost_price, sell_price, notes } = body

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
    console.error('Add part error:', error)
    return c.json({ error: 'Failed to add part' }, 500)
  }
})

// GET /api/v1/repair-options/:id/parts - List parts for option
repairItems.get('/repair-options/:id/parts', async (c) => {
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
        notes: part.notes
      }))
    })
  } catch (error) {
    console.error('Get option parts error:', error)
    return c.json({ error: 'Failed to get parts' }, 500)
  }
})

// POST /api/v1/repair-options/:id/parts - Add part to option
repairItems.post('/repair-options/:id/parts', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// PATCH /api/v1/repair-parts/:id - Update part
repairItems.patch('/repair-parts/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { part_number, description, quantity, supplier_id, cost_price, sell_price, notes } = body

    // Get existing part to verify access
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_parts')
      .select(`
        *,
        repair_item:repair_items(organization_id),
        repair_option:repair_options(
          repair_item:repair_items(organization_id)
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
    })
  } catch (error) {
    console.error('Update part error:', error)
    return c.json({ error: 'Failed to update part' }, 500)
  }
})

// DELETE /api/v1/repair-parts/:id - Delete part
repairItems.delete('/repair-parts/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get existing part to verify access
    const { data: existing, error: existError } = await supabaseAdmin
      .from('repair_parts')
      .select(`
        id,
        repair_item:repair_items(organization_id),
        repair_option:repair_options(
          repair_item:repair_items(organization_id)
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

    const { error } = await supabaseAdmin
      .from('repair_parts')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete part error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete part error:', error)
    return c.json({ error: 'Failed to delete part' }, 500)
  }
})

// ============================================================================
// WORKFLOW STATUS ENDPOINTS
// ============================================================================

// POST /api/v1/repair-items/:id/labour-complete - Mark labour complete
repairItems.post('/repair-items/:id/labour-complete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// POST /api/v1/repair-items/:id/no-labour-required - Mark item as no labour required
repairItems.post('/repair-items/:id/no-labour-required', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// DELETE /api/v1/repair-items/:id/no-labour-required - Remove no labour required flag
repairItems.delete('/repair-items/:id/no-labour-required', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// POST /api/v1/repair-items/:id/parts-complete - Mark parts complete
repairItems.post('/repair-items/:id/parts-complete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// ============================================================================
// WORKFLOW STATUS SUMMARY ENDPOINT
// ============================================================================

// GET /api/v1/health-checks/:id/workflow-status - Get aggregated workflow status for health check
repairItems.get('/health-checks/:id/workflow-status', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get sent_at from health check
    const { data: hcData } = await supabaseAdmin
      .from('health_checks')
      .select('sent_at')
      .eq('id', id)
      .single()

    // Get all repair items with their statuses
    const { data: repairItems, error } = await supabaseAdmin
      .from('repair_items')
      .select('labour_status, parts_status, quote_status')
      .eq('health_check_id', id)

    if (error) {
      console.error('Get workflow status error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Calculate aggregated status
    let labourStatus: 'pending' | 'in_progress' | 'complete' | 'na' = 'na'
    let partsStatus: 'pending' | 'in_progress' | 'complete' | 'na' = 'na'
    let quoteStatus: 'pending' | 'ready' | 'na' = 'na'
    const sentStatus: 'pending' | 'complete' | 'na' = hcData?.sent_at ? 'complete' : 'na'

    if (repairItems && repairItems.length > 0) {
      // Labour status aggregation
      const labourComplete = repairItems.every(i => i.labour_status === 'complete')
      const labourStarted = repairItems.some(i =>
        i.labour_status === 'in_progress' || i.labour_status === 'complete'
      )
      labourStatus = labourComplete ? 'complete' : labourStarted ? 'in_progress' : 'pending'

      // Parts status aggregation
      const partsComplete = repairItems.every(i => i.parts_status === 'complete')
      const partsStarted = repairItems.some(i =>
        i.parts_status === 'in_progress' || i.parts_status === 'complete'
      )
      partsStatus = partsComplete ? 'complete' : partsStarted ? 'in_progress' : 'pending'

      // Quote status aggregation
      const quoteReady = repairItems.every(i => i.quote_status === 'ready')
      quoteStatus = quoteReady ? 'ready' : 'pending'
    }

    return c.json({
      labour_status: labourStatus,
      parts_status: partsStatus,
      quote_status: quoteStatus === 'ready' ? 'complete' : quoteStatus === 'pending' ? 'pending' : 'na',
      sent_status: sentStatus,
      repair_item_count: repairItems?.length || 0
    })
  } catch (error) {
    console.error('Get workflow status error:', error)
    return c.json({ error: 'Failed to get workflow status' }, 500)
  }
})

// ============================================================================
// UNASSIGNED CHECK RESULTS ENDPOINT
// ============================================================================

// GET /api/v1/health-checks/:id/unassigned-check-results - Get check results not linked to any repair item
repairItems.get('/health-checks/:id/unassigned-check-results', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const includeGreen = c.req.query('include_green') === 'true'

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get all linked check result IDs
    const { data: linkedResults } = await supabaseAdmin
      .from('repair_item_check_results')
      .select('check_result_id')
      .eq('repair_item_id', supabaseAdmin.rpc('get_repair_items_for_health_check', { hc_id: id }))

    // For now, get linked check result IDs via repair_items
    const { data: repairItemsData } = await supabaseAdmin
      .from('repair_items')
      .select('id')
      .eq('health_check_id', id)

    const repairItemIds = repairItemsData?.map(ri => ri.id) || []

    let linkedCheckResultIds: string[] = []
    if (repairItemIds.length > 0) {
      const { data: links } = await supabaseAdmin
        .from('repair_item_check_results')
        .select('check_result_id')
        .in('repair_item_id', repairItemIds)

      linkedCheckResultIds = links?.map(l => l.check_result_id) || []
    }

    // Build query for unassigned check results
    let query = supabaseAdmin
      .from('check_results')
      .select(`
        id,
        rag_status,
        notes,
        is_mot_failure,
        template_item:template_items(id, name, description)
      `)
      .eq('health_check_id', id)

    // Filter by status
    if (includeGreen) {
      query = query.in('rag_status', ['red', 'amber', 'green'])
    } else {
      query = query.in('rag_status', ['red', 'amber'])
    }

    // Exclude already linked results
    if (linkedCheckResultIds.length > 0) {
      query = query.not('id', 'in', `(${linkedCheckResultIds.join(',')})`)
    }

    const { data: results, error } = await query

    if (error) {
      console.error('Get unassigned check results error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      checkResults: (results || []).map(cr => {
        // Supabase returns joined tables as arrays, access first element
        const templateItem = Array.isArray(cr.template_item) ? cr.template_item[0] : cr.template_item
        return {
          id: cr.id,
          ragStatus: cr.rag_status,
          notes: cr.notes,
          isMotFailure: cr.is_mot_failure,
          templateItem: templateItem ? {
            id: templateItem.id,
            name: templateItem.name,
            description: templateItem.description
          } : null
        }
      })
    })
  } catch (error) {
    console.error('Get unassigned check results error:', error)
    return c.json({ error: 'Failed to get unassigned check results' }, 500)
  }
})

export default repairItems
