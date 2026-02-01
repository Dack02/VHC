/**
 * Public API routes for Customer Portal
 * No authentication required - token-based access
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { cancelHealthCheckReminders, notifyCustomerAction } from '../services/scheduler.js'
import { sendAuthorizationConfirmationEmail } from '../services/email.js'
import { sendAuthorizationConfirmationSms } from '../services/sms.js'

const publicRoutes = new Hono()

// Helper to build storage URL from path
function getStorageUrl(storagePath: string): string {
  const supabaseUrl = process.env.SUPABASE_URL
  return `${supabaseUrl}/storage/v1/object/public/vhc-photos/${storagePath}`
}

/**
 * GET /api/public/vhc/:token
 * Get health check data for customer portal
 */
publicRoutes.get('/vhc/:token', async (c) => {
  const token = c.req.param('token')

  // Find health check by public token
  const { data: healthCheck, error } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      status,
      public_token,
      token_expires_at,
      sent_at,
      first_opened_at,
      customer_view_count,
      red_count,
      amber_count,
      green_count,
      technician_notes,
      mileage_in,
      vehicle:vehicles(
        id,
        registration,
        make,
        model,
        year,
        color,
        vin
      ),
      customer:customers(
        id,
        first_name,
        last_name,
        email,
        mobile
      ),
      site:sites(
        id,
        name,
        address,
        phone,
        email,
        organization:organizations(
          id,
          name,
          settings
        )
      )
    `)
    .eq('public_token', token)
    .single()

  if (error || !healthCheck) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  // Check if token has expired
  if (healthCheck.token_expires_at) {
    const expiresAt = new Date(healthCheck.token_expires_at)
    if (expiresAt < new Date()) {
      return c.json({
        error: 'Link has expired',
        expired: true,
        expiredAt: healthCheck.token_expires_at
      }, 410)
    }
  }

  // Update view count and first_opened_at
  const isFirstView = !healthCheck.first_opened_at
  const updateData: Record<string, unknown> = {
    customer_view_count: (healthCheck.customer_view_count || 0) + 1,
    customer_last_viewed_at: new Date().toISOString()
  }

  if (isFirstView) {
    updateData.first_opened_at = new Date().toISOString()
    updateData.status = 'opened'
  }

  await supabaseAdmin
    .from('health_checks')
    .update(updateData)
    .eq('id', healthCheck.id)

  // Notify staff when customer opens health check for the first time
  if (isFirstView) {
    const site = healthCheck.site as unknown as { id: string }
    await notifyCustomerAction(healthCheck.id, site.id, 'viewed', {
      viewCount: 1,
      isFirstView: true
    })
  }

  // Get repair items with their check results (NEW schema - map to legacy format)
  const { data: repairItemsRaw } = await supabaseAdmin
    .from('repair_items')
    .select(`
      id,
      name,
      description,
      parts_total,
      labour_total,
      total_inc_vat,
      customer_approved,
      check_results:repair_item_check_results(
        check_result:check_results(
          id,
          rag_status,
          notes,
          value,
          template_item:template_items(
            id,
            name,
            description,
            item_type
          )
        )
      )
    `)
    .eq('health_check_id', healthCheck.id)
    .order('created_at')

  // Transform NEW schema to legacy format
  const repairItems = (repairItemsRaw || []).map(item => {
    // Get linked check results and derive rag_status
    const linkedResults = item.check_results || []
    const firstCheckResult = linkedResults[0]?.check_result || null
    // Derive rag_status: red > amber
    let derivedRagStatus: 'red' | 'amber' | null = null
    for (const link of linkedResults) {
      // Supabase returns single relations as objects
      const cr = link?.check_result as { rag_status?: string } | null
      if (cr?.rag_status === 'red') {
        derivedRagStatus = 'red'
        break
      }
      if (cr?.rag_status === 'amber' && !derivedRagStatus) {
        derivedRagStatus = 'amber'
      }
    }
    return {
      id: item.id,
      title: item.name,
      description: item.description,
      rag_status: derivedRagStatus,
      parts_cost: parseFloat(String(item.parts_total)) || 0,
      labor_cost: parseFloat(String(item.labour_total)) || 0,
      total_price: parseFloat(String(item.total_inc_vat)) || 0,
      is_mot_failure: false,
      follow_up_date: null,
      check_result: firstCheckResult
    }
  })

  // Get all check results for photos
  const { data: checkResults } = await supabaseAdmin
    .from('check_results')
    .select(`
      id,
      rag_status,
      notes,
      value,
      instance_number,
      template_item_id,
      template_item:template_items(
        id,
        name,
        item_type,
        section:template_sections(
          id,
          name
        )
      ),
      media:result_media(
        id,
        media_type,
        storage_path,
        thumbnail_path,
        caption,
        sort_order,
        include_in_report
      )
    `)
    .eq('health_check_id', healthCheck.id)
    .order('created_at')

  // Fetch selected reasons for all check results
  const checkResultIds = (checkResults || []).map(r => r.id)
  const reasonsByCheckResult: Record<string, Array<{
    id: string
    reasonText: string
    customerDescription: string | null
    followUpDays: number | null
    followUpText: string | null
  }>> = {}

  if (checkResultIds.length > 0) {
    const { data: allReasons } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        id,
        check_result_id,
        follow_up_days,
        follow_up_text,
        customer_description_override,
        reason:item_reasons(
          reason_text,
          customer_description
        )
      `)
      .in('check_result_id', checkResultIds)

    // Group reasons by check result ID
    for (const crr of allReasons || []) {
      const checkResultId = crr.check_result_id
      if (!reasonsByCheckResult[checkResultId]) {
        reasonsByCheckResult[checkResultId] = []
      }
      const reason = crr.reason as { reason_text?: string; customer_description?: string } | null
      reasonsByCheckResult[checkResultId].push({
        id: crr.id,
        reasonText: reason?.reason_text || 'Unknown',
        customerDescription: crr.customer_description_override || reason?.customer_description || null,
        followUpDays: crr.follow_up_days,
        followUpText: crr.follow_up_text
      })
    }
  }

  // Get authorizations (legacy)
  const { data: authorizations } = await supabaseAdmin
    .from('authorizations')
    .select('*')
    .eq('health_check_id', healthCheck.id)

  // Build authorization map
  const authMap = new Map(
    (authorizations || []).map(auth => [auth.repair_item_id, auth])
  )

  // Enhance repair items with authorization status and reasons
  const enhancedRepairItems = (repairItems || []).map(item => {
    const checkResultId = (item.check_result as { id?: string } | null)?.id
    return {
      ...item,
      authorization: authMap.get(item.id) || null,
      reasons: checkResultId ? reasonsByCheckResult[checkResultId] || [] : []
    }
  })

  // ===== NEW REPAIR ITEMS (Phase 6+) =====
  // Get new repair items with their linked check results and options
  // Exclude children - they're displayed under their parent group
  // Exclude soft-deleted items - they should not be visible to customers
  const { data: newRepairItems } = await supabaseAdmin
    .from('repair_items')
    .select(`
      id,
      name,
      description,
      is_group,
      labour_total,
      parts_total,
      subtotal,
      vat_amount,
      total_inc_vat,
      price_override,
      price_override_reason,
      labour_status,
      parts_status,
      quote_status,
      customer_approved,
      customer_approved_at,
      customer_declined_reason,
      selected_option_id,
      rag_status,
      source,
      created_at
    `)
    .eq('health_check_id', healthCheck.id)
    .is('parent_repair_item_id', null)
    .is('deleted_at', null)
    .order('created_at')

  // Fetch children for groups (items with parent_repair_item_id)
  // Exclude soft-deleted children - they should not be visible to customers
  const { data: childItemsRaw } = await supabaseAdmin
    .from('repair_items')
    .select(`
      id,
      name,
      parent_repair_item_id,
      check_results:repair_item_check_results(
        check_result:check_results(id, rag_status)
      )
    `)
    .eq('health_check_id', healthCheck.id)
    .not('parent_repair_item_id', 'is', null)
    .is('deleted_at', null)
    .order('created_at')

  // Build children map for groups
  const childrenByParentId = new Map<string, Array<{
    name: string
    ragStatus: 'red' | 'amber' | null
    vhcReason?: string | null
  }>>()

  // Collect all child check result IDs to fetch their reasons
  const childCheckResultIds: string[] = []
  for (const child of childItemsRaw || []) {
    const childCheckResults = child.check_results || []
    for (const link of childCheckResults) {
      const cr = link?.check_result as { id?: string } | null
      if (cr?.id) {
        childCheckResultIds.push(cr.id)
      }
    }
  }

  // Fetch reasons for child check results
  const childReasonsByCheckResult: Record<string, string | null> = {}
  if (childCheckResultIds.length > 0) {
    const { data: childReasons } = await supabaseAdmin
      .from('check_result_reasons')
      .select(`
        check_result_id,
        customer_description_override,
        reason:item_reasons(
          reason_text,
          customer_description
        )
      `)
      .in('check_result_id', childCheckResultIds)

    // Build lookup: check_result_id -> first reason's customerDescription
    for (const crr of childReasons || []) {
      if (!childReasonsByCheckResult[crr.check_result_id]) {
        const reason = crr.reason as { reason_text?: string; customer_description?: string } | null
        childReasonsByCheckResult[crr.check_result_id] =
          crr.customer_description_override || reason?.customer_description || reason?.reason_text || null
      }
    }
  }

  for (const child of childItemsRaw || []) {
    const parentId = child.parent_repair_item_id
    if (!parentId) continue

    if (!childrenByParentId.has(parentId)) {
      childrenByParentId.set(parentId, [])
    }

    // Derive rag_status from child's check results (red > amber)
    let childRagStatus: 'red' | 'amber' | null = null
    let childVhcReason: string | null = null
    const childCheckResults = child.check_results || []
    for (const link of childCheckResults) {
      const cr = link?.check_result as { id?: string; rag_status?: string } | null
      if (cr?.rag_status === 'red') {
        childRagStatus = 'red'
        // Get VHC reason for this check result
        if (cr.id && childReasonsByCheckResult[cr.id] && !childVhcReason) {
          childVhcReason = childReasonsByCheckResult[cr.id]
        }
        break
      }
      if (cr?.rag_status === 'amber' && !childRagStatus) {
        childRagStatus = 'amber'
      }
      // Capture the first VHC reason we find
      if (cr?.id && childReasonsByCheckResult[cr.id] && !childVhcReason) {
        childVhcReason = childReasonsByCheckResult[cr.id]
      }
    }

    childrenByParentId.get(parentId)!.push({
      name: child.name,
      ragStatus: childRagStatus,
      vhcReason: childVhcReason
    })
  }

  // Get repair options for all new repair items
  const newRepairItemIds = (newRepairItems || []).map(ri => ri.id)
  let repairOptionsMap: Map<string, Array<{
    id: string
    name: string
    description: string | null
    labour_total: number
    parts_total: number
    subtotal: number
    vat_amount: number
    total_inc_vat: number
    is_recommended: boolean
    sort_order: number
  }>> = new Map()

  if (newRepairItemIds.length > 0) {
    const { data: allOptions } = await supabaseAdmin
      .from('repair_options')
      .select(`
        id,
        repair_item_id,
        name,
        description,
        labour_total,
        parts_total,
        subtotal,
        vat_amount,
        total_inc_vat,
        is_recommended,
        sort_order
      `)
      .in('repair_item_id', newRepairItemIds)
      .order('sort_order')

    // Group options by repair item
    for (const opt of allOptions || []) {
      const riId = opt.repair_item_id
      if (!repairOptionsMap.has(riId)) {
        repairOptionsMap.set(riId, [])
      }
      repairOptionsMap.get(riId)!.push({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        labour_total: opt.labour_total || 0,
        parts_total: opt.parts_total || 0,
        subtotal: opt.subtotal || 0,
        vat_amount: opt.vat_amount || 0,
        total_inc_vat: opt.total_inc_vat || 0,
        is_recommended: opt.is_recommended || false,
        sort_order: opt.sort_order || 0
      })
    }
  }

  // Get linked check results for new repair items
  let linkedCheckResultsMap: Map<string, string[]> = new Map()
  if (newRepairItemIds.length > 0) {
    const { data: links } = await supabaseAdmin
      .from('repair_item_check_results')
      .select('repair_item_id, check_result_id')
      .in('repair_item_id', newRepairItemIds)

    for (const link of links || []) {
      if (!linkedCheckResultsMap.has(link.repair_item_id)) {
        linkedCheckResultsMap.set(link.repair_item_id, [])
      }
      linkedCheckResultsMap.get(link.repair_item_id)!.push(link.check_result_id)
    }
  }

  // Enhance new repair items with options and linked check result names
  const enhancedNewRepairItems = (newRepairItems || []).map(item => {
    const options = repairOptionsMap.get(item.id) || []
    const linkedCrIds = linkedCheckResultsMap.get(item.id) || []

    // Get names of linked check results
    const linkedCheckResultNames = linkedCrIds
      .map(crId => {
        const cr = (checkResults || []).find(r => r.id === crId)
        if (!cr) return null
        const templateItem = cr.template_item as { name?: string } | null
        return templateItem?.name || 'Unknown Item'
      })
      .filter(Boolean) as string[]

    // Get children for groups
    const children = item.is_group ? (childrenByParentId.get(item.id) || []) : undefined

    // Derive RAG status
    let derivedRagStatus: 'red' | 'amber' | null = null

    if (item.is_group && children && children.length > 0) {
      // For groups, derive from children's ragStatus
      for (const child of children) {
        if (child.ragStatus === 'red') {
          derivedRagStatus = 'red'
          break
        }
        if (child.ragStatus === 'amber' && !derivedRagStatus) {
          derivedRagStatus = 'amber'
        }
      }
    } else if (linkedCrIds.length > 0) {
      // For individual items with linked check results, derive from those
      for (const crId of linkedCrIds) {
        const cr = (checkResults || []).find(r => r.id === crId)
        if (cr?.rag_status === 'red') {
          derivedRagStatus = 'red'
          break
        }
        if (cr?.rag_status === 'amber' && !derivedRagStatus) {
          derivedRagStatus = 'amber'
        }
      }
    }

    // Fallback: use stored rag_status (e.g. MRI items store RAG directly)
    if (!derivedRagStatus && item.rag_status) {
      derivedRagStatus = item.rag_status as 'red' | 'amber'
    }

    return {
      id: item.id,
      name: item.name,
      description: item.description,
      isGroup: item.is_group,
      ragStatus: derivedRagStatus,
      labourTotal: item.labour_total || 0,
      partsTotal: item.parts_total || 0,
      subtotal: item.subtotal || 0,
      vatAmount: item.vat_amount || 0,
      totalIncVat: item.total_inc_vat || 0,
      priceOverride: item.price_override || null,
      priceOverrideReason: item.price_override_reason || null,
      labourStatus: item.labour_status,
      partsStatus: item.parts_status,
      quoteStatus: item.quote_status,
      customerApproved: item.customer_approved,
      customerApprovedAt: item.customer_approved_at,
      customerDeclinedReason: item.customer_declined_reason,
      selectedOptionId: item.selected_option_id,
      options: options.map(opt => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        labourTotal: opt.labour_total,
        partsTotal: opt.parts_total,
        subtotal: opt.subtotal,
        vatAmount: opt.vat_amount,
        totalIncVat: opt.total_inc_vat,
        isRecommended: opt.is_recommended
      })),
      linkedCheckResults: linkedCheckResultNames,
      children
    }
  })

  // Track activity
  await trackActivity(healthCheck.id, 'viewed', null, c)

  // Determine if we have new repair items (Phase 6+) or legacy repair items
  const hasNewRepairItems = (enhancedNewRepairItems || []).length > 0

  return c.json({
    healthCheck: {
      id: healthCheck.id,
      status: healthCheck.status,
      sentAt: healthCheck.sent_at,
      expiresAt: healthCheck.token_expires_at,
      viewCount: (healthCheck.customer_view_count || 0) + 1,
      redCount: healthCheck.red_count,
      amberCount: healthCheck.amber_count,
      greenCount: healthCheck.green_count,
      technicianNotes: healthCheck.technician_notes,
      mileageIn: healthCheck.mileage_in
    },
    vehicle: healthCheck.vehicle,
    customer: healthCheck.customer,
    site: healthCheck.site,
    // Legacy repair items (for backwards compatibility)
    repairItems: enhancedRepairItems,
    // New repair items with options (Phase 6+)
    newRepairItems: enhancedNewRepairItems,
    hasNewRepairItems,
    checkResults: (checkResults || []).map(result => {
      // Check if this item has duplicates
      const instanceNum = (result as Record<string, unknown>).instance_number as number || 1
      const hasDuplicates = (checkResults || []).filter(
        r => (r as Record<string, unknown>).template_item_id === (result as Record<string, unknown>).template_item_id
      ).length > 1
      const templateItem = result.template_item as { name?: string } | null
      const baseName = templateItem?.name || 'Unknown Item'
      const displayName = hasDuplicates ? `${baseName} (${instanceNum})` : baseName

      return {
        ...result,
        instance_number: instanceNum,
        display_name: displayName,
        reasons: reasonsByCheckResult[result.id] || [],
        media: result.media
          ?.filter((m: Record<string, unknown>) => m.include_in_report !== false)
          .map((m: Record<string, unknown>) => {
            const url = m.storage_path ? getStorageUrl(m.storage_path as string) : null
            return {
              id: m.id,
              media_type: m.media_type,
              url,
              thumbnail_url: url ? `${url}?width=200&height=200` : null,
              caption: m.caption,
              sort_order: m.sort_order
            }
          })
      }
    }),
    isFirstView
  })
})

