/**
 * Workflow Badges Component
 * Displays status indicators for Labour, Parts, Quote, and Sent workflow stages
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
  quote: BadgeStatus
  sent: BadgeStatus
}

export interface CompletionInfo {
  startedAt?: string | null
  startedBy?: string | null
  completedAt?: string | null
  completedBy?: string | null
}

interface WorkflowBadgeProps {
  label: string
  status: BadgeStatus
  title: string
  compact?: boolean
  completionInfo?: CompletionInfo
}

interface WorkflowBadgesProps {
  status: WorkflowStatus
  compact?: boolean
  technicianCompletion?: CompletionInfo
  labourCompletion?: CompletionInfo
  partsCompletion?: CompletionInfo
  quoteCompletion?: CompletionInfo
  sentCompletion?: CompletionInfo
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
export function WorkflowBadge({ label, status, title, compact, completionInfo }: WorkflowBadgeProps) {
  // Show completion info for in_progress and complete states
  const completionText = (status === 'complete' || status === 'in_progress')
    ? formatCompletionInfo(completionInfo, status)
    : ''
  const tooltipText = `${title}: ${statusText[status]}${completionText}`

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

// Grouped Workflow Badges T L P Q S
export function WorkflowBadges({
  status,
  compact,
  technicianCompletion,
  labourCompletion,
  partsCompletion,
  quoteCompletion,
  sentCompletion
}: WorkflowBadgesProps) {
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
        label="Q"
        status={status.quote}
        title="Quote"
        compact={compact}
        completionInfo={quoteCompletion}
      />
      <WorkflowBadge
        label="S"
        status={status.sent}
        title="Sent"
        compact={compact}
        completionInfo={sentCompletion}
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
        <span>Q = Quoted</span>
        <span>S = Sent</span>
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
  quoteStatus?: string
  quote_status?: string
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
      quote: 'na',
      sent: sentAt ? 'complete' : 'na'
    }
  }

  // Helper to get status from either camelCase or snake_case
  const getLabourStatus = (item: RepairItemForWorkflow) =>
    item.labourStatus || item.labour_status || 'pending'
  const getPartsStatus = (item: RepairItemForWorkflow) =>
    item.partsStatus || item.parts_status || 'pending'
  const getQuoteStatus = (item: RepairItemForWorkflow) =>
    item.quoteStatus || item.quote_status || 'pending'

  const labourComplete = repairItems.every(i => getLabourStatus(i) === 'complete')
  const labourStarted = repairItems.some(i =>
    getLabourStatus(i) === 'in_progress' || getLabourStatus(i) === 'complete'
  )

  const partsComplete = repairItems.every(i => getPartsStatus(i) === 'complete')
  const partsStarted = repairItems.some(i =>
    getPartsStatus(i) === 'in_progress' || getPartsStatus(i) === 'complete'
  )

  const quoteReady = repairItems.every(i => getQuoteStatus(i) === 'ready')
  const isSent = !!sentAt

  // Quote is only complete when Labour AND Parts are both complete
  const quoteComplete = quoteReady && labourComplete && partsComplete

  return {
    technician: technicianStatus,
    labour: labourComplete ? 'complete' : labourStarted ? 'in_progress' : 'pending',
    parts: partsComplete ? 'complete' : partsStarted ? 'in_progress' : 'pending',
    quote: quoteComplete ? 'complete' : 'pending',
    sent: isSent ? 'complete' : 'na'
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
