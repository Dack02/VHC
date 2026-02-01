import { supabaseAdmin } from '../../lib/supabase.js'

// Valid status transitions
export const validTransitions: Record<string, string[]> = {
  // DMS Import arrival workflow (Phase D)
  awaiting_arrival: ['awaiting_checkin', 'created', 'no_show', 'cancelled'],  // Mark arrived → awaiting_checkin (if check-in enabled) or created (if disabled), No show, or Cancel
  awaiting_checkin: ['created', 'cancelled'],  // Complete check-in → created, or Cancel
  no_show: ['awaiting_arrival', 'cancelled'],  // Can be rescheduled or cancelled
  // Standard workflow
  created: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['paused', 'tech_completed', 'cancelled'],
  paused: ['in_progress', 'cancelled'],
  tech_completed: ['awaiting_review', 'awaiting_pricing'],
  awaiting_review: ['awaiting_pricing', 'ready_to_send'],
  awaiting_pricing: ['awaiting_parts', 'ready_to_send'],
  awaiting_parts: ['ready_to_send'],
  ready_to_send: ['sent'],
  sent: ['delivered', 'expired'],
  delivered: ['opened', 'expired'],
  opened: ['partial_response', 'authorized', 'declined', 'expired'],
  partial_response: ['authorized', 'declined', 'expired'],
  authorized: ['completed'],
  declined: ['completed'],
  expired: ['completed'],
  completed: [],
  cancelled: []
}

export function isValidTransition(from: string, to: string): boolean {
  return validTransitions[from]?.includes(to) ?? false
}

// Valid deletion reasons
export const DELETION_REASONS = [
  'no_show',           // Customer did not arrive
  'no_time',           // Not enough time to perform inspection
  'not_required',      // Customer declined inspection
  'customer_declined', // Customer declined after initial contact
  'vehicle_issue',     // Vehicle has issues preventing inspection
  'duplicate',         // Duplicate booking
  'other'              // Other reason (requires notes)
] as const

export type DeletionReason = typeof DELETION_REASONS[number]

// Helper function to build storage URL from path
export function getStorageUrl(storagePath: string): string {
  const supabaseUrl = process.env.SUPABASE_URL
  return `${supabaseUrl}/storage/v1/object/public/vhc-photos/${storagePath}`
}