// ===== LEGACY ENDPOINTS REMOVED =====
// The following legacy endpoints have been removed and replaced with the new repair items endpoints below:
// - POST /vhc/:token/authorize (use /vhc/:token/repair-items/:id/approve instead)
// - POST /vhc/:token/decline (use /vhc/:token/repair-items/:id/decline instead)
// - POST /vhc/:token/signature (use /vhc/:token/repair-items/sign instead)
// The authorizations table is being deprecated in favor of customer_approved field on repair_items

/**
 * POST /api/public/vhc/:token/track
 * Track customer activity
 */
publicRoutes.post('/vhc/:token/track', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const { activityType, repairItemId, metadata } = body

  // Find health check by token
  const { data: healthCheck } = await supabaseAdmin
    .from('health_checks')
    .select('id')
    .eq('public_token', token)
    .single()

  if (!healthCheck) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  await trackActivity(healthCheck.id, activityType, repairItemId, c, metadata)

  return c.json({ success: true })
})

// ===== NEW REPAIR ITEMS ENDPOINTS (Phase 8) =====

/**
 * POST /api/public/vhc/:token/repair-items/:repairItemId/approve
 * Approve a new repair item (with optional selected option and signature)
 */
publicRoutes.post('/vhc/:token/repair-items/:repairItemId/approve', async (c) => {
  const token = c.req.param('token')
  const repairItemId = c.req.param('repairItemId')
  const body = await c.req.json()
  const { selectedOptionId, notes, signatureData } = body

  // Find health check by token
  const { data: healthCheck, error } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, token_expires_at, site_id')
    .eq('public_token', token)
    .single()

  if (error || !healthCheck) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  // Check expiry
  if (healthCheck.token_expires_at && new Date(healthCheck.token_expires_at) < new Date()) {
    return c.json({ error: 'Link has expired' }, 410)
  }

  // Verify repair item belongs to this health check (using new repair_items table)
  const { data: repairItem, error: riError } = await supabaseAdmin
    .from('repair_items')
    .select('id, name, subtotal, total_inc_vat')
    .eq('id', repairItemId)
    .eq('health_check_id', healthCheck.id)
    .single()

  if (riError || !repairItem) {
    return c.json({ error: 'Repair item not found' }, 404)
  }

  // Check if options exist - if so, selectedOptionId is required
  const { data: options } = await supabaseAdmin
    .from('repair_options')
    .select('id')
    .eq('repair_item_id', repairItemId)

  const hasOptions = (options || []).length > 0
  if (hasOptions && !selectedOptionId) {
    return c.json({ error: 'Please select an option before approving' }, 400)
  }

  // Validate selectedOptionId if provided
  if (selectedOptionId) {
    const validOption = (options || []).find(o => o.id === selectedOptionId)
    if (!validOption) {
      return c.json({ error: 'Invalid option selected' }, 400)
    }
  }

  // Get client info
  const rawIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')
  const ipAddress = rawIp && /^[\d.:a-fA-F]+$/.test(rawIp) ? rawIp : null
  const userAgent = c.req.header('user-agent') || ''

  // Update the repair item with approval and optional signature
  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = {
    customer_approved: true,
    customer_approved_at: now,
    customer_declined_reason: null,
    customer_notes: notes || null,
    // Phase 7: Set outcome status for customer portal sync
    outcome_status: 'authorised',
    outcome_set_at: now,
    outcome_source: 'online',
    updated_at: now
  }
  if (selectedOptionId) {
    updateData.selected_option_id = selectedOptionId
  }
  // Store signature data if provided
  if (signatureData) {
    updateData.customer_signature_data = signatureData
    updateData.customer_signature_ip = ipAddress
    updateData.customer_signature_user_agent = userAgent
  }

  const { error: updateError } = await supabaseAdmin
    .from('repair_items')
    .update(updateData)
    .eq('id', repairItemId)

  if (updateError) {
    console.error('Approve repair item error:', updateError)
    return c.json({ error: 'Failed to save approval' }, 500)
  }

  // Track activity
  await trackActivity(healthCheck.id, 'repair_item_approved', repairItemId, c, {
    selectedOptionId,
    notes,
    ipAddress,
    hasSigned: !!signatureData
  })

  // Update health check status based on new repair items
  await updateHealthCheckStatusForNewRepairItems(healthCheck.id, healthCheck.site_id)

  return c.json({
    success: true,
    message: 'Repair item approved successfully',
    repairItemId,
    selectedOptionId
  })
})

