import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, CustomerActivityResponse } from '../../../lib/api'

interface CustomerActivityTabProps {
  healthCheckId: string
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
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Get icon and styling for activity type
function getActivityStyle(type: string): { icon: React.ReactNode; bgColor: string; label: string } {
  switch (type) {
    case 'viewed':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ),
        bgColor: 'bg-blue-500',
        label: 'Viewed Report'
      }
    case 'approved':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ),
        bgColor: 'bg-green-500',
        label: 'Approved Item'
      }
    case 'declined':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ),
        bgColor: 'bg-red-500',
        label: 'Declined Item'
      }
    case 'deferred':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-amber-500',
        label: 'Deferred Item'
      }
    case 'signed':
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        ),
        bgColor: 'bg-purple-500',
        label: 'Signed Authorization'
      }
    default:
      return {
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        bgColor: 'bg-gray-500',
        label: type.charAt(0).toUpperCase() + type.slice(1)
      }
  }
}

// Get status badge styling
function getCommStatusStyle(status: string): { color: string; label: string } {
  switch (status) {
    case 'sent':
      return { color: 'bg-blue-100 text-blue-700', label: 'Sent' }
    case 'delivered':
      return { color: 'bg-green-100 text-green-700', label: 'Delivered' }
    case 'failed':
      return { color: 'bg-red-100 text-red-700', label: 'Failed' }
    case 'bounced':
      return { color: 'bg-red-100 text-red-700', label: 'Bounced' }
    case 'pending':
      return { color: 'bg-gray-100 text-gray-700', label: 'Pending' }
    default:
      return { color: 'bg-gray-100 text-gray-700', label: status }
  }
}

// Get device icon
function getDeviceIcon(deviceType: string): React.ReactNode {
  switch (deviceType) {
    case 'mobile':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      )
    case 'tablet':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      )
    case 'desktop':
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    default:
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
  }
}

export function CustomerActivityTab({ healthCheckId }: CustomerActivityTabProps) {
  const { session } = useAuth()
  const [data, setData] = useState<CustomerActivityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      if (!session?.accessToken) return

      setLoading(true)
      setError(null)

      try {
        const response = await api<CustomerActivityResponse>(
          `/api/v1/health-checks/${healthCheckId}/customer-activity`,
          { token: session.accessToken }
        )
        setData(response)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load customer activity')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [healthCheckId, session?.accessToken])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 p-4 text-red-700">
        {error}
      </div>
    )
  }

  if (!data) {
    return null
  }

  const { summary, communications, activities, statusChanges } = data

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Views Card */}
        <div className="bg-white border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{summary.totalViews}</div>
              <div className="text-sm text-gray-500">Total Views</div>
            </div>
          </div>
          {summary.firstViewedAt && (
            <div className="mt-3 text-xs text-gray-500">
              First viewed: {formatTimestamp(summary.firstViewedAt)}
            </div>
          )}
          {summary.lastViewedAt && summary.totalViews > 1 && (
            <div className="text-xs text-gray-500">
              Last viewed: {formatTimestamp(summary.lastViewedAt)}
            </div>
          )}
        </div>

        {/* Response Status Card */}
        <div className="bg-white border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded ${
              summary.responseStatus === 'complete' ? 'bg-green-100' :
              summary.responseStatus === 'partial' ? 'bg-amber-100' : 'bg-gray-100'
            }`}>
              <svg className={`w-5 h-5 ${
                summary.responseStatus === 'complete' ? 'text-green-600' :
                summary.responseStatus === 'partial' ? 'text-amber-600' : 'text-gray-600'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className={`text-lg font-semibold ${
                summary.responseStatus === 'complete' ? 'text-green-600' :
                summary.responseStatus === 'partial' ? 'text-amber-600' : 'text-gray-600'
              }`}>
                {summary.responseStatus === 'complete' ? 'Complete' :
                 summary.responseStatus === 'partial' ? 'Partial' : 'Pending'}
              </div>
              <div className="text-sm text-gray-500">Response Status</div>
            </div>
          </div>
          {summary.sentAt && (
            <div className="mt-3 text-xs text-gray-500">
              Sent: {formatTimestamp(summary.sentAt)}
            </div>
          )}
        </div>

        {/* Approved Card */}
        <div className="bg-white border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{summary.approved.count}</div>
              <div className="text-sm text-gray-500">Approved</div>
            </div>
          </div>
          {summary.approved.value > 0 && (
            <div className="mt-3 text-sm font-medium text-green-600">
              £{summary.approved.value.toFixed(2)}
            </div>
          )}
        </div>

        {/* Declined Card */}
        <div className="bg-white border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{summary.declined.count}</div>
              <div className="text-sm text-gray-500">Declined</div>
            </div>
          </div>
          {summary.declined.value > 0 && (
            <div className="mt-3 text-sm font-medium text-red-600">
              £{summary.declined.value.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {/* Communications Section */}
      <div className="bg-white border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Communication History</h3>
        </div>
        {communications.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <svg className="w-10 h-10 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p>No communications sent yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Channel</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recipient</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sent</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {communications.map((comm) => {
                  const statusStyle = getCommStatusStyle(comm.status)
                  return (
                    <tr key={comm.id}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {comm.channel === 'email' ? (
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                          )}
                          <span className="text-sm text-gray-900 capitalize">{comm.channel}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {comm.recipient}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                        {comm.subject || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded ${statusStyle.color}`}>
                          {statusStyle.label}
                        </span>
                        {comm.errorMessage && (
                          <div className="text-xs text-red-500 mt-1">{comm.errorMessage}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {formatTimestamp(comm.sentAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activity Timeline Section */}
      <div className="bg-white border border-gray-200 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Customer Activity Timeline</h3>
        </div>
        {activities.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <svg className="w-10 h-10 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>No customer activity recorded yet</p>
            <p className="text-sm mt-1">Activities will appear when the customer views their health check report</p>
          </div>
        ) : (
          <div className="flow-root p-4">
            <ul className="-mb-8">
              {activities.map((activity, index) => {
                const { icon, bgColor, label } = getActivityStyle(activity.type)
                const isLastItem = index === activities.length - 1

                return (
                  <li key={activity.id}>
                    <div className="relative pb-8">
                      {!isLastItem && (
                        <span
                          className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200"
                          aria-hidden="true"
                        />
                      )}

                      <div className="relative flex space-x-4">
                        <div>
                          <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${bgColor}`}>
                            <span className="text-white">{icon}</span>
                          </span>
                        </div>

                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-900">{label}</span>
                            <div className="text-right">
                              <time className="text-sm text-gray-900">
                                {formatTimestamp(activity.timestamp)}
                              </time>
                              <div className="text-xs text-gray-500">
                                {formatRelativeTime(activity.timestamp)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 mt-2">
                            {activity.deviceType && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded">
                                {getDeviceIcon(activity.deviceType)}
                                <span className="capitalize">{activity.deviceType}</span>
                              </span>
                            )}
                            {activity.ipAddress && (
                              <span className="text-xs text-gray-400">
                                IP: {activity.ipAddress}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Status Changes by Customer */}
      {statusChanges.length > 0 && (
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Customer Decision Timeline</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {statusChanges.map((change) => (
              <div key={change.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">{change.fromStatus || 'N/A'}</span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <span className="text-sm font-medium text-gray-900">{change.toStatus}</span>
                </div>
                <div className="text-sm text-gray-500">
                  {formatTimestamp(change.timestamp)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
