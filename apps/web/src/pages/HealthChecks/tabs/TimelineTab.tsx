import { StatusHistoryEntry } from '../../../lib/api'

interface TimelineTabProps {
  history: StatusHistoryEntry[]
}

const statusLabels: Record<string, string> = {
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
  cancelled: 'Cancelled'
}

export function TimelineTab({ history }: TimelineTabProps) {
  if (history.length === 0) {
    return (
      <div className="bg-white border border-gray-200 shadow-sm p-8 text-center text-gray-500">
        No history available
      </div>
    )
  }

  // Sort by created_at descending (most recent first)
  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <div className="bg-white border border-gray-200 shadow-sm">
      <div className="flow-root p-6">
        <ul className="-mb-8">
          {sortedHistory.map((entry, index) => (
            <li key={entry.id}>
              <div className="relative pb-8">
                {/* Connecting line */}
                {index !== sortedHistory.length - 1 && (
                  <span
                    className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200"
                    aria-hidden="true"
                  />
                )}

                <div className="relative flex space-x-3">
                  {/* Icon */}
                  <div>
                    <span className="h-8 w-8 rounded-full bg-primary flex items-center justify-center ring-8 ring-white">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">
                        {entry.from_status ? (
                          <>
                            <span className="text-gray-500">
                              {statusLabels[entry.from_status] || entry.from_status}
                            </span>
                            <span className="mx-2 text-gray-400">→</span>
                            <span className="font-semibold">
                              {statusLabels[entry.to_status] || entry.to_status}
                            </span>
                          </>
                        ) : (
                          <span className="font-semibold">
                            {statusLabels[entry.to_status] || entry.to_status}
                          </span>
                        )}
                      </p>
                      <time className="text-sm text-gray-500">
                        {new Date(entry.created_at).toLocaleString()}
                      </time>
                    </div>

                    {entry.user && (
                      <p className="text-sm text-gray-500 mt-1">
                        by {entry.user.first_name} {entry.user.last_name}
                      </p>
                    )}

                    {entry.notes && (
                      <p className="text-sm text-gray-600 mt-2 bg-gray-50 p-2">
                        {entry.notes}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
