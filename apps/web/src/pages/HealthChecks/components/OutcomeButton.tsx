/**
 * OutcomeButton Component
 * Circular indicator button for repair item outcome tracking
 *
 * Visual States:
 * - incomplete: bg-gray-300, × icon, clickable → limited dropdown (delete only)
 * - ready: bg-purple-500, ! icon, clickable → full action dropdown
 * - authorised: bg-blue-500, ✓ icon → reset dropdown
 * - deferred: bg-blue-500, calendar icon → reset dropdown
 * - declined: bg-blue-500, ✗ icon → reset dropdown
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '../../../components/ui/Tooltip'

export type OutcomeStatus = 'incomplete' | 'ready' | 'authorised' | 'deferred' | 'declined' | 'deleted'

interface OutcomeButtonProps {
  status: OutcomeStatus
  // Outcome metadata for tooltip
  outcomeSetBy?: string | null
  outcomeSetAt?: string | null
  outcomeSource?: 'manual' | 'online' | null
  // Deferred-specific
  deferredUntil?: string | null
  // Declined-specific
  declinedReason?: string | null
  // Callbacks
  onAuthorise: () => void
  onDefer: () => void
  onDecline: () => void
  onDelete: () => void
  onReset: () => void
  // Optional loading state
  loading?: boolean
}

export function OutcomeButton({
  status,
  outcomeSetBy,
  outcomeSetAt,
  outcomeSource,
  deferredUntil,
  declinedReason,
  onAuthorise,
  onDefer,
  onDecline,
  onDelete,
  onReset,
  loading = false
}: OutcomeButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      // Check if click is outside both dropdown and button (since dropdown is in portal)
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setShowDropdown(false)
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (loading) return

    // Calculate position for portal-rendered dropdown
    if (buttonRef.current && !showDropdown) {
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 4, // 4px gap below button
        left: rect.right - 180 // Align right edge (180px = dropdown min-width)
      })
    }

    setShowDropdown(!showDropdown)
  }

  const handleAction = (action: () => void) => {
    setShowDropdown(false)
    action()
  }

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Get button styling based on status
  const getButtonClasses = () => {
    const base = 'w-8 h-8 rounded-full flex items-center justify-center transition-all'

    if (loading) {
      return `${base} bg-gray-200 cursor-wait`
    }

    switch (status) {
      case 'incomplete':
        return `${base} bg-gray-300 text-gray-500 cursor-pointer hover:bg-gray-400 hover:shadow-md`
      case 'ready':
        return `${base} bg-purple-500 text-white cursor-pointer hover:bg-purple-600 hover:shadow-md`
      case 'authorised':
      case 'deferred':
      case 'declined':
        return `${base} bg-blue-500 text-white cursor-pointer hover:bg-blue-600 hover:shadow-md`
      default:
        return `${base} bg-gray-300 text-gray-500 cursor-pointer hover:bg-gray-400`
    }
  }

  // Get icon based on status
  const getIcon = () => {
    if (loading) {
      return (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )
    }

    switch (status) {
      case 'incomplete':
        // × icon
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )
      case 'ready':
        // ! icon
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )
      case 'authorised':
        // ✓ icon
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )
      case 'deferred':
        // Calendar icon
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )
      case 'declined':
        // ✗ icon
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )
      default:
        return null
    }
  }

  // Get tooltip content
  const getTooltipContent = () => {
    if (status === 'incomplete') {
      return 'Labour & parts not complete'
    }
    if (status === 'ready') {
      return 'Ready for customer decision'
    }

    const lines: string[] = []

    // Status label
    const statusLabels: Record<string, string> = {
      authorised: 'Authorised',
      deferred: 'Deferred',
      declined: 'Declined'
    }
    lines.push(statusLabels[status] || status)

    // Source
    if (outcomeSource === 'online') {
      lines.push('by customer online')
    } else if (outcomeSetBy) {
      lines.push(`by ${outcomeSetBy}`)
    }

    // When
    if (outcomeSetAt) {
      lines.push(formatDate(outcomeSetAt))
    }

    // Deferred until
    if (status === 'deferred' && deferredUntil) {
      const deferDate = new Date(deferredUntil)
      lines.push(`Until: ${deferDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`)
    }

    // Declined reason
    if (status === 'declined' && declinedReason) {
      lines.push(`Reason: ${declinedReason}`)
    }

    return lines.join('\n')
  }

  // Check if button is actionable (all states except deleted can be clicked)
  const isActionable = status !== 'deleted' && !loading

  return (
    <div className="relative">
      {/* Button with floating tooltip */}
      <Tooltip content={getTooltipContent()} disabled={showDropdown}>
        <button
          ref={buttonRef}
          onClick={handleButtonClick}
          disabled={!isActionable}
          className={getButtonClasses()}
        >
          {getIcon()}
        </button>
      </Tooltip>

      {/* Dropdown Menu - Rendered via portal to escape overflow-hidden containers */}
      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
        >
          {status === 'incomplete' ? (
            // Incomplete state: Limited actions with info message
            <>
              <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
                Complete Labour & Parts for full options
              </div>
              <button
                onClick={() => handleAction(onDelete)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-red-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Delete...</span>
              </button>
            </>
          ) : status === 'ready' ? (
            // Ready state: Show action options
            <>
              <button
                onClick={() => handleAction(onAuthorise)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Authorise</span>
              </button>
              <button
                onClick={() => handleAction(onDefer)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Defer...</span>
              </button>
              <button
                onClick={() => handleAction(onDecline)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Decline...</span>
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => handleAction(onDelete)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-red-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Delete...</span>
              </button>
            </>
          ) : (
            // Actioned state: Show reset option
            <button
              onClick={() => handleAction(onReset)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Reset</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

/**
 * Helper function to calculate outcome status from repair item data
 */
export function calculateOutcomeStatus(item: {
  deletedAt?: string | null
  deleted_at?: string | null
  outcomeStatus?: OutcomeStatus | null
  outcome_status?: OutcomeStatus | null
  // Legacy approval field (from customer_approved in DB)
  isApproved?: boolean | null
  is_approved?: boolean | null
  labourStatus?: 'pending' | 'in_progress' | 'complete'
  labour_status?: 'pending' | 'in_progress' | 'complete'
  partsStatus?: 'pending' | 'in_progress' | 'complete'
  parts_status?: 'pending' | 'in_progress' | 'complete'
  noLabourRequired?: boolean
  no_labour_required?: boolean
  noPartsRequired?: boolean
  no_parts_required?: boolean
}): OutcomeStatus {
  // If soft deleted
  if (item.deletedAt || item.deleted_at) return 'deleted'

  // Get outcome status (handle both naming conventions)
  const outcomeStatus = item.outcomeStatus || item.outcome_status

  // If has an explicit outcome
  if (outcomeStatus === 'authorised') return 'authorised'
  if (outcomeStatus === 'deferred') return 'deferred'
  if (outcomeStatus === 'declined') return 'declined'
  if (outcomeStatus === 'deleted') return 'deleted'

  // Legacy support: if customer_approved is true, treat as authorised
  // This handles items approved before the outcome tracking feature
  const isApproved = item.isApproved ?? item.is_approved
  if (isApproved === true) return 'authorised'

  // Legacy support: if customer_approved is explicitly false, treat as declined
  if (isApproved === false) return 'declined'

  // Check if ready (labour AND parts complete)
  const labourStatus = item.labourStatus || item.labour_status || 'pending'
  const partsStatus = item.partsStatus || item.parts_status || 'pending'
  const noLabourRequired = item.noLabourRequired || item.no_labour_required
  const noPartsRequired = item.noPartsRequired || item.no_parts_required

  const labourComplete = labourStatus === 'complete' || noLabourRequired
  const partsComplete = partsStatus === 'complete' || noPartsRequired

  if (labourComplete && partsComplete) return 'ready'

  return 'incomplete'
}
