import { Link } from 'react-router-dom'
import { TimelineEvent } from '../../../lib/api'

interface TimelineTabProps {
  timeline: TimelineEvent[]
}

// Format relative time (e.g., "2 hours ago")
function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

// Format timestamp for display
function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Get icon and color for event type
function getEventStyle(eventType: string): { icon: React.ReactNode; bgColor: string; iconColor: string } {
  switch (eventType) {
    // Jobsheet lifecycle (jobsheet timeline only)
    case 'jobsheet_created':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
        bgColor: 'bg-indigo-500',
        iconColor: 'text-white'
      }
    case 'created_from_estimate':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4a1 1 0 011-1h7.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1H8a1 1 0 01-1-1z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8v11a2 2 0 002 2h10" />
          </svg>
        ),
        bgColor: 'bg-primary',
        iconColor: 'text-white'
      }

    // Status changes
    case 'status_change':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        ),
        bgColor: 'bg-blue-500',
        iconColor: 'text-white'
      }

    // Labour events
    case 'labour_completed':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-green-500',
        iconColor: 'text-white'
      }
    case 'labour_added':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        ),
        bgColor: 'bg-blue-400',
        iconColor: 'text-white'
      }
    case 'labour_updated':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        ),
        bgColor: 'bg-amber-500',
        iconColor: 'text-white'
      }
    case 'labour_deleted':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        ),
        bgColor: 'bg-red-500',
        iconColor: 'text-white'
      }

    // Parts events
    case 'parts_completed':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-green-500',
        iconColor: 'text-white'
      }
    case 'parts_added':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        ),
        bgColor: 'bg-blue-400',
        iconColor: 'text-white'
      }
    case 'parts_updated':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        ),
        bgColor: 'bg-amber-500',
        iconColor: 'text-white'
      }
    case 'parts_deleted':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        ),
        bgColor: 'bg-red-500',
        iconColor: 'text-white'
      }

    // Outcome events
    case 'outcome_authorised':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ),
        bgColor: 'bg-green-600',
        iconColor: 'text-white'
      }
    case 'outcome_deferred':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-amber-600',
        iconColor: 'text-white'
      }
    case 'outcome_declined':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ),
        bgColor: 'bg-red-600',
        iconColor: 'text-white'
      }

    // Arrival / check-in
    case 'arrived':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1" />
          </svg>
        ),
        bgColor: 'bg-blue-500',
        iconColor: 'text-white'
      }
    case 'checked_in':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        ),
        bgColor: 'bg-indigo-500',
        iconColor: 'text-white'
      }

    // Communications
    case 'message_received':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        ),
        bgColor: 'bg-gray-500',
        iconColor: 'text-white'
      }
    case 'message_sent':
    case 'email_sent':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        ),
        bgColor: 'bg-indigo-400',
        iconColor: 'text-white'
      }

    // Estimate lifecycle (document created / sent / opened / customer response / converted)
    case 'estimate_created':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
        bgColor: 'bg-indigo-500',
        iconColor: 'text-white'
      }
    case 'estimate_sent':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        ),
        bgColor: 'bg-indigo-400',
        iconColor: 'text-white'
      }
    case 'estimate_opened':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ),
        bgColor: 'bg-blue-400',
        iconColor: 'text-white'
      }
    case 'estimate_accepted':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ),
        bgColor: 'bg-green-600',
        iconColor: 'text-white'
      }
    case 'estimate_partial':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-amber-500',
        iconColor: 'text-white'
      }
    case 'estimate_declined':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ),
        bgColor: 'bg-red-600',
        iconColor: 'text-white'
      }
    case 'estimate_responded':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        ),
        bgColor: 'bg-indigo-500',
        iconColor: 'text-white'
      }
    case 'estimate_expired':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-orange-500',
        iconColor: 'text-white'
      }
    case 'estimate_converted':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        ),
        bgColor: 'bg-teal-600',
        iconColor: 'text-white'
      }

    // Default
    default:
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-gray-500',
        iconColor: 'text-white'
      }
  }
}

// Get category label for event type
function getEventCategory(eventType: string): string {
  if (eventType.startsWith('labour_')) return 'Labour'
  if (eventType.startsWith('parts_')) return 'Parts'
  if (eventType.startsWith('outcome_')) return 'Authorisation'
  if (eventType === 'status_change') return 'Status'
  if (eventType === 'arrived' || eventType === 'checked_in') return 'Arrival'
  if (eventType === 'message_received' || eventType === 'message_sent' || eventType === 'email_sent') return 'Message'
  if (eventType === 'estimate_created') return 'Created'
  if (eventType === 'estimate_sent') return 'Sent'
  if (eventType === 'estimate_opened') return 'Opened'
  if (eventType === 'estimate_accepted') return 'Authorised'
  if (eventType === 'estimate_declined') return 'Declined'
  if (eventType === 'estimate_partial' || eventType === 'estimate_responded') return 'Response'
  if (eventType === 'estimate_expired') return 'Expired'
  if (eventType === 'estimate_converted') return 'Converted'
  if (eventType === 'jobsheet_created') return 'Jobsheet'
  if (eventType === 'created_from_estimate') return 'Estimate'
  return 'Event'
}

