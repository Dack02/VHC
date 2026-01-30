import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { Errors } from '../../lib/errors.js'
import { authorize } from '../../middleware/auth.js'

interface RepairItem {
  id: string
  name: string
  outcome_status: string | null
  total_inc_vat: number | null
  outcome_source: string | null
}

interface CustomerActivity {
  id: string
  activity_type: string
  repair_item_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  device_type: string | null
  created_at: string
}

interface CommunicationLog {
  id: string
  channel: string
  recipient: string
  subject: string | null
  status: string
  error_message: string | null
  metadata: { delivered_at?: string } | null
  created_at: string
}

interface StatusHistoryEntry {
  id: string
  from_status: string | null
  to_status: string
  notes: string | null
  changed_at: string
}

const customerActivityRouter = new Hono()

// GET /api/v1/health-checks/:id/customer-activity
// Returns customer engagement data for a health check
customerActivityRouter.get(
  '/:id/customer-activity',
  authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']),
  async (c) => {
    const { id } = c.req.param()
    const auth = c.get('auth')

    // Verify health check exists and belongs to user's org
    const { data: healthCheck, error: hcError } = await supabaseAdmin
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
      .eq('organization_id', auth.orgId)
      .single()

    if (hcError || !healthCheck) {
      throw Errors.notFound('Health check')
    }

    // Fetch customer activities
    const { data: activities, error: activitiesError } = await supabaseAdmin
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
    const { data: communications, error: commsError } = await supabaseAdmin
      .from('communication_logs')
      .select(`
        id,
        channel,
        recipient,
        subject,
        status,
        error_message,
        metadata,
        created_at
      `)
      .eq('health_check_id', id)
      .order('created_at', { ascending: false })

    if (commsError) {
      console.error('Error fetching communication logs:', commsError)
    }

    // Fetch customer-triggered status changes
    const { data: statusHistory, error: statusError } = await supabaseAdmin
      .from('health_check_status_history')
      .select(`
        id,
        from_status,
        to_status,
        notes,
        changed_at
      `)
      .eq('health_check_id', id)
      .eq('change_source', 'customer')
      .order('changed_at', { ascending: false })

    if (statusError) {
      console.error('Error fetching status history:', statusError)
    }

    // Fetch all repair items for this health check (need names + prices for activity details)
    const { data: repairItems } = await supabaseAdmin
      .from('repair_items')
      .select(`
        id,
        name,
        outcome_status,
        total_inc_vat,
        outcome_source
      `)
      .eq('health_check_id', id)

    const typedRepairItems = (repairItems || []) as RepairItem[]

    // Build a lookup map for repair item details
    const repairItemMap = new Map<string, RepairItem>()
    for (const item of typedRepairItems) {
      repairItemMap.set(item.id, item)
    }

    // Count approved/declined items (customer online decisions)
    const itemsWithOutcome = typedRepairItems.filter((item) => item.outcome_status != null)
    const approvedItems = itemsWithOutcome.filter(
      (item) => item.outcome_status === 'authorised' && item.outcome_source === 'online'
    )
    const declinedItems = itemsWithOutcome.filter(
      (item) => item.outcome_status === 'declined' && item.outcome_source === 'online'
    )
    const deferredItems = itemsWithOutcome.filter(
      (item) => item.outcome_status === 'deferred' && item.outcome_source === 'online'
    )

    const getItemValue = (item: RepairItem) => item.total_inc_vat || 0
    const approvedValue = approvedItems.reduce((sum, item) => sum + getItemValue(item), 0)
    const declinedValue = declinedItems.reduce((sum, item) => sum + getItemValue(item), 0)
    const deferredValue = deferredItems.reduce((sum, item) => sum + getItemValue(item), 0)

    // Determine response status
    let responseStatus: 'pending' | 'partial' | 'complete' = 'pending'
    const typedActivities = (activities || []) as CustomerActivity[]
    if (typedActivities.length > 0) {
      const hasApprovals = typedActivities.some(
        (a) => a.activity_type === 'repair_item_approved' || a.activity_type === 'approve_all' || a.activity_type === 'signed'
      )
      const hasDeclines = typedActivities.some(
        (a) => a.activity_type === 'repair_item_declined' || a.activity_type === 'decline_all'
      )
      if (hasApprovals || hasDeclines) {
        const decidedItems = itemsWithOutcome.filter(
          (item) =>
            item.outcome_status !== 'incomplete' &&
            item.outcome_status !== 'ready'
        )
        if (decidedItems.length === typedRepairItems.length && typedRepairItems.length > 0) {
          responseStatus = 'complete'
        } else if (decidedItems.length > 0) {
          responseStatus = 'partial'
        }
      }
    }

    // Calculate total authorised value (for signed activity)
    const totalAuthorisedValue = approvedItems.reduce((sum, item) => sum + getItemValue(item), 0)

    const typedCommunications = (communications || []) as CommunicationLog[]
    const typedStatusHistory = (statusHistory || []) as StatusHistoryEntry[]

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
      communications: typedCommunications.map((comm) => ({
        id: comm.id,
        channel: comm.channel,
        recipient: comm.recipient,
        subject: comm.subject,
        status: comm.status,
        errorMessage: comm.error_message,
        sentAt: comm.created_at,
        deliveredAt: comm.metadata?.delivered_at || null
      })),
      activities: typedActivities.map((activity) => {
        // Look up repair item details for item-specific activities
        const repairItem = activity.repair_item_id
          ? repairItemMap.get(activity.repair_item_id)
          : null

        // For signed activity, attach the total authorised value
        const isSigned = activity.activity_type === 'signed'

        return {
          id: activity.id,
          type: activity.activity_type,
          repairItemId: activity.repair_item_id,
          repairItemName: repairItem?.name || null,
          repairItemValue: repairItem ? getItemValue(repairItem) : null,
          // For signed/approve_all: include total authorised value
          totalAuthorisedValue: isSigned ? totalAuthorisedValue : null,
          totalAuthorisedCount: isSigned ? approvedItems.length : null,
          metadata: activity.metadata,
          ipAddress: maskIpAddress(activity.ip_address),
          deviceType: activity.device_type || detectDeviceType(activity.user_agent),
          timestamp: activity.created_at
        }
      }),
      statusChanges: typedStatusHistory.map((change) => ({
        id: change.id,
        fromStatus: change.from_status,
        toStatus: change.to_status,
        notes: change.notes,
        timestamp: change.changed_at
      }))
    }

    return c.json(response)
  }
)

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
