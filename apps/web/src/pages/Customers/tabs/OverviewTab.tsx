import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'
import type { CustomerDetail, CustomerStats, CustomerHealthCheckSummary } from '../../../lib/api'

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

interface OverviewTabProps {
  customer: CustomerDetail
  stats: CustomerStats | null
  recentHealthChecks: CustomerHealthCheckSummary[]
  onCustomerUpdate: (updated: CustomerDetail) => void
}

export default function OverviewTab({ customer, stats, recentHealthChecks, onCustomerUpdate }: OverviewTabProps) {
  const { session } = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email || '',
    mobile: customer.mobile || '',
    address: customer.address || '',
    externalId: customer.externalId || ''
  })

  const handleSave = async () => {
    setError('')
    setSaving(true)
    try {
      const updated = await api<CustomerDetail>(`/api/v1/customers/${customer.id}`, {
        method: 'PATCH',
        body: formData,
        token: session?.accessToken
      })
      setIsEditing(false)
      onCustomerUpdate({ ...customer, ...updated })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update customer')
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
  }

  return (
    <div className="space-y-6">
      {/* Contact Information Card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Contact Information</h3>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="text-sm text-primary hover:text-primary-dark font-medium"
            >
              Edit
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {isEditing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
              <input
                type="tel"
                value={formData.mobile}
                onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <textarea
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 text-sm"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">External ID (DMS)</label>
              <input
                type="text"
                value={formData.externalId}
                onChange={(e) => setFormData({ ...formData, externalId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-primary text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setIsEditing(false)
                  setFormData({
                    firstName: customer.firstName,
                    lastName: customer.lastName,
                    email: customer.email || '',
                    mobile: customer.mobile || '',
                    address: customer.address || '',
                    externalId: customer.externalId || ''
                  })
                }}
                className="px-4 py-2 text-gray-600 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Email</span>
              <div className="font-medium">{customer.email || '-'}</div>
            </div>
            <div>
              <span className="text-gray-500">Mobile</span>
              <div className="font-medium">{customer.mobile || '-'}</div>
            </div>
            <div className="md:col-span-2">
              <span className="text-gray-500">Address</span>
              <div className="font-medium">{customer.address || '-'}</div>
            </div>
            <div>
              <span className="text-gray-500">External ID (DMS)</span>
              <div className="font-medium">{customer.externalId || '-'}</div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-2xl font-bold text-gray-900">{stats.totalHealthChecks}</div>
            <div className="text-sm text-gray-500">Total Health Checks</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(stats.totalAuthorisedValue)}</div>
            <div className="text-sm text-gray-500">Total Value</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-2xl font-bold text-gray-900">{formatDate(stats.lastVisit)}</div>
            <div className="text-sm text-gray-500">Last Visit</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-2xl font-bold text-gray-900">{stats.vehicleCount}</div>
            <div className="text-sm text-gray-500">Vehicles</div>
          </div>
        </div>
      )}

      {/* Recent Health Checks */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Health Checks</h3>
        {recentHealthChecks.length === 0 ? (
          <p className="text-sm text-gray-500">No health checks yet</p>
        ) : (
          <div className="space-y-3">
            {recentHealthChecks.map((hc) => (
              <Link
                key={hc.id}
                to={`/health-checks/${hc.id}`}
                className="block border border-gray-200 p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono font-medium text-gray-700">{hc.vhcReference || '-'}</span>
                    <span className={`text-xs px-2 py-0.5 font-medium ${statusColors[hc.status] || 'bg-gray-100 text-gray-700'}`}>
                      {statusLabels[hc.status] || hc.status}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500">{formatDate(hc.createdAt)}</span>
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm">
                  {hc.vehicle && (
                    <span className="text-gray-600">{hc.vehicle.registration} - {hc.vehicle.make} {hc.vehicle.model}</span>
                  )}
                  <div className="flex items-center gap-1.5 ml-auto">
                    {hc.greenCount > 0 && <span className="w-2.5 h-2.5 bg-rag-green rounded-full" title={`${hc.greenCount} green`} />}
                    {hc.amberCount > 0 && <span className="w-2.5 h-2.5 bg-rag-amber rounded-full" title={`${hc.amberCount} amber`} />}
                    {hc.redCount > 0 && <span className="w-2.5 h-2.5 bg-rag-red rounded-full" title={`${hc.redCount} red`} />}
                    <span className="text-gray-500 ml-2">{formatCurrency(hc.totalAmount || 0)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