// Text-only category colour for the compact meta line (no pill background).
function getCategoryTextColor(eventType: string): string {
  if (eventType.startsWith('labour_')) return 'text-blue-600'
  if (eventType.startsWith('parts_')) return 'text-purple-600'
  if (eventType.startsWith('outcome_')) return 'text-green-600'
  if (eventType === 'arrived' || eventType === 'checked_in') return 'text-indigo-600'
  if (eventType === 'message_received' || eventType === 'message_sent' || eventType === 'email_sent') return 'text-indigo-600'
  if (eventType === 'estimate_accepted') return 'text-green-600'
  if (eventType === 'estimate_declined') return 'text-red-600'
  if (eventType === 'estimate_partial') return 'text-amber-600'
  if (eventType === 'estimate_converted') return 'text-teal-600'
  if (eventType === 'estimate_expired') return 'text-orange-600'
  if (eventType === 'estimate_sent' || eventType === 'estimate_opened' || eventType === 'estimate_responded') return 'text-indigo-600'
  if (eventType === 'jobsheet_created') return 'text-indigo-600'
  if (eventType === 'created_from_estimate') return 'text-primary'
  return 'text-gray-400'
}

export function TimelineTab({ timeline }: TimelineTabProps) {
  if (timeline.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center text-gray-500">
        <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm font-medium text-gray-900">No activity yet</p>
        <p className="text-xs mt-1">Events appear here as work progresses.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <ol className="px-4 py-3 sm:px-5 sm:py-4">
        {timeline.map((event, index) => {
          const { icon, bgColor, iconColor } = getEventStyle(event.event_type)
          const isLastItem = index === timeline.length - 1

          return (
            <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* Connecting line */}
              {!isLastItem && (
                <span aria-hidden="true" className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-200" />
              )}

              {/* Icon dot */}
              <span className={`relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${bgColor} ${iconColor}`}>
                {icon}
              </span>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900 leading-snug">{event.description}</p>
                  <time className="shrink-0 text-xs text-gray-400 tabular-nums" title={formatTimestamp(event.timestamp)}>
                    {formatRelativeTime(event.timestamp)}
                  </time>
                </div>
                <p className="mt-0.5 text-xs text-gray-400">
                  <span className={getCategoryTextColor(event.event_type)}>{getEventCategory(event.event_type)}</span>
                  {event.user && <> · {event.user.first_name} {event.user.last_name}</>}
                </p>
                {renderEventDetails(event)}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// Render contextual details based on event type
function renderEventDetails(event: TimelineEvent): React.ReactNode {
  const { event_type, details } = event

  // Estimate authorised → the locked-in amount the customer agreed to (immutable audit
  // figure — snapshotted at authorisation, never recomputed if the estimate is edited).
  if (event_type === 'estimate_accepted' && details.authorised_total !== undefined) {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded"
        title="Locked in at authorisation — this figure does not change if the estimate is edited later">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        £{(details.authorised_total as number).toFixed(2)} authorised
      </div>
    )
  }

  // Estimate converted → link through to the resulting job card
  if (event_type === 'estimate_converted' && details.jobsheet_id) {
    return (
      <div className="mt-1">
        <Link to={`/jobsheets/${details.jobsheet_id}`} className="inline-flex items-center text-xs font-medium text-teal-700 hover:underline">
          {details.jobsheet_reference || 'View jobsheet'} →
        </Link>
      </div>
    )
  }

  // Status change notes
  if (event_type === 'status_change' && details.notes) {
    return (
      <div className="mt-1.5 text-xs text-gray-600 bg-gray-50 px-2.5 py-1.5 border-l-2 border-gray-300">
        {details.notes}
      </div>
    )
  }

  // Labour/parts completed with total
  if ((event_type === 'labour_completed' && details.labour_total !== undefined) ||
      (event_type === 'parts_completed' && details.parts_total !== undefined)) {
    const total = event_type === 'labour_completed' ? details.labour_total : details.parts_total
    return (
      <div className="mt-1.5 inline-flex items-center px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded">
        Total: £{(total as number).toFixed(2)}
      </div>
    )
  }

  // Labour/parts updates showing old → new values
  if (event_type === 'labour_updated') {
    const changes: React.ReactNode[] = []
    if (details.old_hours !== undefined && details.new_hours !== undefined && details.old_hours !== details.new_hours) {
      changes.push(
        <span key="hours" className="inline-flex items-center text-xs text-gray-600">
          Hours: <span className="mx-1 text-gray-400 line-through">{details.old_hours}</span>
          <svg className="w-3 h-3 mx-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="text-gray-900 font-medium">{details.new_hours}</span>
        </span>
      )
    }
    if (details.old_total !== undefined && details.new_total !== undefined && details.old_total !== details.new_total) {
      changes.push(
        <span key="total" className="inline-flex items-center text-xs text-gray-600">
          Total: <span className="mx-1 text-gray-400 line-through">£{(details.old_total as number).toFixed(2)}</span>
          <svg className="w-3 h-3 mx-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="text-gray-900 font-medium">£{(details.new_total as number).toFixed(2)}</span>
        </span>
      )
    }
    if (changes.length > 0) {
      return <div className="mt-1.5 flex flex-wrap gap-3">{changes}</div>
    }
  }

  if (event_type === 'parts_updated') {
    const changes: React.ReactNode[] = []
    if (details.old_quantity !== undefined && details.new_quantity !== undefined && details.old_quantity !== details.new_quantity) {
      changes.push(
        <span key="qty" className="inline-flex items-center text-xs text-gray-600">
          Qty: <span className="mx-1 text-gray-400 line-through">{details.old_quantity}</span>
          <svg className="w-3 h-3 mx-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="text-gray-900 font-medium">{details.new_quantity}</span>
        </span>
      )
    }
    if (details.old_line_total !== undefined && details.new_line_total !== undefined && details.old_line_total !== details.new_line_total) {
      changes.push(
        <span key="total" className="inline-flex items-center text-xs text-gray-600">
          Total: <span className="mx-1 text-gray-400 line-through">£{(details.old_line_total as number).toFixed(2)}</span>
          <svg className="w-3 h-3 mx-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="text-gray-900 font-medium">£{(details.new_line_total as number).toFixed(2)}</span>
        </span>
      )
    }
    if (changes.length > 0) {
      return <div className="mt-1.5 flex flex-wrap gap-3">{changes}</div>
    }
  }

  // Labour added with hours
  if (event_type === 'labour_added' && details.hours !== undefined && details.total !== undefined) {
    return (
      <div className="mt-1 text-xs text-gray-500">
        {details.hours} hrs @ £{(details.rate as number)?.toFixed(2) || '0.00'}/hr = <span className="font-medium text-gray-700">£{(details.total as number).toFixed(2)}</span>
      </div>
    )
  }

  // Parts added with quantity and price
  if (event_type === 'parts_added' && details.line_total !== undefined) {
    return (
      <div className="mt-1 text-xs text-gray-500">
        {details.quantity && details.quantity > 1 ? `${details.quantity} × ` : ''}
        £{(details.sell_price as number)?.toFixed(2) || '0.00'} = <span className="font-medium text-gray-700">£{(details.line_total as number).toFixed(2)}</span>
      </div>
    )
  }

  // Deleted items show the total that was removed
  if ((event_type === 'labour_deleted' || event_type === 'parts_deleted') && details.total !== undefined) {
    return (
      <div className="mt-1.5 inline-flex items-center px-2 py-0.5 text-xs font-medium text-red-700 bg-red-100 rounded">
        Removed: £{(details.total as number).toFixed(2)}
      </div>
    )
  }
  if (event_type === 'parts_deleted' && details.line_total !== undefined) {
    return (
      <div className="mt-1.5 inline-flex items-center px-2 py-0.5 text-xs font-medium text-red-700 bg-red-100 rounded">
        Removed: £{(details.line_total as number).toFixed(2)}
      </div>
    )
  }

  // Item name for outcome events
  if (event_type.startsWith('outcome_') && details.item_name) {
    return (
      <div className="mt-1 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{details.item_name}</span>
      </div>
    )
  }

  // Message body for SMS events
  if ((event_type === 'message_received' || event_type === 'message_sent') && details.body) {
    return (
      <div className="mt-1.5 text-xs text-gray-600 bg-gray-50 px-2.5 py-1.5 border-l-2 border-gray-300 whitespace-pre-wrap">
        {details.body}
      </div>
    )
  }

  // Recipient for email events
  if (event_type === 'email_sent' && details.recipient) {
    return (
      <div className="mt-1 text-xs text-gray-500">to {details.recipient}</div>
    )
  }

  return null
}