/**
 * POST /api/public/vhc/:token/repair-items/:repairItemId/decline
 * Decline a new repair item
 */
publicRoutes.post('/vhc/:token/repair-items/:repairItemId/decline', async (c) => {
  const token = c.req.param('token')
  const repairItemId = c.req.param('repairItemId')
  const body = await c.req.json()
  const { reason, notes } = body

  // Find health check by token
  const { data: healthCheck, error } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, token_expires_at, site_id')
    .eq('public_token', token)
    .single()

  if (error || !healthCheck) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  // Check expiry
  if (healthCheck.token_expires_at && new Date(healthCheck.token_expires_at) < new Date()) {
    return c.json({ error: 'Link has expired' }, 410)
  }

  // Verify repair item belongs to this health check
  const { data: repairItem, error: riError } = await supabaseAdmin
    .from('repair_items')
    .select('id, name')
    .eq('id', repairItemId)
    .eq('health_check_id', healthCheck.id)
    .single()

  if (riError || !repairItem) {
    return c.json({ error: 'Repair item not found' }, 404)
  }

  // Get client info
  const rawIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')
  const ipAddress = rawIp && /^[\d.:a-fA-F]+$/.test(rawIp) ? rawIp : null

  // Update the repair item
  const now = new Date().toISOString()
  const { error: updateError } = await supabaseAdmin
    .from('repair_items')
    .update({
      customer_approved: false,
      customer_approved_at: now,
      customer_declined_reason: reason || null,
      customer_notes: notes || null,
      selected_option_id: null,
      // Phase 7: Set outcome status for customer portal sync
      outcome_status: 'declined',
      outcome_set_at: now,
      outcome_source: 'online',
      updated_at: now
    })
    .eq('id', repairItemId)

  if (updateError) {
    console.error('Decline repair item error:', updateError)
    return c.json({ error: 'Failed to save decline' }, 500)
  }

  // Track activity
  await trackActivity(healthCheck.id, 'repair_item_declined', repairItemId, c, {
    reason,
    notes,
    ipAddress
  })

  // Update health check status based on new repair items
  await updateHealthCheckStatusForNewRepairItems(healthCheck.id, healthCheck.site_id)

  return c.json({
    success: true,
    message: 'Repair item declined',
    repairItemId
  })
})

