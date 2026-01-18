/**
 * Public API routes for Customer Portal
 * No authentication required - token-based access
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { cancelHealthCheckReminders, notifyCustomerAction } from '../services/scheduler.js'

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

  // Get repair items with their check results
  const { data: repairItems } = await supabaseAdmin
    .from('repair_items')
    .select(`
      id,
      title,
      description,
      rag_status,
      parts_cost,
      labor_cost,
      total_price,
      is_visible,
      is_mot_failure,
      follow_up_date,
      sort_order,
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
    `)
    .eq('health_check_id', healthCheck.id)
    .eq('is_visible', true)
    .order('sort_order')

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
        annotation_data,
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
      created_at
    `)
    .eq('health_check_id', healthCheck.id)
    .order('created_at')

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

    return {
      id: item.id,
      name: item.name,
      description: item.description,
      isGroup: item.is_group,
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
      linkedCheckResults: linkedCheckResultNames
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
              annotation_data: m.annotation_data,
              sort_order: m.sort_order
            }
          })
      }
    }),
    isFirstView
  })
})

/**
 * POST /api/public/vhc/:token/authorize
 * Authorize a repair item
 */
publicRoutes.post('/vhc/:token/authorize', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const { repairItemId, notes } = body

  if (!repairItemId) {
    return c.json({ error: 'repairItemId is required' }, 400)
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

  // Verify repair item belongs to this health check
  const { data: repairItem } = await supabaseAdmin
    .from('repair_items')
    .select('id')
    .eq('id', repairItemId)
    .eq('health_check_id', healthCheck.id)
    .single()

  if (!repairItem) {
    return c.json({ error: 'Repair item not found' }, 404)
  }

  // Get client info (null if no valid IP)
  const rawIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')
  const ipAddress = rawIp && /^[\d.:a-fA-F]+$/.test(rawIp) ? rawIp : null
  const userAgent = c.req.header('user-agent') || ''

  // Upsert authorization
  const { data: auth, error: authError } = await supabaseAdmin
    .from('authorizations')
    .upsert({
      health_check_id: healthCheck.id,
      repair_item_id: repairItemId,
      decision: 'approved',
      decided_at: new Date().toISOString(),
      customer_notes: notes || null,
      signature_ip: ipAddress,
      signature_user_agent: userAgent
    }, {
      onConflict: 'repair_item_id'
    })
    .select()
    .single()

  if (authError) {
    console.error('Authorization error:', authError)
    return c.json({ error: 'Failed to save authorization' }, 500)
  }

  // Track activity
  await trackActivity(healthCheck.id, 'authorized', repairItemId, c)

  // Update reason approval stats
  await updateReasonApprovalStats(repairItemId, true)

  // Check if all items have been actioned and update status
  await updateHealthCheckStatus(healthCheck.id, 'authorized')

  return c.json({
    authorization: auth,
    message: 'Item authorized successfully'
  })
})

/**
 * POST /api/public/vhc/:token/decline
 * Decline a repair item
 */
publicRoutes.post('/vhc/:token/decline', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const { repairItemId, notes } = body

  if (!repairItemId) {
    return c.json({ error: 'repairItemId is required' }, 400)
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

  // Verify repair item belongs to this health check
  const { data: repairItem } = await supabaseAdmin
    .from('repair_items')
    .select('id')
    .eq('id', repairItemId)
    .eq('health_check_id', healthCheck.id)
    .single()

  if (!repairItem) {
    return c.json({ error: 'Repair item not found' }, 404)
  }

  // Get client info (null if no valid IP)
  const rawIpDecline = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')
  const ipAddress = rawIpDecline && /^[\d.:a-fA-F]+$/.test(rawIpDecline) ? rawIpDecline : null
  const userAgent = c.req.header('user-agent') || ''

  // Upsert authorization
  const { data: auth, error: authError } = await supabaseAdmin
    .from('authorizations')
    .upsert({
      health_check_id: healthCheck.id,
      repair_item_id: repairItemId,
      decision: 'declined',
      decided_at: new Date().toISOString(),
      customer_notes: notes || null,
      signature_ip: ipAddress,
      signature_user_agent: userAgent
    }, {
      onConflict: 'repair_item_id'
    })
    .select()
    .single()

  if (authError) {
    console.error('Decline error:', authError)
    return c.json({ error: 'Failed to save decision' }, 500)
  }

  // Track activity
  await trackActivity(healthCheck.id, 'declined', repairItemId, c)

  // Update reason approval stats
  await updateReasonApprovalStats(repairItemId, false)

  // Check if all items have been actioned and update status
  await updateHealthCheckStatus(healthCheck.id, 'declined')

  return c.json({
    authorization: auth,
    message: 'Item declined'
  })
})

/**
 * POST /api/public/vhc/:token/signature
 * Submit signature for authorized items
 */
