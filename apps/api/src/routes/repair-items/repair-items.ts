import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { verifyHealthCheckAccess, verifyRepairItemAccess, formatRepairItem } from './helpers.js'

const repairItemsRouter = new Hono()
console.log('=== REPAIR ITEMS MODULE LOADED (v2 with option parts) ===')

// GET /health-checks/:id/repair-items - List all repair items for health check
repairItemsRouter.get('/health-checks/:id/repair-items', async (c) => {
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
        labour_completed_by_user:users!repair_items_labour_completed_by_fkey(first_name, last_name),
        parts_completed_by_user:users!repair_items_parts_completed_by_fkey(first_name, last_name),
        outcome_set_by_user:users!repair_items_outcome_set_by_fkey(first_name, last_name),
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
            notes
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

    // DEBUG: Check raw data
    if (items) {
      const tyre = items.find((i: Record<string, unknown>) => i.name === 'Rear Right Tyre')
      if (tyre) {
        const opts = tyre.options as Array<Record<string, unknown>> | undefined
        console.log('=== RAW OPTION DATA ===')
        console.log('Has options:', !!opts, 'count:', opts?.length)
        if (opts) {
          opts.forEach((o: Record<string, unknown>) => {
            console.log(`Option ${o.name}: keys=${Object.keys(o).join(',')}, has parts=${('parts' in o)}, parts count=${Array.isArray(o.parts) ? o.parts.length : 'N/A'}`)
          })
        }
      }
    }

    // Get children for groups (items with parent_repair_item_id)
    // Include labour data so children can have labour assigned individually
    const { data: childItems } = await supabaseAdmin
      .from('repair_items')
      .select(`
        *,
        labour_completed_by_user:users!repair_items_labour_completed_by_fkey(first_name, last_name),
        parts_completed_by_user:users!repair_items_parts_completed_by_fkey(first_name, last_name),
        outcome_set_by_user:users!repair_items_outcome_set_by_fkey(first_name, last_name),
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
            sortOrder: opt.sort_order,
            parts: ((opt.parts as Record<string, unknown>[]) || []).map((part: Record<string, unknown>) => ({
              id: part.id,
              partNumber: part.part_number,
              description: part.description,
              quantity: parseFloat(part.quantity as string) || 0,
              supplierId: part.supplier_id,
              supplierName: part.supplier_name,
              costPrice: parseFloat(part.cost_price as string) || 0,
              sellPrice: parseFloat(part.sell_price as string) || 0,
              lineTotal: parseFloat(part.line_total as string) || 0,
              marginPercent: part.margin_percent ? parseFloat(part.margin_percent as string) : null,
              markupPercent: part.markup_percent ? parseFloat(part.markup_percent as string) : null,
              notes: part.notes
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

// POST /health-checks/:id/repair-items - Create repair item
repairItemsRouter.post('/health-checks/:id/repair-items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// GET /repair-items/:id - Get single repair item with all related data
repairItemsRouter.get('/repair-items/:id', async (c) => {
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

// PATCH /repair-items/:id - Update repair item
repairItemsRouter.patch('/repair-items/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// DELETE /repair-items/:id - Delete repair item
repairItemsRouter.delete('/repair-items/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// POST /repair-items/:id/ungroup - Ungroup a repair group back to individual items
repairItemsRouter.post('/repair-items/:id/ungroup', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// POST /repair-items/:id/check-results - Link check result
repairItemsRouter.post('/repair-items/:id/check-results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

// DELETE /repair-items/:id/check-results/:checkResultId - Unlink check result
repairItemsRouter.delete('/repair-items/:id/check-results/:checkResultId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

export default repairItemsRouter
