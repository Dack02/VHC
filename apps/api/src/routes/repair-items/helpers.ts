import { supabaseAdmin } from '../../lib/supabase.js'

// Helper to verify health check access
export async function verifyHealthCheckAccess(healthCheckId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, organization_id')
    .eq('id', healthCheckId)
    .eq('organization_id', orgId)
    .single()
  return data
}

// Helper to verify repair item access
export async function verifyRepairItemAccess(repairItemId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('repair_items')
    .select('id, name, health_check_id, organization_id')
    .eq('id', repairItemId)
    .eq('organization_id', orgId)
    .single()
  return data
}

// Helper to verify repair option access
export async function verifyRepairOptionAccess(optionId: string, orgId: string) {
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

// Helper to auto-update repair item workflow status when labour/parts are added or deleted
export async function updateRepairItemWorkflowStatus(repairItemId: string | null, repairOptionId: string | null) {
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

  // Get current repair item status including no_*_required flags
  const { data: repairItem } = await supabaseAdmin
    .from('repair_items')
    .select('labour_status, parts_status, quote_status, no_labour_required, no_parts_required')
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

  // === FORWARD TRANSITIONS ===
  // Labour status: pending → in_progress when labour added
  if (totalLabourCount > 0 && repairItem.labour_status === 'pending') {
    updateData.labour_status = 'in_progress'
  }

  // Parts status: pending → in_progress when parts added
  if (totalPartsCount > 0 && repairItem.parts_status === 'pending') {
    updateData.parts_status = 'in_progress'
  }

  // === REVERSE TRANSITIONS (when items are deleted) ===
  // If labour_status is 'complete' but no labour entries exist and no_labour_required is false → reset
  if (repairItem.labour_status === 'complete' && totalLabourCount === 0 && !repairItem.no_labour_required) {
    updateData.labour_status = 'pending'
    updateData.labour_completed_by = null
    updateData.labour_completed_at = null
  }

  // If labour_status is 'in_progress' but no labour entries exist → reset to pending
  if (repairItem.labour_status === 'in_progress' && totalLabourCount === 0) {
    updateData.labour_status = 'pending'
  }

  // If parts_status is 'complete' but no parts entries exist and no_parts_required is false → reset
  if (repairItem.parts_status === 'complete' && totalPartsCount === 0 && !repairItem.no_parts_required) {
    updateData.parts_status = 'pending'
    updateData.parts_completed_by = null
    updateData.parts_completed_at = null
  }

  // If parts_status is 'in_progress' but no parts entries exist → reset to pending
  if (repairItem.parts_status === 'in_progress' && totalPartsCount === 0) {
    updateData.parts_status = 'pending'
  }

  // Determine final labour and parts status for quote_status calculation
  const finalLabourStatus = (updateData.labour_status as string) || repairItem.labour_status
  const finalPartsStatus = (updateData.parts_status as string) || repairItem.parts_status

  // === QUOTE STATUS TRANSITIONS ===
  // Quote status: pending → ready when both labour and parts are complete
  if (finalLabourStatus === 'complete' && finalPartsStatus === 'complete' && repairItem.quote_status === 'pending') {
    updateData.quote_status = 'ready'
  }

  // Quote status: ready → pending when labour or parts is no longer complete (reverse transition)
  // Only reset if no outcome has been set yet (quote_status is still 'ready')
  if (repairItem.quote_status === 'ready' && (finalLabourStatus !== 'complete' || finalPartsStatus !== 'complete')) {
    updateData.quote_status = 'pending'
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
export function formatRepairItem(item: Record<string, unknown>) {
  // Format user object (from join) to just first_name/last_name
  const formatUser = (user: unknown) => {
    if (!user) return null
    const u = user as { first_name?: string; last_name?: string }
    return { first_name: u.first_name || '', last_name: u.last_name || '' }
  }

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
    followUpDate: item.follow_up_date || null,
    createdBy: item.created_by,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    labourCompletedBy: item.labour_completed_by,
    labourCompletedAt: item.labour_completed_at,
    labourCompletedByUser: formatUser(item.labour_completed_by_user),
    partsCompletedBy: item.parts_completed_by,
    partsCompletedAt: item.parts_completed_at,
    partsCompletedByUser: formatUser(item.parts_completed_by_user),
    noLabourRequired: item.no_labour_required || false,
    noLabourRequiredBy: item.no_labour_required_by,
    noLabourRequiredAt: item.no_labour_required_at,
    noPartsRequired: item.no_parts_required || false,
    noPartsRequiredBy: item.no_parts_required_by,
    noPartsRequiredAt: item.no_parts_required_at,
    // Outcome tracking fields for authorisation
    outcomeStatus: item.outcome_status || null,
    outcomeSetBy: item.outcome_set_by || null,
    outcomeSetAt: item.outcome_set_at || null,
    outcomeSource: item.outcome_source || null,
    outcomeSetByUser: formatUser(item.outcome_set_by_user)
  }
}
