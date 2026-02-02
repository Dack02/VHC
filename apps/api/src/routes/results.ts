import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const results = new Hono()

results.use('*', authMiddleware)

// Helper to verify health check access
async function verifyHealthCheckAccess(healthCheckId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, technician_id')
    .eq('id', healthCheckId)
    .eq('organization_id', orgId)
    .single()
  return data
}

// GET /api/v1/health-checks/:id/results - Get all results
results.get('/health-checks/:id/results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { data: checkResults, error } = await supabaseAdmin
      .from('check_results')
      .select(`
        *,
        media:result_media(*),
        template_item:template_items(id, name, item_type, config),
        vehicle_location:vehicle_locations(name, short_name)
      `)
      .eq('health_check_id', id)
      .order('created_at', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      results: checkResults?.map(r => ({
        id: r.id,
        templateItemId: r.template_item_id,
        template_item_id: r.template_item_id,
        instanceNumber: r.instance_number || 1,
        instance_number: r.instance_number || 1,
        vehicleLocationId: r.vehicle_location_id || null,
        vehicleLocationName: r.vehicle_location_name || r.vehicle_location?.name || null,
        vehicleLocationShortName: r.vehicle_location?.short_name || null,
        templateItem: r.template_item ? {
          id: r.template_item.id,
          name: r.template_item.name,
          itemType: r.template_item.item_type,
          config: r.template_item.config
        } : null,
        status: r.rag_status,
        rag_status: r.rag_status,
        value: r.value,
        notes: r.notes,
        media: (r.media || []).map((m: Record<string, unknown>) => ({
          id: m.id,
          url: m.url,
          thumbnailUrl: m.thumbnail_url,
          thumbnail_url: m.thumbnail_url,
          caption: m.caption
        })),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    })
  } catch (error) {
    console.error('Get results error:', error)
    return c.json({ error: 'Failed to get results' }, 500)
  }
})

