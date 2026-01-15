import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api, HealthCheck, User } from '../../lib/api'

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

const statusColors: Record<string, string> = {
  created: 'bg-gray-100 text-gray-700',
  assigned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  paused: 'bg-gray-100 text-gray-700',
  tech_completed: 'bg-green-100 text-green-700',
  awaiting_review: 'bg-orange-100 text-orange-700',
  awaiting_pricing: 'bg-orange-100 text-orange-700',
  ready_to_send: 'bg-blue-100 text-blue-700',
  sent: 'bg-purple-100 text-purple-700',
  opened: 'bg-green-100 text-green-700',
  partial_response: 'bg-yellow-100 text-yellow-700',
  authorized: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700'
}

export default function HealthCheckList() {
  const { session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)

  // Filters from URL
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || ''
  const technicianId = searchParams.get('technician') || ''
  const advisorId = searchParams.get('advisor') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const limit = 20

  const fetchHealthChecks = useCallback(async () => {
    if (!session?.accessToken) return

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String((page - 1) * limit))

      if (status) params.set('status', status)
      if (technicianId) params.set('technician_id', technicianId)
      if (advisorId) params.set('advisor_id', advisorId)

      const data = await api<{ healthChecks: HealthCheck[]; total: number }>(
        `/api/v1/health-checks?${params}`,
        { token: session.accessToken }
      )

      // Filter by search locally (registration or customer name)
      let filtered = data.healthChecks || []
      if (search) {
        const searchLower = search.toLowerCase()
        filtered = filtered.filter(hc =>
          hc.vehicle?.registration?.toLowerCase().includes(searchLower) ||
          `${hc.vehicle?.customer?.first_name} ${hc.vehicle?.customer?.last_name}`.toLowerCase().includes(searchLower)
        )
      }

      setHealthChecks(filtered)
      setTotalCount(data.total || filtered.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health checks')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, status, technicianId, advisorId, page, search])

  const fetchUsers = useCallback(async () => {
    if (!session?.accessToken) return

    try {
      const data = await api<{ users: User[] }>(
        '/api/v1/users',
        { token: session.accessToken }
      )
      setUsers(data.users || [])
    } catch (err) {
      console.error('Failed to load users:', err)
    }
  }, [session?.accessToken])

  useEffect(() => {
    fetchHealthChecks()
    fetchUsers()
  }, [fetchHealthChecks, fetchUsers])

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    newParams.set('page', '1') // Reset to page 1 on filter change
    setSearchParams(newParams)
  }

  const totalPages = Math.ceil(totalCount / limit)

  const technicians = users.filter(u => u.role === 'technician')
  const advisors = users.filter(u => ['service_advisor', 'site_admin', 'org_admin'].includes(u.role))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Health Checks</h1>
        <Link
          to="/health-checks/new"
          className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark"
        >
          New Health Check
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="Search by registration or customer..."
              value={search}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {/* Status filter */}
          <select
            value={status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          {/* Technician filter */}
          <select
            value={technicianId}
            onChange={(e) => updateFilter('technician', e.target.value)}
            className="px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Technicians</option>
            {technicians.map(tech => (
              <option key={tech.id} value={tech.id}>
                {tech.firstName} {tech.lastName}
              </option>
            ))}
          </select>

          {/* Advisor filter */}
          <select
            value={advisorId}
            onChange={(e) => updateFilter('advisor', e.target.value)}
            className="px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Advisors</option>
            {advisors.map(adv => (
              <option key={adv.id} value={adv.id}>
                {adv.firstName} {adv.lastName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 mb-6">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          </div>
        ) : healthChecks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No health checks found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Registration</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">RAG</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Technician</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Created</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {healthChecks.map((hc) => (
                <tr key={hc.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {hc.vehicle?.registration || '-'}
                    </div>
                    <div className="text-sm text-gray-500">
                      {hc.vehicle?.make} {hc.vehicle?.model}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {hc.vehicle?.customer ? (
                      `${hc.vehicle.customer.first_name} ${hc.vehicle.customer.last_name}`
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 text-xs font-medium ${statusColors[hc.status] || 'bg-gray-100 text-gray-700'}`}>
                      {statusLabels[hc.status] || hc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-sm">
                        <span className="w-3 h-3 rounded-full bg-green-500" />
                        {hc.green_count}
                      </span>
                      <span className="flex items-center gap-1 text-sm">
                        <span className="w-3 h-3 rounded-full bg-yellow-500" />
                        {hc.amber_count}
                      </span>
                      <span className="flex items-center gap-1 text-sm">
                        <span className="w-3 h-3 rounded-full bg-red-500" />
                        {hc.red_count}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {hc.technician ? (
                      `${hc.technician.first_name} ${hc.technician.last_name}`
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-sm">
                    {new Date(hc.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/health-checks/${hc.id}`}
                      className="text-primary hover:underline text-sm font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">
            Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, totalCount)} of {totalCount}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => updateFilter('page', String(page - 1))}
              disabled={page <= 1}
              className="px-3 py-1 border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-sm">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => updateFilter('page', String(page + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
