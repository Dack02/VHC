import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface ActivityItem {
  id: string
  action: string
  entityType: string
  entityId: string
  metadata: Record<string, unknown>
  organizationId: string
  organizationName: string
  performedBy: string
  performedByName: string
  performedByEmail: string
  createdAt: string
}

export default function AdminActivity() {
  const { session } = useSuperAdmin()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  const page = parseInt(searchParams.get('page') || '1')
  const action = searchParams.get('action') || ''
  const limit = 20
  const offset = (page - 1) * limit

  useEffect(() => {
    fetchActivity()
  }, [session, page, action])

  const fetchActivity = async () => {
    if (!session?.accessToken) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      })
      if (action) params.set('action', action)

      const data = await api<{ activities: ActivityItem[], total: number }>(
        `/api/v1/admin/activity?${params}`,
        { token: session.accessToken }
      )
      setActivities(data.activities)
      setTotal(data.total)
    } catch (error) {
      console.error('Failed to fetch activity:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleActionFilter = (newAction: string) => {
    const params = new URLSearchParams(searchParams)
    if (newAction) {
      params.set('action', newAction)
    } else {
      params.delete('action')
    }
    params.set('page', '1')
    setSearchParams(params)
  }

  const totalPages = Math.ceil(total / limit)

  const actionTypes = [
    { value: '', label: 'All Actions' },
    { value: 'org.created', label: 'Organization Created' },
    { value: 'org.updated', label: 'Organization Updated' },
    { value: 'org.suspended', label: 'Organization Suspended' },
    { value: 'org.activated', label: 'Organization Activated' },
    { value: 'user.created', label: 'User Created' },
    { value: 'user.updated', label: 'User Updated' },
    { value: 'impersonation.started', label: 'Impersonation Started' },
    { value: 'impersonation.ended', label: 'Impersonation Ended' }
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
        <p className="text-gray-500 mt-1">View all platform activity and audit events</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <select
            value={action}
            onChange={(e) => handleActionFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {actionTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Activity List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading activity...</div>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <svg className="w-12 h-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500">No activity found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {activities.map((item) => (
              <div key={item.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        getActionColor(item.action)
                      }`}>
                        {formatActionLabel(item.action)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {item.entityType}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900 mt-1">
                      <span className="font-medium">{item.performedByName}</span>
                      <span className="text-gray-500"> ({item.performedByEmail})</span>
                    </p>
                    {item.organizationName && (
                      <p className="text-xs text-gray-500 mt-1">
                        Organization: {item.organizationName}
                      </p>
                    )}
                    {item.metadata && Object.keys(item.metadata).length > 0 && (
                      <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">
                        <pre className="whitespace-pre-wrap">
                          {JSON.stringify(item.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 ml-4 whitespace-nowrap">
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{offset + 1}</span> to{' '}
                <span className="font-medium">{Math.min(offset + limit, total)}</span> of{' '}
                <span className="font-medium">{total}</span> results
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const params = new URLSearchParams(searchParams)
                    params.set('page', String(page - 1))
                    setSearchParams(params)
                  }}
                  disabled={page === 1}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => {
                    const params = new URLSearchParams(searchParams)
                    params.set('page', String(page + 1))
                    setSearchParams(params)
                  }}
                  disabled={page === totalPages}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatActionLabel(action: string): string {
  const labels: Record<string, string> = {
    'org.created': 'Created',
    'org.updated': 'Updated',
    'org.suspended': 'Suspended',
    'org.activated': 'Activated',
    'user.created': 'User Created',
    'user.updated': 'User Updated',
    'impersonation.started': 'Impersonation',
    'impersonation.ended': 'End Impersonation'
  }
  return labels[action] || action
}

function getActionColor(action: string): string {
  if (action.includes('created')) return 'bg-green-100 text-green-800'
  if (action.includes('suspended')) return 'bg-red-100 text-red-800'
  if (action.includes('activated')) return 'bg-blue-100 text-blue-800'
  if (action.includes('impersonation')) return 'bg-yellow-100 text-yellow-800'
  if (action.includes('updated')) return 'bg-purple-100 text-purple-800'
  return 'bg-gray-100 text-gray-800'
}