/**
 * POST /api/public/vhc/:token/repair-items/sign
 * Sign all approved repair items with customer signature
 */
publicRoutes.post('/vhc/:token/repair-items/sign', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const { signatureData } = body

  if (!signatureData) {
    return c.json({ error: 'Signature data is required' }, 400)
  }

  // Find health check by token
  const { data: healthCheck, error } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, token_expires_at')
    .eq('public_token', token)
    .single()

  if (error || !healthCheck) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  // Check expiry
  if (healthCheck.token_expires_at && new Date(healthCheck.token_expires_at) < new Date()) {
    return c.json({ error: 'Link has expired' }, 410)
  }

  // Get client info
  const rawIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')
  const ipAddress = rawIp && /^[\d.:a-fA-F]+$/.test(rawIp) ? rawIp : null
  const userAgent = c.req.header('user-agent') || ''

  // Update all approved repair items with signature
  const { error: updateError } = await supabaseAdmin
    .from('repair_items')
    .update({
      customer_signature_data: signatureData,
      customer_signature_ip: ipAddress,
      customer_signature_user_agent: userAgent,
      updated_at: new Date().toISOString()
    })
    .eq('health_check_id', healthCheck.id)
    .eq('customer_approved', true)

  if (updateError) {
    console.error('Signature update error:', updateError)
    return c.json({ error: 'Failed to save signature' }, 500)
  }

  // Track activity
  await trackActivity(healthCheck.id, 'signed', null, c)

  // Update health check status to authorized
  await supabaseAdmin
    .from('health_checks')
    .update({
      status: 'authorized',
      fully_responded_at: new Date().toISOString()
    })
    .eq('id', healthCheck.id)

  // Send authorization confirmation to customer
  sendCustomerAuthorizationConfirmation(healthCheck.id).catch(err =>
    console.error('Failed to send authorization confirmation:', err)
  )

  return c.json({
    success: true,
    message: 'Signature saved successfully'
  })
})