// POST /api/v1/health-checks/:id/results - Save single result
results.post('/health-checks/:id/results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { templateItemId, status, value, notes, is_mot_failure, instanceNumber, vehicleLocationId, vehicleLocationName } = body

    if (!templateItemId) {
      return c.json({ error: 'Template item ID is required' }, 400)
    }

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Determine instance number to use (default to 1)
    const targetInstanceNumber = instanceNumber || 1

    // Check if result already exists for this item + instance number + location
    let existingQuery = supabaseAdmin
      .from('check_results')
      .select('id')
      .eq('health_check_id', id)
      .eq('template_item_id', templateItemId)
      .eq('instance_number', targetInstanceNumber)

    if (vehicleLocationId) {
      existingQuery = existingQuery.eq('vehicle_location_id', vehicleLocationId)
    } else {
      existingQuery = existingQuery.is('vehicle_location_id', null)
    }

    const { data: existing } = await existingQuery.single()

    // SAFEGUARD: If no exact match found but results exist for this template item,
    // update the first instance instead of creating a new duplicate
    // This prevents accidental duplicates when client has stale instance_number
    let effectiveExisting = existing
    if (!existing && targetInstanceNumber !== 1) {
      // Check if ANY results exist for this template_item
      const { data: anyExisting } = await supabaseAdmin
        .from('check_results')
        .select('id, instance_number')
        .eq('health_check_id', id)
        .eq('template_item_id', templateItemId)
        .order('instance_number', { ascending: true })
        .limit(1)
        .single()

      if (anyExisting) {
        // Update the existing result instead of creating a new one
        console.warn(`Safeguard: Redirecting save from instance ${targetInstanceNumber} to ${anyExisting.instance_number} for template_item ${templateItemId}`)
        effectiveExisting = anyExisting
      }
    }

    let result
    if (effectiveExisting) {
      // Update existing result
      const updateData: Record<string, unknown> = {
        rag_status: status,
        value,
        notes,
        updated_at: new Date().toISOString()
      }
      // Only set is_mot_failure if provided (allows clearing it)
      if (is_mot_failure !== undefined) {
        updateData.is_mot_failure = is_mot_failure
      }

      const { data, error } = await supabaseAdmin
        .from('check_results')
        .update(updateData)
        .eq('id', effectiveExisting.id)
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      result = data
    } else {
      // Create new result
      const insertData: Record<string, unknown> = {
        health_check_id: id,
        template_item_id: templateItemId,
        instance_number: targetInstanceNumber,
        rag_status: status,
        value,
        notes,
        is_mot_failure: is_mot_failure || false
      }
      if (vehicleLocationId) {
        insertData.vehicle_location_id = vehicleLocationId
        insertData.vehicle_location_name = vehicleLocationName || null
      }
      const { data, error } = await supabaseAdmin
        .from('check_results')
        .insert(insertData)
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      result = data
    }

    // Auto-create repair item if is_mot_failure is true
    if (result.is_mot_failure && result.rag_status === 'red') {
      // Check if repair item already exists for this result via junction table
      const { data: existingLink } = await supabaseAdmin
        .from('repair_item_check_results')
        .select('repair_item_id')
        .eq('check_result_id', result.id)
        .single()

      if (!existingLink) {
        // Get template item name for description
        const { data: templateItem } = await supabaseAdmin
          .from('template_items')
          .select('name')
          .eq('id', templateItemId)
          .single()

        // Check if there are other instances of this item (to determine if we should show instance number)
        const { count: instanceCount } = await supabaseAdmin
          .from('check_results')
          .select('id', { count: 'exact', head: true })
          .eq('health_check_id', id)
          .eq('template_item_id', templateItemId)

        // Get organization_id from health check
        const { data: hcData } = await supabaseAdmin
          .from('health_checks')
          .select('organization_id')
          .eq('id', id)
          .single()

        const baseName = templateItem?.name || 'Unknown Item'
        // Include instance number in name if there are multiple instances
        const itemName = (instanceCount && instanceCount > 1) ? `${baseName} (${targetInstanceNumber})` : baseName

        // Create repair item with new schema columns
        const { data: newRepairItem } = await supabaseAdmin
          .from('repair_items')
          .insert({
            health_check_id: id,
            organization_id: hcData?.organization_id,
            name: itemName,
            description: `MOT FAILURE: ${itemName} requires immediate attention`,
            labour_total: 0,
            parts_total: 0,
            subtotal: 0,
            vat_amount: 0,
            total_inc_vat: 0,
            outcome_status: 'incomplete',
            labour_status: 'pending',
            parts_status: 'pending'
          })
          .select('id')
          .single()

        // Link repair item to check result via junction table
        if (newRepairItem) {
          await supabaseAdmin
            .from('repair_item_check_results')
            .insert({
              repair_item_id: newRepairItem.id,
              check_result_id: result.id
            })
        }
      }
    }

    return c.json({
      id: result.id,
      templateItemId: result.template_item_id,
      instanceNumber: result.instance_number || 1,
      instance_number: result.instance_number || 1,
      vehicleLocationId: result.vehicle_location_id || null,
      vehicleLocationName: result.vehicle_location_name || null,
      status: result.rag_status,
      value: result.value,
      notes: result.notes,
      is_mot_failure: result.is_mot_failure,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    }, effectiveExisting ? 200 : 201)
  } catch (error) {
    console.error('Save result error:', error)
    return c.json({ error: 'Failed to save result' }, 500)
  }
})