publicRoutes.post('/vhc/:token/signature', async (c) => {
  const token = c.req.param('token')
  const body = await c.req.json()
  const { signatureData } = body

  if (!signatureData) {
    return c.json({ error: 'signatureData is required' }, 400)
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

  // Get client info (null if no valid IP)
  const rawIpSig = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')
  const ipAddress = rawIpSig && /^[\d.:a-fA-F]+$/.test(rawIpSig) ? rawIpSig : null
  const userAgent = c.req.header('user-agent') || ''

  // Update all approved authorizations with signature
  const { error: updateError } = await supabaseAdmin
    .from('authorizations')
    .update({
      signature_data: signatureData,
      signature_ip: ipAddress,
      signature_user_agent: userAgent
    })
    .eq('health_check_id', healthCheck.id)
    .eq('decision', 'approved')

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

  return c.json({
    message: 'Signature saved successfully'
  })
})

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
 * Approve a new repair item (with optional selected option)
 */
publicRoutes.post('/vhc/:token/repair-items/:repairItemId/approve', async (c) => {
  const token = c.req.param('token')
  const repairItemId = c.req.param('repairItemId')
  const body = await c.req.json()
  const { selectedOptionId, notes } = body

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

  // Update the repair item
  const updateData: Record<string, unknown> = {
    customer_approved: true,
    customer_approved_at: new Date().toISOString(),
    customer_declined_reason: null,
    updated_at: new Date().toISOString()
  }
  if (selectedOptionId) {
    updateData.selected_option_id = selectedOptionId
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
    ipAddress
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
  const { error: updateError } = await supabaseAdmin
    .from('repair_items')
    .update({
      customer_approved: false,
      customer_approved_at: new Date().toISOString(),
      customer_declined_reason: reason || notes || null,
      selected_option_id: null,
      updated_at: new Date().toISOString()
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

/**
 * Helper: Update health check status based on authorizations
 */
async function updateHealthCheckStatus(healthCheckId: string, action: 'authorized' | 'declined') {
  // Get health check with site_id
  const { data: healthCheck } = await supabaseAdmin
    .from('health_checks')
    .select('site_id, first_response_at')
    .eq('id', healthCheckId)
    .single()

  if (!healthCheck) return

  // Get all visible repair items
  const { data: repairItems } = await supabaseAdmin
    .from('repair_items')
    .select('id, total_price')
    .eq('health_check_id', healthCheckId)
    .eq('is_visible', true)

  // Get all authorizations
  const { data: authorizations } = await supabaseAdmin
    .from('authorizations')
    .select('repair_item_id, decision')
    .eq('health_check_id', healthCheckId)

  const totalItems = repairItems?.length || 0
  const totalAuthorizations = authorizations?.length || 0
  const approvedCount = authorizations?.filter(a => a.decision === 'approved').length || 0
  const declinedCount = authorizations?.filter(a => a.decision === 'declined').length || 0

  // Calculate totals for notifications
  const approvedItemIds = new Set(authorizations?.filter(a => a.decision === 'approved').map(a => a.repair_item_id))
  const declinedItemIds = new Set(authorizations?.filter(a => a.decision === 'declined').map(a => a.repair_item_id))
  const totalAuthorizedAmount = repairItems?.filter(r => approvedItemIds.has(r.id)).reduce((sum, r) => sum + (r.total_price || 0), 0) || 0
  const totalDeclinedAmount = repairItems?.filter(r => declinedItemIds.has(r.id)).reduce((sum, r) => sum + (r.total_price || 0), 0) || 0

  // Notify staff of customer action
  await notifyCustomerAction(healthCheckId, healthCheck.site_id, action, {
    totalAuthorized: totalAuthorizedAmount,
    totalDeclined: totalDeclinedAmount,
    approvedCount,
    declinedCount
  })

  let newStatus: string | null = null

  if (totalAuthorizations === 0) {
    // No decisions yet
    return
  } else if (totalAuthorizations < totalItems) {
    // Partial response
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
}

/**
 * Helper: Update reason approval stats when customer approves/declines
 * This updates the customer_approved field on check_result_reasons
 * which triggers the approval stats update via database trigger
 */
async function updateReasonApprovalStats(repairItemId: string, approved: boolean) {
  try {
    // Get the repair item to find its check_result_id
    const { data: repairItem } = await supabaseAdmin
      .from('repair_items')
      .select('check_result_id')
      .eq('id', repairItemId)
      .single()

    if (!repairItem?.check_result_id) return

    // Update all reasons for this check result with the customer's decision
    const { error } = await supabaseAdmin
      .from('check_result_reasons')
      .update({
        customer_approved: approved,
        customer_responded_at: new Date().toISOString()
      })
      .eq('check_result_id', repairItem.check_result_id)

    if (error) {
      console.error('Failed to update reason approval stats:', error)
    }
  } catch (err) {
    console.error('Error updating reason approval stats:', err)
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
