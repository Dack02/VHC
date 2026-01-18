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

  // Get authorizations
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

  // Track activity
  await trackActivity(healthCheck.id, 'viewed', null, c)

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
    repairItems: enhancedRepairItems,
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

export default publicRoutes
