/**
 * Workflow Badges Component
 * Displays status indicators for Tech, Labour, Parts, Sent, and Authorised workflow stages
 *
 * Status colours (background-based):
 * - pending (red): Not started
 * - in_progress (amber): In progress
 * - complete (green): Done
 * - na (grey): Not applicable
 */

import { useMemo } from 'react'
import { Tooltip } from './ui/Tooltip'

// Status types
export type BadgeStatus = 'pending' | 'in_progress' | 'complete' | 'na'

export interface WorkflowStatus {
  technician: BadgeStatus
  labour: BadgeStatus
  parts: BadgeStatus
  sent: BadgeStatus
  authorised: BadgeStatus
}

export interface CompletionInfo {
  startedAt?: string | null
  startedBy?: string | null
  completedAt?: string | null
  completedBy?: string | null
}

// Authorisation info for A badge tooltip
export interface AuthorisationEntry {
  source: 'manual' | 'online'
  userName?: string | null
  timestamp: string
}

export interface AuthorisationInfo {
  status: BadgeStatus
  authorisedBy: AuthorisationEntry[]
  totalItems: number
  authorisedCount: number
}

interface WorkflowBadgeProps {
  label: string
  status: BadgeStatus
  title: string
  compact?: boolean
  completionInfo?: CompletionInfo
  customTooltip?: string
}

interface WorkflowBadgesProps {
  status: WorkflowStatus
  compact?: boolean
  technicianCompletion?: CompletionInfo
  labourCompletion?: CompletionInfo
  partsCompletion?: CompletionInfo
  sentCompletion?: CompletionInfo
  authorisationInfo?: AuthorisationInfo
}

interface WorkflowLegendProps {
  className?: string
}

// Badge colours - background indicates status
const badgeColors: Record<BadgeStatus, string> = {
  pending: 'bg-red-100 text-red-600',
  in_progress: 'bg-amber-100 text-amber-600',
  complete: 'bg-green-100 text-green-600',
  na: 'bg-gray-100 text-gray-400'
}

const statusText: Record<BadgeStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  na: 'Not applicable'
}

// Format a single timestamp
function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short'
  }) + ', ' + date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Format timestamp for tooltip - shows start and/or finish times
function formatCompletionInfo(completionInfo?: CompletionInfo, status?: BadgeStatus): string {
  if (!completionInfo) return ''

  const parts: string[] = []

  // Show start time if available
  if (completionInfo.startedAt) {
    const startFormatted = formatTimestamp(completionInfo.startedAt)
    if (completionInfo.startedBy) {
      parts.push(`Started ${startFormatted} by ${completionInfo.startedBy}`)
    } else {
      parts.push(`Started ${startFormatted}`)
    }
  }

  // Show finish time if completed
  if (completionInfo.completedAt && status === 'complete') {
    const finishFormatted = formatTimestamp(completionInfo.completedAt)
    if (completionInfo.completedBy) {
      parts.push(`Finished ${finishFormatted} by ${completionInfo.completedBy}`)
    } else {
      parts.push(`Finished ${finishFormatted}`)
    }
  }

  if (parts.length === 0) return ''
  return ' - ' + parts.join('. ')
}

// Individual Workflow Badge
export function WorkflowBadge({ label, status, title, compact, completionInfo, customTooltip }: WorkflowBadgeProps) {
  // Use custom tooltip if provided, otherwise build from completion info
  let tooltipText: string
  if (customTooltip) {
    tooltipText = customTooltip
  } else {
    // Show completion info for in_progress and complete states
    const completionText = (status === 'complete' || status === 'in_progress')
      ? formatCompletionInfo(completionInfo, status)
      : ''
    tooltipText = `${title}: ${statusText[status]}${completionText}`
  }

  const sizeClass = compact ? 'w-5 h-5 text-[10px]' : 'w-7 h-7 text-xs'

  return (
    <Tooltip content={tooltipText}>
      <span
        className={`${sizeClass} rounded font-semibold flex items-center justify-center cursor-default ${badgeColors[status]}`}
      >
        {label}
      </span>
    </Tooltip>
  )
}

// Helper to format authorisation tooltip
function formatAuthorisationTooltip(info?: AuthorisationInfo, fallbackStatus?: BadgeStatus): string {
  if (!info) {
    // Fallback based on status when authorisationInfo not provided
    if (fallbackStatus === 'na') return 'Authorised: Not applicable'
    if (fallbackStatus === 'complete') return 'Authorised: Complete'
    if (fallbackStatus === 'in_progress') return 'Authorised: In progress'
    if (fallbackStatus === 'pending') return 'Authorised: Not started'
    return 'Authorised: Not available'
  }

  const { status, authorisedBy, totalItems, authorisedCount } = info

  // N/A case
  if (status === 'na') return 'Authorised: Not applicable'

  // Pending case
  if (status === 'pending' || authorisedCount === 0) {
    return `Authorised: Not started (0/${totalItems})`
  }

  // Format the entries
  const entryTexts = authorisedBy.map(entry => {
    const date = new Date(entry.timestamp)
    const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
      ', ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

    if (entry.source === 'online') {
      return `Customer online on ${dateStr}`
    } else {
      return `${entry.userName || 'Unknown'} on ${dateStr}`
    }
  })

  // Build final tooltip
  const prefix = `Authorised (${authorisedCount}/${totalItems}): `
  // If no entries have timestamps, show just the count
  if (entryTexts.length === 0) {
    return prefix + 'Details not available'
  }
  return prefix + entryTexts.join('; ')
}