/**
 * POST /api/public/vhc/:token/repair-items/approve-all
 * Approve all pending new repair items
 */
publicRoutes.post('/vhc/:token/repair-items/approve-all', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const { selections } = body // Array of { repairItemId, selectedOptionId }

  // Find health check by token
  const { data: healthCheck, error } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, token_expires_at, site_id')
    .eq('public_token', token)
    .single()

  if (error || !healthCheck) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  // Check expiry
  if (healthCheck.token_expires_at && new Date(healthCheck.token_expires_at) < new Date()) {
    return c.json({ error: 'Link has expired' }, 410)
  }

  // Get all pending repair items
  const { data: pendingItems } = await supabaseAdmin
    .from('repair_items')
    .select('id')
    .eq('health_check_id', healthCheck.id)
    .is('customer_approved', null)

  if (!pendingItems || pendingItems.length === 0) {
    return c.json({ error: 'No pending repair items' }, 400)
  }

  // Build selection map
  const selectionMap = new Map<string, string | null>()
  for (const sel of selections || []) {
    selectionMap.set(sel.repairItemId, sel.selectedOptionId || null)
  }

  // Approve all pending items
  const now = new Date().toISOString()
  let approvedCount = 0

  for (const item of pendingItems) {
    // Check if item has options and needs selection
    const { data: options } = await supabaseAdmin
      .from('repair_options')
      .select('id, is_recommended')
      .eq('repair_item_id', item.id)
      .order('is_recommended', { ascending: false })
      .order('sort_order')

    let selectedOptionId = selectionMap.get(item.id) || null

    // If has options but no selection provided, use recommended or first
    if ((options || []).length > 0 && !selectedOptionId) {
      const recommended = (options || []).find(o => o.is_recommended)
      selectedOptionId = recommended?.id || (options || [])[0]?.id || null
    }

    const updateData: Record<string, unknown> = {
      customer_approved: true,
      customer_approved_at: now,
      customer_declined_reason: null,
      // Phase 7: Set outcome status for customer portal sync
      outcome_status: 'authorised',
      outcome_set_at: now,
      outcome_source: 'online',
      updated_at: now
    }
    if (selectedOptionId) {
      updateData.selected_option_id = selectedOptionId
    }

    await supabaseAdmin
      .from('repair_items')
      .update(updateData)
      .eq('id', item.id)

    approvedCount++
  }

  // Track activity
  await trackActivity(healthCheck.id, 'approve_all', null, c, {
    approvedCount
  })

  // Update health check status
  await updateHealthCheckStatusForNewRepairItems(healthCheck.id, healthCheck.site_id)

  return c.json({
    success: true,
    message: `Approved ${approvedCount} repair items`,
    approvedCount
  })
})