// POST /api/v1/health-checks/:id/results/batch - Save multiple results
results.post('/health-checks/:id/results/batch', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { results: resultsToSave } = body

    if (!resultsToSave || !Array.isArray(resultsToSave)) {
      return c.json({ error: 'Results array is required' }, 400)
    }

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const savedResults = []
    for (const r of resultsToSave) {
      const { templateItemId, status, value, notes, instanceNumber, vehicleLocationId, vehicleLocationName } = r
      const targetInstanceNumber = instanceNumber || 1

      // Check if result already exists for this item + instance + location
      let existingQuery = supabaseAdmin
        .from('check_results')
        .select('id')
        .eq('health_check_id', id)
        .eq('template_item_id', templateItemId)
        .eq('instance_number', targetInstanceNumber)

      if (vehicleLocationId) {
        existingQuery = existingQuery.eq('vehicle_location_id', vehicleLocationId)
      } else {
        existingQuery = existingQuery.is('vehicle_location_id', null)
      }

      const { data: existing } = await existingQuery.single()

      let result
      if (existing) {
        const { data } = await supabaseAdmin
          .from('check_results')
          .update({ rag_status: status, value, notes, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select()
          .single()
        result = data
      } else {
        const insertData: Record<string, unknown> = {
          health_check_id: id,
          template_item_id: templateItemId,
          instance_number: targetInstanceNumber,
          rag_status: status,
          value,
          notes
        }
        if (vehicleLocationId) {
          insertData.vehicle_location_id = vehicleLocationId
          insertData.vehicle_location_name = vehicleLocationName || null
        }
        const { data } = await supabaseAdmin
          .from('check_results')
          .insert(insertData)
          .select()
          .single()
        result = data
      }

      if (result) {
        savedResults.push({
          id: result.id,
          templateItemId: result.template_item_id,
          instanceNumber: result.instance_number || 1,
          vehicleLocationId: result.vehicle_location_id || null,
          vehicleLocationName: result.vehicle_location_name || null,
          status: result.rag_status,
          value: result.value
        })
      }
    }

    // Clean up orphaned non-location results now that location-specific results exist
    const templateItemsWithLocations = [...new Set(
      resultsToSave.filter((r: any) => r.vehicleLocationId).map((r: any) => r.templateItemId)
    )]
    for (const tid of templateItemsWithLocations) {
      await supabaseAdmin
        .from('check_results')
        .delete()
        .eq('health_check_id', id)
        .eq('template_item_id', tid)
        .is('vehicle_location_id', null)
    }

    return c.json({
      saved: savedResults.length,
      results: savedResults
    })
  } catch (error) {
    console.error('Batch save results error:', error)
    return c.json({ error: 'Failed to save results' }, 500)
  }
})

// PATCH /api/v1/health-checks/:id/results/:resultId - Update result
results.patch('/health-checks/:id/results/:resultId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, resultId } = c.req.param()
    const body = await c.req.json()
    const { status, value, notes } = body

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (status !== undefined) updateData.rag_status = status
    if (value !== undefined) updateData.value = value
    if (notes !== undefined) updateData.notes = notes

    const { data: result, error } = await supabaseAdmin
      .from('check_results')
      .update(updateData)
      .eq('id', resultId)
      .eq('health_check_id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: result.id,
      templateItemId: result.template_item_id,
      instanceNumber: result.instance_number || 1,
      instance_number: result.instance_number || 1,
      status: result.rag_status,
      value: result.value,
      notes: result.notes,
      updatedAt: result.updated_at
    })
  } catch (error) {
    console.error('Update result error:', error)
    return c.json({ error: 'Failed to update result' }, 500)
  }
})

// POST /api/v1/health-checks/:id/results/duplicate - Create a duplicate of an item
results.post('/health-checks/:id/results/duplicate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { templateItemId } = body

    if (!templateItemId) {
      return c.json({ error: 'Template item ID is required' }, 400)
    }

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get the max instance number for this template item
    const { data: maxInstanceResult } = await supabaseAdmin
      .from('check_results')
      .select('instance_number')
      .eq('health_check_id', id)
      .eq('template_item_id', templateItemId)
      .order('instance_number', { ascending: false })
      .limit(1)
      .single()

    const nextInstanceNumber = (maxInstanceResult?.instance_number || 0) + 1

    // Get template item for response
    const { data: templateItem } = await supabaseAdmin
      .from('template_items')
      .select('id, name, item_type, config')
      .eq('id', templateItemId)
      .single()

    // Create new result with next instance number
    const { data: result, error } = await supabaseAdmin
      .from('check_results')
      .insert({
        health_check_id: id,
        template_item_id: templateItemId,
        instance_number: nextInstanceNumber,
        rag_status: null,
        value: null,
        notes: null
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: result.id,
      templateItemId: result.template_item_id,
      template_item_id: result.template_item_id,
      instanceNumber: result.instance_number,
      instance_number: result.instance_number,
      templateItem: templateItem ? {
        id: templateItem.id,
        name: templateItem.name,
        itemType: templateItem.item_type,
        config: templateItem.config
      } : null,
      status: result.rag_status,
      rag_status: result.rag_status,
      value: result.value,
      notes: result.notes,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    }, 201)
  } catch (error) {
    console.error('Duplicate result error:', error)
    return c.json({ error: 'Failed to create duplicate' }, 500)
  }
})

