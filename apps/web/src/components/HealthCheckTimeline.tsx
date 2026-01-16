import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

interface TimelineEntry {
  id: string
  fromStatus: string | null
  toStatus: string
  changedAt: string
  changedBy: {
    first_name: string
    last_name: string
    role: string
  } | null
  durationMinutes: number
  durationFormatted: string
}

interface TimelineData {
  healthCheckId: string
  timeline: TimelineEntry[]
  totalDurationMinutes: number
}

interface Props {
  healthCheckId: string
}

const statusColors: Record<string, string> = {
  created: 'bg-gray-400',
  assigned: 'bg-blue-400',
  in_progress: 'bg-blue-500',
  paused: 'bg-yellow-400',
  tech_completed: 'bg-green-400',
  awaiting_review: 'bg-amber-400',
  awaiting_pricing: 'bg-amber-500',
  awaiting_parts: 'bg-orange-400',
  ready_to_send: 'bg-green-500',
  sent: 'bg-purple-400',
  delivered: 'bg-purple-500',
  opened: 'bg-purple-600',
  partial_response: 'bg-indigo-400',
  authorized: 'bg-rag-green',
  declined: 'bg-rag-red',
  completed: 'bg-gray-600',
  expired: 'bg-gray-500',
  cancelled: 'bg-red-400'
}

export default function HealthCheckTimeline({ healthCheckId }: Props) {
  const { session } = useAuth()
  const token = session?.accessToken
  const [data, setData] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const fetchTimeline = async () => {
      if (!token) return

      try {
        setLoading(true)
        const timelineData = await api<TimelineData>(`/api/v1/dashboard/timeline/${healthCheckId}`, { token })
        setData(timelineData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load timeline')
      } finally {
        setLoading(false)
      }
    }

    fetchTimeline()
  }, [token, healthCheckId])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDuration = (minutes: number): string => {
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        <div className="h-4 bg-gray-200 rounded w-2/3"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-sm text-red-500">
        {error}
      </div>
    )
  }

  if (!data || data.timeline.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No timeline data available
      </div>
    )
  }

  const displayTimeline = expanded ? data.timeline : data.timeline.slice(-5)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Timeline</h3>
        <div className="text-sm text-gray-500">
          Total: {formatDuration(data.totalDurationMinutes)}
        </div>
      </div>

      {/* Show More Button */}
      {data.timeline.length > 5 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-sm text-primary hover:underline"
        >
          Show all {data.timeline.length} entries
        </button>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200"></div>

        <div className="space-y-4">
          {displayTimeline.map((entry, index) => (
            <div key={entry.id} className="relative pl-8">
              {/* Dot */}
              <div
                className={`absolute left-0 top-1 w-4 h-4 rounded-full border-2 border-white shadow ${
                  statusColors[entry.toStatus] || 'bg-gray-400'
                }`}
              />

              {/* Content */}
              <div className="bg-gray-50 p-3 border border-gray-100">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-medium capitalize ${
                    entry.toStatus === 'authorized' ? 'text-rag-green' :
                    entry.toStatus === 'declined' ? 'text-rag-red' :
                    'text-gray-900'
                  }`}>
                    {entry.toStatus.replace('_', ' ')}
                  </span>
                  {entry.durationFormatted && index > 0 && (
                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5">
                      +{entry.durationFormatted}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{formatDate(entry.changedAt)}</span>
                  {entry.changedBy && (
                    <span>
                      {entry.changedBy.first_name} {entry.changedBy.last_name}
                    </span>
                  )}
                </div>

                {entry.fromStatus && (
                  <div className="text-xs text-gray-400 mt-1">
                    From: <span className="capitalize">{entry.fromStatus.replace('_', ' ')}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Collapse Button */}
      {expanded && data.timeline.length > 5 && (
        <button
          onClick={() => setExpanded(false)}
          className="text-sm text-primary hover:underline"
        >
          Show less
        </button>
      )}
    </div>
  )
}