/**
 * POST /api/public/vhc/:token/repair-items/decline-all
 * Decline all pending new repair items
 */
publicRoutes.post('/vhc/:token/repair-items/decline-all', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const { reason } = body

  // Find health check by token
  const { data: healthCheck, error } = await supabaseAdmin
    .from('health_checks')
    .select('id, status, token_expires_at, site_id')
    .eq('public_token', token)
    .single()

  if (error || !healthCheck) {
    return c.json({ error: 'Health check not found' }, 404)
  }

  // Check expiry
  if (healthCheck.token_expires_at && new Date(healthCheck.token_expires_at) < new Date()) {
    return c.json({ error: 'Link has expired' }, 410)
  }

  // Decline all pending repair items
  const now = new Date().toISOString()
  const { data: updatedItems, error: updateError } = await supabaseAdmin
    .from('repair_items')
    .update({
      customer_approved: false,
      customer_approved_at: now,
      customer_declined_reason: reason || 'Declined all',
      selected_option_id: null,
      // Phase 7: Set outcome status for customer portal sync
      outcome_status: 'declined',
      outcome_set_at: now,
      outcome_source: 'online',
      updated_at: now
    })
    .eq('health_check_id', healthCheck.id)
    .is('customer_approved', null)
    .select('id')

  if (updateError) {
    console.error('Decline all error:', updateError)
    return c.json({ error: 'Failed to decline items' }, 500)
  }

  const declinedCount = (updatedItems || []).length

  // Track activity
  await trackActivity(healthCheck.id, 'decline_all', null, c, {
    declinedCount,
    reason
  })

  // Update health check status
  await updateHealthCheckStatusForNewRepairItems(healthCheck.id, healthCheck.site_id)

  return c.json({
    success: true,
    message: `Declined ${declinedCount} repair items`,
    declinedCount
  })
})

