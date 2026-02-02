import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'
import type { CustomerDetail, CustomerHealthCheckSummary } from '../../../lib/api'

const statusLabels: Record<string, string> = {
  awaiting_arrival: 'Awaiting Arrival',
  awaiting_checkin: 'Awaiting Check-In',
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
  cancelled: 'Cancelled',
  no_show: 'No Show'
}

const statusColors: Record<string, string> = {
  awaiting_arrival: 'bg-purple-100 text-purple-700',
  awaiting_checkin: 'bg-amber-100 text-amber-700',
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
  cancelled: 'bg-gray-100 text-gray-700',
  no_show: 'bg-red-100 text-red-700'
}

interface HealthCheckHistoryTabProps {
  customer: CustomerDetail
}

export default function HealthCheckHistoryTab({ customer }: HealthCheckHistoryTabProps) {
  const { session } = useAuth()
  const [healthChecks, setHealthChecks] = useState<CustomerHealthCheckSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    fetchHealthChecks()
  }, [vehicleFilter, statusFilter])

  const fetchHealthChecks = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (vehicleFilter) params.set('vehicle_id', vehicleFilter)
      if (statusFilter) params.set('status', statusFilter)

      const data = await api<{ healthChecks: CustomerHealthCheckSummary[]; total: number }>(
        `/api/v1/customers/${customer.id}/health-checks?${params}`,
        { token: session?.accessToken }
      )
      setHealthChecks(data.healthChecks || [])
      setTotal(data.total || 0)
    } catch {
      // Silently handle - empty state shown
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
  }

  return (
    <div>
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 text-sm bg-white rounded-xl"
        >
          <option value="">All Vehicles</option>
          {customer.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration} {v.make && v.model ? `- ${v.make} ${v.model}` : ''}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 text-sm bg-white rounded-xl"
        >
          <option value="">All Statuses</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <span className="text-sm text-gray-500 w-full md:w-auto md:ml-auto">{total} health check{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Loading / Empty states */}
      {loading && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-gray-500">
          Loading...
        </div>
      )}

      {!loading && healthChecks.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center">
          <p className="text-gray-500 mb-3">No health checks found</p>
          <Link
            to="/health-checks/new"
            className="text-sm text-primary hover:text-primary-dark font-medium"
          >
            Create Health Check
          </Link>
        </div>
      )}

      {!loading && healthChecks.length > 0 && (
        <>
          {/* Mobile: Card view */}
          <div className="md:hidden space-y-3">
            {healthChecks.map((hc) => (
              <Link
                key={hc.id}
                to={`/health-checks/${hc.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-4 active:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono font-medium text-gray-700">{hc.vhcReference || '-'}</span>
                  <span className="text-xs text-gray-500">{formatDate(hc.createdAt)}</span>
                </div>
                {hc.vehicle && (
                  <div className="text-sm text-gray-600 mt-1">
                    <span className="font-medium">{hc.vehicle.registration}</span>
                    {hc.vehicle.make && (
                      <span className="text-gray-500 ml-1">{hc.vehicle.make} {hc.vehicle.model}</span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className={`text-xs px-2 py-0.5 font-medium ${statusColors[hc.status] || 'bg-gray-100 text-gray-700'}`}>
                    {statusLabels[hc.status] || hc.status}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    {hc.greenCount > 0 && (
                      <span className="flex items-center gap-0.5">
                        <span className="w-2 h-2 bg-rag-green rounded-full" />
                        {hc.greenCount}
                      </span>
                    )}
                    {hc.amberCount > 0 && (
                      <span className="flex items-center gap-0.5">
                        <span className="w-2 h-2 bg-rag-amber rounded-full" />
                        {hc.amberCount}
                      </span>
                    )}
                    {hc.redCount > 0 && (
                      <span className="flex items-center gap-0.5">
                        <span className="w-2 h-2 bg-rag-red rounded-full" />
                        {hc.redCount}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium text-gray-700 ml-auto">{formatCurrency(hc.totalAmount || 0)}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop: Table view */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Ref</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Vehicle</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">RAG</th>
                  <th className="text-right px-4 py-3 text-sm font-semibold text-gray-600">Total</th>
                  <th className="text-right px-4 py-3 text-sm font-semibold text-gray-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {healthChecks.map((hc) => (
                  <tr
                    key={hc.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => window.location.href = `/health-checks/${hc.id}`}
                  >
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(hc.createdAt)}</td>
                    <td className="px-4 py-3 text-sm font-mono font-medium text-gray-700">{hc.vhcReference || '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      {hc.vehicle && (
                        <>
                          <span className="font-medium">{hc.vehicle.registration}</span>
                          {hc.vehicle.make && (
                            <span className="text-gray-500 ml-1">{hc.vehicle.make} {hc.vehicle.model}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 font-medium ${statusColors[hc.status] || 'bg-gray-100 text-gray-700'}`}>
                        {statusLabels[hc.status] || hc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        {hc.greenCount > 0 && (
                          <span className="flex items-center gap-0.5">
                            <span className="w-2 h-2 bg-rag-green rounded-full" />
                            {hc.greenCount}
                          </span>
                        )}
                        {hc.amberCount > 0 && (
                          <span className="flex items-center gap-0.5">
                            <span className="w-2 h-2 bg-rag-amber rounded-full" />
                            {hc.amberCount}
                          </span>
                        )}
                        {hc.redCount > 0 && (
                          <span className="flex items-center gap-0.5">
                            <span className="w-2 h-2 bg-rag-red rounded-full" />
                            {hc.redCount}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(hc.totalAmount || 0)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/health-checks/${hc.id}`}
                        className="text-sm text-primary hover:text-primary-dark"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
