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
    .select('id, name, health_check_id, organization_id, is_group, parent_repair_item_id')
    .eq('id', repairItemId)
    .eq('organization_id', orgId)
    .single()
  return data
}

// Helper to cascade outcome_status to children of a group item
export async function cascadeOutcomeToChildren(
  groupId: string,
  outcomeData: {
    outcome_status: string
    outcome_set_by: string
    outcome_set_at: string
    outcome_source: string
    declined_reason_id?: string | null
    declined_notes?: string | null
    deferred_until?: string | null
    deferred_notes?: string | null
    customer_approved?: boolean | null
    customer_approved_at?: string | null
    customer_declined_reason?: string | null
  }
) {
  const updatePayload: Record<string, unknown> = {
    outcome_status: outcomeData.outcome_status,
    outcome_set_by: outcomeData.outcome_set_by,
    outcome_set_at: outcomeData.outcome_set_at,
    outcome_source: outcomeData.outcome_source,
    updated_at: outcomeData.outcome_set_at,
  }

  // Include type-specific fields
  if (outcomeData.declined_reason_id !== undefined) {
    updatePayload.declined_reason_id = outcomeData.declined_reason_id
    updatePayload.declined_notes = outcomeData.declined_notes || null
  }
  if (outcomeData.deferred_until !== undefined) {
    updatePayload.deferred_until = outcomeData.deferred_until
    updatePayload.deferred_notes = outcomeData.deferred_notes || null
  }
  if (outcomeData.customer_approved !== undefined) {
    updatePayload.customer_approved = outcomeData.customer_approved
    updatePayload.customer_approved_at = outcomeData.customer_approved_at || null
    updatePayload.customer_declined_reason = outcomeData.customer_declined_reason || null
  }

  const { error } = await supabaseAdmin
    .from('repair_items')
    .update(updatePayload)
    .eq('parent_repair_item_id', groupId)

  if (error) {
    console.error('Cascade outcome to children error:', error)
  }
}

// Helper to verify repair option access
export async function verifyRepairOptionAccess(optionId: string, orgId: string) {
  // Use explicit FK hint to avoid ambiguity: repair_options has repair_item_id -> repair_items.id
  // but repair_items also has selected_option_id -> repair_options.id
  const { data, error } = await supabaseAdmin
    .from('repair_options')
    .select(`
      id,
      repair_item_id,
      repair_item:repair_items!repair_options_repair_item_id_fkey(organization_id)
    `)
    .eq('id', optionId)
    .single()

  if (error) {
    console.error('verifyRepairOptionAccess error:', error)
    return null
  }

  // repair_item is returned as an object or array from the join
  const repairItem = Array.isArray(data?.repair_item) ? data.repair_item[0] : data?.repair_item
  if (!data || (repairItem as { organization_id?: string })?.organization_id !== orgId) {
    return null
  }
  return data
}

// Resolve the LOCKED labour rate for a work line (P2 — "labour locked to Repair Type").
// Resolve-upward: the Repair Type lives only on the top-level repair_item (a group header or a
// standalone item); children and repair_options carry no type, so we climb to the parent. The
// type → default_labour_code → { rate, is_vat_exempt }. Returns null when there is no type, the
// type has no default labour code, or the code is missing — callers treat null as the gate.
export async function resolveLockedRate(
  input: { itemId?: string; optionId?: string },
  orgId: string
): Promise<{ rate: number; isVatExempt: boolean; labourCodeId: string; discountPercent: number } | null> {
  // 1. Find the repair_item id the rate is read from (an option resolves via its parent item).
  let itemId = input.itemId || null
  if (!itemId && input.optionId) {
    const { data: opt } = await supabaseAdmin
      .from('repair_options')
      .select('repair_item_id')
      .eq('id', input.optionId)
      .single()
    itemId = (opt?.repair_item_id as string | undefined) || null
  }
  if (!itemId) return null

  // 2. Read the item; if it is a child, climb to the parent (children inherit the type).
  const { data: item } = await supabaseAdmin
    .from('repair_items')
    .select('id, organization_id, parent_repair_item_id, repair_type_id')
    .eq('id', itemId)
    .eq('organization_id', orgId)
    .single()
  if (!item) return null

  let repairTypeId = (item.repair_type_id as string | null) ?? null
  if (item.parent_repair_item_id) {
    const { data: parent } = await supabaseAdmin
      .from('repair_items')
      .select('repair_type_id')
      .eq('id', item.parent_repair_item_id as string)
      .eq('organization_id', orgId)
      .single()
    repairTypeId = (parent?.repair_type_id as string | null) ?? null
  }
  if (!repairTypeId) return null

  // 3. Type → default labour code → rate + VAT-exemption (+ the type's default discount %).
  const { data: rt } = await supabaseAdmin
    .from('repair_types')
    .select('default_labour_code_id, default_discount_percent')
    .eq('id', repairTypeId)
    .eq('organization_id', orgId)
    .single()
  if (!rt?.default_labour_code_id) return null

  const { data: lc } = await supabaseAdmin
    .from('labour_codes')
    .select('id, hourly_rate, is_vat_exempt')
    .eq('id', rt.default_labour_code_id as string)
    .eq('organization_id', orgId)
    .single()
  if (!lc) return null

  return {
    rate: parseFloat(lc.hourly_rate as string),
    isVatExempt: !!lc.is_vat_exempt,
    labourCodeId: lc.id as string,
    discountPercent: Number(rt.default_discount_percent) || 0
  }
}

// Re-rate every labour line of a repair_item (and its options) to the item's current Repair Type
// rate. Called when a group's type is set/changed so a reclassified group bills consistently. The
// per-row total is recomputed from the existing hours + discount (snapshot of those inputs is kept).
// No-op when the type has no resolvable rate. The DB triggers recompute the rolled-up totals.
export async function reRateLabourForRepairItem(itemId: string, orgId: string) {
  const resolved = await resolveLockedRate({ itemId }, orgId)
  if (!resolved) return

  const reRate = async (rows: Array<{ id: string; hours: string; discount_percent: string | null }> | null) => {
    for (const r of rows || []) {
      const hours = parseFloat(r.hours) || 0
      const discount = parseFloat(r.discount_percent as string) || 0
      const total = resolved.rate * hours * (1 - discount / 100)
      await supabaseAdmin
        .from('repair_labour')
        .update({
          labour_code_id: resolved.labourCodeId,
          rate: resolved.rate,
          is_vat_exempt: resolved.isVatExempt,
          total,
          updated_at: new Date().toISOString()
        })
        .eq('id', r.id)
    }
  }

  const { data: itemRows } = await supabaseAdmin
    .from('repair_labour')
    .select('id, hours, discount_percent')
    .eq('repair_item_id', itemId)
  await reRate(itemRows)

  const { data: opts } = await supabaseAdmin
    .from('repair_options')
    .select('id')
    .eq('repair_item_id', itemId)
  const optionIds = (opts || []).map((o) => o.id as string)
  if (optionIds.length > 0) {
    const { data: optRows } = await supabaseAdmin
      .from('repair_labour')
      .select('id, hours, discount_percent')
      .in('repair_option_id', optionIds)
    await reRate(optRows)
  }
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
    jobsheetId: item.jobsheet_id ?? null,
    source: item.source ?? null,
    name: item.name,
    description: item.description,
    isGroup: item.is_group,
    parentRepairItemId: item.parent_repair_item_id || null,
    repairTypeId: item.repair_type_id ?? null,
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