/**
 * Helper: Track customer activity
 */
async function trackActivity(
  healthCheckId: string,
  activityType: string,
  repairItemId: string | null,
  c: { req: { header: (name: string) => string | undefined } },
  metadata?: Record<string, unknown>
) {
  // Get client info (null if no valid IP)
  const rawIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')
  const ipAddress = rawIp && /^[\d.:a-fA-F]+$/.test(rawIp) ? rawIp : null
  const userAgent = c.req.header('user-agent') || ''

  // Detect device type from user agent
  let deviceType = 'desktop'
  if (/mobile/i.test(userAgent)) {
    deviceType = 'mobile'
  } else if (/tablet|ipad/i.test(userAgent)) {
    deviceType = 'tablet'
  }

  await supabaseAdmin
    .from('customer_activities')
    .insert({
      health_check_id: healthCheckId,
      activity_type: activityType,
      repair_item_id: repairItemId,
      metadata: metadata || {},
      ip_address: ipAddress,
      user_agent: userAgent,
      device_type: deviceType
    })
}

// NOTE: Legacy updateHealthCheckStatus and updateReasonApprovalStats functions removed
// as part of migration to new authorization system (customer_approved on repair_items)

/**
 * Helper: Send authorization confirmation email/SMS to customer
 * Called once when health check transitions to 'authorized' status
 */
