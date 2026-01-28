import { Hono } from 'hono'
import { supabase } from '../../lib/supabase.js'
import { Errors } from '../../lib/errors.js'
import type { AuthContext } from '../../middleware/auth.js'

const customerActivityRouter = new Hono<{ Variables: AuthContext }>()

// GET /api/v1/health-checks/:id/customer-activity
// Returns customer engagement data for a health check
customerActivityRouter.get('/:id/customer-activity', async (c) => {
  const { id } = c.req.param()
  const auth = c.get('auth')

  // Verify health check exists and belongs to user's org
  const { data: healthCheck, error: hcError } = await supabase
    .from('health_checks')
    .select(`
      id,
      organization_id,
      customer_view_count,
      customer_first_viewed_at,
      customer_last_viewed_at,
      sent_at,
      status
    `)
    .eq('id', id)
    .eq('organization_id', auth.user.organization_id)
    .single()

  if (hcError || !healthCheck) {
    throw Errors.notFound('Health check')
  }

  // Fetch customer activities
  const { data: activities, error: activitiesError } = await supabase
    .from('customer_activities')
    .select(`
      id,
      activity_type,
      repair_item_id,
      metadata,
      ip_address,
      user_agent,
      device_type,
      created_at
    `)
    .eq('health_check_id', id)
    .order('created_at', { ascending: false })

  if (activitiesError) {
    console.error('Error fetching customer activities:', activitiesError)
  }

  // Fetch communication logs
  const { data: communications, error: commsError } = await supabase
    .from('communication_logs')
    .select(`
      id,
      channel,
      recipient,
      subject,
      status,
      external_id,
      error_message,
      metadata,
      created_at,
      updated_at
    `)
    .eq('health_check_id', id)
    .order('created_at', { ascending: false })

  if (commsError) {
    console.error('Error fetching communication logs:', commsError)
  }

  // Fetch customer-triggered status changes
  const { data: statusHistory, error: statusError } = await supabase
    .from('health_check_status_history')
    .select(`
      id,
      from_status,
      to_status,
      change_source,
      notes,
      changed_at
    `)
    .eq('health_check_id', id)
    .eq('change_source', 'customer')
    .order('changed_at', { ascending: false })

  if (statusError) {
    console.error('Error fetching status history:', statusError)
  }

  // Calculate summary stats from activities and repair items
  const { data: repairItems } = await supabase
    .from('repair_items')
    .select(`
      id,
      outcome_status,
      total_price,
      outcome_source
    `)
    .eq('health_check_id', id)
    .not('outcome_status', 'is', null)

  // Count approved/declined items (customer online decisions)
  const approvedItems = repairItems?.filter(item =>
    item.outcome_status === 'authorised' && item.outcome_source === 'online'
  ) || []
  const declinedItems = repairItems?.filter(item =>
    item.outcome_status === 'declined' && item.outcome_source === 'online'
  ) || []
  const deferredItems = repairItems?.filter(item =>
    item.outcome_status === 'deferred' && item.outcome_source === 'online'
  ) || []

  const approvedValue = approvedItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const declinedValue = declinedItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const deferredValue = deferredItems.reduce((sum, item) => sum + (item.total_price || 0), 0)

  // Determine response status
  let responseStatus: 'pending' | 'partial' | 'complete' = 'pending'
  if (activities && activities.length > 0) {
    const hasApprovals = activities.some(a => a.activity_type === 'approved' || a.activity_type === 'signed')
    const hasDeclines = activities.some(a => a.activity_type === 'declined')
    if (hasApprovals || hasDeclines) {
      // Check if all items have been decided
      const allItems = repairItems || []
      const decidedItems = allItems.filter(item =>
        item.outcome_status &&
        item.outcome_status !== 'incomplete' &&
        item.outcome_status !== 'ready'
      )
      if (decidedItems.length === allItems.length && allItems.length > 0) {
        responseStatus = 'complete'
      } else if (decidedItems.length > 0) {
        responseStatus = 'partial'
      }
    }
  }

  // Build response
  const response = {
    summary: {
      totalViews: healthCheck.customer_view_count || 0,
      firstViewedAt: healthCheck.customer_first_viewed_at,
      lastViewedAt: healthCheck.customer_last_viewed_at,
      sentAt: healthCheck.sent_at,
      responseStatus,
      approved: {
        count: approvedItems.length,
        value: approvedValue
      },
      declined: {
        count: declinedItems.length,
        value: declinedValue
      },
      deferred: {
        count: deferredItems.length,
        value: deferredValue
      }
    },
    communications: (communications || []).map(comm => ({
      id: comm.id,
      channel: comm.channel,
      recipient: comm.recipient,
      subject: comm.subject,
      status: comm.status,
      errorMessage: comm.error_message,
      sentAt: comm.created_at,
      deliveredAt: comm.metadata?.delivered_at || null
    })),
    activities: (activities || []).map(activity => ({
      id: activity.id,
      type: activity.activity_type,
      repairItemId: activity.repair_item_id,
      metadata: activity.metadata,
      ipAddress: maskIpAddress(activity.ip_address),
      deviceType: activity.device_type || detectDeviceType(activity.user_agent),
      timestamp: activity.created_at
    })),
    statusChanges: (statusHistory || []).map(change => ({
      id: change.id,
      fromStatus: change.from_status,
      toStatus: change.to_status,
      notes: change.notes,
      timestamp: change.changed_at
    }))
  }

  return c.json(response)
})

// Helper to mask IP address for privacy (show first two octets only)
function maskIpAddress(ip: string | null): string | null {
  if (!ip) return null
  const parts = ip.split('.')
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`
  }
  // IPv6 - just show abbreviated
  return ip.substring(0, 10) + '...'
}

// Helper to detect device type from user agent
function detectDeviceType(userAgent: string | null): string {
  if (!userAgent) return 'unknown'
  const ua = userAgent.toLowerCase()
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return 'mobile'
  }
  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'tablet'
  }
  return 'desktop'
}

export default customerActivityRouter
