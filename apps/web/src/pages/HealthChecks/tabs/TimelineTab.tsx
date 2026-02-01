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
  return 'Event'
}

// Get category color
function getCategoryColor(eventType: string): string {
  if (eventType.startsWith('labour_')) return 'text-blue-600 bg-blue-50'
  if (eventType.startsWith('parts_')) return 'text-purple-600 bg-purple-50'
  if (eventType.startsWith('outcome_')) return 'text-green-600 bg-green-50'
  if (eventType === 'status_change') return 'text-gray-600 bg-gray-100'
  return 'text-gray-600 bg-gray-100'
}

export function TimelineTab({ timeline }: TimelineTabProps) {
  if (timeline.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-lg font-medium">No timeline events yet</p>
        <p className="text-sm mt-1">Events will appear here as work progresses on this health check</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flow-root p-6">
        <ul className="-mb-8">
          {timeline.map((event, index) => {
            const { icon, bgColor, iconColor } = getEventStyle(event.event_type)
            const category = getEventCategory(event.event_type)
            const categoryColor = getCategoryColor(event.event_type)
            const isLastItem = index === timeline.length - 1

            return (
              <li key={event.id}>
                <div className="relative pb-8">
                  {/* Connecting line */}
                  {!isLastItem && (
                    <span
                      className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200"
                      aria-hidden="true"
                    />
                  )}

                  <div className="relative flex space-x-4">
                    {/* Icon */}
                    <div>
                      <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${bgColor}`}>
                        <span className={iconColor}>{icon}</span>
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      {/* Header row: Category badge + Timestamp */}
                      <div className="flex items-center justify-between mb-1">
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${categoryColor}`}>
                          {category}
                        </span>
                        <div className="text-right">
                          <time className="text-sm text-gray-900 font-medium">
                            {formatTimestamp(event.timestamp)}
                          </time>
                          <div className="text-xs text-gray-500">
                            {formatRelativeTime(event.timestamp)}
                          </div>
                        </div>
                      </div>

                      {/* Event description */}
                      <p className="text-sm font-medium text-gray-900 mt-1">
                        {event.description}
                      </p>

                      {/* User attribution */}
                      {event.user && (
                        <p className="text-sm text-gray-500 mt-1">
                          by {event.user.first_name} {event.user.last_name}
                        </p>
                      )}

                      {/* Event details (contextual) */}
                      {renderEventDetails(event)}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// Render contextual details based on event type
function renderEventDetails(event: TimelineEvent): React.ReactNode {
  const { event_type, details } = event

  // Status change notes
  if (event_type === 'status_change' && details.notes) {
    return (
      <div className="mt-2 text-sm text-gray-600 bg-gray-50 p-2 border-l-2 border-gray-300">
        {details.notes}
      </div>
    )
  }

  // Labour/parts completed with total
  if ((event_type === 'labour_completed' && details.labour_total !== undefined) ||
      (event_type === 'parts_completed' && details.parts_total !== undefined)) {
    const total = event_type === 'labour_completed' ? details.labour_total : details.parts_total
    return (
      <div className="mt-2 inline-flex items-center px-2.5 py-1 text-sm font-semibold text-green-700 bg-green-100 rounded">
        Total: £{(total as number).toFixed(2)}
      </div>
    )
  }

  // Labour/parts updates showing old → new values
  if (event_type === 'labour_updated') {
    const changes: React.ReactNode[] = []
    if (details.old_hours !== undefined && details.new_hours !== undefined && details.old_hours !== details.new_hours) {
      changes.push(
        <span key="hours" className="inline-flex items-center text-sm text-gray-600">
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
        <span key="total" className="inline-flex items-center text-sm text-gray-600">
          Total: <span className="mx-1 text-gray-400 line-through">£{(details.old_total as number).toFixed(2)}</span>
          <svg className="w-3 h-3 mx-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="text-gray-900 font-medium">£{(details.new_total as number).toFixed(2)}</span>
        </span>
      )
    }
    if (changes.length > 0) {
      return <div className="mt-2 flex flex-wrap gap-4">{changes}</div>
    }
  }

  if (event_type === 'parts_updated') {
    const changes: React.ReactNode[] = []
    if (details.old_quantity !== undefined && details.new_quantity !== undefined && details.old_quantity !== details.new_quantity) {
      changes.push(
        <span key="qty" className="inline-flex items-center text-sm text-gray-600">
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
        <span key="total" className="inline-flex items-center text-sm text-gray-600">
          Total: <span className="mx-1 text-gray-400 line-through">£{(details.old_line_total as number).toFixed(2)}</span>
          <svg className="w-3 h-3 mx-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="text-gray-900 font-medium">£{(details.new_line_total as number).toFixed(2)}</span>
        </span>
      )
    }
    if (changes.length > 0) {
      return <div className="mt-2 flex flex-wrap gap-4">{changes}</div>
    }
  }

  // Labour added with hours
  if (event_type === 'labour_added' && details.hours !== undefined && details.total !== undefined) {
    return (
      <div className="mt-2 text-sm text-gray-600">
        {details.hours} hrs @ £{(details.rate as number)?.toFixed(2) || '0.00'}/hr = <span className="font-medium text-gray-900">£{(details.total as number).toFixed(2)}</span>
      </div>
    )
  }

  // Parts added with quantity and price
  if (event_type === 'parts_added' && details.line_total !== undefined) {
    return (
      <div className="mt-2 text-sm text-gray-600">
        {details.quantity && details.quantity > 1 ? `${details.quantity} × ` : ''}
        £{(details.sell_price as number)?.toFixed(2) || '0.00'} = <span className="font-medium text-gray-900">£{(details.line_total as number).toFixed(2)}</span>
      </div>
    )
  }

  // Deleted items show the total that was removed
  if ((event_type === 'labour_deleted' || event_type === 'parts_deleted') && details.total !== undefined) {
    return (
      <div className="mt-2 inline-flex items-center px-2.5 py-1 text-sm font-medium text-red-700 bg-red-100 rounded">
        Removed: £{(details.total as number).toFixed(2)}
      </div>
    )
  }
  if (event_type === 'parts_deleted' && details.line_total !== undefined) {
    return (
      <div className="mt-2 inline-flex items-center px-2.5 py-1 text-sm font-medium text-red-700 bg-red-100 rounded">
        Removed: £{(details.line_total as number).toFixed(2)}
      </div>
    )
  }

  // Item name for outcome events
  if (event_type.startsWith('outcome_') && details.item_name) {
    return (
      <div className="mt-2 text-sm text-gray-600">
        <span className="font-medium">{details.item_name}</span>
      </div>
    )
  }

  return null
}