async function sendCustomerAuthorizationConfirmation(healthCheckId: string) {
  try {
    // Check if confirmation was already sent for this health check
    const { data: existingLog } = await supabaseAdmin
      .from('communication_logs')
      .select('id')
      .eq('health_check_id', healthCheckId)
      .eq('template_id', 'authorization_confirmation')
      .limit(1)
      .single()

    if (existingLog) {
      console.log(`Authorization confirmation already sent for health check ${healthCheckId}, skipping`)
      return
    }

    // Fetch health check with customer, vehicle, site, org details
    const { data: hc } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        organization_id,
        customer:customers(first_name, last_name, email, mobile),
        vehicle:vehicles(registration),
        site:sites(name, phone)
      `)
      .eq('id', healthCheckId)
      .single()

    if (!hc) return

    const customer = hc.customer as unknown as { first_name: string; last_name: string; email: string; mobile: string }
    const vehicle = hc.vehicle as unknown as { registration: string }
    const site = hc.site as unknown as { name: string; phone: string }

    if (!customer) return

    const customerName = `${customer.first_name} ${customer.last_name}`
    const vehicleReg = vehicle?.registration || ''
    const dealershipName = site?.name || ''
    const dealershipPhone = site?.phone || ''

    // Get approved items with prices
    const { data: approvedItems } = await supabaseAdmin
      .from('repair_items')
      .select('name, total_inc_vat, selected_option_id')
      .eq('health_check_id', healthCheckId)
      .eq('customer_approved', true)

    if (!approvedItems || approvedItems.length === 0) return

    // Build items list with correct prices (use selected option price if applicable)
    const itemsList: Array<{ title: string; price: number }> = []
    let totalAuthorized = 0

    for (const item of approvedItems) {
      let price = item.total_inc_vat || 0
      if (item.selected_option_id) {
        const { data: option } = await supabaseAdmin
          .from('repair_options')
          .select('total_inc_vat')
          .eq('id', item.selected_option_id)
          .single()
        if (option?.total_inc_vat) price = option.total_inc_vat
      }
      itemsList.push({ title: item.name, price })
      totalAuthorized += price
    }

    // Send email
    if (customer.email) {
      try {
        await sendAuthorizationConfirmationEmail(
          customer.email,
          customerName,
          vehicleReg,
          itemsList,
          totalAuthorized,
          dealershipName,
          dealershipPhone,
          hc.organization_id
        )

        await supabaseAdmin.from('communication_logs').insert({
          health_check_id: healthCheckId,
          channel: 'email',
          recipient: customer.email,
          subject: `Authorization Confirmation - ${vehicleReg}`,
          status: 'sent',
          template_id: 'authorization_confirmation'
        })
      } catch (err) {
        console.error('Failed to send authorization confirmation email:', err)
      }
    }

    // Send SMS
    if (customer.mobile) {
      try {
        await sendAuthorizationConfirmationSms(
          customer.mobile,
          customerName,
          vehicleReg,
          totalAuthorized,
          dealershipName,
          hc.organization_id,
          approvedItems.length
        )

        await supabaseAdmin.from('communication_logs').insert({
          health_check_id: healthCheckId,
          channel: 'sms',
          recipient: customer.mobile,
          status: 'sent',
          template_id: 'authorization_confirmation'
        })
      } catch (err) {
        console.error('Failed to send authorization confirmation SMS:', err)
      }
    }

    console.log(`Authorization confirmation sent for health check ${healthCheckId}`)
  } catch (err) {
    console.error('Error sending authorization confirmation:', err)
  }
}

/**
 * Helper: Update health check status based on new repair items (Phase 6+)
 * This handles the customer_approved field on the repair_items table
 */
async function updateHealthCheckStatusForNewRepairItems(healthCheckId: string, siteId: string) {
  try {
    // Get health check current state
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('first_response_at')
      .eq('id', healthCheckId)
      .single()

    if (!healthCheck) return

    // Get all new repair items for this health check
    const { data: repairItems } = await supabaseAdmin
      .from('repair_items')
      .select('id, customer_approved, total_inc_vat, selected_option_id')
      .eq('health_check_id', healthCheckId)

    if (!repairItems || repairItems.length === 0) return

    const totalItems = repairItems.length
    const approvedItems = repairItems.filter(r => r.customer_approved === true)
    const declinedItems = repairItems.filter(r => r.customer_approved === false)
    const pendingItems = repairItems.filter(r => r.customer_approved === null)

    const approvedCount = approvedItems.length
    const declinedCount = declinedItems.length
    const respondedCount = approvedCount + declinedCount

    // Calculate totals - for items with options, get price from selected option
    let totalApprovedAmount = 0
    let totalDeclinedAmount = 0

    for (const item of approvedItems) {
      if (item.selected_option_id) {
        const { data: option } = await supabaseAdmin
          .from('repair_options')
          .select('total_inc_vat')
          .eq('id', item.selected_option_id)
          .single()
        totalApprovedAmount += option?.total_inc_vat || item.total_inc_vat || 0
      } else {
        totalApprovedAmount += item.total_inc_vat || 0
      }
    }

    for (const item of declinedItems) {
      totalDeclinedAmount += item.total_inc_vat || 0
    }

    // Determine action for notification
    const lastAction = approvedItems.length >= declinedItems.length ? 'authorized' : 'declined'

    // Notify staff
    await notifyCustomerAction(healthCheckId, siteId, lastAction, {
      totalAuthorized: totalApprovedAmount,
      totalDeclined: totalDeclinedAmount,
      approvedCount,
      declinedCount
    })

    // Determine new status
    let newStatus: string | null = null

    if (respondedCount === 0) {
      // No decisions yet
      return
    } else if (pendingItems.length > 0) {
      // Still have pending items
      newStatus = 'partial_response'
    } else if (declinedCount === totalItems) {
      // All declined
      newStatus = 'declined'
    } else {
      // All items have been actioned (mix of approved/declined or all approved)
      newStatus = 'authorized'
    }

    if (newStatus) {
      const updateData: Record<string, unknown> = {
        status: newStatus,
        updated_at: new Date().toISOString()
      }

      if (newStatus === 'authorized' || newStatus === 'declined') {
        updateData.fully_responded_at = new Date().toISOString()
        // Cancel pending reminders when customer fully responds
        await cancelHealthCheckReminders(healthCheckId)
        // Send authorization confirmation to customer
        if (newStatus === 'authorized') {
          sendCustomerAuthorizationConfirmation(healthCheckId).catch(err =>
            console.error('Failed to send authorization confirmation:', err)
          )
        }
      } else if (newStatus === 'partial_response') {
        // Set first_response_at if not already set
        if (!healthCheck.first_response_at) {
          updateData.first_response_at = new Date().toISOString()
        }
      }

      await supabaseAdmin
        .from('health_checks')
        .update(updateData)
        .eq('id', healthCheckId)
    }
  } catch (err) {
    console.error('Error updating health check status for new repair items:', err)
  }
}

export default publicRoutes