// Helper function to auto-generate repair items from check results
export async function autoGenerateRepairItems(healthCheckId: string) {
  try {
    // Get health check to get organization_id
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('organization_id')
      .eq('id', healthCheckId)
      .single()

    if (!healthCheck) {
      return { created: 0, error: 'Health check not found' }
    }

    // Get check results with red/amber status
    const { data: results } = await supabaseAdmin
      .from('check_results')
      .select(`
        id, rag_status, notes, is_mot_failure, vehicle_location_name,
        template_item:template_items(name, description)
      `)
      .eq('health_check_id', healthCheckId)
      .in('rag_status', ['red', 'amber'])

    if (!results || results.length === 0) {
      return { created: 0 }
    }

    // Get existing linked check results via junction table to avoid duplicates
    const { data: existingLinks } = await supabaseAdmin
      .from('repair_item_check_results')
      .select('check_result_id, repair_item:repair_items!inner(health_check_id)')
      .eq('repair_item.health_check_id', healthCheckId)

    const existingResultIds = new Set(existingLinks?.map(l => l.check_result_id) || [])

    // Filter to results that don't already have repair items
    const resultsToCreate = results.filter(r => !existingResultIds.has(r.id))

    if (resultsToCreate.length === 0) {
      return { created: 0 }
    }

    // Create repair items with new schema and link via junction table
    let createdCount = 0

    for (const result of resultsToCreate) {
      // Handle template_item which may be object or array from Supabase
      const templateItem = Array.isArray(result.template_item)
        ? result.template_item[0]
        : result.template_item

      // Build repair item name, prefixing with location if present
      const baseName = (templateItem as { name?: string })?.name || 'Repair Item'
      const repairName = result.vehicle_location_name
        ? `${result.vehicle_location_name} ${baseName}`
        : baseName

      // Create the repair item with new schema columns
      const { data: repairItem, error: insertError } = await supabaseAdmin
        .from('repair_items')
        .insert({
          health_check_id: healthCheckId,
          organization_id: healthCheck.organization_id,
          name: repairName,
          description: result.notes || (templateItem as { description?: string })?.description || null,
          is_group: false,
          labour_total: 0,
          parts_total: 0,
          subtotal: 0,
          vat_amount: 0,
          total_inc_vat: 0,
          labour_status: 'pending',
          parts_status: 'pending',
          quote_status: 'pending'
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
          check_result_id: result.id
        })

      if (linkError) {
        console.error('Failed to link repair item to check result:', linkError)
      } else {
        createdCount++
      }
    }

    console.log(`Auto-generated ${createdCount} repair items for health check ${healthCheckId}`)
    return { created: createdCount }
  } catch (error) {
    console.error('Auto-generate repair items error:', error)
    return { created: 0, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Helper function to auto-create repair items from flagged MRI results
export async function autoCreateMriRepairItems(healthCheckId: string, organizationId: string) {
  try {
    // Get flagged MRI results (red or amber RAG status)
    const { data: mriResults } = await supabaseAdmin
      .from('mri_scan_results')
      .select(`
        id, rag_status, notes, mri_item_id,
        mri_item:mri_items(id, name, description, sales_description, item_type, severity_when_due, severity_when_yes, severity_when_no)
      `)
      .eq('health_check_id', healthCheckId)
      .eq('organization_id', organizationId)
      .in('rag_status', ['red', 'amber'])

    if (!mriResults || mriResults.length === 0) {
      return { created: 0 }
    }

    // Get existing MRI-sourced repair items to avoid duplicates
    const { data: existingItems } = await supabaseAdmin
      .from('repair_items')
      .select('mri_result_id')
      .eq('health_check_id', healthCheckId)
      .eq('source', 'mri_scan')
      .not('mri_result_id', 'is', null)

    const existingMriResultIds = new Set(existingItems?.map(i => i.mri_result_id) || [])

    // Filter to results that don't already have repair items
    const resultsToCreate = mriResults.filter(r => !existingMriResultIds.has(r.id))

    if (resultsToCreate.length === 0) {
      return { created: 0 }
    }

    let createdCount = 0

    for (const result of resultsToCreate) {
      // Handle mri_item which may be object or array from Supabase
      const mriItem = Array.isArray(result.mri_item)
        ? result.mri_item[0]
        : result.mri_item

      if (!mriItem) continue

      const typedMriItem = mriItem as {
        id: string
        name: string
        description: string | null
        sales_description: string | null
        item_type: string
        severity_when_due: string | null
        severity_when_yes: string | null
        severity_when_no: string | null
      }

      // Prefer sales_description (customer-facing) over technical description
      let description = typedMriItem.sales_description || typedMriItem.description || ''
      if (result.notes) {
        description = description ? `${description}\n\nMRI Notes: ${result.notes}` : `MRI Notes: ${result.notes}`
      }

      // Create the repair item with rag_status from MRI result
      const { error: insertError } = await supabaseAdmin
        .from('repair_items')
        .insert({
          health_check_id: healthCheckId,
          organization_id: organizationId,
          name: typedMriItem.name,
          description: description || null,
          is_group: false,
          labour_total: 0,
          parts_total: 0,
          subtotal: 0,
          vat_amount: 0,
          total_inc_vat: 0,
          labour_status: 'pending',
          parts_status: 'pending',
          quote_status: 'pending',
          source: 'mri_scan',
          mri_result_id: result.id,
          rag_status: result.rag_status  // Use MRI result's rag_status
        })

      if (insertError) {
        console.error('Failed to create MRI repair item:', insertError)
        continue
      }

      createdCount++
    }

    console.log(`Auto-created ${createdCount} repair items from MRI scan for health check ${healthCheckId}`)
    return { created: createdCount }
  } catch (error) {
    console.error('Auto-create MRI repair items error:', error)
    return { created: 0, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Helper function to update health check totals (uses NEW schema columns)
export async function updateHealthCheckTotals(healthCheckId: string) {
  const { data: items } = await supabaseAdmin
    .from('repair_items')
    .select('parts_total, labour_total')
    .eq('health_check_id', healthCheckId)

  const totalParts = items?.reduce((sum, i) => sum + (parseFloat(String(i.parts_total)) || 0), 0) || 0
  const totalLabour = items?.reduce((sum, i) => sum + (parseFloat(String(i.labour_total)) || 0), 0) || 0

  await supabaseAdmin
    .from('health_checks')
    .update({
      total_parts: totalParts,
      total_labour: totalLabour,
      total_amount: totalParts + totalLabour,
      updated_at: new Date().toISOString()
    })
    .eq('id', healthCheckId)
}
