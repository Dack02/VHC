import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface HistoryItem {
  id: string
  action: string
  context: {
    itemName?: string
    templateName?: string
    reasonsCount?: number
    itemsCount?: number
  }
  inputTokens: number
  outputTokens: number
  totalCost: number
  createdAt: string
  userName: string
  userId: string
}

interface HistoryResponse {
  history: HistoryItem[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

interface User {
  id: string
  firstName: string
  lastName: string
}

export default function AIUsageHistory() {
  const { user, session } = useAuth()
  const navigate = useNavigate()
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [users, setUsers] = useState<User[]>([])

  const orgId = user?.organization?.id

  useEffect(() => {
    if (orgId) {
      fetchHistory()
      fetchUsers()
    }
  }, [orgId, pagination.page, filterUser, filterAction, filterDateFrom, filterDateTo])

  const fetchHistory = async () => {
    if (!orgId || !session?.accessToken) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString()
      })

      if (filterUser) params.append('userId', filterUser)
      if (filterAction) params.append('action', filterAction)
      if (filterDateFrom) params.append('dateFrom', filterDateFrom)
      if (filterDateTo) params.append('dateTo', filterDateTo)

      const data = await api<HistoryResponse>(
        `/api/v1/organizations/${orgId}/ai-usage/history?${params}`,
        { token: session.accessToken }
      )
      setHistory(data.history)
      setPagination(data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    if (!orgId || !session?.accessToken) return

    try {
      const data = await api<{ users: User[] }>(
        `/api/v1/organizations/${orgId}/users`,
        { token: session.accessToken }
      )
      setUsers(data.users || [])
    } catch (err) {
      // Silently fail - users dropdown will just be empty
    }
  }

  const formatTimestamp = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatActionDescription = (item: HistoryItem) => {
    const { action, context } = item

    switch (action) {
      case 'generate_reasons':
        return `Generated reasons for ${context.itemName || 'item'} (${context.reasonsCount || 0} reasons)`
      case 'generate_bulk':
        return `Bulk generated for ${context.templateName || 'template'} (${context.reasonsCount || 0} reasons)`
      case 'regenerate_descriptions':
        return `Regenerated descriptions for ${context.itemsCount || 1} reason${(context.itemsCount || 1) !== 1 ? 's' : ''}`
      case 'generate_single':
        return `Generated reason for ${context.itemName || 'item'}`
      default:
        return `AI generation`
    }
  }

  const formatActionType = (action: string) => {
    switch (action) {
      case 'generate_reasons':
        return 'Generate Reasons'
      case 'generate_bulk':
        return 'Bulk Generate'
      case 'regenerate_descriptions':
        return 'Regenerate'
      case 'generate_single':
        return 'Single Generate'
      default:
        return action.replace(/_/g, ' ')
    }
  }

  const clearFilters = () => {
    setFilterUser('')
    setFilterAction('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  const hasFilters = filterUser || filterAction || filterDateFrom || filterDateTo

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/settings/ai-usage')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to AI Usage
          </button>
          <h1 className="text-2xl font-bold text-gray-900">AI Usage History</h1>
          <p className="text-gray-500 mt-1">View all AI generations for your organization</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">User</label>
            <select
              value={filterUser}
              onChange={(e) => {
                setFilterUser(e.target.value)
                setPagination(prev => ({ ...prev, page: 1 }))
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Users</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
            <select
              value={filterAction}
              onChange={(e) => {
                setFilterAction(e.target.value)
                setPagination(prev => ({ ...prev, page: 1 }))
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Actions</option>
              <option value="generate_reasons">Generate Reasons</option>
              <option value="generate_bulk">Bulk Generate</option>
              <option value="regenerate_descriptions">Regenerate</option>
              <option value="generate_single">Single Generate</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value)
                setPagination(prev => ({ ...prev, page: 1 }))
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                setFilterDateTo(e.target.value)
                setPagination(prev => ({ ...prev, page: 1 }))
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {hasFilters && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={clearFilters}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* History Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date/Time</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : history.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  {hasFilters ? 'No results match your filters' : 'No AI generation history yet'}
                </td>
              </tr>
            ) : (
              history.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatTimestamp(item.createdAt)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {item.userName}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">{formatActionDescription(item)}</div>
                    <div className="text-xs text-gray-500">{formatActionType(item.action)}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 text-right">
                    {(item.inputTokens + item.outputTokens).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
              {pagination.total} results
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
