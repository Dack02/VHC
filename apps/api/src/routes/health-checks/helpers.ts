import { supabaseAdmin } from '../../lib/supabase.js'

// Valid status transitions
export const validTransitions: Record<string, string[]> = {
  // DMS Import arrival workflow (Phase D)
  awaiting_arrival: ['created', 'no_show', 'cancelled'],  // Mark arrived → created, No show, or Cancel
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
        id, rag_status, notes, is_mot_failure,
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

      // Create the repair item with new schema columns
      const { data: repairItem, error: insertError } = await supabaseAdmin
        .from('repair_items')
        .insert({
          health_check_id: healthCheckId,
          organization_id: healthCheck.organization_id,
          name: (templateItem as { name?: string })?.name || 'Repair Item',
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