// GET /api/v1/health-checks/:id/validate-mandatory - Validate mandatory items are complete
results.get('/health-checks/:id/validate-mandatory', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get health check with template_id
    const { data: healthCheck, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .select('id, template_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (hcError || !healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    if (!healthCheck.template_id) {
      // No template = no mandatory items
      return c.json({ valid: true, incompleteItems: [] })
    }

    // Get all mandatory template items for this template
    const { data: mandatoryItems, error: miError } = await supabaseAdmin
      .from('template_items')
      .select(`
        id,
        name,
        section:template_sections!inner(
          id,
          name,
          sort_order,
          template_id
        )
      `)
      .eq('is_required', true)
      .eq('section.template_id', healthCheck.template_id)
      .order('sort_order', { ascending: true })

    if (miError) {
      console.error('Error fetching mandatory items:', miError)
      return c.json({ error: 'Failed to fetch mandatory items' }, 500)
    }

    if (!mandatoryItems || mandatoryItems.length === 0) {
      return c.json({ valid: true, incompleteItems: [] })
    }

    // Get all check_results with rag_status set for this health check
    const { data: completedResults, error: crError } = await supabaseAdmin
      .from('check_results')
      .select('template_item_id, rag_status')
      .eq('health_check_id', id)
      .not('rag_status', 'is', null)

    if (crError) {
      console.error('Error fetching check results:', crError)
      return c.json({ error: 'Failed to fetch results' }, 500)
    }

    // Build set of completed template item IDs
    const completedItemIds = new Set(
      (completedResults || []).map(r => r.template_item_id)
    )

    // Find incomplete mandatory items
    // Note: Supabase nested relations may return arrays, so we handle both cases
    const incompleteItems = mandatoryItems
      .filter(item => !completedItemIds.has(item.id))
      .map(item => {
        const section = Array.isArray(item.section) ? item.section[0] : item.section
        return {
          templateItemId: item.id,
          itemName: item.name,
          sectionId: (section as { id: string })?.id || '',
          sectionName: (section as { name: string })?.name || '',
          sectionSortOrder: (section as { sort_order: number })?.sort_order || 0
        }
      })
      .sort((a, b) => a.sectionSortOrder - b.sectionSortOrder)

    return c.json({
      valid: incompleteItems.length === 0,
      incompleteItems: incompleteItems.map(({ sectionSortOrder, ...rest }) => rest)
    })
  } catch (error) {
    console.error('Validate mandatory error:', error)
    return c.json({ error: 'Failed to validate mandatory items' }, 500)
  }
})

// DELETE /api/v1/health-checks/:id/results/:resultId - Delete a result (e.g., remove a duplicate)
results.delete('/health-checks/:id/results/:resultId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, resultId } = c.req.param()

    const healthCheck = await verifyHealthCheckAccess(id, auth.orgId)
    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get the result to check if it's a duplicate (instance_number > 1)
    const { data: existingResult } = await supabaseAdmin
      .from('check_results')
      .select('id, instance_number, template_item_id')
      .eq('id', resultId)
      .eq('health_check_id', id)
      .single()

    if (!existingResult) {
      return c.json({ error: 'Result not found' }, 404)
    }

    // Only allow deleting duplicates (instance_number > 1)
    // The primary instance (1) should be cleared, not deleted
    if (existingResult.instance_number === 1) {
      return c.json({ error: 'Cannot delete primary instance. Clear the result instead.' }, 400)
    }

    // Delete associated media first (cascade should handle this, but be explicit)
    await supabaseAdmin
      .from('result_media')
      .delete()
      .eq('check_result_id', resultId)

    // Delete associated repair items
    await supabaseAdmin
      .from('repair_items')
      .delete()
      .eq('check_result_id', resultId)

    // Delete the result
    const { error } = await supabaseAdmin
      .from('check_results')
      .delete()
      .eq('id', resultId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true, deletedId: resultId })
  } catch (error) {
    console.error('Delete result error:', error)
    return c.json({ error: 'Failed to delete result' }, 500)
  }
})

export default results
