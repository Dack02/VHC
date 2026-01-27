import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'

const timeline = new Hono()

interface TimelineEvent {
  id: string
  event_type: string
  timestamp: string
  user: { first_name: string; last_name: string } | null
  description: string
  details: Record<string, unknown>
}

// Helper to extract user from Supabase join (handles both object and array)
function extractUser(userObj: unknown): { first_name: string; last_name: string } | null {
  if (!userObj) return null
  // Supabase can return arrays for joins
  const user = Array.isArray(userObj) ? userObj[0] : userObj
  if (!user || typeof user !== 'object') return null
  const u = user as { first_name?: string; last_name?: string }
  if (!u.first_name && !u.last_name) return null
  return { first_name: u.first_name || '', last_name: u.last_name || '' }
}

// GET /:id/timeline - Get unified timeline for health check
timeline.get('/:id/timeline', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, created_at')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const events: TimelineEvent[] = []

    // 1. Get status history events
    const { data: historyData } = await supabaseAdmin
      .from('health_check_status_history')
      .select(`
        id, from_status, to_status, changed_at, notes,
        user:users(first_name, last_name)
      `)
      .eq('health_check_id', id)
      .order('changed_at', { ascending: true })

    if (historyData) {
      for (const h of historyData) {
        const user = extractUser(h.user)
        events.push({
          id: `status_${h.id}`,
          event_type: 'status_change',
          timestamp: h.changed_at,
          user,
          description: h.from_status
            ? `Status changed from ${formatStatus(h.from_status)} to ${formatStatus(h.to_status)}`
            : `Status set to ${formatStatus(h.to_status)}`,
          details: {
            from_status: h.from_status,
            to_status: h.to_status,
            notes: h.notes
          }
        })
      }
    }

    // 2. Get audit log events for this health check
    const { data: auditData } = await supabaseAdmin
      .from('audit_logs')
      .select(`
        id, action, created_at, metadata,
        user:users!audit_logs_actor_id_fkey(first_name, last_name)
      `)
      .eq('organization_id', auth.orgId)
      .in('action', [
        'labour.add', 'labour.update', 'labour.delete', 'labour.complete',
        'parts.add', 'parts.update', 'parts.delete', 'parts.complete',
        'repair_item.authorise', 'repair_item.defer', 'repair_item.decline'
      ])
      .order('created_at', { ascending: true })

    if (auditData) {
      for (const audit of auditData) {
        const metadata = audit.metadata as Record<string, unknown> || {}

        // Filter to only events for this health check
        if (metadata.health_check_id !== id) continue

        const user = extractUser(audit.user)
        const itemName = (metadata.item_name as string) || 'Unknown item'

        let eventType = ''
        let description = ''

        switch (audit.action) {
          case 'labour.add': {
            eventType = 'labour_added'
            const labourCode = (metadata.labour_description as string) || (metadata.labour_code as string) || ''
            const hours = metadata.hours as number
            description = `Added labour: ${labourCode}${hours ? ` - ${hours} hrs` : ''}`
            break
          }
          case 'labour.update': {
            eventType = 'labour_updated'
            const oldHours = metadata.old_hours as number
            const newHours = metadata.new_hours as number
            const oldTotal = metadata.old_total as number
            const newTotal = metadata.new_total as number
            if (oldHours !== newHours) {
              description = `Updated labour hours: ${oldHours} hrs → ${newHours} hrs`
            } else if (oldTotal !== newTotal) {
              description = `Updated labour: £${oldTotal?.toFixed(2)} → £${newTotal?.toFixed(2)}`
            } else {
              description = `Updated labour entry`
            }
            break
          }
          case 'labour.delete': {
            eventType = 'labour_deleted'
            const labourDesc = (metadata.labour_description as string) || (metadata.labour_code as string) || 'labour entry'
            description = `Removed labour: ${labourDesc}`
            break
          }
          case 'labour.complete': {
            eventType = 'labour_completed'
            const labourTotal = metadata.labour_total as number
            description = `Labour completed${labourTotal ? ` - £${labourTotal.toFixed(2)}` : ''}`
            break
          }
          case 'parts.add': {
            eventType = 'parts_added'
            const partDesc = (metadata.description as string) || 'Part'
            const qty = metadata.quantity as number
            description = `Added part: ${partDesc}${qty && qty > 1 ? ` x${qty}` : ''}`
            break
          }
          case 'parts.update': {
            eventType = 'parts_updated'
            const oldQty = metadata.old_quantity as number
            const newQty = metadata.new_quantity as number
            const oldLineTotal = metadata.old_line_total as number
            const newLineTotal = metadata.new_line_total as number
            if (oldQty !== newQty) {
              description = `Updated part quantity: ${oldQty} → ${newQty}`
            } else if (oldLineTotal !== newLineTotal) {
              description = `Updated part price: £${oldLineTotal?.toFixed(2)} → £${newLineTotal?.toFixed(2)}`
            } else {
              description = `Updated part entry`
            }
            break
          }
          case 'parts.delete': {
            eventType = 'parts_deleted'
            const partName = (metadata.description as string) || 'part'
            description = `Removed part: ${partName}`
            break
          }
          case 'parts.complete': {
            eventType = 'parts_completed'
            const partsTotal = metadata.parts_total as number
            description = `Parts completed${partsTotal ? ` - £${partsTotal.toFixed(2)}` : ''}`
            break
          }
          case 'repair_item.authorise': {
            eventType = 'outcome_authorised'
            description = `${itemName} authorised`
            break
          }
          case 'repair_item.defer': {
            eventType = 'outcome_deferred'
            description = `${itemName} deferred`
            break
          }
          case 'repair_item.decline': {
            eventType = 'outcome_declined'
            description = `${itemName} declined`
            break
          }
          default:
            continue
        }

        events.push({
          id: `audit_${audit.id}`,
          event_type: eventType,
          timestamp: audit.created_at,
          user,
          description,
          details: {
            item_name: itemName,
            ...metadata
          }
        })
      }
    }

    // 3. Get repair item completion events (labour_completed_at, parts_completed_at)
    // These may not have audit logs if they were set before audit logging was added
    const { data: repairItems } = await supabaseAdmin
      .from('repair_items')
      .select(`
        id, name,
        labour_completed_at, labour_completed_by,
        labour_completed_by_user:users!repair_items_labour_completed_by_fkey(first_name, last_name),
        parts_completed_at, parts_completed_by,
        parts_completed_by_user:users!repair_items_parts_completed_by_fkey(first_name, last_name),
        outcome_status, outcome_set_at, outcome_set_by,
        outcome_set_by_user:users!repair_items_outcome_set_by_fkey(first_name, last_name)
      `)
      .eq('health_check_id', id)

    if (repairItems) {
      for (const item of repairItems) {
        // Check for labour completion not already in audit logs
        if (item.labour_completed_at) {
          const existingLabourComplete = events.find(e =>
            e.event_type === 'labour_completed' &&
            e.details.repair_item_id === item.id
          )
          if (!existingLabourComplete) {
            const user = extractUser(item.labour_completed_by_user)
            events.push({
              id: `labour_complete_${item.id}`,
              event_type: 'labour_completed',
              timestamp: item.labour_completed_at,
              user,
              description: `Labour completed for ${item.name}`,
              details: {
                repair_item_id: item.id,
                item_name: item.name
              }
            })
          }
        }

        // Check for parts completion not already in audit logs
        if (item.parts_completed_at) {
          const existingPartsComplete = events.find(e =>
            e.event_type === 'parts_completed' &&
            e.details.repair_item_id === item.id
          )
          if (!existingPartsComplete) {
            const user = extractUser(item.parts_completed_by_user)
            events.push({
              id: `parts_complete_${item.id}`,
              event_type: 'parts_completed',
              timestamp: item.parts_completed_at,
              user,
              description: `Parts completed for ${item.name}`,
              details: {
                repair_item_id: item.id,
                item_name: item.name
              }
            })
          }
        }

        // Check for outcome set not already in audit logs
        if (item.outcome_set_at && item.outcome_status && item.outcome_status !== 'incomplete' && item.outcome_status !== 'ready') {
          const existingOutcome = events.find(e =>
            (e.event_type === 'outcome_authorised' || e.event_type === 'outcome_deferred' || e.event_type === 'outcome_declined') &&
            e.details.repair_item_id === item.id
          )
          if (!existingOutcome) {
            const user = extractUser(item.outcome_set_by_user)
            const outcomeLabel = item.outcome_status.charAt(0).toUpperCase() + item.outcome_status.slice(1)
            events.push({
              id: `outcome_${item.id}`,
              event_type: `outcome_${item.outcome_status}`,
              timestamp: item.outcome_set_at,
              user,
              description: `${item.name} ${outcomeLabel.toLowerCase()}`,
              details: {
                repair_item_id: item.id,
                item_name: item.name,
                outcome_status: item.outcome_status
              }
            })
          }
        }
      }
    }

    // Sort all events by timestamp (most recent first)
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return c.json({ timeline: events })
  } catch (error) {
    console.error('Get timeline error:', error)
    return c.json({ error: 'Failed to get timeline' }, 500)
  }
})

// Helper to format status names
function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    awaiting_arrival: 'Awaiting Arrival',
    awaiting_checkin: 'Awaiting Check-In',
    created: 'Created',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    paused: 'Paused',
    tech_completed: 'Tech Complete',
    awaiting_review: 'Awaiting Review',
    awaiting_pricing: 'Awaiting Pricing',
    ready_to_send: 'Ready to Send',
    sent: 'Sent',
    opened: 'Opened',
    partial_response: 'Partial Response',
    authorized: 'Authorized',
    declined: 'Declined',
    expired: 'Expired',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No Show'
  }
  return labels[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default timeline