// Grouped Workflow Badges T L P S A
export function WorkflowBadges({
  status,
  compact,
  technicianCompletion,
  labourCompletion,
  partsCompletion,
  sentCompletion,
  authorisationInfo
}: WorkflowBadgesProps) {
  const authorisationTooltip = formatAuthorisationTooltip(authorisationInfo, status.authorised)

  return (
    <div className="inline-flex items-center gap-1">
      <WorkflowBadge
        label="T"
        status={status.technician}
        title="Tech Inspection"
        compact={compact}
        completionInfo={technicianCompletion}
      />
      <WorkflowBadge
        label="L"
        status={status.labour}
        title="Labour"
        compact={compact}
        completionInfo={labourCompletion}
      />
      <WorkflowBadge
        label="P"
        status={status.parts}
        title="Parts"
        compact={compact}
        completionInfo={partsCompletion}
      />
      <WorkflowBadge
        label="S"
        status={status.sent}
        title="Sent"
        compact={compact}
        completionInfo={sentCompletion}
      />
      <WorkflowBadge
        label="A"
        status={status.authorised}
        title="Authorised"
        compact={compact}
        customTooltip={authorisationTooltip}
      />
    </div>
  )
}

// Item-level badges L P for individual repair items
export function RepairItemBadges({
  labourStatus,
  partsStatus,
  labourCompletion,
  partsCompletion
}: {
  labourStatus: BadgeStatus
  partsStatus: BadgeStatus
  labourCompletion?: CompletionInfo
  partsCompletion?: CompletionInfo
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <WorkflowBadge
        label="L"
        status={labourStatus}
        title="Labour"
        completionInfo={labourCompletion}
      />
      <WorkflowBadge
        label="P"
        status={partsStatus}
        title="Parts"
        completionInfo={partsCompletion}
      />
    </div>
  )
}

// Workflow Legend
export function WorkflowLegend({ className = '' }: WorkflowLegendProps) {
  return (
    <div className={`flex flex-wrap items-center gap-4 text-xs text-gray-500 ${className}`}>
      <span className="font-medium text-gray-600">Legend:</span>
      <div className="flex items-center gap-2">
        <span>T = Tech Inspection</span>
        <span>L = Labour</span>
        <span>P = Parts</span>
        <span>S = Sent</span>
        <span>A = Authorised</span>
      </div>
      <div className="flex items-center gap-2 border-l border-gray-300 pl-4">
        <span className="inline-flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-red-100"></span>
          Not done
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-amber-100"></span>
          In progress
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-green-100"></span>
          Complete
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-gray-100"></span>
          N/A
        </span>
      </div>
    </div>
  )
}

// Helper function to calculate workflow status from repair items
export interface RepairItemForWorkflow {
  labourStatus?: string
  labour_status?: string
  partsStatus?: string
  parts_status?: string
  // Outcome fields for authorisation calculation
  outcomeStatus?: string | null
  outcome_status?: string | null
  outcomeSetBy?: string | null
  outcome_set_by?: string | null
  outcomeSetAt?: string | null
  outcome_set_at?: string | null
  outcomeSource?: string | null
  outcome_source?: string | null
  outcomeSetByUser?: { first_name: string; last_name: string } | null
  outcome_set_by_user?: { first_name: string; last_name: string } | null
  // Customer approval flag (legacy field also used for authorisation)
  customerApproved?: boolean | null
  customer_approved?: boolean | null
  // Customer approval timestamp (for tooltip)
  customerApprovedAt?: string | null
  customer_approved_at?: string | null
}

export interface TechTimestamps {
  techStartedAt?: string | null
  techCompletedAt?: string | null
  // Alternative snake_case names
  tech_started_at?: string | null
  tech_completed_at?: string | null
}

export function calculateWorkflowStatus(
  repairItems: RepairItemForWorkflow[],
  sentAt: string | null | undefined,
  techTimestamps?: TechTimestamps
): WorkflowStatus {
  // Calculate technician status from timestamps
  const techStartedAt = techTimestamps?.techStartedAt || techTimestamps?.tech_started_at
  const techCompletedAt = techTimestamps?.techCompletedAt || techTimestamps?.tech_completed_at

  let technicianStatus: BadgeStatus = 'pending'
  if (techCompletedAt) {
    technicianStatus = 'complete'
  } else if (techStartedAt) {
    technicianStatus = 'in_progress'
  }

  if (repairItems.length === 0) {
    return {
      technician: technicianStatus,
      labour: 'na',
      parts: 'na',
      sent: sentAt ? 'complete' : 'na',
      authorised: 'na'
    }
  }

  // Helper to get status from either camelCase or snake_case
  const getLabourStatus = (item: RepairItemForWorkflow) =>
    item.labourStatus || item.labour_status || 'pending'
  const getPartsStatus = (item: RepairItemForWorkflow) =>
    item.partsStatus || item.parts_status || 'pending'
  const getOutcomeStatus = (item: RepairItemForWorkflow) =>
    item.outcomeStatus || item.outcome_status || null
  const getCustomerApproved = (item: RepairItemForWorkflow) =>
    item.customerApproved ?? item.customer_approved ?? null

  // Check if item is authorised (outcome_status = 'authorised' OR customer_approved = true)
  const isItemAuthorised = (item: RepairItemForWorkflow) => {
    const outcome = getOutcomeStatus(item)
    const customerApproved = getCustomerApproved(item)
    return outcome === 'authorised' || customerApproved === true
  }

  const labourComplete = repairItems.every(i => getLabourStatus(i) === 'complete')
  const labourStarted = repairItems.some(i =>
    getLabourStatus(i) === 'in_progress' || getLabourStatus(i) === 'complete'
  )

  const partsComplete = repairItems.every(i => getPartsStatus(i) === 'complete')
  const partsStarted = repairItems.some(i =>
    getPartsStatus(i) === 'in_progress' || getPartsStatus(i) === 'complete'
  )

  const isSent = !!sentAt

  // Calculate authorised status based on outcome_status OR customer_approved
  // Filter to only actionable items (not deleted)
  const actionableItems = repairItems.filter(i => {
    const outcome = getOutcomeStatus(i)
    return outcome !== 'deleted'
  })

  let authorisedStatus: BadgeStatus = 'na'
  if (actionableItems.length > 0) {
    const authorisedCount = actionableItems.filter(i => isItemAuthorised(i)).length
    if (authorisedCount === actionableItems.length) {
      authorisedStatus = 'complete'
    } else if (authorisedCount > 0) {
      authorisedStatus = 'in_progress'
    } else {
      authorisedStatus = 'pending'
    }
  }

  return {
    technician: technicianStatus,
    labour: labourComplete ? 'complete' : labourStarted ? 'in_progress' : 'pending',
    parts: partsComplete ? 'complete' : partsStarted ? 'in_progress' : 'pending',
    sent: isSent ? 'complete' : 'na',
    authorised: authorisedStatus
  }
}

// Calculate authorisation info from repair items for tooltip
export function calculateAuthorisationInfo(repairItems: RepairItemForWorkflow[]): AuthorisationInfo {
  // Helper to check if item is authorised (outcome_status = 'authorised' OR customer_approved = true)
  const isItemAuthorised = (item: RepairItemForWorkflow) => {
    const outcome = item.outcomeStatus || item.outcome_status || null
    const customerApproved = item.customerApproved ?? item.customer_approved ?? null
    return outcome === 'authorised' || customerApproved === true
  }

  // Filter to only actionable items (not deleted)
  const actionableItems = repairItems.filter(item => {
    const outcome = item.outcomeStatus || item.outcome_status || null
    return outcome !== 'deleted'
  })

  if (actionableItems.length === 0) {
    return {
      status: 'na',
      authorisedBy: [],
      totalItems: 0,
      authorisedCount: 0
    }
  }

  // Find authorised items (outcome_status = 'authorised' OR customer_approved = true)
  const authorisedItems = actionableItems.filter(item => isItemAuthorised(item))

  const authorisedCount = authorisedItems.length
  const totalItems = actionableItems.length

  // Determine status
  let status: BadgeStatus = 'pending'
  if (authorisedCount === totalItems) {
    status = 'complete'
  } else if (authorisedCount > 0) {
    status = 'in_progress'
  }

  // Build authorisation entries
  const authorisedBy: AuthorisationEntry[] = authorisedItems
    .filter(item => {
      // Use outcome_set_at if available, otherwise customer_approved_at
      const timestamp = item.outcomeSetAt || item.outcome_set_at ||
                       item.customerApprovedAt || item.customer_approved_at
      return !!timestamp
    })
    .map(item => {
      const outcomeSource = item.outcomeSource || item.outcome_source
      // If we have outcome_source, use it; otherwise default to 'online' for customer_approved
      const source = outcomeSource ? (outcomeSource as 'manual' | 'online') : 'online'
      const user = item.outcomeSetByUser || item.outcome_set_by_user
      const userName = user ? `${user.first_name} ${user.last_name}` : null
      // Use outcome_set_at if available, otherwise customer_approved_at
      const timestamp = item.outcomeSetAt || item.outcome_set_at ||
                       item.customerApprovedAt || item.customer_approved_at || ''

      return {
        source,
        userName,
        timestamp
      }
    })
    // Sort by timestamp descending (most recent first)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return {
    status,
    authorisedBy,
    totalItems,
    authorisedCount
  }
}

// Hook to calculate workflow status from repair items
export function useWorkflowStatus(
  repairItems: RepairItemForWorkflow[],
  sentAt: string | null | undefined,
  techTimestamps?: TechTimestamps
): WorkflowStatus {
  return useMemo(
    () => calculateWorkflowStatus(repairItems, sentAt, techTimestamps),
    [repairItems, sentAt, techTimestamps]
  )
}
